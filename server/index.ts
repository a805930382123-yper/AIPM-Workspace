import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../services/raw/store.ts';
import { AssetStore } from '../services/raw/assets.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { MAX_UPLOAD_BYTES } from '../services/raw/limits.ts';
import { ParseError } from '../services/raw/parse.ts';
import { importRawFile } from './raw-import.ts';
import { validateRaw, InputError } from './validation.ts';
import { getStats } from '../services/stats/index.ts';
import { WikiError, WikiStore } from '../services/wiki/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { validateBaseRevision, validateWikiInput } from './wiki-validation.ts';
import { loadLlmConfig } from '../services/llm/config.ts';
import { OpenAiCompatibleProvider, type LlmProvider } from '../services/llm/provider.ts';
import { LLMService } from '../services/llm/service.ts';
import { ExtractionJobStore, ExtractionRunner } from '../services/llm/jobs.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { registerB04Routes } from './llm-api.ts';
import { registerKnowledgeRoutes } from './knowledge-api.ts';
import { AuditService } from '../services/audit/service.ts';
import { registerAuditRoutes } from './audit-api.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { registerPromptRoutes } from './prompt-api.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import { registerPromptAiRoutes } from './prompt-ai-api.ts';
import { DemoService } from '../services/demo/service.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { registerMeetingRoutes, registerMeetingMinutesRoutes, meetingErrorMiddleware } from './meeting-api.ts';
import { MeetingRawBridge } from '../services/meeting/raw-bridge.ts';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.FMCG_DATA_DIR || path.join(moduleDir, '..', 'workspace'));
const rulesDir = path.resolve(moduleDir, '..', 'rules');
const configFile = path.resolve(moduleDir, '..', '.env.local');
const host = '127.0.0.1';
const port = Number(process.env.FMCG_PORT || 4317);
const store = new RawStore(root);
const assetStore = new AssetStore(root);
const wikiStore = new WikiStore(root, store);
const rawStates = new RawStateStore(root);
const drafts = new DraftStore(root);
const jobs = new ExtractionJobStore(root);
const llm = new LLMService(rulesDir);
const commits = new WikiCommitService({ root, wikiStore, drafts, rawStates, rawStore: store });
const audits = new AuditService(root, wikiStore, store);
// B07: the Prompt Library reads Wiki titles for its "related Wiki" column and never writes
// to knowledge/, so it cannot affect the knowledge assets or the knowledge log.
const prompts = new PromptStore(root, wikiStore, rulesDir);
const promptAi = new PromptAiService(root, wikiStore, prompts, () => currentProvider);
const demo = new DemoService(root, store, wikiStore, prompts);
const meetings = new MeetingStore(root);
const meetingRawBridge = new MeetingRawBridge(meetings, store);
// B04: the product provider is built from server-side configuration only. No key, no provider
// and no fallback exists in the browser bundle; an unconfigured server stays unconfigured.
const loadConfig = () => loadLlmConfig({ filePath: configFile });
const providerFactory = async (): Promise<LlmProvider | undefined> => {
  const config = await loadConfig();
  if (!config.baseUrl || !config.model || !config.apiKey) return undefined;
  return new OpenAiCompatibleProvider(config);
};
const runner = new ExtractionRunner({
  root, llm, jobs, drafts, rawStates, rawStore: store, rulesDir, provider: () => currentProvider,
  draftRules: async () => {
    const bundle = await loadExtractionRules(rulesDir);
    return {
      types: (bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum ?? []) as string[],
      categories: (bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum ?? []) as string[],
      knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [],
      confidence: bundle.fmcg.enums?.confidence ?? [],
      source_level: bundle.fmcg.enums?.source_level ?? [],
      review_status: bundle.fmcg.enums?.review_status ?? [],
    };
  },
});
// The provider is resolved per request so a configuration change needs no restart.
let currentProvider: LlmProvider | undefined;
const refreshProvider = async () => { currentProvider = await providerFactory(); };

