import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import express from 'express';
import { registerRawImportRoute } from '../server/raw-import.ts';
import { AssetStore } from '../services/raw/assets.ts';
import { MAX_BODY_CHARS } from '../services/raw/limits.ts';
import { RawStore } from '../services/raw/store.ts';
import { MAX_WEB_BYTES, readPublicRawUrl } from '../services/raw/url-import.ts';

const publicIp = { address: '93.184.216.34', family: 4 };
const noCredentials = { title: '虚构资料', sourceType: 'article', sourceName: '隔离来源' };
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
type ReadUrl = typeof readPublicRawUrl;
const proxyEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(https?_proxy|all_proxy|no_proxy|node_use_env_proxy|node_options)$/iu.test(key)));

async function importApi(readUrl: ReadUrl) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawurl01-http-'));
  const store = new RawStore(root);
  const assets = new AssetStore(root);
  await Promise.all([store.initialize(), assets.initialize()]);
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  registerRawImportRoute(app, { store, assets, readUrl });
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message, details: error.details } })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (input: FormData | {metadata: Record<string, unknown>; body?: string}) => {
    const response = await fetch(`${base}/api/raw/import`, input instanceof FormData
      ? { method: 'POST', body: input }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, json: await response.json() as any };
  };
  return { root, store, assets, post, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('Raw URL route follows a public redirect, reads an actual fixture response, and persists decoded text and trace', async () => {
  const received: Array<{path: string; host?: string}> = [];
  const fixture = http.createServer((req, res) => {
    received.push({ path: req.url!, host: req.headers.host });
    if (req.url === '/go') { res.writeHead(302, { location: 'https://media.example/read' }).end(); return; }
    if (req.url === '/plain') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('  原始纯文本\r\n第二行\n'); return; }
    if (req.url !== '/read') { res.writeHead(500).end('子资源不应被请求'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <title>星桥 &amp; 海岚</title><script>throw new Error('禁止执行脚本');</script>
      <script src="/subresource"></script><nav>不属于原文的导航</nav>
      <main><article><h1>渠道口径</h1><p>原始正文：直营门店&nbsp;100家。</p><div><p>第二段 &lt;保留字面&gt;。</p></div><p hidden>隐藏字样</p></article></main>
      <footer>不属于原文的页脚</footer>`);
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const resolved: string[] = [];
  const f = await importApi(value => readPublicRawUrl(value, {
    resolve: async hostname => { resolved.push(hostname); return [publicIp]; },
    request: (url, address, signal) => new Promise((resolve, reject) => {
      assert.deepEqual(address, publicIp);
      const request = http.get({ hostname: '127.0.0.1', port: (fixture.address() as AddressInfo).port, path: url.pathname, signal, headers: { Host: url.host } }, response =>
        resolve({ status: response.statusCode!, headers: response.headers, body: response }),
      );
      request.once('error', reject);
    }),
  }));
  try {
    const imported = await f.post({ metadata: { url: 'https://article.example/go#chapter', title: '', sourceName: '' } });
    assert.equal(imported.status, 201, JSON.stringify(imported));
    const raw = await f.store.get(imported.json.raw.id);
    assert(raw);
    assert.equal(imported.json.kind, 'url');
    assert.equal(imported.json.asset, undefined);
    assert.equal(raw.title, '星桥 & 海岚');
    assert.equal(raw.sourceName, 'media.example');
    assert.equal(raw.url, 'https://article.example/go#chapter');
    assert.equal(raw.urlImport?.finalUrl, 'https://media.example/read');
    assert(Number.isFinite(Date.parse(raw.urlImport!.fetchedAt)));
    assert.equal(raw.extractionParser, 'url_html_text');
    assert.equal(raw.body, '渠道口径\n\n原始正文：直营门店 100家。\n\n第二段 <保留字面>。');
    assert.equal(raw.bodySha256, hash(raw.body));
    assert.equal(raw.status, 'unprocessed');
    assert.deepEqual(received, [{ path: '/go', host: 'article.example' }, { path: '/read', host: 'media.example' }]);
    assert.deepEqual(resolved, ['article.example', 'media.example']);
    assert.equal((await f.assets.list()).length, 0);

    const plain = await f.post({ metadata: { title: '人工标题', url: 'https://article.example/plain' }, body: '  ' });
    assert.equal(plain.status, 201, JSON.stringify(plain));
    assert.equal(plain.json.raw.title, '人工标题');
    assert.equal(plain.json.raw.body, '  原始纯文本\r\n第二行\n');
    assert.equal(plain.json.raw.bodySha256, hash(plain.json.raw.body));
    assert.equal(plain.json.extraction.parser, 'url_plain_text');
  } finally {
    await f.close();
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
  }
});

test('Raw import preserves file and paste priority with zero URL reads, including a retained parser failure', async () => {
  let reads = 0;
  const f = await importApi(async () => { reads++; throw Error('URL branch should not run'); });
  try {
    const metadata = { ...noCredentials, url: 'http://127.0.0.1/nonpublic' };
    const form = new FormData();
    form.set('metadata', JSON.stringify(metadata));
    form.set('body', '不应写入的粘贴正文');
    form.set('file', new Blob(['实际文件正文']), '中文文件.txt');
    const file = await f.post(form);
    assert.equal(file.status, 201, JSON.stringify(file));
    assert.equal(file.json.kind, 'file');
    assert.equal(file.json.raw.assetFileName, '中文文件.txt');
    assert.equal(file.json.raw.body, '实际文件正文');
    assert.equal(file.json.raw.url, metadata.url);
    assert.equal(file.json.raw.urlImport, undefined);
    assert.equal(file.json.asset.sha256, hash('实际文件正文'));
    assert.equal(reads, 0);

    const paste = await f.post({ metadata, body: '  粘贴内容\r\n第二行\n' });
    assert.equal(paste.status, 201);
    assert.equal(paste.json.kind, 'paste');
    assert.equal(paste.json.raw.body, '  粘贴内容\r\n第二行\n');
    assert.equal(paste.json.raw.url, metadata.url);
    assert.equal(paste.json.raw.urlImport, undefined);
    assert.equal(paste.json.asset, undefined);
    assert.equal(reads, 0);

    const longText = '门'.repeat(MAX_BODY_CHARS);
    const multipartPaste = new FormData();
    multipartPaste.set('metadata', JSON.stringify(metadata));
    multipartPaste.set('body', longText);
    const longPaste = await f.post(multipartPaste);
    assert.equal(longPaste.status, 201);
    assert.equal(longPaste.json.kind, 'paste');
    assert.equal(longPaste.json.raw.body, longText);
    assert.equal(reads, 0);

    form.set('file', new Blob(['损坏PDF内容']), '损坏.pdf');
    const failure = await f.post(form);
    assert.equal(failure.status, 415);
    assert.equal(failure.json.error.code, 'FORMAT_MISMATCH');
    assert.equal(failure.json.error.details.retained, true);
    assert.equal((await f.store.list()).length, 3);
    assert.equal(reads, 0);

    const empty = await f.post({ metadata: {}, body: ' \n ' });
    assert.equal(empty.json.error.code, 'MISSING_IMPORT_CONTENT');
    const spoof = await f.post({ metadata: { url: 'https://article.example/go', urlImport: { finalUrl: 'https://fake.example/', fetchedAt: 'fake' } } });
    assert.equal(spoof.json.error.code, 'SYSTEM_FIELD_FORBIDDEN');
    assert.equal(reads, 0);
  } finally { await f.close(); }
});

test('Raw URL native proxy uses a pinned HTTP request target and HTTPS CONNECT with the original TLS name', {
  skip: process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? false : 'This Node version does not support the proxy launcher.',
}, async () => {
  const observed: { http?: { target?: string; host?: string }; tunnel?: string; tlsName?: boolean } = {};
  const proxy = http.createServer((request, response) => {
    observed.http = { target: request.url, host: request.headers.host };
    response.writeHead(200, { 'content-type': 'text/plain' }).end('fixture proxy text');
  });
  proxy.on('connect', (request, socket) => {
    observed.tunnel = request.url;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', bytes => {
      observed.tlsName = bytes.includes(Buffer.from('original-fixture.example'));
      socket.destroy();
    });
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const env = proxyEnv();
  Object.assign(env, { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl });
  try {
    const child = await promisify(execFile)(process.execPath, ['--use-env-proxy', '--import', 'tsx', '--input-type=module', '-e', `
      import { readPublicRawUrl } from './services/raw/url-import.ts';
      const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
      const direct = await readPublicRawUrl('http://original-fixture.example/read?q=1', { resolve });
      let tlsError;
      try { await readPublicRawUrl('https://original-fixture.example/read?q=1', { resolve }); }
      catch (error) { tlsError = error.code; }
      console.log(JSON.stringify({ body: direct.body, tlsError }));
    `], { env, timeout: 10_000 });
    assert.deepEqual(JSON.parse(child.stdout), { body: 'fixture proxy text', tlsError: 'URL_FETCH_FAILED' });
    assert.deepEqual(observed, {
      http: { target: 'http://93.184.216.34/read?q=1', host: 'original-fixture.example' },
      tunnel: '93.184.216.34:443', tlsName: true,
    });
  } finally { await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve())); }
});

test('Raw URL HTTP proxy pins IPv6, confines credentials, and stops on blocked redirects and proxy errors', {
  skip: process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? false : 'This Node version does not support the proxy launcher.',
}, async () => {
  const seen: Array<{ target?: string; host?: string; auth?: string; originAuth?: string }> = [];
  const proxy = http.createServer((request, response) => {
    seen.push({ target: request.url, host: request.headers.host, auth: request.headers['proxy-authorization'], originAuth: request.headers.authorization });
    if (request.url?.endsWith('/redirect')) {
      response.writeHead(302, { location: 'http://mixed-fixture.example/blocked' }).end();
    } else if (request.url?.endsWith('/failure')) {
      request.socket.destroy();
    } else if (!request.url?.endsWith('/timeout')) {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('IPv6 fixture text');
    }
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const port = (proxy.address() as AddressInfo).port;
  try {
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readPublicRawUrl } from './services/raw/url-import.ts';
      const pinned = { address: '2606:4700:4700::1111', family: 6 };
      const resolve = async host => host === 'mixed-fixture.example'
        ? [pinned, { address: '192.168.1.8', family: 4 }] : [pinned];
      const base = 'http://original-fixture.example';
      const result = await readPublicRawUrl(base + '/read?q=1', { resolve });
      assert.equal(result.body, 'IPv6 fixture text');
      await assert.rejects(readPublicRawUrl('http://127.0.0.1/blocked'), { code: 'URL_FETCH_BLOCKED' });
      for (const [route, code] of [['redirect', 'URL_FETCH_BLOCKED'], ['failure', 'URL_FETCH_FAILED'], ['timeout', 'URL_FETCH_TIMEOUT']]) {
        await assert.rejects(readPublicRawUrl(base + '/' + route, { resolve, timeoutMs: 1_000 }), { code });
      }
      console.log('proxy checks passed');
    `], { env: { ...proxyEnv(), NODE_USE_ENV_PROXY: '1', HTTP_PROXY: `http://fixture%40user:fixture%3Apass@127.0.0.1:${port}` }, timeout: 10_000 });
    assert.match(child.stdout, /proxy checks passed/u);
    assert.deepEqual(seen, ['read?q=1', 'redirect', 'failure', 'timeout'].map(route => ({
      target: `http://[2606:4700:4700::1111]/${route}`, host: 'original-fixture.example',
      auth: `Basic ${Buffer.from('fixture@user:fixture:pass').toString('base64')}`, originAuth: undefined,
    })));
  } finally { await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve())); }
});

