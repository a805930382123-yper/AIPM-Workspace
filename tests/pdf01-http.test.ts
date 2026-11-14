import assert from 'node:assert/strict';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import express from 'express';
import { registerRawImportRoute } from '../server/raw-import.ts';
import { registerRawPdfRoutes } from '../server/raw-pdf.ts';
import { OpenAiCompatibleProvider, type LlmProvider } from '../services/llm/provider.ts';
import { AssetStore } from '../services/raw/assets.ts';
import { PdfPageService } from '../services/raw/pdf-pages.ts';
import { RawStore } from '../services/raw/store.ts';
import { pdfFixture } from './support/pdf01-fixture.ts';

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const answer = (page: number) => ({ blank: false, content: `第 ${page} 页内容`, visuals: '按图显示，无法读出的数值未补造。', inference: '', questions: [] });

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function fakeProvider() {
  const calls: Array<{ page?: number; text?: string; image?: Buffer; userContent: unknown }> = [];
  let respond = async (page: number) => ({ status: 200, value: answer(page) as unknown });
  const server = http.createServer(async (request, res) => {
    try {
      const received: Buffer[] = [];
      for await (const bytes of request) received.push(Buffer.from(bytes));
      const userContent = JSON.parse(Buffer.concat(received).toString('utf8')).messages[1].content;
      let page: number | undefined;
      let text: string | undefined;
      let image: Buffer | undefined;
      if (Array.isArray(userContent)) {
        assert.equal(userContent.length, 2);
        assert.equal(userContent[0].type, 'text');
        assert.equal(userContent[1].type, 'image_url');
        const input = JSON.parse(userContent[0].text);
        assert.equal(input.stage, 'pdf_page_understanding');
        page = input.page;
        text = input.text;
        const url: string = userContent[1].image_url.url;
        assert.match(url, /^data:image\/png;base64,/u);
        image = Buffer.from(url.split(',')[1], 'base64');
        assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      }
      calls.push({ page, text, image, userContent });
      const reply = await respond(page ?? 0);
      const body = reply.status === 200 ? { choices: [{ message: { content: typeof reply.value === 'string' ? reply.value : JSON.stringify(reply.value) }, finish_reason: 'stop' }] }
        : { error: { message: String(reply.value) } };
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    } catch {
      res.writeHead(500).end();
    }
  });
  const url = await listen(server) + '/v1';
  return { url, calls, setResponse: (fn: typeof respond) => { respond = fn; }, close: () => close(server) };
}

function client(base: string) {
  const request = async (url: string, input?: unknown) => {
    const response = await fetch(base + url, input === undefined ? {} : input instanceof FormData ? { method: 'POST', body: input }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const type = response.headers.get('content-type') ?? '';
    return type.includes('application/json') ? { status: response.status, json: await response.json() as any, bytes: undefined }
      : { status: response.status, json: undefined, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const upload = async (bytes: Buffer, fileName = 'fixture.pdf') => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)]), fileName);
    form.set('metadata', JSON.stringify({ sourceType: 'report' }));
    return request('/api/raw/import', form);
  };
  const wait = async (route: string, status: string) => {
    for (let i = 0; i < 600; i++) {
      const view = await request(route);
      if (view.json?.job?.status === status) return view.json;
      if (status === 'completed' && view.json?.job?.status === 'failed') assert.fail(JSON.stringify(view.json.job));
      if (status === 'failed' && view.json?.job?.status === 'completed') assert.fail('job completed when failure was expected');
      await delay(15);
    }
    assert.fail(`PDF did not reach ${status}`);
  };
  return { request, upload, wait };
}

