import { newsRawFixture } from './support/news-raw-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { NewsService, normalizedUrl } from '../services/news/service.ts';
import { matchesNewsFocus, newsPriority } from '../services/news/sources.ts';
import { RawStore } from '../services/raw/store.ts';
import { registerNewsRoutes } from '../server/news-api.ts';
import type { NewsItem } from '../services/news/types.ts';
const now = new Date('2026-11-08T04:00:00Z');
const item: NewsItem = {
  id: 'one',
  title: 'ChatGPT 表格分析更新',
  sourceId: 'aihot',
  sourceName: 'AIHOT',
  url: 'https://example.com/a?utm_source=x&id=1',
  publishedAt: null,
  fetchedAt: now.toISOString(),
  excerpt: '来源原样摘要\n第二行',
  evidenceKind: 'source_summary',
  analysis: { fact: 'AI fact', whyItMatters: 'reason', possibleImpact: 'impact' },
};
async function setup(fmcgItems: NewsItem[] = []) {
  const dir = path.join(process.cwd(), 'node_modules/.cache/news02-check');
  await mkdir(dir, { recursive: true });
  const root = await mkdtemp(path.join(dir, 'case-'));
  const raws = new RawStore(root);
  await raws.initialize();
  await mkdir(path.join(root, 'state/news'), { recursive: true });
  const section = { status: 'ready', attempt: 1, startedAt: now.toISOString(), sources: [] };
  const edition = {
    schemaVersion: 1,
    date: '2026-11-07',
    updatedAt: now.toISOString(),
    sections: {
      ai: { ...section, items: [item] },
      fmcg: { ...section, contentVersion: 'research-v1', items: fmcgItems },
    },
  };
  await writeFile(path.join(root, 'state/news/2026-11-07.json'), JSON.stringify(edition));
  let external = 0;
  const make = () =>
    new NewsService({
      root,
      rawStore: raws,
      rawSave: {
        acquire: async (item, keepPartial) => {
          const source = await newsRawFixture.acquire!(item, keepPartial);
          return { ...source, body: source.body + '\n合成网页后续正文' };
        },
      },
      clock: () => now,
      aiEnabled: false,
      readSources: async () => {
        external++;
        throw Error('unexpected');
      },
      providerFactory: async () => {
        external++;
        return undefined;
      },
    });
  return { root, raws, make, external: () => external };
}
test('筛选正反例及规范链接', () => {
  for (const t of ['可口可乐战略', '咖啡市场发展', '批零发展', '连锁便利店新品'])
    assert.equal(matchesNewsFocus('fmcg', t, ''), true, t);
  for (const t of ['汽车品牌发布新品', '手机品牌新品', '农业收储', '一般公司财报'])
    assert.equal(matchesNewsFocus('fmcg', t, ''), false, t);
  for (const t of ['GPT Image 评测', 'Cursor 语音智能体', 'ChatGPT 表格分析'])
    assert.equal(matchesNewsFocus('ai', t, ''), true, t);
  for (const t of ['AI 公司融资估值', '大模型公司发布融资消息', '芯片贸易', '普通业务 API 上线'])
    assert.equal(matchesNewsFocus('ai', t, ''), false, t);
  assert.equal(matchesNewsFocus('ai', 'AI 公司融资并推出智能体新功能', ''), true);
  assert.equal(normalizedUrl('https://x.test/a?utm_source=z&id=1&gclid=q#x'), 'https://x.test/a?id=1');
  assert.notEqual(normalizedUrl('https://x.test/a?id=1'), normalizedUrl('https://x.test/a?id=2'));
});
test('HTTP 原样保存、并发重启幂等、删除状态及门禁', async () => {
  const { root, raws, make, external } = await setup();
  const s = make(),
    app = express();
  app.use(express.json());
  registerNewsRoutes(app, s);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw Error('port');
    const base = `http://127.0.0.1:${addr.port}`,
      url = base + '/api/news/editions/2026-11-07/items/save-raw',
      headers = { 'content-type': 'application/json' },
      body = JSON.stringify({ section: 'ai', itemId: 'one' });
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'null' }, body })).status, 403);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ section: 'ai', itemId: 'one', body: 'fake' }),
        })
      ).status,
      400,
    );
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(url, { method: 'POST', headers, body })));
    const results = await Promise.all(responses.map((r) => r.json()));
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(new Set(results.map((x) => x.rawId)).size, 1);
    assert.equal(results.filter((x) => x.created).length, 1);
    const raw = (await raws.get(results[0].rawId))!;
    assert.equal(raw.body, item.excerpt + '\n合成网页后续正文');
    assert.equal(raw.sourceName, 'AIHOT');
    assert.equal(raw.publishedAt, undefined);
    assert.match(raw.extractionNote!, /来源网页正文/);
    assert.equal(raw.status, 'unprocessed');
    assert.equal((await make().saveRaw('2026-11-07', 'ai', 'one')).rawId, raw.id);
    assert.equal((await raws.list()).length, 1);
    await raws.delete(raw.id);
    assert.equal((await make().savedRaws('2026-11-07')).items[0].status, 'missing');
    const imported = await make().saveRaw('2026-11-07', 'ai', 'one');
    assert.equal(imported.created, true);
    assert.notEqual(imported.rawId, raw.id);
    assert.equal((await make().saveRaw('2026-11-07', 'ai', 'one')).rawId, imported.rawId);
    assert.equal(external(), 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test('pending 新收据按原标识恢复，损坏收据保留', async () => {
  const { root, raws, make } = await setup();
  try {
    const saved = await make().saveRaw('2026-11-07', 'ai', 'one');
    const dir = path.join(root, 'state/news-saves');
    const { readdir } = await import('node:fs/promises');
    const file = path.join(dir, (await readdir(dir))[0]);
    const receipt = JSON.parse(await readFile(file, 'utf8'));
    receipt.status = 'pending';
    await writeFile(file, JSON.stringify(receipt));
    await raws.delete(saved.rawId);
    assert.equal((await make().saveRaw('2026-11-07', 'ai', 'one')).rawId, saved.rawId);
    assert.equal((await raws.list()).length, 1);
    await writeFile(file, 'broken');
    await assert.rejects(make().saveRaw('2026-11-07', 'ai', 'one'), /收据损坏/);
    assert.equal(await readFile(file, 'utf8'), 'broken');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('已编辑的 Raw 保留关联，单条损坏隔离，同期其他资讯仍可保存或查看', async () => {
  const date = '2026-11-07';
  const report: NewsItem = { ...item, id: 'report', title: '饮料市场报告', url: 'https://example.com/report' };
  const { root, raws, make, external } = await setup([report]);
  try {
    const { rawId } = await make().saveRaw(date, 'fmcg', report.id);
    const original = (await raws.get(rawId))!;
    const body = '用户校正后的正文';
    await raws.updateBody(
      rawId,
      { body, expectedBodySha256: original.bodySha256, expectedBodyRevision: 0 },
      async () => {},
    );
    const rawFile = path.join(root, 'knowledge/raw/articles', `${rawId}.md`);
    const editedRaw = await readFile(rawFile, 'utf8');
    const receiptFile = path.join(
      root,
      'state/news-saves',
      createHash('sha256').update(normalizedUrl(report.url)).digest('hex') + '.json',
    );
    const linkedReceipt = await readFile(receiptFile, 'utf8');
    assert.deepEqual((await make().savedRaws(date)).items, [
      {
        section: 'fmcg',
        itemId: report.id,
        rawId,
        status: 'saved',
        material: { kind: 'article', issue: undefined, canSupplement: false },
      },
    ]);
    assert.deepEqual(await make().saveRaw(date, 'fmcg', report.id), {
      rawId,
      status: 'saved',
      created: false,
      material: { kind: 'article', issue: undefined, canSupplement: false },
    });
    assert.equal(await readFile(rawFile, 'utf8'), editedRaw);
    assert.equal(await readFile(receiptFile, 'utf8'), linkedReceipt);
    assert.equal((await raws.bodyHistory(rawId, 0))?.body, original.body);

    await writeFile(rawFile, `${editedRaw}\n未经校验的内容`);
    await assert.rejects(make().saveRaw(date, 'fmcg', report.id), /完整性校验失败/);
    const ai = await make().saveRaw(date, 'ai', item.id);
    const [damaged, unaffected] = (await make().savedRaws(date)).items;
    assert.equal(damaged.status, 'error');
    assert.match(damaged.message, /完整性校验失败/);
    assert.deepEqual(unaffected, {
      section: 'ai',
      itemId: item.id,
      rawId: ai.rawId,
      status: 'saved',
      material: ai.material,
    });
    await writeFile(rawFile, editedRaw);

    const badReceipt = 'broken';
    await writeFile(receiptFile, badReceipt);
    const projection = await make().savedRaws(date);
    const [damagedReceipt] = projection.items;
    assert.equal(damagedReceipt.status, 'error');
    assert.match(damagedReceipt.message, /收据损坏/);
    assert.deepEqual(projection.items[1], unaffected);
    assert.equal(await readFile(receiptFile, 'utf8'), badReceipt);

    const pendingReceipt = JSON.stringify({ ...JSON.parse(linkedReceipt), status: 'pending' });
    await writeFile(receiptFile, pendingReceipt);
    await assert.rejects(make().saveRaw(date, 'fmcg', report.id), /完整性校验失败/);
    assert.equal((await make().savedRaws(date)).items[0].status, 'error');
    assert.equal(await readFile(receiptFile, 'utf8'), pendingReceipt);
    assert.equal(await readFile(rawFile, 'utf8'), editedRaw);
    assert.equal(external(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('相同规范链接按来源、条目、原URL、标题、摘录稳定择一', async () => {
  const dir = path.join(process.cwd(), 'node_modules/.cache/news02-check');
  await mkdir(dir, { recursive: true });
  const root = await mkdtemp(path.join(dir, 'sort-'));
  try {
    const candidates: NewsItem[] = [
      {
        ...item,
        id: 'a',
        title: '饮料市场 A',
        excerpt: '饮料销量同比增长 6%。',
        evidenceKind: 'article_excerpt',
        sourceId: 'z',
        url: 'https://example.com/a?utm_source=z',
        publishedAt: '2026-11-08T03:00:00Z',
      },
      {
        ...item,
        id: 'z',
        title: '饮料市场 Z',
        excerpt: '饮料销量同比增长 6%。',
        evidenceKind: 'article_excerpt',
        sourceId: 'a',
        url: 'https://example.com/a?utm_source=a',
        publishedAt: '2026-11-08T03:00:00Z',
      },
    ];
    for (const [index, list] of [candidates, [...candidates].reverse()].entries()) {
      const s = new NewsService({
        root: path.join(root, String(index)),
        clock: () => now,
        aiEnabled: false,
        readSources: async (section) => ({
          items: section === 'fmcg' ? list : [],
          sources: [{ name: 'test', checkedAt: now.toISOString(), status: 'ok' }],
        }),
        providerFactory: async () => undefined,
      });
      await s.ensure();
      let selected: NewsItem[] = [];
      for (let i = 0; i < 100; i++) {
        const v = await s.today(),
          part = v.edition?.sections.fmcg;
        if (part?.status === 'source_only') {
          selected = part.items;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(selected.length, 1);
      assert.equal(selected[0].sourceId, 'a');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('快消新增和更新的明确经营变化优先', () => {
  const ordinary = { ...item, title: '零售参考条目', excerpt: '' };
  for (const title of ['超市新增饮料补货规则', '超市更新饮料补货规则'])
    assert.ok(newsPriority('fmcg', { ...ordinary, title }) > newsPriority('fmcg', ordinary));
});
