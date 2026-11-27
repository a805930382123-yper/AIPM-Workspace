import { markAnswerCommitted } from '../llm/knowledge-answers.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { RawStore } from '../raw/store.ts';
import { type SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { isQuestionDraft } from './drafts.ts';
import { markInspectionCommitted, verifyEvidenceInput } from './inspection-input.ts';
import { assertWikiSourcesAllowed } from './source-lineage.ts';
import { WikiError, type WikiRecord } from './store.ts';
import {
  CommitError,
  commitManifestFile,
  commitSha256,
  reviewProjection,
  type CommitManifest,
  type CommitPhase,
  type CommitPhaseName,
  type KnowledgeCommitManifest,
  type WikiCommitDeps,
} from './commit-types.ts';

export async function existingCommitTargets(
  deps: WikiCommitDeps,
  manifest: KnowledgeCommitManifest,
): Promise<string[]> {
  const written: string[] = [];
  for (const record of [
    ...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []),
    ...manifest.snapshot.pageRecords,
  ]) {
    const current = await deps.wikiStore.readPageFile(record.id);
    if (current !== undefined && commitSha256(current) === manifest.snapshot.digests[record.id])
      written.push(record.id);
  }
  return written;
}

export async function verifiedCommitTargets(
  deps: WikiCommitDeps,
  manifest: KnowledgeCommitManifest,
): Promise<string[]> {
  const matched: string[] = [];
  for (const record of [
    ...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []),
    ...manifest.snapshot.pageRecords,
  ]) {
    const current = await deps.wikiStore.readPageFile(record.id);
    if (current === undefined) continue;
    if (
      manifest.snapshot.maintenance?.before[record.id] &&
      commitSha256(current) ===
        commitSha256(deps.wikiStore.pageContent(manifest.snapshot.maintenance.before[record.id]))
    )
      continue;
    if (commitSha256(current) !== manifest.snapshot.digests[record.id])
      throw new CommitError('COMMIT_TARGET_CONFLICT', '已有事务目标与冻结快照冲突，停止恢复。', 409, {
        wikiId: record.id,
      });
    matched.push(record.id);
  }
  return matched;
}

/** Writes one page unless an identical file already exists; never overwrites different content. */
export async function ensureCommitPage(
  deps: WikiCommitDeps,
  record: WikiRecord,
  digests: Record<string, string>,
  before?: WikiRecord,
): Promise<void> {
  const expected = digests[record.id];
  const current = await deps.wikiStore.readPageFile(record.id);
  if (current !== undefined) {
    if (commitSha256(current) === expected) return;
    if (before && commitSha256(current) === commitSha256(deps.wikiStore.pageContent(before))) {
      await deps.wikiStore.writePageLocked(record);
      return;
    }
    throw new WikiError(
      'COMMIT_TARGET_CONFLICT',
      `目标页面 ${record.id}（${record.title}）已存在且内容与本次确认不一致，已停止写入以避免覆盖。`,
      409,
      { wikiId: record.id, title: record.title },
    );
  }
  await deps.wikiStore.writePageLocked(record);
  const written = await deps.wikiStore.readPageFile(record.id);
  if (written === undefined || commitSha256(written) !== expected) {
    throw new WikiError(
      'COMMIT_WRITE_VERIFY_FAILED',
      `写入 ${record.id}（${record.title}）后校验失败，已停止后续写入。`,
      500,
      { wikiId: record.id },
    );
  }
}

