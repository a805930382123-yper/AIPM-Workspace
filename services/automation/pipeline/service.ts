import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExtractionJob, ExtractionRunner } from '../../llm/jobs.ts';
import type { RawStateStore } from '../../raw/state.ts';
import type { DraftStore } from '../../wiki/drafts.ts';
import type { WikiStore } from '../../wiki/store.ts';
import { shanghaiDate, validNewsDate, type NewsService } from '../../news/service.ts';
import type { NewsEdition, NewsItem, NewsSectionName } from '../../news/types.ts';
import { readJsonRecord, SerialQueue, StorageError, writeJsonAtomic } from '../../storage/files.ts';
import { isIsoDate, runIdPattern } from '../ledger.ts';
import { AutomationCheckError, type AutomationScheduler, type TaskContext } from '../scheduler.ts';
import { isNewsMode, isNewsScore, isObject, type NewsMode, type NewsScore } from './screen.ts';

export const organizeType = 'pipeline.organize';
export const defaultNewsTopics = ['快消品类与品牌', '渠道与零售', '消费者趋势', 'AI 产品与工作方法'];
export const isTopics = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 20
  && value.every(topic => typeof topic === 'string' && topic.trim().length > 0 && [...topic.trim()].length <= 80);
export const isConcurrency = (value: unknown): value is number => [1, 2, 3, 4].some(n => n === value);
export const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
export type PipelineSettings = { revision: number; preScreenEnabled: boolean; topics: string[]; concurrency: number };
export type PipelineDisposition = 'inbox' | 'later' | 'ignored';
export const candidateFilters = ['all', 'fetched', 'pending', 'organizing', 'failed', 'ignored'] as const;
export type CandidateFilter = typeof candidateFilters[number];
const phases = ['queued_raw', 'saving_raw', 'raw_failed', 'queued_organize', 'organizing', 'organize_failed', 'interrupted', 'saved', 'draft_ready'] as const;
type Phase = typeof phases[number];
type Confirmation = { requestId: string; registrationId: string; grantedAt: string; organize: boolean; mode: NewsMode };
type Execution = { phase: Phase; runId: string; rawId?: string; jobId?: string; draftId?: string; error?: string };
export type NewsCandidate = { id: string; section: NewsSectionName; item: NewsItem; disposition: PipelineDisposition;
  origin?: 'research-overflow';
  screening?: { score: NewsScore } | { error: string }; confirmation?: Confirmation; execution?: Execution };
export type CandidateView = NewsCandidate & { savedRawId?: string; draftPending?: boolean; saveIssue?: boolean };
export type CandidateList = { date: string; dates: string[]; items: CandidateView[];
  counts: { fetched: number; pending: number; organizing: number; drafts: number; failed: number } };
export type ConfirmCandidates = { requestId: string; candidateIds: string[]; organize: boolean; mode: NewsMode };
type Day = { schemaVersion: 1; date: string; items: NewsCandidate[] };

const badInput = (message: string) => new StorageError('PIPELINE_INVALID_INPUT', message, 400);
const conflict = (message: string) => new StorageError('PIPELINE_CONFLICT', message, 409);
const notFound = () => new StorageError('PIPELINE_NOT_FOUND', '没有找到这条资讯候选。', 404);
const activePhase = (phase: Phase | undefined) => phase === 'queued_raw' || phase === 'saving_raw' || phase === 'queued_organize' || phase === 'organizing';
const isUuid = (value: unknown): value is string => typeof value === 'string' && runIdPattern.test(value);
const candidateId = (date: string, section: NewsSectionName, itemId: string) => [date, section, itemId].join('/');
export function candidateDate(id: string) {
  const [date, section, item, ...extra] = id.split('/');
  if (!date || !validNewsDate(date) || (section !== 'fmcg' && section !== 'ai') || !item || !/^[-\w]{1,120}$/u.test(item) || extra.length) {
    throw badInput('候选 ID 无效。');
  }
  return date;
}

