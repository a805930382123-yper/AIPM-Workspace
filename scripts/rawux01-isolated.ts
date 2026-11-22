import { mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import express from 'express';
import { build } from 'vite';
import { registerHomeRoutes } from '../server/home-api.ts';
import { registerKnowledgeRoutes } from '../server/knowledge-api.ts';
import { registerB04Routes } from '../server/llm-api.ts';
import { validateBaseRevision, validateWikiInput } from '../server/wiki-validation.ts';
import { LLMService } from '../services/llm/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { getStats } from '../services/stats/index.ts';
import { validateRaw } from '../server/validation.ts';
import { lwFixture } from '../tests/lw01-fixture.ts';

for (const key of Object.keys(process.env)) {
  if (/(?:OPENAI|ANTHROPIC|GEMINI|PROVIDER|LLM_|AI_API|API_KEY)/i.test(key)) delete process.env[key];
}
const root = await mkdtemp(path.join(os.tmpdir(), 'rawux01-ui-'));
const envDir = await mkdtemp(path.join(os.tmpdir(), 'rawux01-ui-empty-env-'));
const outDir = await mkdtemp(path.join(os.tmpdir(), 'rawux01-ui-dist-'));
await build({
  configFile: false,
  root: process.cwd(),
  envDir,
  plugins: [react()],
  build: { outDir, emptyOutDir: true },
});
const f = await lwFixture(root),
  prompts = new PromptStore(root);
await prompts.initialize();
const seed = (title: string, body: string) =>
  f.rawStore.create({ title, body, sourceType: 'report', sourceName: 'RAWUX01 虚构样例', tags: ['渠道'] });
const standard = await seed('旧标准草稿 · 虚构配送资料', '虚构仓库每周一派送。\n\n虚构门店退货需记录批号。');
const deep = await seed(
  '旧深度草稿 · 虚构渠道资料',
  Array.from(
    { length: 32 },
    (_, i) => '第 ' + (i + 1) + ' 个虚构渠道样点记录 ' + (i + 20) + ' 箱商品，统计口径按本样点计。',
  ).join('\n\n'),
);
const sourceOnly = await seed(
  '仅来源笔记 · 虚构深度资料',
  '虚构工厂按照到货日期核对批次。\n\n虚构供应商周五上传交付清单。',
);
const legacy = async (raw: typeof deep, mode: 'standard' | 'deep', topics: string[], oldApprovals = 0) => {
  f.setTopics(topics);
  let record = await f.generate(raw.id, mode);
  delete record.maintenance;
  delete record.noteApproval;
  if (raw.id !== sourceOnly.id)
    record.pages.forEach((page) => {
      page.selected = true;
    });
  await writeFile(path.join(root, 'drafts', record.id + '.json'), JSON.stringify(record));
  for (const page of record.pages.slice(0, oldApprovals))
    record = await f.drafts.reviewOperation(
      record.id,
      {
        action: 'page',
        baseRevision: record.revision,
        pageId: page.pageId,
        reviewContentDigest: f.drafts.contentDigest(record),
        confirmed: true,
      },
      { body: raw.body, rulesDir: 'rules' },
    );
  return record;
};
const oldStandard = await legacy(standard, 'standard', ['旧配送约定', '旧退货口径']);
const oldDeep = await legacy(
  deep,
  'deep',
  Array.from({ length: 10 }, (_, i) => '旧渠道样点 ' + (i + 1)),
  2,
);
const oldSourceOnly = await legacy(sourceOnly, 'deep', ['旧供货批次', '旧交付清单']);
f.setTopics(['新渠道覆盖', '新门店运营']);
const fixtures = {
  standard: standard.id,
  deep: deep.id,
  sourceOnly: sourceOnly.id,
  oldStandard: oldStandard.id,
  oldDeep: oldDeep.id,
  oldSourceOnly: oldSourceOnly.id,
};
let providerDelay = 0,
  failSave = false,
  failCommit = false;
const complete = f.provider.complete.bind(f.provider);
f.provider.complete = async (request) => {
  if (providerDelay) await new Promise((resolve) => setTimeout(resolve, providerDelay));
  return complete(request);
};
const rebuild = f.wiki.rebuildIndexLocked.bind(f.wiki);
f.wiki.rebuildIndexLocked = async () => {
  if (failCommit) {
    failCommit = false;
    throw Error('RAWUX01 controlled synthetic index failure');
  }
  return rebuild();
};

const app = express();
app.use(express.json({ limit: '3mb' }));
const rejectSave: express.RequestHandler = (_req, res, next) => {
  if (!failSave) {
    next();
    return;
  }
  failSave = false;
  res.status(503).json({ error: { code: 'RAWUX01_TEST_WRITE_FAILED', message: '本次草稿写入失败，请重试。' } });
};
app.patch('/api/drafts/:id', rejectSave);
app.post('/api/knowledge/drafts/:id/changes/review', rejectSave);
app.post('/__control/delay', (req, res) => {
  providerDelay = Math.min(3000, Math.max(0, Number(req.body.ms) || 0));
  res.json({ ok: true });
});
app.post('/__control/fail-provider', (req, res) => {
  f.failOnce(req.body.stage ?? 'maintenance');
  res.json({ ok: true });
});
app.post('/__control/fail-save', (_req, res) => {
  failSave = true;
  res.json({ ok: true });
});
app.post('/__control/fail-commit', (_req, res) => {
  failCommit = true;
  res.json({ ok: true });
});
app.post('/__control/recover', async (_req, res) => res.json(await f.commits.reconcile()));
app.post('/api/raw', async (req, res) => res.status(201).json(await f.rawStore.create(validateRaw(req.body))));
app.get('/__control/requests', (_req, res) => res.json(f.requests));
app.get('/__control/counters', (_req, res) =>
  res.json({ provider: f.requests.length, configuration: 'not-connected', realProviderCalls: 0 }),
);
app.get('/api/raw', async (_req, res) => res.json({ items: await f.rawStore.list() }));
app.get('/api/raw/:id', async (req, res) => {
  const raw = await f.rawStore.get(req.params.id);
  if (!raw) return res.sendStatus(404);
  res.json(raw);
});
app.get('/api/stats', async (_req, res) => res.json(await getStats(root, f.rawStore, new Date(), prompts)));
app.get('/api/recovery-issues', (_req, res) => res.json({ items: [], overflow: false }));
app.get('/api/wiki/schema', async (_req, res) => res.json(await f.wiki.schema()));
app.get('/api/wiki', async (req, res) =>
  res.json({
    items: await f.wiki.list({ q: typeof req.query.q === 'string' ? req.query.q : undefined }),
    categoryCounts: await f.wiki.categoryCounts(),
  }),
);
app.get('/api/wiki/:id/references', async (req, res) => res.json({ items: await f.wiki.references(req.params.id) }));
app.get('/api/wiki/:id', async (req, res) => {
  const page = await f.wiki.get(req.params.id);
  if (!page) return res.sendStatus(404);
  res.json({
    ...page,
    links: (await f.wiki.links(page.id)).map((link) => ({
      target: link.text,
      status: link.status === 'found' ? 'resolved' : link.status,
      candidates: link.candidates,
    })),
  });
});
app.put('/api/wiki/:id', async (req, res) =>
  res.json(
    await f.wiki.update(req.params.id, validateBaseRevision(req.body.baseRevision), validateWikiInput(req.body)),
  ),
);
app.get('/api/audits', (_req, res) => res.json({ items: [] }));
app.get('/api/llm/config', (_req, res) =>
  res.json({
    configured: true,
    keyConfigured: false,
    provider: 'fake',
    model: 'rawux01-fake',
    missing: [],
    source: 'none',
  }),
);
registerB04Routes(app, {
  root,
  rawStore: f.rawStore,
  rawStates: f.rawStates,
  drafts: f.drafts,
  jobs: f.jobs,
  runner: f.runner,
  rulesDir: path.resolve('rules'),
  provider: () => f.provider,
  llm: new LLMService('rules'),
  commits: f.commits,
  wikiStore: f.wiki,
});
registerKnowledgeRoutes(app, { root, raws: f.rawStore, drafts: f.drafts, wiki: f.wiki, provider: () => f.provider });
registerHomeRoutes(app, { root, raws: f.rawStore, wiki: f.wiki, runner: f.runner, prompts });
app.use(express.static(outDir));
app.use(((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message, details: error.details } });
}) as express.ErrorRequestHandler);

const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const session = {
  pid: process.pid,
  url,
  api: url,
  root,
  envDir,
  outDir,
  fixtures,
  provider: 'fake-only',
  configLoader: 'not-connected',
};
await writeFile(path.join(root, 'isolated-session.json'), JSON.stringify(session, null, 2));
console.log(JSON.stringify(session, null, 2));
const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
