import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, preview } from 'vite';
import { NewsRawSave } from '../../services/news/raw-save.ts';
import { RawStore } from '../../services/raw/store.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'autoux02-review-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'empty-env');
const outDir = path.join(run, 'dist');
const config = path.join(run, 'provider.env');
const requestLog = path.join(run, 'external-requests.ndjson');
const preloadFile = path.join(run, 'server-preload.mjs');

const now = new Date();
const stamp = now.toISOString();
const month = stamp.slice(0, 7);
const threeDaysAgo = new Date(+now - 3 * 86_400_000);
const oldStamp = threeDaysAgo.toISOString();
const oldMonth = oldStamp.slice(0, 7);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - 2 * 86_400_000));

await Promise.all([
  mkdir(envDir, { recursive: true }),
  mkdir(path.join(data, 'drafts'), { recursive: true }),
  mkdir(path.join(data, 'state', 'news'), { recursive: true }),
  mkdir(path.join(data, 'state', 'knowledge-inspections'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'news-candidates'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'wiki-lint'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'weekly-reviews'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'runs', month), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'runs', oldMonth), { recursive: true }),
]);
await writeFile(requestLog, '');
await writeFile(
  config,
  [
    'FMCG_LLM_BASE_URL=https://autoux02-fake.invalid/v1',
    'FMCG_LLM_MODEL=autoux02-synthetic-model',
    'FMCG_LLM_API_KEY=autoux02-synthetic-key-only',
  ].join('\n') + '\n',
);

await writeFile(
  preloadFile,
  `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.AUTOUX02_REQUEST_LOG;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  throw new Error('Blocked unexpected external request in AUTOUX02 isolation: ' + url.href);
};
`,
);

const sha256Hex = value => createHash('sha256').update(value).digest('hex');

// Seed isolated stores.
const rawStore = new RawStore(data);
const wikiStore = new WikiStore(data, rawStore);
const workItemStore = new WorkItemStore(data, rawStore);
await rawStore.initialize();
await wikiStore.initialize();

const raw1 = await rawStore.create({
  title: 'AUTOUX02 渠道动销测试原料',
  body: '华东便利店与量贩零食渠道复购观察原始记录，用于隔离浏览器端到端验收。',
  tags: ['渠道'],
  sourceType: 'report',
  sourceName: '合成测试研报',
});

const wiki1 = await wikiStore.create({
  title: 'AUTOUX02 渠道动销概念页',
  type: 'concept',
  category: 'channel',
  body: '## 定义\n用于验证主动检查与知识库跳转的合成概念页。',
  sources: [raw1.id],
  aliases: ['AUTOUX02 概念'],
  tags: ['渠道'],
  knowledge_status: 'source_supported',
  confidence: 'medium',
  source_level: 'B',
  review_status: 'unreviewed',
});

const work1 = await workItemStore.create({
  kind: 'customer_issue',
  title: '华东重点KA渠道季末回访',
  feedback: '客户要求核对季末返利与陈列核销进度。',
});
const work2 = await workItemStore.create({
  kind: 'product_analysis',
  title: '华南便利店冷柜分析事项',
  goal: '评估新增冷柜投放在便利店场景的周转表现。',
});

// Seed Work Reminders: due_follow_up (unread), new_raw_ready (unread), stale_item (acknowledged).
const rem1Id = randomUUID();
const rem2Id = randomUUID();
const rem3Id = randomUUID();
const remindersFile = path.join(data, 'state', 'automation', 'reminders.json');
const buildRemindersState = (includeNewRawReady = true) => ({
  revision: 1,
  settings: {
    desktopNotificationsEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    staleDays: 7,
    maxToastsPerRun: 3,
  },
  items: [
    {
      id: rem1Id,
      dedupeKey: `due:${work1.id}`,
      itemId: work1.id,
      itemTitle: work1.title,
      itemKind: 'customer_issue',
      kind: 'due_follow_up',
      summary: '今日到期跟进客户返利核对',
      status: 'unread',
      firstDetectedAt: stamp,
      lastDetectedAt: stamp,
      deliveryStatus: 'delivered',
    },
    ...(includeNewRawReady
      ? [
          {
            id: rem2Id,
            dedupeKey: `new_raw:${work2.id}`,
            itemId: work2.id,
            itemTitle: work2.title,
            itemKind: 'product_analysis',
            kind: 'new_raw_ready',
            summary: '新增 1 份便利店冷柜调研资料待分析',
            status: 'unread',
            firstDetectedAt: stamp,
            lastDetectedAt: stamp,
            deliveryStatus: 'delivered',
          },
        ]
      : [
          {
            id: rem2Id,
            dedupeKey: `new_raw:${work2.id}`,
            itemId: work2.id,
            itemTitle: work2.title,
            itemKind: 'product_analysis',
            kind: 'new_raw_ready',
            summary: '新增 1 份便利店冷柜调研资料待分析',
            status: 'resolved',
            resolvedAt: stamp,
            firstDetectedAt: stamp,
            lastDetectedAt: stamp,
            deliveryStatus: 'delivered',
          },
        ]),
    {
      id: rem3Id,
      dedupeKey: `stale:${work1.id}`,
      itemId: work1.id,
      itemTitle: `${work1.title}（推进提醒）`,
      itemKind: 'customer_issue',
      kind: 'stale_item',
      summary: '已超过 7 天未更新进展',
      status: 'acknowledged',
      firstDetectedAt: oldStamp,
      lastDetectedAt: stamp,
      deliveryStatus: 'delivered',
    },
  ],
  issues: [],
});
await writeFile(remindersFile, JSON.stringify(buildRemindersState(true), null, 2));

// Seed candidate-backed saved raws + pending draft + organizing candidate + failed candidate.
const makeNewsItem = (itemId, title, excerpt) => ({
  id: itemId,
  title,
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: `https://example.invalid/autoux02/${itemId}`,
  publishedAt: published,
  fetchedAt: stamp,
  excerpt,
  evidenceKind: 'article_excerpt',
});

const orgCandItem = makeNewsItem('autoux02-cand-org', 'AUTOUX02 整理中候选示例', '已入库正在整理中的候选条目。');
const draftCandItem = makeNewsItem('autoux02-cand-draft', 'AUTOUX02 已入库待审草稿候选', '已入库并生成待审草稿的候选条目。');
const failCandItem = makeNewsItem('autoux02-cand-fail', 'AUTOUX02 整理失败候选示例', '已保存 Raw 但整理失败的候选条目。');

const newsRawSave = new NewsRawSave(data, rawStore, () => now);
const savedOrgCand = await newsRawSave.save(today, 'fmcg', orgCandItem, randomUUID());
const savedDraftCand = await newsRawSave.save(today, 'fmcg', draftCandItem, randomUUID());
const savedFailCand = await newsRawSave.save(today, 'fmcg', failCandItem, randomUUID());
const rawDraftCand = await rawStore.get(savedDraftCand.rawId);
assert.ok(rawDraftCand);

