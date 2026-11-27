// B04: confirmed-commit transactions. Nothing formal is written before the frozen manifest is
// persisted; a failure mid-way is reported honestly (operationId + which targets exist) and the
// same operation is resumed from the manifest instead of asking the user to confirm again.
import { mkdir } from 'node:fs/promises';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { hasEditedPdfBody, type RawStore } from '../raw/store.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';
import { SerialQueue, StorageError, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { isCommitManifest } from '../storage/record-validators.ts';
import { executeCommitManifest, reconcileCommitManifests, verifiedCommitTargets } from './commit-executor.ts';
import {
  checkConflicts,
  freezeCommitSnapshot,
  freezeMaintenanceSnapshot,
  maintenanceSource,
  payloadDigest as buildPayloadDigest,
  sourceBodyFor,
} from './commit-freeze.ts';
import {
  CommitError,
  commitDirectory,
  commitManifestFile,
  commitSha256,
  normalizeCommitTitle,
  reviewProjection,
  scanWikiCommits,
  type CommitPhaseName,
  type CommitSnapshot,
  type KnowledgeCommitManifest,
  type QuestionCommitManifest,
  type WikiCommitDeps,
} from './commit-types.ts';
import { isQuestionDraft, type QuestionDraftRecord } from './drafts.ts';
import { verifyEvidenceInput } from './inspection-input.ts';
import { maintenanceDigest, type KnowledgeChange } from './maintenance.ts';

export class WikiCommitService {
  private readonly queue = new SerialQueue();
  constructor(private readonly deps: WikiCommitDeps) {}

  private directory() {
    return commitDirectory(this.deps.root);
  }
  private fileFor(operationId: string) {
    return commitManifestFile(this.deps.root, operationId);
  }

  async initialize() {
    await mkdir(this.directory(), { recursive: true });
  }

  async get(operationId: string): Promise<KnowledgeCommitManifest | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return undefined;
    const m = await readJsonRecord<KnowledgeCommitManifest>(
      this.deps.root,
      this.fileFor(operationId),
      (v): v is KnowledgeCommitManifest => isCommitManifest(v, operationId),
    );
    if (m === undefined) return undefined;
    if (!isCommitManifest(m, operationId))
      throw new StorageError('STORAGE_CORRUPT', '提交清单结构无效，原文件已保留；恢复执行已停止。', 500, {
        category: 'recovery',
        nextAction: 'inspect_or_restore',
      });
    return m;
  }

  async list(): Promise<KnowledgeCommitManifest[]> {
    const records = await scanWikiCommits(this.deps.root);
    return records.records.map((x) => x.value);
  }

  async findByDraft(draftId: string): Promise<KnowledgeCommitManifest | undefined> {
    return (await this.list()).find((manifest) => manifest.draftId === draftId && !manifest.supersededBy);
  }

  async status(operationId: string): Promise<KnowledgeCommitManifest | undefined> {
    return this.get(operationId);
  }

  /** Public entry: must be called inside `wikiStore.withLock`. */
  async confirm(input: {
    draftId: string;
    baseRevision: number;
    selectedPageIds: string[];
    idempotencyKey: string;
    operationId: string;
    now: string;
    outcomeDigest?: string;
  }): Promise<{ manifest: KnowledgeCommitManifest; reused: boolean; sourceReused: boolean }> {
    let draft = await this.deps.drafts.getKnowledge(input.draftId);
    if (!draft) throw new CommitError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);

    if (isQuestionDraft(draft)) {
      if (input.outcomeDigest !== undefined)
        throw new CommitError('RAW_OUTCOME_ONLY', '成果确认仅适用于 Raw 整理草稿。', 400);
      return this.confirmQuestion(draft, input);
    }
    const outcomeReview: CommitSnapshot['outcomeReview'] =
      input.outcomeDigest !== undefined
        ? { version: 1, digest: input.outcomeDigest, confirmedAt: input.now }
        : undefined;

    // F04-04: the same business rule applies to the first confirm and to a retry — every incoming
    // page id must exist before anything is compared. A different request is never silently
    // reduced to the stored one and then reported as a successful reuse.
    const requested = [...new Set(input.selectedPageIds)];
    if (!requested.length && !draft.structuredNote)
      throw new CommitError('NO_SELECTION', '至少选择一条知识建议才能确认写入。', 400);
    for (const id of requested) {
      if (!draft.pages.some((page) => page.pageId === id)) {
        throw new CommitError('UNKNOWN_PAGE', `选择中包含草稿里不存在的建议 ${id}。`, 400, {
          unknownPageId: id,
          knownPageIds: draft.pages.map((page) => page.pageId),
        });
      }
    }
    const raw = await this.deps.rawStore.get(draft.rawId);
    assertRawNotMeeting(raw);
    const prior = (await this.list()).filter((manifest) => manifest.draftId === draft!.id && !manifest.supersededBy);
    const priorKey = prior.find((manifest) => manifest.idempotencyKey === input.idempotencyKey);
    prior.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let existing =
      priorKey ??
      prior.find(
        (manifest) =>
          manifest.status !== 'completed' ||
          JSON.stringify([...manifest.snapshot.selectedPageIds].sort()) === JSON.stringify([...requested].sort()),
      );
    if (
      !priorKey &&
      draft.maintenance &&
      existing?.status === 'completed' &&
      requested.every((id) =>
        draft!.maintenance!.changes.some((c) => !c.committedOperationId && draft!.pages[c.pageIndex]?.pageId === id),
      )
    )
      existing = undefined;
    if (draft.pdfInput && raw && hasEditedPdfBody(raw) && existing?.status !== 'completed') {
      throw new CommitError('RAW_CHANGED', 'PDF 提取文字已由人工修改，旧页整理草稿不能继续入库。', 409);
    }
    if (
      existing &&
      existing.status !== 'completed' &&
      !existing.humanReviewDigest &&
      !existing.snapshot.outcomeReview
    ) {
      const onDisk = await verifiedCommitTargets(this.deps, existing);
      if (!onDisk.length) {
        if (draft.status === 'committing')
          await this.deps.drafts.resetToPending(draft.id, '旧零写入事务等待逐页人工审查');
        const editable = (await this.deps.drafts.get(draft.id))!;
        if (input.baseRevision !== editable.revision)
          throw new CommitError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新。', 409);
        if (outcomeReview)
          await this.deps.drafts.assertRawOutcome(editable, raw?.body ?? '', requested, outcomeReview.digest);
        else await this.deps.drafts.assertReviewed(editable, raw?.body ?? '');
        existing.supersededBy = input.operationId;
        existing.awaitingHumanReview = true;
        await writeJsonAtomic(this.fileFor(existing.operationId), existing);
        existing = undefined;
        draft = editable;
        // The old immutable snapshot remains on disk; a new reviewed operation supersedes it.
      }
    }
    if (existing) {
      // F04-04: the retry semantics are defined by the frozen payload, not by the key: the same
      // payload reuses the original operation (any key), a different payload is rejected.
      const candidatePages = draft.pages.filter((page) => requested.includes(page.pageId));
      const candidateDigest =
        raw && !existing.snapshot.outcomeReview && !outcomeReview
          ? buildPayloadDigest(
              draft,
              candidatePages,
              existing.snapshot.reuseSourceTitle ?? draft.source.title,
              existing.snapshot.reuseSourceId,
            )
          : undefined;
      const savedOutcome = existing.snapshot.outcomeReview;
      const samePayload = savedOutcome
        ? outcomeReview?.digest === savedOutcome.digest &&
          input.baseRevision === existing.snapshot.capturedRevision &&
          existing.snapshot.selectedPageIds.length === requested.length &&
          existing.snapshot.selectedPageIds.every((id) => requested.includes(id))
        : !outcomeReview &&
          Boolean(existing.payloadDigest) &&
          candidateDigest === existing.payloadDigest &&
          existing.snapshot.selectedPageIds.length === requested.length &&
          (!existing.snapshot.deepNote ||
            existing.snapshot.deepNote.reviewDigest === this.deps.drafts.contentDigest(draft));
      if (!samePayload) {
        throw new CommitError(
          existing.idempotencyKey === input.idempotencyKey ? 'IDEMPOTENCY_KEY_MISMATCH' : 'CONFIRM_PAYLOAD_CHANGED',
          '这份草稿已按另一份确认内容提交过；请刷新后查看既有提交状态，不要重复确认不同的选择或内容。',
          409,
          {
            operationId: existing.operationId,
            status: existing.status,
            storedSelectedPageIds: existing.snapshot.selectedPageIds,
            requestedSelectedPageIds: requested,
          },
        );
      }
      if (existing.status === 'completed')
        return { manifest: existing, reused: true, sourceReused: Boolean(existing.snapshot.reuseSourceId) };
      const resumed = await executeCommitManifest(this.deps, this.queue, existing);
      return { manifest: resumed, reused: true, sourceReused: Boolean(resumed.snapshot.reuseSourceId) };
    }
    if (draft.status === 'committing' || draft.status === 'confirmed') {
      if (draft.status === 'confirmed' && !draft.maintenance?.changes.some((change) => !change.committedOperationId)) {
        const completed = prior.find((manifest) => manifest.status === 'completed' && manifest.payloadDigest);
        if (completed) {
          throw new CommitError(
            'CONFIRM_PAYLOAD_CHANGED',
            '这份草稿已按另一份确认内容提交过；请刷新后查看既有提交状态，不要重复确认不同的选择或内容。',
            409,
            {
              operationId: completed.operationId,
              status: completed.status,
              storedSelectedPageIds: completed.snapshot.selectedPageIds,
              requestedSelectedPageIds: requested,
            },
          );
        }
      }
      throw new CommitError('DRAFT_ALREADY_COMMITTED', '这份草稿已经进入提交状态，请刷新后查看提交状态。', 409, {
        status: draft.status,
        operationId: draft.commitOperationId,
      });
    }
    if (draft.status !== 'pending_confirmation')
      throw new CommitError('DRAFT_NOT_CONFIRMABLE', `草稿状态为 ${draft.status}，不能确认写入。`, 409);
    if (input.baseRevision !== draft.revision) {
      throw new CommitError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅再确认。', 409, {
        currentRevision: draft.revision,
      });
    }
    if (draft.deferredAt) throw new CommitError('DRAFT_DEFERRED', '请先继续处理这份草稿，再确认入库。', 409);
    if (!raw) throw new CommitError('RAW_MISSING', '对应的原始资料不存在（可能已被删除），不能确认写入。', 409);
    if (raw.bodySha256 !== draft.rawSha256)
      throw new CommitError('RAW_CHANGED', '原始正文的校验值与整理时不一致，已停止写入以避免产生坏来源。', 409);
    if (draft.pdfInput && !outcomeReview)
      throw new CommitError('PDF_OUTCOME_REQUIRED', '请先查看并确认 PDF 整理成果。', 409);
    if (outcomeReview) await this.deps.drafts.assertRawOutcome(draft, raw.body, requested, outcomeReview.digest);
    const humanReviewDigest = outcomeReview ? undefined : await this.deps.drafts.assertReviewed(draft, raw.body);
    if (
      !outcomeReview &&
      !draft.maintenance &&
      draft.structuredNote &&
      JSON.stringify(
        draft.pages
          .filter((p) => p.selected)
          .map((p) => p.pageId)
          .sort(),
      ) !== JSON.stringify([...requested].sort())
    )
      throw new CommitError('REVIEW_SELECTION_CHANGED', '请先保存当前选卡，再重新审核笔记。', 409);

    const selectedIds = requested;
    const selectedPages = draft.pages.filter((page) => selectedIds.includes(page.pageId));
    for (const page of selectedPages)
      if (
        !draft.maintenance &&
        (page.reviewDecision === 'update' || (!outcomeReview && page.reviewDecision === 'defer'))
      ) {
        throw new CommitError(
          'DECISION_MISMATCH',
          `「${page.title}」已保存为${page.reviewDecision === 'update' ? '更新已有页' : '暂不处理'}，不能作为新建页提交。`,
          409,
          { pageId: page.pageId, decision: page.reviewDecision },
        );
      }
    if (!outcomeReview) await this.deps.drafts.assertEvidenceStillValid(draft, raw.body);

    let outcomeChanges: KnowledgeChange[] | undefined;
    if (outcomeReview && draft.maintenance) {
      const changes = draft.maintenance.changes;
      outcomeChanges = changes.filter(
        (change) => !change.committedOperationId && requested.includes(draft!.pages[change.pageIndex]?.pageId),
      );
      if (!outcomeChanges.length && (requested.length || !draft.structuredNote))
        throw new CommitError('NO_SELECTION', '请至少选择一项未提交的知识变更。', 409);
      if (
        outcomeChanges.length !== requested.length ||
        !requested.every((id) => outcomeChanges!.some((change) => draft!.pages[change.pageIndex].pageId === id))
      ) {
        throw new CommitError('REVIEW_SELECTION_CHANGED', '选集中包含无对应变更或已经提交的成果，请刷新后重选。', 409);
      }
      if (
        outcomeChanges.some((change) =>
          change.dependsOn.some(
            (id) =>
              !changes.some(
                (other) => other.changeId === id && (other.committedOperationId || outcomeChanges!.includes(other)),
              ),
          ),
        )
      ) {
        throw new CommitError(
          'CHANGE_DEPENDENCY_REQUIRED',
          '有选中成果依赖其他变更，请一并选择依赖项，或取消选中该成果。',
          409,
        );
      }
    }

    const warnings: string[] = [];
    const noChanges = !!outcomeChanges?.length && outcomeChanges.every((c) => c.action === 'noop');
    const conflict = noChanges
      ? {}
      : draft.maintenance
        ? await maintenanceSource(this.deps, draft)
        : await checkConflicts(this.deps, draft, selectedPages);
    for (const page of draft.maintenance ? [] : selectedPages) {
      const candidates = findDuplicateCandidates(
        {
          title: page.title,
          category: page.category,
          tags: raw.tags ?? [],
          content: [page.one_line_definition, ...page.source_facts.map((item) => item.text), ...page.ai_organized].join(
            '\n',
          ),
        },
        await this.deps.wikiStore.allRecords(),
      );
      if (candidates.some((item) => item.score >= 0.35) && page.reviewDecision !== 'create') {
        throw new CommitError(
          'DUPLICATE_DECISION_REQUIRED',
          `「${page.title}」有可能重复的 Wiki 候选，请先查看候选并明确选择更新、新建或暂不处理。`,
          409,
          {
            pageId: page.pageId,
            candidates: candidates
              .filter((item) => item.score >= 0.35)
              .map((item) => ({ id: item.wiki.id, title: item.wiki.title, score: item.score })),
          },
        );
      }
    }
    const reuseSourceTitle = conflict.reuseSourceTitle;
    const knownWikiTitles =
      outcomeReview && draft.source.bodyEditedByUser
        ? new Set(
            (await this.deps.wikiStore.allRecords()).flatMap((page) =>
              [page.title, ...page.aliases].map(normalizeCommitTitle),
            ),
          )
        : undefined;
    if (conflict.reuseSourceId && reuseSourceTitle) {
      const existingSource = await this.deps.wikiStore.get(conflict.reuseSourceId);
      if (existingSource) {
        const changed =
          normalizeCommitTitle(existingSource.title) !== normalizeCommitTitle(draft.source.title) ||
          existingSource.body.trim() !== sourceBodyFor(draft, selectedPages, !!outcomeReview, knownWikiTitles).trim();
        if (changed) {
          warnings.push(
            `已复用既有 Source「${existingSource.title}」（${existingSource.id}）：本批不修改既有页面，你在草稿里对 Source 的修改不会写入。`,
          );
        }
      }
    }
    // F04-05: an explicitly edited Source body may still point at pages that are not created now.
    if (draft.source.bodyEditedByUser) {
      const created = new Set([...selectedPages.map((page) => page.title), reuseSourceTitle ?? draft.source.title]);
      const body = outcomeReview ? sourceBodyFor(draft, selectedPages, true, knownWikiTitles) : draft.source.body;
      const linked = [...body.matchAll(/\[\[([^\]]+)\]\]/gu)].map((match) => match[1].trim());
      const dangling = [
        ...new Set(linked.filter((title) => !created.has(title) && !knownWikiTitles?.has(normalizeCommitTitle(title)))),
      ];
      if (dangling.length)
        warnings.push(
          `人工编辑的 Source 正文包含本次不会创建的链接：${dangling.join('、')}；它们会成为未解析链接，请确认是否符合预期。`,
        );
    }
    const effectivePages = draft.maintenance
      ? selectedPages.flatMap((p) => {
          const c = draft.maintenance!.changes.find((c) => draft.pages[c.pageIndex].pageId === p.pageId)!;
          return outcomeReview && c.action === 'noop' ? [] : [{ ...p, title: c.candidate.title }];
        })
      : selectedPages;
    const snapshot = freezeCommitSnapshot(
      this.deps,
      draft,
      effectivePages,
      raw,
      conflict.reuseSourceId,
      reuseSourceTitle,
      warnings,
      input.now,
      outcomeReview,
      knownWikiTitles,
    );
    if (outcomeReview && draft.maintenance) snapshot.selectedPageIds = requested;
    if (noChanges) delete snapshot.sourceRecord;
    if (draft.maintenance)
      await freezeMaintenanceSnapshot(this.deps, snapshot, draft, selectedPages, input.now, outcomeChanges);
    const manifest: KnowledgeCommitManifest = {
      ...(!outcomeReview ? { humanReviewDigest, humanReviewBasisDigest: draft.humanReview!.basisDigest } : {}),
      operationId: input.operationId,
      draftId: draft.id,
      idempotencyKey: input.idempotencyKey,
      rawId: draft.rawId,
      rawSha256: draft.rawSha256,
      rawTitle: draft.rawTitle,
      payloadDigest: outcomeReview
        ? commitSha256(
            JSON.stringify({
              digest: outcomeReview.digest,
              revision: input.baseRevision,
              selectedPageIds: [...requested].sort(),
            }),
          )
        : buildPayloadDigest(draft, selectedPages, reuseSourceTitle ?? draft.source.title, conflict.reuseSourceId),
      status: 'prepared',
      createdAt: input.now,
      updatedAt: input.now,
      provider: draft.provider,
      snapshot,
      phases: [
        { name: 'source', status: 'pending' },
        { name: 'pages', status: 'pending' },
        { name: 'index', status: 'pending' },
        { name: 'log', status: 'pending' },
        { name: 'state', status: 'pending' },
      ],
      writtenWikiIds: [],
    };
    // The frozen manifest must be durable before any formal write happens.
    try {
      await this.deps.drafts.prepareReviewedCommit(
        draft.id,
        draft.revision,
        (outcomeReview?.digest ?? humanReviewDigest)!,
        raw.body,
        manifest.operationId,
        () => writeJsonAtomic(this.fileFor(manifest.operationId), manifest),
        outcomeReview ? requested : undefined,
      );
    } catch (error) {
      if ((error as { status?: number }).status === 409) throw error;
      // Nothing formal was written yet; report the real cause and the (empty) commit facts so the
      // user can retry instead of guessing whether anything happened.
      const fsCode = (error as { code?: unknown }).code;
      throw new CommitError(
        'COMMIT_MANIFEST_WRITE_FAILED',
        `提交清单无法写入（${String(fsCode ?? '未知错误')}）：${error instanceof Error ? error.message : '未知错误'}`,
        500,
        {
          operationId: manifest.operationId,
          committed: false,
          recoverable: false,
          writtenWikiIds: [],
          phases: manifest.phases,
          cause: typeof fsCode === 'string' ? fsCode : null,
        },
      );
    }
    const executed = await executeCommitManifest(this.deps, this.queue, manifest);
    return { manifest: executed, reused: false, sourceReused: Boolean(executed.snapshot.reuseSourceId) };
  }

  private async confirmQuestion(
    draft: QuestionDraftRecord,
    input: {
      baseRevision: number;
      selectedPageIds: string[];
      idempotencyKey: string;
      operationId: string;
      now: string;
    },
  ): Promise<{ manifest: KnowledgeCommitManifest; reused: boolean; sourceReused: boolean }> {
    const requested = [...new Set(input.selectedPageIds)];
    if (!requested.length || requested.some((id) => !draft.pages.some((p) => p.pageId === id)))
      throw new CommitError('UNKNOWN_PAGE', '请选择真实的问答维护项。');
    const payloadDigest = commitSha256(
      JSON.stringify({
        input: draft.input,
        selection: requested.sort(),
        digest: maintenanceDigest(reviewProjection(draft, requested)),
      }),
    );
    const all = (await this.list()).filter((m) => m.draftId === draft.id && !m.supersededBy),
      prior =
        all.find((m) => m.idempotencyKey === input.idempotencyKey) ??
        all.find(
          (m) =>
            m.status !== 'completed' ||
            JSON.stringify([...m.snapshot.selectedPageIds].sort()) === JSON.stringify([...requested].sort()),
        );
    if (prior) {
      await verifyEvidenceInput(
        draft.input,
        this.deps.wikiStore,
        this.deps.rawStore as RawStore,
        prior.snapshot.pageRecords,
      );
      if (prior.payloadDigest !== payloadDigest)
        throw new CommitError(
          prior.idempotencyKey === input.idempotencyKey ? 'IDEMPOTENCY_KEY_MISMATCH' : 'CONFIRM_PAYLOAD_CHANGED',
          '此问答草稿已按另一内容提交。',
          409,
        );
      return {
        manifest: prior.status === 'completed' ? prior : await executeCommitManifest(this.deps, this.queue, prior),
        reused: true,
        sourceReused: false,
      };
    }
    await verifyEvidenceInput(draft.input, this.deps.wikiStore, this.deps.rawStore as RawStore);
    if (draft.status !== 'pending_confirmation' || draft.revision !== input.baseRevision)
      throw new CommitError('DRAFT_REVISION_CONFLICT', '草稿已变化或已提交，请刷新。', 409);
    const digest = await this.deps.drafts.assertReviewed(draft, ''),
      snapshot: CommitSnapshot = {
        capturedRevision: draft.revision,
        document: draft.document,
        selectedPageIds: requested,
        pageRecords: [],
        digests: {},
        warnings: [],
      };
    await freezeMaintenanceSnapshot(
      this.deps,
      snapshot,
      draft,
      draft.pages.filter((p) => requested.includes(p.pageId)),
      input.now,
    );
    const manifest: QuestionCommitManifest = {
      ...(draft.input.kind === 'inspection'
        ? { inspectionInput: structuredClone(draft.input) }
        : { questionInput: structuredClone(draft.input) }),
      operationId: input.operationId,
      draftId: draft.id,
      idempotencyKey: input.idempotencyKey,
      payloadDigest,
      humanReviewDigest: digest,
      humanReviewBasisDigest: draft.humanReview!.basisDigest,
      status: 'prepared',
      createdAt: input.now,
      updatedAt: input.now,
      provider: draft.provider,
      snapshot,
      phases: ['source', 'pages', 'index', 'log', 'state'].map((name) => ({
        name: name as CommitPhaseName,
        status: 'pending',
      })),
      writtenWikiIds: [],
    };
    await this.deps.drafts.prepareReviewedCommit(draft.id, draft.revision, digest, '', manifest.operationId, () =>
      writeJsonAtomic(this.fileFor(manifest.operationId), manifest),
    );
    return {
      manifest: await executeCommitManifest(this.deps, this.queue, manifest),
      reused: false,
      sourceReused: false,
    };
  }

  /** Startup recovery: finish every manifest the user already confirmed. */
  async reconcile() {
    return reconcileCommitManifests(this.deps, this.queue, () => this.list());
  }
}
