import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RawIntegrityError, type RawStore } from '../raw/store.ts';
import { assertRawNotMeeting, assertRawsNotMeeting, SourcePolicyError } from '../meeting/source-policy.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { sanitizeProviderText } from '../llm/provider.ts';
import type { WikiStore } from '../wiki/store.ts';

export type Severity = 'error' | 'warning' | 'suggestion' | 'supplement';
export type Anchor = { before: string; text: string; after: string };
export type AuditDecision = 'accepted' | 'partial' | 'rejected' | 'deferred';
export type Audit = {
  id: string; wikiId: string; scope: 'page' | 'paragraph'; severity: Severity; comment: string;
  anchor: Anchor; pageBodySha256: string; createdRevision: number; revision: number;
  createdAt: string; updatedAt: string; status: 'open' | 'resolved'; location: { status: 'located' | 'uncertain'; start: number; end: number; method: string };
  relocationHistory: Array<{ at: string; wikiRevision: number; anchor: Anchor; bodySha256: string }>;
  decisionHistory: Array<{ decision: AuditDecision; reason?: string; at: string; operationId?: string; wikiRevision?: number; draftId?: string; requestHash?: string }>;
  pendingDraftId?: string;
};
export type AuditDraft = {
  id: string; auditId: string; revision: number; status: 'pending' | 'discarded' | 'applied';
  baseWikiRevision: number; baseAuditRevision: number; rawSnapshots: Array<{ rawId: string; sha256: string }>;
  replacement: string; rationale: string; evidence: Array<{ rawId: string; quote: string }>; createdAt: string; updatedAt: string;
  provider: { name: string; model: string };
};
const severities = new Set<Severity>(['error', 'warning', 'suggestion', 'supplement']);
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const wikiContentSha = (page: { title: string; type: string; category: string; sources: string[]; tags: string[]; knowledge_status: string; confidence: string; source_level: string; review_status: string; aliases: string[]; body: string }) => sha(JSON.stringify({ title: page.title, type: page.type, category: page.category, sources: page.sources, tags: page.tags, knowledge_status: page.knowledge_status, confidence: page.confidence, source_level: page.source_level, review_status: page.review_status, aliases: page.aliases, body: page.body }));
const safeId = /^[0-9a-f-]{36}$/i;
const anchorFrom = (body: string, start: number, end: number): Anchor => ({ before: body.slice(Math.max(0, start - 80), start), text: body.slice(start, end), after: body.slice(end, Math.min(body.length, end + 80)) });
const occurrences = (value: string, needle: string) => { const out: number[] = []; if (!needle) return out; let at = 0; while ((at = value.indexOf(needle, at)) !== -1) { out.push(at); at += 1; } return out; };
function containsKnownSecret(value: unknown, secrets: readonly string[] = []): boolean {
  const known = secrets.filter(secret => typeof secret === 'string' && secret.length > 0);
  if (!known.length) return false;
  if (typeof value === 'string') return known.some(secret => value.includes(secret));
  if (Array.isArray(value)) return value.some(item => containsKnownSecret(item, known));
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).some(([key, item]) => known.some(secret => key.includes(secret)) || containsKnownSecret(item, known));
  return false;
}

export function locateAnchor(body: string, anchor: Anchor, scope: 'page' | 'paragraph', savedSha?: string) {
  if (scope === 'page') return savedSha === sha(body) ? { status: 'located' as const, start: 0, end: body.length, method: 'page-snapshot' } : { status: 'uncertain' as const, start: -1, end: -1, method: 'page-changed' };
  const found = occurrences(body, anchor.text);
  const exact = found.filter(start => body.slice(Math.max(0, start - anchor.before.length), start) === anchor.before && body.slice(start + anchor.text.length, start + anchor.text.length + anchor.after.length) === anchor.after);
  if (exact.length === 1) return { status: 'located' as const, start: exact[0]!, end: exact[0]! + anchor.text.length, method: 'context' };
  if (found.length === 1) return { status: 'located' as const, start: found[0]!, end: found[0]! + anchor.text.length, method: 'unique-text' };
  return { status: 'uncertain' as const, start: -1, end: -1, method: found.length ? 'ambiguous' : 'missing' };
}

export class AuditError extends Error { constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); } }

