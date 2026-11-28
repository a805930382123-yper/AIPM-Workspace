import { RawIntegrityError } from '../raw/store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { buildEvidenceLocatorCatalog } from '../llm/locators.ts';
import { WikiError, type WikiRecord } from './store.ts';
import { type KnowledgeWorkflow, type WorkflowContext, sha } from './workflow-types.ts';

export function updateEvidenceDirectory(page: any, raw: { id: string; body: string }) {
  if (!Array.isArray(page.source_evidence) || !Array.isArray(page.source_facts) || !page.source_facts.length)
    throw new WikiError('EVIDENCE_INVALID', '选中建议缺少已验证来源事实或证据。', 409);
  const entries = page.source_evidence as Array<{
    id: string;
    rawId: string;
    quote: string;
    start: number;
    end: number;
  }>;
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      entry.id.length > 128 ||
      ids.has(entry.id) ||
      entry.rawId !== raw.id ||
      typeof entry.quote !== 'string' ||
      !entry.quote.length ||
      !Number.isSafeInteger(entry.start) ||
      !Number.isSafeInteger(entry.end) ||
      entry.start < 0 ||
      entry.end <= entry.start ||
      entry.end > raw.body.length ||
      raw.body.slice(entry.start, entry.end) !== entry.quote
    )
      throw new WikiError('EVIDENCE_INVALID', '选中建议证据的ID、Raw或原文位置无效。', 409);
    ids.add(entry.id);
  }
  const used = new Set<string>();
  for (const fact of page.source_facts) {
    if (
      !fact ||
      typeof fact.text !== 'string' ||
      !fact.text.trim() ||
      !Array.isArray(fact.evidenceIds) ||
      !fact.evidenceIds.length ||
      new Set(fact.evidenceIds).size !== fact.evidenceIds.length ||
      fact.evidenceIds.some((id: unknown) => typeof id !== 'string' || !ids.has(id))
    )
      throw new WikiError('EVIDENCE_INVALID', '选中建议事实引用未绑定其证据目录。', 409);
    fact.evidenceIds.forEach((id: string) => used.add(id));
  }
  if (used.size !== ids.size) throw new WikiError('EVIDENCE_INVALID', '选中建议证据目录包含未绑定事实的条目。', 409);
  return entries.map(({ id, rawId, quote, start, end }) => ({ id, rawId, quote, start, end }));
}

export async function assertUpdateTarget(ctx: WorkflowContext, target: WikiRecord) {
  const current = await ctx.wiki.get(target.id);
  if (
    !current ||
    current.revision !== target.revision ||
    ctx.wiki.pageContent(current) !== ctx.wiki.pageContent(target)
  )
    throw new WikiError('WIKI_REVISION_CONFLICT', '更新目标版本已变化，请刷新后重新生成预览。', 409);
}

export function updateExistingLocators(target: WikiRecord) {
  if (!target.body.length) return [];
  const binding = sha(JSON.stringify([target.id, target.revision, sha(target.body)]));
  return buildEvidenceLocatorCatalog(
    target.body,
    { index: 0, start: 0, end: target.body.length, text: target.body },
    { maxLocators: target.body.length },
  ).map(({ start, end, text }, index) => ({ id: `wiki-${binding}-${index + 1}`, start, end, text }));
}

export function validateEvidence(output: any, raws: Array<{ id: string; body: string }>) {
  const byId = new Map(raws.map((raw) => [raw.id, raw.body]));
  for (const key of ['suggestedAdditions', 'conflicts', 'agreement'])
    for (const item of output[key]) {
      const body = byId.get(item.rawId);
      if (!body || item.start < 0 || item.end <= item.start || body.slice(item.start, item.end) !== item.quote) {
        throw new WikiError('EVIDENCE_INVALID', `Provider 的 ${key} 引用无法在指定 Raw 原文中定位，未生成草稿。`, 502);
      }
    }
}

export async function validateForConfirm(ctx: WorkflowContext, workflow: KnowledgeWorkflow) {
  const schema = await ctx.wiki.schema();
  if (!workflow.title.trim() || workflow.title.length > 300 || /[\r\n]/u.test(workflow.title))
    throw new WikiError('INVALID_TITLE', '草稿标题不符合 Wiki Schema。');
  if (!schema.categories.some((item) => item.id === workflow.category))
    throw new WikiError('INVALID_CATEGORY', '草稿分类不符合 Wiki Schema。');
  for (const field of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const) {
    if (!Array.isArray(workflow.sections[field]) || workflow.sections[field].some((value) => typeof value !== 'string'))
      throw new WikiError('INVALID_WORKFLOW', `草稿字段 ${field} 必须为字符串列表。`);
  }
  const rawBodies = new Map<string, string>();
  for (const snapshot of workflow.rawSnapshots) {
    const raw = await getRawSnapshot(ctx, snapshot.id);
    if (!raw || raw.bodySha256 !== snapshot.bodySha256 || actualRawSha(raw) !== snapshot.bodySha256)
      throw new WikiError('RAW_CHANGED', `来源 ${snapshot.id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
    assertRawNotMeeting(raw);
    rawBodies.set(raw.id, raw.body);
  }
  for (const item of workflow.evidence ?? []) {
    const body = rawBodies.get(item.rawId);
    if (
      !body ||
      !Number.isInteger(item.start) ||
      !Number.isInteger(item.end) ||
      item.start < 0 ||
      item.end <= item.start ||
      body.slice(item.start, item.end) !== item.quote
    ) {
      throw new WikiError('EVIDENCE_INVALID', '草稿中包含无法定位的原文证据，未提交。', 409, {
        rawId: item.rawId,
        section: item.section,
      });
    }
  }
}

export function actualRawSha(raw: { body: string }) {
  return sha(raw.body);
}

export async function getRawSnapshot(ctx: WorkflowContext, id: string) {
  try {
    return await ctx.raws.get(id);
  } catch (error) {
    if (error instanceof RawIntegrityError)
      throw new WikiError('RAW_CHANGED', `来源 ${id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
    throw error;
  }
}
