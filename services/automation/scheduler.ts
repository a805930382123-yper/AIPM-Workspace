import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LlmProvider } from '../llm/provider.ts';
import { readJsonRecord, SerialQueue, StorageError, writeJsonAtomic } from '../storage/files.ts';
import { runInAutomationContext } from './context.ts';
import { AutomationLedger, isActiveRun, isIsoDate, newestRunFirst } from './ledger.ts';
import { firstDueAfter, isAutomationPlan, planWindow, samePlan } from './schedule.ts';
import type {
  AutomationInstance, AutomationList, AutomationPlan, AutomationRun, AutomationRunStatus, AutomationRunSummary,
  AutomationSchedule, AutomationSchedulePatch, AutomationStatus, AutomationStep, AutomationTrigger,
} from './types.ts';

export type TaskContext = {
  runId: string;
  signal: AbortSignal;
  provider: () => LlmProvider | undefined;
  link(artifacts: Partial<AutomationRun['artifacts']>): Promise<void>;
  step(name: string, check: () => string | Promise<string>): Promise<void>;
};

export type TaskDefinition = {
  type: string;
  name: string;
  defaultPlan: AutomationPlan;
  allowsCatchUp: boolean;
  mayCallModel: boolean;
  tracksSourceRequests?: boolean;
  execute(context: TaskContext): Promise<void>;
};

type StoredSchedule = Pick<AutomationSchedule, 'type' | 'plan' | 'enabled' | 'catchUp' | 'revision' | 'budget' | 'nextRunAt'>;
type Settings = { paused: boolean; schedules: StoredSchedule[] };
type ActiveRun = { id: string; controller: AbortController; done: Promise<void> };
type ProviderScope = (execute: (provider: TaskContext['provider']) => Promise<void>) => Promise<void>;

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object' || !('paused' in value) || typeof value.paused !== 'boolean'
    || !('schedules' in value) || !Array.isArray(value.schedules)) return false;
  return value.schedules.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<StoredSchedule>;
    return typeof item.type === 'string' && !!item.type && typeof item.enabled === 'boolean'
      && isAutomationPlan(item.plan) && typeof item.catchUp === 'boolean' && Number.isSafeInteger(item.revision)
      && item.revision! > 0 && item.budget === null && (item.enabled ? isIsoDate(item.nextRunAt) : item.nextRunAt === null);
  }) && new Set(value.schedules.map((entry: StoredSchedule) => entry.type)).size === value.schedules.length;
}

function runSummary(run: AutomationRun): AutomationRunSummary {
  const { id, type, trigger, scheduledAt, startedAt, endedAt, status, error } = run;
  return { id, type, trigger, scheduledAt, startedAt, endedAt, status, ...(error === undefined ? {} : { error }) };
}

export class AutomationScheduler {
  private readonly file: string;
  private readonly ledger: AutomationLedger;
  private readonly clock: () => number;
  private readonly queue = new SerialQueue();
  private readonly definitions: Map<string, TaskDefinition>;
  private readonly active = new Map<string, ActiveRun>();
  private readonly authorized = new Map<string, Promise<void>>();
  private readonly writeToken = randomBytes(24).toString('base64url');
  private settings: Settings = { paused: false, schedules: [] };
  private scheduler: AutomationStatus['scheduler'] = { healthy: false, lastTickAt: null };
  private pruneAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopping = false;

  constructor(private readonly options: { root: string; instance: AutomationInstance; tasks: readonly TaskDefinition[]; authorizedTypes?: readonly string[]; clock?: () => number; withProvider?: ProviderScope }) {
    this.file = path.join(options.root, 'state', 'automation', 'schedules.json');
    this.ledger = new AutomationLedger(options.root);
    this.clock = options.clock ?? Date.now;
    this.definitions = new Map(options.tasks.map(task => [task.type, task]));
  }

