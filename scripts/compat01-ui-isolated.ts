import { mkdtemp } from 'node:fs/promises';
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
import { lwFixture } from '../tests/lw01-fixture.ts';

for (const key of Object.keys(process.env)) {
  if (/(?:OPENAI|ANTHROPIC|GEMINI|PROVIDER|LLM_|AI_API|API_KEY)/i.test(key)) delete process.env[key];
}
const root = await mkdtemp(path.join(os.tmpdir(), 'compat01-ui-'));
const envDir = await mkdtemp(path.join(os.tmpdir(), 'compat01-ui-empty-env-'));
const outDir = await mkdtemp(path.join(os.tmpdir(), 'compat01-ui-dist-'));
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
const theme = '渠道覆盖';
const first = await f.rawStore.create({
  title: 'COMPAT01 渠道访谈 A',
  sourceType: 'report',
  sourceName: '虚构渠道访谈',
  tags: [theme],
  body: '2025年渠道覆盖100家，按有效门店统计。',
});
const second = await f.rawStore.create({
  title: 'COMPAT01 渠道报告 B',
  sourceType: 'report',
  sourceName: '虚构渠道报告',
  tags: [theme],
  body: '2026年渠道覆盖120家，按签约门店统计。\n另一报告称2026年渠道覆盖90家，统计口径待核。',
});

const app = express();
app.use(express.json());
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
    model: 'compat01-fake',
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
console.log(
  JSON.stringify(
    {
      pid: process.pid,
      url,
      api: url,
      root,
      envDir,
      outDir,
      fixtures: { a: first.id, b: second.id, theme },
      provider: 'fake-only',
      configLoader: 'not-connected',
    },
    null,
    2,
  ),
);
