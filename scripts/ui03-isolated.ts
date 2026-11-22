/** Full React App and real Prompt/API/stores. No product configuration loader or real Provider. */
import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { deepReply } from '../tests/support/kb03-deep-fixture.ts';
import { atomicFault } from '../tests/support/kb02-storage-fault.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { AuditService } from '../services/audit/service.ts';
import { registerAuditRoutes } from '../server/audit-api.ts';
import { validateWikiInput, validateBaseRevision } from '../server/wiki-validation.ts';
import { validateRaw } from '../server/validation.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { MeetingRawBridge } from '../services/meeting/raw-bridge.ts';
import { registerMeetingRoutes, registerMeetingMinutesRoutes } from '../server/meeting-api.ts';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { ExtractionRunner, ExtractionJobStore } from '../services/llm/jobs.ts';
import { LLMService } from '../services/llm/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import { getStats } from '../services/stats/index.ts';
import { registerHomeRoutes } from '../server/home-api.ts';
import { registerB04Routes } from '../server/llm-api.ts';
import { registerKnowledgeRoutes } from '../server/knowledge-api.ts';
import { registerPromptRoutes } from '../server/prompt-api.ts';
import { registerPromptAiRoutes } from '../server/prompt-ai-api.ts';
import { requireUuid } from '../services/prompt/validate.ts';
const reuse = process.argv.includes('--root'),
  root = reuse
    ? path.resolve(process.argv[process.argv.indexOf('--root') + 1])
    : await mkdtemp(path.join(os.tmpdir(), 'ui03-'));
const rel = path.relative(await realpath(os.tmpdir()), await realpath(root));
if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Isolated root must be inside TEMP');
const meetings = new MeetingStore(root);
await meetings.initialize();
const raws = new RawStore(root),
  rawStates = new RawStateStore(root),
  drafts = new DraftStore(root),
  jobs = new ExtractionJobStore(root);