const draftPendingId = randomUUID();
const draftJobId = randomUUID();
const orgJobId = randomUUID();
await writeFile(
  path.join(data, 'drafts', `${draftPendingId}.json`),
  JSON.stringify(
    {
      id: draftPendingId,
      rawId: rawDraftCand.id,
      rawSha256: rawDraftCand.bodySha256,
      rawTitle: rawDraftCand.title,
      rawMeta: {
        rawId: rawDraftCand.id,
        title: rawDraftCand.title,
        sourceType: rawDraftCand.sourceType,
        sourceName: rawDraftCand.sourceName,
        importedAt: rawDraftCand.importedAt,
      },
      status: 'pending_confirmation',
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      rulesVersion: 'locator-v2-test',
      provider: { name: 'synthetic', model: 'autoux02-test' },
      jobId: draftJobId,
      document: { title: 'AUTOUX02 待审资讯草稿', main_topic: '渠道', summary: '草稿摘要' },
      source: {
        title: rawDraftCand.title,
        category: 'channel',
        summary: '摘要',
        key_takeaways: [],
        body: '来源正文',
        knowledge_status: 'source_supported',
        confidence: 'low',
        source_level: 'C',
      },
      pages: [
        {
          pageId: randomUUID(),
          title: 'AUTOUX02 资讯草稿概念页',
          type: 'concept',
          category: 'channel',
          one_line_definition: '测试概念定义',
          source_facts: [{ text: rawDraftCand.body, evidenceIds: ['e1'] }],
          ai_organized: [],
          ai_inferences: [],
          related_pages: [],
          open_questions: [],
          source_evidence: [
            { id: 'e1', rawId: rawDraftCand.id, quote: rawDraftCand.body, start: 0, end: rawDraftCand.body.length, chunkIndex: 0 },
          ],
          knowledge_status: 'source_supported',
          confidence: 'low',
          source_level: 'C',
          selected: true,
          provenance: [{ chunkIndex: 0, start: 0, end: rawDraftCand.body.length }],
        },
      ],
      warnings: [],
      extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    },
    null,
    2,
  ),
);

// Seed Automation Runs across tasks with multi-step details, durations, sourceRequests, usage, and artifacts.
const selfcheckRunId = randomUUID();
const candRunId = randomUUID();
const orgCandRunId = randomUUID();
const failCandRunId = randomUUID();
const oldNewsFailRunId = randomUUID();
const lintRunId = randomUUID();
const prevLintRunId = randomUUID();
const inspectRunId = randomUUID();
const inspectionId = randomUUID();
const weeklyRunId = randomUUID();

const writeRun = async runRecord => {
  const m = runRecord.scheduledAt.slice(0, 7);
  await mkdir(path.join(data, 'state', 'automation', 'runs', m), { recursive: true });
  await writeFile(path.join(data, 'state', 'automation', 'runs', m, `${runRecord.id}.json`), JSON.stringify(runRecord, null, 2));
};

const runT1 = new Date(+now - 120_000).toISOString();
const runT1Mid = new Date(+now - 117_000).toISOString();
const runT1End = new Date(+now - 115_000).toISOString();
const runT2 = new Date(+now - 90_000).toISOString();
const runT2Mid = new Date(+now - 87_000).toISOString();
const runT2End = new Date(+now - 85_000).toISOString();
const runT3 = new Date(+now - 60_000).toISOString();
const runT3End = new Date(+now - 55_000).toISOString();
const runT4 = new Date(+now - 30_000).toISOString();
const runT4End = new Date(+now - 25_000).toISOString();
const oldRunEnd = new Date(+threeDaysAgo + 5_000).toISOString();

await writeRun({
  id: selfcheckRunId,
  type: 'system.selfcheck',
  trigger: 'manual',
  scheduledAt: runT1,
  startedAt: runT1,
  endedAt: runT1End,
  status: 'succeeded',
  steps: [
    { name: '工作区目录与存储自检', status: 'succeeded', startedAt: runT1, endedAt: runT1Mid, durationMs: 12, summary: '5 项检查全部通过' },
    { name: '调度状态与锁检查', status: 'succeeded', startedAt: runT1Mid, endedAt: runT1End, durationMs: 9, summary: '实例锁与读写令牌正常' },
  ],
  sourceRequests: 0,
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [raw1.id], jobIds: [], draftIds: [draftPendingId], weeklyReviewWeekKey: '2026-W46' },
  budget: null,
});

await writeRun({
  id: oldNewsFailRunId,
  type: 'news.daily',
  trigger: 'schedule',
  scheduledAt: oldStamp,
  startedAt: oldStamp,
  endedAt: oldRunEnd,
  status: 'failed',
  error: '合成历史来源抓取超时（超过 24 小时前）',
  steps: [{ name: '抓取来源', status: 'failed', startedAt: oldStamp, endedAt: oldRunEnd, durationMs: 50, summary: '来源请求失败', error: '合成历史来源抓取超时' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  sourceRequests: 2,
  artifacts: { rawIds: [], jobIds: [], draftIds: [] },
  budget: null,
});

await writeRun({
  id: candRunId,
  type: 'pipeline.organize',
  trigger: 'manual',
  scheduledAt: runT2,
  startedAt: runT2,
  endedAt: runT2End,
  status: 'succeeded',
  candidateId: `${today}/fmcg/${draftCandItem.id}`,
  steps: [
    { name: '保存 Raw 来源材料', status: 'succeeded', startedAt: runT2, endedAt: runT2Mid, durationMs: 14, summary: '已写入隔离 Raw 存储' },
    { name: '生成待审知识草稿', status: 'succeeded', startedAt: runT2Mid, endedAt: runT2End, durationMs: 18, summary: '已生成待审草稿' },
  ],
  sourceRequests: 1,
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [rawDraftCand.id], jobIds: [draftJobId], draftIds: [draftPendingId] },
  budget: null,
});

await writeRun({
  id: orgCandRunId,
  type: 'pipeline.organize',
  trigger: 'manual',
  scheduledAt: runT2Mid,
  startedAt: runT2Mid,
  endedAt: runT2End,
  status: 'interrupted',
  candidateId: `${today}/fmcg/${orgCandItem.id}`,
  error: '合成整理中状态关联运行',
  steps: [
    { name: '保存 Raw', status: 'succeeded', startedAt: runT2Mid, endedAt: runT2End, durationMs: 11, summary: 'Raw 已落盘' },
    { name: 'AI 整理', status: 'interrupted', startedAt: runT2End, endedAt: runT2End, durationMs: 30, summary: '等待恢复', error: '合成整理中状态关联运行' },
  ],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [savedOrgCand.rawId], jobIds: [orgJobId], draftIds: [] },
  budget: null,
});

await writeRun({
  id: failCandRunId,
  type: 'pipeline.organize',
  trigger: 'manual',
  scheduledAt: oldStamp,
  startedAt: oldStamp,
  endedAt: oldRunEnd,
  status: 'failed',
  candidateId: `${today}/fmcg/${failCandItem.id}`,
  error: '合成整理失败测试',
  steps: [
    { name: '保存 Raw', status: 'succeeded', startedAt: oldStamp, endedAt: oldRunEnd, durationMs: 10, summary: 'Raw 保存完成' },
    { name: 'AI 整理', status: 'failed', startedAt: oldStamp, endedAt: oldRunEnd, durationMs: 25, summary: '整理异常', error: '合成整理失败测试' },
  ],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [savedFailCand.rawId], jobIds: [], draftIds: [] },
  budget: null,
});

