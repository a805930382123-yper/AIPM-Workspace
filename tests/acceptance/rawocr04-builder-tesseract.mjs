import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { RawStore } from '../../services/raw/store.ts';
import { webImageRelativePath } from '../../services/raw/web-material.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-tesseract-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('FMCG_LLM_')) delete env[key];
env.FMCG_DATA_DIR = root;
env.FMCG_LLM_CONFIG_FILE = path.join(root, 'absent-config.json');
async function snapshot() {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files[path.relative(root, file)] = hash(await readFile(file));
    }
  }
  await walk(root);
  return files;
}
async function run(args, exitCode = 0) {
  let output;
  try {
    output = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/migrate-raw-media.ts', '--data-dir', root, ...args], { env });
    assert.equal(exitCode, 0);
  } catch (error) {
    assert.equal(error.code, exitCode);
    output = error;
  }
  return JSON.parse(output.stdout);
}
try {
  const canvas = createCanvas(800, 240);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 800, 240);
  context.fillStyle = 'black';
  context.font = '36px sans-serif';
  context.fillText('Store operations report', 30, 65);
  context.fillText('Weekly results summary', 30, 130);
  const png = canvas.toBuffer('image/png');
  const sha256 = hash(png);
  const imageFile = path.join(root, webImageRelativePath(sha256));
  await mkdir(path.dirname(imageFile), { recursive: true });
  await writeFile(imageFile, png);
  const store = new RawStore(root);
  const body = '原文开头。\n【来源图片 1】\n【图片 OCR 转录（需核对）】\nLEGACY_SENTINEL\n【转录结束】\n【来源图片 2】\n原文结尾。';
  const input = { title: '本机迁移样本', sourceType: 'article', sourceName: 'fixture', tags: [], body,
    webImages: [sha256, 'a'.repeat(64)].map((digest, index) => ({ start: body.indexOf(`【来源图片 ${index + 1}】`),
      sourceUrl: `https://publisher.invalid/${index}.png`, label: '', mime: 'image/png', sha256: digest, status: 'transcribed' })) };
  const raw = await store.create(input);
  const outside = await store.create(input);
  const before = await snapshot();
  const preview = await run(['--raw-id', raw.id], 1);
  assert.equal(preview.summary.planned, 1);
  assert.equal(preview.summary.error, 1);
  assert.deepEqual(await snapshot(), before);
  const applied = await run(['--raw-id', raw.id, '--apply'], 1);
  assert.equal(applied.summary.migrated, 1);
  assert.equal(applied.summary.error, 1);
  assert.equal(applied.complete, false);
  const artifacts = await store.getMediaArtifacts(raw.id);
  assert.equal(artifacts[0].routeStatus, 'ocr_ready');
  assert.match(artifacts[0].ocrCleanText, /operations report/u);
  assert.equal(artifacts[0].width, 800);
  assert.equal(artifacts[0].height, 240);
  assert.equal((await store.getMediaArtifacts(outside.id)).length, 0);
  const after = await snapshot();
  for (const [file, digest] of Object.entries(before)) assert.equal(after[file], digest, file);
  const repeated = await run(['--raw-id', raw.id, '--apply'], 1);
  assert.equal(repeated.summary.existing, 1);
  assert.equal(repeated.summary.error, 1);
  assert.deepEqual(await snapshot(), after);
  assert.equal((await store.get(raw.id)).body, body);
  console.log(JSON.stringify({ tesseract: 'real chi_sim+eng', preview: preview.summary, apply: applied.summary,
    rerun: repeated.summary, originalFilesUnchanged: Object.keys(before).length, cleanText: artifacts[0].ocrCleanText,
    paidModelRequests: 0, outsideUnchanged: true }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