await Promise.all([raws.initialize(), rawStates.initialize(), drafts.initialize(), jobs.initialize()]);
const wiki = new WikiStore(root, raws);
await wiki.initialize();
const prompts = new PromptStore(root, wiki);
await prompts.initialize();
let providerCalls = 0;
let seeding = false;
const requestFile = path.join(root, 'fake-prompt-requests.jsonl');
const fake = {
  name: 'fake',
  model: 'ui03-fake',
  secrets: [],
  complete: async (request: any) => {
    providerCalls++;
    await fs.appendFile(requestFile, JSON.stringify({ system: request.system, user: request.user }) + '\n');
    const brief = {
      taskName: '虚构访谈',
      taskType: '客户访谈',
      role: '待用户补充',
      goal: '核实订货流程',
      context: '待用户补充',
      input: '待用户提供',
      tasks: '逐项询问',
      constraints: '不得编造',
      output: '访谈提纲',
    };
    const content = {
      version: 1,
      name: '虚构访谈提示',
      category: 'customer',
      scenario: '经销商访谈',
      sections: [{ heading: '目标', content: '按用户要求整理访谈提纲。' }],
      inputRequirements: '访谈资料',
      outputRequirements: '问题清单',
      examples: '',
      tags: ['访谈'],
    };
    const checks = {
      version: 1,
      checks: [
        'goal',
        'role',
        'context',
        'input',
        'tasks',
        'constraints',
        'output',
        'fact_inference',
        'anti_fabrication',
      ].map((id) => ({ id, status: 'missing', evidence: '虚构测试：未提供' })),
      improvements: [{ dimensionId: 'goal', issue: '目标待补充', action: '明确目标' }],
    };
    let result: any;
    if (seeding) {
      if (request.system.startsWith('KB03 ')) result = deepReply(request);
      else {
        const p = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
        if (request.user.includes('请对下列全部已验证事实规划知识页'))
          result = {
            version: 3,
            document: { source_level: 'D', title: '虚构来源笔记', main_topic: '虚构指标' },
            pages: [
              {
                title: '虚构指标',
                type: 'metric',
                category: 'metric',
                factUnitIds: p.factUnits.map((x: any) => x.id),
                questionUnitIds: p.questionUnits.map((x: any) => x.id),
              },
            ],
          };
        else
          result = {
            version: 2,
            facts: p.map((x: any) => ({ atomId: x.id, kind: 'fact' })),
            questions: [],
            sourceNotes: [],
          };
      }
    } else
      result = request.system.includes('结构化 Prompt Brief')
        ? brief
        : request.system.includes('九个维度')
          ? checks
          : content;
    const text = JSON.stringify(result);
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' as const };
  },
};
const provider = () => fake;
const ai = new PromptAiService(root, wiki, prompts, provider);
await ai.initialize();
const runner = new ExtractionRunner({
  root,
  rawStore: raws,
  rawStates,
  drafts,
  jobs,
  llm: new LLMService('rules'),
  rulesDir: 'rules',
  provider,
  draftRules: async () => {
    const b = await loadExtractionRules('rules');
    return { types: ['metric'], categories: ['metric'], ...b.fmcg.enums } as any;
  },
});
const commits = new WikiCommitService({ root, wikiStore: wiki, drafts, rawStates, rawStore: raws });
await commits.initialize();
await commits.reconcile();
const audits = new AuditService(root, wiki, raws);
await audits.initialize();
const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
await workflows.initialize();
let fixtures: any;
const fixtureFile = path.join(root, 'fixtures.json');
if (!reuse) {
  const base = {
    type: 'concept' as const,
    category: 'industry_basics',
    sources: [],
    tags: [],
    aliases: [],
    knowledge_status: 'needs_verification' as const,
    confidence: 'low' as const,
    source_level: 'D' as const,
    review_status: 'unreviewed' as const,
    body: '## 虚构业务概念\n\n这是一段用于界面验证的虚构知识。\n\n### 使用时注意\n\n- 检查来源\n- 确认业务口径\n\n> 待核实内容保留来源边界。\n\n```text\n示例代码\n```\n\n<script>window.bad = true</script>',
  };
  const wikiRows = [];
  const values = [
    ['界外开始', '2026-10-25T15:59:59.999Z', 'outside'],
    ['界内开始', '2026-10-25T16:00:00.000Z', 'inside'],
    ['界内结束', '2026-11-01T15:59:59.999Z', 'inside'],
    ['界外结束', '2026-11-01T16:00:00.000Z', 'outside'],
    ['纯日期', '2026-10-30', 'inside'],
    ['无日期', undefined, 'undated'],
    ['模糊日期', '2026-10-30T10:00:00', 'undated'],
  ] as const;
  for (const [title, created, expected] of values) {
    const page = await wiki.create({ ...base, title: 'L6 ' + title });
    await wiki.writePageLocked({ ...page, created } as any);
    wikiRows.push({ id: page.id, title: page.title, expected });
  }
  const recycled = await wiki.create({ ...base, title: 'L6 已回收Wiki' });
  await wiki.delete(recycled.id, 1);
  wikiRows.push({ id: recycled.id, title: recycled.title, expected: 'recycled' });
  const input = {
    name: 'L6 历史版本Prompt',
    category: 'customer',
    scenario: '虚构场景',
    body: '第一版',
    inputRequirements: '资料',
    outputRequirements: '问题',
    relatedWikiIds: [],
    examples: '',
    tags: [],
    favorite: false,
  };
  const main = (await prompts.create(randomUUID(), input)).prompt;
  await prompts.update(main.id, 1, { ...input, body: '第二版' });
  const feedback = [];
  for (const [index, usedOn] of ['2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'].entries()) {
    const id = randomUUID(),
      promptVersion = index === 1 ? 1 : 2;
    await prompts.createFeedback(main.id, {
      id,
      promptVersion,
      usedOn,
      scenario: '虚构场景',
      outcome: ['helpful', 'needs_revision', 'not_applicable', 'unverified'][index],
      observation: '用户观察 ' + index,
      nextImprovement: '下次改进 ' + index,
    });
    feedback.push({
      id,
      promptId: main.id,
      promptVersion,
      usedOn,
      expected: index === 1 || index === 2 ? 'inside' : 'outside',
    });
  }
  const deletedId = randomUUID();
  await prompts.createFeedback(main.id, {
    id: deletedId,
    promptVersion: 1,
    usedOn: '2026-10-30',
    scenario: '已删除',
    outcome: 'helpful',
    observation: '已删除',
    nextImprovement: '',
  });
  await prompts.deleteFeedback(main.id, deletedId, { baseRevision: 1 });
  feedback.push({ id: deletedId, promptId: main.id, promptVersion: 1, expected: 'deleted' });
  const legacy = (await prompts.create(randomUUID(), { ...input, name: 'L6 旧无反馈Prompt' })).prompt;
  const recycledPrompt = (await prompts.create(randomUUID(), { ...input, name: 'L6 已回收Prompt' })).prompt;
  const recycledFeedback = randomUUID();
  await prompts.createFeedback(recycledPrompt.id, {
    id: recycledFeedback,
    promptVersion: 1,
    usedOn: '2026-10-30',
    scenario: '回收',
    outcome: 'helpful',
    observation: '回收记录',
    nextImprovement: '',
  });
  await prompts.delete(recycledPrompt.id, 1);
  feedback.push({ id: recycledFeedback, promptId: recycledPrompt.id, promptVersion: 1, expected: 'recycled' });
  const raw = await raws.create({
    title: 'L6 周期外当前待办',
    sourceType: 'report',
    sourceName: '虚构来源',
    tags: [],
    body: '虚构原文',
  });
  await rawStates.set(raw.id, { status: 'failed', reason: 'fixture' });
  const stateFile = path.join(root, 'state', 'raw-processing', raw.id + '.json');
  const stateRecord = JSON.parse(await readFile(stateFile, 'utf8'));
  stateRecord.updatedAt = '2026-09-01T00:00:00.000Z';
  await writeFile(stateFile, JSON.stringify(stateRecord, null, 2));
  const promptFile = path.join(root, 'prompts', main.id + '.json');
  const promptRecord = JSON.parse(await readFile(promptFile, 'utf8'));
  for (const item of promptRecord.feedback.items) {
    item.createdAt = '2026-09-01T00:00:00.000Z';
    item.updatedAt = '2026-09-01T00:00:00.000Z';
  }
  await writeFile(promptFile, JSON.stringify(promptRecord, null, 2));
  fixtures = {
    period: { start: '2026-10-26', end: '2026-11-02' },
    wiki: wikiRows,
    feedback,
    legacyPromptId: legacy.id,
    mainPromptId: main.id,
    recycledPromptId: recycledPrompt.id,
    pendingRawId: raw.id,
  };
  await writeFile(fixtureFile, JSON.stringify(fixtures, null, 2));
} else fixtures = JSON.parse(await readFile(fixtureFile, 'utf8'));
if (!reuse) {
  const item = fixtures.wiki[0];
  const audit = await audits.create({
    wikiId: item.id,
    scope: 'page',
    severity: 'warning',
    comment: '虚构反馈：请核对业务口径',
  });
  fixtures.auditId = audit.id;
  const raw = await raws.create({
    title: 'UI01 虚构来源',
    sourceType: 'report',
    sourceName: '隔离测试',
    tags: [],
    body: '虚构原文用于核对来源。',
  });
  const deep = await wiki.create({
    title: 'UI01 虚构深度笔记',
    type: 'source',
    category: 'industry_basics',
    sources: [raw.id],
    tags: [],
    aliases: [],
    knowledge_status: 'needs_verification',
    confidence: 'low',
    source_level: 'D',
    review_status: 'unreviewed',
    body: '## 摘要\n\n虚构资料。\n\n## 深度整理笔记\n\n| 项目 | 说明 |\n| --- | --- |\n| 门店 | 待核实 |\n',
  });
  const draft = await drafts.create({
    raw,
    outcome: {
      document: { title: 'UI01 虚构草稿', main_topic: '虚构业务', summary: '待人工确认', source_level: 'D' },
      pages: [],
      warnings: [],
      rulesVersion: 'fixture',
      provider: { name: 'fake', model: 'none' },
      callCount: 0,
      chunkCount: 1,
    } as any,
    jobId: randomUUID(),
    body: raw.body,
    rules: { types: [], categories: [], knowledge_status: [], confidence: [], source_level: [], review_status: [] },
  });
  const catalog = await meetings.getCatalog();
  const meetingIds: Record<string, string> = {};
  for (const level of ['Public', 'Internal', 'Restricted']) {
    const result = await meetings.create({
      requestId: randomUUID(),
      title: 'UI02 虚构' + level + '会议',
      meeting_date: '2026-10-30',
      meeting_type: catalog.types[0].id,
      confidentiality: level,
    });
    meetingIds[level] = result.meeting.meeting_id;
  }
  const internal = meetingIds.Internal;
  const policy = await meetings.updatePolicy(internal, {
    baseRevision: 1,
    storage_mode: 'local_archive',
    local_storage_authorized: true,
    confirm_local_storage: true,
    raw_transfer_authorized: true,
    confirm_raw_transfer: true,
  });
  const minute = await meetings.importMinutes(internal, {
    baseRevision: policy.revision,
    requestId: randomUUID(),
    text: '# 虚构纪要\n\n讨论门店订货流程。',
  });
  const bridge = new MeetingRawBridge(meetings, raws);
  await bridge.register(internal, {
    baseRevision: minute.meeting.revision,
    requestId: randomUUID(),
    import_id: minute.imported.import_id,
    confirm: true,
  });
  const storageRaw = await raws.create({
    title: 'UI02 虚构保存恢复',
    sourceType: 'report',
    sourceName: '隔离来源',
    tags: [],
    body: '目标100家，在售20家。另一业务指标铺货率20%，负责人未知。',
  });
  const fault = atomicFault(root, 'done-checkpoint');
  seeding = true;
  const started = await runner.start(storageRaw.id, {
    newJobId: randomUUID(),
    now: new Date().toISOString(),
    mode: 'deep',
  });
  await runner.waitForSettlement(started.job.id);
  seeding = false;
  fault.restore();
  await runner.reconcileStorage(started.job.id);
  const recovered = await rawStates.get(storageRaw.id);
  fixtures.validDraftId = recovered.draftId;
  const now = new Date().toISOString();
  const baseWorkflow = {
    kind: 'update',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    provider: { name: 'fake', model: 'fake' },
    rawSnapshots: [{ id: raw.id, title: raw.title, bodySha256: raw.bodySha256 }],
    targetWikiId: deep.id,
    baseRevision: deep.revision,
    title: 'UI03 虚构更新审阅',
    category: deep.category,
    sources: [raw.id],
    sections: {
      existing: '已有虚构内容',
      newSource: raw.body,
      suggestedAdditions: ['需核对的整理'],
      conflicts: ['双方记录不同'],
      inferences: ['虚构推断'],
      openQuestions: ['待确认问题'],
      agreement: ['已有一致观点'],
      sourceList: [{ id: raw.id, title: raw.title }],
    },
  };
  const pendingWorkflowId = randomUUID(),
    conflictWorkflowId = randomUUID();
  await workflows.save({ ...baseWorkflow, id: pendingWorkflowId, status: 'pending_confirmation' } as any);
  await workflows.save({
    ...baseWorkflow,
    id: conflictWorkflowId,
    status: 'conflict',
    title: 'UI03 虚构提交冲突',
    commitOperationId: randomUUID(),
    lastCommitError: '虚构版本冲突，原记录未覆盖',
  } as any);
  fixtures.pendingWorkflowId = pendingWorkflowId;
  fixtures.conflictWorkflowId = conflictWorkflowId;
  fixtures.storageRawId = storageRaw.id;
  fixtures.storageJobId = started.job.id;
  fixtures.seedProviderCalls = providerCalls;
  fixtures.meetingIds = meetingIds;
  fixtures.deepWikiId = deep.id;
  fixtures.sourceRawId = raw.id;
  fixtures.draftId = draft.id;
  await writeFile(fixtureFile, JSON.stringify(fixtures, null, 2));
}
const app = express();
app.use(express.json({ limit: '3mb' }));
const configBase = () => ({
  provider: 'openai-compatible',
  baseUrlHost: null,
  baseUrl: '',
  model: null,
  keyConfigured: false,
  keyMask: '••••••••••••',
  configured: false,
  source: 'none',
  missing: ['FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL', 'FMCG_LLM_API_KEY'],
  configFile: '.env.local',
  envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' },
  revision: 'r1',
  writeToken: 'isolated-token',
  environmentLocked: false,
});
let config: any = configBase(),
  failGet = false,
  failSave = false;
