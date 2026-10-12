import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../storage/files.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { LlmError, sanitizeProviderText } from '../llm/provider.ts';
import type { WikiStore, WikiRecord } from '../wiki/store.ts';
import type { PromptStore } from '../prompt/store.ts';
import { normalizePromptInput, type PromptInput } from '../prompt/validate.ts';
import { PromptError } from '../prompt/errors.ts';

export const TEMPLATES = [
  { id: 'industry_learning', label: '行业学习' }, { id: 'business_process', label: '业务流程分析' },
  { id: 'customer_interview', label: '客户访谈' }, { id: 'requirements', label: '需求分析' },
  { id: 'ai_solution', label: 'AI方案设计' }, { id: 'meeting_notes', label: '会议资料整理' }, { id: 'custom', label: '自定义任务' },
] as const;
export const CHECKS = [
  ['goal', '任务目标'], ['role', '角色'], ['context', '业务背景'], ['input', '输入资料'], ['tasks', '执行步骤'],
  ['constraints', '约束条件'], ['output', '输出格式'], ['fact_inference', '事实与推断'], ['anti_fabrication', '防止虚构'],
] as const;
export const BUDGETS = { task: 10_000, briefField: 10_000, briefTotal: 30_000, selectedWiki: 6, perWikiChars: 3_000, totalWikiChars: 12_000, body: 100_000, timeoutMs: 60_000, maxOutputBytes: 512 * 1024 } as const;
export type Brief = { taskName: string; taskType: string; role: string; goal: string; context: string; input: string; tasks: string; constraints: string; output: string };
export type Preview = PromptInput;
type Draft = { id: string; kind: 'generator' | 'optimizer'; createdAt: string; status: 'pending' | 'confirmed'; brief?: Brief; sourceTask?: string; wikiCandidateIds?: string[]; preview?: Preview; originalBody?: string; checks?: Check[]; improvements?: Improvement[]; targetPromptId?: string; baseVersion?: number; confirmed?: { requestId: string; mode: 'new' | 'version'; payloadHash: string; promptId: string; version: number } };
type Check = { id: string; label: string; status: 'present' | 'missing'; evidence: string };
type Improvement = { dimensionId: string; issue: string; action: string };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
function fail(code: string, message: string, status = 400): never { throw new PromptError(code, message, status); }
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

