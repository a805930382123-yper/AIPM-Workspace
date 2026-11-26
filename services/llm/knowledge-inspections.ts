import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { SerialQueue, readJsonRecord, scanJsonRecords, writeJsonAtomic } from '../storage/files.ts';
import type { WikiRecord, WikiStore } from '../wiki/store.ts';
import type { RawStore } from '../raw/store.ts';
import type { DraftStore } from '../wiki/drafts.ts';
import { questionHash, type AnswerCitation } from '../wiki/question-input.ts';
import {
  type InspectionDraftInput,
  type InspectionFinding,
  inspectionSelectionDigest,
  verifyInspectionInput,
  inspectionQueue,
} from '../wiki/inspection-input.ts';
import { assertWikiSourcesAllowed, knowledgeRoots } from '../wiki/source-lineage.ts';
import { type KnowledgeMaintenance, validMaintenance } from '../wiki/maintenance.ts';
import { type LlmProvider, LlmError, assertNoKnownSecret, sanitizeProviderText } from './provider.ts';
import { kb02StructuredOutput, decodeKb02StructuredOutput } from './openai-structured.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';
import {
  MAINTENANCE_LIMITS,
  retrieveKnowledgeContextDetailed,
  getRetrievalStatus,
  type RetrievalStatus,
  type RetrievedKnowledgeContext,
} from './knowledge-maintenance.ts';
import { modelWikiRecord, quoteInWikiContext, WIKI_CHUNK_INSTRUCTIONS } from '../search/fts-retriever.ts';
import { AuditService } from '../audit/service.ts';
export type KnowledgeInspection = {
  sourceComparisonCount?: number;
  id: string;
  revision: number;
  status: 'queued' | 'checking' | 'completed' | 'partial' | 'failed';
  stage: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  includeRelated: boolean;
  scope: {
    selected: string[];
    candidates: string[];
    read: Array<{ id: string; title: string; revision: number }>;
    skipped: Array<{ id: string; reason: string }>;
    gaps: string[];
  };
  readWiki: WikiRecord[];
  wikiRetrieval?: RetrievalStatus;
  rawSnapshots: Array<{ id: string; bodySha256: string }>;
  findings: InspectionFinding[];
  lint: Array<{ code: string; objectId: string | null; message: string }>;
  audits: Array<{ id: string; wikiId: string; status: string; comment: string }>;
  drafts: Array<{
    key: string;
    selectedFindingIds: string[];
    inputDigest: string;
    input: InspectionDraftInput;
    draftId?: string;
    status: string;
    reason?: string;
    proposal?: KnowledgeMaintenance;
    attempts: number;
  }>;
  error?: { code: string; message: string };
};
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v),
  valid = (v: unknown): v is KnowledgeInspection =>
    obj(v) &&
    typeof v.id === 'string' &&
    Number.isInteger(v.revision) &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    Array.isArray(v.findings) &&
    v.findings.every((f) => obj(f) && ['pending', 'viewed', 'deferred', 'committed'].includes(f.status)) &&
    Array.isArray(v.readWiki) &&
    Array.isArray(v.drafts) &&
    obj(v.scope) &&
    ['queued', 'checking', 'completed', 'partial', 'failed'].includes(v.status);
type ScheduledInspection = Pick<KnowledgeInspection['scope'], 'skipped' | 'gaps'> & {
  provider: LlmProvider;
  signal: AbortSignal;
};
const successful = (inspection: KnowledgeInspection) =>
  inspection.status === 'completed' || inspection.status === 'partial';
const text = { type: 'string', minLength: 1, maxLength: 8000 } as const,
  ids = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 64 } } as const;