async function local(fixtureRoot?: string, provider?: LlmProvider) {
  const root = fixtureRoot ?? await mkdtemp(path.join(os.tmpdir(), 'pdf01-local-'));
  const raws = new RawStore(root);
  const assets = new AssetStore(root);
  await Promise.all([raws.initialize(), assets.initialize()]);
  const app = express();
  app.use(express.json());
  registerRawImportRoute(app, { store: raws, assets });
  registerRawPdfRoutes(app, new PdfPageService({ root, raws, assets, provider: async () => provider }));
  app.use(((e, _req, res, _next) => res.status(e.status ?? 500).json({ error: { code: e.code, message: e.message } })) as express.ErrorRequestHandler);
  const server = http.createServer(app);
  return { ...client(await listen(server)), root, raws, assets, close: () => close(server) };
}

function provider(url: string, model = 'fixture-vision') {
  return new OpenAiCompatibleProvider({ baseUrl: url, model, apiKey: 'synthetic-pdf01-test-key', source: 'local-file' });
}

async function pixels(bytes: Buffer): Promise<{ width: number; height: number; colors: Set<string> }> {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const colors = new Set<string>();
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] !== 255 || rgba[i + 1] !== 255 || rgba[i + 2] !== 255) colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
  return { width: image.width, height: image.height, colors };
}

test('PDF mixed pages retain exact bytes, text offsets, embedded image and vectors; the model receives the actual page PNG', async () => {
  const fake = await fakeProvider();
  const api = await local(undefined, provider(fake.url));
  try {
    const bytes = pdfFixture(['text', 'scan', 'vector', 'text']);
    const uploaded = await api.upload(bytes);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
    const { raw } = uploaded.json;
    assert.equal(raw.body, 'Original page 1 revenue 120\n\nOriginal page 4 revenue 120');
    assert.equal(raw.assetSha256, sha(bytes));
    const route = `/api/raw/${raw.id}/pdf`;
    const before = (await api.request(route)).json;
    assert.equal(before.job, null);
    assert.equal(before.hasTextLayer, true);
    assert.deepEqual((await api.request(before.originalUrl)).bytes, bytes);
    const images: Buffer[] = [];
    for (const item of before.pages) {
      const page = (await api.request(`${route}/pages/${item.page}`)).json;
      assert.equal(page.text, item.textStart === null ? '' : raw.body.slice(item.textStart, item.textEnd));
      images.push((await api.request(item.imageUrl)).bytes!);
    }
    assert.equal(before.pages[1].textStart, null);
    assert.equal(before.pages[2].textEnd, null);
    assert((await pixels(images[0])).colors.size > 0);
    assert((await pixels(images[1])).colors.has('226,47,55'));
    assert((await pixels(images[2])).colors.size >= 3);
    assert.equal(fake.calls.length, 0);
    assert.equal((await api.request(route + '/understand', {})).status, 202);
    const done = await api.wait(route, 'completed');
    assert.deepEqual([done.job.completedPages, done.job.totalPages, done.job.attempts], [4, 4, 4]);
    assert.deepEqual(fake.calls.map(call => call.image && sha(call.image)), images.map(sha));
    assert.deepEqual(fake.calls.map(call => call.text), ['Original page 1 revenue 120', '', '', 'Original page 4 revenue 120']);
    assert.deepEqual((await api.request(`${route}/pages/3`)).json.understanding, answer(3));
    assert.deepEqual((await api.request(before.originalUrl)).bytes, bytes);
    assert.equal((await api.raws.get(raw.id))?.bodySha256, raw.bodySha256);
    assert.equal((await api.request(`${route}/pages/0/image`)).status, 404);
    assert.equal((await api.request(`${route}/pages/5`)).status, 404);
    assert.equal((await api.request(`/api/raw/${randomUUID()}/pdf`)).status, 404);
    assert.equal((await api.request(route + '/understand', {})).status, 200);
    assert.equal(fake.calls.length, 4);
  } finally { await api.close(); await fake.close(); }
});

