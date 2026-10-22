import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {isWorkflow,isWorkflowManifest} from '../storage/record-validators.ts';
import { mkdir } from 'node:fs/promises';
import { scanJsonRecords, StorageError, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { RawIntegrityError, type RawStore } from '../raw/store.ts';
import { assertRawNotMeeting, assertRawsNotMeeting } from '../meeting/source-policy.ts';
import { assertNoKnownSecret, LlmError, sanitizeDeep, sanitizeProviderText, type LlmProvider } from '../llm/provider.ts';
import { buildEvidenceLocatorCatalog } from '../llm/locators.ts';
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
  async get(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined; const v=await readJsonRecord<KnowledgeWorkflow>(this.root,this.file(id),(x):x is KnowledgeWorkflow=>isWorkflow(x,id));if(v===undefined)return undefined;if(!isWorkflow(v,id))throw new StorageError('STORAGE_CORRUPT','知识工作流记录结构无效，原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore'});return v; }
  async getCommit(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined; const v=await readJsonRecord<WorkflowManifest>(this.root,this.operationFile(id),(x):x is WorkflowManifest=>isWorkflowManifest(x,id));if(v===undefined)return undefined;if(!isWorkflowManifest(v,id))throw new StorageError('STORAGE_CORRUPT','知识提交清单结构无效，原文件已保留；恢复执行已停止。',500,{category:'recovery',nextAction:'inspect_or_restore'});return v; }
  async list() { return (await scanJsonRecords<KnowledgeWorkflow>(this.dir(),(v,file):v is KnowledgeWorkflow=>isWorkflow(v,path.basename(file,'.json')),this.root)).records.map(x=>x.value); }
  async save(record: KnowledgeWorkflow) { await writeJsonAtomic(this.file(record.id), record); return record; }

  async createUpdate(args: { draftId: string; pageId: string; baseRevision: number; targetWikiId: string; draft: any; raw: any; target: WikiRecord; provider: LlmProvider }) {
    assertRawNotMeeting(args.raw);
    for (const id of args.target.sources) assertRawNotMeeting(await this.raws.get(id));
    if (args.draft.id !== args.draftId || args.draft.rawId !== args.raw?.id || args.target.id !== args.targetWikiId) throw new WikiError('EVIDENCE_INVALID', '更新来源、草稿或目标绑定不一致。', 409);
    if (args.draft.revision !== args.baseRevision) throw new WikiError('DRAFT_REVISION_CONFLICT', '提取草稿已变化，请刷新后重新选择更新。', 409, { currentRevision: args.draft.revision });
    if (!args.raw || this.actualRawSha(args.raw) !== args.raw.bodySha256 || args.raw.bodySha256 !== args.draft.rawSha256) throw new WikiError('RAW_CHANGED', '原文已变化或校验值与实际正文不一致，不能生成更新预览。', 409);
    const page = args.draft.pages.find((item: any) => item.pageId === args.pageId);
    if (!page) throw new WikiError('PAGE_NOT_FOUND', '提取草稿中没有这条建议。', 404);
    const evidenceDirectory = this.updateEvidenceDirectory(page, args.raw);
    await this.assertUpdateTarget(args.target);
    const existingLocators = this.updateExistingLocators(args.target);
    assertNoKnownSecret({ page, evidenceDirectory, existingLocators }, args.provider.secrets);
    const user = JSON.stringify({ existing: { wikiId: args.target.id, title: args.target.title, type: args.target.type, category: args.target.category, body: args.target.body, revision: args.target.revision, sources: args.target.sources, locators: existingLocators }, newSource: { rawId: args.raw.id, rawTitle: args.raw.title, body: args.raw.body, facts: page.source_facts, evidence: evidenceDirectory, organized: page.ai_organized, inferences: page.ai_inferences, questions: page.open_questions } });
    const output = await this.call(args.provider, '你是知识更新建议器。只输出一个合法 JSON 对象，不输出 Markdown、代码围栏或前后说明。输出字段严格为 suggestedAdditions、conflicts、inferences、openQuestions、agreement；五个字段都必须出现且为数组。结构示例：{"suggestedAdditions":[],"conflicts":[],"inferences":[],"openQuestions":[],"agreement":[]}。每个 suggestedAdditions/conflicts 元素严格只包含 text、evidenceId 两个字段；每个 agreement 元素严格只包含 text、evidenceId、existingLocatorId 三个字段。evidenceId只能选newSource.evidence中已经校验且属于选中建议的id；existingLocatorId只能选existing.locators中绑定本次旧Wiki及revision的id，两侧ID不可互换。不得猜测、补造或沿用其他目标/旧版本的ID。只围绕被选中的知识建议与指定旧 Wiki 进行更新，不从其他主题补充内容。不得返回或计算quote/rawId/start/end。没有支持证据则不生成事实建议。newSource.facts 中没有可支持的建议时，suggestedAdditions 可为空数组。agreement仅表达两侧都支持的最小共同命题：逐断言判断，复合句中每项断言均须两侧支持，不能因共同支持一部分便把其余部分也称共同观点。新来源未提及不等于新来源同意。旧侧独有内容保留existing，不生成agreement；新侧独有且有证据的内容进入suggestedAdditions。无法证明一致则agreement为空，可记录待确认问题，不用“均/双方/两侧”等措辞扩大支持。正反例：旧侧“目标门店100家”和新侧“目标门店总数为100家”可得共同命题“目标门店100家”；旧侧还说“门店数不等于销量”而新侧未提及，则不能写“双方均强调门店数不等于销量”，也不能附在共同的门店数或计算公式后面；旧20%与新30%必须列conflicts，保留两种数值及口径；“不知道/未上线/将来建议”不能改为肯定事实。选中双侧原文只是定位约束，仍必须核对每个断言的语义支持。保留旧 Wiki 原内容，不把未确认推断写成事实。遇到两侧不一致，分别保留各自陈述、数值和时间/统计口径；口径或可比性未确认时明确标为待确认，不判定一致、不自行计算或调和。推断与待确认问题用字符串数组表达。', user, 'evidence-id');
    for (const field of ['suggestedAdditions','conflicts','agreement']) output[field] = output[field].map((item: { text: string; evidenceId: string; existingLocatorId?: string }) => {
      const evidence = evidenceDirectory.find(entry => entry.id === item.evidenceId);
      if (!evidence) throw new WikiError('EVIDENCE_INVALID', '更新建议选择未知或非本条建议的证据ID。', 502);
      if (field === 'agreement' && !existingLocators.some(entry => entry.id === item.existingLocatorId)) throw new WikiError('EVIDENCE_INVALID', '一致观点未选择本次旧Wiki版本的有效定位ID。', 502);
      // Internal double-sided bindings are checked above; keep persisted evidence/UI contracts unchanged.
      return { text: item.text, rawId: evidence.rawId, quote: evidence.quote, start: evidence.start, end: evidence.end };
    });
    await this.assertUpdateTarget(args.target);
    assertNoKnownSecret(output, args.provider.secrets);
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

  private async call(provider: LlmProvider, system: string, user: string, format: 'legacy' | 'evidence-id' = 'legacy'): Promise<any> {
    let result;
    try { result = await provider.complete({ system, user, timeoutMs: 90000, maxOutputBytes: 256_000, purpose: 'knowledge' }); }
    catch (error) {
      const code = sanitizeProviderText((error as { code?: unknown }).code ?? 'LLM_PROVIDER_ERROR', provider.secrets) || 'LLM_PROVIDER_ERROR';
      const message = sanitizeProviderText(error instanceof Error ? error.message : 'Provider 调用失败', provider.secrets);
      const details = (error as { details?: unknown }).details;
      throw new LlmError(code, message, (error as { status?: number }).status ?? 502, details === undefined ? undefined : sanitizeDeep(details, provider.secrets));
    }
    let parsed: unknown;
    if (format === 'evidence-id' && result.finishReason === 'length') throw new WikiError('LLM_OUTPUT_TRUNCATED', '更新建议响应被截断，未创建草稿。', 502);
    try { parsed = JSON.parse(result.text); } catch { throw new WikiError('LLM_INVALID_JSON', 'Provider 返回的内容不是合法 JSON，未创建草稿。', 502); }
    assertNoKnownSecret(parsed, provider.secrets);
    if (!object(parsed)) throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回结构无效，未创建草稿。', 502);
    const allowedTopLevel = new Set(format === 'evidence-id' ? ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] : ['title', 'category', 'suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']);
    if (Object.keys(parsed).some(key => !allowedTopLevel.has(key))) throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回了未定义字段，未创建草稿。', 502);
    for (const key of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']) {
      const valid = Array.isArray(parsed[key]) && (parsed[key] as unknown[]).every(x => {
        if (['inferences', 'openQuestions'].includes(key)) return typeof x === 'string';
        if (format === 'evidence-id') {
          const fields = key === 'agreement' ? ['text','evidenceId','existingLocatorId'] : ['text','evidenceId'];
          return object(x) && Object.keys(x).length === fields.length && Object.keys(x).every(field => fields.includes(field)) && typeof x.text === 'string' && !!x.text.trim() && x.text.length <= 4000 && fields.slice(1).every(field => typeof x[field] === 'string' && (x[field] as string).length > 0 && (x[field] as string).length <= 128);
        }
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

  private updateEvidenceDirectory(page: any, raw: { id: string; body: string }) {
    if (!Array.isArray(page.source_evidence) || !Array.isArray(page.source_facts) || !page.source_facts.length) throw new WikiError('EVIDENCE_INVALID', '选中建议缺少已验证来源事实或证据。', 409);
    const entries = page.source_evidence as Array<{ id: string; rawId: string; quote: string; start: number; end: number }>;
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 128 || ids.has(entry.id) || entry.rawId !== raw.id || typeof entry.quote !== 'string' || !entry.quote.length || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end) || entry.start < 0 || entry.end <= entry.start || entry.end > raw.body.length || raw.body.slice(entry.start, entry.end) !== entry.quote) throw new WikiError('EVIDENCE_INVALID', '选中建议证据的ID、Raw或原文位置无效。', 409);
      ids.add(entry.id);
    }
    const used = new Set<string>();
    for (const fact of page.source_facts) {
      if (!fact || typeof fact.text !== 'string' || !fact.text.trim() || !Array.isArray(fact.evidenceIds) || !fact.evidenceIds.length || new Set(fact.evidenceIds).size !== fact.evidenceIds.length || fact.evidenceIds.some((id: unknown) => typeof id !== 'string' || !ids.has(id))) throw new WikiError('EVIDENCE_INVALID', '选中建议事实引用未绑定其证据目录。', 409);
      fact.evidenceIds.forEach((id: string) => used.add(id));
    }
    if (used.size !== ids.size) throw new WikiError('EVIDENCE_INVALID', '选中建议证据目录包含未绑定事实的条目。', 409);
    return entries.map(({ id, rawId, quote, start, end }) => ({ id, rawId, quote, start, end }));
  }

  private async assertUpdateTarget(target: WikiRecord) {
    const current = await this.wiki.get(target.id);
    if (!current || current.revision !== target.revision || this.wiki.pageContent(current) !== this.wiki.pageContent(target)) throw new WikiError('WIKI_REVISION_CONFLICT', '更新目标版本已变化，请刷新后重新生成预览。', 409);
  }

  private updateExistingLocators(target: WikiRecord) {
    if (!target.body.length) return [];
    const binding = sha(JSON.stringify([target.id, target.revision, sha(target.body)]));
    return buildEvidenceLocatorCatalog(target.body, { index: 0, start: 0, end: target.body.length, text: target.body }, { maxLocators: target.body.length })
      .map(({ start, end, text }, index) => ({ id: `wiki-${binding}-${index + 1}`, start, end, text }));
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
    const priorManifest = (await scanJsonRecords<WorkflowManifest>(this.operationsDir(),(v,file):v is WorkflowManifest=>isWorkflowManifest(v,path.basename(file,'.json')),this.root).then(x=>x.records)).map(item => item.value).find(item => item.workflowId === workflow.id);
    if (priorManifest) {
      const old = await this.getCommit(priorManifest.operationId);
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
    const files = (await scanJsonRecords<WorkflowManifest>(this.operationsDir(),(v,file):v is WorkflowManifest=>isWorkflowManifest(v,path.basename(file,'.json')),this.root)).records;
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
