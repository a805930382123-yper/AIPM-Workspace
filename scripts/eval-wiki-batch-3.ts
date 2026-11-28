import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeAnswerService } from '../services/llm/knowledge-answers.ts';
import { MAINTENANCE_LIMITS, retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { RawStore } from '../services/raw/store.ts';
import { quoteInWikiContext, rankWikiChunks, type ModelWikiContext } from '../services/search/fts-retriever.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';
import { parseWikiMarkdown, WikiStore, type WikiRecord } from '../services/wiki/store.ts';

// The supplemental fixtures in LLMWIKI-3-3 stay outside the frozen 25-question corpus.
const cases = [
  {
    id: 'F1',
    question: '青禾仓发生主路限流时，备用接管标记是什么？',
    title: '青禾仓发生主路限流时的备用接管标记',
    quote: '青禾仓备用接管标记为青签七号',
  },
  {
    id: 'F2',
    question: '海盐计划跨模型续跑时，已验证的块如何处理？',
    title: '海盐计划跨模型续跑时已验证的块如何处理',
    quote: '海盐计划沿用已验证块，仅补未完成块',
  },
  {
    id: 'F3',
    question: '赤豆仓离线时还能导出哪种格式？',
    title: '赤豆仓离线时还能导出哪种格式',
    quote: '赤豆仓离线导出格式为 Markdown',
  },
  {
    id: 'F4',
    question: '白梨库复核抽屉里显示的备用成功标记是什么？',
    title: '白梨库复核抽屉里显示的备用成功标记',
    quote: '白梨库备用成功标记为梨灯四号',
  },
  {
    id: 'F5',
    question: '黑榛站内部调拨批准暗号是什么？',
    title: '黑榛站内部调拨批准暗号',
    quote: '黑榛站内部调拨批准暗号为榛封九号',
  },
];
const rawId = 'a1330000-0000-4000-8000-000000000090';
const conflict = '白梨库备用成功标记为梨灯九号';
const date = '2026-11-28';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-33-supplement-'));
for (const key of Object.keys(process.env)) {
  if (/^(FMCG_LLM_|EMBEDDING_)/iu.test(key)) delete process.env[key];
}
process.env.FMCG_DATA_DIR = root;
process.env.FMCG_LLM_CONFIG_FILE = path.join(root, 'nonexistent.env');
process.env.SEARCH_ENGINE = 'sqlite_fts';
process.env.SEARCH_WIKI_ONE_HOP = '1';
let externalCalls = 0;
globalThis.fetch = async () => {
  externalCalls++;
  throw new Error('Supplemental retrieval must stay offline');
};

const raws = new RawStore(root);
const index = new WikiSearchIndexer(root);
const wiki = new WikiStore(root, raws, undefined, index);
try {
  await raws.initialize();
  const rawBody = 'Batch 3 合成的受限会议来源。';
  await raws.createMeetingRegistration({
    id: rawId,
    title: 'Batch 3 合成会议',
    sourceName: '合成数据',
    tags: [],
    body: rawBody,
    importedAt: date + 'T00:00:00.000Z',
    origin: {
      kind: 'meeting',
      meeting_id: 'a1330000-0000-4000-8000-000000000091',
      import_id: 'a1330000-0000-4000-8000-000000000092',
      original_sha256: sha(rawBody),
      registered_confidentiality: 'Restricted',
      processing_policy: 'meeting_local_only',
    },
  });
  const inputs = [...cases, { id: 'F4-conflict', title: cases[3].title, quote: conflict }];
  const pages = new Map<string, WikiRecord>();
  for (const [i, input] of inputs.entries()) {
    const page: WikiRecord = {
      id: 'a1330000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      title: input.title,
      body: '## 记录\n\n🧾 ' + input.quote + '。\n',
      type: 'concept',
      domain: 'fmcg',
      category: 'channel',
      sources: input.id === 'F5' || input.id === 'F4-conflict' ? [rawId] : [],
      tags: ['批次三合成数据'],
      aliases: [],
      knowledge_status: 'verified',
      confidence: 'high',
      source_level: 'D',
      review_status: 'unreviewed',
      revision: 1,
      created: date,
      updated: date,
    };
    const markdown = wiki.pageContent(page);
    await writeFile(path.join(root, 'knowledge', 'wiki', page.id + '.md'), markdown);
    pages.set(input.id, parseWikiMarkdown(markdown));
  }
  assert(await index.reconcileOnStartup());
  for (const id of ['F4-conflict', 'F5']) {
    await assert.rejects(assertWikiSourcesAllowed(wiki, raws, pages.get(id)!), { code: 'MEETING_SOURCE_RESTRICTED' });
  }
  const drafts = new DraftStore(root);
  const requests: Array<{ wiki: ModelWikiContext; availableRawIds: string[]; rawFragments: unknown[] }> = [];
  const provider: LlmProvider = {
    name: 'in-process',
    model: 'capture-only',
    async complete({ user }) {
      requests.push(JSON.parse(user) as (typeof requests)[number]);
      const text = JSON.stringify({
        version: 1,
        sections: [{ kind: 'insufficient', text: '离线采集结果，答复不计分。', citationIds: [] }],
        citations: [],
        needsRaw: [],
      });
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    },
  };
  const answers = new KnowledgeAnswerService({ root, wiki, raws, drafts, provider: () => provider });
  const offlineAnswers = new KnowledgeAnswerService({ root, wiki, raws, drafts, provider: () => undefined });
  await answers.initialize();
  const rows = [];
  for (const { id, question, quote } of cases) {
    const page = pages.get(id)!;
    const start = page.body.indexOf(quote);
    assert(start >= 0);
    const end = start + quote.length;
    const tags = question.split(/[\s，。？?、；:：]+/u).filter((tag) => tag.length >= 2);
    const queries = [{ title: question, content: question, tags }];
    const scope = { includeSources: true };
    const blocked = id === 'F4' ? pages.get('F4-conflict') : id === 'F5' ? page : undefined;
    const blockedWasCandidate =
      !!blocked && rankWikiChunks(index, queries, scope).some(({ chunk }) => chunk.pageId === blocked.id);
    requests.length = 0;
    const offline = id === 'F3';
    if (offline) {
      await assert.rejects(offlineAnswers.ask({ requestId: randomUUID(), question }), { code: 'LLM_NOT_CONFIGURED' });
    }
    const began = performance.now();
    const answer = offline ? undefined : await answers.ask({ requestId: randomUUID(), question });
    const retrieval = offline
      ? await retrieveKnowledgeContextDetailed(wiki, raws, queries, scope)
      : answer?.wikiRetrieval;
    const elapsedMs = performance.now() - began;
    assert(retrieval?.engine === 'sqlite_fts' && !retrieval.degraded, id);
    if (answer) assert.equal(answer.status, 'insufficient', id);
    assert.equal(requests.length, offline || retrieval.context.length === 0 ? 0 : 1, id);
    const sent = requests[0];
    if (sent) assert.deepEqual(sent.wiki, retrieval.context, id);
    const context = sent?.wiki ?? retrieval.context;
    assert(context.length <= MAINTENANCE_LIMITS.pages);
    const wire = JSON.stringify({ sent, context, citations: answer?.citations });
    const hit = quoteInWikiContext(context, page.id, start, end, quote);
    const withheld =
      !blocked ||
      (blockedWasCandidate &&
        !wire.includes(blocked.id) &&
        !wire.includes(rawId) &&
        !wire.includes(id === 'F4' ? '梨灯九号' : '榛封九号'));
    rows.push({
      id,
      question,
      engine: retrieval.engine,
      anchor: { pageId: page.id, start, end, sha256: sha(quote) },
      contextPageIds: context.map(({ id }) => id),
      sentPageIds: sent?.wiki.map(({ id }) => id) ?? [],
      contextSha256: sha(JSON.stringify(context)),
      hit,
      falseRecall: id === 'F5' && context.length > 0,
      blockedPageId: blocked?.id,
      blockedWasCandidate,
      withheld,
      answerStatus: offline ? 'LLM_NOT_CONFIGURED' : answer?.status,
      citations: answer?.citations.length ?? 0,
      inProcessCalls: requests.length,
      elapsedMs,
      pass: withheld && (id === 'F5' ? !hit : hit),
    });
  }
  console.log(JSON.stringify({ externalCalls, rows }, null, 2));
  if (externalCalls > 0 || rows.some(({ pass }) => !pass)) process.exitCode = 1;
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
