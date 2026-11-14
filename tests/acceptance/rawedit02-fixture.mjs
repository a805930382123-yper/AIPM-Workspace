import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AssetStore } from '../../services/raw/assets.ts';
import { PdfPageService } from '../../services/raw/pdf-pages.ts';
import { PdfCleanupService } from '../../services/raw/pdf-cleanup.ts';
import { RawTranslationService } from '../../services/raw/translations.ts';
import { KnowledgeAnswerService } from '../../services/llm/knowledge-answers.ts';
import { importRawFile } from '../../server/raw-import.ts';
import { lwFixture } from '../lw01-fixture.ts';
import { synthesisFixture } from './pdf02-synthesis-fixture.ts';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFor(read, ready) {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (ready(value)) return value;
    await pause(75);
  }
  assert.fail('Timed out waiting for isolated state');
}

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  assert(![5151, 5173].includes(port));
  return port;
}

export async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export const rawPath = raw => '/api/raw/' + raw.id;
export const draftPath = draft => '/api/drafts/' + draft.id;
export const editInput = (raw, body) => ({ body, expectedBodySha256: raw.bodySha256, expectedBodyRevision: raw.bodyRevision ?? 0 });

export async function setup(report, { pdf = true, fakeHttp = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawedit02-'));
  const data = path.join(root, 'data');
  const config = path.join(root, 'empty-provider.env');
  const envDir = path.join(root, 'empty-vite-env');
  await mkdir(envDir);
  await writeFile(config, '');
  Object.assign(report, { root, data, config, envDir, fakeCalls: [], fakeHttpCalls: [] });
  const f = await lwFixture(data);
  const assets = new AssetStore(data);
  await assets.initialize();
  const create = (title, body, sourceType = 'report', extra = {}) => f.rawStore.create({
    title, body, sourceType, sourceName: 'RAWEDIT02 合成样本', author: '测试作者',
    tags: ['渠道', '测试'], publishedAt: '2026-01-01', ...extra,
  });
  const standard = await create('RAWEDIT02 标准资料', '门店覆盖12家。\n回访周期7天。');
  const formal = await create('RAWEDIT02 已入库来源', '合成样本库存覆盖9家。');
  const meeting = await create('RAWEDIT02 普通会议', '旧式会议正文。', 'meeting');
  const bridged = (await f.rawStore.createMeetingRegistration({
    id: randomUUID(), title: 'RAWEDIT02 会议登记资料', sourceName: '会议登记',
    body: '会议档案登记的原文。', tags: [], importedAt: '2026-01-01T00:00:00.000Z',
    origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: sha('original meeting'),
      registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' },
  })).record;
  const url = await create('RAWEDIT02 翻译资料', 'Distribution analysis has found a significant change across retail channels and this fixture is sufficiently long to translate.', 'article',
    { urlImport: { finalUrl: 'https://example.invalid/report', fetchedAt: '2026-01-01T00:00:00.000Z' } });
  const checkpoint = await create('RAWEDIT02 提取检查点', '原始提取的未完成检查点。');
  const checkpointJob = await f.runner.start(checkpoint.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  await f.runner.cancel(checkpointJob.job.id);
  await f.runner.waitForSettlement(checkpointJob.job.id);
  const running = await create('RAWEDIT02 运行任务', '等待隔离假模型的提取正文。');
  const deferredRaw = await create('RAWEDIT02 暂缓资料', '已暂缓的渠道资料。');
  const txtBytes = Buffer.from('  测试原文件\r\n另起一行。  \r\n');
  const txt = await importRawFile({ store: f.rawStore, assets, bytes: txtBytes, fileName: 'RAWEDIT02.txt', metadata: {sourceType:'report'} });
  f.setTopics(['测试标准覆盖', '测试标准回访']);
  const createDraft = f.drafts.create.bind(f.drafts);
  f.drafts.create = ({ maintenance: _maintenance, ...input }, deep) => createDraft(input, deep);
  const standardDraft = await f.generate(standard.id);
  f.drafts.create = createDraft;
  f.setTopics(['暂缓后失效的测试主题']);
  const deferredDraft = await f.generate(deferredRaw.id);
  await f.drafts.setDeferred(deferredDraft.id, deferredDraft.revision, true);
  f.setTopics(['测试正式库存覆盖']);
  const formalCommit = (await f.confirm(await f.accept(await f.generate(formal.id)))).manifest;
  const answerService = new KnowledgeAnswerService({
    root: data, wiki: f.wiki, raws: f.rawStore, drafts: f.drafts,
    provider: () => ({ name: 'fake', model: 'rawedit02-question', async complete(request) {
      const input = JSON.parse(request.user);
      report.fakeCalls.push(input.stage);
      const citation = { id: 'raw-fact', kind: 'raw', recordId: formal.id, quote: formal.body, start: 0, end: formal.body.length };
      const result = input.rawFragments.length
        ? { version: 1, needsRaw: [], sections: [{ kind: 'fact', text: formal.body, citationIds: [citation.id] }], citations: [citation] }
        : { version: 1, needsRaw: [{ rawId: formal.id, reason: '核对来源', query: '' }], sections: [], citations: [] };
      const text = JSON.stringify(result);
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    }}),
  });
  await answerService.initialize();
  const answer = await answerService.ask({ requestId: randomUUID(), question: '测试正式库存覆盖' });
  assert.equal(answer.status, 'completed', JSON.stringify(answer.error));
  assert.equal(answer.citations[0]?.recordId, formal.id);
  const provider = { name: 'fake', model: 'rawedit02-fixture', async complete(request) {
    const input = JSON.parse(request.user);
    report.fakeCalls.push(input.stage);
    let result;
    if (input.stage === 'raw_translation') result = { translation: '这是旧版本专用的中文译文。' };
    else if (input.stage === 'pdf_page_understanding') result = { blank: false, content: synthesisFixture.outputs[input.page - 1], visuals: '', inference: '', questions: [] };
    else if (input.stage === 'pdf_cleanup') result = { decisions: Object.fromEntries(input.units.map(unit => [unit.id, { decision: 'keep', reason: '测试保留', topic: synthesisFixture.classify(unit.text) }])) };
    else if (input.stage === 'pdf_topic_index') result = { assignments: Object.fromEntries(input.topics.map(topic => [topic, topic])) };
    else if (input.stage === 'pdf_topic_write') result = { topics: synthesisFixture.writeTopics(input.topics) };
    else assert.fail(input.stage);
    const text = JSON.stringify(result);
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
  }};
  const translation = new RawTranslationService({ root: data, raws: f.rawStore, provider: async () => provider });
  await translation.start(url.id);
  const translated = await waitFor(() => translation.get(url.id), value => value?.status === 'completed' || value?.status === 'failed');
  assert.equal(translated.status, 'completed', JSON.stringify(translated));

  const pdfBytes = synthesisFixture.pdf();
  let rawPdf, pdfDraft, runningPdf;
  if (pdf) {
    rawPdf = (await importRawFile({ store: f.rawStore, assets, bytes: pdfBytes, fileName: 'RAWEDIT02.pdf', metadata: {title:'RAWEDIT02 PDF 资料', sourceType:'report'} })).raw;
    runningPdf = (await importRawFile({ store: f.rawStore, assets, bytes: pdfBytes, fileName: 'RAWEDIT02-running.pdf', metadata: {title:'RAWEDIT02 运行 PDF', sourceType:'report'} })).raw;
    const pages = new PdfPageService({ root: data, raws: f.rawStore, assets, provider: async () => provider });
    const cleanup = new PdfCleanupService({ root: data, pdf: pages, raws: f.rawStore, drafts: f.drafts, wiki: f.wiki, rawStates: f.rawStates, provider: async () => provider });
    await pages.start(rawPdf.id);
    const understood = await waitFor(() => pages.get(rawPdf.id), value => ['completed','failed'].includes(value.job?.status));
    assert.equal(understood.job.status, 'completed', JSON.stringify(understood.job));
    const range = { startPage: 1, endPage: 3 };
    await cleanup.start(rawPdf.id, range);
    const cleaned = await waitFor(() => cleanup.get(rawPdf.id), value => ['completed','failed'].includes(value.job?.status));
    assert.equal(cleaned.job.status, 'completed', JSON.stringify(cleaned.job));
    pdfDraft = await f.drafts.get((await cleanup.draft(rawPdf.id, range)).job.draftId);
    assert(pdfDraft?.pdfInput);
  }
  report.fixtureExtractionCalls = f.requests.length;

  let server, fake, child, apiLog = '', apiOrigin;
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    if (fake?.listening) await close(fake);
    if (server?.listening) await close(server);
    const exited = !child || child.exitCode !== null || child.signalCode !== null;
    report.cleanup = { ...report.cleanup, apiExited: exited, fakeClosed: !fake?.listening, portReservationClosed: !server?.listening };
    report.apiLog = apiLog;
    assert(exited);
    if (apiOrigin) assert.equal(await fetch(apiOrigin + '/api/health', {signal:AbortSignal.timeout(500)}).catch(() => null), null);
  };
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|OPENAI_|ANTHROPIC_|GEMINI_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
    if (fakeHttp) {
      fake = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        report.fakeHttpCalls.push({ path: request.url, stage: Array.isArray(body.messages[1].content) ? 'pdf-page' : 'extract' });
        // The HTTP tests cancel the deliberate in-flight request. No completion is sent.
        response.on('error', () => {});
      });
      const fakePort = await listen(fake);
      Object.assign(env, { FMCG_LLM_BASE_URL: 'http://127.0.0.1:' + fakePort + '/v1', FMCG_LLM_MODEL: 'rawedit02-fake', FMCG_LLM_API_KEY: 'fake-rawedit02-local-only' });
      report.fakePort = fakePort;
    }
    server = http.createServer();
    const port = await listen(server);
    await close(server);
    apiOrigin = 'http://127.0.0.1:' + port;
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore','pipe','pipe'],
      env: { ...env, FMCG_DATA_DIR: data, FMCG_LLM_CONFIG_FILE: config, FMCG_PORT: String(port) },
    });
    child.stdout.on('data', chunk => apiLog += chunk);
    child.stderr.on('data', chunk => apiLog += chunk);
    report.services = { harnessPid: process.pid, apiPid: child.pid, apiOrigin };
    await waitFor(async () => {
      if (child.exitCode !== null) throw Error(apiLog);
      return fetch(apiOrigin + '/api/health', { signal: AbortSignal.timeout(500) }).catch(() => null);
    }, value => value?.ok);
  } catch (error) {
    await stop();
    throw error;
  }
  const request = (route, method = 'GET', body) => fetch(apiOrigin + route, {
    method, signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const api = async (route, method = 'GET', body, status = 200) => {
    const response = await request(route, method, body);
    const json = await response.json();
    assert.equal(response.status, status, route + ': ' + JSON.stringify(json).slice(0, 500));
    return json;
  };
  const edit = (raw, body, status = 200) => api(rawPath(raw) + '/body', 'PATCH', editInput(raw, body), status);
  const confirm = async (draft, status = 409) => {
    const view = await api(draftPath(draft));
    return api(draftPath(draft) + '/confirm', 'POST', { baseRevision: view.revision,
      selectedPageIds: [view.pages[0].pageId], idempotencyKey: randomUUID(), outcomeDigest: view.outcomeDigest }, status);
  };
  const rawFile = (raw, folder = 'reports') => path.join(data, 'knowledge', 'raw', folder, raw.id + '.md');
  const snapshot = (raw, revision) => path.join(data, 'knowledge', 'raw', 'history', raw.id, revision + '.md');
  const assetFile = name => readFile(path.join(data, 'knowledge', 'raw', 'assets', name));
  return { root, data, envDir, apiOrigin, api, request, edit, confirm, stop, rawFile, snapshot, assetFile,
    standard, standardDraft, formal, formalCommit, answer, deferredRaw, deferredDraft, meeting, bridged, url, translated, checkpoint, running, txt, txtBytes, rawPdf, pdfDraft, runningPdf, pdfBytes };
}