  async initialize() {
    await this.ledger.initialize();
    const now = this.clock();
    for (const item of this.ledger.values()) {
      if (!isActiveRun(item)) continue;
      const run = structuredClone(item);
      run.status = 'interrupted';
      run.error = '工作台进程在运行结束前退出。';
      run.endedAt = iso(now);
      for (const step of run.steps) {
        if (step.status !== 'running') continue;
        step.status = 'interrupted';
        step.error = run.error;
        step.endedAt = run.endedAt;
        step.durationMs = Math.max(0, now - Date.parse(step.startedAt));
      }
      await this.ledger.save(run);
    }
    const existing = await readJsonRecord(this.options.root, this.file, isSettings);
    this.settings = existing ?? this.settings;
    const present = new Set(this.settings.schedules.map(item => item.type));
    const missing: StoredSchedule[] = [];
    for (const task of this.definitions.values()) {
      if (present.has(task.type)) continue;
      missing.push({ type: task.type, plan: task.defaultPlan, enabled: true, catchUp: task.allowsCatchUp, revision: 1, budget: null, nextRunAt: iso(firstDueAfter(task.defaultPlan, now)) });
    }
    if (!existing || missing.length) await this.saveSettings({ ...this.settings, schedules: [...this.settings.schedules, ...missing] });
    await this.tick(true);
  }

