import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { registerRawMediaRoutes } from '../server/raw-media.ts';
import { RawStore } from '../services/raw/store.ts';
import { identifyWebImages } from '../services/raw/web-material.ts';
import { MediaVlmParserService } from '../services/raw/media-vlm.ts';

test('RAWOCR04 media HTTP exposes current reading coordinates while preserving source and history bytes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-reading-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new RawStore(directory);
  const body = '前方原文\n【来源图片 1】\n【图片 OCR 转录（需核对）】\nPRIVATE_OCR_SENTINEL\n【转录结束】\n后方原文';
  const raw = await store.create({
    title: '合成历史阅读',
    sourceType: 'article',
    sourceName: '合成来源',
    tags: [],
    body,
    webImages: [
      {
        start: body.indexOf('【来源图片 1】'),
        status: 'transcribed',
        label: '',
        sourceUrl: 'https://example.test/1.png',
      },
    ],
  });
  const [image] = identifyWebImages(raw.id, raw.webImages);
  await store.saveMediaArtifact(raw.id, image.mediaId, {
    routeStatus: 'ocr_ready',
    routeReasons: [],
    ocrRawText: 'PRIVATE_DERIVATIVE_SENTINEL',
    ocrCleanText: '清洗识别正文',
    metrics: {
      effectiveCharCount: 6,
      nonEmptyLineCount: 1,
      shortLineRatio: 0,
      gibberishRatio: 0,
      layoutDispersion: 0,
      chartSignalScore: 0,
      avgConfidence: 1,
      qualityScore: 100,
    },
  });
  let providerCalls = 0;
  const app = express();
  registerRawMediaRoutes(app, store, new MediaVlmParserService(store), () => {
    providerCalls++;
    return undefined;
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/raw/${raw.id}/media`;
  const file = path.join(directory, 'knowledge/raw/articles', `${raw.id}.md`);
  const original = await readFile(file);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.items[0].ocrCleanText, '清洗识别正文');
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_|ocrRawText/u);
  assert.equal(first.readingSource.bodySha256, raw.bodySha256);
  assert.equal(first.readingSource.markers[0].start, body.indexOf('【来源图片 1】'));
  assert.match(
    body.slice(first.readingSource.removed[0].start, first.readingSource.removed[0].end),
    /PRIVATE_OCR_SENTINEL/u,
  );
  assert.deepEqual(await readFile(file), original);
  const edited = (await store.updateBody(
    raw.id,
    {
      body: '人工引言\n' + body.replace('PRIVATE_OCR_SENTINEL', 'PRIVATE_REVISED_SENTINEL'),
      expectedBodySha256: raw.bodySha256,
      expectedBodyRevision: 0,
    },
    async () => {},
  ))!;
  const editedBytes = await readFile(file);
  const second = await (await fetch(url)).json();
  assert.equal(second.readingSource.markers[0].start, edited.body.indexOf('【来源图片 1】'));
  assert.equal(second.readingSource.bodySha256, edited.bodySha256);
  assert.doesNotMatch(JSON.stringify(second), /PRIVATE_/u);
  assert.deepEqual(await readFile(file), editedBytes);
  assert.deepEqual(await readFile(path.join(directory, 'knowledge/raw/history', raw.id, '0.md')), original);
  assert.equal((await store.get(raw.id))!.body, edited.body);
  assert.equal(providerCalls, 0);
});
