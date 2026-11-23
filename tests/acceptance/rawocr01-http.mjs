import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCanvas } from '@napi-rs/canvas';
import { evaluateImageOcr } from '../../services/raw/media-ocr-triage.ts';
import { RawStore } from '../../services/raw/store.ts';
import { identifyWebImages, recognizeWebImageLines } from '../../services/raw/web-material.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr01-http-'));
let child;
try {
  const canvas = createCanvas(800, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 800, 200);
  ctx.fillStyle = 'black';
  ctx.font = '36px sans-serif';
  ctx.fillText('Store operations report', 30, 65);
  ctx.fillText('Weekly results summary', 30, 130);
  const original = canvas.toBuffer('image/png');
  if (process.argv.includes('--tesseract')) {
    const lines = await recognizeWebImageLines(original);
    assert.equal(lines.length, 2);
    assert.match(lines[0].text, /operations report/u);
    assert.ok(lines.every(({ bbox, confidence }) => bbox?.length === 4 && confidence >= 0.72));
    assert.equal(evaluateImageOcr({ width: canvas.width, height: canvas.height, lines }).routeStatus, 'ocr_ready');
    console.log('Local Tesseract: two recognized lines with bounding boxes and confidence; OCR ready.');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 800, 200);
    ctx.fillStyle = 'black';
    ctx.font = '36px "Microsoft YaHei", sans-serif';
    ctx.fillText('本周我们整理了用户对工作台的反馈', 30, 65);
    ctx.fillText('并补充了来源资料供桌面团队核对。', 30, 130);
    const chineseLines = await recognizeWebImageLines(canvas.toBuffer('image/png'));
    const chinese = evaluateImageOcr({ width: canvas.width, height: canvas.height, lines: chineseLines });
    assert.equal(chinese.routeStatus, 'ocr_ready', JSON.stringify({ chineseLines, metrics: chinese.metrics }));
    assert.match(chinese.ocrCleanText, /本周我们整理了用户/u);
    assert.match(chinese.ocrCleanText, /来源资料/u);
    console.log('Local Tesseract: continuous Chinese supports readable OCR-ready text.');
  }

  const store = new RawStore(root);
  const body = '公开文章正文\n【来源图片 1】';
  const sha256 = createHash('sha256').update(original).digest('hex');
  const raw = await store.create({
    title: 'HTTP fixture', sourceType: 'article', sourceName: 'fixture', tags: [], body,
    webImages: [{ start: body.indexOf('【'), sourceUrl: 'https://example.invalid/image.png', label: '示例', status: 'transcribed', mime: 'image/png', sha256 }],
  });
  const [image] = identifyWebImages(raw.id, raw.webImages);
  const originalsDirectory = path.join(root, 'knowledge', 'raw', 'web-images');
  await mkdir(originalsDirectory, { recursive: true });
  await writeFile(path.join(originalsDirectory, sha256), original);
  const sentinel = 'RAW_OCR_DIAGNOSTIC_SENTINEL';
  const evaluation = evaluateImageOcr({ width: 80, height: 80, lines: [{ text: sentinel }] });
  assert.equal((await store.saveMediaArtifact(raw.id, image.mediaId, evaluation)).ocrRawText, sentinel);

  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_LLM_/iu.test(key)));
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, FMCG_DATA_DIR: root, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env') },
  });
  const url = `http://127.0.0.1:${port}`;
  const ready = async () => (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) })).ok;
  let healthy = false;
  for (let i = 0; i < 120 && !healthy; i++) {
    assert.equal(child.exitCode, null);
    healthy = await ready().catch(() => false);
    if (!healthy) await delay(100);
  }
  assert.ok(healthy);
  for (const route of ['/api/raw', '/api/raw?summary=true', `/api/raw/${raw.id}`]) {
    const response = await fetch(url + route);
    assert.equal(response.status, 200, route);
    const text = await response.text();
    assert.ok(!text.includes('ocrRawText') && !text.includes(sentinel), route);
    const visible = route.startsWith('/api/raw/') ? JSON.parse(text) : JSON.parse(text).items[0];
    assert.deepEqual(visible.webImages, raw.webImages);
    if (!route.includes('?summary')) {
      assert.equal(visible.body, body);
      assert.equal(visible.bodySha256, raw.bodySha256);
    }
  }
  const retained = await fetch(`${url}/api/raw/${raw.id}/web-images/${sha256}`);
  assert.equal(retained.status, 200);
  assert.deepEqual(Buffer.from(await retained.arrayBuffer()), original);
  console.log('Production HTTP: Raw list, summary and detail omit diagnostic OCR; original bytes match.');
} finally {
  if (child?.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await rm(root, { recursive: true, force: true });
}