function isDay(value: unknown, date: string): value is Day {
  if (!isObject(value) || value.schemaVersion !== 1 || value.date !== date || !Array.isArray(value.items)) return false;
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!isObject(row) || (row.section !== 'fmcg' && row.section !== 'ai') || !isObject(row.item)
      || typeof row.item.id !== 'string' || !/^[-\w]{1,120}$/u.test(row.item.id)
      || row.id !== candidateId(date, row.section, row.item.id) || ids.has(row.id)
      || !['inbox', 'later', 'ignored'].some(status => status === row.disposition)
      || (row.origin !== undefined && (row.origin !== 'research-overflow' || row.section !== 'fmcg'))
      || !['title', 'sourceId', 'sourceName', 'fetchedAt', 'excerpt', 'url'].every(key => typeof (row.item as Record<string, unknown>)[key] === 'string')
      || !(row.item.publishedAt === null || typeof row.item.publishedAt === 'string')
      || (row.item.evidenceKind !== 'article_excerpt' && row.item.evidenceKind !== 'source_summary')) return false;
    const url = URL.parse(row.item.url as string);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const research = row.item.research;
    if (research !== undefined && (!isObject(research) || typeof research.kind !== 'string'
      || !(research.dataPeriod === null || typeof research.dataPeriod === 'string')
      || ['pdfUrl', 'pageRange'].some(key => research[key] !== undefined && typeof research[key] !== 'string'))) return false;
    if (row.screening !== undefined && (!isObject(row.screening) || !(typeof row.screening.error === 'string'
      || (isNewsScore(row.screening.score) && row.screening.score.candidateId === row.id)))) return false;
    if (row.confirmation !== undefined || row.execution !== undefined) {
      const { confirmation: grant, execution } = row;
      if (!isObject(grant) || !isObject(execution) || !isUuid(grant.registrationId) || !isUuid(grant.requestId) || !isIsoDate(grant.grantedAt)
        || typeof grant.organize !== 'boolean' || !isNewsMode(grant.mode) || !isUuid(execution.runId)
        || !phases.some(phase => phase === execution.phase) || ['rawId', 'jobId', 'draftId'].some(key => execution[key] !== undefined && !isUuid(execution[key]))
        || (execution.error !== undefined && typeof execution.error !== 'string')
        || (['queued_organize', 'organizing', 'organize_failed', 'interrupted', 'saved', 'draft_ready'].includes(String(execution.phase)) && !execution.rawId)
        || (['organizing', 'interrupted', 'draft_ready'].includes(String(execution.phase)) && !execution.jobId)
        || (execution.phase === 'draft_ready' && !execution.draftId)) return false;
    }
    ids.add(row.id);
  }
  return true;
}

type Dependencies = { root: string; news: NewsService; runner: Pick<ExtractionRunner, 'start' | 'readJob' | 'waitForSettlement'>;
  wiki: Pick<WikiStore, 'withLock'>; states: Pick<RawStateStore, 'get'>; drafts: Pick<DraftStore, 'get'>;
  withProvider: <T>(work: () => Promise<T>) => Promise<T>; scheduler: Pick<AutomationScheduler, 'canStartAuthorized' | 'runAuthorized'>;
  clock?: () => Date };

