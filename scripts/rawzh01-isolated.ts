import { mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { get as readHttp } from 'node:http';
import { AssetStore } from '../services/raw/assets.ts';
import { readPublicRawUrl } from '../services/raw/url-import.ts';
import { registerRawImportRoute } from '../server/raw-import.ts';
import { registerRawTranslationRoutes } from '../server/raw-translations.ts';
import { RawTranslationService } from '../services/raw/translations.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
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
const root = await mkdtemp(path.join(os.tmpdir(), 'rawzh01-ui-'));
const envDir = await mkdtemp(path.join(os.tmpdir(), 'rawzh01-ui-empty-env-'));
const outDir = await mkdtemp(path.join(os.tmpdir(), 'rawzh01-ui-dist-'));
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
const assets = new AssetStore(root);
await assets.initialize();
const host = 'rawzh-fixture.example';
const english =
  'Store channel report. Contracted locations increased by 56 this year.\n\nOnly newly signed stores are included. Previously signed stores are not included.';
const chinese = '门店渠道报告。今年签约门店增加 56 家。\n\n统计仅包含本年新签约门店，不包含以前已签约的门店。';
const failedEnglish =
  'Failure exercise. The test article reports 24 stores in the northern region.\n\nOnline sales were not included in this count.';
const recovered = '失败恢复样例。北部区域统计了 24 家门店。\n\n本次统计未包含线上销售。';
const slowEnglish =
  'Cancellation exercise. This longer report has a deliberately delayed translation call. It covers the southern region only.';
const fixtureUrl = (pathname: string) => 'https://' + host + '/' + pathname;
const fixtures = {
  english: fixtureUrl('english'),
  optedOut: fixtureUrl('opt-out'),
  chinese: fixtureUrl('chinese'),
  fail: fixtureUrl('fail'),
  slow: fixtureUrl('slow'),
  unavailable: fixtureUrl('unavailable'),
  original: english,
  translated: chinese,
  failedOriginal: failedEnglish,
  recovered,
};
const fixture = express();
const network: string[] = [];
fixture.use((req, _res, next) => {
  network.push(req.path);
  next();
});
for (const [route, title, body] of [
  ['english', 'English Channel Report', english],
  ['opt-out', 'English Only Report', english],
  ['chinese', '中文渠道报告', chinese],
  ['fail', 'Translation Retry Report', failedEnglish],
  ['slow', 'Translation Cancellation Report', slowEnglish],
]) {
  fixture.get('/' + route, (_req, res) =>
    res.type('html').send(
      '<!doctype html><title>' +
        title +
        '</title><article>' +
        body
          .split('\n\n')
          .map((line) => '<p>' + line + '</p>')
          .join('') +
        '</article>',
    ),
  );
}
fixture.get('/unavailable', (_req, res) => res.sendStatus(503));
const translationRequests: Array<{ index: number; total: number; body: string }> = [];
let failedOnce = false;
let providerAvailable = true;
const translator: LlmProvider = {
  name: 'fake',
  model: 'rawzh01-fake',
  complete: async (request) => {
    const payload = JSON.parse(request.user);
    if (payload.stage !== 'raw_translation') throw Error('Only raw_translation allowed for this fake');
    translationRequests.push({ index: payload.index, total: payload.total, body: payload.body });
    await new Promise((resolve) => setTimeout(resolve, payload.body.includes('Cancellation exercise') ? 2800 : 850));
    request.signal?.throwIfAborted();
    if (payload.body.includes('Failure exercise') && !failedOnce) {
      failedOnce = true;
      throw Error('RAWZH01 controlled translation failure');
    }
    const body = payload.body.includes('Failure exercise')
      ? recovered
      : payload.body.includes('Cancellation exercise')
        ? '取消样例。本报告仅覆盖南部区域。'
        : chinese;
    const text = JSON.stringify({ translation: body });
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
  },
};
const translations = new RawTranslationService({
  root,
  raws: f.rawStore,
  provider: async () => (providerAvailable ? translator : undefined),
});
const web = fixture.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => web.once('listening', resolve));
const webPort = (web.address() as AddressInfo).port;
const app = express();
app.use(express.json({ limit: '3mb' }));
registerRawTranslationRoutes(app, translations);
registerRawImportRoute(app, {
  store: f.rawStore,
  assets,
  translations,
  readUrl: (url) =>
    readPublicRawUrl(url, {
      resolve: async (hostname) => (hostname === host ? [{ address: '93.184.216.34', family: 4 }] : []),
      request: (target, _address, signal) =>
        new Promise((resolve, reject) => {
          if (target.hostname !== host) {
            reject(Error('Only the isolated fixture host is enabled'));
            return;
          }
          readHttp(
            { hostname: '127.0.0.1', port: webPort, path: target.pathname + target.search, agent: false, signal },
            (reply) => {
              resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body: reply });
            },
          ).once('error', reject);
        }),
    }),
});
app.post('/__control/provider', (req, res) => {
  providerAvailable = req.body.available !== false;
  res.json({ available: providerAvailable });
});
app.get('/__control/counters', (_req, res) =>
  res.json({
    network,
    translation: translationRequests,
    extraction: f.requests.length,
    realProviderCalls: 0,
    configuration: 'not-connected',
  }),
);
app.get('/api/raw/assets', async (_req, res) => res.json({ items: await assets.list() }));
app.post('/api/raw', async (req, res) => res.status(201).json(await f.rawStore.create(validateRaw(req.body))));
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
    model: 'rawzh01-fake',
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
const close = () => server.close(() => web.close(() => process.exit(0)));
process.on('SIGINT', close);
process.on('SIGTERM', close);