  start() { this.timer ??= setInterval(() => { void this.tick(); }, 1000); }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.queue.run(async () => {
      for (const { controller } of this.active.values()) controller.abort();
    });
    await Promise.all([...this.active.values()].map(item => item.done));
    await Promise.allSettled(this.authorized.values());
  }

  async tick(startup = false) {
    return this.queue.run(async () => {
      if (this.stopping) return;
      const now = this.clock();
      try {
        await this.consumeDue(now, startup);
        if (now >= this.pruneAt) {
          await this.ledger.prune(now);
          this.pruneAt = now + DAY;
        }
        this.scheduler = { healthy: true, lastTickAt: iso(now) };
      } catch {
        this.scheduler = { healthy: false, lastTickAt: iso(now), error: '无法更新本机自动化记录，请检查数据目录。' };
      }
    });
  }

  status(): AutomationStatus {
    const nextRuns = this.settings.schedules.flatMap(item => item.nextRunAt && this.definitions.has(item.type) ? [item.nextRunAt] : []);
    const cutoff = this.clock() - DAY;
    let failuresLast24Hours = 0;
    for (const run of this.ledger.values()) {
      if (run.status === 'failed' && run.endedAt && Date.parse(run.endedAt) >= cutoff) failuresLast24Hours++;
    }
    return {
      paused: this.settings.paused, scheduler: this.scheduler, instance: this.options.instance,
      nextRunAt: nextRuns.sort()[0] ?? null, failuresLast24Hours, writeToken: this.writeToken,
    };
  }

  matchesWriteToken(value: string | undefined) { return value === this.writeToken; }

  canStartAuthorized() { return !this.settings.paused && !this.stopping; }

  async runAuthorized(type: string, id: string, candidateId: string, work: TaskDefinition['execute']) {
    const { done } = await this.queue.run(async () => {
      if (!this.canStartAuthorized()) return { done: undefined };
      if (!this.options.authorizedTypes?.includes(type)) throw new StorageError('AUTOMATION_TASK_NOT_FOUND', '没有找到这个自动化任务。', 404);
      const active = this.authorized.get(id);
      if (active) return { done: active };
      const run: AutomationRun = {
        id, type, candidateId, trigger: 'manual', scheduledAt: iso(this.clock()), startedAt: null, endedAt: null,
        status: 'queued', steps: [], usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
        artifacts: { rawIds: [], jobIds: [], draftIds: [] }, budget: null,
      };
      await this.ledger.save(run);
      const done = this.execute({ mayCallModel: false, execute: work }, run, new AbortController().signal)
        .finally(() => { this.authorized.delete(id); });
      this.authorized.set(id, done);
      return { done };
    });
    await done;
  }

  private view(schedule: StoredSchedule, task: TaskDefinition): AutomationSchedule {
    let last: AutomationRun | undefined;
    for (const run of this.ledger.values()) {
      if (run.type === task.type && (!last || newestRunFirst(run, last) < 0)) last = run;
    }
    return { ...schedule, name: task.name, lastRun: last ? runSummary(last) : null, mayCallModel: task.mayCallModel, allowsCatchUp: task.allowsCatchUp };
  }

  schedules(): AutomationList<AutomationSchedule> {
    return { items: this.settings.schedules.flatMap(schedule => {
      const task = this.definitions.get(schedule.type);
      return task ? [this.view(schedule, task)] : [];
    }) };
  }

  private async saveSettings(settings: Settings) {
    await writeJsonAtomic(this.file, settings);
    this.settings = settings;
  }

  private getTask(type: string) {
    const task = this.definitions.get(type);
    if (!task) throw new StorageError('AUTOMATION_TASK_NOT_FOUND', '没有找到这个自动化任务。', 404);
    return task;
  }

  private ensureRunning() {
    if (this.stopping) throw new StorageError('AUTOMATION_STOPPING', '工作台正在退出。', 503);
  }

  async patchSchedule(type: string, patch: AutomationSchedulePatch) {
    return this.queue.run(async () => {
      this.ensureRunning();
      const task = this.getTask(type);
      const current = this.settings.schedules.find(item => item.type === type)!;
      if (current.revision !== patch.revision) throw new StorageError('AUTOMATION_REVISION_CONFLICT', '计划已修改，请刷新后重试。', 409, { currentRevision: current.revision });
      if (patch.catchUp && !task.allowsCatchUp) throw new StorageError('AUTOMATION_CATCH_UP_NOT_ALLOWED', '这个任务不能补跑。', 400);
      const { enabled = current.enabled, plan = current.plan, catchUp = current.catchUp } = patch;
      const nextRunAt = !enabled ? null : !current.enabled || !samePlan(current.plan, plan)
        ? iso(firstDueAfter(plan, this.clock())) : current.nextRunAt;
      const updated = { ...current, enabled, plan, catchUp, revision: current.revision + 1, nextRunAt };
      await this.saveSettings({ ...this.settings, schedules: this.settings.schedules.map(item => item.type === type ? updated : item) });
      return this.view(updated, task);
    });
  }

  async setPaused(paused: boolean) {
    return this.queue.run(async () => {
      this.ensureRunning();
      // Consume elapsed paused slots before switching back to active, even if the timer has not ticked yet.
      if (!paused && this.settings.paused) await this.consumeDue(this.clock(), false);
      if (paused !== this.settings.paused) await this.saveSettings({ ...this.settings, paused });
      return this.status();
    });
  }

  private async consumeDue(now: number, startup: boolean) {
    for (const schedule of this.settings.schedules) {
      if (!schedule.nextRunAt) continue;
      const task = this.definitions.get(schedule.type);
      const due = Date.parse(schedule.nextRunAt);
      if (!task || due > now) continue;
      const { latest, next } = planWindow(schedule.plan, due, now);
      let run: AutomationRun | undefined;
      if (!startup || (schedule.catchUp && task.allowsCatchUp)) {
        const scheduledAt = iso(latest);
        const alreadyRecorded = [...this.ledger.values()].some(item => item.type === task.type && item.trigger !== 'manual' && item.scheduledAt === scheduledAt);
        if (!alreadyRecorded) run = await this.recordRun(task, startup ? 'catch-up' : 'schedule', latest);
      }
      // Write the audit record first. After a crash, startup can interrupt that queued record
      // and consume its exact slot without starting it a second time.
      try {
        await this.saveSettings({ ...this.settings, schedules: this.settings.schedules.map(item => item.type === schedule.type
          ? { ...item, nextRunAt: iso(next) } : item) });
      } catch (error) {
        if (run?.status === 'queued') await this.ledger.save({
          ...run, status: 'failed', endedAt: iso(this.clock()), error: '无法保存计划进度，任务未执行。',
        });
        throw error;
      }
      if (run) this.launch(task, run);
    }
  }

  async runNow(type: string) {
    return this.queue.run(async () => {
      this.ensureRunning();
      const task = this.getTask(type);
      const run = await this.recordRun(task, 'manual', this.clock());
      this.launch(task, run);
      return run;
    });
  }

  private async recordRun(task: TaskDefinition, trigger: AutomationTrigger, scheduled: number) {
    const reason = this.settings.paused ? 'paused' : this.active.has(task.type) ? 'overlap' : undefined;
    if (trigger === 'manual' && reason === 'overlap') throw new StorageError('AUTOMATION_TASK_RUNNING', '已有同类任务正在运行。', 409);
    const run: AutomationRun = {
      id: randomUUID(), type: task.type, trigger, scheduledAt: iso(scheduled), startedAt: null,
      endedAt: reason ? iso(this.clock()) : null, status: reason ? 'skipped' : 'queued',
      ...(reason ? { error: reason } : {}), steps: [], usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
      ...(task.tracksSourceRequests ? { sourceRequests: 0 } : {}),
      artifacts: { rawIds: [], jobIds: [], draftIds: [] }, budget: null,
    };
    return this.ledger.save(run);
  }

  private launch(task: TaskDefinition, saved: AutomationRun) {
    if (saved.status !== 'queued') return;
    const run = structuredClone(saved);
    const controller = new AbortController();
    const done = this.execute(task, run, controller.signal).catch(() => {
      this.scheduler = { ...this.scheduler, healthy: false, error: '无法保存自动化运行记录，请检查数据目录。' };
    }).finally(() => { this.active.delete(task.type); });
    this.active.set(task.type, { id: run.id, controller, done });
  }

  private async execute(task: Pick<TaskDefinition, 'mayCallModel' | 'execute'>, run: AutomationRun, signal: AbortSignal) {
    const save = () => this.ledger.save(run);
    run.status = 'running';
    run.startedAt = iso(this.clock());
    await save();
    const step: TaskContext['step'] = async (name, work) => {
      signal.throwIfAborted();
      const start = this.clock();
      const entry: AutomationStep = { name, status: 'running', startedAt: iso(start), endedAt: null, durationMs: null, summary: '' };
      run.steps.push(entry);
      await save();
      try {
        entry.summary = await work();
        signal.throwIfAborted();
        entry.status = 'succeeded';
      } catch (error) {
        entry.status = signal.aborted ? 'cancelled' : 'failed';
        entry.error = signal.aborted ? '已取消。' : error instanceof AutomationCheckError ? error.message : '检查步骤执行失败。';
        throw error;
      } finally {
        const ended = this.clock();
        entry.endedAt = iso(ended);
        entry.durationMs = Math.max(0, ended - start);
        await save();
      }
    };
    try {
      signal.throwIfAborted();
      await runInAutomationContext({ runId: run.id, usage: run.usage, save, countSource: async () => {
        run.sourceRequests = (run.sourceRequests ?? 0) + 1;
        await save();
      } }, async () => {
        const execute = (provider: TaskContext['provider']) => task.execute({ runId: run.id, signal, step, provider,
          link: async artifacts => { Object.assign(run.artifacts, artifacts); await save(); },
        });
        if (task.mayCallModel && this.options.withProvider) await this.options.withProvider(execute);
        else await execute(() => undefined);
      });
      run.status = signal.aborted ? 'cancelled' : 'succeeded';
    } catch {
      run.status = signal.aborted ? 'cancelled' : 'failed';
    }
    if (run.status === 'cancelled') run.error = '已取消。';
    if (run.status === 'failed') run.error = run.steps.find(entry => entry.status === 'failed')?.error ?? '自动化任务执行失败。';
    run.endedAt = iso(this.clock());
    await save();
  }

  async listRuns(filters: { type?: string; status?: AutomationRunStatus; limit: number }): Promise<AutomationList<AutomationRun>> {
    if (filters.type && !this.options.authorizedTypes?.includes(filters.type)) this.getTask(filters.type);
    const indexed = [...this.ledger.values()].filter(run => (!filters.type || run.type === filters.type)
      && (!filters.status || run.status === filters.status)).sort(newestRunFirst).slice(0, filters.limit);
    const items = (await Promise.all(indexed.map(run => this.ledger.get(run.id).catch(error => {
      if (error instanceof StorageError && error.code === 'AUTOMATION_RUN_CORRUPT') return undefined;
      throw error;
    })))).filter((run): run is AutomationRun => run !== undefined && (!filters.status || run.status === filters.status));
    const issues = this.ledger.listIssues();
    return { items, ...(issues.length ? { issues } : {}) };
  }

  async getRun(id: string) {
    const run = await this.ledger.get(id);
    if (!run) throw new StorageError('AUTOMATION_RUN_NOT_FOUND', '没有找到这条运行记录。', 404);
    return run;
  }

  async cancel(id: string) {
    const { run, active } = await this.queue.run(async () => {
      this.ensureRunning();
      const run = await this.getRun(id);
      if (isActiveRun(run) && this.authorized.has(id)) throw new StorageError('AUTOMATION_AUTHORIZED_RUN', '请在 Raw 详情管理已经开始的整理。', 409);
      const active = this.active.get(run.type);
      if (!isActiveRun(run) || active?.id !== id) return { run };
      active.controller.abort();
      return { run, active };
    });
    if (!active) return run;
    await active.done;
    return this.getRun(id);
  }
}

/** Allows a built-in check to return a specific, fixed diagnostic without persisting an arbitrary thrown error. */
export class AutomationCheckError extends Error {}