await writeRun({
  id: lintRunId,
  type: 'wiki.lint',
  trigger: 'schedule',
  scheduledAt: runT3,
  startedAt: runT3,
  endedAt: runT3End,
  status: 'succeeded',
  steps: [{ name: '结构扫描与基线对比', status: 'succeeded', startedAt: runT3, endedAt: runT3End, durationMs: 15, summary: '新增 2 项 · 消除 1 项' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [], lintSnapshotId: lintRunId },
  budget: null,
});

await writeRun({
  id: inspectRunId,
  type: 'wiki.inspect',
  trigger: 'schedule',
  scheduledAt: runT4,
  startedAt: runT4,
  endedAt: runT4End,
  status: 'succeeded',
  steps: [{ name: '主动巡检扫描', status: 'succeeded', startedAt: runT4, endedAt: runT4End, durationMs: 20, summary: '实读 1 页，待核 1 项' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [], inspectionIds: [inspectionId] },
  budget: null,
});

await writeRun({
  id: weeklyRunId,
  type: 'review.weekly',
  trigger: 'schedule',
  scheduledAt: '2026-11-16T01:00:00.000Z',
  startedAt: '2026-11-16T01:00:00.000Z',
  endedAt: '2026-11-16T01:00:05.000Z',
  status: 'succeeded',
  steps: [{ name: '生成周报事实快照与草稿', status: 'succeeded', startedAt: '2026-11-16T01:00:00.000Z', endedAt: '2026-11-16T01:00:05.000Z', durationMs: 10, summary: '已归档 2026-W46' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [], weeklyReviewWeekKey: '2026-W46' },
  budget: null,
});

// Seed Wiki Lint snapshot & Knowledge Inspection record.
const makeLintFinding = (suffix, msg) => ({
  code: 'missing_source',
  fingerprint: sha256Hex(`autoux02-lint-${suffix}`),
  objectId: wiki1.id,
  pageTitle: wiki1.title,
  file: `knowledge/concepts/${wiki1.id}.md`,
  message: msg,
  location: { scope: 'page', line: 0 },
});
const lintAdded1 = makeLintFinding('a1', '新增结构问题示例甲');
const lintAdded2 = makeLintFinding('a2', '新增结构问题示例乙');
const lintUnchanged = makeLintFinding('u1', '未变化结构问题示例');
const lintResolved = makeLintFinding('r1', '已消除结构问题示例');

await writeFile(
  path.join(data, 'state', 'automation', 'wiki-lint', `${lintRunId}.json`),
  JSON.stringify(
    {
      runId: lintRunId,
      checkedAt: runT3End,
      total: 3,
      byCode: { missing_source: 3 },
      findings: [lintAdded1, lintAdded2, lintUnchanged],
      diff: {
        isBaseline: false,
        previousRunId: prevLintRunId,
        addedCount: 2,
        resolvedCount: 1,
        unchangedCount: 1,
        added: [lintAdded1, lintAdded2],
        resolved: [lintResolved],
      },
    },
    null,
    2,
  ),
);

await writeFile(
  path.join(data, 'state', 'knowledge-inspections', `${inspectionId}.json`),
  JSON.stringify(
    {
      id: inspectionId,
      revision: 1,
      status: 'completed',
      stage: 'completed',
      attempts: 1,
      createdAt: runT4,
      updatedAt: runT4End,
      includeRelated: false,
      scope: {
        selected: [wiki1.id],
        candidates: [wiki1.id],
        read: [{ id: wiki1.id, title: wiki1.title, revision: wiki1.revision }],
        skipped: [],
        gaps: [],
      },
      readWiki: [wiki1],
      rawSnapshots: [{ id: raw1.id, bodySha256: raw1.bodySha256 }],
      findings: [
        {
          id: 'finding-0',
          fingerprint: sha256Hex('autoux02-inspect-finding-0'),
          type: 'conflict',
          origin: 'model',
          wikiIds: [wiki1.id],
          summary: '渠道动销口径待核发现',
          reason: '需人工确认渠道口径说明',
          differences: '暂存差异说明',
          nextStep: 'defer',
          evidence: [
            {
              id: 'finding-0-e0',
              kind: 'wiki',
              recordId: wiki1.id,
              title: wiki1.title,
              revision: wiki1.revision,
              bodySha256: sha256Hex(wiki1.body),
              start: 0,
              end: 5,
              quote: wiki1.body.slice(0, 5),
              rawIds: [raw1.id],
              manualWikiIds: [],
            },
          ],
          status: 'pending',
        },
      ],
      lint: [],
      audits: [],
      drafts: [],
    },
    null,
    2,
  ),
);

// Seed Weekly Review archive (2026-W46 referencing selfcheckRunId).
await writeFile(
  path.join(data, 'state', 'automation', 'weekly-reviews', 'settings.json'),
  JSON.stringify({ revision: 1, aiSummaryEnabled: true }, null, 2),
);
await writeFile(
  path.join(data, 'state', 'automation', 'weekly-reviews', '2026-W46.json'),
  JSON.stringify(
    {
      weekKey: '2026-W46',
      period: {
        weekKey: '2026-W46',
        start: '2026-11-09',
        end: '2026-11-16',
        from: '2026-11-08T16:00:00.000Z',
        until: '2026-11-15T16:00:00.000Z',
        partialWeek: false,
      },
      revision: 1,
      status: 'draft',
      aiStatus: 'ready',
      snapshot: {
        hasActivity: true,
        sections: [
          {
            key: 'automation',
            title: '自动化运行与用量',
            scope: 'period',
            status: 'ok',
            metrics: [{ ref: 'metric:automation:runs', label: '本周运行总数', count: 1 }],
            entries: [
              {
                ref: `run:${selfcheckRunId}`,
                title: '工作台系统自检记录',
                date: '2026-11-12',
                status: 'succeeded',
                target: { kind: 'run', id: selfcheckRunId },
              },
            ],
          },
        ],
      },
      draft: {
        executiveSummary: '2026-W46 周期自动回顾草稿完成汇总。',
        highlights: [{ text: '工作台系统自检完成并可追溯运行详情。', refs: [`run:${selfcheckRunId}`] }],
        risksAndBlockers: [],
        nextWeekFocus: [{ text: '持续关注渠道候选收件箱', reason: '提升归档覆盖' }],
        openQuestions: [],
      },
      userMarkdown: '',
      generatedAt: '2026-11-16T01:00:05.000Z',
      updatedAt: '2026-11-16T01:00:05.000Z',
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
    },
    null,
    2,
  ),
);

// Seed News Edition & Candidates.
await writeFile(
  path.join(data, 'state', 'news', `${today}.json`),
  JSON.stringify(
    {
      schemaVersion: 1,
      date: today,
      updatedAt: stamp,
      sections: {
        fmcg: {
          contentVersion: 'research-v1',
          status: 'source_only',
          attempt: 1,
          startedAt: stamp,
          finishedAt: stamp,
          items: [makeNewsItem('autoux02-news-1', 'AUTOUX02 快消渠道测试快讯', '防止首页主动发外网抓取请求的本地快讯。')],
          sources: [],
        },
        ai: {
          status: 'source_only',
          attempt: 1,
          startedAt: stamp,
          finishedAt: stamp,
          items: [makeNewsItem('autoux02-ai-1', 'AUTOUX02 AI 前沿本地条目', '隔离测试 AI 条目。')],
          sources: [],
        },
      },
    },
    null,
    2,
  ),
);

const candidatesFile = path.join(data, 'state', 'automation', 'news-candidates', `${today}.json`);
const buildCandidatesState = (includeOrganizing = false) => ({
  schemaVersion: 1,
  date: today,
  items: [
    {
      id: `${today}/fmcg/autoux02-cand-high`,
      section: 'fmcg',
      disposition: 'inbox',
      item: makeNewsItem('autoux02-cand-high', 'AUTOUX02 高分待确认候选一', '量贩折扣店复购分析，支持确认入库。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/autoux02-cand-high`,
          relevance: 3,
          categories: ['渠道'],
          reason: '高度相关',
          suggestedMode: 'deep',
        },
      },
    },
    {
      id: `${today}/ai/autoux02-cand-unscreened`,
      section: 'ai',
      disposition: 'inbox',
      item: makeNewsItem('autoux02-cand-unscreened', 'AUTOUX02 未预筛待确认候选二', 'AI 商品洞察未预筛样本。'),
      screening: {
        error: '本批读取失败。',
      },
    },
    {
      id: `${today}/fmcg/autoux02-cand-low`,
      section: 'fmcg',
      disposition: 'inbox',
      item: makeNewsItem('autoux02-cand-low', 'AUTOUX02 低分折叠候选三', '相关性较低，默认折叠。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/autoux02-cand-low`,
          relevance: 0,
          categories: ['其他'],
          reason: '边缘相关',
          suggestedMode: 'standard',
        },
      },
    },
    ...(includeOrganizing
      ? [
          {
            id: `${today}/fmcg/${orgCandItem.id}`,
            section: 'fmcg',
            disposition: 'inbox',
            item: orgCandItem,
            screening: {
              score: {
                candidateId: `${today}/fmcg/${orgCandItem.id}`,
                relevance: 2,
                categories: ['渠道'],
                reason: '正在整理中',
                suggestedMode: 'standard',
              },
            },
            confirmation: {
              requestId: randomUUID(),
              registrationId: randomUUID(),
              grantedAt: stamp,
              organize: true,
              mode: 'standard',
            },
            execution: {
              phase: 'organizing',
              runId: orgCandRunId,
              rawId: savedOrgCand.rawId,
              jobId: orgJobId,
            },
          },
        ]
      : []),
    {
      id: `${today}/fmcg/${draftCandItem.id}`,
      section: 'fmcg',
      disposition: 'inbox',
      item: draftCandItem,
      screening: {
        score: {
          candidateId: `${today}/fmcg/${draftCandItem.id}`,
          relevance: 3,
          categories: ['渠道'],
          reason: '已入库生成草稿',
          suggestedMode: 'standard',
        },
      },
      confirmation: {
        requestId: randomUUID(),
        registrationId: randomUUID(),
        grantedAt: stamp,
        organize: true,
        mode: 'standard',
      },
      execution: {
        phase: 'draft_ready',
        runId: candRunId,
        rawId: rawDraftCand.id,
        jobId: draftJobId,
        draftId: draftPendingId,
      },
    },
    {
      id: `${today}/fmcg/${failCandItem.id}`,
      section: 'fmcg',
      disposition: 'inbox',
      item: failCandItem,
      screening: {
        score: {
          candidateId: `${today}/fmcg/${failCandItem.id}`,
          relevance: 2,
          categories: ['渠道'],
          reason: '整理失败对照',
          suggestedMode: 'standard',
        },
      },
      confirmation: {
        requestId: randomUUID(),
        registrationId: randomUUID(),
        grantedAt: stamp,
        organize: true,
        mode: 'standard',
      },
      execution: {
        phase: 'organize_failed',
        runId: failCandRunId,
        rawId: savedFailCand.rawId,
        error: '合成整理失败测试',
      },
    },
    {
      id: `${today}/fmcg/autoux02-cand-ignored`,
      section: 'fmcg',
      disposition: 'ignored',
      item: makeNewsItem('autoux02-cand-ignored', 'AUTOUX02 已忽略候选六', '已忽略条目示例。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/autoux02-cand-ignored`,
          relevance: 2,
          categories: ['品类'],
          reason: '人工已忽略',
          suggestedMode: 'standard',
        },
      },
    },
  ],
});
// Write without 'organizing' before startup so NewsPipeline.initialize() does not convert it to 'interrupted'.
await writeFile(candidatesFile, JSON.stringify(buildCandidatesState(false), null, 2));

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  assert.ok(![4317, 5151, 5173].includes(port), `Reserved port chosen: ${port}`);
  return port;
}

