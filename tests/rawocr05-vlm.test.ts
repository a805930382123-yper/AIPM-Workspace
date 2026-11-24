import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { OpenAiCompatibleProvider } from '../services/llm/provider.ts';
import { MediaVlmParserService, publicMediaArtifact } from '../services/raw/media-vlm.ts';
import { evaluateImageOcr } from '../services/raw/media-ocr-triage.ts';
import { RawStore } from '../services/raw/store.ts';
import { identifyWebImages, readWebImage, readWebMaterial } from '../services/raw/web-material.ts';
import { writeFileAtomic } from '../services/storage/files.ts';

const png = createCanvas(80, 64).toBuffer('image/png');
const jpeg = createCanvas(2400, 1200).toBuffer('image/jpeg');
const webp = createCanvas(100, 60).toBuffer('image/webp');
const secret = 'sk-rawocr05-secret-fixture';
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('WeChat image requests use a browser UA on the CDN and record download outcomes without changing retained bytes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr05-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const calls: Array<{ hostname: string; pathname: string; userAgent?: string }> = [];
  const material = await readWebMaterial(root, 'https://mp.weixin.qq.com/story', {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async ({ hostname, pathname }, _address, _signal, _accept, userAgent) => {
      calls.push({ hostname, pathname, userAgent });
      if (pathname === '/story')
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: Readable.from([
            '<article><p>正文</p><img data-src="https://mmbiz.qpic.cn/saved"><img data-src="https://mmbiz.qpic.cn/forbidden"><img data-src="https://mmbiz.qpic.cn/invalid"><img data-src="https://mmbiz.qpic.cn/invalid"></article>',
          ]),
        };
      if (pathname === '/saved' && hostname === 'mmbiz.qpic.cn')
        return { status: 302, headers: { location: 'https://files.example.test/saved' }, body: Readable.from([]) };
      return {
        status: pathname === '/forbidden' ? 403 : 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: Readable.from([pathname === '/saved' ? webp : secret]),
      };
    },
    ocr: async () => '',
  });
  assert.deepEqual(
    calls.map(({ hostname, pathname }) => [hostname, pathname]),
    [
      ['mp.weixin.qq.com', '/story'],
      ['mmbiz.qpic.cn', '/saved'],
      ['files.example.test', '/saved'],
      ['mmbiz.qpic.cn', '/forbidden'],
      ['mmbiz.qpic.cn', '/invalid'],
    ],
  );
  for (const call of calls) {
    if (call.hostname === 'mmbiz.qpic.cn') assert.match(call.userAgent!, /Mozilla.*Chrome/u);
    else assert.equal(call.userAgent, undefined);
  }
  assert.deepEqual(await readWebImage(root, material.images[0]), webp);
  assert.equal(material.images[0].mime, 'image/webp');
  assert.deepEqual(
    material.artifacts.map((item) => item.mediaFailure),
    [
      undefined,
      { stage: 'download', code: 'URL_FETCH_FAILED', httpStatus: 403 },
      { stage: 'download', code: 'MEDIA_DOWNLOAD_INVALID_IMAGE' },
      { stage: 'download', code: 'MEDIA_DOWNLOAD_INVALID_IMAGE' },
    ],
  );
  assert.equal(warnings.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(warnings.mock.calls.map(({ arguments: args }) => args)), /sk-rawocr05|<article>/u);
});