test('Real server entry accepts scanned PDF and calls local configured HTTP Provider only for explicit page understanding', async () => {
  const fake = await fakeProvider();
  let child: ChildProcess | undefined;
  try {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pdf01-entry-'));
    const config = path.join(root, 'fake-provider.env');
    await writeFile(config, `FMCG_LLM_BASE_URL=${fake.url}\nFMCG_LLM_MODEL=fixture-vision\nFMCG_LLM_API_KEY=synthetic-pdf01-test-key\n`);
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_LLM_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(), windowsHide: true, stdio: 'ignore',
      env: { ...env, FMCG_DATA_DIR: root, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config },
    });
    const api = client(`http://127.0.0.1:${port}`);
    let healthy = false;
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) assert.fail(`server exited ${child.exitCode}`);
      try { if ((await api.request('/api/health')).status === 200) { healthy = true; break; } } catch { /* waiting */ }
      await delay(80);
    }
    assert(healthy);
    const raw = (await api.upload(pdfFixture(['scan']))).json.raw;
    assert.equal(raw.body, '');
    assert.equal(raw.bodySha256, sha(''));
    const route = `/api/raw/${raw.id}/pdf`;
    assert.equal((await api.request(`/api/raw/${raw.id}/extract`, { mode: 'standard' })).json.error.code, 'PDF_TEXT_LAYER_REQUIRED');
    const image = (await api.request(route + '/pages/1/image')).bytes!;
    assert.equal(fake.calls.length, 0);
    assert.equal((await api.request(route + '/understand', {})).status, 202);
    await api.wait(route, 'completed');
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].image, image);
    assert.equal(fake.calls[0].text, '');
    await provider(fake.url).complete({ system: 'plain', user: 'text-only-contract', timeoutMs: 5000, maxOutputBytes: 8192 });
    assert.equal(fake.calls[1].userContent, 'text-only-contract');
  } finally {
    if (child?.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await fake.close();
  }
});

