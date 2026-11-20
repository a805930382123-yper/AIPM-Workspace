import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { registerNewsRoutes } from '../server/news-api.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { NewsService } from '../services/news/service.ts';
import type { NewsEdition, NewsItem, NewsSection, NewsTranslationResult } from '../services/news/types.ts';
import { RawStore } from '../services/raw/store.ts';

const today = '2026-11-20';
const yesterday = '2026-11-19';
const now = new Date('2026-11-20T08:00:00Z');
const aiItem = (id: string, sourceId = 'openai-cookbook'): NewsItem => ({
  id, title: `Building prompts ${id}`, excerpt: `How to use the new prompts ${id}.`,
  sourceId, sourceName: sourceId, url: `https://example.test/${id}`,
  fetchedAt: now.toISOString(), publishedAt: null, evidenceKind: 'article_excerpt',
  analysis: { fact: 'Internal annotation', whyItMatters: 'Internal reasoning', possibleImpact: 'Internal estimate' },
});
const section = (items: NewsItem[], sourceItems: NewsItem[] = []): NewsSection => ({
  status: 'source_only', attempt: 1, startedAt: now.toISOString(), items, sourceItems, sources: [],
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'news16-'));
  const rawStore = new RawStore(root);
  await rawStore.initialize();
  const news = path.join(root, 'state', 'news');
  await mkdir(news, { recursive: true });
  return {
    root, rawStore,
    async edition(date: string, sections: NewsEdition['sections']) {
      const file = path.join(news, `${date}.json`);
      await writeFile(file, JSON.stringify({ schemaVersion: 1, date, updatedAt: now.toISOString(), sections }));
      return file;
    },
    make(providerFactory: () => Promise<LlmProvider | undefined>) {
      return new NewsService({ root, rawStore, clock: () => now, aiEnabled: false, providerFactory,
        readSources: async () => { throw new Error('Translation must use persisted editions'); } });
    },
  };
}

function provider(translate: (request: LlmCompletionRequest) => unknown): LlmProvider {
  return {
    name: 'test', model: 'test', secrets: ['secret-test-key'],
    async complete(request) {
      const text = JSON.stringify(await translate(request));
      return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
    },
  };
}

type BatchItem = { id: number; title: string; excerpt: string };
const input = (request: LlmCompletionRequest): BatchItem[] => JSON.parse(request.user).items;
const zh = (item: BatchItem) => ({ id: item.id, title: `提示词标题 ${item.title.split(' ').at(-1)}`, excerpt: '介绍如何使用新提示词。' });