await store.initialize();
await assetStore.initialize();
await wikiStore.initialize();
await rawStates.initialize();
await drafts.initialize();
await jobs.initialize();
await commits.initialize();
await audits.initialize();
await prompts.initialize();
await promptAi.initialize();
await meetings.initialize();
try {
  const rawRecovery = await meetingRawBridge.reconcile();
  if (rawRecovery.resumed.length || rawRecovery.deleted.length || rawRecovery.failed.length) {
    console.log(`Meeting Raw reconciliation: resumed=${rawRecovery.resumed.length}, deleted=${rawRecovery.deleted.length}, failed=${rawRecovery.failed.length}`);
  }
} catch (error) {
  console.error('Meeting Raw reconciliation failed:', error instanceof Error ? error.message : error);
}
await refreshProvider();

// F03-01: repair the Raw ↔ retained-original linkage left behind by an interrupted or
// partially committed import. Runs on every start of this data directory and never throws.
try {
  const repair = await assetStore.reconcile(await store.list());
  const repaired = [...repair.linked, ...repair.compensated, ...repair.detached];
  if (repaired.length) {
    console.log(`Raw/原件关联对账：补齐 ${repair.linked.length}，补偿 ${repair.compensated.length}，标记原件已分离 ${repair.detached.length}`);
  }
  if (repair.failed.length) console.error(`Raw/原件关联对账：${repair.failed.length} 条记录当前无法处理（原文件仍保留）`);
} catch (error) {
  console.error('Raw/原件关联对账失败：', error instanceof Error ? error.message : error);
}

// B04: never leave a permanent "processing" state, and finish every commit the user already
// confirmed. Both run on the Wiki write queue and never throw out of startup.
try {
  const jobsRepair = await runner.reconcile();
  if (jobsRepair.interrupted.length) console.log(`提取任务对账：${jobsRepair.interrupted.length} 个中断任务已标记为可重试的失败`);
  const commitRepair = await commits.reconcile();
  if (commitRepair.resumed.length) console.log(`AI 提交对账：已继续 ${commitRepair.resumed.length} 个用户已确认的提交`);
  if (commitRepair.conflicts.length) console.error(`AI 提交对账：${commitRepair.conflicts.length} 个操作需要人工处理（内容冲突，未覆盖）`);
} catch (error) {
  console.error('B04 状态对账失败：', error instanceof Error ? error.message : error);
}

// B03: single file per request, held in memory so an over-limit body is rejected
// while receiving and never reaches the data directory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  defParamCharset: 'utf8',
}).single('file');

