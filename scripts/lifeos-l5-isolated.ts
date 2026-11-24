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
    : await mkdtemp(path.join(os.tmpdir(), 'lifeos-l5-'));
const rel = path.relative(await realpath(os.tmpdir()), await realpath(root));
if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Isolated root must be inside TEMP');
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
const provider = () => {
  providerCalls++;
  throw Error('L5 feedback must not access Provider');
};
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
  draftRules: async () => ({
    types: [],
    categories: [],
    knowledge_status: [],
    confidence: [],
    source_level: [],
    review_status: [],
  }),
});
const commits = new WikiCommitService({ root, wikiStore: wiki, drafts, rawStates, rawStore: raws });
await commits.initialize();
await commits.reconcile();
let fixtures: { mainPromptId: string; otherPromptId: string; recyclePromptId: string; legacyPromptId: string };
const fixtureFile = path.join(root, 'fixtures.json');
if (!reuse) {
  const input = {
    name: 'L5 主测试Prompt',
    category: 'customer',
    scenario: '虚构访谈',
    body: '主测试第一版正文',
    inputRequirements: '材料',
    outputRequirements: '问题清单',
    relatedWikiIds: [],
    examples: '',
    tags: [],
    favorite: false,
  };
  const main = (await prompts.create(randomUUID(), input)).prompt;
  await prompts.update(main.id, 1, { ...input, body: '主测试第二版正文' });
  const other = (await prompts.create(randomUUID(), { ...input, name: 'L5 其他Prompt', body: '其他对象正文' })).prompt;
  const legacy = (await prompts.create(randomUUID(), { ...input, name: 'L5 旧无反馈Prompt' })).prompt;
  const recycle = (await prompts.create(randomUUID(), { ...input, name: 'L5 已回收Prompt' })).prompt;
  await prompts.createFeedback(recycle.id, {
    id: randomUUID(),
    promptVersion: 1,
    usedOn: '2026-10-31',
    scenario: '回收前使用',
    outcome: 'unverified',
    observation: '回收文件内保留的虚构反馈',
    nextImprovement: '',
  });
  await prompts.delete(recycle.id, 1);
  await wiki.create({
    title: 'L5 原有知识',
    type: 'concept',
    category: 'industry_basics',
    sources: [],
    tags: [],
    aliases: [],
    knowledge_status: 'needs_verification',
    confidence: 'low',
    source_level: 'D',
    review_status: 'unreviewed',
    body: '知识库内容不能被反馈修改。',
  });
  fixtures = { mainPromptId: main.id, otherPromptId: other.id, recyclePromptId: recycle.id, legacyPromptId: legacy.id };
  await writeFile(fixtureFile, JSON.stringify(fixtures, null, 2));
} else {
  let loaded: typeof fixtures | undefined;
  try {
    loaded = JSON.parse(await readFile(fixtureFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (loaded) {
    fixtures = loaded;
  } else {
    const active = await prompts.list();
    const recycled = await Promise.all(
      (await readdir(path.join(root, 'prompts', 'recycle')))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => JSON.parse(await readFile(path.join(root, 'prompts', 'recycle', name), 'utf8'))),
    );
    const find = (name: string) => {
      const prompt = active.find((p) => p.name === name);
      if (!prompt) throw Error('Restored fixture missing: ' + name);
      return prompt.id;
    };
    const recycledPrompt = recycled.find((p) => p.current.name === 'L5 已回收Prompt');
    if (!recycledPrompt) throw Error('Restored recycled fixture missing');
    fixtures = {
      mainPromptId: find('L5 主测试Prompt'),
      otherPromptId: find('L5 其他Prompt'),
      legacyPromptId: find('L5 旧无反馈Prompt'),
      recyclePromptId: recycledPrompt.id,
    };
  }
}
const app = express();
app.use(express.json({ limit: '3mb' }));
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
    items: await wiki.list({ q: typeof req.query.q === 'string' ? req.query.q : undefined }),
    categoryCounts: await wiki.categoryCounts(),
  }),
);
app.get('/api/wiki/:id', async (req, res) => {
  const item = await wiki.get(req.params.id);
  if (!item) return res.sendStatus(404);
  res.json(item);
});
app.get('/api/recovery-issues', (_req, res) => res.json({ items: [], overflow: false }));
registerHomeRoutes(app, { root, raws, wiki, runner });
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
const envDir = await mkdtemp(path.join(os.tmpdir(), 'lifeos-l5-env-'));
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
  restart: `npx tsx scripts/lifeos-l5-isolated.ts --root "${root}"`,
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
