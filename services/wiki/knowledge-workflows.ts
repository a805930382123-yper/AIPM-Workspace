import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { listJsonRecords, readJsonFile, writeJsonAtomic } from '../storage/files.ts';
import { RawIntegrityError, type RawStore } from '../raw/store.ts';
import { assertRawNotMeeting, assertRawsNotMeeting } from '../meeting/source-policy.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { WikiError, type WikiInput, type WikiRecord, type WikiStore } from './store.ts';

export type KnowledgeWorkflow = {
  id: string; kind: 'update' | 'synthesis'; status: 'pending_confirmation' | 'confirmed' | 'discarded' | 'conflict';
  revision: number; createdAt: string; updatedAt: string; provider: { name: string; model: string };
  rawSnapshots: Array<{ id: string; title: string; bodySha256: string }>;
  targetWikiId?: string; baseRevision?: number; baseWiki?: WikiRecord;
  inputDraft?: { draftId: string; pageId: string; revision: number };
  sections: {
    existing?: string; newSource?: string; suggestedAdditions: string[]; conflicts: string[];
    inferences: string[]; openQuestions: string[]; agreement: string[]; sourceList: Array<{ id: string; title: string }>;
  };
  title: string; category: string; sources: string[]; wikiInput?: WikiInput;
  commitOperationId?: string; committedWikiId?: string;
  evidence?: Array<{ section: string; text: string; rawId: string; quote: string; start: number; end: number }>;
  lastCommitError?: string;
};
type WorkflowManifest = { operationId: string; workflowId: string; idempotencyKey: string; payloadDigest: string; status: 'prepared' | 'committing' | 'completed' | 'conflict'; createdAt: string; updatedAt: string; records: WikiRecord[]; updateTargetId?: string; targetBaseRevision?: number; rawSnapshots: KnowledgeWorkflow['rawSnapshots']; writtenIds: string[]; error?: string };
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export class KnowledgeWorkflowStore {
  constructor(private readonly root: string, private readonly wiki: WikiStore, private readonly raws: RawStore) {}
  private dir() { return path.join(this.root, 'drafts', 'knowledge-workflows'); }
  private file(id: string) { return path.join(this.dir(), `${id}.json`); }
  async initialize() { await mkdir(this.dir(), { recursive: true }); await mkdir(this.operationsDir(), { recursive: true }); await this.reconcile(); }
  private operationsDir() { return path.join(this.root, 'state', 'knowledge-commits'); }
  private operationFile(id: string) { return path.join(this.operationsDir(), `${id}.json`); }
  async get(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined; return readJsonFile<KnowledgeWorkflow>(this.file(id)); }
  async getCommit(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined; return readJsonFile<WorkflowManifest>(this.operationFile(id)); }
  async list() { return (await listJsonRecords<KnowledgeWorkflow>(this.dir())).map(x => x.value).filter(Boolean); }
  async save(record: KnowledgeWorkflow) { await writeJsonAtomic(this.file(record.id), record); return record; }

  async createUpdate(args: { draftId: string; pageId: string; baseRevision: number; targetWikiId: string; draft: any; raw: any; target: WikiRecord; provider: LlmProvider }) {
    assertRawNotMeeting(args.raw);
    for (const id of args.target.sources) assertRawNotMeeting(await this.raws.get(id));
    if (args.draft.revision !== args.baseRevision) throw new WikiError('DRAFT_REVISION_CONFLICT', '提取草稿已变化，请刷新后重新选择更新。', 409, { currentRevision: args.draft.revision });
    if (!args.raw || this.actualRawSha(args.raw) !== args.raw.bodySha256 || args.raw.bodySha256 !== args.draft.rawSha256) throw new WikiError('RAW_CHANGED', '原文已变化或校验值与实际正文不一致，不能生成更新预览。', 409);
    const page = args.draft.pages.find((item: any) => item.pageId === args.pageId);
    if (!page) throw new WikiError('PAGE_NOT_FOUND', '提取草稿中没有这条建议。', 404);
    const user = JSON.stringify({ existing: { title: args.target.title, type: args.target.type, category: args.target.category, body: args.target.body, revision: args.target.revision, sources: args.target.sources }, newSource: { rawId: args.raw.id, rawTitle: args.raw.title, body: args.raw.body, facts: page.source_facts, evidence: page.source_evidence, organized: page.ai_organized, inferences: page.ai_inferences, questions: page.open_questions } });
    const output = await this.call(args.provider, '你是知识更新建议器。仅输出JSON。保留现有内容；逐条区分建议增加、来源冲突、推断、待确认问题。不得丢弃任何相反指标或来源。事实只能来自提供内容，不要编造。suggestedAdditions/conflicts/agreement每项必须为{text,rawId,quote,start,end}，quote必须是对应Raw的连续原文，start/end为UTF-16左闭右开全局索引。推断和问题是字符串数组。结构：{"suggestedAdditions":[object],"conflicts":[object],"inferences":[string],"openQuestions":[string],"agreement":[object]}', user);
    this.validateEvidence(output, [args.raw]);
    const record: KnowledgeWorkflow = {
      id: randomUUID(), kind: 'update', status: 'pending_confirmation', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      provider: { name: args.provider.name, model: args.provider.model }, rawSnapshots: [{ id: args.raw.id, title: args.raw.title, bodySha256: args.raw.bodySha256 }],
      targetWikiId: args.target.id, baseRevision: args.target.revision, baseWiki: args.target, inputDraft: { draftId: args.draftId, pageId: args.pageId, revision: args.draft.revision },
      sections: { existing: args.target.body, newSource: args.raw.body, suggestedAdditions: output.suggestedAdditions.map((x: any) => x.text), conflicts: output.conflicts.map((x: any) => x.text), inferences: output.inferences, openQuestions: output.openQuestions, agreement: output.agreement.map((x: any) => x.text), sourceList: [{ id: args.raw.id, title: args.raw.title }] },
      evidence: [...output.suggestedAdditions.map((x: any) => ({ section: 'suggestedAdditions', ...x })), ...output.conflicts.map((x: any) => ({ section: 'conflicts', ...x })), ...output.agreement.map((x: any) => ({ section: 'agreement', ...x }))],
      title: args.target.title, category: args.target.category, sources: [...new Set([...args.target.sources, args.raw.id])],
    };
    return this.save(record);
  }

  async createSynthesis(args: { rawIds: string[]; provider: LlmProvider }) {
    const ids = [...new Set(args.rawIds)];
    if (ids.length < 2) throw new WikiError('SYNTHESIS_REQUIRES_TWO_SOURCES', '综合至少需要两条不同 Raw 来源。');
    const raws = await Promise.all(ids.map(id => this.raws.get(id)));
    if (raws.some(raw => !raw)) throw new WikiError('INVALID_SOURCE', '所选来源中包含不存在的 Raw。', 404);
    const entries = raws as NonNullable<(typeof raws)[number]>[];
    assertRawsNotMeeting(entries);
    if (entries.some(raw => this.actualRawSha(raw) !== raw.bodySha256)) throw new WikiError('RAW_HASH_MISMATCH', '至少一条Raw的frontmatter校验值与实际正文不一致，未生成综合草稿。', 409);
    const input = entries.map(raw => ({ id: raw.id, title: raw.title, body: raw.body }));
    const output = await this.call(args.provider, '你是多来源知识综合助手。仅输出JSON。只根据输入原文整理：列出跨来源一致观点、冲突、推断、待确认问题；保留冲突两方，不把推断写成事实。agreement/conflicts/suggestedAdditions每项必须为{text,rawId,quote,start,end}，quote必须是对应Raw的连续原文，start/end为UTF-16左闭右开全局索引。结构：{"title":string,"category":string,"agreement":[object],"conflicts":[object],"inferences":[string],"openQuestions":[string],"suggestedAdditions":[object]}', JSON.stringify(input));
    const schema = await this.wiki.schema();
    if (typeof output.title !== 'string' || !output.title.trim() || output.title.trim().length > 300 || /[\r\n]/u.test(output.title)
      || typeof output.category !== 'string' || !schema.categories.some(item => item.id === output.category)) {
      throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回的综合标题或分类不符合 Wiki Schema，未生成草稿。', 502);
    }
    this.validateEvidence(output, entries);
    const record: KnowledgeWorkflow = {
      id: randomUUID(), kind: 'synthesis', status: 'pending_confirmation', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      provider: { name: args.provider.name, model: args.provider.model }, rawSnapshots: entries.map(raw => ({ id: raw.id, title: raw.title, bodySha256: raw.bodySha256 })),
      title: output.title, category: output.category, sources: ids,
      sections: { suggestedAdditions: output.suggestedAdditions.map((x: any) => x.text), conflicts: output.conflicts.map((x: any) => x.text), inferences: output.inferences, openQuestions: output.openQuestions, agreement: output.agreement.map((x: any) => x.text), sourceList: entries.map(raw => ({ id: raw.id, title: raw.title })) },
      evidence: [...output.suggestedAdditions.map((x: any) => ({ section: 'suggestedAdditions', ...x })), ...output.conflicts.map((x: any) => ({ section: 'conflicts', ...x })), ...output.agreement.map((x: any) => ({ section: 'agreement', ...x }))],
    };
    return this.save(record);
  }

  private async call(provider: LlmProvider, system: string, user: string): Promise<any> {
    const result = await provider.complete({ system, user, timeoutMs: 90000, maxOutputBytes: 256_000 });
    let parsed: unknown;
    try { parsed = JSON.parse(result.text); } catch { throw new WikiError('LLM_INVALID_JSON', 'Provider 返回的内容不是合法 JSON，未创建草稿。', 502); }
    if (!object(parsed)) throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回结构无效，未创建草稿。', 502);
    const allowedTopLevel = new Set(['title', 'category', 'suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']);
    if (Object.keys(parsed).some(key => !allowedTopLevel.has(key))) throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回了未定义字段，未创建草稿。', 502);
    for (const key of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']) {
      const valid = Array.isArray(parsed[key]) && (parsed[key] as unknown[]).every(x => {
        if (['inferences', 'openQuestions'].includes(key)) return typeof x === 'string';
        return object(x) && Object.keys(x).every(field => ['text', 'rawId', 'quote', 'start', 'end'].includes(field))
          && typeof x.text === 'string' && x.text.trim().length > 0 && typeof x.rawId === 'string'
          && typeof x.quote === 'string' && x.quote.length > 0 && Number.isInteger(x.start) && Number.isInteger(x.end);
      });
      if (!valid) throw new WikiError('LLM_SCHEMA_INVALID', `Provider 返回字段 ${key} 无效，未创建草稿。`, 502);
    }
    if (parsed.title !== undefined && typeof parsed.title !== 'string') throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回 title 无效。', 502);
    if (parsed.category !== undefined && typeof parsed.category !== 'string') throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回 category 无效。', 502);
    return parsed;
  }

  private validateEvidence(output: any, raws: Array<{ id: string; body: string }>) {
    const byId = new Map(raws.map(raw => [raw.id, raw.body]));
    for (const key of ['suggestedAdditions', 'conflicts', 'agreement']) for (const item of output[key]) {
      const body = byId.get(item.rawId);
      if (!body || item.start < 0 || item.end <= item.start || body.slice(item.start, item.end) !== item.quote) {
        throw new WikiError('EVIDENCE_INVALID', `Provider 的 ${key} 引用无法在指定 Raw 原文中定位，未生成草稿。`, 502);
      }
    }
  }

  async patch(id: string, baseRevision: number, sections: KnowledgeWorkflow['sections'], title?: string) {
    const workflow = await this.get(id);
    if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
    if (workflow.status !== 'pending_confirmation') throw new WikiError('WORKFLOW_NOT_EDITABLE', '知识草稿不在可编辑状态。', 409);
    if (workflow.revision !== baseRevision) throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已被修改，请刷新后再编辑。', 409, { currentRevision: workflow.revision });
    if (JSON.stringify(sections.sourceList) !== JSON.stringify(workflow.sections.sourceList)
      || sections.existing !== workflow.sections.existing || sections.newSource !== workflow.sections.newSource) {
      throw new WikiError('WORKFLOW_SOURCE_IMMUTABLE', '来源清单、现有页快照和Raw正文不可在草稿编辑中更改。', 409);
    }
    const schema = await this.wiki.schema();
    const nextTitle = title === undefined ? workflow.title : title;
    if (typeof nextTitle !== 'string' || !nextTitle.trim() || nextTitle.trim().length > 300 || /[\r\n]/u.test(nextTitle)) throw new WikiError('INVALID_TITLE', '标题不能为空、不能换行且最多300字符。');
    if (!schema.categories.some(item => item.id === workflow.category)) throw new WikiError('INVALID_CATEGORY', '草稿分类不符合 Wiki Schema。');
    for (const field of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const) {
      if (!Array.isArray(sections[field]) || sections[field].some(value => typeof value !== 'string')) throw new WikiError('INVALID_WORKFLOW', `草稿字段 ${field} 必须为字符串列表。`);
    }
    workflow.sections = sections; workflow.title = nextTitle.trim();
    workflow.revision++; workflow.updatedAt = new Date().toISOString(); return this.save(workflow);
  }

  async discard(id: string, baseRevision: number) {
    const workflow = await this.get(id);
    if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
    if (workflow.revision !== baseRevision) throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已被修改，请刷新后再放弃。', 409, { currentRevision: workflow.revision });
    workflow.status = 'discarded'; workflow.revision++; workflow.updatedAt = new Date().toISOString(); return this.save(workflow);
  }

  async confirm(id: string, baseRevision: number, idempotencyKey: string) {
    const workflow = await this.get(id);
    if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
    const payloadDigest = sha(JSON.stringify({ kind: workflow.kind, title: workflow.title, sections: workflow.sections, evidence: workflow.evidence, targetWikiId: workflow.targetWikiId, baseRevision: workflow.baseRevision, sources: workflow.sources }));
    const priorManifest = (await listJsonRecords<WorkflowManifest>(this.operationsDir())).map(item => item.value).find(item => item.workflowId === workflow.id);
    if (priorManifest) {
      const old = await readJsonFile<WorkflowManifest>(this.operationFile(priorManifest.operationId));
      if (!old || old.payloadDigest !== payloadDigest) throw new WikiError('CONFIRM_PAYLOAD_CHANGED', '该草稿已有不同内容的确认提交；请查看原提交，不要重复确认。', 409, { operationId: priorManifest.operationId });
      if (old.status === 'conflict') throw new WikiError('WORKFLOW_COMMIT_CONFLICT', old.error ?? '提交因人工编辑冲突而停止。', 409, { operationId: old.operationId, writtenIds: old.writtenIds });
      if (old.status === 'completed') {
        const finalized = await this.finalizeWorkflow(old);
        return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: true };
      }
      const finished = await this.execute(old);
      if (finished.status !== 'completed') throw new WikiError('WORKFLOW_COMMIT_PENDING', '原提交尚未完成，请查看提交状态。', 500, { operationId: finished.operationId, writtenIds: finished.writtenIds });
      const finalized = await this.finalizeWorkflow(finished);
      return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: true };
    }
    if (workflow.status !== 'pending_confirmation') throw new WikiError('WORKFLOW_NOT_CONFIRMABLE', '知识草稿不在待确认状态。', 409);
    if (workflow.revision !== baseRevision) throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已过期，请刷新后重新审阅。', 409, { currentRevision: workflow.revision });
    await this.validateForConfirm(workflow);
    if (workflow.kind === 'update' && workflow.targetWikiId) {
      const target = await this.wiki.get(workflow.targetWikiId);
      if (!target) throw new WikiError('NOT_FOUND', '更新目标已不存在。', 404);
      for (const sourceId of target.sources) assertRawNotMeeting(await this.raws.get(sourceId));
    }
    if (!idempotencyKey?.trim()) throw new WikiError('IDEMPOTENCY_KEY_REQUIRED', '确认请求缺少幂等键。');
    for (const snapshot of workflow.rawSnapshots) {
      const raw = await this.getRawSnapshot(snapshot.id);
      if (!raw || this.actualRawSha(raw) !== snapshot.bodySha256 || raw.bodySha256 !== snapshot.bodySha256) throw new WikiError('RAW_CHANGED', `来源 ${snapshot.id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
    }
    let records: WikiRecord[] = [];
    let updateTargetId: string | undefined;
    let targetBaseRevision: number | undefined;
    if (workflow.kind === 'update') {
      const current = await this.wiki.get(workflow.targetWikiId!);
      if (!current) throw new WikiError('NOT_FOUND', '更新目标已不存在。', 404);
      if (current.revision !== workflow.baseRevision) throw new WikiError('REVISION_CONFLICT', '目标 Wiki 已被修改，旧预览不能覆盖新版本。', 409, { currentRevision: current.revision });
      const evidenceLines = (section: string, edited: string[]) => edited.map((text, i) => {
        const item = (workflow.evidence ?? []).filter(value => value.section === section)[i];
        return item ? `- ${text}（来源 Raw ${item.rawId}，原文 [${item.start}, ${item.end})：“${item.quote}”）` : `- ${text}（用户整理）`;
      });
      const body = [current.body, '## 本次更新审核', '### 一致观点', ...evidenceLines('agreement', workflow.sections.agreement), '### 建议增加', ...evidenceLines('suggestedAdditions', workflow.sections.suggestedAdditions), '### 来源冲突（均保留）', ...evidenceLines('conflicts', workflow.sections.conflicts), '### AI 推断', ...workflow.sections.inferences.map(x => `- ${x}`), '### 待确认问题', ...workflow.sections.openQuestions.map(x => `- ${x}`), `来源：${workflow.sections.sourceList.map(x => `[${x.title}](${x.id})`).join('、')}`].filter(Boolean).join('\n\n');
      const title = workflow.title.trim();
      const normalizeTitle = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
      const titleKey = normalizeTitle(title);
      const collision = (await this.wiki.allRecords()).find(item => item.id !== current.id && [item.title, ...item.aliases].some(value => normalizeTitle(value) === titleKey));
      if (collision) throw new WikiError('WIKI_TITLE_CONFLICT', `标题「${title}」已被「${collision.title}」占用。`, 409, { existingId: collision.id });
      const aliases = [...current.aliases];
      if (normalizeTitle(current.title) !== titleKey && !aliases.some(value => normalizeTitle(value) === normalizeTitle(current.title))) aliases.push(current.title);
      records = [{ ...current, title, aliases, sources: [...new Set([...current.sources, ...workflow.sources])], body, updated: new Date().toISOString(), revision: current.revision + 1 }];
      const sourceExists = (await this.wiki.allRecords()).some(item => item.type === 'source' && item.sources.length === 1 && item.sources[0] === workflow.rawSnapshots[0].id);
      if (!sourceExists) {
        const raw = await this.getRawSnapshot(workflow.rawSnapshots[0].id);
        if (!raw) throw new WikiError('RAW_MISSING', '更新来源 Raw 不存在。', 409);
        const now = new Date().toISOString();
        records.unshift({ id: randomUUID(), title: raw.title, type: 'source', domain: 'fmcg', category: current.category, created: now, updated: now, sources: [raw.id], tags: raw.tags, knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'unreviewed', aliases: [], revision: 1, body: `来源 Raw：${raw.id}\n\n${raw.title}\n\n${raw.body.slice(0, 1200)}` });
      }
      updateTargetId = current.id; targetBaseRevision = current.revision;
    } else {
      const all = await this.wiki.allRecords();
      const now = new Date().toISOString();
      for (const rawId of workflow.sources) {
        const existingSource = all.find(item => item.type === 'source' && item.sources.length === 1 && item.sources[0] === rawId);
        if (existingSource) continue;
        const raw = await this.getRawSnapshot(rawId);
        if (!raw) throw new WikiError('RAW_MISSING', `来源 Raw ${rawId} 不存在。`, 409);
        records.push({ id: randomUUID(), title: raw.title, type: 'source', domain: 'fmcg', category: workflow.category, created: now, updated: now, sources: [rawId], tags: raw.tags, knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'unreviewed', aliases: [], revision: 1, body: `来源 Raw：${rawId}\n\n${raw.title}\n\n${raw.body.slice(0, 1200)}` });
      }
      const cited = (section: string, edited: string[]) => edited.map((text, i) => {
        const item = (workflow.evidence ?? []).filter(value => value.section === section)[i];
        return item ? `- ${text}（来源 Raw ${item.rawId}，原文 [${item.start}, ${item.end})：“${item.quote}”）` : `- ${text}（用户整理）`;
      });
      const body = ['## 主要来源', ...workflow.sections.sourceList.map(x => `- ${x.title}（Raw ${x.id}）`), '## 一致观点', ...cited('agreement', workflow.sections.agreement), '## 冲突', ...cited('conflicts', workflow.sections.conflicts), '## AI 推断', ...workflow.sections.inferences.map(x => `- ${x}`), '## 待确认问题', ...workflow.sections.openQuestions.map(x => `- ${x}`), '## 综合整理', ...cited('suggestedAdditions', workflow.sections.suggestedAdditions)].join('\n');
      records.push({ id: randomUUID(), title: workflow.title, type: 'synthesis', domain: 'fmcg', category: workflow.category, created: now, updated: now, sources: workflow.sources, tags: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'C', review_status: 'unreviewed', aliases: [], revision: 1, body });
    }
    const operationId = randomUUID();
    let manifest: WorkflowManifest = { operationId, workflowId: id, idempotencyKey, payloadDigest, status: 'prepared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), records, updateTargetId, targetBaseRevision, rawSnapshots: workflow.rawSnapshots, writtenIds: [] };
    await writeJsonAtomic(this.operationFile(operationId), manifest);
    try { manifest = await this.execute(manifest); }
    catch (error) {
      manifest.status = 'committing'; manifest.error = error instanceof Error ? error.message : '磁盘提交失败'; manifest.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.operationFile(operationId), manifest).catch(() => undefined);
      throw new WikiError('WORKFLOW_COMMIT_PENDING', `提交操作 ${operationId} 遇到磁盘错误；已写入 ${manifest.writtenIds.length} 个页面，恢复清单已保留。请查看提交状态，不要重试创建。`, 500, { operationId, writtenIds: manifest.writtenIds, recoverable: true });
    }
    if (manifest.status === 'conflict') {
      const conflicted = await this.finalizeWorkflow(manifest);
      throw new WikiError('WORKFLOW_COMMIT_CONFLICT', conflicted.lastCommitError ?? '提交因人工编辑冲突而停止。', 409, { operationId, writtenIds: manifest.writtenIds });
    }
    if (manifest.status !== 'completed') throw new WikiError('WORKFLOW_COMMIT_PENDING', '部分知识文件已写入，提交清单已保留并会在重启时继续；请查看提交状态，不要重复确认。', 500, { operationId, writtenIds: manifest.writtenIds });
    const finalized = await this.finalizeWorkflow(manifest);
    return { workflow: finalized, wikiId: finalized.committedWikiId!, reused: false };
  }

  private async execute(input: WorkflowManifest): Promise<WorkflowManifest> {
    let manifest = input;
    manifest.status = 'committing'; manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest);
    for (const snapshot of manifest.rawSnapshots) {
      let raw: Awaited<ReturnType<RawStore['get']>>;
      try { raw = await this.raws.get(snapshot.id); }
      catch (error) {
        if (!(error instanceof RawIntegrityError)) throw error;
        raw = undefined;
      }
      if (!raw) {
        manifest.status = 'conflict'; manifest.error = `Raw ${snapshot.id} 缺失或不可读取，已停止恢复。`;
        manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest;
      }
      try { assertRawNotMeeting(raw); } catch {
        manifest.status = 'conflict'; manifest.error = `Raw ${snapshot.id} 缺失、损坏或受限，已停止恢复。`;
        manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest;
      }
      if (raw.bodySha256 !== snapshot.bodySha256 || this.actualRawSha(raw) !== snapshot.bodySha256) {
        manifest.status = 'conflict'; manifest.error = `Raw ${snapshot.id} 在提交恢复期间变化或frontmatter哈希与实际正文不符，已停止恢复。`;
        manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest;
      }
    }
    if (manifest.updateTargetId) {
      const target = await this.wiki.get(manifest.updateTargetId);
      if (!target) { manifest.status = 'conflict'; manifest.error = '更新目标缺失，已停止恢复。'; await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest; }
      try { for (const sourceId of target.sources) assertRawNotMeeting(await this.raws.get(sourceId)); }
      catch { manifest.status = 'conflict'; manifest.error = '更新目标含缺失、损坏或受限来源，已停止恢复。'; await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest; }
    }
    for (const record of manifest.records) {
      const current = await this.wiki.get(record.id);
      if (manifest.updateTargetId === record.id) {
        if (current && current.revision === record.revision && this.wiki.pageContent(current) === this.wiki.pageContent(record)) { if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id); continue; }
        if ((current?.revision ?? 0) !== manifest.targetBaseRevision) { manifest.status = 'conflict'; manifest.error = '目标页面已出现新版本，恢复已停止以保护人工编辑。'; await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest; }
      } else if (current) {
        if (this.wiki.pageContent(current) === this.wiki.pageContent(record)) { if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id); continue; }
        manifest.status = 'conflict'; manifest.error = `稳定ID ${record.id} 已存在不同内容。`; await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest;
      }
      await this.wiki.writePageLocked(record);
      if (!manifest.writtenIds.includes(record.id)) manifest.writtenIds.push(record.id);
      manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest);
    }
    await this.wiki.rebuildIndexLocked();
    await this.wiki.appendLogLocked(manifest.records.map(record => ({ operationId: manifest.operationId, action: manifest.updateTargetId === record.id ? 'update' as const : 'create' as const, id: record.id, title: record.title, type: record.type, revision: record.revision })));
    manifest.status = 'completed'; manifest.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.operationFile(manifest.operationId), manifest); return manifest;
  }

  async reconcile() {
    const files = await listJsonRecords<WorkflowManifest>(this.operationsDir());
    for (const item of files.map(x => x.value).filter((value): value is WorkflowManifest => Boolean(value))) {
      let manifest = item;
      if (['prepared', 'committing'].includes(item.status)) manifest = await this.execute(item).catch(() => item);
      if (manifest.status === 'completed' || manifest.status === 'conflict') await this.finalizeWorkflow(manifest).catch(() => undefined);
    }
  }

  private async validateForConfirm(workflow: KnowledgeWorkflow) {
    const schema = await this.wiki.schema();
    if (!workflow.title.trim() || workflow.title.length > 300 || /[\r\n]/u.test(workflow.title)) throw new WikiError('INVALID_TITLE', '草稿标题不符合 Wiki Schema。');
    if (!schema.categories.some(item => item.id === workflow.category)) throw new WikiError('INVALID_CATEGORY', '草稿分类不符合 Wiki Schema。');
    for (const field of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const) {
      if (!Array.isArray(workflow.sections[field]) || workflow.sections[field].some(value => typeof value !== 'string')) throw new WikiError('INVALID_WORKFLOW', `草稿字段 ${field} 必须为字符串列表。`);
    }
    const rawBodies = new Map<string, string>();
    for (const snapshot of workflow.rawSnapshots) {
      const raw = await this.getRawSnapshot(snapshot.id);
      if (!raw || raw.bodySha256 !== snapshot.bodySha256 || this.actualRawSha(raw) !== snapshot.bodySha256) throw new WikiError('RAW_CHANGED', `来源 ${snapshot.id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
      assertRawNotMeeting(raw);
      rawBodies.set(raw.id, raw.body);
    }
    for (const item of workflow.evidence ?? []) {
      const body = rawBodies.get(item.rawId);
      if (!body || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || body.slice(item.start, item.end) !== item.quote) {
        throw new WikiError('EVIDENCE_INVALID', '草稿中包含无法定位的原文证据，未提交。', 409, { rawId: item.rawId, section: item.section });
      }
    }
  }

  private actualRawSha(raw: { body: string }) { return sha(raw.body); }

  private async getRawSnapshot(id: string) {
    try { return await this.raws.get(id); }
    catch (error) {
      if (error instanceof RawIntegrityError) throw new WikiError('RAW_CHANGED', `来源 ${id} 已变化或校验值与实际正文不一致，提交已取消。`, 409);
      throw error;
    }
  }

  private async finalizeWorkflow(manifest: WorkflowManifest): Promise<KnowledgeWorkflow> {
    const workflow = await this.get(manifest.workflowId);
    if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '提交清单对应的草稿文件缺失。', 500, { operationId: manifest.operationId });
    if (manifest.status === 'completed') {
      if (workflow.status !== 'confirmed' || workflow.commitOperationId !== manifest.operationId) {
        workflow.status = 'confirmed'; workflow.commitOperationId = manifest.operationId;
        workflow.committedWikiId = manifest.records.find(record => record.type === 'synthesis')?.id ?? manifest.updateTargetId;
        workflow.lastCommitError = undefined; workflow.revision++; workflow.updatedAt = new Date().toISOString();
        await this.save(workflow);
      }
    } else if (manifest.status === 'conflict') {
      if (workflow.status !== 'conflict' || workflow.commitOperationId !== manifest.operationId || workflow.lastCommitError !== manifest.error) {
        workflow.status = 'conflict'; workflow.commitOperationId = manifest.operationId; workflow.lastCommitError = manifest.error ?? '提交恢复遇到冲突。';
        workflow.revision++; workflow.updatedAt = new Date().toISOString(); await this.save(workflow);
      }
    }
    return workflow;
  }
}
