import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { migrateRawMedia } from '../services/raw/media-migration.ts';
import { evaluateImageOcr } from '../services/raw/media-ocr-triage.ts';
import { RawStore, type RawRecord } from '../services/raw/store.ts';
import { identifyWebImages, webImageRelativePath } from '../services/raw/web-material.ts';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const prose = '清晰技术说明需要保留完整来源和核对信息。';
const png = (width = 800, height = 400) => createCanvas(width, height).toBuffer('image/png');
const ocr = async () => [{ text: prose, confidence: 0.99 }];
async function setup(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new RawStore(root);
  return { root, store };
}
async function legacy(store: RawStore, buffers = [png()]) {
  let body = '原文开始。\n';
  const webImages = [];
  for (const [index, bytes] of buffers.entries()) {
    const sha256 = hash(bytes);
    const target = path.join(store.root, webImageRelativePath(sha256)!);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    webImages.push({
      start: body.length,
      sourceUrl: 'https://publisher.invalid/same-image.png',
      sha256,
      mime: 'image/png',
      label: '',
      status: 'transcribed' as const,
    });
    body += `【来源图片 ${index + 1}】\n【图片 OCR 转录（需核对）】\n旧脏转录 ${index + 1}\n【转录结束】\n`;
  }
  return store.create({
    title: '历史样本',
    sourceType: 'article',
    sourceName: 'fixture',
    tags: [],
    body: body + '末尾正文。',
    webImages,
  });
}
async function snapshot(root: string) {
  const files: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files[path.relative(root, file).replaceAll('\\', '/')] = hash(await readFile(file));
    }
  }
  await walk(root);
  return files;
}
async function edit(store: RawStore, raw: RawRecord, body: string) {
  return (await store.updateBody(
    raw.id,
    { body, expectedBodySha256: raw.bodySha256, expectedBodyRevision: raw.bodyRevision ?? 0 },
    async () => {},
  ))!;
}
async function cli(root: string, args: string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('FMCG_LLM_')) delete env[key];
  env.FMCG_DATA_DIR = root;
  env.FMCG_LLM_CONFIG_FILE = path.join(root, 'absent-config.json');
  env.FMCG_TESSERACT_PATH = path.join(root, 'absent-tesseract');
  return promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate-raw-media.ts', '--data-dir', root, ...args],
    { env },
  );
}

test('RAWOCR04 preview CLI has no writes or OCR and requires an explicit selection', async (t) => {
  const { root, store } = await setup(t);
  const raw = await legacy(store);
  const before = await snapshot(root);
  const result = JSON.parse((await cli(root, ['--raw-id', raw.id])).stdout);
  assert.equal(result.mode, 'preview');
  assert.equal(result.summary.planned, 1);
  assert.deepEqual(await snapshot(root), before);
  await assert.rejects(cli(root, []), (error: unknown) => (error as { code: number }).code === 2);
  await assert.rejects(
    cli(root, ['--all', '--raw-id', raw.id]),
    (error: unknown) => (error as { code: number }).code === 2,
  );
  assert.equal(JSON.parse((await cli(root, ['--all'])).stdout).summary.planned, 1);
  await assert.rejects(
    cli(path.join(root, 'missing'), ['--all']),
    (error: unknown) => (error as { code: number }).code === 1,
  );
  const empty = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await new RawStore(empty).initialize();
  const emptyBefore = await snapshot(empty);
  assert.equal(JSON.parse((await cli(empty, ['--all'])).stdout).items.length, 0);
  assert.deepEqual(await snapshot(empty), emptyBefore);
  const broken = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-broken-'));
  t.after(() => rm(broken, { recursive: true, force: true }));
  await mkdir(path.join(broken, 'knowledge', 'raw'), { recursive: true });
  await writeFile(path.join(broken, 'knowledge', 'raw', 'articles'), 'directory replaced by file');
  const brokenBefore = await snapshot(broken);
  await assert.rejects(cli(broken, ['--all']), (error: unknown) => {
    const failed = error as { code: number; stdout: string };
    assert.equal(failed.code, 1);
    assert.equal(JSON.parse(failed.stdout).error, 'raw_scan_failed');
    return true;
  });
  assert.deepEqual(await snapshot(broken), brokenBefore);
});