test('A 62-page document renders, sends and settles every page sequentially, including an explicit blank page', async () => {
  const fake = await fakeProvider();
  fake.setResponse(async page => ({ status: 200, value: page === 1 ? { blank: true, content: '', visuals: '', inference: '', questions: [] } : answer(page) }));
  const api = await local(undefined, provider(fake.url));
  try {
    const kinds = ['text', 'scan', 'vector'] as const;
    const bytes = pdfFixture(['blank', ...Array.from({ length: 61 }, (_, i) => kinds[i % kinds.length])]);
    const result = await api.upload(bytes);
    assert.equal(result.status, 201);
    const rawId = result.json.raw.id;
    const route = `/api/raw/${rawId}/pdf`;
    const initial = (await api.request(route)).json;
    assert.equal(initial.pages.length, 62);
    assert.equal(initial.job, null);
    await api.request(route + '/understand', {});
    const done = await api.wait(route, 'completed');
    assert.deepEqual([done.job.completedPages, done.job.totalPages, done.job.attempts], [62, 62, 62]);
    assert.deepEqual(fake.calls.map(call => call.page), Array.from({ length: 62 }, (_, i) => i + 1));
    assert(fake.calls.every(call => call.image?.length));
    assert.equal((await api.request(`${route}/pages/1`)).json.understanding.blank, true);
    assert.equal((await api.request(`${route}/pages/62`)).json.understanding.content, '第 62 页内容');
    const files = await readdir(path.join(api.root, 'state', 'raw-pdf', rawId));
    assert.equal(files.filter(file => file.endsWith('.png')).length, 62);
    const manifest = JSON.parse(await readFile(path.join(api.root, 'state', 'raw-pdf', rawId, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.results.map((value: {imageSha256: string}) => value.imageSha256), fake.calls.map(call => sha(call.image!)));
    assert.deepEqual((await api.request(initial.originalUrl)).bytes, bytes);
  } finally { await api.close(); await fake.close(); }
});

test('Middle-page invalid JSON, rejected images and changed Provider preserve successful pages and resume only unfinished pages', async () => {
  const fake = await fakeProvider();
  const api = await local(undefined, provider(fake.url));
  let other: Awaited<ReturnType<typeof local>> | undefined;
  try {
    const bytes = pdfFixture(['text', 'scan', 'vector']);
    const uploaded = await api.upload(bytes);
    const route = `/api/raw/${uploaded.json.raw.id}/pdf`;
    fake.setResponse(async page => ({ status: 200, value: page === 2 ? 'invalid JSON' : answer(page) }));
    await api.request(route + '/understand', {});
    let failed = await api.wait(route, 'failed');
    assert.deepEqual([failed.job.completedPages, failed.job.failedPage, failed.job.attempts, failed.job.error.code], [1, 2, 2, 'PDF_PAGE_OUTPUT_INVALID']);
    assert.equal((await api.request(`${route}/pages/2`)).json.understanding, undefined);
    other = await local(api.root, provider(fake.url, 'other-model'));
    await other.request(route + '/understand', {});
    failed = await other.wait(route, 'failed');
    assert.equal(failed.job.error.code, 'PDF_PROVIDER_CHANGED');
    assert.equal(fake.calls.length, 2);
    await other.close();
    other = undefined;
    fake.setResponse(async () => ({ status: 400, value: 'model rejects images' }));
    await api.request(route + '/understand', {});
    failed = await api.wait(route, 'failed');
    assert.deepEqual([failed.job.completedPages, failed.job.failedPage, failed.job.attempts], [1, 2, 3]);
    assert.match(failed.job.error.message, /支持图像/);
    assert(fake.calls[2].image);
    fake.setResponse(async page => ({ status: 200, value: answer(page) }));
    await api.request(route + '/understand', {});
    const done = await api.wait(route, 'completed');
    assert.equal(done.job.attempts, 5);
    assert.deepEqual(fake.calls.map(call => call.page), [1, 2, 2, 2, 3]);
    assert.deepEqual((await api.request(done.originalUrl)).bytes, bytes);
  } finally { await other?.close(); await api.close(); await fake.close(); }
});

test('Cancel ignores a late page response and explicit continue retains the already completed first page', async () => {
  const fake = await fakeProvider();
  const api = await local(undefined, provider(fake.url));
  let release: (() => void) | undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const uploaded = await api.upload(pdfFixture(['text', 'vector', 'scan']));
    const route = `/api/raw/${uploaded.json.raw.id}/pdf`;
    fake.setResponse(async page => {
      if (page === 2 && fake.calls.length === 2) { await hold; return { status: 200, value: { ...answer(page), content: '迟到旧结果' } }; }
      return { status: 200, value: answer(page) };
    });
    await api.request(route + '/understand', {});
    for (let i = 0; i < 600 && fake.calls.length < 2; i++) await delay(15);
    assert.equal(fake.calls.length, 2);
    const duplicate = await api.request(route + '/understand', {});
    assert.equal(duplicate.json.job.attempts, 2);
    const cancelled = (await api.request(route + '/cancel', {})).json;
    assert.deepEqual([cancelled.job.status, cancelled.job.completedPages, cancelled.job.attempts], ['cancelled', 1, 2]);
    await api.request(route + '/understand', {});
    const done = await api.wait(route, 'completed');
    assert.equal(done.job.attempts, 4);
    release?.();
    assert.deepEqual(fake.calls.map(call => call.page), [1, 2, 2, 3]);
    assert.equal((await api.request(`${route}/pages/2`)).json.understanding.content, '第 2 页内容');
  } finally { release?.(); await api.close(); await fake.close(); }
});

test('Killing a process during a page leaves durable attempts and a fresh service sends nothing until explicit continue', async () => {
  const fake = await fakeProvider();
  const api = await local(undefined, provider(fake.url));
  let child: ChildProcess | undefined;
  let restarted: Awaited<ReturnType<typeof local>> | undefined;
  let release: (() => void) | undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const uploaded = await api.upload(pdfFixture(['text', 'vector', 'scan']));
    const id = uploaded.json.raw.id;
    const route = `/api/raw/${id}/pdf`;
    fake.setResponse(async page => {
      if (page === 2 && fake.calls.length === 2) await hold;
      return { status: 200, value: answer(page) };
    });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_LLM_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
    child = fork('tests/support/pdf01-restart-child.ts', [api.root, id, fake.url], { env, execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    for (let i = 0; i < 600 && fake.calls.length < 2; i++) await delay(15);
    assert.equal(fake.calls.length, 2);
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
    restarted = await local(api.root, provider(fake.url));
    const orphan = (await restarted.request(route)).json;
    assert.deepEqual([orphan.job.status, orphan.job.completedPages, orphan.job.attempts, orphan.job.error.code], ['failed', 1, 2, 'PDF_UNDERSTANDING_INTERRUPTED']);
    assert.equal(fake.calls.length, 2);
    await restarted.request(route + '/understand', {});
    const done = await restarted.wait(route, 'completed');
    assert.deepEqual([done.job.completedPages, done.job.attempts], [3, 4]);
    assert.deepEqual(fake.calls.map(call => call.page), [1, 2, 2, 3]);
  } finally {
    release?.();
    if (child?.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await restarted?.close(); await api.close(); await fake.close();
  }
});

test('Known secrets, Meeting origin, missing state and changed asset never produce misleading page results', async () => {
  const fake = await fakeProvider();
  const api = await local(undefined, provider(fake.url));
  const secret = 'synthetic-pdf01-test-key';
  try {
    const sourceSecret = await api.upload(pdfFixture(['text'], () => secret));
    assert.equal(sourceSecret.json.raw.body, secret);
    const sourceRoute = `/api/raw/${sourceSecret.json.raw.id}/pdf`;
    await api.request(sourceRoute + '/understand', {});
    assert.equal((await api.wait(sourceRoute, 'failed')).job.error.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    assert.equal(fake.calls.length, 0);
    const meeting = await api.raws.createMeetingRegistration({ id: randomUUID(), title: '合成会议', sourceName: '隔离', tags: [], body: '原文', importedAt: new Date().toISOString(),
      origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: sha('原文'), registered_confidentiality: 'Restricted', processing_policy: 'meeting_local_only' } });
    assert.equal((await api.request(`/api/raw/${meeting.record.id}/pdf/understand`, {})).json.error.code, 'MEETING_SOURCE_RESTRICTED');
    assert.equal(fake.calls.length, 0);

    const bytes = pdfFixture(['vector']);
    const uploaded = await api.upload(bytes);
    const id = uploaded.json.raw.id;
    const route = `/api/raw/${id}/pdf`;
    fake.setResponse(async page => ({ status: 200, value: { ...answer(page), content: secret } }));
    await api.request(route + '/understand', {});
    const failed = await api.wait(route, 'failed');
    assert.equal(failed.job.error.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    assert.equal(failed.job.completedPages, 0);
    assert(!(await readFile(path.join(api.root, 'state', 'raw-pdf', id, 'manifest.json'), 'utf8')).includes(secret));
    const asset = path.join(api.root, 'knowledge', 'raw', 'assets', uploaded.json.asset.storedFile);
    const altered = Buffer.from(bytes); altered[altered.length - 2] ^= 1;
    await writeFile(asset, altered);
    assert.equal((await api.request(route + '/understand', {})).json.error.code, 'PDF_ASSET_CHANGED');
    assert.equal(fake.calls.length, 1);

    const blocked = await api.upload(bytes);
    const blockedId = blocked.json.raw.id;
    await mkdir(path.join(api.root, 'state', 'raw-pdf', blockedId, 'manifest.json'), { recursive: true });
    const refused = await api.request(`/api/raw/${blockedId}/pdf/understand`, {});
    assert.equal(refused.json.error.code, 'STORAGE_READ_FAILED');
    assert.equal(fake.calls.length, 1);
    assert.deepEqual((await api.assets.readBoundPdf((await api.raws.get(blockedId))!)).bytes, bytes);
  } finally { await api.close(); await fake.close(); }
});
