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
import { RawStore } from '../../services/raw/store.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';
import { NewsRawSave } from '../../services/news/raw-save.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'autoux01-review-'));
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
    'FMCG_LLM_BASE_URL=https://autoux01-fake.invalid/v1',
    'FMCG_LLM_MODEL=autoux01-synthetic-model',
    'FMCG_LLM_API_KEY=autoux01-synthetic-key-only',
  ].join('\n') + '\n',
);

await writeFile(
  preloadFile,
  `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.AUTOUX01_REQUEST_LOG;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  throw new Error('Blocked unexpected external request in AUTOUX01 isolation: ' + url.href);
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
  title: 'AUTOUX01 渠道动销测试原料',
  body: '华东便利店与量贩零食渠道复购观察原始记录，用于隔离浏览器端到端验收。',
  tags: ['渠道'],
  sourceType: 'report',
  sourceName: '合成测试研报',
});

const wiki1 = await wikiStore.create({
  title: 'AUTOUX01 渠道动销概念页',
  type: 'concept',
  category: 'channel',
  body: '## 定义\n用于验证主动检查与知识库跳转的合成概念页。',
  sources: [raw1.id],
  aliases: ['AUTOUX01 概念'],
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

// Seed Work Reminders (2 unread, 3 active; includes new_raw_ready + stale_item for HomePage summary link).
const rem1Id = randomUUID();
const rem2Id = randomUUID();
const rem3Id = randomUUID();
await writeFile(
  path.join(data, 'state', 'automation', 'reminders.json'),
  JSON.stringify(
    {
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
    },
    null,
    2,
  ),
);

// Seed candidate-backed saved raw + pending draft + failed candidate.
const draftCandItem = {
  id: 'autoux01-cand-draft',
  title: 'AUTOUX01 已入库待审草稿候选',
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: 'https://example.invalid/autoux01/cand-draft',
  publishedAt: published,
  fetchedAt: stamp,
  excerpt: '已入库并生成待审草稿的候选条目。',
  evidenceKind: 'article_excerpt',
};
const failCandItem = {
  id: 'autoux01-cand-fail',
  title: 'AUTOUX01 整理失败候选示例',
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: 'https://example.invalid/autoux01/cand-fail',
  publishedAt: published,
  fetchedAt: stamp,
  excerpt: '已保存 Raw 但整理失败的候选条目。',
  evidenceKind: 'article_excerpt',
};

const newsRawSave = new NewsRawSave(data, rawStore, () => now);
const savedDraftCand = await newsRawSave.save(today, 'fmcg', draftCandItem, randomUUID());
const savedFailCand = await newsRawSave.save(today, 'fmcg', failCandItem, randomUUID());
const rawDraftCand = await rawStore.get(savedDraftCand.rawId);
assert.ok(rawDraftCand);

const draftPendingId = randomUUID();
const draftJobId = randomUUID();
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
      provider: { name: 'synthetic', model: 'autoux01-test' },
      jobId: draftJobId,
      document: { title: 'AUTOUX01 待审资讯草稿', main_topic: '渠道', summary: '草稿摘要' },
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
          title: 'AUTOUX01 资讯草稿概念页',
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

// Seed Automation Runs across tasks.
const selfcheckRunId = randomUUID();
const candRunId = randomUUID();
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
const runT1End = new Date(+now - 115_000).toISOString();
const runT2 = new Date(+now - 90_000).toISOString();
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
  steps: [{ name: '工作区目录与存储自检', status: 'succeeded', startedAt: runT1, endedAt: runT1End, durationMs: 12, summary: '5 项检查全部通过' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [] },
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
  sourceRequests: 1,
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
  steps: [{ name: '保存 Raw 与整理草稿', status: 'succeeded', startedAt: runT2, endedAt: runT2End, durationMs: 18, summary: '已生成待审草稿' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [rawDraftCand.id], jobIds: [draftJobId], draftIds: [draftPendingId] },
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
  steps: [{ name: 'AI 整理', status: 'failed', startedAt: oldStamp, endedAt: oldRunEnd, durationMs: 25, summary: '整理异常', error: '合成整理失败测试' }],
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
  fingerprint: sha256Hex(`autoux01-lint-${suffix}`),
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
          fingerprint: sha256Hex('autoux01-inspect-finding-0'),
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

// Seed Weekly Review archive (2026-W46 with `run` reference) + settings.
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

// Seed News Edition & Candidates (3 pending including 1 low-score + 1 draft_ready + 1 organize_failed).
const makeNewsItem = (itemId, title, excerpt) => ({
  id: itemId,
  title,
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: `https://example.invalid/autoux01/${itemId}`,
  publishedAt: published,
  fetchedAt: stamp,
  excerpt,
  evidenceKind: 'article_excerpt',
});

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
          items: [makeNewsItem('autoux01-news-1', 'AUTOUX01 快消渠道测试快讯', '防止首页主动发外网抓取请求的本地快讯。')],
          sources: [],
        },
        ai: {
          status: 'source_only',
          attempt: 1,
          startedAt: stamp,
          finishedAt: stamp,
          items: [makeNewsItem('autoux01-ai-1', 'AUTOUX01 AI 前沿本地条目', '隔离测试 AI 条目。')],
          sources: [],
        },
      },
    },
    null,
    2,
  ),
);