test('RAWOCR04 local migration triages normal, gibberish, decorative and repeated occurrences without rewriting sources', async (t) => {
  const { root, store } = await setup(t);
  const text = png(),
    rank = png(700, 500),
    logo = png(60, 40);
  const raw = await legacy(store, [text, rank, logo, text]);
  const outside = await legacy(store);
  const before = await snapshot(root);
  let count = 0;
  const result = await migrateRawMedia(store, {
    rawIds: [raw.id],
    apply: true,
    ocr: async (bytes) => {
      count++;
      return bytes.equals(rank) ? [{ text: 'BRTKPLMZ   2026   80%' }, { text: 'ZXCVBNMK   2025   90%' }] : await ocr();
    },
  });
  assert.equal(result.complete, true);
  assert.equal(count, 4);
  const artifacts = await store.getMediaArtifacts(raw.id);
  assert.deepEqual(
    artifacts.map(({ routeStatus }) => routeStatus),
    ['ocr_ready', 'needs_vlm', 'skipped', 'ocr_ready'],
  );
  assert.equal(new Set(artifacts.map(({ mediaId }) => mediaId)).size, 4);
  assert.equal(artifacts[0].width, 800);
  assert.equal(artifacts[0].ocrRawText, prose);
  assert.deepEqual(await store.getMediaArtifacts(outside.id), []);
  const after = await snapshot(root);
  for (const [file, digest] of Object.entries(before)) assert.equal(after[file], digest, file);
  const repeated = await migrateRawMedia(store, {
    rawIds: [raw.id],
    apply: true,
    ocr: async () => {
      throw new Error('must skip');
    },
  });
  assert.equal(repeated.summary.existing, 4);
  assert.deepEqual(await snapshot(root), after);
});

test('RAWOCR04 keeps all five existing states and timestamps even when positions have been removed', async (t) => {
  const { root, store } = await setup(t);
  let raw = await legacy(
    store,
    Array.from({ length: 5 }, () => png()),
  );
  const base = evaluateImageOcr({ width: 800, height: 400, lines: await ocr() });
  const statuses = ['skipped', 'ocr_ready', 'needs_vlm', 'vlm_done', 'failed'] as const;
  for (const image of identifyWebImages(raw.id, raw.webImages))
    await store.saveMediaArtifact(raw.id, image.mediaId, {
      ...base,
      routeStatus: statuses[image.imageIndex - 1],
      vlmMarkdown: '用户精读成果',
    });
  raw = await edit(store, raw, raw.body.replace('【来源图片 1】', ''));
  const before = await snapshot(root);
  const result = await migrateRawMedia(store, {
    rawIds: [raw.id],
    apply: true,
    ocr: async () => {
      throw new Error('must skip');
    },
  });
  assert.equal(result.summary.existing, 5);
  assert.equal(result.items[0].reason, 'no_current_anchor');
  assert.deepEqual(await snapshot(root), before);
  const image = identifyWebImages(raw.id, raw.webImages)[3];
  await store.saveMediaArtifact(raw.id, image.mediaId, base, { onlyIfMissing: true });
  assert.deepEqual(await snapshot(root), before);
});

