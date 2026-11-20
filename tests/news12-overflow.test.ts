import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { NewsPipeline } from '../services/automation/pipeline/service.ts';
import type { ScreenInput } from '../services/automation/pipeline/screen.ts';
import type { TaskContext } from '../services/automation/scheduler.ts';
import { createDailyNews } from '../services/automation/tasks/news-daily.ts';
import { NewsService } from '../services/news/service.ts';
import type { NewsItem } from '../services/news/types.ts';
import { RawStore } from '../services/raw/store.ts';

const date = '2026-11-20';
const fetchedAt = '2026-11-20T02:00:00.000Z';
const item = (n: number, sourceId: string): NewsItem => ({
  id: `report-${n}`,
  url: `https://reports.example.test/${n}`,
  title: `中国食品零售渠道第 ${n} 项消费者调研`,
  sourceId, sourceName: sourceId,
  publishedAt: '2026-11-19', fetchedAt,
  excerpt: '中国食品零售消费者调研显示，商超渠道饮料销量同比增长 12%。2026年第三季度调查覆盖3100个家庭，便利店渠道的即饮品类渗透率达到35%。',
  evidenceKind: 'article_excerpt',
  research: { kind: '报告正文摘录', dataPeriod: '2026年第三季度', pdfUrl: `https://reports.example.test/${n}.pdf`, pageRange: '第 3 页' },
});
const initial = () => [item(1, 'worldpanel'), item(2, 'worldpanel'), item(3, 'niq'), item(4, 'niq'), item(5, 'mintel')];