const configEvents: any[] = [];
app.get('/__control/config', (_req, res) => res.json({ config, events: configEvents }));
app.post('/__control/config', (req, res) => {
  if (req.body.mode === 'locked') config = { ...config, environmentLocked: true, source: 'env' };
  if (req.body.mode === 'unlocked')
    config = { ...config, environmentLocked: false, source: config.configured ? 'local-file' : 'none' };
  if (req.body.mode === 'fail-get') failGet = true;
  if (req.body.mode === 'fail-save') failSave = true;
  res.json({ ok: true });
});
app.get('/api/llm/config', (_req, res) => {
  configEvents.push({ method: 'GET' });
  if (failGet) {
    failGet = false;
    return res.status(500).json({ error: { message: '虚构配置读取失败' } });
  }
  res.json(config);
});
app.put('/api/llm/config', (req, res) => {
  const { apiKey, ...body } = req.body;
  configEvents.push({ method: 'PUT', body, maskedKeyPresent: !!apiKey });
  if (failSave) {
    failSave = false;
    return res.status(500).json({ error: { message: '虚构配置保存失败' } });
  }
  config = {
    ...config,
    revision: 'r' + (configEvents.length + 1),
    baseUrl: body.baseUrl,
    baseUrlHost: body.baseUrl ? new URL(body.baseUrl).hostname : null,
    model: body.model,
    keyConfigured: !!apiKey || config.keyConfigured,
    configured: !!body.baseUrl && !!body.model && (!!apiKey || config.keyConfigured),
    source: 'local-file',
    missing: [],
  };
  res.json(config);
});
app.post('/api/llm/config/test', (req, res) => {
  configEvents.push({ method: 'TEST', body: req.body });
  res.json({ ok: true, message: '隔离模拟连接成功', elapsedMs: 0 });
});
app.delete('/api/llm/config', (req, res) => {
  configEvents.push({ method: 'DELETE', body: req.body });
  config = configBase();
  res.json(config);
});
app.get('/api/demo', (_req, res) =>
  res.json({ version: 1, imported: false, items: [], exampleTask: { title: '虚构示例', task: '虚构任务' } }),
);
const originalRename = fs.rename;
let failTarget: string | undefined;
fs.rename = async (from, to) => {
  if (failTarget && path.resolve(String(to)) === failTarget) {
    failTarget = undefined;
    throw Object.assign(Error('Isolated controlled Prompt atomic rename failure'), { code: 'EIO' });
  }
  return originalRename(from, to);
};
syncBuiltinESMExports();
app.get('/__control/counters', (_req, res) => res.json({ provider: providerCalls, config: 'not-connected' }));
app.post('/__control/fail-write', (req, res) => {
  const id = requireUuid(req.body.promptId, 'INVALID_ID', 'Prompt ID无效');
  failTarget = path.resolve(root, 'prompts', id + '.json');
  res.json({ ok: true });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, isolated: true }));