await build({ configFile: false, plugins: [react()], envDir, build: { outDir, emptyOutDir: false } });
const apiPort = await freePort();
const uiPort = await freePort();
assert.notEqual(apiPort, uiPort);
const apiBase = `http://127.0.0.1:${apiPort}`;
const uiBase = `http://127.0.0.1:${uiPort}`;

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
Object.assign(env, {
  FMCG_DATA_DIR: data,
  FMCG_PORT: String(apiPort),
  FMCG_UI_ORIGIN: uiBase,
  FMCG_LLM_CONFIG_FILE: config,
  FMCG_NEWS_AI_ENABLED: 'false',
  NODE_ENV: 'test',
  AUTOUX02_REQUEST_LOG: requestLog,
});

const child = spawn(
  process.execPath,
  ['--import', pathToFileURL(preloadFile).href, '--import', 'tsx', 'server/index.ts'],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
const exited = once(child, 'close');
let apiLog = '';
child.stdout.on('data', chunk => {
  apiLog += chunk;
});
child.stderr.on('data', chunk => {
  apiLog += chunk;
});

const evidence = {
  run,
  today,
  apiPort,
  uiPort,
  desktopChecks: [],
  mobileChecks: [],
  pageErrors: [],
  consoleErrors: [],
  httpErrors: [],
  blockedBrowserExternalRequests: [],
  serverExternalRequests: [],
  modelRequestsInRuns: 0,
  closed: {},
};

const waitFor = async (label, fn) => {
  for (let i = 0; i < 120; i += 1) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  assert.fail(`Timeout waiting for ${label}`);
};

let ui;
let browser;
try {
  await waitFor('isolated API', () => fetch(`${apiBase}/api/health`).then(r => r.ok, () => false));
  // Now that NewsPipeline.initialize() has completed, seed the active 'organizing' candidate on disk.
  await writeFile(candidatesFile, JSON.stringify(buildCandidatesState(true), null, 2));

  ui = await preview({
    configFile: false,
    envDir,
    build: { outDir },
    preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': apiBase } },
  });

  const { chromium } = createRequire(import.meta.url)(
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  );
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'],
  });
  evidence.browserVersion = browser.version();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  page.on('pageerror', err => evidence.pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text());
  });
  page.on('response', res => {
    if (res.status() >= 400) {
      evidence.httpErrors.push({ url: res.url(), status: res.status() });
    }
  });

  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(`${uiBase}/`)) {
      evidence.blockedBrowserExternalRequests.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });

  const navClick = label => page.locator('.sidebar button.nav-item').filter({ hasText: label }).click();
  const measureOverflow = async label => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => {
      const vw = window.innerWidth;
      const sw = document.documentElement.scrollWidth;
      const offenders = [...document.querySelectorAll('body *')]
        .map(el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || st.display === 'none') return null;
          if (r.right > vw + 1 || el.scrollWidth > el.clientWidth + 1) {
            return {
              tag: el.tagName.toLowerCase(),
              cls: typeof el.className === 'string' ? el.className : '',
              right: Math.round(r.right),
              width: Math.round(r.width),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              text: (el.textContent ?? '').trim().slice(0, 40),
            };
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 15);
      return { innerWidth: vw, scrollWidth: sw, overflow: sw > vw, offenders };
    });
    return { page: label, ...metrics };
  };

  // ==================== DESKTOP 1440x900 ====================
  await page.goto(uiBase, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();

  await navClick('自动化');
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();

  const wfTab = page.locator('#automation-tab-workflows');
  const inboxTab = page.locator('#automation-tab-inbox');
  const runsTab = page.locator('#automation-tab-runs');

  await waitFor('workflows & counts loaded', async () => {
    const cards = await page.locator('.automation-workflow-card').count();
    const badge = (await inboxTab.locator('.automation-tab-badge').textContent().catch(() => ''))?.trim();
    return cards === 5 && badge === '5';
  });

  // 1) A2-03: 双入口统一模态框（流水线设置 + 通知设置）
  const newsCard = page.locator('article.automation-workflow-card[aria-label="每日资讯准备与预筛"]');
  const pipelineBtnTab1 = newsCard.getByRole('button', { name: '流水线设置', exact: true });
  await waitFor('pipeline settings button enabled', async () => !(await pipelineBtnTab1.isDisabled()));
  await pipelineBtnTab1.focus();
  await pipelineBtnTab1.click();

  const pipelineDialog = page.locator('.pipeline-settings-dialog[role="dialog"][aria-modal="true"]');
  await pipelineDialog.waitFor();
  await page.keyboard.press('Escape');
  await pipelineDialog.waitFor({ state: 'detached' });
  const pipelineEscFocusRestored = await pipelineBtnTab1.evaluate(el => document.activeElement === el);
  assert.equal(pipelineEscFocusRestored, true);

  await pipelineBtnTab1.click();
  await pipelineDialog.waitFor();
  const pipelineForm = pipelineDialog.locator('form[aria-label="流水线设置"]');
  const preScreenCheckbox = pipelineForm.locator('input[type="checkbox"]');
  const concurrencySelect = pipelineForm.locator('select');
  const topicsTextarea = pipelineForm.locator('textarea');
  await preScreenCheckbox.uncheck();
  await concurrencySelect.selectOption('3');
  await topicsTextarea.fill('渠道与折扣零售\nAI 辅助选品');

  const [savePipelineResp] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes('/api/automation/pipeline/settings') && res.request().method() === 'PATCH',
    ),
    pipelineForm.getByRole('button', { name: '保存流水线设置', exact: true }).click(),
  ]);
  assert.equal(savePipelineResp.status(), 200);
  await pipelineDialog.waitFor({ state: 'detached' });

  // Reload page & verify pipeline settings persisted.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await navClick('自动化');
  await newsCard.waitFor();
  await waitFor('pipeline settings ready after reload', async () => !(await pipelineBtnTab1.isDisabled()));
  await pipelineBtnTab1.click();
  await pipelineDialog.waitFor();
  assert.equal(await preScreenCheckbox.isChecked(), false);
  assert.equal(await concurrencySelect.inputValue(), '3');
  assert.equal(await topicsTextarea.inputValue(), '渠道与折扣零售\nAI 辅助选品');
  await page.keyboard.press('Escape');
  await pipelineDialog.waitFor({ state: 'detached' });

  // ReminderSettingsDialog from WorkflowsTab 提醒卡「通知设置」
  const remindersCard = page.locator('article.automation-workflow-card[aria-label="工作事项到期与新资料提醒"]');
  const notifyBtnTab1 = remindersCard.getByRole('button', { name: '通知设置', exact: true });
  await waitFor('notify settings button enabled', async () => !(await notifyBtnTab1.isDisabled()));
  await notifyBtnTab1.focus();
  await notifyBtnTab1.click();

  const reminderDialog = page.locator('.reminder-settings-dialog[role="dialog"][aria-modal="true"]');
  await reminderDialog.waitFor();
  const reminderForm = reminderDialog.locator('form[aria-label="提醒与通知设置"]');
  const quietInputs = reminderForm.locator('input[type="time"]');
  const staleInput = reminderForm.locator('input[type="number"]').first();
  await quietInputs.nth(0).fill('23:00');
  await quietInputs.nth(1).fill('07:30');
  await staleInput.fill('10');

  const [testNoticeResp] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes('/api/automation/reminders/test-notification') && res.request().method() === 'POST',
    ),
    reminderForm.getByRole('button', { name: '发送测试通知', exact: true }).click(),
  ]);
  assert.equal(testNoticeResp.status(), 200);
  await waitFor('test notification feedback shown', async () => {
    const txt = (await reminderForm.textContent()) ?? '';
    return txt.includes('测试通知 ·');
  });

  const [saveReminderResp] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes('/api/automation/reminders/settings') && res.request().method() === 'PATCH',
    ),
    reminderForm.getByRole('button', { name: '保存提醒设置', exact: true }).click(),
  ]);
  assert.equal(saveReminderResp.status(), 200);
  await reminderDialog.waitFor({ state: 'detached' });
  const reminderSaveFocusRestored = await notifyBtnTab1.evaluate(el => document.activeElement === el);
  assert.equal(reminderSaveFocusRestored, true);

  evidence.desktopChecks.push({
    item: 'A2-03_modals',
    pipelineEscFocusRestored,
    pipelinePersistedAfterReload: true,
    reminderTestNoticeStatus: 200,
    reminderSaveFocusRestored,
  });

  // 2) A2-05: 跨 Tab 右侧滑出详情抽屉（流程与计划 -> 最近结果 -> 抽屉 -> Escape 焦点恢复 -> 在运行记录中查看）
  const selfCard = page.locator('article.automation-workflow-card[aria-label="工作台自检"]');
  const lastRunBtn = selfCard.locator('dd button').first();
  await lastRunBtn.focus();
  await lastRunBtn.click();

  const drawer = page.locator('aside.automation-drawer[role="dialog"][aria-modal="true"]');
  await drawer.waitFor();
  assert.equal(await page.locator('#automation-run-detail').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');

  await waitFor('drawer run detail loaded', async () => {
    const steps = await drawer.locator('.automation-stepper .automation-stepper-item').count();
    return steps >= 2;
  });
  const stepperCount = await drawer.locator('.automation-stepper .automation-stepper-item').count();
  const usageGridText = (await drawer.locator('.automation-usage-grid').innerText()).replace(/\s+/g, ' ');
  assert.match(usageGridText, /来源 HTTP 请求/);
  assert.match(usageGridText, /模型请求次数/);
  assert.match(usageGridText, /输入 Token/);
  assert.match(usageGridText, /输出 Token/);
  assert.match(usageGridText, /用量未知的请求/);
  const artifactChipCount = await drawer.locator('.automation-artifact-chips .automation-artifact-chip').count();
  assert.ok(artifactChipCount >= 3, `Expected >= 3 artifact chips, got ${artifactChipCount}`);

  // Focus trap Tab / Shift+Tab stays within drawer.
  await page.keyboard.press('Tab');
  assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);

  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  const drawerEscFocusRestored = await lastRunBtn.evaluate(el => document.activeElement === el);
  assert.equal(drawerEscFocusRestored, true);

  // Reopen drawer & click「在运行记录中查看」-> seamless switch to RunsTab master-detail
  await lastRunBtn.click();
  await drawer.waitFor();
  await drawer.getByRole('button', { name: '在运行记录中查看', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.equal(await runsTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#automation-run-detail').count(), 1);
  assert.ok((await page.locator('.automation-runs-layout .automation-run-detail-panel').count()) === 1);
  assert.ok((await page.locator('.automation-runs-list > li.is-selected').count()) === 1);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');

  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('.automation-run-placeholder').waitFor();
  assert.equal(await page.locator('#automation-run-detail').count(), 0);

  // Also verify「立即运行」(system.selfcheck, 0 model calls) opens RunDetailDrawer and completes cleanly.
  await wfTab.click();
  await selfCard.waitFor();
  const desktopOverflow = await measureOverflow('desktop-workflows');
  assert.equal(desktopOverflow.overflow, false);
  const runNowBtn = selfCard.getByRole('button', { name: '立即运行', exact: true });
  await runNowBtn.click();
  await drawer.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');
  await waitFor('selfcheck runNow succeeded in drawer', async () =>
    /工作台自检\s*·\s*成功/.test((await drawer.locator('.automation-run-detail-subtitle').textContent().catch(() => '')) ?? ''),
  );
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });

  evidence.desktopChecks.push({
    item: 'A2-05_drawer',
    stepperCount,
    artifactChipCount,
    drawerEscFocusRestored,
    viewInRunsTransitionedCleanly: true,
    runNowDrawerOpenedAndSucceeded: true,
    desktopOverflow: desktopOverflow.overflow,
  });

  // 3) A2-01: 待处理收件箱子区、5 阶段漏斗双向同步、候选卡操作 & 查看运行抽屉
  await inboxTab.click();
  const subtabs = page.locator('.automation-subtabs[role="tablist"][aria-label="收件箱分类"]');
  await subtabs.waitFor();
  const subCandidates = page.locator('#automation-subtab-candidates');
  const subReminders = page.locator('#automation-subtab-reminders');
  assert.equal(await subCandidates.getAttribute('aria-selected'), 'true');
  assert.match((await subCandidates.innerText()).replace(/\s+/g, ' '), /待确认\s*3/);
  assert.match((await subReminders.innerText()).replace(/\s+/g, ' '), /未读\s*2/);

  const inboxSection = page.locator('#news-candidates');
  const funnel = inboxSection.locator('.automation-funnel');
  const stageButtons = funnel.locator('.automation-funnel-stage');
  assert.equal(await stageButtons.count(), 5);
  const candFilterSelect = inboxSection.locator('.automation-filters select').nth(1);

  const stageNames = ['已抓取', '待确认', '整理中', '待审草稿', '失败'];
  for (let i = 0; i < stageNames.length; i += 1) {
    assert.match((await stageButtons.nth(i).innerText()).replace(/\s+/g, ' '), new RegExp(stageNames[i]));
  }

  // Click 待确认 -> 整理中 -> 待审草稿 -> 失败 -> click 失败 again to reset 'all'
  await stageButtons.nth(1).click();
  assert.equal(await stageButtons.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await stageButtons.nth(1).getAttribute('data-tone'), 'review');
  assert.equal(await candFilterSelect.inputValue(), 'pending');

  await stageButtons.nth(2).click();
  assert.equal(await stageButtons.nth(2).getAttribute('aria-pressed'), 'true');
  assert.equal(await candFilterSelect.inputValue(), 'organizing');
  await inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 整理中候选示例"]').waitFor();

  await stageButtons.nth(3).click();
  assert.equal(await stageButtons.nth(3).getAttribute('aria-pressed'), 'true');
  assert.equal(await stageButtons.nth(3).getAttribute('data-tone'), 'review');
  assert.equal(await candFilterSelect.inputValue(), 'drafts');
  await inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 已入库待审草稿候选"]').waitFor();

  await stageButtons.nth(4).click();
  assert.equal(await stageButtons.nth(4).getAttribute('aria-pressed'), 'true');
  assert.equal(await stageButtons.nth(4).getAttribute('data-tone'), 'danger');
  assert.equal(await candFilterSelect.inputValue(), 'failed');
  await inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 整理失败候选示例"]').waitFor();

  // Re-click active stage -> resets to 'all'
  await stageButtons.nth(4).click();
  assert.equal(await stageButtons.nth(4).getAttribute('aria-pressed'), 'false');
  assert.equal(await candFilterSelect.inputValue(), 'all');
  assert.equal(
    await funnel.getByRole('button', { name: '收件箱（全部未忽略）', exact: true }).getAttribute('aria-pressed'),
    'true',
  );

  // Bidirectional sync from <select> -> funnel stage highlight
  await candFilterSelect.selectOption('drafts');
  assert.equal(await stageButtons.nth(3).getAttribute('aria-pressed'), 'true');
  await candFilterSelect.selectOption('all');
  assert.equal(await stageButtons.nth(3).getAttribute('aria-pressed'), 'false');

  // Toggle 已忽略
  const ignoredChip = funnel.getByRole('button', { name: '已忽略', exact: true });
  await ignoredChip.click();
  assert.equal(await ignoredChip.getAttribute('aria-pressed'), 'true');
  assert.equal(await candFilterSelect.inputValue(), 'ignored');
  await inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 已忽略候选六"]').waitFor();
  await ignoredChip.click();
  assert.equal(await candFilterSelect.inputValue(), 'all');

  // Verify compact pills & unscreened error text
  const unscreenedCard = inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 未预筛待确认候选二"]');
  assert.match((await unscreenedCard.locator('.automation-candidate-pills').innerText()).replace(/\s+/g, ' '), /未预筛.*本批读取失败/u);
  assert.equal(await inboxSection.locator('details.candidate-low').evaluate(el => el.open), false);

  // Confirm modal open/cancel focus restore + submit with organize=false (zero model calls)
  const highCard = inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 高分待确认候选一"]');
  const confirmBtn = highCard.getByRole('button', { name: '确认入库', exact: true });
  await confirmBtn.focus();
  await confirmBtn.click();
  const confirmDialog = page.locator('.candidate-dialog[role="dialog"][aria-modal="true"]');
  await confirmDialog.waitFor();
  assert.equal(await confirmDialog.locator('#candidate-confirm-title').count(), 1);
  const firstDialogInput = confirmDialog.locator('input').first();
  const firstDialogSelect = confirmDialog.locator('select').first();
  assert.equal(await firstDialogInput.getAttribute('type'), 'checkbox');
  assert.equal(await firstDialogInput.isChecked(), true);
  assert.equal(await firstDialogSelect.inputValue(), 'standard');
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();
  await confirmDialog.waitFor({ state: 'detached' });
  assert.equal(await confirmBtn.evaluate(el => document.activeElement === el), true);

  await confirmBtn.click();
  await confirmDialog.waitFor();
  await firstDialogInput.uncheck();
  const [confirmResp] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/automation/candidates/confirm') && res.request().method() === 'POST'),
    confirmDialog.getByRole('button', { name: '确认并入库', exact: true }).click(),
  ]);
  assert.equal(confirmResp.status(), 202);
  await confirmDialog.waitFor({ state: 'detached' });
  await waitFor('pending count updated after confirm', async () =>
    /待确认\s*2/.test((await subCandidates.innerText()).replace(/\s+/g, ' ')),
  );

  // Candidate card「查看运行」-> right drawer -> Escape restores focus to that「查看运行」button
  const draftCard = inboxSection.locator('article.news-candidate[aria-label="AUTOUX02 已入库待审草稿候选"]');
  const candViewRunBtn = draftCard.getByRole('button', { name: '查看运行', exact: true });
  await candViewRunBtn.focus();
  await candViewRunBtn.click();
  await drawer.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  const candRunFocusRestored = await candViewRunBtn.evaluate(el => document.activeElement === el);
  assert.equal(candRunFocusRestored, true);

  evidence.desktopChecks.push({
    item: 'A2-01_inbox_funnel',
    funnelSyncedBothWays: true,
    ignoredToggleVerified: true,
    confirmDialogOrderAndSubmitVerified: true,
    candViewRunFocusRestored: candRunFocusRestored,
  });

  // 4) A2-02: 事项提醒分类筛选、左侧 3px 语义色条、已读/延后、设置弹窗、空分类提示
  await subReminders.click();
  const remindersSection = page.locator('section[aria-labelledby="automation-reminders"]');
  await remindersSection.waitFor();

  const dueRow = remindersSection.locator(`.automation-reminder-list > li[aria-label="${work1.title}"]`);
  const rawReadyRow = remindersSection.locator(`.automation-reminder-list > li[aria-label="${work2.title}"]`);
  const staleRow = remindersSection.locator(`.automation-reminder-list > li[aria-label="${work1.title}（推进提醒）"]`);

  assert.equal(await dueRow.getAttribute('data-tone'), 'danger');
  assert.equal(await rawReadyRow.getAttribute('data-tone'), 'accent');
  assert.equal(await staleRow.getAttribute('data-tone'), 'muted');
  const dueBorderWidth = await dueRow.evaluate(el => getComputedStyle(el).borderInlineStartWidth || getComputedStyle(el).borderLeftWidth);
  assert.equal(dueBorderWidth, '3px');

  const chips = remindersSection.locator('.automation-filter-chips .automation-filter-chip');
  assert.equal(await chips.count(), 4);
  await chips.nth(1).click(); // 到期跟进
  assert.equal(await remindersSection.locator('.automation-reminder-list > li').count(), 1);
  await chips.nth(2).click(); // 久未推进
  assert.equal(await remindersSection.locator('.automation-reminder-list > li').count(), 1);
  await chips.nth(3).click(); // 新资料待分析
  assert.equal(await remindersSection.locator('.automation-reminder-list > li').count(), 1);
  await chips.nth(0).click(); // 全部
  assert.equal(await remindersSection.locator('.automation-reminder-list > li').count(), 3);

  // 已读 & 延后一天
  await dueRow.getByRole('button', { name: '已读', exact: true }).click();
  await waitFor('due reminder marked acknowledged', async () => (await dueRow.getAttribute('data-tone')) === 'muted');
  await rawReadyRow.getByRole('button', { name: '延后一天', exact: true }).click();
  await waitFor('rawReady reminder snoozed', async () => (await rawReadyRow.getAttribute('data-status')) === 'snoozed');

  // Header 提醒与通知设置 opens persisted dialog and restores focus on Escape
  const reminderHeaderBtn = remindersSection.getByRole('button', { name: '提醒与通知设置', exact: true });
  await reminderHeaderBtn.focus();
  await reminderHeaderBtn.click();
  await reminderDialog.waitFor();
  assert.equal(await reminderDialog.locator('input[type="time"]').nth(0).inputValue(), '23:00');
  assert.equal(await reminderDialog.locator('input[type="number"]').first().inputValue(), '10');
  await page.keyboard.press('Escape');
  await reminderDialog.waitFor({ state: 'detached' });
  const reminderHeaderFocusRestored = await reminderHeaderBtn.evaluate(el => document.activeElement === el);
  assert.equal(reminderHeaderFocusRestored, true);

  // Empty category check with real backend data (resolve new_raw_ready, refresh, filter, reset)
  await writeFile(remindersFile, JSON.stringify(buildRemindersState(false), null, 2));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await waitFor('new_raw_ready count reaches 0', async () =>
    /新资料待分析\s*0/.test((await chips.nth(3).innerText()).replace(/\s+/g, ' ')),
  );
  await chips.nth(3).click();
  await waitFor('empty reminder category prompt visible', async () =>
    ((await remindersSection.textContent()) ?? '').includes('当前分类暂无提醒。'),
  );
  await remindersSection.getByRole('button', { name: '显示全部提醒', exact: true }).click();
  assert.equal(await chips.nth(0).getAttribute('aria-pressed'), 'true');
  assert.equal(await remindersSection.locator('.automation-reminder-list > li').count(), 2);

  // Restore full 3 reminders for HomePage deep-link test
  await writeFile(remindersFile, JSON.stringify(buildRemindersState(true), null, 2));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await waitFor('3 reminders restored', async () => (await remindersSection.locator('.automation-reminder-list > li').count()) === 3);

  evidence.desktopChecks.push({
    item: 'A2-02_reminders',
    dueBorderWidth,
    chipsTested: 4,
    ackAndSnoozeVerified: true,
    emptyCategoryResetVerified: true,
    reminderHeaderFocusRestored,
  });

  // 5) A2-04: 运行记录主从双栏（左栏独立滚动、右栏占位/详情切换与焦点恢复）
  await runsTab.click();
  const runsLayout = page.locator('.automation-runs-layout');
  await runsLayout.waitFor();
  await page.locator('.automation-run-placeholder').waitFor();
  assert.equal(await page.locator('#automation-run-detail').count(), 0);

  const masterDetailStyles = await runsLayout.evaluate(el => {
    const scrollBox = el.querySelector('.automation-runs-scroll');
    const cols = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length;
    const scrollStyle = scrollBox ? getComputedStyle(scrollBox) : null;
    return {
      columns: cols,
      maxHeight: scrollStyle?.maxHeight ?? '',
      overflowY: scrollStyle?.overflowY ?? '',
    };
  });
  assert.equal(masterDetailStyles.columns, 2);
  assert.equal(masterDetailStyles.maxHeight, '680px');
  assert.equal(masterDetailStyles.overflowY, 'auto');

  const historySection = page.locator('section[aria-labelledby="automation-history"]');
  assert.equal(await historySection.locator('.automation-filters select').count(), 3);
  const runDetailBtn = historySection.locator('li button', { hasText: '查看详情' }).first();
  await runDetailBtn.focus();
  await runDetailBtn.click();
  await page.locator('#automation-run-detail').waitFor();
  assert.equal(await runDetailBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(await historySection.locator('li.is-selected').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');

  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('.automation-run-placeholder').waitFor();
  assert.equal(await page.locator('#automation-run-detail').count(), 0);
  const runsFocusRestored = await runDetailBtn.evaluate(el => document.activeElement === el);
  assert.equal(runsFocusRestored, true);

  evidence.desktopChecks.push({
    item: 'A2-04_master_detail',
    masterDetailStyles,
    runsFocusRestored,
  });

  // 6) 回归首页 3 条深链
  // 6a) 2026-W46 周报运行引用 -> Automation 运行记录 & 右侧详情展开
  await wfTab.click();
  const weeklyCard = page.locator('article.automation-workflow-card[aria-label="每周工作回顾草稿"]');
  await weeklyCard.getByRole('button', { name: '查看最近周报（2026-W46）', exact: true }).click();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const periodReview = page.locator('section.period-review[aria-label="周期回顾"]');
  await periodReview.waitFor();
  const runCitationBtn = periodReview.locator('.weekly-review-sources button', { hasText: '工作台系统自检记录' }).first();
  await runCitationBtn.click();
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();
  assert.equal(await runsTab.getAttribute('aria-selected'), 'true');
  await page.locator('#automation-run-detail').waitFor();
  assert.equal(await page.locator('aside.automation-drawer').count(), 0);

  // 6b) 首页「今日资讯流水线」待确认 -> 收件箱资讯候选（#news-candidate-title 聚焦 & pending）
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const pendingStageBtn = page.locator('button.home-a-stage[aria-label^="待确认"]');
  await pendingStageBtn.click();
  await inboxSection.waitFor();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await subCandidates.getAttribute('aria-selected'), 'true');
  assert.equal(await candFilterSelect.inputValue(), 'pending');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'news-candidate-title');

  // 6c) 首页工作台提醒摘要 -> 收件箱事项提醒（#automation-reminders 聚焦）
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const homeReminderBtn = page.locator('button.home-reminder-summary');
  await homeReminderBtn.click();
  await remindersSection.waitFor();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await subReminders.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-reminders');

  evidence.desktopChecks.push({ item: 'home_3_deeplinks', verified: true });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // M1: Tab 1 流程卡
  await wfTab.click();
  await newsCard.waitFor();
  evidence.mobileChecks.push(await measureOverflow('tab1-workflows'));

  // M2: 3 类设置弹窗
  await newsCard.getByRole('button', { name: '编辑计划', exact: true }).click();
  const scheduleDialog = page.locator('.schedule-dialog[role="dialog"]');
  await scheduleDialog.waitFor();
  evidence.mobileChecks.push(await measureOverflow('modal-schedule-editor'));
  await page.keyboard.press('Escape');
  await scheduleDialog.waitFor({ state: 'detached' });

  await pipelineBtnTab1.click();
  await pipelineDialog.waitFor();
  evidence.mobileChecks.push(await measureOverflow('modal-pipeline-settings'));
  await page.keyboard.press('Escape');
  await pipelineDialog.waitFor({ state: 'detached' });

  await notifyBtnTab1.click();
  await reminderDialog.waitFor();
  evidence.mobileChecks.push(await measureOverflow('modal-reminder-settings'));
  await page.keyboard.press('Escape');
  await reminderDialog.waitFor({ state: 'detached' });

  // M3: 跨 Tab 右侧滑出抽屉展开态（width <= 390）
  await lastRunBtn.click();
  await drawer.waitFor();
  const drawerRect = await drawer.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });
  assert.ok(drawerRect.width <= 390 && drawerRect.right <= 390 && drawerRect.left >= 0, 'Drawer exceeds 390px: ' + JSON.stringify(drawerRect));
  evidence.mobileChecks.push({ ...(await measureOverflow('drawer-open')), drawerRect });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });

  // M4: Tab 2 资讯 5 阶段漏斗 + 提醒过滤芯片
  await inboxTab.click();
  await subCandidates.click();
  await funnel.waitFor();
  evidence.mobileChecks.push(await measureOverflow('tab2-inbox-candidates-funnel'));

  await subReminders.click();
  await remindersSection.locator('.automation-filter-chips').waitFor();
  evidence.mobileChecks.push(await measureOverflow('tab2-inbox-reminders-chips'));

  // M5: Tab 3 主从堆叠 + 运行详情展开态
  await runsTab.click();
  await runsLayout.waitFor();
  const mobileStackedCols = await runsLayout.evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  assert.equal(mobileStackedCols, 1);
  evidence.mobileChecks.push({ ...(await measureOverflow('tab3-runs-stacked-placeholder')), mobileStackedCols });

  await historySection.locator('li button', { hasText: '查看详情' }).first().click();
  await page.locator('#automation-run-detail').waitFor();
  evidence.mobileChecks.push(await measureOverflow('tab3-runs-detail-expanded'));
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('.automation-run-placeholder').waitFor();

  // Verify zero external requests & zero model requests
  const rawExternal = (await readFile(requestLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  evidence.serverExternalRequests = rawExternal;

  for (const monthDir of await readdir(path.join(data, 'state', 'automation', 'runs'))) {
    const dirPath = path.join(data, 'state', 'automation', 'runs', monthDir);
    for (const f of await readdir(dirPath)) {
      if (!f.endsWith('.json')) continue;
      const rec = JSON.parse(await readFile(path.join(dirPath, f), 'utf8'));
      evidence.modelRequestsInRuns += Number(rec?.usage?.requests ?? 0);
    }
  }

  assert.equal(evidence.blockedBrowserExternalRequests.length, 0);
  assert.equal(evidence.serverExternalRequests.length, 0);
  assert.equal(evidence.modelRequestsInRuns, 0);
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.consoleErrors, []);
  assert.deepEqual(evidence.httpErrors, []);
  const failedMobile = evidence.mobileChecks.filter(check => check.overflow);
  assert.equal(failedMobile.length, 0, 'Mobile overflow detected: ' + JSON.stringify(failedMobile));
} finally {
  if (browser) {
    await browser.close();
    evidence.closed.browser = true;
  }
  if (ui) {
    await ui.close();
    evidence.closed.ui = true;
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await exited;
  evidence.closed.api = true;
  evidence.apiLog = apiLog;
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify(
      {
        run,
        apiPort,
        uiPort,
        browserVersion: evidence.browserVersion,
        desktopChecks: evidence.desktopChecks,
        mobileChecks: evidence.mobileChecks.map(c => ({
          page: c.page,
          innerWidth: c.innerWidth,
          scrollWidth: c.scrollWidth,
          overflow: c.overflow,
          ...(c.drawerRect ? { drawerRect: c.drawerRect } : {}),
          ...(c.mobileStackedCols ? { mobileStackedCols: c.mobileStackedCols } : {}),
        })),
        pageErrors: evidence.pageErrors,
        consoleErrors: evidence.consoleErrors,
        httpErrors: evidence.httpErrors,
        blockedBrowserExternalRequests: evidence.blockedBrowserExternalRequests,
        serverExternalRequests: evidence.serverExternalRequests,
        modelRequestsInRuns: evidence.modelRequestsInRuns,
        closed: evidence.closed,
      },
      null,
      2,
    ),
  );
}
