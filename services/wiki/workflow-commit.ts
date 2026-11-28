import { randomUUID } from 'node:crypto';
import { renderInputTemplateFields } from './template-fields.ts';
import path from 'node:path';
import { isWorkflowManifest } from '../storage/record-validators.ts';
import { scanJsonRecords, writeJsonAtomic } from '../storage/files.ts';
import { RawIntegrityError, type RawStore } from '../raw/store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { WikiError, type WikiRecord } from './store.ts';
import { DraftStore } from './drafts.ts';
import { type KnowledgeWorkflow, type WorkflowManifest, type WorkflowContext, sha } from './workflow-types.ts';
import { validateForConfirm, actualRawSha, getRawSnapshot } from './workflow-evidence.ts';
import { assertReviewed } from './workflow-review.ts';

export async function confirm(ctx: WorkflowContext, id: string, baseRevision: number, idempotencyKey: string) {
  return ctx.queue.run(async () => {
    const record = await ctx.get(id);
    return record?.inputDraft
      ? new DraftStore(ctx.root).withReviewLock(() => confirmLocked(ctx, id, baseRevision, idempotencyKey))
      : confirmLocked(ctx, id, baseRevision, idempotencyKey);
  });
}

export async function confirmLocked(ctx: WorkflowContext, id: string, baseRevision: number, idempotencyKey: string) {
  const workflow = await ctx.get(id);
  if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
  const payloadDigest = sha(
    JSON.stringify({
      kind: workflow.kind,
      title: workflow.title,
      sections: workflow.sections,
      evidence: workflow.evidence,
      targetWikiId: workflow.targetWikiId,
      baseRevision: workflow.baseRevision,
      sources: workflow.sources,
      source_level: workflow.source_level,
      ...(workflow.inputTemplateFields ? { inputTemplateFields: workflow.inputTemplateFields } : {}),
    }),
  );
  let priorManifest = (
    await scanJsonRecords<WorkflowManifest>(
      ctx.operationsDir(),
      (v, file): v is WorkflowManifest => isWorkflowManifest(v, path.basename(file, '.json')),
      ctx.root,
    ).then((x) => x.records)
  )
    .map((item) => item.value)
    .find((item) => item.workflowId === workflow.id && !item.supersededBy);
  let superseded: WorkflowManifest | undefined;
  if (
    priorManifest &&
    priorManifest.status !== 'completed' &&
    !priorManifest.humanReviewDigest &&
    !(await verifiedTargets(ctx, priorManifest)).length
  ) {
    await assertReviewed(ctx, workflow);
    superseded = priorManifest;
    priorManifest = undefined;
  }
  if (priorManifest) {
    const old = await ctx.getCommit(priorManifest.operationId);
    if (!old || old.payloadDigest !== payloadDigest)
      throw new WikiError(
        'CONFIRM_PAYLOAD_CHANGED',
        '该草稿已有不同内容的确认提交；请查看原提交，不要重复确认。',
        409,
        { operationId: priorManifest.operationId },
      );
    if (old.status === 'conflict')
      throw new WikiError('WORKFLOW_COMMIT_CONFLICT', old.error ?? '提交因人工编辑冲突而停止。', 409, {
        operationId: old.operationId,
        writtenIds: old.writtenIds,
      });
    if (old.status === 'completed') {
      const finalized = await finalizeWorkflow(ctx, old);
      return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: true };
    }
    const finished = await execute(ctx, old);
    if (finished.status !== 'completed')
      throw new WikiError('WORKFLOW_COMMIT_PENDING', '原提交尚未完成，请查看提交状态。', 500, {
        operationId: finished.operationId,
        writtenIds: finished.writtenIds,
      });
    const finalized = await finalizeWorkflow(ctx, finished);
    return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: true };
  }
  if (workflow.status !== 'pending_confirmation')
    throw new WikiError('WORKFLOW_NOT_CONFIRMABLE', '知识草稿不在待确认状态。', 409);
  if (workflow.revision !== baseRevision)
    throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已过期，请刷新后重新审阅。', 409, {
      currentRevision: workflow.revision,
    });
  await validateForConfirm(ctx, workflow);
  const humanReviewDigest = await assertReviewed(ctx, workflow);
  if (workflow.kind === 'update' && workflow.targetWikiId) {
    const target = await ctx.wiki.get(workflow.targetWikiId);
    if (!target) throw new WikiError('NOT_FOUND', '更新目标已不存在。', 404);
    for (const sourceId of target.sources) assertRawNotMeeting(await ctx.raws.get(sourceId));
  }
  if (!idempotencyKey?.trim()) throw new WikiError('IDEMPOTENCY_KEY_REQUIRED', '确认请求缺少幂等键。');
  for (const snapshot of workflow.rawSnapshots) {
    const raw = await getRawSnapshot(ctx, snapshot.id);
    if (!raw || actualRawSha(raw) !== snapshot.bodySha256 || raw.bodySha256 !== snapshot.bodySha256)
      throw new WikiError('RAW_CHANGED', `来源 ${snapshot.id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
  }
  let records: WikiRecord[] = [];
  let updateTargetId: string | undefined;
  let targetBaseRevision: number | undefined;
  if (workflow.kind === 'update') {
    const current = await ctx.wiki.get(workflow.targetWikiId!);
    if (!current) throw new WikiError('NOT_FOUND', '更新目标已不存在。', 404);
    if (current.revision !== workflow.baseRevision)
      throw new WikiError('REVISION_CONFLICT', '目标 Wiki 已被修改，旧预览不能覆盖新版本。', 409, {
        currentRevision: current.revision,
      });
    const evidenceLines = (section: string, edited: string[]) =>
      edited.map((text, i) => {
        if (workflow.humanEditedSections?.includes(section)) return `- 人工整理：${text}`;
        const item = (workflow.evidence ?? []).filter((value) => value.section === section)[i];
        return item
          ? `- ${text}（来源 Raw ${item.rawId}，原文 [${item.start}, ${item.end})：“${item.quote}”）`
          : `- ${text}（用户整理）`;
      });
    const body = [
      current.body,
      ...(workflow.inputTemplateFields ? [renderInputTemplateFields(workflow.inputTemplateFields)] : []),
      '## 本次更新审核',
      '### 一致观点',
      ...evidenceLines('agreement', workflow.sections.agreement),
      '### 建议增加',
      ...evidenceLines('suggestedAdditions', workflow.sections.suggestedAdditions),
      '### 来源冲突（均保留）',
      ...evidenceLines('conflicts', workflow.sections.conflicts),
      '### AI 推断',
      ...workflow.sections.inferences.map((x) => `- ${x}`),
      '### 待确认问题',
      ...workflow.sections.openQuestions.map((x) => `- ${x}`),
      `来源：${workflow.sections.sourceList.map((x) => `[${x.title}](${x.id})`).join('、')}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const title = workflow.title.trim();
    const normalizeTitle = (value: string) =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s\p{P}\p{S}]+/gu, '');
    const titleKey = normalizeTitle(title);
    const collision = (await ctx.wiki.allRecords()).find(
      (item) =>
        item.id !== current.id && [item.title, ...item.aliases].some((value) => normalizeTitle(value) === titleKey),
    );
    if (collision)
      throw new WikiError('WIKI_TITLE_CONFLICT', `标题「${title}」已被「${collision.title}」占用。`, 409, {
        existingId: collision.id,
      });
    const aliases = [...current.aliases];
    if (
      normalizeTitle(current.title) !== titleKey &&
      !aliases.some((value) => normalizeTitle(value) === normalizeTitle(current.title))
    )
      aliases.push(current.title);
    records = [
      {
        ...current,
        title,
        aliases,
        sources: [...new Set([...current.sources, ...workflow.sources])],
        body,
        updated: new Date().toISOString(),
        revision: current.revision + 1,
      },
    ];
    const sourceExists = (await ctx.wiki.allRecords()).some(
      (item) => item.type === 'source' && item.sources.length === 1 && item.sources[0] === workflow.rawSnapshots[0].id,
    );
    if (!sourceExists) {
      const raw = await getRawSnapshot(ctx, workflow.rawSnapshots[0].id);
      if (!raw) throw new WikiError('RAW_MISSING', '更新来源 Raw 不存在。', 409);
      const now = new Date().toISOString();
      records.unshift({
        id: randomUUID(),
        title: raw.title,
        type: 'source',
        domain: 'fmcg',
        category: current.category,
        created: now,
        updated: now,
        sources: [raw.id],
        tags: raw.tags,
        knowledge_status: 'source_supported',
        confidence: 'medium',
        source_level: workflow.sections.sourceList.find((source) => source.id === raw.id)?.source_level ?? 'D',
        review_status: 'unreviewed',
        aliases: [],
        revision: 1,
        body: `来源 Raw：${raw.id}\n\n${raw.title}\n\n${raw.body.slice(0, 1200)}`,
      });
    }
    updateTargetId = current.id;
    targetBaseRevision = current.revision;
  } else {
    const all = await ctx.wiki.allRecords();
    const now = new Date().toISOString();
    for (const rawId of workflow.sources) {
      const existingSource = all.find(
        (item) => item.type === 'source' && item.sources.length === 1 && item.sources[0] === rawId,
      );
      if (existingSource) continue;
      const raw = await getRawSnapshot(ctx, rawId);
      if (!raw) throw new WikiError('RAW_MISSING', `来源 Raw ${rawId} 不存在。`, 409);
      records.push({
        id: randomUUID(),
        title: raw.title,
        type: 'source',
        domain: 'fmcg',
        category: workflow.category,
        created: now,
        updated: now,
        sources: [rawId],
        tags: raw.tags,
        knowledge_status: 'source_supported',
        confidence: 'medium',
        source_level: workflow.sections.sourceList.find((source) => source.id === rawId)?.source_level ?? 'D',
        review_status: 'unreviewed',
        aliases: [],
        revision: 1,
        body: `来源 Raw：${rawId}\n\n${raw.title}\n\n${raw.body.slice(0, 1200)}`,
      });
    }
    const cited = (section: string, edited: string[]) =>
      edited.map((text, i) => {
        if (workflow.humanEditedSections?.includes(section)) return `- 人工整理：${text}`;
        const item = (workflow.evidence ?? []).filter((value) => value.section === section)[i];
        return item
          ? `- ${text}（来源 Raw ${item.rawId}，原文 [${item.start}, ${item.end})：“${item.quote}”）`
          : `- ${text}（用户整理）`;
      });
    const body = [
      '## 主要来源',
      ...workflow.sections.sourceList.map((x) => `- ${x.title}（Raw ${x.id}）`),
      '## 一致观点',
      ...cited('agreement', workflow.sections.agreement),
      '## 冲突',
      ...cited('conflicts', workflow.sections.conflicts),
      '## AI 推断',
      ...workflow.sections.inferences.map((x) => `- ${x}`),
      '## 待确认问题',
      ...workflow.sections.openQuestions.map((x) => `- ${x}`),
      '## 综合整理',
      ...cited('suggestedAdditions', workflow.sections.suggestedAdditions),
    ].join('\n');
    records.push({
      id: randomUUID(),
      title: workflow.title,
      type: 'synthesis',
      domain: 'fmcg',
      category: workflow.category,
      created: now,
      updated: now,
      sources: workflow.sources,
      tags: [],
      knowledge_status: 'ai_organized',
      confidence: 'medium',
      source_level: workflow.source_level ?? 'D',
      review_status: 'unreviewed',
      aliases: [],
      revision: 1,
      body,
    });
  }
  const operationId = randomUUID();
  let manifest: WorkflowManifest = {
    humanReviewDigest,
    humanReviewBasisDigest: workflow.humanReview!.basisDigest,
    operationId,
    workflowId: id,
    idempotencyKey,
    payloadDigest,
    status: 'prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    records,
    updateTargetId,
    targetBaseRevision,
    rawSnapshots: workflow.rawSnapshots,
    writtenIds: [],
  };
  await writeJsonAtomic(ctx.operationFile(operationId), manifest);
  if (superseded) {
    superseded.supersededBy = operationId;
    superseded.awaitingHumanReview = true;
    await writeJsonAtomic(ctx.operationFile(superseded.operationId), superseded);
  }
  try {
    manifest = await execute(ctx, manifest);
  } catch (error) {
    manifest.status = 'committing';
    manifest.error = error instanceof Error ? error.message : '磁盘提交失败';
    manifest.updatedAt = new Date().toISOString();
    await writeJsonAtomic(ctx.operationFile(operationId), manifest).catch(() => undefined);
    throw new WikiError(
      'WORKFLOW_COMMIT_PENDING',
      `提交操作 ${operationId} 遇到磁盘错误；已写入 ${manifest.writtenIds.length} 个页面，恢复清单已保留。请查看提交状态，不要重试创建。`,
      500,
      { operationId, writtenIds: manifest.writtenIds, recoverable: true },
    );
  }
  if (manifest.status === 'conflict') {
    const conflicted = await finalizeWorkflow(ctx, manifest);
    throw new WikiError('WORKFLOW_COMMIT_CONFLICT', conflicted.lastCommitError ?? '提交因人工编辑冲突而停止。', 409, {
      operationId,
      writtenIds: manifest.writtenIds,
    });
  }
  if (manifest.status !== 'completed')
    throw new WikiError(
      'WORKFLOW_COMMIT_PENDING',
      '部分知识文件已写入，提交清单已保留并会在重启时继续；请查看提交状态，不要重复确认。',
      500,
      { operationId, writtenIds: manifest.writtenIds },
    );
  const finalized = await finalizeWorkflow(ctx, manifest);
  return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: false };
}