export class AuditService {
  readonly auditDir: string; readonly draftDir: string; readonly operationDir: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string, private wiki: WikiStore, private raws: RawStore) {
    this.auditDir = path.join(root, 'knowledge', 'audit'); this.draftDir = path.join(root, 'drafts', 'audit'); this.operationDir = path.join(root, 'state', 'audit-operations');
  }
  async initialize() { await Promise.all([this.auditDir, this.draftDir, this.operationDir].map(dir => mkdir(dir, { recursive: true }))); await this.reconcile(); }
  async withLock<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work, work); this.queue = result.then(() => undefined, () => undefined); return result; }
  private auditPath(id: string) { return path.join(this.auditDir, `${id}.json`); }
  private draftPath(id: string) { return path.join(this.draftDir, `${id}.json`); }
  private async read<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } }
  private async write(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); const { rename } = await import('node:fs/promises'); await rename(temp, file); }
  async get(id: string) { return safeId.test(id) ? this.read<Audit>(this.auditPath(id)) : undefined; }
  async getDraft(id: string) { return safeId.test(id) ? this.read<AuditDraft>(this.draftPath(id)) : undefined; }
  async conflictsForAudit(auditId: string) {
    const names = await readdir(this.operationDir).catch(() => []);
    return (await Promise.all(names.filter(name => name.endsWith('.json')).map(name => this.read<Record<string, unknown>>(path.join(this.operationDir, name)))))
      .filter((op): op is Record<string, unknown> => Boolean(op && op.auditId === auditId && op.status === 'conflict'))
      .map(op => ({ operationId: op.operationId, status: op.status, decision: op.decision, createdAt: op.createdAt, conflictReason: op.conflictReason, expectedWikiRevision: op.targetWikiRevision, observedWikiRevision: op.observedWikiRevision, changedRawIds: op.changedRawIds ?? [] }));
  }
  async list(options: {wikiId?: string; status?: string} = {}) { const names = await readdir(this.auditDir).catch(() => []); const items = (await Promise.all(names.filter(n => n.endsWith('.json')).map(n => this.read<Audit>(path.join(this.auditDir, n))))).filter((x): x is Audit => Boolean(x)); return items.filter(x => (!options.wikiId || x.wikiId === options.wikiId) && (!options.status || x.status === options.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async create(input: {wikiId: string; scope: 'page' | 'paragraph'; severity: Severity; comment: string; anchor?: Anchor}) {
    if (!safeId.test(input.wikiId) || !['page', 'paragraph'].includes(input.scope) || !severities.has(input.severity) || typeof input.comment !== 'string' || !input.comment.trim()) throw new AuditError('INVALID_AUDIT', 'wikiId、范围、严重度和非空反馈均为必填。');
    const page = await this.wiki.get(input.wikiId); if (!page) throw new AuditError('WIKI_NOT_FOUND', '目标 Wiki 不存在。', 404);
    const body = page.body; let anchor: Anchor; let location;
    if (input.scope === 'page') { anchor = { before: '', text: body, after: '' }; location = locateAnchor(body, anchor, 'page', sha(body)); }
    else {
      if (!input.anchor || typeof input.anchor.text !== 'string' || !input.anchor.text.length || typeof input.anchor.before !== 'string' || typeof input.anchor.after !== 'string') throw new AuditError('INVALID_ANCHOR', '段落纠错需要 before、text、after 三段文本。');
      anchor = input.anchor; location = locateAnchor(body, anchor, 'paragraph');
      if (location.status !== 'located') throw new AuditError('ANCHOR_UNCERTAIN', '目标文本无法唯一定位，请选择包含更多上下文的段落。', 409, { location });
      anchor = anchorFrom(body, location.start, location.end);
    }
    const now = new Date().toISOString(); const audit: Audit = { id: randomUUID(), wikiId: page.id, scope: input.scope, severity: input.severity, comment: input.comment.trim(), anchor, pageBodySha256: sha(body), createdRevision: page.revision, revision: 1, createdAt: now, updatedAt: now, status: 'open', location, relocationHistory: [], decisionHistory: [] };
    await this.write(this.auditPath(audit.id), audit); return audit;
  }
  async relocate(id: string, baseAuditRevision: number, anchor: Anchor) {
    const audit = await this.mustAudit(id, baseAuditRevision); const page = await this.wiki.get(audit.wikiId); if (!page) throw new AuditError('WIKI_NOT_FOUND', '目标 Wiki 已删除。', 404);
    if (!anchor || !anchor.text || typeof anchor.before !== 'string' || typeof anchor.after !== 'string') throw new AuditError('INVALID_ANCHOR', '重新定位需要完整三段文本。');
    const location = locateAnchor(page.body, anchor, 'paragraph'); if (location.status !== 'located') throw new AuditError('ANCHOR_UNCERTAIN', '重新定位仍有歧义，请提供更多上下文。', 409, { location });
    const fixed = audit.scope === 'page' ? { before: '', text: page.body, after: '' } : anchorFrom(page.body, location.start, location.end); const now = new Date().toISOString();
    audit.relocationHistory.push({ at: now, wikiRevision: audit.createdRevision, anchor: audit.anchor, bodySha256: audit.pageBodySha256 }); audit.anchor = fixed; audit.pageBodySha256 = sha(page.body); audit.createdRevision = page.revision; audit.location = location; audit.revision++; audit.updatedAt = now;
    if (audit.pendingDraftId) { const draft = await this.getDraft(audit.pendingDraftId); if (draft?.status === 'pending') { draft.status = 'discarded'; draft.revision++; draft.updatedAt = now; await this.write(this.draftPath(draft.id), draft); } delete audit.pendingDraftId; }
    await this.write(this.auditPath(id), audit); return audit;
  }
  async propose(id: string, provider?: LlmProvider) {
    if (!provider) throw new AuditError('LLM_NOT_CONFIGURED', '产品 Provider 未配置，无法生成 Audit 建议。', 503);
    const audit = await this.get(id); if (!audit) throw new AuditError('AUDIT_NOT_FOUND', '没有找到这条 Audit。', 404); if (audit.status !== 'open') throw new AuditError('AUDIT_RESOLVED', '此 Audit 已处理。', 409);
    const page = await this.wiki.get(audit.wikiId); if (!page) throw new AuditError('WIKI_NOT_FOUND', '目标 Wiki 已删除。', 404);
    const location = locateAnchor(page.body, audit.anchor, audit.scope, audit.scope === 'page' ? audit.pageBodySha256 : undefined); if (location.status !== 'located') { audit.location = location; audit.revision++; audit.updatedAt = new Date().toISOString(); await this.write(this.auditPath(id), audit); throw new AuditError('ANCHOR_UNCERTAIN', 'Wiki 内容已变化，Audit 目标需要重新定位。', 409, { location }); }
    const rawPages = await Promise.all(page.sources.map(async rawId => ({ raw: await this.raws.get(rawId), rawId })));
    assertRawsNotMeeting(rawPages.map(item => item.raw));
    if (rawPages.some(item => !item.raw)) throw new AuditError('RAW_MISSING', 'Wiki 来源缺失，不能生成 Audit 建议。', 409);
    const raws = rawPages.map(item => item.raw!); const system = '你是知识库纠错助手。只输出符合以下 JSON Schema 的 JSON：{"type":"object","additionalProperties":false,"required":["replacement","rationale","evidence"],"properties":{"replacement":{"type":"string","minLength":1,"maxLength":200000},"rationale":{"type":"string","maxLength":4000},"evidence":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["rawId","quote"],"properties":{"rawId":{"type":"string"},"quote":{"type":"string","minLength":1,"maxLength":2000}}}}}}。不得杜撰来源事实；每条 quote 必须逐字来自对应 Raw 正文；没有证据时 evidence 可为空。';
    const payload = { audit: { severity: audit.severity, comment: audit.comment, scope: audit.scope }, wiki: { id: page.id, title: page.title, revision: page.revision, body: page.body, target: page.body.slice(location.start, location.end) }, raws: raws.map(raw => ({ id: raw.id, title: raw.title, body: raw.body, bodySha256: raw.bodySha256 })) };
    let completion;
    try { completion = await provider.complete({ system, user: JSON.stringify(payload), timeoutMs: 60000, maxOutputBytes: 512 * 1024 }); }
    catch (error) { throw new AuditError('LLM_PROVIDER_ERROR', sanitizeProviderText(error instanceof Error ? error.message : 'Provider 调用失败', provider.secrets), 502); }
    if (completion.finishReason === 'length') throw new AuditError('LLM_OUTPUT_TRUNCATED', 'Provider 输出被截断，未保存建议。', 502);
    if (completion.bytes > 512 * 1024) throw new AuditError('LLM_OUTPUT_TOO_LARGE', 'Provider 输出超过 512 KiB 上限，未保存建议。', 502);
    let parsed: unknown; try { parsed = JSON.parse(completion.text); } catch { throw new AuditError('LLM_INVALID_JSON', 'Provider 输出不是合法 JSON。', 502); }
    if (containsKnownSecret(parsed, provider.secrets)) throw new AuditError('LLM_OUTPUT_CONTAINS_SECRET', 'Provider 输出包含服务端凭证，已拒绝该结果且未保存建议。', 502);
    if (!validateAuditDraft(parsed)) throw new AuditError('LLM_SCHEMA_MISMATCH', 'Provider 输出不符合 Audit 建议结构。', 502);
    const result = parsed;
    if (result.replacement.length > 200000 || result.rationale.length > 4000 || result.evidence.some(item => item.quote.length > 2000)) throw new AuditError('LLM_SCHEMA_MISMATCH', 'Provider 输出超出 Audit 建议字段长度限制。', 502);
    const evidence = result.evidence;
    for (const item of evidence) { const raw = raws.find(x => x.id === item.rawId); if (!raw || typeof item.quote !== 'string' || !item.quote || !raw.body.includes(item.quote)) throw new AuditError('LLM_EVIDENCE_INVALID', 'Provider 引用无法在对应 Raw 正文中验证。', 502); }
    return this.withLock(async () => {
      const latest = await this.get(id); const currentPage = await this.wiki.get(audit.wikiId);
      if (!latest || latest.status !== 'open' || latest.revision !== audit.revision) throw new AuditError('AUDIT_REVISION_CONFLICT', '生成建议期间 Audit 已处理或变化；未保存过期建议。', 409, { currentRevision: latest?.revision ?? null, status: latest?.status ?? 'missing' });
      if (!currentPage || currentPage.revision !== page.revision) throw new AuditError('WIKI_REVISION_CONFLICT', '生成建议期间 Wiki 已变化；未保存过期建议。', 409, { currentRevision: currentPage?.revision ?? null });
      for (const snapshot of raws) { const currentRaw = await this.raws.get(snapshot.id); if (!currentRaw || sha(currentRaw.body) !== sha(snapshot.body)) throw new AuditError('RAW_CHANGED', '生成建议期间 Raw 已变化；未保存过期建议。', 409); }
      const now = new Date().toISOString(); const draft: AuditDraft = { id: randomUUID(), auditId: latest.id, revision: 1, status: 'pending', baseWikiRevision: page.revision, baseAuditRevision: latest.revision, rawSnapshots: raws.map(raw => ({ rawId: raw.id, sha256: sha(raw.body) })), replacement: result.replacement as string, rationale: (result.rationale as string).slice(0, 4000), evidence: evidence as Array<{ rawId: string; quote: string }>, createdAt: now, updatedAt: now, provider: { name: provider.name, model: provider.model } };
      if (latest.pendingDraftId) { const old = await this.getDraft(latest.pendingDraftId); if (old?.status === 'pending') { old.status = 'discarded'; old.revision++; old.updatedAt = now; await this.write(this.draftPath(old.id), old); } }
      latest.pendingDraftId = draft.id; latest.revision++; latest.updatedAt = now; await this.write(this.draftPath(draft.id), draft); await this.write(this.auditPath(latest.id), latest); return { audit: latest, draft };
    });
  }
  async editDraft(id: string, baseRevision: number, replacement: string, rationale?: string) { const draft = await this.getDraft(id); if (!draft) throw new AuditError('DRAFT_NOT_FOUND', '没有找到建议草稿。', 404); if (draft.status !== 'pending' || draft.revision !== baseRevision) throw new AuditError('DRAFT_REVISION_CONFLICT', '草稿已变化或已结束，请刷新。', 409); if (!replacement.trim() || replacement.length > 200000) throw new AuditError('INVALID_REPLACEMENT', '替换文本不能为空且不能超过 200000 字符。'); draft.replacement = replacement; if (typeof rationale === 'string') draft.rationale = rationale.slice(0, 4000); draft.revision++; draft.updatedAt = new Date().toISOString(); await this.write(this.draftPath(id), draft); return draft; }
  async discardDraft(id: string) { const draft = await this.getDraft(id); if (!draft) throw new AuditError('DRAFT_NOT_FOUND', '没有找到建议草稿。', 404); if (draft.status !== 'pending') return draft; draft.status = 'discarded'; draft.revision++; draft.updatedAt = new Date().toISOString(); await this.write(this.draftPath(id), draft); const audit = await this.get(draft.auditId); if (audit?.pendingDraftId === id) { delete audit.pendingDraftId; audit.revision++; audit.updatedAt = draft.updatedAt; await this.write(this.auditPath(audit.id), audit); } return draft; }
  async resolve(id: string, input: {baseAuditRevision: number; decision: AuditDecision; confirm?: boolean; draftId?: string; baseDraftRevision?: number; replacement?: string; reason?: string}) {
    if (!['accepted', 'partial', 'rejected', 'deferred'].includes(input.decision)) throw new AuditError('INVALID_DECISION', '处理决议无效。');
    const existing = await this.get(id); if (!existing) throw new AuditError('AUDIT_NOT_FOUND', '没有找到这条 Audit。', 404);
    const requestHash = sha(JSON.stringify({ decision: input.decision, draftId: input.draftId ?? null, baseDraftRevision: input.baseDraftRevision ?? null, replacement: input.replacement ?? null, reason: input.reason?.trim() ?? null }));
    const prior = existing.decisionHistory.find(d => d.requestHash === requestHash);
    if (prior) return { audit: existing, decision: prior.decision, operationId: prior.operationId ?? null, wikiRevision: prior.wikiRevision, reused: true };
    const audit = await this.mustAudit(id, input.baseAuditRevision);
    const now = new Date().toISOString();
    if (input.decision === 'rejected' || input.decision === 'deferred') {
      if (!input.reason?.trim()) throw new AuditError('REASON_REQUIRED', '拒绝或延期必须填写理由。');
      const operationId = randomUUID(); const pending = { operationId, auditId: id, status: 'decision-prepared', decision: input.decision, reason: input.reason.trim(), requestHash, at: now };
      await this.write(path.join(this.operationDir, `${operationId}.json`), pending);
      try { await this.ensureAuditLog(audit, operationId); } catch { throw new AuditError('AUDIT_LOG_PENDING', `决议尚未完成，操作 ${operationId} 已保留并会在工作台重启时恢复。`, 500, { operationId, recoverable: true }); }
      audit.decisionHistory.push({ decision: input.decision, reason: input.reason.trim(), at: now, operationId, requestHash }); audit.status = input.decision === 'rejected' ? 'resolved' : 'open'; audit.revision++; audit.updatedAt = now;
      if (audit.pendingDraftId) { const old = await this.getDraft(audit.pendingDraftId); if (old?.status === 'pending') { old.status = 'discarded'; old.revision++; old.updatedAt = now; await this.write(this.draftPath(old.id), old); } }
      delete audit.pendingDraftId; await this.write(this.auditPath(id), audit); await this.write(path.join(this.operationDir, `${operationId}.json`), { ...pending, status: 'completed' }); return { audit, decision: input.decision, operationId, reused: false };
    }
    if (input.confirm !== true) throw new AuditError('CONFIRM_REQUIRED', 'accepted/partial 必须在确认预览后显式传入 confirm:true。', 409);
    const draft = input.draftId ? await this.getDraft(input.draftId) : undefined;
    if (!draft || draft.auditId !== id || draft.status !== 'pending' || input.baseDraftRevision !== draft.revision) throw new AuditError('DRAFT_REVISION_CONFLICT', '建议草稿不存在、已结束或已变化，请重新生成/审阅。', 409);
    const page = await this.wiki.get(audit.wikiId); if (!page) throw new AuditError('WIKI_NOT_FOUND', '目标 Wiki 已删除。', 404);
    if (page.revision !== draft.baseWikiRevision) throw new AuditError('WIKI_REVISION_CONFLICT', 'Wiki 已变化，请重新定位并生成建议。', 409, { currentRevision: page.revision });
    const raws = await Promise.all(draft.rawSnapshots.map(async snap => ({ snap, raw: await this.raws.get(snap.rawId) })));
    assertRawsNotMeeting(raws.map(item => item.raw));
    if (raws.some(({ snap, raw }) => !raw || sha(raw.body) !== snap.sha256)) throw new AuditError('RAW_CHANGED', '建议所依据的 Raw 已变化或删除，请重新生成。', 409);
    const location = locateAnchor(page.body, audit.anchor, audit.scope, audit.scope === 'page' ? audit.pageBodySha256 : undefined);
    if (location.status !== 'located') throw new AuditError('ANCHOR_UNCERTAIN', '目标已变化或无法唯一定位；没有写入 Wiki。', 409, { location });
    const replacement = input.replacement ?? draft.replacement;
    if (typeof replacement !== 'string' || !replacement.trim()) throw new AuditError('INVALID_REPLACEMENT', 'partial 决议需要可见并确认的替换文本。');
    const body = page.body.slice(0, location.start) + replacement + page.body.slice(location.end);
    const operationId = randomUUID(); const operationFile = path.join(this.operationDir, `${operationId}.json`);
    const nextInput = { title: page.title, type: page.type, category: page.category, sources: page.sources, tags: page.tags, knowledge_status: page.knowledge_status, confidence: page.confidence, source_level: page.source_level, review_status: page.review_status, aliases: page.aliases, body };
    const operation = { operationId, auditId: audit.id, draftId: draft.id, status: 'prepared', baseWikiRevision: page.revision, targetWikiRevision: page.revision + 1, targetWikiBodySha256: sha(body), targetWikiContentSha256: wikiContentSha({ ...nextInput, aliases: nextInput.aliases }), rawSnapshots: draft.rawSnapshots, decision: input.decision, nextInput, replacement, reason: input.reason ?? null, requestHash, createdAt: now };
    await this.write(operationFile, operation);
    const updated = await this.wiki.update(page.id, page.revision, nextInput);
    await this.write(operationFile, { ...operation, status: 'wiki-committed' });
    try { await this.ensureAuditLog(audit, operationId); }
    catch { throw new AuditError('AUDIT_LOG_PENDING', `Wiki 已更新（${updated.id}，第 ${updated.revision} 版），但 Audit Log 尚未完成；操作 ${operationId} 已保留并会在工作台重启时恢复。`, 500, { operationId, recoverable: true, wikiRevision: updated.revision }); }
    audit.decisionHistory.push({ decision: input.decision, at: now, operationId, wikiRevision: updated.revision, draftId: draft.id, requestHash }); audit.status = 'resolved'; audit.revision++; audit.updatedAt = now; delete audit.pendingDraftId;
    draft.replacement = replacement; draft.status = 'applied'; draft.revision++; draft.updatedAt = now;
    await this.write(this.draftPath(draft.id), draft); await this.write(this.auditPath(audit.id), audit);
    await this.write(operationFile, { ...operation, status: 'completed', wikiRevision: updated.revision });
    return { audit, decision: input.decision, operationId, wikiRevision: updated.revision, reused: false };
  }
  private async mustAudit(id: string, baseRevision: number) { const audit = await this.get(id); if (!audit) throw new AuditError('AUDIT_NOT_FOUND', '没有找到这条 Audit。', 404); if (audit.status !== 'open') throw new AuditError('AUDIT_RESOLVED', '此 Audit 已处理。', 409); if (audit.revision !== baseRevision) throw new AuditError('AUDIT_REVISION_CONFLICT', 'Audit 已变化，请刷新后重试。', 409, { currentRevision: audit.revision }); return audit; }
  private async ensureAuditLog(audit: Audit, operationId: string) { const page = await this.wiki.get(audit.wikiId); await this.wiki.appendLogLocked([{ operationId, action: 'audit', id: audit.wikiId, title: page?.title ?? audit.wikiId, type: page?.type ?? 'concept', revision: page?.revision ?? audit.createdRevision }]); }
  async reconcile() {
    const names = await readdir(this.operationDir).catch(() => []);
    for (const name of names.filter(n => n.endsWith('.json'))) {
      const file = path.join(this.operationDir, name); const op = await this.read<{ status: string; auditId: string; draftId?: string; targetWikiRevision?: number; targetWikiBodySha256?: string; targetWikiContentSha256?: string; rawSnapshots?: Array<{rawId:string;sha256:string}>; decision: AuditDecision; operationId: string; reason?: string; replacement?: string; requestHash?: string; at?: string; conflictReason?: string }>(file); if (!op || op.status === 'completed' || op.status === 'conflict') continue;
      const audit = await this.get(op.auditId); const draft = op.draftId ? await this.getDraft(op.draftId) : undefined; const page = audit ? await this.wiki.get(audit.wikiId) : undefined;
      if (op.status === 'decision-prepared' && audit && !audit.decisionHistory.some(d => d.operationId === op.operationId)) {
        await this.ensureAuditLog(audit, op.operationId); const now = op.at ?? new Date().toISOString(); audit.decisionHistory.push({ decision: op.decision, reason: op.reason, at: now, operationId: op.operationId, requestHash: op.requestHash }); audit.status = op.decision === 'rejected' ? 'resolved' : 'open'; audit.revision++; audit.updatedAt = now;
        if (audit.pendingDraftId) { const pendingDraft = await this.getDraft(audit.pendingDraftId); if (pendingDraft?.status === 'pending') { pendingDraft.status = 'discarded'; pendingDraft.revision++; pendingDraft.updatedAt = now; await this.write(this.draftPath(pendingDraft.id), pendingDraft); } }
        delete audit.pendingDraftId; await this.write(this.auditPath(audit.id), audit); await this.write(file, { ...op, status: 'completed' });
      } else if (audit && draft && audit.decisionHistory.some(d => d.operationId === op.operationId)) {
        await this.write(file, { ...op, status: 'completed', wikiRevision: page?.revision ?? null });
      } else if (audit && draft) {
        const changedRawIds: string[] = [];
        for (const snapshot of op.rawSnapshots ?? []) {
          try {
            const raw = await this.raws.get(snapshot.rawId);
            if (!raw || sha(raw.body) !== snapshot.sha256) changedRawIds.push(snapshot.rawId);
            assertRawNotMeeting(raw);
          } catch (error) {
            if (error instanceof RawIntegrityError || error instanceof SourcePolicyError) changedRawIds.push(snapshot.rawId);
            else throw error;
          }
        }
        const wikiMatches = Boolean(page && page.revision === op.targetWikiRevision && op.targetWikiBodySha256 && sha(page.body) === op.targetWikiBodySha256 && op.targetWikiContentSha256 && wikiContentSha(page) === op.targetWikiContentSha256);
        const rawMatches = Boolean(op.rawSnapshots && op.rawSnapshots.length === draft.rawSnapshots.length && changedRawIds.length === 0);
        if (audit.status === 'open' && draft.status === 'pending' && wikiMatches && rawMatches && page) {
          const now = new Date().toISOString(); await this.ensureAuditLog(audit, op.operationId); audit.decisionHistory.push({ decision: op.decision, at: now, operationId: op.operationId, wikiRevision: page.revision, draftId: draft.id, requestHash: op.requestHash }); audit.status = 'resolved'; audit.revision++; audit.updatedAt = now; delete audit.pendingDraftId; if (typeof op.replacement === 'string') draft.replacement = op.replacement; draft.status = 'applied'; draft.revision++; draft.updatedAt = now; await this.write(this.draftPath(draft.id), draft); await this.write(this.auditPath(audit.id), audit); await this.write(file, { ...op, status: 'completed', wikiRevision: page.revision });
        } else {
          const reasons = [!page ? 'Wiki 页面不存在' : !wikiMatches ? 'Wiki revision、正文或页面字段与已提交目标不一致' : '', !rawMatches ? 'Raw 来源快照缺失或正文已变化' : '', audit.status !== 'open' ? 'Audit 已不再处于 open 状态' : '', draft.status !== 'pending' ? '建议草稿已不再处于 pending 状态' : ''].filter(Boolean);
          await this.write(file, { ...op, status: 'conflict', conflictReason: reasons.join('；'), observedWikiRevision: page?.revision ?? null, observedWikiBodySha256: page ? sha(page.body) : null, changedRawIds, conflictedAt: new Date().toISOString() });
        }
      } else {
        await this.write(file, { ...op, status: 'conflict', conflictReason: '关联 Audit 或草稿不存在，无法安全恢复。', observedWikiRevision: page?.revision ?? null, changedRawIds: [], conflictedAt: new Date().toISOString() });
      }
    }
    for (const audit of await this.list()) for (const decision of audit.decisionHistory) if (decision.operationId) await this.ensureAuditLog(audit, decision.operationId).catch(() => undefined);
  }
}

export function validateAuditDraft(value: unknown): value is { replacement: string; rationale: string; evidence: Array<{rawId: string; quote: string}> } {
  const item = value as Record<string, unknown> | null;
  return Boolean(item && Object.keys(item).every(k => ['replacement', 'rationale', 'evidence'].includes(k)) && typeof item.replacement === 'string' && item.replacement.length > 0 && typeof item.rationale === 'string' && Array.isArray(item.evidence) && item.evidence.every(e => e && typeof e === 'object' && Object.keys(e).every(k => ['rawId', 'quote'].includes(k)) && typeof (e as Record<string, unknown>).rawId === 'string' && typeof (e as Record<string, unknown>).quote === 'string'));
}