test('读取回退期刊的八源条目，批量和并发去重，按内容缓存，保存 Raw 仍使用原文', async () => {
  const { root, rawStore, edition, make } = await setup();
  try {
    const item = aiItem('one');
    const items = [item, ...Array.from({ length: 5 }, (_, i) => aiItem(String(i), 'karpathy-youtube'))];
    const repeated = { ...item, id: 'repeated', url: 'https://example.test/repeated' };
    const aihot = aiItem('aihot', 'aihot');
    const otherSectionItem = aiItem('fmcg', 'karpathy-youtube');
    const file = await edition(yesterday, { ai: section([item, aihot], [...items.slice(1), repeated]), fmcg: section([otherSectionItem]) });
    const saved = await readFile(file, 'utf8');
    await edition(today, { ai: { ...section([]), status: 'failed' } });

    let factoryCalls = 0;
    const batchSizes: number[] = [];
    let started!: () => void;
    let finish!: () => void;
    const startedModel = new Promise<void>(resolve => { started = resolve; });
    const finishModel = new Promise<void>(resolve => { finish = resolve; });
    const model = provider(async request => {
      const batch = input(request);
      batchSizes.push(batch.length);
      assert.ok(batch.every(entry => Object.keys(entry).sort().join(',') === 'excerpt,id,title'));
      started();
      await finishModel;
      return { items: batch.map(zh) };
    });
    const service = make(async () => { factoryCalls++; return model; });
    assert.equal((await service.today()).fallbacks.ai?.date, yesterday);
    const ids = items.map(x => x.id);
    const initial = service.translate(yesterday, [...ids, 'one', 'repeated', 'aihot', 'fmcg', 'missing']);
    await startedModel;
    const concurrent = service.translate(yesterday, ['one', '0']);
    finish();
    const [result, overlapping] = await Promise.all([initial, concurrent]);
    assert.deepEqual(batchSizes.sort(), [1, 5]);
    assert.equal(factoryCalls, 1);
    assert.deepEqual(result.items.map(x => x.itemId), [...ids, 'repeated']);
    assert.deepEqual(result.failedIds, ['aihot', 'fmcg', 'missing']);
    assert.deepEqual(overlapping.items, result.items.slice(0, 2));
    assert.equal(result.items.at(-1)?.title, result.items[0].title);
    assert.equal((await service.translate(today, ['one'])).failedIds[0], 'one');

    const dir = path.join(root, 'state', 'news-translations');
    const digest = createHash('sha256').update(JSON.stringify([item.title, item.excerpt])).digest('hex');
    assert.equal((await readdir(dir)).length, 6);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, `${digest}.json`), 'utf8')), {
      title: '提示词标题 one', excerpt: '介绍如何使用新提示词。',
    });
    const restarted = make(async () => { factoryCalls++; return undefined; });
    assert.deepEqual(await restarted.translate(yesterday, [...ids, 'repeated']), { items: result.items, failedIds: [] });
    assert.equal(factoryCalls, 1);
    const { rawId } = await restarted.saveRaw(yesterday, 'ai', item.id);
    assert.equal((await rawStore.get(rawId))?.body, item.excerpt);
    assert.equal((await rawStore.get(rawId))?.title, item.title);
    assert.equal(await readFile(file, 'utf8'), saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP 仅允许 ID，部分失败保留成功译文并可重试，原文变化重新翻译', async () => {
  const { root, edition, make } = await setup();
  const first = { ...aiItem('first', 'anthropic-engineering'), excerpt: '原有中文摘录。' };
  const second = { ...aiItem('second', 'huggingface-blog'), title: '中文标题' };
  const third = aiItem('third', 'karpathy-github');
  const fourth = aiItem('fourth', 'simon-prompt-engineering');
  await edition(today, { ai: section([first], [second, third, fourth]) });
  const batches: string[][] = [];
  const model = provider(request => {
    const batch = input(request);
    batches.push(batch.map(x => x.excerpt));
    if (batches.length === 1) return { items: [zh(batch[0]), { ...zh(batch[1]), excerpt: 'secret-test-key 泄露' },
      { ...batch[2] }, { id: 99, title: '未知标题', excerpt: '未知摘要' }] };
    return { items: batch.map(zh) };
  });
  const service = make(async () => model);
  const app = express();
  app.use(express.json());
  registerNewsRoutes(app, service);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const url = `http://127.0.0.1:${addr.port}/api/news/editions/${today}/translations`;
    const post = (body: object, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ itemIds: ['first'] }, { origin: 'null' })).status, 403);
    assert.equal((await post({ itemIds: ['first'], excerpt: 'injected' })).status, 400);
    assert.equal((await post({ itemIds: [24] })).status, 400);
    assert.deepEqual(batches, []);

    const itemIds = ['first', 'second', 'third', 'fourth'];
    const response = await post({ itemIds });
    assert.equal(response.status, 200);
    const partial: NewsTranslationResult = await response.json();
    assert.deepEqual(partial, {
      items: [{ itemId: 'first', title: '提示词标题 first', excerpt: first.excerpt }],
      failedIds: ['second', 'third', 'fourth'],
    });
    const completed: NewsTranslationResult = await (await post({ itemIds })).json();
    assert.deepEqual(completed.failedIds, []);
    assert.equal(completed.items[1].title, second.title);
    assert.deepEqual(batches[1], [second.excerpt, third.excerpt, fourth.excerpt]);

    const changed = { ...first, excerpt: 'An updated English excerpt.' };
    await edition(today, { ai: section([changed, second, third, fourth]) });
    const refreshed: NewsTranslationResult = await (await post({ itemIds })).json();
    assert.equal(refreshed.items[0].excerpt, '介绍如何使用新提示词。');
    assert.deepEqual(batches[2], [changed.excerpt]);
    const offline = make(async () => { throw new Error('provider settings unavailable'); });
    await edition(today, { ai: section([changed, aiItem('later', 'karpathy-x')]) });
    assert.deepEqual(await offline.translate(today, ['later', 'first']), { items: refreshed.items.slice(0, 1), failedIds: ['later'] });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
