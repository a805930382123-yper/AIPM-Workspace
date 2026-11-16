import express from 'express';
import { runIdPattern } from '../services/automation/ledger.ts';
import { isAutomationPlan } from '../services/automation/schedule.ts';
import type { AutomationScheduler } from '../services/automation/scheduler.ts';
import { automationRunStatuses, type AutomationSchedulePatch } from '../services/automation/types.ts';
import { StorageError } from '../services/storage/files.ts';
import { isConcurrency, isRevision, isTopics, type NewsPipeline } from '../services/automation/pipeline/service.ts';
import { isNewsMode } from '../services/automation/pipeline/screen.ts';

const badInput = (message: string) => new StorageError('AUTOMATION_INVALID_INPUT', message, 400);

function localOrigin(req: express.Request): boolean {
  const host = req.get('host');
  if (!host || /[\s/@\\]/u.test(host) || req.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const url = new URL(`http://${host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.host !== host.toLowerCase()) return false;
  } catch { return false; }
  const origin = req.get('origin');
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  const allowed = new Set([`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
  if (process.env.FMCG_UI_ORIGIN) allowed.add(process.env.FMCG_UI_ORIGIN.replace(/\/$/u, ''));
  return allowed.has(origin.replace(/\/$/u, ''));
}

function bodyFields(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) {
    throw badInput('自动化请求包含无效字段。');
  }
  return body as Record<string, unknown>;
}

function runId(id: string): string {
  if (!runIdPattern.test(id)) throw badInput('运行 ID 无效。');
  return id;
}

export function registerAutomationRoutes(app: express.Express, scheduler: AutomationScheduler, pipeline?: NewsPipeline): void {
  app.use('/api/automation', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localOrigin(req)) return next(new StorageError('AUTOMATION_ORIGIN_FORBIDDEN', '仅允许本机可信页面访问自动化。', 403));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!req.is('application/json')) return next(new StorageError('AUTOMATION_JSON_REQUIRED', '自动化写入需要 JSON。', 415));
      if (!scheduler.matchesWriteToken(req.get('x-fmcg-automation-token'))) {
        return next(new StorageError('AUTOMATION_TOKEN_INVALID', '自动化操作令牌已失效，请刷新后重试。', 403));
      }
    }
    next();
  });
  app.use('/api/automation', express.json({ limit: '3mb', strict: true }));
  app.get('/api/automation/status', (_req, res) => { res.json(scheduler.status()); });
  app.get('/api/automation/schedules', (_req, res) => { res.json(scheduler.schedules()); });
  app.patch('/api/automation/schedules/:type', async (req, res) => {
    const input = bodyFields(req.body, ['revision', 'enabled', 'plan', 'catchUp']);
    const { revision, enabled, plan, catchUp } = input;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
      || (enabled !== undefined && typeof enabled !== 'boolean') || (plan !== undefined && !isAutomationPlan(plan))
      || (catchUp !== undefined && typeof catchUp !== 'boolean') || Object.keys(input).length === 1) {
      throw badInput('请填写有效计划、开关或补跑选项及其版本。');
    }
    const patch: AutomationSchedulePatch = { revision, enabled, plan, catchUp };
    res.json(await scheduler.patchSchedule(req.params.type, patch));
  });
  for (const action of ['pause', 'resume'] as const) {
    app.post(`/api/automation/${action}`, async (req, res) => {
      if (bodyFields(req.body, ['confirm']).confirm !== true) throw badInput('请先确认自动化状态变更。');
      res.json(await scheduler.setPaused(action === 'pause'));
    });
  }
  app.post('/api/automation/tasks/:type/run', async (req, res) => {
    bodyFields(req.body, []);
    res.status(202).json(await scheduler.runNow(req.params.type));
  });
  app.get('/api/automation/runs', async (req, res) => {
    const { type, status, limit } = req.query;
    if (type !== undefined && (typeof type !== 'string' || !type)) throw badInput('任务类型过滤无效。');
    const parsedStatus = automationRunStatuses.find(item => item === status);
    if (status !== undefined && !parsedStatus) throw badInput('运行状态过滤无效。');
    const parsedLimit = limit === undefined ? 50 : typeof limit === 'string' && /^\d+$/u.test(limit) ? Number(limit) : NaN;
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) throw badInput('运行记录数量必须介于 1 和 200。');
    res.json(await scheduler.listRuns({ type, status: parsedStatus, limit: parsedLimit }));
  });
  app.get('/api/automation/runs/:id', async (req, res) => { res.json(await scheduler.getRun(runId(req.params.id))); });
  app.post('/api/automation/runs/:id/cancel', async (req, res) => {
    bodyFields(req.body, []);
    res.json(await scheduler.cancel(runId(req.params.id)));
  });
  if (!pipeline) return;
  app.get('/api/automation/candidates', async (req, res) => {
    const date = req.query.date;
    if (date !== undefined && typeof date !== 'string') throw badInput('日期无效。');
    res.json(await pipeline.list(date));
  });
  app.get('/api/automation/pipeline/settings', async (_req, res) => { res.json(await pipeline.settings()); });
  app.patch('/api/automation/pipeline/settings', async (req, res) => {
    const input = bodyFields(req.body, ['revision', 'preScreenEnabled', 'topics', 'concurrency']);
    const { revision, preScreenEnabled, topics, concurrency } = input;
    if (!isRevision(revision) || Object.keys(input).length < 2 || (preScreenEnabled !== undefined && typeof preScreenEnabled !== 'boolean')
      || (topics !== undefined && !isTopics(topics)) || (concurrency !== undefined && !isConcurrency(concurrency))) {
      throw badInput('请提交有效的设置版本、预筛开关、关注主题或并发数。');
    }
    res.json(await pipeline.updateSettings({ revision, ...(preScreenEnabled === undefined ? {} : { preScreenEnabled }),
      ...(topics === undefined ? {} : { topics }), ...(concurrency === undefined ? {} : { concurrency }) }));
  });
  app.post('/api/automation/candidates/confirm', async (req, res) => {
    const { requestId, candidateIds, organize, mode } = bodyFields(req.body, ['requestId', 'candidateIds', 'organize', 'mode']);
    if (typeof requestId !== 'string' || !runIdPattern.test(requestId) || !Array.isArray(candidateIds) || candidateIds.length > 100
      || candidateIds.some(id => typeof id !== 'string') || typeof organize !== 'boolean' || !isNewsMode(mode)) {
      throw badInput('请提交有效的候选条目、整理选项及请求 ID。');
    }
    res.status(202).json(await pipeline.confirm({ requestId, candidateIds, organize, mode }));
  });
  app.post('/api/automation/candidates/:id/disposition', async (req, res) => {
    const { action } = bodyFields(req.body, ['action']);
    if (action !== 'ignore' && action !== 'later' && action !== 'restore') throw badInput('候选操作无效。');
    res.json(await pipeline.disposition(req.params.id, action));
  });
  for (const [action, stage] of [['retry-save', 'raw'], ['retry-organize', 'organize']] as const) {
    app.post(`/api/automation/candidates/:id/${action}`, async (req, res) => {
      bodyFields(req.body, []);
      res.status(202).json(await pipeline.retry(req.params.id, stage));
    });
  }
}