/** Runs/continues the frozen manifest; every phase is idempotent and recorded on disk. */
export async function executeCommitManifest(
  deps: WikiCommitDeps,
  queue: SerialQueue,
  input: KnowledgeCommitManifest,
): Promise<KnowledgeCommitManifest> {
  return queue.run(async () => {
    let manifest = { ...input };
    const currentDraft = await deps.drafts.getKnowledge(input.draftId);
    const outcomeReview = input.snapshot.outcomeReview;
    if (
      (currentDraft?.structuredNote || input.snapshot.sourceRecord?.body.includes('## 深度整理笔记\n')) &&
      !input.snapshot.deepNote &&
      !input.snapshot.maintenance &&
      !outcomeReview
    )
      throw new CommitError('NOTE_REVIEW_REQUIRED', '旧事务没有冻结的笔记审批，不能恢复写入。', 409);
    if (input.supersededBy) throw new CommitError('HUMAN_REVIEW_SUPERSEDED', '旧事务已由重新审查事务替代。', 409);
    const evidenceInput = input.inspectionInput ?? input.questionInput;
    const raw = evidenceInput ? undefined : await deps.rawStore.get(input.rawId!);
    if (evidenceInput)
      await verifyEvidenceInput(evidenceInput, deps.wikiStore, deps.rawStore as RawStore, input.snapshot.pageRecords);
    else assertRawNotMeeting(raw);
    if (!evidenceInput && (!raw || raw.bodySha256 !== input.rawSha256 || commitSha256(raw.body) !== input.rawSha256))
      throw new CommitError('RAW_CHANGED', '提交来源已变化。', 409);
    if (input.snapshot.maintenance) {
      for (const target of input.snapshot.maintenance.targets) {
        for (const source of target.sources) assertRawNotMeeting(await deps.rawStore.get(source));
        if (outcomeReview) await assertWikiSourcesAllowed(deps.wikiStore, deps.rawStore, target);
        const current = await deps.wikiStore.readPageFile(target.id),
          expected = input.snapshot.digests[target.id];
        if (
          current === undefined ||
          (commitSha256(current) !== commitSha256(deps.wikiStore.pageContent(target)) &&
            (!expected || commitSha256(current) !== expected))
        )
          throw new CommitError('WIKI_REVISION_CONFLICT', '冻结的目标Wiki已变化，停止恢复。', 409, {
            wikiId: target.id,
          });
      }
    }
    const actual = await verifiedCommitTargets(deps, input);
    if (outcomeReview) {
      if (!currentDraft || isQuestionDraft(currentDraft) || currentDraft.revision !== input.snapshot.capturedRevision) {
        throw new CommitError('REVIEW_CONTENT_CHANGED', '成果确认时的草稿版本已变化，已停止恢复。', 409);
      }
      await deps.drafts.assertRawOutcome(currentDraft, raw!.body, input.snapshot.selectedPageIds, outcomeReview.digest);
      for (const record of input.snapshot.pageRecords)
        for (const id of record.sources) assertRawNotMeeting(await deps.rawStore.get(id));
    } else if (input.snapshot.maintenance) {
      if (
        !currentDraft ||
        (await deps.drafts.assertReviewed(
          reviewProjection(currentDraft, input.snapshot.selectedPageIds),
          raw?.body ?? '',
          evidenceInput ? input.snapshot.pageRecords : [],
        )) !== input.snapshot.maintenance.reviewDigest
      )
        throw new CommitError('REVIEW_CONTENT_CHANGED', '恢复审批与冻结内容不一致。', 409);
      for (const record of input.snapshot.pageRecords)
        for (const id of record.sources) assertRawNotMeeting(await deps.rawStore.get(id));
    } else if (input.snapshot.deepNote) {
      if (
        input.snapshot.deepNote.reviewDigest !== input.humanReviewDigest ||
        input.snapshot.deepNote.approval.digest !== input.humanReviewDigest
      )
        throw new CommitError('NOTE_REVIEW_REQUIRED', '冻结的笔记审批不匹配。', 409);
      if (
        !actual.length &&
        (!currentDraft || (await deps.drafts.assertReviewed(currentDraft, raw?.body ?? '')) !== input.humanReviewDigest)
      )
        throw new CommitError('REVIEW_CONTENT_CHANGED', '零写入事务需当前有效的全部审核。', 409);
    } else if (!input.humanReviewDigest) {
      if (!actual.length) {
        manifest.awaitingHumanReview = true;
        await writeJsonAtomic(commitManifestFile(deps.root, manifest.operationId), manifest);
        await deps.drafts.resetToPending(input.draftId, '旧零写入事务需逐页人工审查');
        throw new CommitError('HUMAN_REVIEW_REQUIRED', '旧事务没有实际写入；请回到草稿逐页审查后重新明确确认。', 409, {
          operationId: input.operationId,
          writtenWikiIds: [],
          committed: false,
        });
      }
      manifest.legacyRecovery = 'verified_partial';
      await writeJsonAtomic(commitManifestFile(deps.root, manifest.operationId), manifest);
    } else {
      const draft = await deps.drafts.get(input.draftId);
      if (
        !draft ||
        (await deps.drafts.assertReviewed(draft, raw?.body ?? '')) !== input.humanReviewDigest ||
        draft.humanReview?.basisDigest !== input.humanReviewBasisDigest
      )
        throw new CommitError('REVIEW_CONTENT_CHANGED', '提交审查快照与当前候选不一致。', 409);
    }
    const save = async (patch: Partial<KnowledgeCommitManifest>) => {
      manifest = { ...manifest, ...patch, updatedAt: new Date().toISOString() } as KnowledgeCommitManifest;
      await writeJsonAtomic(commitManifestFile(deps.root, manifest.operationId), manifest);
      return manifest;
    };
    const markPhase = async (name: CommitPhaseName, status: CommitPhase['status'], error?: string) => {
      const phases = manifest.phases.map((phase) =>
        phase.name === name ? { ...phase, status, at: new Date().toISOString(), ...(error ? { error } : {}) } : phase,
      );
      await save({ phases });
    };
    const done = (name: CommitPhaseName) => manifest.phases.find((phase) => phase.name === name)?.status === 'done';
    let currentPhase: CommitPhaseName = 'source';
    // Tracks the files this run proved to be on disk, so an un-writable manifest can never
    // hide what was already committed (F04-09).
    const writtenSoFar: string[] = [];
    try {
      await save({ status: 'committing' });
      currentPhase = 'source';
      if (!done('source')) {
        if (manifest.snapshot.sourceRecord) {
          await ensureCommitPage(
            deps,
            manifest.snapshot.sourceRecord,
            manifest.snapshot.digests,
            manifest.snapshot.maintenance?.before[manifest.snapshot.sourceRecord.id],
          );
          writtenSoFar.push(manifest.snapshot.sourceRecord.id);
        }
        await markPhase('source', 'done');
      }
      currentPhase = 'pages';
      if (!done('pages')) {
        for (const record of manifest.snapshot.pageRecords) {
          await ensureCommitPage(
            deps,
            record,
            manifest.snapshot.digests,
            manifest.snapshot.maintenance?.before[record.id],
          );
          writtenSoFar.push(record.id);
        }
        await markPhase('pages', 'done');
      }
      const written = [
        ...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []),
        ...manifest.snapshot.pageRecords,
      ];
      currentPhase = 'index';
      if (!done('index')) {
        if (!manifest.snapshot.maintenance?.noChanges) await deps.wikiStore.rebuildIndexLocked();
        await markPhase('index', 'done');
      }
      currentPhase = 'log';
      if (!done('log')) {
        if (!manifest.snapshot.maintenance?.noChanges)
          await deps.wikiStore.appendLogLocked(
            written.map((record) => ({
              operationId: manifest.operationId,
              action: manifest.snapshot.maintenance?.before[record.id] ? ('update' as const) : ('create' as const),
              id: record.id,
              title: record.title,
              type: record.type,
              revision: record.revision,
            })),
          );
        await markPhase('log', 'done');
      }
      currentPhase = 'state';
      if (!done('state')) {
        if (manifest.snapshot.maintenance)
          await deps.drafts.markMaintenanceCommitted(
            manifest.draftId,
            manifest.operationId,
            manifest.snapshot.maintenance.changeIds,
          );
        else await deps.drafts.markConfirmed(manifest.draftId, manifest.operationId);
        if (manifest.inspectionInput)
          await markInspectionCommitted(
            deps.root,
            manifest.inspectionInput,
            manifest.operationId,
            manifest.snapshot.maintenance!.resultWikiIds,
            Object.fromEntries(
              manifest.snapshot.maintenance!.changeIds.map((id, i) => [
                id,
                manifest.snapshot.maintenance!.resultWikiIds[i],
              ]),
            ),
          );
        else if (manifest.questionInput)
          await markAnswerCommitted(
            deps.root,
            manifest.questionInput,
            manifest.operationId,
            manifest.snapshot.maintenance!.resultWikiIds,
            manifest.draftId,
          );
        else {
          const currentState = await deps.rawStates.get(manifest.rawId!),
            remaining = (await deps.drafts.get(manifest.draftId))?.status === 'pending_confirmation';
          await deps.rawStates.set(manifest.rawId!, {
            status: remaining ? 'pending_confirmation' : 'generated',
            reason: manifest.snapshot.maintenance?.noChanges ? '已检查，无需变更' : 'AI 提取结果已确认写入 Wiki',
            draftId: manifest.draftId,
            confirmedOperationId: manifest.operationId,
            generatedWikiIds: [
              ...new Set([
                ...(currentState.generatedWikiIds ?? []),
                ...(manifest.snapshot.outcomeReview
                  ? written.map((record) => record.id)
                  : (manifest.snapshot.maintenance?.resultWikiIds ?? written.map((record) => record.id))),
              ]),
            ],
          });
        }
        await markPhase('state', 'done');
      }
      return await save({
        status: 'completed',
        completedAt: new Date().toISOString(),
        writtenWikiIds: written.map((record) => record.id),
      });
    } catch (error) {
      const fsCode = (error as { code?: unknown }).code;
      const isFsError = typeof fsCode === 'string' && typeof (error as { syscall?: unknown }).syscall === 'string';
      const code =
        error instanceof WikiError || error instanceof CommitError
          ? (error as { code: string }).code
          : isFsError
            ? 'COMMIT_STATE_WRITE_FAILED'
            : 'COMMIT_FAILED';
      const message = error instanceof Error ? error.message : '未知错误';
      // F04-09: the partial-commit facts must survive even when the manifest itself cannot be
      // updated any more — nothing here may throw before the honest error is returned.
      const onDisk = await existingCommitTargets(deps, manifest).catch(() => [] as string[]);
      const writtenWikiIds = [...new Set([...writtenSoFar, ...(manifest.writtenWikiIds ?? []), ...onDisk])];
      // Record which phase failed so the recovery state is readable, not just "failed".
      try {
        await markPhase(currentPhase, 'failed', `${code}: ${message}`);
      } catch {
        /* in-memory phases below still describe it */
      }
      try {
        await save({
          status: 'failed',
          error: {
            code,
            message,
            at: new Date().toISOString(),
            phase: currentPhase,
            ...(isFsError ? { cause: { code: String(fsCode), message } } : {}),
          } as CommitManifest['error'],
          writtenWikiIds,
          recoveryHint: '已写入的正式文件保留；解除磁盘故障后重启工作台会自动继续这个 operationId，不需要重新确认。',
        });
      } catch {
        /* the response still carries the recovery facts below */
      }
      throw new WikiError(code, message, (error as { status?: number }).status ?? 500, {
        committed: writtenWikiIds.length > 0,
        recoverable: code !== 'COMMIT_TARGET_CONFLICT',
        operationId: manifest.operationId,
        failedPhase: currentPhase,
        phases: manifest.phases,
        writtenWikiIds,
        status: manifest.status,
      });
    }
  });
}

