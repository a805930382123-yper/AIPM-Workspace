import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RawStore, type RawInput } from '../services/raw/store.ts';
import { getStats } from '../services/stats/index.ts';
import { InputError, validateRaw } from '../server/validation.ts';

async function temporaryStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-data-'));
  const store = new RawStore(root);
  await store.initialize();
  return { root, store, clean: () => rm(root, { recursive: true, force: true }) };
}

test('Raw 文本逐字符持久化，正文包含分隔线、中文和首尾空白', async () => {
  const { root, store, clean } = await temporaryStore();
  try {
    const body = ' \n  快消资料第一行\n---\n第二段包含中文：动销\n\n  ';
    // M04: legacy ordinary create is bypassed deliberately to preserve a no-origin Meeting Raw fixture.
    const input: RawInput = { title: '  渠道访谈  ', sourceType: 'meeting', sourceName: '访谈记录', tags: ['渠道'], body };
    const created = await store.create(input);
    const diskFile = path.join(root, 'knowledge', 'raw', 'meetings', `${created.id}.md`);
    const firstBytes = await readFile(diskFile);
    const loaded = await store.get(created.id);
    assert.equal(loaded?.body, body);
    assert.equal(loaded?.title, '  渠道访谈  ');
    assert.equal(loaded?.bodySha256, created.bodySha256);
    assert.equal((await store.list()).length, 1);
    assert.deepEqual(await readdir(path.dirname(diskFile)), [`${created.id}.md`]);
    assert.deepEqual(await readFile(diskFile), firstBytes);
  } finally { await clean(); }
});

test('无效导入不会创建文件，标题不会影响文件路径', async () => {
  const { store, clean } = await temporaryStore();
  try {
    assert.throws(() => validateRaw({ title: '', sourceType: 'other', sourceName: '访谈', body: '正文' }), InputError);
    assert.throws(() => validateRaw({ title: '标题', sourceType: 'invalid', sourceName: '访谈', body: '正文' }), InputError);
    assert.throws(() => validateRaw({ title: '标题', sourceType: 'other', sourceName: '访谈', body: '正文', url: 'javascript:alert(1)' }), InputError);
    const valid = validateRaw({ title: '../../outside', sourceType: 'note', sourceName: '笔记', body: '内容' });
    const record = await store.create(valid);
    assert.match(record.id, /^[0-9a-f-]{36}$/i);
    assert.equal((await store.list()).length, 1);
    assert.equal(await store.get('../../outside'), undefined);
  } finally { await clean(); }
});

test('首页六项统计从空目录返回零，Raw 导入后即时计数', async () => {
  const { root, store, clean } = await temporaryStore();
  try {
    const empty = await getStats(root, store);
    assert.deepEqual([empty.rawCount, empty.wikiCount, empty.thisWeekNewCount, empty.pendingConfirmationCount, empty.openAuditCount, empty.promptCount], [0, 0, 0, 0, 0, 0]);
    await store.create(validateRaw({ title: '真实资料', sourceType: 'article', sourceName: '来源', body: '原文' }));
    const after = await getStats(root, store);
    assert.equal(after.rawCount, 1);
    assert.equal(after.thisWeekNewCount, 1);
  } finally { await clean(); }
});

test('本周新增只包含上海时间周一零点到下周周一零点', async () => {
  const { root, store, clean } = await temporaryStore();
  try {
    const dates = ['2026-10-04T15:59:59.000Z', '2026-10-04T16:00:00.000Z', '2026-10-11T15:59:59.000Z', '2026-10-11T16:00:00.000Z'];
    for (const [index, importedAt] of dates.entries()) {
      const item = await store.create(validateRaw({ title: `资料${index}`, sourceType: 'note', sourceName: '测试', body: '正文' }));
      const file = path.join(root, 'knowledge', 'raw', 'notes', `${item.id}.md`);
      const markdown = (await readFile(file, 'utf8')).replace(/^importedAt:.*$/m, `importedAt: '${importedAt}'`);
      await writeFile(file, markdown, 'utf8');
    }
    const totals = await getStats(root, store, new Date('2026-10-07T12:00:00.000Z'));
    assert.equal(totals.thisWeekNewCount, 2);
  } finally { await clean(); }
});

test('Wiki统计只计页面，不把index.md计作知识条目', async () => {
  const { root, store, clean } = await temporaryStore();
  try {
    const wikiDir = path.join(root, 'knowledge', 'wiki');
    await mkdir(wikiDir, { recursive: true });
    await writeFile(path.join(wikiDir, 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(path.join(wikiDir, 'sku.md'), '---\ncreatedAt: 2026-10-06T12:00:00.000Z\n---\n# SKU\n', 'utf8');
    const totals = await getStats(root, store, new Date('2026-10-07T12:00:00.000Z'));
    assert.equal(totals.wikiCount, 1);
    assert.equal(totals.thisWeekNewCount, 1);
  } finally { await clean(); }
});

test('十万字符正文允许保存，超过上限会返回明确错误', async () => {
  const input = { title: '长文', sourceType: 'report', sourceName: '报告', body: '快'.repeat(100_000) };
  assert.equal(validateRaw(input).body.length, 100_000);
  assert.throws(() => validateRaw({ ...input, body: '快'.repeat(500_001) }), (error: unknown) => error instanceof InputError && error.code === 'BODY_TOO_LARGE' && error.status === 413);
});
