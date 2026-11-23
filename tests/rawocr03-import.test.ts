import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerRawImportRoute } from '../server/raw-import.ts';
import { AssetStore } from '../services/raw/assets.ts';
import { RawMediaImportError, RawStore } from '../services/raw/store.ts';
import { identifyWebImages, readWebImage, readWebMaterial } from '../services/raw/web-material.ts';
import { publicMediaArtifact } from '../services/raw/media-vlm.ts';
import { acquireNewsMaterial } from '../services/news/raw-material.ts';
import { NewsRawSave } from '../services/news/raw-save.ts';
import type { NewsItem } from '../services/news/types.ts';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const paragraph = '清晰技术说明需要保留完整来源和核对信息。';
const sentinel = 'RAW_OCR_PRIVATE_SENTINEL';
const item: NewsItem = {
  id: 'r3',
  title: '网页样本',
  sourceId: 'fixture',
  sourceName: 'fixture',
  url: 'https://publisher.test/story',
  fetchedAt: '2026-11-23T00:00:00Z',
  publishedAt: '2026-11-23',
  evidenceKind: 'source_summary',
  excerpt: '摘录',
};
const png = (width = 800, height = 400) => createCanvas(width, height).toBuffer('image/png');
const images = { '/text.png': png(), '/rank.png': png(700, 500), '/logo.png': png(60, 40) };
const html =
  '<article><p>网页原文第一段。</p><img width="50" src="/text.png"><img src="/rank.png"><img src="/logo.png" alt="装饰"><img src="/text.png"><p>网页原文最后一段。</p></article>';

async function fixture(t: TestContext, inputHtml = html, failOcr = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr03-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  const options = {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (url: URL) => ({
      status: url.pathname === '/missing.png' ? 503 : 200,
      headers: { 'content-type': url.pathname === '/story' ? 'text/html' : 'image/png' },
      body: Readable.from([
        url.pathname === '/story' ? inputHtml : (images[url.pathname as keyof typeof images] ?? ''),
      ]),
    }),
    ocr: async (bytes: Buffer) => {
      if (failOcr) throw new Error('OCR unavailable');
      return bytes.equals(images['/rank.png'])
        ? [{ text: '排名   指标   数值' }, { text: '北京   2025   80%' }, { text: '上海   2026   90%' }]
        : [{ text: `${paragraph}\n${sentinel}`, confidence: 0.98 }];
    },
  };
  const read = () => readWebMaterial(root, item.url, options);
  const app = express();
  app.use(express.json());
  registerRawImportRoute(app, { store: raws, assets: new AssetStore(root), readUrl: read });
  app.use(((error, _req, res, _next) => {
    void _next;
    res.status(error.status ?? 500).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = () =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/raw/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { url: item.url } }),
    });
  const news = new NewsRawSave(root, raws, () => new Date(item.fetchedAt), {
    acquire: (value, partial) => acquireNewsMaterial(root, value, partial, options),
  });
  return { root, raws, read, post, news };
}

test('both import entries retain source text and occurrence identity while persisting the three OCR routes separately', async (t) => {
  const { root, raws, post, news } = await fixture(t);
  const response = await post();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  const saved = await news.save('2026-11-23', 'ai', item);
  for (const rawId of [result.raw.id, saved.rawId]) {
    const raw = (await new RawStore(root).get(rawId))!;
    assert.doesNotMatch(raw.body, /OCR|清晰技术|排名|PRIVATE/u);
    assert.match(raw.body, /网页原文第一段。[\s\S]*来源图片 1[\s\S]*来源图片 4[\s\S]*网页原文最后一段。/u);
    assert.equal(raw.bodySha256, hash(raw.body));
    assert.equal('webImageArtifacts' in raw, false);
    const artifacts = await raws.getMediaArtifacts(rawId);
    assert.deepEqual(
      artifacts.map((x) => x.routeStatus),
      ['ocr_ready', 'needs_vlm', 'skipped', 'ocr_ready'],
    );
    assert.equal(artifacts[0].width, 800, 'HTML width=50 does not bypass actual-dimension routing');
    const identified = identifyWebImages(rawId, raw.webImages);
    assert.notEqual(identified[0].mediaId, identified[3].mediaId);
    assert.equal(identified[0].sha256, identified[3].sha256);
    for (const image of identified) {
      assert.equal(hash((await readWebImage(root, image))!), image.sha256);
      assert.match(raw.body.slice(image.start), new RegExp(`^【来源图片 ${image.imageIndex}`, 'u'));
    }
    assert.equal(JSON.stringify(artifacts.map(publicMediaArtifact)).includes('ocrRawText'), false);
    assert.equal((await raws.buildMediaInput(raw, false)).body, raw.body);
    const bytes = await readFile(path.join(root, 'knowledge', 'raw', 'articles', `${rawId}.md`));
    await raws.getAnchoredMediaArtifacts(raw);
    assert.deepEqual(await readFile(path.join(root, 'knowledge', 'raw', 'articles', `${rawId}.md`)), bytes);
  }
});