test('VLM sends normalized local image bytes and persists only stage, fixed code and safe diagnostics on failure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr05-vlm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const outcomes = [
    'jpeg',
    'webp',
    'imageInput',
    'auth',
    'network',
    'response',
    'unretained',
    'corrupt',
    'decode',
    'noContent',
  ];
  const undecodable = Buffer.from('47494638396100000000', 'hex');
  const originalBytes = [jpeg, webp, png, png, png, png, undefined, png.subarray(0, 8), undecodable, png];
  const originals = originalBytes.map((bytes, i) => ({
    start: 0,
    sourceUrl: 'https://example.invalid/image',
    status: 'failed' as const,
    label: '',
    ...(bytes
      ? {
          sha256: sha256(bytes),
          mime: i === 0 ? 'image/jpeg' : i === 1 ? 'image/webp' : i === 8 ? 'image/gif' : 'image/png',
        }
      : {}),
  }));
  const body = outcomes.map((_, i) => '【来源图片 ' + (i + 1) + '】').join('\n');
  const raws = new RawStore(root);
  const raw = await raws.create({
    title: '旧资料兼容',
    sourceName: '回环验证',
    sourceType: 'article',
    tags: [],
    body,
    webImages: originals.map((image, i) => ({ ...image, start: body.indexOf('【来源图片 ' + (i + 1) + '】') })),
  });
  const media = identifyWebImages(raw.id, raw.webImages);
  const localPaths = media.map((item) => path.join(root, 'knowledge', 'raw', 'web-images', item.sha256 ?? 'unused'));
  for (const [index, occurrence] of media.entries()) {
    const bytes = originalBytes[index];
    if (bytes) await writeFileAtomic(localPaths[index], index === 7 ? png : bytes);
    await raws.saveMediaArtifact(raw.id, occurrence.mediaId, {
      ...evaluateImageOcr({ lines: [] }),
      routeStatus: [0, 9].includes(index) ? 'skipped' : 'failed',
      decisionReason: index === 1 ? undefined : `示例处理依据 ${index + 1}`,
    });
  }
  const requests: Array<{ index: number; data: string; manual: boolean }> = [];
  const providerServer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString());
    const [{ text }, { image_url }] = messages[1].content;
    const index = JSON.parse(text).image_index - 1;
    requests.push({ index, data: image_url.url, manual: messages[0].content.includes('用户要求手动精读') });
    if (outcomes[index] === 'network') {
      res.destroy();
      return;
    }
    const reply = (response: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    };
    if (outcomes[index] === 'imageInput')
      return reply({ error: { param: 'messages[1].content[1].image_url', message: secret } }, 400);
    if (outcomes[index] === 'auth') return reply({ error: { message: secret } }, 401);
    const noContent = outcomes[index] === 'noContent';
    const value = {
      should_skip: noContent,
      image_type: noContent ? 'decorative' : 'flowchart',
      summary: noContent ? '' : '精读成功',
      markdown: noContent ? '' : '提取流程',
      confidence: 'high',
      warnings: [],
    };
    reply({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: outcomes[index] === 'response' ? '{' + secret : JSON.stringify(value) },
        },
      ],
    });
  });
  providerServer.listen(0, '127.0.0.1');
  await once(providerServer, 'listening');
  t.after(() => new Promise<void>((resolve) => providerServer.close(() => resolve())));
  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'http://127.0.0.1:' + (providerServer.address() as AddressInfo).port + '/v1',
    apiKey: secret,
    model: 'test-vision',
    source: 'env',
  });
  const service = new MediaVlmParserService(raws);
  assert.equal((await service.parse(raw.id, media[0].mediaId, { provider })).routeStatus, 'skipped');
  assert.deepEqual(await service.batch(raw.id, { provider }), []);
  assert.equal(requests.length, 0);
  const statuses = [];
  for (const [index, { mediaId }] of media.entries()) {
    statuses.push(
      await service.parse(raw.id, mediaId, {
        provider: index === 6 ? undefined : provider,
        force: [0, 2, 6, 9].includes(index),
      }),
    );
  }
  assert.deepEqual(
    statuses.map(({ routeStatus }) => routeStatus),
    ['vlm_done', 'vlm_done', ...Array(8).fill('failed')],
  );
  assert.deepEqual(
    statuses.map(({ mediaFailure }) => mediaFailure),
    [
      undefined,
      undefined,
      { stage: 'provider', code: 'LLM_IMAGE_REJECTED', httpStatus: 400 },
      { stage: 'provider', code: 'LLM_AUTH_FAILED', httpStatus: 401 },
      { stage: 'provider', code: 'LLM_NETWORK_ERROR', networkCause: 'UND_ERR_SOCKET' },
      { stage: 'response', code: 'MEDIA_JSON_INVALID' },
      { stage: 'download', code: 'MEDIA_DOWNLOAD_UNAVAILABLE' },
      { stage: 'original', code: 'MEDIA_ORIGINAL_UNAVAILABLE' },
      { stage: 'image', code: 'MEDIA_IMAGE_PREPARE_FAILED' },
      { stage: 'response', code: 'MEDIA_NO_EXTRACTABLE_CONTENT' },
    ],
  );
  assert.deepEqual(
    requests.map(({ index }) => index),
    [0, 1, 2, 3, 4, 4, 5, 5, 9],
  );
  assert.deepEqual(
    requests.filter(({ manual }) => manual).map(({ index }) => index),
    [0, 2, 9],
  );
  for (const [index, expectedMime, expectedSize] of [
    [0, 'image/jpeg', [1800, 900]],
    [1, 'image/png', [100, 60]],
  ] as const) {
    const [prefix, encoded] = requests[index].data.split(',');
    assert.equal(prefix, 'data:' + expectedMime + ';base64');
    const output = await loadImage(Buffer.from(encoded, 'base64'));
    assert.deepEqual([output.width, output.height], expectedSize);
    assert.deepEqual(await readFile(localPaths[index]), originalBytes[index]);
  }
  assert.equal((await raws.get(raw.id))?.body, body);
  const persisted = (await raws.getMediaArtifacts(raw.id)).map(publicMediaArtifact);
  assert.deepEqual(
    persisted.map(({ decisionReason }) => decisionReason),
    outcomes.map((_, index) => (index === 1 ? undefined : `示例处理依据 ${index + 1}`)),
  );
  assert.equal(warnings.mock.callCount(), 8);
  const evidence = JSON.stringify({
    artifacts: persisted,
    logs: warnings.mock.calls.map(({ arguments: args }) => args),
  });
  assert.doesNotMatch(evidence, /sk-rawocr05|data:image|ocrRawText/u);
});