const app = express();
app.disable('x-powered-by');
// Minute imports authorize before either JSON parsing or multipart buffering reads the body.
registerMeetingMinutesRoutes(app, meetings);
app.use(express.json({ limit: '3mb', strict: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/stats', async (_req, res, next) => {
  try { res.json(await getStats(root, store, new Date(), prompts)); } catch (error) { next(error); }
});
app.get('/api/demo', async (_req, res, next) => { try { res.json(await demo.get()); } catch (error) { next(error); } });
app.post('/api/demo/import', async (req, res, next) => { try { res.json(await demo.import(req.body?.confirm)); } catch (error) { next(error); } });
app.get('/api/raw', async (_req, res, next) => {
  try {
    const items = await store.list();
    if (_req.query.summary === 'true') {
      res.json({ items: items.map(({ body, bodySha256, ...summary }) => summary) });
      return;
    }
    res.json({ items });
  } catch (error) { next(error); }
});
app.get('/api/raw/assets', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = (await assetStore.list()).filter(record => !status || record.status === status);
    res.json({ items });
  } catch (error) { next(error); }
});
app.post('/api/raw/import', (req, res, next) => {
  upload(req, res, async (uploadError: unknown) => {
    if (uploadError) { next(uploadError); return; }
    try {
      if (!req.file) throw new InputError('MISSING_FILE', '请求中没有文件。请使用 multipart/form-data 上传，字段名为 file。', 400);
      const rawMetadata = typeof req.body?.metadata === 'string' ? req.body.metadata.trim() : '';
      let metadata: unknown = {};
      if (rawMetadata) {
        try { metadata = JSON.parse(rawMetadata); }
        catch { throw new InputError('INVALID_METADATA', 'metadata 不是有效的 JSON 字符串。', 400); }
      }
      const result = await importRawFile({ store, assets: assetStore, bytes: req.file.buffer, fileName: req.file.originalname, metadata });
      res.status(201).json(result);
    } catch (error) { next(error); }
  });
});
app.get('/api/raw/:id/references', async (req, res, next) => {
  try {
    const item = await store.get(req.params.id);
    if (!item) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条原始资料。' } }); return; }
    res.json({ items: await wikiStore.referencesToRaw(req.params.id) });
  } catch (error) { next(error); }
});
app.get('/api/raw/:id', async (req, res, next) => {
  try {
    const item = await store.get(req.params.id);
    if (!item) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条原始资料。' } }); return; }
    res.json(item);
  } catch (error) { next(error); }
});
app.delete('/api/raw/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!await store.get(id)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条原始资料。' } }); return; }
    // Runs on the Wiki write queue so a Wiki save cannot validate this Raw as a source
    // while it is being deleted (and the other way round).
    const removed = await wikiStore.withLock(async () => {
      const references = await wikiStore.referencesToRaw(id);
      if (references.length) {
        throw new WikiError('RAW_REFERENCED', `这条原始资料仍被 ${references.length} 条正式 Wiki 引用，删除已取消。请先在知识库中解除这些页面的来源引用。`, 409, { references });
      }
      // B04: a Raw with an active extraction or a pending draft must be resolved first.
      const activeDraft = await drafts.findActiveForRaw(id);
      const state = await rawStates.get(id);
      if (activeDraft || state.status === 'processing') {
        throw new WikiError('RAW_ACTIVE_WORK', '这条原始资料还有进行中的 AI 整理或待审核草稿；请先取消提取或放弃草稿，再删除。', 409, {
          jobId: state.jobId ?? null, draftId: activeDraft?.id ?? null,
        });
      }
      const record = await store.delete(id);
      if (!record) throw new WikiError('NOT_FOUND', '没有找到这条原始资料。', 404);
      return record;
    });
    const warnings: string[] = [];
    try { await meetingRawBridge.deleteRaw(removed.id); }
    catch { warnings.push('Raw deleted; Meeting display state will recover on restart.'); }
    if (removed.assetId) {
      const detached = await assetStore.markDetached(removed.assetId, removed.id).catch(() => undefined);
      if (!detached) warnings.push(`原件记录（assetId ${removed.assetId}）的删除标记未写入，原件字节仍保留在 knowledge/raw/assets/。`);
    }
    res.json({
      id: removed.id, title: removed.title, assetId: removed.assetId ?? null,
      assetRetained: Boolean(removed.assetId), warnings,
    });
  } catch (error) { next(error); }
});
app.post('/api/raw', async (req, res, next) => {
  try { res.status(201).json(await store.create(validateRaw(req.body))); }
  catch (error) { next(error); }
});
app.get('/api/wiki/schema', async (_req, res, next) => {
  try { res.json(await wikiStore.schema()); } catch (error) { next(error); }
});
app.get('/api/wiki', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const [items, categoryCounts, schema] = await Promise.all([wikiStore.list({ q, category }), wikiStore.categoryCounts(), wikiStore.schema()]);
    if (category && !schema.categories.some(item => item.id === category)) throw new WikiError('INVALID_CATEGORY', 'Wiki 分类无效。');
    res.json({ items, categoryCounts });
  } catch (error) { next(error); }
});
app.post('/api/wiki', async (req, res, next) => {
  try { res.status(201).json(await wikiStore.create(validateWikiInput(req.body))); } catch (error) { next(error); }
});
app.get('/api/wiki/:id/export', async (req, res, next) => {
  try {
    const result = await wikiStore.exportMarkdown(req.params.id);
    if (!result) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条 Wiki。' } }); return; }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wiki-${result.record.id}.md"`);
    res.send(result.markdown);
  } catch (error) { next(error); }
});
app.get('/api/wiki/:id/references', async (req, res, next) => {
  try {
    const items = await wikiStore.references(req.params.id);
    res.json({ items: [...new Map(items.map(item => [item.pageId, { id: item.pageId, title: item.title }])).values()] });
  } catch (error) { next(error); }
});
app.get('/api/wiki/:id', async (req, res, next) => {
  try {
    const item = await wikiStore.get(req.params.id);
    if (!item) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条 Wiki。' } }); return; }
    const links = (await wikiStore.links(item.id)).map(link => ({ target: link.text, status: link.status === 'found' ? 'resolved' : link.status, candidates: link.candidates }));
    res.json({ ...item, links });
  } catch (error) { next(error); }
});
app.put('/api/wiki/:id', async (req, res, next) => {
  try { res.json(await wikiStore.update(req.params.id, validateBaseRevision(req.body?.baseRevision), validateWikiInput(req.body))); }
  catch (error) { next(error); }
});
app.delete('/api/wiki/:id', async (req, res, next) => {
  try {
    const result = await wikiStore.delete(req.params.id, validateBaseRevision(req.body?.baseRevision));
    const pages = [...new Map(result.references.map(item => [item.pageId, { id: item.pageId, title: item.title }])).values()];
    res.json({ id: result.id, title: result.title, references: pages });
  } catch (error) { next(error); }
});
registerB04Routes(app, {
  root, rulesDir, configFile, loadConfig, provider: () => currentProvider, llm, runner, jobs, drafts, commits, rawStates, rawStore: store, wikiStore,
});
registerKnowledgeRoutes(app, { root, raws: store, drafts, wiki: wikiStore, provider: () => currentProvider });
registerAuditRoutes(app, { root, audits, wiki: wikiStore, raws: store, provider: () => currentProvider });
registerPromptRoutes(app, { store: prompts });
registerPromptAiRoutes(app, promptAi);
registerMeetingRoutes(app, meetings, meetingRawBridge);

