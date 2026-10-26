// Standalone isolated services: never import server/index or real configuration.
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WikiCommitService } from '../../services/wiki/commits.ts';
import { ExtractionRunner, ExtractionJobStore } from '../../services/llm/jobs.ts';
import { LLMService } from '../../services/llm/service.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { registerB04Routes } from '../../server/llm-api.ts';
import { registerKnowledgeRoutes } from '../../server/knowledge-api.ts';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1] ?? '') : await mkdtemp(path.join(os.tmpdir(), 'r1618-fields-lab-'));
if (path.dirname(root).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(root).startsWith('r1618-fields-lab-')) throw new Error('Only this lab temporary directories are allowed.');
const rulesDir = path.resolve('rules'), metadataPath = path.join(root, 'r1618-lab.json');
const rawStore = new RawStore(root), rawStates = new RawStateStore(root), drafts = new DraftStore(root), jobs = new ExtractionJobStore(root);
await Promise.all([rawStore.initialize(), rawStates.initialize(), drafts.initialize(), jobs.initialize()]);
const wikiStore = new WikiStore(root, rawStore); await wikiStore.initialize();
const bundle = await loadExtractionRules(rulesDir);
const rules = { types: bundle.fmcg.types.map(t => t.id), categories: bundle.fmcg.categories.map(c => c.id), ...bundle.fmcg.enums };
let meta;
if (rootFlag >= 0) {
  meta = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (meta.kind !== 'r1618-fields-lab-v1' || meta.root !== root) throw new Error('Not a matching isolated lab.');
} else {
  const quotes = [
    '【虚构】门店补货是根据门店库存与需求补充商品的业务活动。',
    '【虚构】门店补货的目的是降低缺货风险；相关销量收益尚未确认。',
    '【虚构】当门店库存低于安全库存时，由店长发起补货申请。',
    '【虚构】店长输入补货单，库管核对可用库存后安排发货；异常审批负责人未知。AI尚未上线，仅为未来建议，收益未知。',
  ];
  const body = quotes.join('\n');
  const raw = await rawStore.create({ title: 'R16/R18 虚构人工字段资料', sourceType: 'note', sourceName: '人工合成隔离测试', body, tags: ['虚构', '字段编辑'] });
  const pages = ['concept', 'business_process'].map((type, index) => {
    const source_evidence = quotes.slice(index * 2, index * 2 + 2).map((quote, i) => ({ id: `${type}-e${i + 1}`, rawId: raw.id, quote, start: body.indexOf(quote), end: body.indexOf(quote) + quote.length, chunkIndex: 0, occurrences: 1 }));
    return { title: type === 'concept' ? '虚构门店补货概念' : '虚构门店补货流程', type, category: 'supply_chain', one_line_definition: type === 'concept' ? '原草稿标题式说明，尚未归位' : '原流程草稿说明',
      source_facts: source_evidence.map(e => ({ text: e.quote, evidenceIds: [e.id] })), source_evidence, ai_organized: [], ai_inferences: [], open_questions: ['异常负责人或收益仍待确认。'], related_pages: [], provenance: [] };
  });
  const draft = await drafts.create({ raw, body, rules, jobId: randomUUID(), outcome: { document: { title: '来源：虚构人工字段资料', main_topic: '补货', summary: quotes.join('') }, pages,
    provider: { name: 'disabled', model: 'manual-fixture-no-model' }, rulesVersion: 'r1618-fields-lab-v1', callCount: 0, chunkCount: 1,
    chunkCoverage: [{ index: 0, start: 0, end: body.length }], usage: { promptTokens: 0, completionTokens: 0 }, warnings: ['人工合成输入，不是模型自动质量证据。'] } });
  const rawText = await readFile(path.join(root, 'knowledge/raw/notes', `${raw.id}.md`), 'utf8');
  meta = { kind: 'r1618-fields-lab-v1', root, baseline: '439ae52', draftId: draft.id, rawId: raw.id, originalRawSha256: createHash('sha256').update(rawText).digest('hex'), originalPages: draft.pages.map(p => ({ pageId: p.pageId, source_facts: p.source_facts, source_evidence: p.source_evidence })), realCalls: 0, configReads: 0 };
  await writeFile(metadataPath, JSON.stringify(meta, null, 2) + '\n');
}
const provider = () => undefined;
const llm = new LLMService(rulesDir);
const runner = new ExtractionRunner({ root, jobs, drafts, rawStates, rawStore, rulesDir, provider, llm, draftRules: async () => rules });
const commits = new WikiCommitService({ root, wikiStore, drafts, rawStates, rawStore }); await commits.initialize();
const app = express(); app.use(express.json());
registerB04Routes(app, { root, rulesDir, provider, llm, runner, jobs, drafts, commits, rawStates, rawStore, wikiStore });
registerKnowledgeRoutes(app, { root, raws: rawStore, drafts, wiki: wikiStore, provider });
app.get('/api/raw', async (_req, res, next) => { try { res.json({ items: await rawStore.list() }); } catch (e) { next(e); } });
app.get('/api/raw/:id', async (req, res, next) => { try { const raw = await rawStore.get(req.params.id); raw ? res.json(raw) : res.sendStatus(404); } catch (e) { next(e); } });
app.get('/api/wiki/schema', async (_req, res, next) => { try { res.json(await wikiStore.schema()); } catch (e) { next(e); } });
app.get('/api/wiki', async (req, res, next) => { try { res.json({ items: await wikiStore.list({ q: req.query.q, category: req.query.category }), categoryCounts: await wikiStore.categoryCounts() }); } catch (e) { next(e); } });
app.get('/api/wiki/:id', async (req, res, next) => { try { const wiki = await wikiStore.get(req.params.id); wiki ? res.json(wiki) : res.sendStatus(404); } catch (e) { next(e); } });
app.get('/lab/raw', async (_req, res, next) => { try { res.json(await rawStore.get(meta.rawId)); } catch (e) { next(e); } });
app.get('/lab/export', async (_req, res, next) => {
  try {
    const rawText = await readFile(path.join(root, 'knowledge/raw/notes', `${meta.rawId}.md`), 'utf8');
    const draft = await drafts.get(meta.draftId);
    res.json({ ...meta, currentRawSha256: createHash('sha256').update(rawText).digest('hex'), draft, formal: await wikiStore.allRecords(), realCalls: 0, configReads: 0 });
  } catch (e) { next(e); }
});
app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message, details: error.details } }));
const apiServer = app.listen(0, '127.0.0.1'); await new Promise(resolve => apiServer.once('listening', resolve));
const api = `http://127.0.0.1:${apiServer.address().port}`;
const vite = await createServer({ configFile: false, envDir: root, root: process.cwd(), plugins: [react()], appType: 'custom', server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api': api, '/lab': api } } });
vite.middlewares.use('/r1618-fields', async (_req, res, next) => {
  try {
    const html = await vite.transformIndexHtml('/r1618-fields', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>R16/R18 人工字段隔离验证</title></head><body><div id="root"></div><script type="module" src="/tests/acceptance/R1618-FIELDS-20261026-browser.tsx"></script></body></html>');
    res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html);
  } catch (e) { next(e); }
});
await vite.listen();
const url = `http://127.0.0.1:5176/r1618-fields?draftId=${meta.draftId}`;
const manifest = { ...meta, originalPages: undefined, api, url, exportUrl: 'http://127.0.0.1:5176/lab/export', envDir: root, realCalls: 0, configReads: 0 };
await writeFile(path.join(root, 'active-lab.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await vite.close(); await new Promise((resolve, reject) => apiServer.close(e => e ? reject(e) : resolve())); console.log('R1618 fields lab stopped; isolated files retained.'); };
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
if (process.argv.includes('--smoke')) {
  try {
    for (const route of [url, 'http://127.0.0.1:5176/tests/acceptance/R1618-FIELDS-20261026-browser.tsx', 'http://127.0.0.1:5176/app/pages/DraftReviewPage.tsx', `${api}/api/drafts/${meta.draftId}`, `${api}/api/wiki`, `${api}/api/wiki/schema`, `${api}/lab/export`]) {
      const response = await fetch(route, { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error(`Smoke ${route}: ${response.status}`); await response.text();
      console.log(`SMOKE ${response.status} ${new URL(route).pathname}`);
    }
    if (provider() !== undefined) throw new Error('Provider must remain disabled.');
    console.log('SMOKE: shell/modules/draft/wiki/schema/export HTTP OK; Provider undefined; browser interaction NOT_RUN.');
  } finally { await stop(); }
}
