import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { RawStore } from '../../services/raw/store.ts';
import { identifyWebImages } from '../../services/raw/web-material.ts';
import { evaluateImageOcr } from '../../services/raw/media-ocr-triage.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-independent-'));
try {
const store = new RawStore(root);
await store.initialize();
const canvas = createCanvas(900, 350);
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 350);
ctx.fillStyle = 'black'; ctx.font = '32px Arial';
ctx.fillText('Independent migration source document', 25, 100);
ctx.fillText('Preserve original image and body bytes', 25, 180);
const bytes = canvas.toBuffer('image/png');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const imgdir = path.join(root, 'knowledge/raw/web-images');
await mkdir(imgdir, { recursive: true });
await writeFile(path.join(imgdir, sha256), bytes);
async function seed(title, hash = sha256) {
  const body = '图前正文。😃\n【来源图片 1】\n【图片 OCR 转录（需核对）】\nDIRTY_OLD_SENTINEL\n【转录结束】\n图后正文。';
  return store.create({ title, sourceType: 'article', sourceName: 'independent synthetic', tags: [], body,
    webImages: [{ start: body.indexOf('【来源图片'), sourceUrl: 'https://example.invalid/source.png', label: '',
      status: 'transcribed', mime: 'image/png', sha256: hash }] });
}
const normal = await seed('normal');
const outside = await seed('outside');
const edited = await seed('edited');
await store.updateBody(edited.id, { body: '新增前言\n' + edited.body, expectedBodySha256: edited.bodySha256, expectedBodyRevision: 0 }, async () => {});
const removed = await seed('removed');
await store.updateBody(removed.id, { body: removed.body.replace('【来源图片 1】', ''), expectedBodySha256: removed.bodySha256, expectedBodyRevision: 0 }, async () => {});
const duplicate = await seed('duplicate');
await store.updateBody(duplicate.id, { body: duplicate.body + '\n【来源图片 1】', expectedBodySha256: duplicate.bodySha256, expectedBodyRevision: 0 }, async () => {});
const missing = await seed('missing', 'a'.repeat(64));
const corrupt = await seed('corrupt', 'b'.repeat(64));
await writeFile(path.join(imgdir, 'b'.repeat(64)), bytes);
for (const routeStatus of ['skipped', 'ocr_ready', 'needs_vlm', 'vlm_done', 'failed']) {
  const raw = await seed('existing-' + routeStatus);
  const { mediaId } = identifyWebImages(raw.id, raw.webImages)[0];
  await store.saveMediaArtifact(raw.id, mediaId, { ...evaluateImageOcr({ width: 900, height: 350, lines: [{ text: 'Existing trustworthy transcription text' }] }),
    routeStatus, ocrRawText: 'PRIVATE_EXISTING', ...(routeStatus === 'ocr_ready' ? { ocrCleanText: 'existing clean text' } : {}),
    ...(routeStatus === 'vlm_done' ? { vlmMarkdown: 'existing VLM text', vlmSummary: 'existing summary' } : {}) });
}
async function manifest(dir = root, prefix = '') {
  const entries = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + item.name;
    if (item.isDirectory()) Object.assign(entries, await manifest(path.join(dir, item.name), rel + '/'));
    else entries[rel] = createHash('sha256').update(await readFile(path.join(dir, item.name))).digest('hex');
  }
  return entries;
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FMCG_LLM_')));
env.FMCG_DATA_DIR = root;
env.FMCG_LLM_CONFIG_FILE = path.join(root, 'absent-model-config.json');
function cli(args) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-raw-media.ts', '--data-dir', root, ...args], { env, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  console.log(JSON.stringify({ args, status: result.status, stdout: result.stdout, stderr: result.stderr }));
  return result;
}
const baseline = await manifest();
assert.equal(cli(['--raw-id', normal.id]).status, 0);
assert.notEqual(cli(['--all']).status, 0, 'preview reports damaged images');
assert.deepEqual(await manifest(), baseline, 'preview must not write any data');
assert.equal(cli(['--raw-id', normal.id, '--apply']).status, 0);
assert.equal((await store.getMediaArtifacts(outside.id)).length, 0, 'selection scope');
assert.equal((await store.getMediaArtifacts(normal.id))[0].routeStatus, 'ocr_ready');
assert.match((await store.getMediaArtifacts(normal.id))[0].ocrCleanText, /Independent migration/i);
const partial = cli(['--all', '--apply']);
assert.notEqual(partial.status, 0, 'missing/corrupt images must not report complete success');
assert.equal((await store.getMediaArtifacts(edited.id)).length, 1);
assert.equal((await store.getMediaArtifacts(removed.id)).length, 0);
assert.equal((await store.getMediaArtifacts(duplicate.id)).length, 0);
const after = await manifest();
for (const [file, hash] of Object.entries(baseline)) assert.equal(after[file], hash, 'preserve existing file: ' + file);
cli(['--all', '--apply']);
assert.deepEqual(await manifest(), after, 'repeat apply preserves all bytes');
console.log(JSON.stringify({ result: 'PASS', root, assertions: ['preview zero writes', 'native OCR', 'selection scope', 'current anchors', 'existing five states preserved', 'partial failure', 'original bytes preserved', 'idempotence'] }));



} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('aipm-rawocr04-'));
  await rm(root, { recursive: true, force: true });
}