app.use(meetingErrorMiddleware);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof InputError) { res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } }); return; }
  if (error instanceof ParseError) { res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } }); return; }
  if (error instanceof WikiError) { res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } }); return; }
  // B04 service errors (LLM/Draft/Commit/Job/Storage) share the {code,status,message,details} shape.
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' && typeof (error as { status?: unknown }).status === 'number') {
    const shaped = error as { code: string; status: number; message?: string; details?: unknown };
    res.status(shaped.status).json({ error: { code: shaped.code, message: shaped.message ?? '操作失败。', details: shaped.details } }); return;
  }
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB 上限，已在接收阶段拒绝，未保存原件。`, details: { retained: false, limitBytes: MAX_UPLOAD_BYTES } } }); return;
    }
    res.status(400).json({ error: { code: 'INVALID_UPLOAD', message: `上传请求格式不正确（${error.code}）：请使用 multipart/form-data，只上传一个字段名为 file 的文件。` } }); return;
  }
  if (error instanceof Error && /boundary not found|unexpected end of form|malformed part header|unexpected end of multipart/i.test(error.message)) {
    res.status(400).json({ error: { code: 'INVALID_UPLOAD', message: '上传请求不是有效的 multipart/form-data，请重新选择文件后重试。' } }); return;
  }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求内容不是有效 JSON。' } }); return; }
  if (error && typeof error === 'object' && 'type' in error && (error as {type?: string}).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: '请求内容过大，请缩短正文后重试。' } }); return;
  }
  console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '保存或读取失败，请重试。' } });
});

app.listen(port, host, () => console.log(`FMCG AI PM Workspace API: http://${host}:${port} (data: ${root})`));