export async function execute(ctx: WorkflowContext, input: WorkflowManifest): Promise<WorkflowManifest> {
  let manifest = input;
  if (manifest.supersededBy) throw new WikiError('HUMAN_REVIEW_SUPERSEDED', '旧事务已由重新审查替代。', 409);
  const actual = await verifiedTargets(ctx, manifest);
  if (!manifest.humanReviewDigest) {
    if (!actual.length) {
      manifest.awaitingHumanReview = true;
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      throw new WikiError('HUMAN_REVIEW_REQUIRED', '旧零写入事务等待人工逐页审查。', 409);
    }
    manifest.legacyRecovery = 'verified_partial';
  } else {
    const record = await ctx.get(manifest.workflowId);
    if (
      !record ||
      (await assertReviewed(ctx, record)) !== manifest.humanReviewDigest ||
      record.humanReview?.basisDigest !== manifest.humanReviewBasisDigest
    )
      throw new WikiError('REVIEW_CONTENT_CHANGED', '工作流审查快照已变化。', 409);
  }
  manifest.status = 'committing';
  manifest.updatedAt = new Date().toISOString();
  await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
  for (const snapshot of manifest.rawSnapshots) {
    let raw: Awaited<ReturnType<RawStore['get']>>;
    try {
      raw = await ctx.raws.get(snapshot.id);
    } catch (error) {
      if (!(error instanceof RawIntegrityError)) throw error;
      raw = undefined;
    }
    if (!raw) {
      manifest.status = 'conflict';
      manifest.error = `Raw ${snapshot.id} 缺失或不可读取，已停止恢复。`;
      manifest.updatedAt = new Date().toISOString();
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
    try {
      assertRawNotMeeting(raw);
    } catch {
      manifest.status = 'conflict';
      manifest.error = `Raw ${snapshot.id} 缺失、损坏或受限，已停止恢复。`;
      manifest.updatedAt = new Date().toISOString();
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
    if (raw.bodySha256 !== snapshot.bodySha256 || actualRawSha(raw) !== snapshot.bodySha256) {
      manifest.status = 'conflict';
      manifest.error = `Raw ${snapshot.id} 在提交恢复期间变化或frontmatter哈希与实际正文不符，已停止恢复。`;
      manifest.updatedAt = new Date().toISOString();
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
  }
  if (manifest.updateTargetId) {
    const target = await ctx.wiki.get(manifest.updateTargetId);
    if (!target) {
      manifest.status = 'conflict';
      manifest.error = '更新目标缺失，已停止恢复。';
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
    try {
      for (const sourceId of target.sources) assertRawNotMeeting(await ctx.raws.get(sourceId));
    } catch {
      manifest.status = 'conflict';
      manifest.error = '更新目标含缺失、损坏或受限来源，已停止恢复。';
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
  }
  for (const record of manifest.records) {
    const current = await ctx.wiki.get(record.id);
    if (manifest.updateTargetId === record.id) {
      if (
        current &&
        current.revision === record.revision &&
        ctx.wiki.pageContent(current) === ctx.wiki.pageContent(record)
      ) {
        if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id);
        continue;
      }
      if ((current?.revision ?? 0) !== manifest.targetBaseRevision) {
        manifest.status = 'conflict';
        manifest.error = '目标页面已出现新版本，恢复已停止以保护人工编辑。';
        await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
        return manifest;
      }
    } else if (current) {
      if (ctx.wiki.pageContent(current) === ctx.wiki.pageContent(record)) {
        if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id);
        continue;
      }
      manifest.status = 'conflict';
      manifest.error = `稳定ID ${record.id} 已存在不同内容。`;
      await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
      return manifest;
    }
    await ctx.wiki.writePageLocked(record);
    if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id);
    manifest.updatedAt = new Date().toISOString();
    await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
  }
  await ctx.wiki.rebuildIndexLocked();
  await ctx.wiki.appendLogLocked(
    manifest.records.map((record) => ({
      operationId: manifest.operationId,
      action: manifest.updateTargetId === record.id ? ('update' as const) : ('create' as const),
      id: record.id,
      title: record.title,
      type: record.type,
      revision: record.revision,
    })),
  );
  manifest.status = 'completed';
  manifest.updatedAt = new Date().toISOString();
  await writeJsonAtomic(ctx.operationFile(manifest.operationId), manifest);
  return manifest;
}

export async function reconcile(ctx: WorkflowContext) {
  const files = (
    await scanJsonRecords<WorkflowManifest>(
      ctx.operationsDir(),
      (v, file): v is WorkflowManifest => isWorkflowManifest(v, path.basename(file, '.json')),
      ctx.root,
    )
  ).records;
  for (const item of files.map((x) => x.value).filter((value): value is WorkflowManifest => Boolean(value))) {
    let manifest = item;
    if (['prepared', 'committing'].includes(item.status) && !item.supersededBy)
      manifest = await ctx.wiki
        .withLock(() =>
          ctx.queue.run(async () => {
            const record = await ctx.get(item.workflowId);
            return record?.inputDraft
              ? new DraftStore(ctx.root).withReviewLock(() => execute(ctx, item))
              : execute(ctx, item);
          }),
        )
        .catch(() => item);
    if (manifest.status === 'completed' || manifest.status === 'conflict')
      await finalizeWorkflow(ctx, manifest).catch(() => undefined);
  }
}

export async function verifiedTargets(ctx: WorkflowContext, manifest: WorkflowManifest): Promise<string[]> {
  const matched: string[] = [];
  for (const record of manifest.records) {
    const actual = await ctx.wiki.get(record.id);
    if (!actual) continue;
    if (ctx.wiki.pageContent(actual) === ctx.wiki.pageContent(record)) {
      matched.push(record.id);
      continue;
    }
    if (record.id === manifest.updateTargetId && actual.revision === manifest.targetBaseRevision) continue;
    throw new WikiError('COMMIT_TARGET_CONFLICT', '已有目标与冻结事务冲突，停止恢复。', 409, { wikiId: record.id });
  }
  return matched;
}

export async function finalizeWorkflow(ctx: WorkflowContext, manifest: WorkflowManifest): Promise<KnowledgeWorkflow> {
  const workflow = await ctx.get(manifest.workflowId);
  if (!workflow)
    throw new WikiError('WORKFLOW_NOT_FOUND', '提交清单对应的草稿文件缺失。', 500, {
      operationId: manifest.operationId,
    });
  if (manifest.status === 'completed') {
    if (workflow.status !== 'confirmed' || workflow.commitOperationId !== manifest.operationId) {
      workflow.status = 'confirmed';
      workflow.commitOperationId = manifest.operationId;
      workflow.committedWikiId =
        manifest.records.find((record) => record.type === 'synthesis')?.id ?? manifest.updateTargetId;
      workflow.lastCommitError = undefined;
      workflow.revision++;
      workflow.updatedAt = new Date().toISOString();
      await ctx.save(workflow);
    }
  } else if (manifest.status === 'conflict') {
    if (
      workflow.status !== 'conflict' ||
      workflow.commitOperationId !== manifest.operationId ||
      workflow.lastCommitError !== manifest.error
    ) {
      workflow.status = 'conflict';
      workflow.commitOperationId = manifest.operationId;
      workflow.lastCommitError = manifest.error ?? '提交恢复遇到冲突。';
      workflow.revision++;
      workflow.updatedAt = new Date().toISOString();
      await ctx.save(workflow);
    }
  }
  return workflow;
}