async function setup(t: TestContext, reports: NewsItem[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'news12-overflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  await raws.initialize();
  const control = { reports, failInbox: false, checks: 0, now: fetchedAt };
  const noModel = () => assert.fail('不应调用模型');
  const clock = () => new Date(control.now);
  const news = new NewsService({
    root, clock, rawStore: raws, aiEnabled: true, providerFactory: async () => noModel(),
    stageResearchOverflow: edition => {
      if (control.failInbox) return Promise.reject(Error('测试注入的收件箱暂不可写'));
      return pipeline.stageEdition(edition, 'research-overflow');
    },
    async readSources(section) {
      if (section === 'fmcg') control.checks++;
      return {
        items: section === 'fmcg' ? control.reports : [],
        sources: [{ name: '合成研报', status: section === 'fmcg' ? 'ok' : 'empty', checkedAt: clock().toISOString() }],
      };
    },
  });
  const context: TaskContext = {
    runId: randomUUID(), signal: new AbortController().signal, provider: noModel,
    link: async () => {}, step: async (_name, work) => { await work(); },
  };
  let operation: Promise<void> | undefined;
  const pipeline: NewsPipeline = new NewsPipeline({
    root, news, clock,
    scheduler: { canStartAuthorized: () => true, runAuthorized: (_type, _id, _candidateId, work) => operation = work(context) },
    runner: { start: async () => noModel(), readJob: async () => noModel(), waitForSettlement: async () => noModel() },
    drafts: { get: async () => undefined }, wiki: { withLock: async work => work() },
    states: { get: async () => assert.fail('本用例只保存 Raw') }, withProvider: async work => work(),
  });
  const check = async (attempt: number) => {
    await news.check('fmcg', 'all', attempt);
    return (await news.ensure(true))!;
  };
  const saveCandidate = async (id: string) => {
    await pipeline.confirm({ requestId: randomUUID(), candidateIds: [id], organize: false, mode: 'standard' });
    await pipeline.tick();
    assert.ok(operation);
    await operation;
    const row = (await pipeline.list()).items.find(candidate => candidate.id === id);
    assert.equal(row?.execution?.phase, 'saved');
    assert.ok(row?.savedRawId);
    return row.savedRawId;
  };
  return { news, pipeline, raws, control, context, check, saveCandidate };
}

test('快消满额后保留展示及 Raw，合格溢出可在收件箱确认保存并排除重复', async t => {
  const h = await setup(t, initial());
  const first = (await h.check(0)).sections.fmcg!;
  assert.equal(first.items.length, 5);
  const original = await h.news.saveRaw(date, 'fmcg', first.items[0]!.id);
  assert.equal((await h.pipeline.list()).items.length, 0);

  const overflow = item(6, 'mintel');
  h.control.reports = [overflow,
    { ...item(7, 'niq'), url: `${overflow.url}?utm_source=duplicate` },
    { ...item(8, 'niq'), title: first.items[0]!.title + '！' },
    { ...item(9, 'niq'), research: first.items[0]!.research },
    { ...item(10, 'niq'), publishedAt: '2023-01-01' },
    { ...item(11, 'niq'), evidenceKind: 'source_summary', research: undefined },
  ];
  const second = await h.check(1);
  assert.deepEqual(second.sections.fmcg!.items, first.items);
  assert.match(second.sections.fmcg!.checkMessage!, /满5条.*1 条合格研报.*收件箱/);
  const list = await h.pipeline.list();
  assert.deepEqual(list.items.map(row => row.item), [overflow]);
  const candidate = list.items[0]!;
  assert.equal(candidate.id, `${date}/fmcg/${overflow.id}`);
  assert.equal(candidate.screening, undefined);
  assert.equal(candidate.savedRawId, undefined);
  await h.pipeline.disposition(candidate.id, 'later');

  await h.check(2);
  const repeated = await h.pipeline.list();
  assert.deepEqual(repeated.items, [{ ...candidate, disposition: 'later' }]);
  const rawId = await h.saveCandidate(candidate.id);
  const raw = await h.raws.get(rawId);
  assert.equal(raw?.url, overflow.url);
  assert.equal(raw?.publishedAt, overflow.publishedAt);
  assert.equal(raw?.body, overflow.excerpt);
  assert.ok(raw?.extractionNote?.includes(overflow.research!.pdfUrl!));
  assert.deepEqual((await h.news.savedRaws(date)).items.map(row => row.rawId), [original.rawId]);

  h.control.now = '2026-11-21T02:00:00.000Z';
  assert.deepEqual((await h.check(0)).sections.fmcg!.items, []);
  assert.equal((await h.pipeline.list()).items.length, 0);
  assert.equal((await h.pipeline.list(date)).items[0]!.savedRawId, rawId);
});

test('自动准备和同源超限走同一收件箱，重复执行保留候选及展示', async t => {
  const reports = [...initial(), item(6, 'worldpanel'), item(7, 'worldpanel')];
  const h = await setup(t, reports);
  const task = createDailyNews(h.news, h.pipeline);
  const batches: string[][] = [];
  const context: TaskContext = { ...h.context, provider: () => ({
    name: '合成预筛', model: '合成预筛', async complete({ user }) {
      const { items } = JSON.parse(user) as { items: ScreenInput[] };
      batches.push(items.map(row => row.candidateId));
      const text = JSON.stringify({ items: items.map(({ candidateId }) => ({
        candidateId, relevance: 2, categories: ['渠道'], reason: '提供了零售渠道数据。', suggestedMode: 'standard',
      })) });
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    },
  }) };
  await task.execute(context);
  const edition = (await h.news.edition(date))!;
  assert.equal(edition.sections.fmcg!.items.length, 5);
  assert.equal(edition.sections.fmcg!.items.filter(row => row.sourceId === 'worldpanel').length, 2);
  assert.equal(edition.researchOverflow?.length, 2);
  const first = await h.pipeline.list();
  assert.deepEqual(new Set(first.items.map(row => row.item.id)), new Set(reports.map(row => row.id)));
  assert.deepEqual(batches, [edition.sections.fmcg!.items.map(row => `${date}/fmcg/${row.id}`)]);
  assert.equal(first.items.filter(row => !row.screening && row.origin === 'research-overflow').length, 2);
  await task.execute(context);
  assert.deepEqual((await h.pipeline.list()).items, first.items);
  assert.equal(batches.length, 1);
  assert.equal(h.control.checks, 1);

  h.control.now = '2026-11-21T02:00:00.000Z';
  h.control.reports = [item(21, 'worldpanel'), item(22, 'worldpanel'), item(23, 'worldpanel')];
  const next = await h.check(0);
  assert.equal(next.sections.fmcg!.items.length, 2);
  assert.equal((await h.pipeline.list()).items.length, 1);
});

test('收件箱写入失败时保留已发布内容并可重试同一次来源结果', async t => {
  const h = await setup(t, initial());
  const first = (await h.check(0)).sections.fmcg!;
  const overflow = item(6, 'mintel');
  h.control.reports = [overflow];
  h.control.failInbox = true;
  const interrupted = (await h.check(1)).sections.fmcg!;
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.items, first.items);
  assert.equal(interrupted.checkMessage, undefined);
  assert.deepEqual((await h.pipeline.list()).items, []);

  h.control.failInbox = false;
  const recovered = (await h.check(2)).sections.fmcg!;
  assert.equal(recovered.status, 'source_only');
  assert.deepEqual(recovered.items, first.items);
  assert.deepEqual((await h.pipeline.list()).items.map(row => row.item), [overflow]);
  assert.equal(h.control.checks, 2);
});