test('RAWOCR04 current unique visible markers authorize edited Raw migration, including nonzero news acquisition revision', async (t) => {
  const { root, store } = await setup(t);
  const raw = await legacy(store);
  for (const replacement of [
    '',
    '【来源图片 1】\n【来源图片 1 · 重复】',
    '```text\n【来源图片 1】\n```',
    '`【来源图片 1】`',
  ]) {
    const candidate = await legacy(store);
    const revised = await edit(
      store,
      candidate,
      candidate.body.replace('【来源图片 1】', replacement).replace('旧脏转录 1', '改写过的脏字'),
    );
    const result = await migrateRawMedia(store, { rawIds: [revised.id], apply: true, ocr });
    assert.equal(result.summary.no_current_anchor, 1, replacement);
    assert.equal((await store.getMediaArtifacts(revised.id)).length, 0);
  }
  const revised = await edit(store, raw, '人工引言。\n' + raw.body.replace('旧脏转录 1', '不能猜配的编辑转录'));
  assert.equal((await migrateRawMedia(store, { rawIds: [revised.id], apply: true, ocr })).summary.migrated, 1);
  const seed = await store.create({
    title: '摘要',
    sourceType: 'article',
    sourceName: 'fixture',
    tags: [],
    body: '早期摘要',
  });
  const news = (await store.updateBody(
    seed.id,
    { body: raw.body, expectedBodySha256: seed.bodySha256, expectedBodyRevision: 0 },
    async () => {},
    {
      title: seed.title,
      sourceType: seed.sourceType,
      sourceName: seed.sourceName,
      tags: [],
      body: raw.body,
      webImages: raw.webImages,
      newsMaterial: { kind: 'article', revision: 1 },
    },
  ))!;
  const current = await edit(store, news, '人工引言\n' + news.body);
  const before = await snapshot(root);
  assert.equal((await migrateRawMedia(store, { rawIds: [current.id], apply: true, ocr })).summary.migrated, 1);
  const after = await snapshot(root);
  for (const [file, digest] of Object.entries(before)) assert.equal(after[file], digest, file);
  assert.equal((await store.mediaSource(current)).removed.length, 1);
});

test('RAWOCR04 per-image missing, hash, OCR and storage failures remain retryable while successful images continue', async (t) => {
  const { root, store } = await setup(t);
  const raw = await legacy(store, [png(), png(600, 300), png(500, 300), png(400, 300)]);
  const images = identifyWebImages(raw.id, raw.webImages);
  await rm(path.join(root, webImageRelativePath(images[0].sha256)!));
  await writeFile(path.join(root, webImageRelativePath(images[1].sha256)!), 'wrong bytes');
  let calls = 0;
  let result = await migrateRawMedia(store, {
    rawIds: [raw.id],
    apply: true,
    ocr: async () => {
      if (++calls === 1) throw new Error('unavailable');
      return ocr();
    },
  });
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.items.map(({ status, reason }) => [status, reason]),
    [
      ['error', 'original_image_missing'],
      ['error', 'original_image_hash_mismatch'],
      ['error', 'local_ocr_unavailable'],
      ['migrated', undefined],
    ],
  );
  assert.equal((await store.getMediaArtifacts(raw.id)).length, 1);
  const save = store.saveMediaArtifact.bind(store);
  store.saveMediaArtifact = async (id, mediaId, artifact, options) => {
    if (mediaId === images[2].mediaId) throw new Error('disk full');
    return save(id, mediaId, artifact, options);
  };
  result = await migrateRawMedia(store, { rawIds: [raw.id], apply: true, ocr });
  assert.equal(result.items[2].reason, 'artifact_storage_failed');
  assert.equal(result.summary.existing, 1);
  store.saveMediaArtifact = save;
  result = await migrateRawMedia(store, { rawIds: [raw.id], apply: true, ocr });
  assert.equal(result.items[2].status, 'migrated');
  assert.equal(result.summary.existing, 1);
  await assert.rejects(cli(root, ['--raw-id', raw.id, '--apply']), (error: unknown) => {
    const failed = error as { code: number; stdout: string };
    assert.equal(failed.code, 1);
    assert.equal(JSON.parse(failed.stdout).complete, false);
    return true;
  });
});

test('RAWOCR04 no-image Raw and newly imported derivatives skip naturally', async (t) => {
  const { root, store } = await setup(t);
  const empty = await store.create({ title: '普通正文', sourceType: 'note', sourceName: '', tags: [], body: '正文' });
  const imported = await legacy(store);
  const base = evaluateImageOcr({ width: 800, height: 400, lines: await ocr() });
  await store.saveImportedMedia(imported, [base]);
  const before = await snapshot(root);
  const result = JSON.parse((await cli(root, ['--all', '--apply'])).stdout);
  assert.equal(result.summary.no_images, 1);
  assert.equal(result.summary.existing, 1);
  assert.equal(result.summary.migrated, 0);
  assert.ok(result.items.some(({ rawId }: { rawId: string }) => rawId === empty.id));
  assert.deepEqual(await snapshot(root), before);
});