/** Startup recovery: finish every manifest the user already confirmed. */
export async function reconcileCommitManifests(
  deps: WikiCommitDeps,
  queue: SerialQueue,
  listManifests: () => Promise<KnowledgeCommitManifest[]>,
): Promise<{
  resumed: KnowledgeCommitManifest[];
  conflicts: Array<{
    operationId: string;
    code: string;
    message: string;
    committed: boolean;
    writtenWikiIds: string[];
    failedPhase?: string;
  }>;
}> {
  const resumed: KnowledgeCommitManifest[] = [];
  const conflicts: Array<{
    operationId: string;
    code: string;
    message: string;
    committed: boolean;
    writtenWikiIds: string[];
    failedPhase?: string;
  }> = [];
  for (const manifest of await listManifests()) {
    if (manifest.status === 'completed' || manifest.supersededBy) continue;
    try {
      const finished = await deps.wikiStore.withLock(() => executeCommitManifest(deps, queue, manifest));
      resumed.push(finished);
    } catch (error) {
      // F04-09: recovery failures keep the same honest facts as the HTTP path.
      const details = (error as { details?: { committed?: boolean; writtenWikiIds?: string[]; failedPhase?: string } })
        .details;
      conflicts.push({
        operationId: manifest.operationId,
        code: (error as { code?: string }).code ?? 'COMMIT_FAILED',
        message: error instanceof Error ? error.message : '未知错误',
        committed: details?.committed ?? false,
        writtenWikiIds: details?.writtenWikiIds ?? manifest.writtenWikiIds ?? [],
        ...(details?.failedPhase ? { failedPhase: details.failedPhase } : {}),
      });
    }
  }
  return { resumed, conflicts };
}