test('Raw URL HTTP without a proxy or with pinned IP bypass uses origin-form and omits proxy credentials', {
  skip: process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? false : 'This Node version does not support the proxy launcher.',
}, async () => {
  for (const { enabled, args, options } of [
    { enabled: false, args: [], options: {} },
    { enabled: true, args: [], options: { NODE_OPTIONS: '"--use-env-proxy"' } },
    { enabled: false, args: ['--no-use-env-proxy'], options: { NODE_USE_ENV_PROXY: '1' } },
  ]) {
    const child = await promisify(execFile)(process.execPath, [...args, '--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { EventEmitter } from 'node:events';
      import http from 'node:http';
      import { Readable } from 'node:stream';
      import { mock } from 'node:test';
      import { readPublicRawUrl } from './services/raw/url-import.ts';
      const request = mock.method(http, 'request', (_options, respond) => {
        // Confirm request parameters without making any connections to the pinned public IP.
        const response = Object.assign(Readable.from(['transport fixture']), { statusCode: 200, headers: { 'content-type': 'text/plain' } });
        return Object.assign(new EventEmitter(), { end: () => respond(response) });
      });
      const enabled = ${enabled};
      const cases = enabled ? [['*', true], ['93.184.216.34:80', true], [' 192.0.0.1, 93.184.216.33 - 93.184.216.34 ', true],
        ['.184.216.34', true], ['.84.216.34', process.versions.node.startsWith('22.')], ['original-fixture.example', false]] : [['', true]];
      for (const [noProxy, bypass] of cases) {
        process.env.NO_PROXY = noProxy;
        await readPublicRawUrl('http://original-fixture.example/read?q=1', { resolve: async () => [{ address: '93.184.216.34', family: 4 }] });
        const [options] = request.mock.calls.at(-1).arguments;
        assert.equal(options.hostname, bypass ? '93.184.216.34' : '127.0.0.1');
        assert.equal(options.path, (bypass ? '' : 'http://93.184.216.34') + '/read?q=1');
        assert.equal(options.agent, false);
        assert.equal(options.headers.Host, 'original-fixture.example');
        assert.equal(options.headers['Proxy-Authorization'], bypass ? undefined : 'Basic dXNlcjpwYXNz');
      }
      assert.equal(request.mock.callCount(), cases.length);
      console.log('transport checks passed');
    `], { env: { ...proxyEnv(), HTTP_PROXY: 'http://user:pass@127.0.0.1:9', ...options }, timeout: 10_000 });
    assert.match(child.stdout, /transport checks passed/u);
  }
});

const textResponse = (body: string, type = 'text/plain') => ({ status: 200, headers: { 'content-type': type }, body: Readable.from([Buffer.from(body)]) });

test('Raw URL rejects reserved literals, mixed DNS, and a DNS change at redirect before connecting to blocked addresses', async () => {
  let requests = 0;
  const request = async () => { requests++; return textResponse('not reached'); };
  for (const url of ['http://127.1/', 'http://0x7f000001/', 'http://169.254.169.254/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'file:///private', 'https://user:password@public.example/', 'https://public.example:8443/']) {
    await assert.rejects(readPublicRawUrl(url, { resolve: async () => { throw Error('literal should not resolve'); }, request }), { code: 'URL_FETCH_BLOCKED' });
  }
  await assert.rejects(readPublicRawUrl('https://mixed.example/', {
    resolve: async () => [publicIp, { address: '192.168.1.8', family: 4 }], request,
  }), { code: 'URL_FETCH_BLOCKED' });
  assert.equal(requests, 0);
  let resolutions = 0;
  await assert.rejects(readPublicRawUrl('https://public.example/start', {
    resolve: async () => ++resolutions === 1 ? [publicIp] : [{ address: '10.1.1.5', family: 4 }],
    request: async (_url, address) => {
      assert.deepEqual(address, publicIp);
      requests++;
      return { status: 302, headers: { location: '/next' }, body: Readable.from([]) };
    },
  }), { code: 'URL_FETCH_BLOCKED' });
  assert.equal(requests, 1);
  assert.equal(resolutions, 2);
  await assert.rejects(readPublicRawUrl('https://public.example/start', {
    resolve: async () => [publicIp], request: async () => ({ status: 302, headers: { location: 'http://[::1]/secret' }, body: Readable.from([]) }),
  }), { code: 'URL_FETCH_BLOCKED' });
  let finishLookup!: (value: typeof publicIp[]) => void;
  const pendingLookup = new Promise<typeof publicIp[]>(resolve => { finishLookup = resolve; });
  await assert.rejects(readPublicRawUrl('https://public.example/dns-timeout', {
    timeoutMs: 25, resolve: () => pendingLookup, request,
  }), { code: 'URL_FETCH_TIMEOUT' });
  finishLookup([publicIp]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests, 1, 'a late DNS answer cannot start a request');
});

test('Raw URL rejects loop/over-hop, timeouts and bad content without creating a Raw', async () => {
  let requests = 0;
  const f = await importApi(value => readPublicRawUrl(value, {
    timeoutMs: new URL(value).pathname === '/timeout' ? 30 : 3000,
    resolve: async () => [publicIp],
    request: async (url) => {
      requests++;
      const route = url.pathname;
      if (route === '/loop' || route.startsWith('/redirect/')) return { status: 302, headers: { location: route === '/loop' ? route : `/redirect/${Number(route.split('/').at(-1)) + 1}` }, body: Readable.from([]) };
      if (route === '/timeout') return { status: 200, headers: { 'content-type': 'text/plain' }, body: new Readable({ read() {} }) };
      if (route === '/too-large') return { status: 200, headers: { 'content-type': 'text/plain' }, body: Readable.from([Buffer.alloc(MAX_WEB_BYTES), Buffer.from('x')]) };
      if (route === '/too-many-chars') return textResponse('a'.repeat(500_001));
      if (route === '/login') return textResponse(`<title>客户工作台</title><main><form><input type="password"></form><p>${'这是登录页的模板说明。'.repeat(40)}</p></main>`, 'text/html');
      if (route === '/js') return textResponse('<div id="app"></div><script>document.write("禁止执行")</script>', 'text/html');
      if (route === '/partial') return { ...textResponse('这只是未完成的部分正文。'), status: 206 };
      if (route === '/403') return { status: 403, headers: {}, body: Readable.from([]) };
      return textResponse('unsupported', 'application/pdf');
    },
  }));
  try {
    for (const [route, code] of [['/loop', 'URL_REDIRECT_LIMIT'], ['/redirect/0', 'URL_REDIRECT_LIMIT'], ['/timeout', 'URL_FETCH_TIMEOUT'], ['/too-large', 'URL_RESPONSE_TOO_LARGE'], ['/too-many-chars', 'URL_BODY_TOO_LARGE'], ['/login', 'URL_BODY_UNAVAILABLE'], ['/js', 'URL_BODY_UNAVAILABLE'], ['/partial', 'URL_BODY_UNAVAILABLE'], ['/403', 'URL_FETCH_FAILED'], ['/pdf', 'URL_CONTENT_UNSUPPORTED']]) {
      const result = await f.post({ metadata: { url: `https://article.example${route}` } });
      assert.equal(result.json.error.code, code, JSON.stringify(result));
      assert.match(result.json.error.message, /上传文件或粘贴正文/);
      assert.equal((await f.store.list()).length, 0);
    }
    assert.equal(requests, 14);
    assert.equal((await f.assets.list()).length, 0);
  } finally { await f.close(); }
});
