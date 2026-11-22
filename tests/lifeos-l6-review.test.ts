import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { periodReview, validReviewDate } from '../services/home/review.ts';
import { homeActions } from '../services/home/actions.ts';
test('上海半开边界、旧日期、反馈使用日期与当前待办同源', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'l6-test-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const states = new RawStateStore(root);
    await states.initialize();
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const prompts = new PromptStore(root, wiki);
    await prompts.initialize();
    const raw = await raws.create({
      title: '待处理',
      sourceType: 'report',
      sourceName: '虚构',
      tags: [],
      body: '正文',
    });
    await states.set(raw.id, { status: 'failed', reason: 'test' });
    const runner = { recoveryJobs: () => [], readJob: async () => ({}) } as any;
    const base = {
      type: 'concept' as const,
      category: 'industry_basics',
      sources: [],
      tags: [],
      aliases: [],
      knowledge_status: 'needs_verification' as const,
      confidence: 'low' as const,
      source_level: 'D' as const,
      review_status: 'unreviewed' as const,
      body: '虚构正文',
    };
    const values = [
      '2026-10-25T15:59:59.999Z',
      '2026-10-25T16:00:00.000Z',
      '2026-11-01T15:59:59.999Z',
      '2026-11-01T16:00:00.000Z',
      '2026-10-30',
      undefined,
      '2026-10-30T10:00:00',
    ];
    const pages = [];
    for (const [i, created] of values.entries()) {
      const p = await wiki.create({ ...base, title: '知识' + i });
      await wiki.writePageLocked({ ...p, created } as any);
      pages.push(p);
    }
    const input = {
      name: '虚构Prompt',
      category: 'customer',
      scenario: '场景',
      body: '正文',
      inputRequirements: '输入',
      outputRequirements: '输出',
      relatedWikiIds: [],
      examples: '',
      tags: [],
      favorite: false,
    };
    const p = (await prompts.create(randomUUID(), input)).prompt;
    await prompts.update(p.id, 1, { ...input, body: '版本二' });
    for (const [i, usedOn] of ['2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'].entries())
      await prompts.createFeedback(p.id, {
        id: randomUUID(),
        promptVersion: i === 1 ? 1 : 2,
        usedOn,
        scenario: '虚构',
        outcome: 'helpful',
        observation: '观察',
        nextImprovement: '建议',
      });
    const deps = { root, raws, wiki, prompts, runner };
    const result = await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.equal(result.knowledge.status, 'ok');
    if (result.knowledge.status === 'ok') {
      assert.deepEqual(
        new Set(result.knowledge.items.map((x) => x.id)),
        new Set([pages[1].id, pages[2].id, pages[4].id]),
      );
      assert.equal(result.knowledge.undated.length, 2);
      assert.equal(result.knowledge.count, 3);
    }
    assert.equal(result.feedback.status, 'ok');
    if (result.feedback.status === 'ok') {
      assert.deepEqual(
        result.feedback.items.map((x) => x.usedOn),
        ['2026-11-01', '2026-10-26'],
      );
      assert.equal(result.feedback.counts.helpful, 2);
      assert.ok(result.feedback.items.some((x) => x.promptVersion === 1));
    }
    assert.deepEqual(result.pending, await homeActions(deps));
    assert.equal(validReviewDate('2026-02-29'), false);
    assert.equal(validReviewDate('2026-10-26'), true);
    const before = await readFile(path.join(root, 'prompts', p.id + '.json'));
    await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.deepEqual(await readFile(path.join(root, 'prompts', p.id + '.json')), before);
    await rename(path.join(root, 'knowledge', 'wiki'), path.join(root, 'knowledge', 'wiki-hidden'));
    await writeFile(path.join(root, 'knowledge', 'wiki'), 'x');
    const broken = await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.equal(broken.knowledge.status, 'error');
    assert.equal(broken.feedback.status, 'ok');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('非法或倒置日期在读取来源前返回 400', async () => {
  const express = (await import('express')).default;
  const { registerHomeRoutes } = await import('../server/home-api.ts');
  const app = express();
  let reads = 0;
  registerHomeRoutes(app, {
    root: 'unused',
    raws: {} as any,
    wiki: {
      get: async () => {
        reads++;
      },
    } as any,
    prompts: {
      get: async () => {
        reads++;
      },
    } as any,
    runner: {
      recoveryJobs: () => {
        reads++;
        return [];
      },
    } as any,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  try {
    const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
    for (const query of [
      'start=2026-02-29&end=2026-03-01',
      'start=2026-10-26&end=2026-10-26',
      'start=2026-11-02&end=2026-10-26',
    ])
      assert.equal((await fetch(base + '/api/home/review?' + query)).status, 400);
    assert.equal(reads, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('损坏 Wiki 与 Prompt 各自报错，合法旧 Prompt 读取不改字节', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'l6-errors-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const prompts = new PromptStore(root, wiki);
    await prompts.initialize();
    const input = {
      name: '旧Prompt',
      category: 'customer',
      scenario: '场景',
      body: '正文',
      inputRequirements: '输入',
      outputRequirements: '输出',
      relatedWikiIds: [],
      examples: '',
      tags: [],
      favorite: false,
    };
    const prompt = (await prompts.create(randomUUID(), input)).prompt;
    const file = path.join(root, 'prompts', prompt.id + '.json');
    const original = await readFile(file);
    const deps = { root, raws, wiki, prompts, runner: { recoveryJobs: () => [] } as any };
    let review = await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.equal(review.feedback.status, 'ok');
    assert.deepEqual(await readFile(file), original);
    await writeFile(file, '{broken');
    review = await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.equal(review.feedback.status, 'error');
    assert.equal(review.knowledge.status, 'ok');
    await writeFile(file, original);
    const page = await wiki.create({
      title: '虚构Wiki',
      type: 'concept',
      category: 'industry_basics',
      sources: [],
      tags: [],
      aliases: [],
      knowledge_status: 'needs_verification',
      confidence: 'low',
      source_level: 'D',
      review_status: 'unreviewed',
      body: '正文',
    });
    await writeFile(path.join(root, 'knowledge', 'wiki', page.id + '.md'), 'broken');
    review = await periodReview(deps, '2026-10-26', '2026-11-02');
    assert.equal(review.knowledge.status, 'error');
    assert.equal(review.feedback.status, 'ok');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