const evidence: JsonSchemaNode = {
  type: 'array',
  minItems: 1,
  maxItems: 24,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['wikiId', 'quote', 'start', 'end'],
    properties: {
      wikiId: text,
      quote: text,
      start: { type: 'integer', minimum: 0 },
      end: { type: 'integer', minimum: 1 },
    },
  },
};
const schema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'findings'],
  properties: {
    version: { type: 'integer', enum: [1] },
    findings: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'wikiIds', 'summary', 'reason', 'differences', 'nextStep', 'evidence'],
        properties: {
          type: { type: 'string', enum: ['duplicate', 'conflict', 'outdated'] },
          wikiIds: ids,
          summary: text,
          reason: text,
          differences: text,
          nextStep: { type: 'string', enum: ['preserve_differences', 'add_note', 'change_topic', 'defer'] },
          evidence,
        },
      },
    },
  },
};
const proposalSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'changes'],
  properties: {
    version: { type: 'integer', enum: [1] },
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'action',
          'targetWikiId',
          'baseRevision',
          'title',
          'body',
          'reason',
          'summary',
          'questions',
          'findingIds',
        ],
        properties: {
          action: { type: 'string', enum: ['update', 'no_change'] },
          targetWikiId: text,
          baseRevision: { type: 'integer', minimum: 1 },
          title: text,
          body: { type: 'string', minLength: 1, maxLength: 100000 },
          reason: text,
          summary: { type: 'array', maxItems: 32, items: text },
          questions: { type: 'array', maxItems: 32, items: text },
          findingIds: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  },
};
const tasks = new Map<string, Promise<void>>();
export class KnowledgeInspectionService {
  private queue: SerialQueue;
  constructor(
    private deps: {
      root: string;
      wiki: WikiStore;
      raws: RawStore;
      drafts: DraftStore;
      provider: () => LlmProvider | undefined;
    },
  ) {
    this.queue = inspectionQueue(deps.root);
  }
  private dir() {
    return path.join(this.deps.root, 'state/knowledge-inspections');
  }
  private file(id: string) {
    return path.join(this.dir(), id + '.json');
  }
  private put(r: KnowledgeInspection) {
    r.updatedAt = new Date().toISOString();
    return writeJsonAtomic(this.file(r.id), r).then(() => r);
  }
  async initialize() {
    await mkdir(this.dir(), { recursive: true });
    for (const r of await this.list())
      if (['queued', 'checking'].includes(r.status) && !tasks.has(this.file(r.id))) {
        r.status = 'failed';
        r.stage = 'failed';
        r.revision++;
        r.error = { code: 'INSPECTION_INTERRUPTED', message: '检查中断，次数保留；不会自动重发，请显式重试。' };
        await this.put(r);
      }
  }
  async list() {
    return (await scanJsonRecords<KnowledgeInspection>(this.dir(), valid, this.deps.root)).records
      .map((x) => x.value)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async latestCompleted() {
    return (await this.list())
      .filter(successful)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  }
  async get(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return;
    return readJsonRecord(this.deps.root, this.file(id), valid);
  }
  async read(id: string) {
    const r = await this.get(id);
    if (!r) return;
    for (const p of r.readWiki) {
      const current = await this.deps.wiki.get(p.id);
      if (!current) this.error('INSPECTION_BASIS_CHANGED', '检查依据已缺失，不能继续读取旧依据。');
      await this.sourceCurrent(current);
      if (current.revision !== p.revision || questionHash(current.body) !== questionHash(p.body))
        r.scope.gaps.push('依据版本已变化，旧检查不可直接生成或确认维护：' + p.id);
    }
    return r;
  }
  async current() {
    const r = (await this.list())[0];
    return r ? this.read(r.id) : null;
  }
  async wait(id: string) {
    await tasks.get(this.file(id));
    return this.get(id);
  }
  private error(code: string, message: string, status = 409): never {
    throw Object.assign(Error(message), { code, status });
  }
  private async sourceCurrent(p: WikiRecord) {
    await assertWikiSourcesAllowed(this.deps.wiki, this.deps.raws, p);
  }
  async start(
    input: { requestId: string; wikiIds: string[]; includeRelated: boolean; retry?: boolean },
    scheduled?: ScheduledInspection,
  ) {
    return this.queue.run(async () => {
      scheduled?.signal.throwIfAborted();
      if (
        !input ||
        !/^[a-f0-9-]{36}$/i.test(input.requestId) ||
        !Array.isArray(input.wikiIds) ||
        !input.wikiIds.length ||
        input.wikiIds.length > MAINTENANCE_LIMITS.pages ||
        new Set(input.wikiIds).size !== input.wikiIds.length ||
        input.wikiIds.some((x) => typeof x !== 'string' || !/^[a-f0-9-]{36}$/i.test(x)) ||
        typeof input.includeRelated !== 'boolean'
      )
        this.error('INSPECTION_SCOPE_INVALID', '请明确选择1至8个不同知识页。', 400);
      const old = await this.get(input.requestId);
      if (old) {
        if (
          JSON.stringify(old.scope.selected) !== JSON.stringify(input.wikiIds) ||
          old.includeRelated !== input.includeRelated
        )
          this.error('INSPECTION_KEY_MISMATCH', '同请求ID不能更换范围。');
        if (old.status !== 'failed' || !input.retry) return old;
      }
      const selected: WikiRecord[] = [],
        skipped = [...(scheduled?.skipped ?? [])];
      for (const id of input.wikiIds) {
        scheduled?.signal.throwIfAborted();
        try {
          const p = await this.deps.wiki.get(id);
          if (!p) this.error('INSPECTION_PAGE_MISSING', '所选页不存在。');
          await this.sourceCurrent(p);
          selected.push(p);
        } catch (e) {
          skipped.push({ id, reason: sanitizeProviderText(e instanceof Error ? e.message : '来源不可读') });
        }
      }
      if (JSON.stringify(selected).length > MAINTENANCE_LIMITS.characters)
        this.error('INSPECTION_SCOPE_TOO_LARGE', '所选页超过48000 JSON字符，请缩小范围，不会截断选页。', 413);
      const now = new Date().toISOString(),
        r: KnowledgeInspection = {
          id: input.requestId,
          revision: (old?.revision ?? 0) + 1,
          status: 'queued',
          stage: 'queued',
          attempts: old?.attempts ?? 0,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          includeRelated: input.includeRelated,
          scope: {
            selected: input.wikiIds,
            candidates: [...input.wikiIds],
            read: [],
            skipped,
            gaps: [
              '本次仅检查明确实读范围，不代表全库。',
              '结构问题请使用既有 Wiki Lint 入口；本次未执行全库结构检查。',
              ...(scheduled?.gaps ?? []),
            ],
          },
          readWiki: selected,
          rawSnapshots: [],
          findings: [],
          lint: [],
          audits: [],
          drafts: [],
        };
      await this.put(r);
      const provider = scheduled?.provider ?? this.deps.provider();
      const task = this.analyze(r, provider, scheduled?.signal).catch(async (e) => {
        r.status = 'failed';
        r.stage = 'failed';
        r.error = scheduled?.signal.aborted
          ? { code: 'INSPECTION_CANCELLED', message: '主动巡检已取消。' }
          : {
              code: String(e.code ?? 'INSPECTION_FAILED'),
              message: sanitizeProviderText(e.message, provider?.secrets),
            };
        r.revision++;
        await this.put(r);
      });
      tasks.set(this.file(r.id), task);
      void task.then(
        () => tasks.delete(this.file(r.id)),
        () => tasks.delete(this.file(r.id)),
      );
      return structuredClone(r);
    });
  }
  private async complete(
    provider: LlmProvider,
    stage: string,
    payload: unknown,
    schema: JsonSchemaNode,
    instruction: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    assertNoKnownSecret(payload, provider.secrets);
    const structuredOutput = kb02StructuredOutput(stage, schema);
    const completion = provider.complete({
      purpose: 'knowledge',
      signal,
      system: instruction + '只输出严格JSON。' + JSON.stringify(schema),
      user: JSON.stringify({ stage, ...(payload as object) }),
      structuredOutput,
      timeoutMs: 120000,
      maxOutputBytes: 3 * 1024 * 1024,
    });
    let listener: Disposable | undefined;
    const response = signal
      ? await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            listener = addAbortListener(signal, () => reject(signal.reason));
          }),
        ]).finally(() => listener?.[Symbol.dispose]())
      : await completion;
    signal?.throwIfAborted();
    if (response.finishReason === 'length' || Buffer.byteLength(response.text) > 3 * 1024 * 1024)
      throw new LlmError('LLM_OUTPUT_TRUNCATED', '检查响应被截断。');
    let value: unknown;
    try {
      value = JSON.parse(response.text);
    } catch {
      throw new LlmError('LLM_INVALID_JSON', '检查响应不是合法JSON。');
    }
    assertNoKnownSecret(value, provider.secrets);
    if (response.structuredOutputApplied) value = decodeKb02StructuredOutput(value, schema, structuredOutput);
    if (validateSchema(value, schema).length) throw new LlmError('LLM_SCHEMA_INVALID', '检查响应未通过严格结构校验。');
    return value as any;
  }
  private cite(p: WikiRecord, start: number, end: number, quote: string, id: string): AnswerCitation {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      p.body.slice(start, end) !== quote
    )
      this.error('INSPECTION_EVIDENCE_INVALID', '引用必须等于实读知识页精确原句。', 502);
    return {
      id,
      kind: 'wiki',
      recordId: p.id,
      title: p.title,
      revision: p.revision,
      bodySha256: questionHash(p.body),
      start,
      end,
      quote,
      ...knowledgeRoots(p),
    };
  }
  private async analyze(r: KnowledgeInspection, provider: LlmProvider | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    r.status = 'checking';
    r.stage = 'reading';
    await this.put(r);
    let wikiContext: RetrievedKnowledgeContext['context'] = r.readWiki.map(modelWikiRecord);
    if (r.includeRelated && r.readWiki.length) {
      const related = await retrieveKnowledgeContextDetailed(
        this.deps.wiki,
        this.deps.raws,
        r.readWiki.map((p) => ({ title: p.title, content: p.body, tags: p.tags })),
        {
          initialContext: r.readWiki,
          excludeIds: r.scope.selected,
          signal,
          authorizeQuery: async () => {
            if (!provider) this.error('LLM_NOT_CONFIGURED', '未配置主动检查Provider。', 400);
            assertNoKnownSecret(r.readWiki, provider.secrets);
            for (const page of r.readWiki) {
              const current = await this.deps.wiki.get(page.id);
              if (!current || JSON.stringify(current) !== JSON.stringify(page))
                this.error('INSPECTION_BASIS_CHANGED', '检查期间依据已变化，请重新检查。');
              await this.sourceCurrent(current);
            }
          },
        },
      );
      wikiContext = related.context;
      r.wikiRetrieval = getRetrievalStatus(related);
      for (const p of related.records) {
        if (!r.scope.candidates.includes(p.id)) r.scope.candidates.push(p.id);
        r.readWiki.push(p);
      }
      r.scope.gaps.push('相关候选来自现有有界检索，权限过滤/未检索页不代表已检查。');
    }
    signal?.throwIfAborted();
    r.scope.read = r.readWiki.map(({ id, title, revision }) => ({ id, title, revision }));
    for (const id of new Set(r.readWiki.flatMap((p) => knowledgeRoots(p).rawIds))) {
      const raw = await this.deps.raws.get(id);
      if (!raw) this.error('INSPECTION_SOURCE_MISSING', '底源缺失。');
      r.rawSnapshots.push({ id, bodySha256: raw.bodySha256 });
    }
    const audits = new AuditService(this.deps.root, this.deps.wiki, this.deps.raws);
    for (const p of r.readWiki) {
      for (const a of await audits.list({ wikiId: p.id }))
        r.audits.push({ id: a.id, wikiId: a.wikiId, status: a.status, comment: a.comment });
    }
    // Compare only persisted, named derivation snapshots. Age/mtime are never a baseline.
    let comparisons = 0;
    for (const p of r.readWiki) {
      for (const ref of [
        ...(p.answerDerivations ?? []).map((d) => ({ kind: 'answer', id: d.answerId })),
        ...(p.inspectionDerivations ?? []).map((d) => ({ kind: 'inspection', id: d.inspectionId })),
      ]) {
        if (!/^[a-f0-9-]{36}$/i.test(ref.id)) {
          r.scope.gaps.push('派生快照标识非法，未读取。');
          continue;
        }
        let snapshot: any;
        try {
          snapshot = JSON.parse(
            await readFile(
              path.join(
                this.deps.root,
                'state',
                ref.kind === 'answer' ? 'knowledge-answers' : 'knowledge-inspections',
                ref.id + '.json',
              ),
              'utf8',
            ),
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          r.scope.gaps.push('派生页原快照不可用，不能确认来源变化。');
          continue;
        }
        for (const old of snapshot.readWiki ?? []) {
          const current = r.readWiki.find((w) => w.id === old.id);
          if (!current) {
            r.scope.gaps.push('来源快照涉及本次未读取页，未比较：' + old.id);
            continue;
          }
          comparisons++;
          if (old.revision === current.revision && questionHash(old.body) === questionHash(current.body)) continue;
          const quote = current.body.slice(0, Math.min(200, current.body.length));
          if (!quote) continue;
          const c = this.cite(current, 0, quote.length, quote, 'snapshot-' + r.findings.length);
          r.findings.push({
            id: 'snapshot-' + r.findings.length,
            fingerprint: '',
            type: 'source_impact',
            origin: 'snapshot',
            wikiIds: [...new Set([p.id, current.id])],
            summary: '可比来源快照与当前页已变化，需检查派生主题影响。',
            reason: '存在已保存的版本与正文SHA对照，不以资料年龄判断。',
            differences: '旧v' + old.revision + ' → 当前v' + current.revision,
            nextStep: 'defer',
            evidence: [c],
            status: 'pending',
            comparison: {
              kind: ref.kind,
              recordId: ref.id,
              wikiId: current.id,
              beforeRevision: old.revision,
              currentRevision: current.revision,
              beforeSha: questionHash(old.body),
              currentSha: questionHash(current.body),
            },
          });
        }
      }
    }
    r.sourceComparisonCount = comparisons;
    if (!comparisons) r.scope.gaps.push('没有本次可比较的旧来源快照/变更基线，不能确认来源变化。');
    if (r.readWiki.length) {
      if (!provider) this.error('LLM_NOT_CONFIGURED', '未配置主动检查Provider。', 400);
      signal?.throwIfAborted();
      r.attempts++;
      r.stage = 'checking';
      await this.put(r);
      // The local record also keeps skipped pages and unread derivation references.
      const scope = { read: r.scope.read };
      const verifyCurrent = async () => {
        for (const page of r.readWiki) {
          const current = await this.deps.wiki.get(page.id);
          if (!current || JSON.stringify(current) !== JSON.stringify(page)) {
            if (
              (!current || current.revision === page.revision) &&
              wikiContext.some((item) => item.id === page.id && 'chunks' in item)
            )
              this.deps.wiki.searchIndex?.markDirty('inspection', new Error('Wiki snapshot changed during inspection'));
            this.error('INSPECTION_BASIS_CHANGED', '检查期间依据已变化，请重新检查。');
          }
          await this.sourceCurrent(current);
        }
      };
      await verifyCurrent();
      const output = await this.complete(
        provider,
        'knowledge_inspection',
        { wiki: wikiContext, scope, lint: r.lint, audits: r.audits },
        schema,
        '只在本次实读范围提出待核建议：重复主题须对照两页，不因相似标题/同年份合并；冲突区分主体/区域/年份/定义/目标与实际，保留双方不裁错。可能过时必须有明确新旧更新依据，旧年份本身不是失效；没有新依据不要输出outdated。证据不足明确不发现而不是编造。来源变化仅由系统快照比较，不自行输出。每条wikiIds及精确证据都来自输入wiki，重复和过时至少两条独立原句。只建议保留差异/补说明/改主题/暂缓，绝不删除合并或自动修正。' +
          WIKI_CHUNK_INSTRUCTIONS,
        signal,
      );
      await verifyCurrent();
      for (const f of output.findings) {
        if (
          new Set(f.wikiIds).size !== f.wikiIds.length ||
          f.wikiIds.some((id: string) => !r.readWiki.some((p) => p.id === id))
        )
          this.error('INSPECTION_UNREAD_EVIDENCE', '问题涉及本次未实际读取页。', 502);
        const refs = f.evidence.map((e: any, i: number) => {
          const p = r.readWiki.find((p) => p.id === e.wikiId);
          if (!p || !f.wikiIds.includes(p.id)) this.error('INSPECTION_UNREAD_EVIDENCE', '问题引用未实读成员。', 502);
          if (!quoteInWikiContext(wikiContext, p.id, e.start, e.end, e.quote))
            this.error('INSPECTION_EVIDENCE_INVALID', '引用必须完整落在本次发送的知识片段。', 502);
          return this.cite(p, e.start, e.end, e.quote, 'finding-' + r.findings.length + '-e' + i);
        });
        if (f.wikiIds.some((id: string) => !refs.some((c: AnswerCitation) => c.recordId === id)))
          this.error('INSPECTION_EVIDENCE_MISSING', '每个涉及页都需要精确证据。', 502);
        if (
          ['duplicate', 'outdated'].includes(f.type) &&
          (f.wikiIds.length < 2 ||
            new Set(refs.map((c: AnswerCitation) => c.recordId + ':' + c.start + ':' + c.end)).size < 2)
        )
          this.error('INSPECTION_UPDATE_BASIS_MISSING', '重复/可能过时必须有双页可核对依据；不能只凭资料年龄。', 502);
        r.findings.push({
          ...f,
          id: 'finding-' + r.findings.length,
          fingerprint: '',
          origin: 'model',
          evidence: refs,
          status: 'pending',
        });
      }
    }
    for (const p of r.readWiki) {
      const now = await this.deps.wiki.get(p.id);
      if (!now || now.revision !== p.revision || questionHash(now.body) !== questionHash(p.body))
        this.error('INSPECTION_BASIS_CHANGED', '检查期间依据变化。');
      await this.sourceCurrent(now);
    }
    const history = (await this.list()).filter((x) => x.id !== r.id).flatMap((x) => x.findings);
    signal?.throwIfAborted();
    const unique = new Map<string, InspectionFinding>();
    for (const f of r.findings) {
      f.fingerprint = questionHash({
        type: f.type,
        wikiIds: [...f.wikiIds].sort(),
        evidence: f.evidence
          .map((c) => ({ recordId: c.recordId, revision: c.revision, sha: c.bodySha256, start: c.start, end: c.end }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        comparison: f.comparison,
      });
      const prior = history.find((p) => p.fingerprint === f.fingerprint && p.status !== 'pending');
      if (prior) {
        f.status = prior.status;
        f.statusReason = prior.statusReason;
      } else if (
        history.some(
          (p) =>
            p.type === f.type &&
            JSON.stringify([...p.wikiIds].sort()) === JSON.stringify([...f.wikiIds].sort()) &&
            p.status !== 'pending',
        )
      )
        f.basisChanged = true;
      if (!unique.has(f.fingerprint)) unique.set(f.fingerprint, f);
    }
    r.findings = [...unique.values()];
    r.status = r.scope.skipped.length ? 'partial' : 'completed';
    r.stage = r.status;
    r.revision++;
    await this.put(r);
  }
  async decision(
    id: string,
    findingId: string,
    input: { baseRevision: number; status: 'viewed' | 'deferred'; reason: string },
  ) {
    return this.queue.run(async () => {
      const r = await this.get(id);
      if (!r) this.error('INSPECTION_MISSING', '检查不存在。', 404);
      if (r.revision !== input.baseRevision) this.error('INSPECTION_REVISION_CONFLICT', '检查版本已变化。');
      if (
        !['completed', 'partial'].includes(r.status) ||
        !['viewed', 'deferred'].includes(input.status) ||
        typeof input.reason !== 'string' ||
        !input.reason.trim() ||
        input.reason.length > 8000
      )
        this.error('INSPECTION_DECISION_INVALID', '请提供有效处理状态和非空说明。', 400);
      const f = r.findings.find((f) => f.id === findingId);
      if (f?.status === 'committed')
        this.error('INSPECTION_ALREADY_COMMITTED', '已提交问题不能覆盖为暂缓，请基于新依据重新检查。');
      if (!f) this.error('INSPECTION_FINDING_MISSING', '问题不存在。', 404);
      f.status = input.status;
      f.statusReason = input.reason;
      r.revision++;
      return this.put(r);
    });
  }
  async evidence(id: string, findingId: string, evidenceId: string) {
    const r = await this.get(id),
      f = r?.findings.find((f) => f.id === findingId),
      c = f?.evidence.find((c) => c.id === evidenceId);
    if (!r || !c) this.error('INSPECTION_EVIDENCE_MISSING', '检查引用不存在。', 404);
    const p = await this.deps.wiki.get(c.recordId);
    if (
      !p ||
      p.revision !== c.revision ||
      questionHash(p.body) !== c.bodySha256 ||
      p.body.slice(c.start, c.end) !== c.quote
    )
      this.error('INSPECTION_BASIS_CHANGED', '引用依据页已变化。');
    await this.sourceCurrent(p);
    return c;
  }
  async draft(id: string, input: { baseRevision: number; selectedFindingIds: string[]; key: string }) {
    return this.queue.run(async () => {
      let r = await this.get(id);
      if (!r) this.error('INSPECTION_MISSING', '检查不存在。', 404);
      if (
        !input ||
        !Array.isArray(input.selectedFindingIds) ||
        !input.selectedFindingIds.length ||
        new Set(input.selectedFindingIds).size !== input.selectedFindingIds.length ||
        typeof input.key !== 'string' ||
        !input.key ||
        input.key.length > 160
      )
        this.error('INSPECTION_SELECTION_INVALID', '请选择不同的真实问题。', 400);
      const prior = r.drafts.find((d) => d.key === input.key);
      if (prior && JSON.stringify(prior.selectedFindingIds) !== JSON.stringify(input.selectedFindingIds))
        this.error('INSPECTION_KEY_MISMATCH', '同键不能更换问题。');
      if (!prior && r.revision !== input.baseRevision) this.error('INSPECTION_REVISION_CONFLICT', '检查版本已变化。');
      if (!['completed', 'partial'].includes(r.status)) this.error('INSPECTION_NOT_READY', '检查尚未完成。');
      const findings = input.selectedFindingIds.map((id) => r!.findings.find((f) => f.id === id));
      if (findings.some((f) => !f)) this.error('INSPECTION_SELECTION_INVALID', '选中未知问题。', 400);
      const selected = findings as InspectionFinding[],
        wikiIds = new Set(selected.flatMap((f) => f.wikiIds)),
        context = r.readWiki.filter((p) => wikiIds.has(p.id) && p.type !== 'source');
      if (!context.length) this.error('INSPECTION_TARGET_INVALID', '没有可维护的已读主题。');
      if (!prior) {
        if (selected.some((f) => f.status === 'committed'))
          this.error('INSPECTION_ALREADY_COMMITTED', '已提交问题不能另起草稿重复维护。');
        for (const p of context) {
          const now = await this.deps.wiki.get(p.id);
          if (!now || now.revision !== p.revision || questionHash(now.body) !== questionHash(p.body))
            this.error('INSPECTION_BASIS_CHANGED', '生成前检查依据已变化，请重新检查。');
        }
      }
      const citations = selected.flatMap((f) => f.evidence),
        rawIds = new Set(citations.flatMap((c) => c.rawIds));
      const basis: Omit<InspectionDraftInput, 'selectionDigest'> = {
        kind: 'inspection',
        inspectionId: r.id,
        inspectionRevision: r.revision,
        selectedFindingIds: input.selectedFindingIds,
        findings: structuredClone(selected),
        wikiSnapshots: r.readWiki.filter((p) => wikiIds.has(p.id)),
        rawSnapshots: r.rawSnapshots.filter((s) => rawIds.has(s.id)),
        citations,
        sections: selected.map((f) => ({
          id: f.id,
          kind: 'conflict',
          text: f.summary + '：' + f.reason,
          citationIds: f.evidence.map((c) => c.id),
        })),
        changeFindingIds: {},
      };
      let save = prior;
      if (!save) {
        const frozen = { ...basis, selectionDigest: inspectionSelectionDigest(basis) };
        save = {
          key: input.key,
          selectedFindingIds: input.selectedFindingIds,
          input: frozen,
          inputDigest: questionHash(frozen),
          status: 'planning',
          attempts: 0,
        };
        r.drafts.push(save);
        await this.put(r);
      }
      await verifyInspectionInput(save.input, this.deps.wiki, this.deps.raws);
      if (save.draftId && (await this.deps.drafts.getKnowledge(save.draftId)))
        return { status: 'existing_draft', draftId: save.draftId, inspection: r };
      if (save.status === 'no_change') return { status: 'no_change', reason: save.reason, inspection: r };
      try {
        const provider = this.deps.provider();
        if (!provider) this.error('LLM_NOT_CONFIGURED', '未配置维护Provider。');
        if (!save.proposal) {
          if (JSON.stringify(context).length > MAINTENANCE_LIMITS.characters)
            this.error('INSPECTION_SCOPE_TOO_LARGE', '维护目标完整正文超过48000字符，请缩小所选问题范围。', 413);
          save.attempts++;
          await this.put(r);
          const output = await this.complete(
            provider,
            'inspection_maintenance',
            { findings: selected, context },
            proposalSchema,
            '仅为用户本次选中的检查问题生成完整主题维护候选。每个真实目标最多一个changes，多问题同目标合成完整正文。只能update输入context真实主题ID/revision，或no_change；不能create/删除/合并/重造Raw或Source。每项findingIds只来自选中问题且目标必须由该问题涉及。保留全部旧有效内容、人工补充及旧来源，不裁定矛盾，不把检查推断升级成原始事实；正文按事实/整理/待核区分。未选问题不能带入维护。无需改动可no_change，不造空版本。',
          );
          const seen = new Set<string>(),
            changes: KnowledgeMaintenance['changes'] = [],
            mapping: Record<string, string[]> = {};
          for (const c of output.changes) {
            const p = context.find((p) => p.id === c.targetWikiId);
            if (
              !p ||
              p.revision !== c.baseRevision ||
              seen.has(p.id) ||
              !c.findingIds.length ||
              new Set(c.findingIds).size !== c.findingIds.length ||
              c.findingIds.some((id: string) => !selected.some((f) => f.id === id && f.wikiIds.includes(p.id)))
            )
              this.error('INSPECTION_TARGET_INVALID', '维护目标/问题不属于实际选集或重复目标。', 502);
            seen.add(p.id);
            if (c.action === 'no_change') continue;
            const changeId = 'change-' + changes.length;
            mapping[changeId] = c.findingIds;
            changes.push({
              changeId,
              pageIndex: changes.length,
              action: 'update',
              targetWikiId: p.id,
              baseRevision: p.revision,
              candidate: {
                title: c.title,
                type: p.type as any,
                category: p.category,
                body: c.body,
                aliases: p.aliases,
                tags: p.tags,
                sources: [
                  ...new Set([
                    ...p.sources,
                    ...selected
                      .filter((f) => c.findingIds.includes(f.id))
                      .flatMap((f) => f.evidence.flatMap((e) => e.rawIds)),
                  ]),
                ],
                knowledge_status: 'needs_verification',
                confidence: 'low',
                source_level: p.source_level,
              },
              reason: c.reason,
              summary: c.summary,
              questions: c.questions,
              dependsOn: [],
              decision: 'defer',
            });
          }
          if (!changes.length) {
            save.status = 'no_change';
            save.reason = '选中问题没有实质维护新增。';
            r.revision++;
            await this.put(r);
            return { status: 'no_change', reason: save.reason, inspection: r };
          }
          save.input.changeFindingIds = mapping;
          const { selectionDigest: _, ...rest } = save.input;
          save.input.selectionDigest = inspectionSelectionDigest(rest);
          save.inputDigest = questionHash(save.input);
          save.proposal = { version: 1, context, changes };
          if (!validMaintenance(save.proposal)) this.error('INSPECTION_PROPOSAL_INVALID', '维护候选结构非法。', 502);
          await this.put(r);
        }
        await verifyInspectionInput(save.input, this.deps.wiki, this.deps.raws);
        save.draftId ??= randomUUID();
        await this.put(r);
        await this.deps.drafts.createInspection({
          id: save.draftId,
          input: save.input,
          maintenance: save.proposal!,
          provider: { name: provider.name, model: provider.model },
          callCount: save.attempts,
        });
        save.status = 'draft';
        r.revision++;
        await this.put(r);
        return { status: 'draft_created', draftId: save.draftId, inspection: r };
      } catch (e) {
        save.status = 'failed';
        r.revision++;
        await this.put(r);
        throw e;
      }
    });
  }
}