export class NewsPipeline {
  private readonly queue = new SerialQueue();
  private readonly dir: string;
  private readonly settingsFile: string;
  private readonly clock: () => Date;
  private readonly needed = new Set<string>();
  private readonly active = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: Dependencies) {
    this.dir = path.join(deps.root, 'state', 'automation', 'news-candidates');
    this.settingsFile = path.join(deps.root, 'state', 'automation', 'pipeline-settings.json');
    this.clock = deps.clock ?? (() => new Date());
  }

  async settings(): Promise<PipelineSettings> {
    const saved = await readJsonRecord(this.deps.root, this.settingsFile, (value): value is PipelineSettings => isObject(value)
      && isRevision(value.revision) && typeof value.preScreenEnabled === 'boolean' && isTopics(value.topics) && isConcurrency(value.concurrency));
    return saved ?? { revision: 1, preScreenEnabled: true, topics: [...defaultNewsTopics], concurrency: 2 };
  }

  async updateSettings(patch: Partial<PipelineSettings> & { revision: number }) {
    return this.queue.run(async () => {
      const current = await this.settings();
      if (current.revision !== patch.revision) throw conflict('流水线设置已修改，请重新加载后再保存。');
      const next = { ...current, ...patch, revision: current.revision + 1 };
      if (patch.topics) next.topics = patch.topics.map(topic => topic.trim());
      await writeJsonAtomic(this.settingsFile, next);
      return next;
    });
  }

  private file(date: string) {
    if (!validNewsDate(date)) throw badInput('日期无效。');
    return path.join(this.dir, date + '.json');
  }

  private async read(date: string): Promise<Day> {
    return await readJsonRecord(this.deps.root, this.file(date), (value): value is Day => isDay(value, date))
      ?? { schemaVersion: 1, date, items: [] };
  }

  private write(day: Day) { return writeJsonAtomic(this.file(day.date), day); }

  private async dates() {
    const files = await readdir(this.dir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    return files.filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).filter(validNewsDate).sort().reverse();
  }

  async stageEdition(edition: NewsEdition | null, scope: 'all' | 'research-overflow' = 'all') {
    if (!edition) return [];
    return this.queue.run(async () => {
      const day = await this.read(edition.date);
      const present = new Set(day.items.map(item => item.id));
      const add = (section: NewsSectionName, item: NewsItem, origin?: NewsCandidate['origin']) => {
        const id = candidateId(edition.date, section, item.id);
        if (present.has(id)) return;
        candidateDate(id);
        present.add(id);
        day.items.push({ id, section, item, disposition: 'inbox', ...(origin ? { origin } : {}) });
      };
      const previousCount = day.items.length;
      if (scope === 'all') {
        for (const section of ['fmcg', 'ai'] as const) {
          const part = edition.sections[section];
          if (part?.status !== 'ready' && part?.status !== 'source_only') continue;
          for (const item of part.items) add(section, item);
        }
      }
      for (const item of edition.researchOverflow ?? []) add('fmcg', item, 'research-overflow');
      if (scope === 'all' || day.items.length !== previousCount) await this.write(day);
      return scope === 'all' ? day.items.filter(item => !item.screening && item.origin !== 'research-overflow') : [];
    });
  }

  async recordScreening(date: string, batch: NewsCandidate[], result: NewsScore[] | string) {
    await this.queue.run(async () => {
      const day = await this.read(date);
      const outcomes = new Map(batch.map(item => [item.id, typeof result === 'string' ? { error: result } : { score: result.find(score => score.candidateId === item.id)! }]));
      for (const row of day.items) row.screening ??= outcomes.get(row.id);
      await this.write(day);
    });
  }

  async list(date = shanghaiDate(this.clock())): Promise<CandidateList> {
    const [day, dates] = await Promise.all([this.read(date), this.dates()]);
    const items = await Promise.all(day.items.map(async (row): Promise<CandidateView> => {
      const saved = await this.deps.news.rawSaves().savedRawId(row.item)
        .then(rawId => ({ rawId, issue: false }), () => ({ rawId: undefined, issue: true }));
      const rawId = saved.rawId;
      const execution = row.execution;
      let draftId = execution?.draftId;
      if (rawId && execution?.jobId && !this.active.has(row.id) && !draftId) {
        const { job, recovery } = await this.deps.runner.readJob(execution.jobId);
        if (!recovery && job?.status === 'completed' && job.rawId === rawId) draftId = job.draftId;
      }
      const draft = rawId && draftId ? await this.deps.drafts.get(draftId) : undefined;
      return { ...row, ...(draftId && execution ? { execution: { ...execution, draftId } } : {}), savedRawId: rawId,
        draftPending: Boolean(draft && draft.rawId === rawId && draft.jobId === execution?.jobId && draft.status === 'pending_confirmation'),
        saveIssue: saved.issue };
    }));
    return { date, dates, items, counts: {
      fetched: items.length,
      pending: items.filter(row => row.disposition !== 'ignored' && !row.confirmation && !row.savedRawId).length,
      organizing: items.filter(row => activePhase(row.execution?.phase)).length,
      drafts: new Set(items.filter(row => row.draftPending).map(row => row.execution?.draftId)).size,
      failed: items.filter(row => row.saveIssue || (!row.draftPending && ['raw_failed', 'organize_failed', 'interrupted'].includes(row.execution?.phase ?? ''))).length,
    } };
  }

  async disposition(id: string, action: 'ignore' | 'later' | 'restore') {
    const date = candidateDate(id);
    return this.queue.run(async () => {
      const day = await this.read(date);
      const row = day.items.find(item => item.id === id);
      if (!row) throw notFound();
      if (row.confirmation || await this.deps.news.rawSaves().savedRawId(row.item)) throw conflict('该候选已经确认或入库。');
      row.disposition = action === 'ignore' ? 'ignored' : action === 'later' ? 'later' : 'inbox';
      await this.write(day);
      return row;
    });
  }

  async confirm(input: ConfirmCandidates) {
    if (!input.candidateIds.length || new Set(input.candidateIds).size !== input.candidateIds.length) throw badInput('请选择不同的候选条目。');
    const date = candidateDate(input.candidateIds[0]!);
    if (input.candidateIds.some(id => candidateDate(id) !== date)) throw badInput('每次确认请选择同一天的候选。');
    const items = await this.queue.run(async () => {
      const day = await this.read(date);
      const rows = input.candidateIds.map(id => {
        const row = day.items.find(item => item.id === id);
        if (!row) throw notFound();
        return row;
      });
      const rawIds = new Map(await Promise.all(rows.map(async row => [row.id, await this.deps.news.rawSaves().savedRawId(row.item).catch(() => undefined)] as const)));
      const result = () => rows.map(row => ({ ...row, savedRawId: rawIds.get(row.id) }));
      const previous = day.items.filter(row => row.confirmation?.requestId === input.requestId);
      if (previous.length) {
        const remaining = rows.filter(row => !previous.includes(row) && !row.confirmation);
        if (previous.some(row => !rows.includes(row) || row.confirmation!.organize !== input.organize || row.confirmation!.mode !== input.mode)
          || remaining.some(row => !rawIds.get(row.id))) {
          throw conflict('此确认请求已经使用，请重新核对条目。');
        }
        return result();
      }
      // Reject ignored items before writing any authorization. The shared save receipt allows
      // only the first registration's authorization to launch organization for an identical URL.
      if (rows.some(row => row.disposition === 'ignored' && !row.confirmation)) throw conflict('请先恢复已忽略条目。');
      const unsaved = rows.filter(row => !row.confirmation && !rawIds.get(row.id));
      for (const row of unsaved) {
        row.confirmation = { requestId: input.requestId, registrationId: randomUUID(), grantedAt: this.clock().toISOString(), organize: input.organize, mode: input.mode };
        row.execution = { phase: 'queued_raw', runId: randomUUID() };
      }
      if (unsaved.length) {
        await this.write(day);
        this.needed.add(date);
      }
      return result();
    });
    return { items };
  }

  async retry(id: string, stage: 'raw' | 'organize') {
    const date = candidateDate(id);
    return this.queue.run(async () => {
      const day = await this.read(date);
      const row = day.items.find(item => item.id === id);
      if (!row || !row.confirmation || !row.execution) throw notFound();
      const execution = row.execution;
      if (this.active.has(id) || (stage === 'raw' ? execution.phase !== 'raw_failed' : !['organize_failed', 'interrupted'].includes(execution.phase))) {
        throw conflict('该条目当前没有可重试的步骤。');
      }
      row.execution = { ...execution, phase: stage === 'raw' ? 'queued_raw' : 'queued_organize', error: undefined, runId: randomUUID() };
      await this.write(day);
      this.needed.add(date);
      return row;
    });
  }

  private async update(date: string, id: string, execution: Execution) {
    await this.queue.run(async () => {
      const day = await this.read(date);
      const row = day.items.find(item => item.id === id);
      if (!row) throw notFound();
      row.execution = execution;
      await this.write(day);
    });
  }

  async initialize() {
    for (const date of await this.dates()) {
      const day = await this.read(date).catch(() => undefined);
      if (!day) continue;
      let changed = false;
      for (const row of day.items) {
        const execution = row.execution;
        if (!execution || !activePhase(execution.phase)) continue;
        changed = true;
        if (execution.phase === 'organizing') {
          const result = await this.deps.runner.readJob(execution.jobId!).catch(() => undefined);
          const job = result?.job;
          if (!result?.recovery && job?.rawId === execution.rawId && job?.status === 'completed' && job.draftId) {
            row.execution = { ...execution, phase: 'draft_ready', draftId: job.draftId };
          } else {
            row.execution = { ...execution, phase: 'interrupted', error: '整理已中断，请手动继续。' };
          }
        } else {
          row.execution = { ...execution, phase: execution.phase === 'saving_raw' ? 'queued_raw' : execution.phase, runId: randomUUID() };
          this.needed.add(date);
        }
      }
      if (changed) await this.write(day);
    }
  }

  start() { this.timer ??= setInterval(() => { void this.tick().catch(() => undefined); }, 1000); }
  stop() { clearInterval(this.timer); }

  async tick() {
    await this.queue.run(async () => {
      if (!this.needed.size || !this.deps.scheduler.canStartAuthorized()) return;
      const { concurrency } = await this.settings();
      const days = [...this.needed].sort();
      for (const date of days) {
        if (this.active.size >= concurrency) break;
        const day = await this.read(date);
        const queued = day.items.filter(row => row.execution?.phase === 'queued_raw' || row.execution?.phase === 'queued_organize');
        if (!queued.length) this.needed.delete(date);
        for (const row of queued) {
          if (this.active.size >= concurrency) break;
          if (this.active.has(row.id)) continue;
          const execution = row.execution!;
          const done = this.deps.scheduler.runAuthorized(organizeType, execution.runId, row.id, context => this.process(date, row, execution, context))
            .catch(() => undefined).finally(() => { this.active.delete(row.id); });
          this.active.set(row.id, done);
        }
      }
    });
  }

  private async process(date: string, row: NewsCandidate, initial: Execution, context: TaskContext) {
    const confirmation = row.confirmation!;
    let execution = initial;
    const patch = async (fields: Partial<Execution>) => {
      const next = { ...execution, ...fields };
      await this.update(date, row.id, next);
      execution = next;
    };
    const link = () => context.link({
      rawIds: execution.rawId ? [execution.rawId] : [],
      jobIds: execution.jobId ? [execution.jobId] : [],
      draftIds: execution.draftId ? [execution.draftId] : [],
    });
    if (!execution.rawId) {
      await context.step('保存 Raw', async () => {
        await patch({ phase: 'saving_raw' });
        const saved = await this.deps.news.rawSaves().save(date, row.section, row.item, confirmation.registrationId).catch(async () => {
          const error = 'Raw 保存失败，请重试保存。';
          await patch({ phase: 'raw_failed', error });
          throw new AutomationCheckError(error);
        });
        await patch({ rawId: saved.rawId, phase: confirmation.organize && saved.owned ? 'queued_organize' : 'saved' });
        await link();
        return saved.created ? '已保存来源材料。' : '已关联同一来源的 Raw。';
      });
    } else await link();
    if (execution.phase !== 'queued_organize') return;
    await context.step('整理知识草稿', async () => {
      let job: ExtractionJob | undefined;
      try {
        job = await this.deps.wiki.withLock(async () => {
          const rawId = execution.rawId!;
          const state = await this.deps.states.get(rawId);
          const prior = state.jobId ? (await this.deps.runner.readJob(state.jobId)).job : undefined;
          const recoverable = prior?.rawId === rawId && (state.status === 'processing' || state.status === 'pending_confirmation' || prior.status !== 'completed');
          const unstartedJobId = execution.jobId && !(await this.deps.runner.readJob(execution.jobId)).job ? execution.jobId : undefined;
          const jobId = recoverable ? prior.id : unstartedJobId ?? randomUUID();
          await patch({ phase: 'organizing', jobId });
          await link();
          const started = await this.deps.withProvider(() => this.deps.runner.start(rawId, { newJobId: jobId, mode: confirmation.mode, now: this.clock().toISOString() }));
          return started.job;
        });
        if (job.id !== execution.jobId) { await patch({ jobId: job.id }); await link(); }
        const settled = await this.deps.runner.waitForSettlement(job.id);
        if (settled.recovery || settled.job?.status !== 'completed' || !settled.job.draftId) {
          throw new AutomationCheckError(settled.recovery?.message ?? settled.job?.error?.message ?? '整理未完成，请重试整理。');
        }
        await patch({ phase: 'draft_ready', draftId: settled.job.draftId });
      } catch (error) {
        const message = error instanceof AutomationCheckError ? error.message
          : isObject(error) && error.code === 'LLM_NOT_CONFIGURED' ? '尚未配置产品 LLM Provider，请配置后重试整理。' : '整理启动或保存失败，请重试整理。';
        await patch({ phase: 'organize_failed', error: message });
        throw new AutomationCheckError(message);
      }
      await link();
      return '知识草稿已生成，等待人工审核。';
    });
  }
}