app.get('/api/raw', async (_req, res) => res.json({ items: await raws.list() }));
app.get('/api/stats', async (_req, res) => res.json(await getStats(root, raws, new Date(), prompts)));
app.get('/api/wiki/schema', async (_req, res) => res.json(await wiki.schema()));
app.get('/api/wiki', async (req, res) =>
  res.json({
    items: await wiki.list({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
    }),
    categoryCounts: await wiki.categoryCounts(),
  }),
);
app.post('/api/wiki', async (req, res) => res.status(201).json(await wiki.create(validateWikiInput(req.body))));
app.get('/api/wiki/:id/export', async (req, res) => {
  const value = await wiki.exportMarkdown(req.params.id);
  if (!value) return res.sendStatus(404);
  res.type('text/markdown').send(value.markdown);
});
app.get('/api/wiki/:id/references', async (req, res) => {
  const rows = await wiki.references(req.params.id);
  res.json({ items: [...new Map(rows.map((row) => [row.pageId, { id: row.pageId, title: row.title }])).values()] });
});
app.get('/api/wiki/:id', async (req, res) => {
  const item = await wiki.get(req.params.id);
  if (!item) return res.sendStatus(404);
  const links = (await wiki.links(item.id)).map((link) => ({
    target: link.text,
    status: link.status === 'found' ? 'resolved' : link.status,
    candidates: link.candidates,
  }));
  res.json({ ...item, links });
});
app.put('/api/wiki/:id', async (req, res) =>
  res.json(await wiki.update(req.params.id, validateBaseRevision(req.body?.baseRevision), validateWikiInput(req.body))),
);
app.delete('/api/wiki/:id', async (req, res) =>
  res.json(await wiki.delete(req.params.id, validateBaseRevision(req.body?.baseRevision))),
);
app.get('/api/raw/:id', async (req, res) => {
  const item = await raws.get(req.params.id);
  if (!item) return res.sendStatus(404);
  res.json(item);
});
app.post('/api/raw', async (req, res) => res.status(201).json(await raws.create(validateRaw(req.body))));
app.get('/api/recovery-issues', (_req, res) => res.json({ items: [], overflow: false }));
registerAuditRoutes(app, { root, audits, wiki, raws, provider });
registerMeetingMinutesRoutes(app, meetings);
registerMeetingRoutes(app, meetings, new MeetingRawBridge(meetings, raws));
registerHomeRoutes(app, { root, raws, wiki, runner, prompts });
registerB04Routes(app, {
  root,
  rawStore: raws,
  rawStates,
  drafts,
  jobs,
  runner,
  rulesDir: 'rules',
  provider,
  llm: new LLMService('rules'),
  commits,
  wikiStore: wiki,
});
registerKnowledgeRoutes(app, { root, raws, drafts, wiki, provider });
registerPromptRoutes(app, { store: prompts });
registerPromptAiRoutes(app, ai);
app.use(((error, _req, res, _next) =>
  res.status(error.status ?? 500).json({
    error: { code: error.code ?? 'ISOLATED_ERROR', message: error.message, details: error.details },
  })) as express.ErrorRequestHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const apiPort = (server.address() as AddressInfo).port;
const envDir = await mkdtemp(path.join(os.tmpdir(), 'ui03-env-'));
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  envDir,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
});
await vite.listen();
const uiPort = (vite.httpServer!.address() as AddressInfo).port;
const info = {
  pid: process.pid,
  url: `http://127.0.0.1:${uiPort}`,
  api: `http://127.0.0.1:${apiPort}`,
  root,
  reused: reuse,
  fixtures,
  counters: '/__control/counters',
  failWrite: 'POST /__control/fail-write {promptId}',
  restart: `npx tsx scripts/ui03-isolated.ts --root "${root}"`,
};
await writeFile(path.join(root, 'isolated-session.json'), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
const close = async () => {
  fs.rename = originalRename;
  syncBuiltinESMExports();
  await vite.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(0);
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