await writeFile(
  path.join(data, 'state', 'automation', 'news-candidates', `${today}.json`),
  JSON.stringify(
    {
      schemaVersion: 1,
      date: today,
      items: [
        {
          id: `${today}/fmcg/autoux01-cand-high`,
          section: 'fmcg',
          disposition: 'inbox',
          item: makeNewsItem('autoux01-cand-high', 'AUTOUX01 高分可确认候选一', '量贩折扣店复购分析。'),
          screening: {
            score: {
              candidateId: `${today}/fmcg/autoux01-cand-high`,
              relevance: 3,
              categories: ['渠道'],
              reason: '高度相关',
              suggestedMode: 'standard',
            },
          },
        },
        {
          id: `${today}/ai/autoux01-cand-mid`,
          section: 'ai',
          disposition: 'inbox',
          item: makeNewsItem('autoux01-cand-mid', 'AUTOUX01 中分可确认候选二', 'AI 商品需求预测洞察。'),
          screening: {
            score: {
              candidateId: `${today}/ai/autoux01-cand-mid`,
              relevance: 2,
              categories: ['AI 工具与方法'],
              reason: '中等相关',
              suggestedMode: 'standard',
            },
          },
        },
        {
          id: `${today}/fmcg/autoux01-cand-low`,
          section: 'fmcg',
          disposition: 'inbox',
          item: makeNewsItem('autoux01-cand-low', 'AUTOUX01 低分折叠候选三', '相关性较低，默认折叠。'),
          screening: {
            score: {
              candidateId: `${today}/fmcg/autoux01-cand-low`,
              relevance: 0,
              categories: ['其他'],
              reason: '边缘相关',
              suggestedMode: 'standard',
            },
          },
        },
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
      ],
    },
    null,
    2,
  ),
);

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
  AUTOUX01_REQUEST_LOG: requestLog,
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

  // 1) Enter 自动化 -> default tab 流程与计划, compact banner, process info fold, pause/resume confirmation
  await navClick('自动化');
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();

  const wfTab = page.locator('#automation-tab-workflows');
  const inboxTab = page.locator('#automation-tab-inbox');
  const runsTab = page.locator('#automation-tab-runs');
  const banner = page.locator('section.automation-banner');

  await waitFor('workflows & counts loaded', async () => {
    const cards = await page.locator('.automation-workflow-card').count();
    const badge = (await inboxTab.locator('.automation-tab-badge').textContent().catch(() => ''))?.trim();
    return cards === 5 && badge === '5';
  });

  assert.equal(await wfTab.getAttribute('aria-selected'), 'true');
  assert.equal(await banner.getAttribute('data-tone'), 'ok');
  const bannerFactCount = await banner.locator('.automation-facts > div').count();
  assert.equal(bannerFactCount, 3);
  const bannerText = (await banner.innerText()).replace(/\s+/g, ' ');
  assert.match(bannerText, /任务可触发 · 调度器正常/);
  assert.match(bannerText, /最近 24 小时失败\s*0 次/);
  assert.match(bannerText, /当前待处理\s*5 项/);
  const dotSize = await banner.locator('.automation-dot').evaluate(el => {
    const st = getComputedStyle(el);
    return { width: st.width, height: st.height, bg: st.backgroundColor };
  });
  assert.equal(dotSize.width, '9px');
  assert.equal(dotSize.height, '9px');

  const processInfo = banner.locator('details.automation-process-info');
  assert.equal(await processInfo.evaluate(el => el.open), false);
  await processInfo.locator('summary').click();
  assert.equal(await processInfo.evaluate(el => el.open), true);
  assert.match((await processInfo.innerText()).replace(/\s+/g, ' '), /PID \d+ · 端口 \d+/);
  await processInfo.locator('summary').click();
  assert.equal(await processInfo.evaluate(el => el.open), false);

  // Pause & Resume 2-step confirmation loop
  await banner.getByRole('button', { name: '暂停全部自动化', exact: true }).click();
  await banner.locator('.automation-confirm').waitFor();
  await banner.getByRole('button', { name: '确认暂停', exact: true }).click();
  await waitFor('banner warning tone after pause', async () => (await banner.getAttribute('data-tone')) === 'warning');
  assert.match((await banner.innerText()).replace(/\s+/g, ' '), /全局暂停/);

  await banner.getByRole('button', { name: '恢复全部自动化', exact: true }).click();
  await banner.locator('.automation-confirm').waitFor();
  await banner.getByRole('button', { name: '确认恢复', exact: true }).click();
  await waitFor('banner ok tone after resume', async () => (await banner.getAttribute('data-tone')) === 'ok');
  assert.match((await banner.innerText()).replace(/\s+/g, ' '), /任务可触发/);

  evidence.desktopChecks.push({
    item: 'A1-01_banner',
    bannerFactCount,
    dotSize,
    processInfoToggled: true,
    pauseResumeToneVerified: true,
  });

  // 2) Tab badge & keyboard navigation (ArrowRight/ArrowLeft/Home/End)
  assert.equal((await inboxTab.locator('.automation-tab-badge').innerText()).trim(), '5');
  await wfTab.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-tab-inbox');
  await page.keyboard.press('End');
  assert.equal(await runsTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-tab-runs');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await wfTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-tab-workflows');

  // 3) 5 workflow cards with 3-step flow strip + no standalone #automation-knowledge-health
  assert.equal(await page.locator('#automation-knowledge-health').count(), 0);
  const cardLabels = [
    '每日资讯准备与预筛',
    '知识库定时巡检',
    '工作事项到期与新资料提醒',
    '每周工作回顾草稿',
    '工作台自检',
  ];
  const cardStepCounts = {};
  for (const label of cardLabels) {
    const loc = page.locator(`article.automation-workflow-card[aria-label="${label}"]`);
    await loc.waitFor();
    cardStepCounts[label] = await loc.locator('.automation-flow-step').count();
    assert.equal(cardStepCounts[label], 3, `${label} must render 3 flow steps`);
  }

  // 4) Click News Card step ② 人工确认入库 -> inbox pending filter + select-all + low-score fold
  const newsCard = page.locator('article.automation-workflow-card[aria-label="每日资讯准备与预筛"]');
  await newsCard.locator('button.automation-flow-step', { hasText: '② 人工确认入库' }).click();
  await page.locator('#news-candidates').waitFor();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'news-candidate-title');
  const inboxSection = page.locator('#news-candidates');
  const candFilterSelect = inboxSection.locator('.automation-filters select').nth(1);
  assert.equal(await candFilterSelect.inputValue(), 'pending');

  // Select-all confirmable & low-score fold interaction
  const selectAll2 = inboxSection.getByRole('button', { name: '全选可确认项（2 条）', exact: true });
  await selectAll2.waitFor();
  await selectAll2.click();
  await inboxSection.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).waitFor();
  assert.equal(await inboxSection.getByLabel('选择 AUTOUX01 高分可确认候选一', { exact: true }).isChecked(), true);
  assert.equal(await inboxSection.getByLabel('选择 AUTOUX01 中分可确认候选二', { exact: true }).isChecked(), true);

  const lowDetails = inboxSection.locator('details.candidate-low');
  await lowDetails.locator('xpath=./summary').click();
  await waitFor('low-score expanded', () => lowDetails.evaluate(el => el.open));
  await inboxSection.getByRole('button', { name: '全选可确认项（3 条）', exact: true }).click();
  await inboxSection.getByRole('button', { name: '批量确认入库（3 条）', exact: true }).waitFor();
  assert.equal(await inboxSection.getByLabel('选择 AUTOUX01 低分折叠候选三', { exact: true }).isChecked(), true);

  await lowDetails.locator('xpath=./summary').click();
  await waitFor('low-score collapsed', async () => !(await lowDetails.evaluate(el => el.open)));
  await inboxSection.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).waitFor();
  await inboxSection.getByRole('button', { name: '取消全选', exact: true }).click();
  assert.equal(await inboxSection.locator('button', { hasText: '批量确认入库' }).count(), 0);

  // 5) Return to 流程与计划: Knowledge health dual-track jump + Work reminders step ③ jump
  await wfTab.click();
  const healthCard = page.locator('article.automation-workflow-card[aria-label="知识库定时巡检"]');
  await healthCard.waitFor();
  assert.match((await healthCard.innerText()).replace(/\s+/g, ' '), /结构新增 2 · 主动待核 1/);

  await healthCard.getByRole('button', { name: '查看结构检查', exact: true }).click();
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '结构检查（Lint）', exact: true }).getAttribute('aria-selected'), 'true');

  await navClick('自动化');
  await healthCard.waitFor();
  await healthCard.getByRole('button', { name: '查看主动检查', exact: true }).click();
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '主动知识检查', exact: true }).getAttribute('aria-selected'), 'true');

  await navClick('自动化');
  const remindersCard = page.locator('article.automation-workflow-card[aria-label="工作事项到期与新资料提醒"]');
  await remindersCard.waitFor();
  await remindersCard.locator('button.automation-flow-step', { hasText: '③ 事项提醒列表' }).click();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-reminders');
  assert.match((await page.locator('section[aria-labelledby="automation-reminders"]').innerText()).replace(/\s+/g, ' '), /2 条未读/);

  // 6) Weekly review AI summary toggle persistence across page reload + open latest weekly review on HomePage
  await wfTab.click();
  const weeklyCard = page.locator('article.automation-workflow-card[aria-label="每周工作回顾草稿"]');
  await weeklyCard.waitFor();
  const weeklyCheckbox = weeklyCard.getByLabel('启用自动 AI 周报总结', { exact: true });
  await waitFor('weekly checkbox enabled', async () => !(await weeklyCheckbox.isDisabled()));
  assert.equal(await weeklyCheckbox.isChecked(), true);

  const [patchOffResp] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes('/api/automation/weekly-reviews/settings') && res.request().method() === 'PATCH',
    ),
    weeklyCheckbox.click(),
  ]);
  assert.equal(patchOffResp.status(), 200);
  await waitFor('weekly checkbox unchecked', async () => !(await weeklyCheckbox.isChecked()));
  assert.match((await weeklyCard.innerText()).replace(/\s+/g, ' '), /已关闭：周报任务仅保存确定性事实快照/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await navClick('自动化');
  await weeklyCard.waitFor();
  await waitFor('weekly checkbox persisted false after reload', async () => {
    const disabled = await weeklyCheckbox.isDisabled();
    const checked = await weeklyCheckbox.isChecked();
    return !disabled && checked === false;
  });

  // Restore to true and open latest weekly review (2026-W46)
  const [patchOnResp] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes('/api/automation/weekly-reviews/settings') && res.request().method() === 'PATCH',
    ),
    weeklyCheckbox.click(),
  ]);
  assert.equal(patchOnResp.status(), 200);
  await waitFor('weekly checkbox restored true', async () => await weeklyCheckbox.isChecked());

  await weeklyCard.getByRole('button', { name: '查看最近周报（2026-W46）', exact: true }).click();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const periodReview = page.locator('section.period-review[aria-label="周期回顾"]');
  await periodReview.waitFor();
  assert.equal(await periodReview.locator('#period-review-tab-weekly').getAttribute('aria-selected'), 'true');
  await periodReview.getByRole('heading', { name: '2026-W46 周报', exact: true }).waitFor();

  // 7) Deep links from HomePage (3 routes):
  // 7a) From 2026-W46 AI weekly review draft -> click run citation -> Automation 运行记录 tab & #automation-run-detail expanded
  const runCitationBtn = periodReview.locator('.weekly-review-sources button', { hasText: '工作台系统自检记录' }).first();
  await runCitationBtn.waitFor();
  await runCitationBtn.click();
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();
  assert.equal(await runsTab.getAttribute('aria-selected'), 'true');
  await page.locator('#automation-run-detail').waitFor();
  assert.match((await page.locator('section[aria-labelledby="automation-run-detail"]').innerText()).replace(/\s+/g, ' '), /工作台自检/);

  // 7b) From HomePage -> click 今日资讯流水线 stage 待确认 -> Automation 收件箱 pending filter
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const pendingStageBtn = page.locator('button.home-a-stage[aria-label^="待确认"]');
  await pendingStageBtn.waitFor();
  await pendingStageBtn.click();
  await page.locator('#news-candidates').waitFor();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await candFilterSelect.inputValue(), 'pending');

  // 7c) From HomePage -> click 工作台提醒摘要 -> Automation 收件箱 & focus #automation-reminders
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const homeReminderBtn = page.locator('button.home-reminder-summary');
  await homeReminderBtn.waitFor();
  await homeReminderBtn.click();
  await page.locator('#automation-reminders').waitFor();
  assert.equal(await inboxTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-reminders');

  // 8) 运行记录 Tab: filter by status, open & close detail and verify focus restore
  await runsTab.click();
  const historySection = page.locator('section[aria-labelledby="automation-history"]');
  await historySection.locator('li button', { hasText: '查看详情' }).first().waitFor();
  const allRunsCount = await historySection.locator('ul.automation-list > li').count();
  assert.ok(allRunsCount >= 5, `Expected >= 5 runs, got ${allRunsCount}`);

  const runStatusSelect = historySection.locator('.automation-filters select').nth(1);
  await runStatusSelect.selectOption('failed');
  await waitFor('filtered failed runs', async () => {
    const items = await historySection.locator('ul.automation-list > li').count();
    return items === 2;
  });
  await runStatusSelect.selectOption('');
  await waitFor('restored all runs', async () => {
    const items = await historySection.locator('ul.automation-list > li').count();
    return items === allRunsCount;
  });

  const firstDetailBtn = historySection.locator('li button', { hasText: '查看详情' }).first();
  await firstDetailBtn.focus();
  await firstDetailBtn.click();
  await page.locator('#automation-run-detail').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('#automation-run-detail').waitFor({ state: 'detached' });
  const focusRestoredOnRuns = await firstDetailBtn.evaluate(el => document.activeElement === el);
  assert.equal(focusRestoredOnRuns, true);

  evidence.desktopChecks.push({
    item: 'A1-02_A1-03_A1-04_deeplinks',
    tabKeyboardNavVerified: true,
    cardStepCounts,
    knowledgeHealthMergedAndJumped: true,
    weeklyAiPersistenceAfterReload: true,
    weeklyReviewAutoExpandedOnHome: '2026-W46',
    threeHomeDeepLinksVerified: true,
    runsFilterAndFocusRestoreVerified: { allRunsCount, failedFilteredCount: 2, focusRestoredOnRuns },
  });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // M1: 流程与计划 (banner + 3-Tab + 5 cards with vertically stacked flow strips & hidden arrows)
  await wfTab.click();
  await newsCard.waitFor();
  const mobileFlowLayout = await newsCard.evaluate(el => {
    const strip = el.querySelector('.automation-flow-strip');
    const arrow = el.querySelector('.automation-flow-arrow');
    return {
      stripFlexDirection: strip ? getComputedStyle(strip).flexDirection : '',
      arrowDisplay: arrow ? getComputedStyle(arrow).display : '',
    };
  });
  assert.equal(mobileFlowLayout.stripFlexDirection, 'column');
  assert.equal(mobileFlowLayout.arrowDisplay, 'none');
  evidence.mobileChecks.push({ ...(await measureOverflow('automation-workflows-tab')), ...mobileFlowLayout });

  // M2: Schedule editor dialog open
  await newsCard.getByRole('button', { name: '编辑计划', exact: true }).click();
  const scheduleDialog = page.locator('.schedule-dialog[role="dialog"]');
  await scheduleDialog.waitFor();
  evidence.mobileChecks.push(await measureOverflow('automation-schedule-editor-dialog'));
  await scheduleDialog.getByRole('button', { name: '取消编辑', exact: true }).click();
  await scheduleDialog.waitFor({ state: 'detached' });

  // M3: 待处理收件箱 (reminders + news candidates + select-all + expanded low-score)
  await inboxTab.click();
  await inboxSection.waitFor();
  await candFilterSelect.selectOption('pending');
  await inboxSection.getByRole('button', { name: '全选可确认项（2 条）', exact: true }).click();
  await inboxSection.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('automation-inbox-tab'));

  // M4: 运行记录
  await runsTab.click();
  await historySection.locator('li button', { hasText: '查看详情' }).first().waitFor();
  evidence.mobileChecks.push(await measureOverflow('automation-runs-tab'));

  // M5: 运行详情展开
  await historySection.locator('li button', { hasText: '查看详情' }).first().click();
  await page.locator('#automation-run-detail').waitFor();
  evidence.mobileChecks.push(await measureOverflow('automation-run-detail-open'));
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('#automation-run-detail').waitFor({ state: 'detached' });

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
          ...(c.stripFlexDirection ? { stripFlexDirection: c.stripFlexDirection, arrowDisplay: c.arrowDisplay } : {}),
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