function strictKeys(value: Record<string, unknown>, keys: string[], name: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail('LLM_SCHEMA_MISMATCH', `Provider 返回的${name}包含未定义字段。`, 502);
}
function validateBrief(raw: unknown): Brief {
  if (!isObject(raw)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的 Brief 结构无效。', 502);
  const keys = ['taskName', 'taskType', 'role', 'goal', 'context', 'input', 'tasks', 'constraints', 'output']; strictKeys(raw, keys, 'Brief');
  for (const key of keys) if (!text(raw[key]) || !(raw[key] as string).trim() || (raw[key] as string).length > BUDGETS.briefField) fail('LLM_SCHEMA_MISMATCH', `Provider 返回的 Brief 字段 ${key} 无效。`, 502);
  if (keys.reduce((n, key) => n + (raw[key] as string).length, 0) > BUDGETS.briefTotal) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的 Brief 超出总字符预算。', 502);
  return raw as unknown as Brief;
}
function validatePreview(raw: unknown, relatedWikiIds: string[], categories: string[]): Preview {
  if (!isObject(raw)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的 Prompt 预览结构无效。', 502);
  const keys = ['name', 'category', 'scenario', 'body', 'inputRequirements', 'outputRequirements', 'relatedWikiIds', 'examples', 'tags', 'favorite']; strictKeys(raw, keys, '预览');
  if (keys.some(key => !(key in raw))) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的 Prompt 预览缺少字段。', 502);
  if (!Array.isArray(raw.relatedWikiIds) || stable(raw.relatedWikiIds) !== stable(relatedWikiIds)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的关联 Wiki 与用户选择不一致。', 502);
  try { return normalizePromptInput(raw, categories); }
  catch { fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的 Prompt 预览不符合 Library 字段、分类或长度规则。', 502); }
}
function validateChecks(raw: unknown): Check[] {
  if (!Array.isArray(raw) || raw.length !== CHECKS.length) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的九维检查不完整。', 502);
  const byId = new Map<string, Check>();
  for (const item of raw) {
    if (!isObject(item)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的检查项无效。', 502);
    strictKeys(item, ['id', 'status', 'evidence'], '检查项');
    if (!text(item.id) || !['present', 'missing'].includes(String(item.status)) || !text(item.evidence)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的检查项字段无效。', 502);
    const label = CHECKS.find(([id]) => id === item.id)?.[1]; if (!label || byId.has(item.id)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回未知或重复的检查维度。', 502);
    byId.set(item.id, { id: item.id, label, status: item.status as Check['status'], evidence: item.evidence });
  }
  return CHECKS.map(([id]) => byId.get(id)!);
}
function validateImprovements(raw: unknown, checks: Check[]): Improvement[] {
  if (!Array.isArray(raw)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的改进点结构无效。', 502);
  const ids = new Set<string>();
  const result = raw.map(item => {
    if (!isObject(item)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的改进点无效。', 502);
    strictKeys(item, ['dimensionId', 'issue', 'action'], '改进点');
    if (!text(item.dimensionId) || !text(item.issue) || !item.issue.trim() || !text(item.action) || !item.action.trim() || ids.has(item.dimensionId)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的改进点字段无效。', 502);
    if (!checks.some(check => check.id === item.dimensionId && check.status === 'missing')) fail('LLM_SCHEMA_MISMATCH', '改进点必须对应实际缺失维度。', 502);
    ids.add(item.dimensionId); return { dimensionId: item.dimensionId, issue: item.issue, action: item.action };
  });
  return result;
}

export class PromptAiService {
  private readonly dir: string;
  constructor(root: string, private readonly wiki: WikiStore, private readonly prompts: PromptStore, private readonly provider: () => LlmProvider | undefined) { this.dir = path.join(root, 'drafts', 'prompts'); }
  async initialize() { await mkdir(this.dir, { recursive: true }); }
  schema() { return { templates: TEMPLATES, checks: CHECKS.map(([id, label]) => ({ id, label })), budgets: BUDGETS }; }
  private async save(draft: Draft) { await writeFileAtomic(path.join(this.dir, `${draft.id}.json`), `${JSON.stringify(draft, null, 2)}\n`); return draft; }
  async get(id: string): Promise<Draft | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    try { return JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8')) as Draft; } catch { return undefined; }
  }
  private async call(system: string, user: unknown): Promise<unknown> {
    const provider = this.provider(); if (!provider) throw new LlmError('LLM_NOT_CONFIGURED', '尚未配置产品 LLM Provider，AI Prompt 功能暂不可用；手动 Library 仍可使用。', 503);
    let result;
    try { result = await provider.complete({ system, user: JSON.stringify(user), timeoutMs: BUDGETS.timeoutMs, maxOutputBytes: BUDGETS.maxOutputBytes }); }
    catch (error) { throw new LlmError((error as { code?: string }).code ?? 'LLM_PROVIDER_ERROR', sanitizeProviderText(error instanceof Error ? error.message : 'Provider 调用失败', provider.secrets), (error as { status?: number }).status ?? 502); }
    if (result.finishReason === 'length') throw new LlmError('LLM_OUTPUT_TRUNCATED', 'Provider 输出被截断，未生成草稿。', 502);
    if (!result.text.trim()) throw new LlmError('LLM_EMPTY_RESULT', 'Provider 返回空结果，未生成草稿。', 502);
    let parsed: unknown; try { parsed = JSON.parse(result.text); } catch { throw new LlmError('LLM_INVALID_JSON', 'Provider 返回的内容不是合法 JSON，未生成草稿。', 502); }
    const serialized = JSON.stringify(parsed);
    if (provider.secrets?.some(secret => secret.length >= 6 && serialized.includes(secret))) throw new LlmError('LLM_OUTPUT_CONTAINS_SECRET', 'Provider 输出包含服务端凭证，已拒绝该结果且未创建草稿。', 502);
    return parsed;
  }
  async brief(task: unknown, template: unknown) {
    if (!text(task) || !task.trim() || task.length > BUDGETS.task) fail('INVALID_TASK', `任务描述必须为 1–${BUDGETS.task} 字符。`);
    if (!text(template) || !TEMPLATES.some(item => item.id === template)) fail('INVALID_TEMPLATE', '请选择有效的场景模板。');
    const terms = task.toLocaleLowerCase('zh-CN').split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1);
    const wikiCandidates = (await this.wiki.allRecords()).sort((a, b) => score(`${b.title} ${b.tags.join(' ')} ${b.body}`, terms) - score(`${a.title} ${a.tags.join(' ')} ${a.body}`, terms)).map(page => ({ id: page.id, title: page.title, type: page.type, knowledgeStatus: page.knowledge_status, selected: false }));
    const brief = validateBrief(await this.call('将用户任务整理为结构化 Prompt Brief。只输出严格 JSON 对象，根字段为 taskName,taskType,role,goal,context,input,tasks,constraints,output。', { task, template, templates: TEMPLATES }));
    const draft = await this.save({ id: randomUUID(), kind: 'generator', createdAt: new Date().toISOString(), status: 'pending', brief, sourceTask: task, wikiCandidateIds: wikiCandidates.map(item => item.id) });
    return { draftId: draft.id, brief, wikiCandidates, provider: this.providerMeta() };
  }
  private providerMeta() { const p = this.provider(); return p ? { name: p.name, model: p.model } : null; }
  private async context(ids: unknown, brief: Brief) {
    if (!Array.isArray(ids) || ids.length > BUDGETS.selectedWiki || ids.some(id => !text(id)) || new Set(ids).size !== ids.length) fail('INVALID_WIKI_SELECTION', `相关 Wiki 最多选择 ${BUDGETS.selectedWiki} 页。`);
    const pages: WikiRecord[] = [];
    for (const id of ids as string[]) { const page = await this.wiki.get(id); if (!page) fail('WIKI_NOT_FOUND', `选择的 Wiki ${id} 已不存在，请刷新后重选。`, 409); await this.wiki.assertRecordSourcesAllowed(page!); pages.push(page!); }
    const terms = `${brief.taskName} ${brief.goal} ${brief.context} ${brief.tasks}`.toLocaleLowerCase('zh-CN').split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1);
    let total = 0;
    const used = pages.map(page => {
      const parts = page.body.split(/\n{2,}/u).map(p => p.trim()).filter(Boolean);
      parts.sort((a, b) => score(b, terms) - score(a, terms));
      let excerpt = '';
      for (const part of parts) {
        if (excerpt && score(part, terms) <= 0) continue;
        const separator = excerpt ? '\n\n' : '';
        const room = Math.min(BUDGETS.perWikiChars, BUDGETS.totalWikiChars - total) - excerpt.length - separator.length;
        if (room <= 0) break;
        excerpt += `${separator}${part.slice(0, room)}`;
      }
      total += excerpt.length;
      return { id: page.id, title: page.title, type: page.type, knowledgeStatus: page.knowledge_status, excerpt, sourceChars: page.body.length, usedChars: excerpt.length, truncated: excerpt.length < page.body.length };
    });
    return used;
  }
  async generate(rawBrief: unknown, ids: unknown) {
    const brief = validateBrief(rawBrief); const context = await this.context(ids, brief);
    const categories = (await this.prompts.schema()).categories.map(item => item.id);
    const response = await this.call('根据用户确认的 Brief 与已选择 Wiki 背景生成完整 Prompt。严格只输出根对象 {preview:{name,category,scenario,body,inputRequirements,outputRequirements,relatedWikiIds,examples,tags,favorite}}。分类必须从给定类别选。正文不得执行。', { brief, relatedWiki: context, relatedWikiIds: context.map(item => item.id), categories });
    if (!isObject(response)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的生成结构无效。', 502);
    strictKeys(response, ['preview'], '生成结果');
    const preview = validatePreview(response.preview, context.map(item => item.id), categories);
    const draft = await this.save({ id: randomUUID(), kind: 'generator', createdAt: new Date().toISOString(), status: 'pending', brief, sourceTask: brief.goal, wikiCandidateIds: context.map(item => item.id), preview });
    return { draftId: draft.id, preview, relatedWiki: context, contextBudget: { maxPerWiki: BUDGETS.perWikiChars, maxTotal: BUDGETS.totalWikiChars, used: context.reduce((n, p) => n + p.usedChars, 0) }, provider: this.providerMeta() };
  }
  async optimize(body: unknown, supplement: unknown, targetPromptId: unknown, baseVersion: unknown) {
    if (!text(body) || !body.trim() || body.length > BUDGETS.body) fail('INVALID_PROMPT_BODY', `原 Prompt 必须为 1–${BUDGETS.body} 字符。`);
    if (supplement !== undefined && (!text(supplement) || supplement.length > BUDGETS.task)) fail('INVALID_SUPPLEMENT', '补充要求必须为不超过 10,000 字符的文本。');
    if ((targetPromptId === undefined) !== (baseVersion === undefined)) fail('INVALID_TARGET', '目标 Prompt 与 baseVersion 必须同时提供。');
    let target: { id: string; version: number; relatedWikiIds: string[] } | undefined;
    if (targetPromptId !== undefined) { if (!text(targetPromptId) || typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) fail('INVALID_TARGET', '目标 Prompt 信息无效。'); const current = await this.prompts.get(targetPromptId); if (!current) fail('NOT_FOUND', '没有找到目标 Prompt。', 404); if (current.version !== baseVersion) fail('VERSION_CONFLICT', '目标 Prompt 已有更新版本，请重新打开。', 409); for (const wikiId of current.relatedWikiIds) { const wikiPage = await this.wiki.get(wikiId); if (!wikiPage) fail('INVALID_TARGET', '目标 Prompt 的关联 Wiki 不存在。', 409); await this.wiki.assertRecordSourcesAllowed(wikiPage); } target = { id: current.id, version: current.version, relatedWikiIds: current.relatedWikiIds }; }
    const categories = (await this.prompts.schema()).categories.map(item => item.id);
    const result = await this.call('先逐维度检查 Prompt，再给出实际存在的改进点和完整优化版本。事实不得编造。严格只输出根对象 {checks,improvements,preview}；checks 是九项 {id,status,evidence}，id 取 goal,role,context,input,tasks,constraints,output,fact_inference,anti_fabrication；status 为 present/missing。improvements 是实际 missing 维度对应的 {dimensionId,issue,action} 列表，完整 Prompt 允许空列表。preview 是 B07 输入的 10 个字段，relatedWikiIds 必须与输入相同。', { body, supplement: supplement ?? '', target, categories });
    if (!isObject(result)) fail('LLM_SCHEMA_MISMATCH', 'Provider 返回的优化结构无效。', 502);
    strictKeys(result, ['checks', 'improvements', 'preview'], '优化结果');
    const checks = validateChecks(result.checks); const improvements = validateImprovements(result.improvements, checks); const preview = validatePreview(result.preview, target?.relatedWikiIds ?? [], categories);
    const draft = await this.save({ id: randomUUID(), kind: 'optimizer', createdAt: new Date().toISOString(), status: 'pending', originalBody: body, checks, improvements, preview, targetPromptId: target?.id, baseVersion: target?.version });
    return { draftId: draft.id, originalBody: body, checks, improvements, preview, target: target ?? null, provider: this.providerMeta() };
  }
  async confirm(id: string, requestId: unknown, mode: unknown, input: unknown) {
    if (!text(requestId) || !/^[0-9a-f-]{36}$/i.test(requestId)) fail('INVALID_REQUEST_ID', 'requestId 必须是有效 UUID。');
    if (mode !== 'new' && mode !== 'version') fail('INVALID_CONFIRM_MODE', '保存方式无效。');
    const draft = await this.get(id); if (!draft) fail('DRAFT_NOT_FOUND', '没有找到这份 Prompt 草稿。', 404);
    if (!draft.preview) fail('DRAFT_NOT_CONFIRMABLE', '这份草稿内容不完整。', 409);
    if (mode === 'new' && requestId !== draft.id) fail('INVALID_REQUEST_ID', '新建保存必须使用草稿提供的 requestId。', 400);
    const hash = stable(input);
    if (draft.confirmed) {
      if (draft.confirmed.requestId !== requestId || draft.confirmed.mode !== mode || draft.confirmed.payloadHash !== hash) fail('REQUEST_ID_CONFLICT', '这份草稿已用另一组内容保存，不能复用。', 409);
      try { return { prompt: (await this.prompts.getVersion(draft.confirmed.promptId, draft.confirmed.version)).snapshot, reused: true }; }
      catch { throw new PromptError('CONFIRMATION_RECOVERY_REQUIRED', 'Prompt 已提交，但无法读取其确认版本；请保留草稿并重试。', 500, { committed: true, promptId: draft.confirmed.promptId, version: draft.confirmed.version }); }
    }
    if (draft.status !== 'pending') fail('DRAFT_NOT_CONFIRMABLE', '这份草稿已保存。', 409);
    if (mode === 'version' && (!draft.targetPromptId || !draft.baseVersion)) fail('INVALID_CONFIRM_MODE', '此草稿未绑定原 Prompt，只能保存为新 Prompt。');
    const source = draft.kind === 'optimizer' ? 'optimized' : 'ai_generated';
    const result = await this.prompts.confirmAi({ requestId, mode, promptInput: input, targetPromptId: mode === 'version' ? draft.targetPromptId : undefined, baseVersion: mode === 'version' ? draft.baseVersion : undefined, source });
    // The Prompt record itself carries an atomic idempotency receipt. If this draft write fails,
    // retry replays the same receipt without adding another version.
    draft.status = 'confirmed'; draft.confirmed = { requestId, mode, payloadHash: hash, promptId: result.prompt.id, version: result.prompt.version };
    try { await writeJsonAtomic(path.join(this.dir, `${draft.id}.json`), draft); }
    catch {
      throw new PromptError('PROMPT_COMMITTED_DRAFT_RECOVERY', 'Prompt 已保存，但草稿确认标记没有落盘；正式记录未丢失。请保留此草稿并用相同请求内容重试以完成对账。', 500, { committed: true, promptId: result.prompt.id, version: result.prompt.version, recoveryHint: 'retry_same_payload' });
    }
    return result;
  }
}
function score(textValue: string, terms: string[]) { const lower = textValue.toLocaleLowerCase('zh-CN'); return terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0); }
