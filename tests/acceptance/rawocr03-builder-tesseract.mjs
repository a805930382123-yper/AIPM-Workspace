import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import express from 'express';
import { registerRawImportRoute } from '../../server/raw-import.ts';
import { AssetStore } from '../../services/raw/assets.ts';
import { RawStore } from '../../services/raw/store.ts';
import { readWebMaterial, readWebImage, identifyWebImages, recognizeWebImageLines } from '../../services/raw/web-material.ts';
import { checkLocalOcr } from '../../services/raw/local-ocr.ts';
import { acquireNewsMaterial } from '../../services/news/raw-material.ts';
import { NewsRawSave } from '../../services/news/raw-save.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr03-tesseract-'));
for (const key of Object.keys(process.env)) if (key.startsWith('FMCG_LLM_')) delete process.env[key];
process.env.FMCG_DATA_DIR = root;
process.env.FMCG_LLM_CONFIG_FILE = path.join(root, 'absent-model-config.json');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canvas = createCanvas(800, 240);
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, 800, 240);
ctx.fillStyle = 'black';
ctx.font = '36px sans-serif';
ctx.fillText('Store operations report', 30, 65);
ctx.fillText('Weekly results summary', 30, 130);
const png = canvas.toBuffer('image/png');
// Two transparent 1×1 frames. Leptonica rejects this GIF without first-frame conversion.
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAAh+QQBAAAAACwAAAAAAQABAAACAUQAOw==', 'base64');
const html = '<article><p>保留网页原文字段。</p><img width="40" src="/figure.png"><p>保留图片后的正文。</p><img src="/figure.png"><img src="/animation.gif"></article>';
const fixture = http.createServer((req, res) => {
  const [type, body] =
    req.url === '/story' ? ['text/html', html] : req.url === '/animation.gif' ? ['image/gif', gif] : ['image/png', png];
  res.writeHead(200, { 'content-type': type });
  res.end(body);
});
let apiServer;
try {
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const options = {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (url) => new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: fixture.address().port, path: url.pathname }, (res) => {
        resolve({ status: res.statusCode, headers: res.headers, body: res });
      }).on('error', reject);
    }),
  };
  const store = new RawStore(root);
  const app = express();
  app.use(express.json());
  registerRawImportRoute(app, {
    store, assets: new AssetStore(root),
    readUrl: (url) => readWebMaterial(root, url, options),
  });
  const errors = [];
  app.use((error, _req, res, _next) => { errors.push(error.message); res.status(500).json({ error: error.message }); });
  apiServer = app.listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  const result = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/raw/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ metadata: { url: 'https://publisher.test/story' } }),
  });
  assert.equal(result.status, 201);
  const manual = await result.json();
  const item = { id: 'real-ocr', sourceId: 'fixture', sourceName: 'fixture', title: '本机 OCR 导入样本',
    url: 'https://publisher.test/story', publishedAt: '2026-11-23', fetchedAt: '2026-11-23T00:00:00Z',
    excerpt: '仅摘要', evidenceKind: 'source_summary' };
  const news = new NewsRawSave(root, store, () => new Date(item.fetchedAt), {
    acquire: (item, keep) => acquireNewsMaterial(root, item, keep, options),
  });
  const saved = await news.save('2026-11-23', 'ai', item);
  const summary = [];
  for (const id of [manual.raw.id, saved.rawId]) {
    const raw = await new RawStore(root).get(id);
    const artifacts = await store.getMediaArtifacts(id);
    assert.deepEqual(artifacts.map((x) => x.routeStatus), ['ocr_ready', 'ocr_ready', 'skipped']);
    assert.match(artifacts[0].ocrCleanText, /operations report/u);
    assert.equal(artifacts[0].width, 800);
    assert.equal(artifacts[0].height, 240);
    assert.doesNotMatch(raw.body, /operations|Weekly|OCR|转录/u);
    assert.equal(raw.bodySha256, hash(raw.body));
    const originalBytes = await readFile(path.join(root, 'knowledge', 'raw', 'articles', `${id}.md`));
    const occurrences = identifyWebImages(id, raw.webImages);
    assert.notEqual(occurrences[0].mediaId, occurrences[1].mediaId);
    for (const [index, image] of raw.webImages.entries())
      assert.deepEqual(await readWebImage(root, image), index === 2 ? gif : png);
    assert.equal(raw.webImages[2].mime, 'image/gif');
    assert.deepEqual(artifacts[2].routeReasons, ['tiny_or_banner_image']);
    await store.getAnchoredMediaArtifacts(raw);
    assert.deepEqual(await readFile(path.join(root, 'knowledge', 'raw', 'articles', `${id}.md`)), originalBytes);
    summary.push({ images: artifacts.length, states: artifacts.map((x) => x.routeStatus),
      bodySha256: raw.bodySha256, imageSha256: hash(png), avgConfidence: artifacts[0].metrics.avgConfidence });
  }
  assert.deepEqual(errors, []);
  const engine = await checkLocalOcr();
  const tessdata = path.join(root, 'missing-tessdata');
  await mkdir(tessdata);
  process.env.TESSDATA_PREFIX = tessdata;
  await assert.rejects(checkLocalOcr(), {
    code: 'local_ocr_language_missing',
    affectedLanguages: ['chi_sim', 'eng'],
  });
  for (const language of ['chi_sim', 'eng'])
    await writeFile(path.join(tessdata, `${language}.traineddata`), 'not a traineddata file');
  await assert.rejects(recognizeWebImageLines(png), { code: 'local_ocr_language_load_failed' });
  console.log(JSON.stringify({
    result: 'PASS', engineSource: engine.source, manualAndNews: summary, realProviderRequests: 0,
    languageDiagnostics: ['missing', 'unloadable'],
  }, null, 2));
} finally {
  await Promise.all([apiServer, fixture].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(root, { recursive: true, force: true });
}