test('OCR and image download failures preserve available source material and require explicit partial news retention', async (t) => {
  const { raws, post, news } = await fixture(
    t,
    '<article><p>来源文字。</p><img src="/text.png"><img src="/missing.png"></article>',
    true,
  );
  const response = await post();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(result.extraction.note, /OCR 未完成[\s\S]*原图读取失败/u);
  const raw = (await raws.get(result.raw.id))!;
  const artifacts = await raws.getMediaArtifacts(raw.id);
  assert.deepEqual(
    artifacts.map((x) => x.routeStatus),
    ['failed', 'failed'],
  );
  assert.ok(raw.webImages![0].sha256);
  assert.equal(raw.webImages![1].sha256, undefined);
  assert.doesNotMatch(raw.body, /OCR 未完成|原图读取失败/u);
  await assert.rejects(news.save('2026-11-23', 'ai', item), /OCR 未完成/u);
  const retained = await news.save('2026-11-23', 'ai', item, undefined, { keepPartial: true });
  assert.equal(retained.material.canSupplement, true);
});

test('derivative write failure identifies the committed Raw and news retry repairs the same record without overwriting a later result', async (t) => {
  const { raws, post, news } = await fixture(t);
  const save = raws.saveMediaArtifact.bind(raws);
  raws.saveMediaArtifact = async () => {
    throw new Error('disk failure');
  };
  const response = await post();
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.error.code, 'RAW_MEDIA_IMPORT_INCOMPLETE');
  assert.equal(result.error.details.committed, true);
  assert.ok(await raws.get(result.error.details.rawId));
  assert.match(result.error.message, /不要重复导入/u);
  await assert.rejects(news.save('2026-11-23', 'ai', item), RawMediaImportError);
  const before = await raws.list();
  assert.equal(before.length, 2);
  raws.saveMediaArtifact = save;
  const retried = await news.save('2026-11-23', 'ai', item);
  assert.equal((await raws.list()).length, 2);
  assert.equal((await raws.getMediaArtifacts(retried.rawId)).length, 4);
  const artifact = (await raws.getMediaArtifacts(retried.rawId))[0];
  await save(retried.rawId, artifact.mediaId, {
    ...artifact,
    routeStatus: 'vlm_done',
    vlmSummary: '已精读',
    vlmMarkdown: '新结果',
  });
  await news.save('2026-11-23', 'ai', item);
  assert.equal((await raws.getMediaArtifacts(retried.rawId))[0].routeStatus, 'vlm_done');
});

test('no-image articles and image-only pages remain readable, while records without derivatives are not migrated by reads', async (t) => {
  for (const body of ['<article><p>只有正文。</p></article>', '<article><img src="/text.png"></article>']) {
    const { root, raws, post } = await fixture(t, body);
    const response = await post();
    assert.equal(response.status, 201);
    const raw = (await response.json()).raw;
    assert.ok(raw.body.trim());
    const legacy = await raws.create({
      title: '旧资料',
      sourceName: '旧来源',
      sourceType: 'article',
      tags: [],
      body: raw.body,
      webImages: raw.webImages,
    });
    assert.deepEqual(await new RawStore(root).getMediaArtifacts(legacy.id), []);
    await raws.get(legacy.id);
    await raws.buildMediaInput(legacy);
    assert.deepEqual(await raws.getMediaArtifacts(legacy.id), []);
  }
});

test('the existing image-count limit leaves a distinct explicit failed occurrence instead of claiming successful parsing', async (t) => {
  const { raws, post } = await fixture(t, `<article>${'<img src="/text.png">'.repeat(17)}</article>`);
  const response = await post();
  const result = await response.json();
  const artifacts = await raws.getMediaArtifacts(result.raw.id);
  assert.equal(artifacts.length, 17);
  assert.equal(artifacts[16].routeStatus, 'failed');
  assert.deepEqual(artifacts[16].routeReasons, ['image_count_limit']);
  assert.match(result.extraction.note, /图片 17 原图读取失败或超出读取限额/u);
});
