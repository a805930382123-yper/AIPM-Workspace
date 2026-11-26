import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { KnowledgeAnswerService, answerText } from '../services/llm/knowledge-answers.ts';
import { KnowledgeInspectionService } from '../services/llm/knowledge-inspections.ts';
import { retrieveKnowledgeContext, retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { quoteInWikiContext } from '../services/search/fts-retriever.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { tokenizeForFts } from '../services/search/tokenizer.ts';
import type { WikiInput } from '../services/wiki/store.ts';
import { lwFixture } from './lw01-fixture.ts';

const query = (title: string) => [{ title, content: '', tags: [] }];
const bodyInput = (title: string, body: string): WikiInput => ({
  title,
  body,
  type: 'concept',
  category: 'channel',
  sources: [],
  tags: [],
  aliases: [],
  knowledge_status: 'ai_organized',
  confidence: 'medium',
  source_level: 'D',
  review_status: 'unreviewed',
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-1a3-runtime-'));
  const index = new WikiSearchIndexer(root);
  t.after(async () => {
    await index.close();
    await rm(root, { recursive: true, force: true });
  });
  const f = await lwFixture(root, index);
  const retrieve = (title: string) => retrieveKnowledgeContextDetailed(f.wiki, f.rawStore, query(title));
  return { ...f, index, retrieve };
}

const reply = (value: unknown) => {
  const text = JSON.stringify(value);
  return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' as const };
};

test('Chinese and mixed queries are safe, rerank aliases, retain short terms and find colloquial synonyms', async (t) => {
  const f = await fixture(t);
  const page = await f.wiki.create({
    ...bodyInput('终端记录', '## 来源事实\n\n动销加强后门店补货增加，毛利为20%。'),
    aliases: ['华东口径'],
  });
  await f.wiki.create(bodyInput('泛词例子', '门店的资料需要整理。'));
  assert.deepEqual(tokenizeForFts('的 了 动销 铺货 毛利 货 店 价 促 B2B SELL-OUT SKU GMV ROI POS KA'), [
    '动销',
    '铺货',
    '毛利',
    '货',
    '店',
    '价',
    '促',
    'b2b',
    'sell-out',
    'sell',
    'out',
    'sku',
    'gmv',
    'roi',
    'pos',
    'ka',
  ]);
  for (const title of ['门店怎么把货卖出去', 'KA-2026 "毛利" (华东) * OR NOT : ^', '华东口径']) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts');
    assert.equal(result.degraded, true);
    assert.equal(result.degradeReason, 'embedding_unconfigured');
    assert.equal(result.chunks[0].pageId, page.id);
  }
  for (const title of ['', '* - : ^ ()？', '请问门店情况如何？']) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, title === '请问门店情况如何？' ? 'sqlite_fts' : 'hybrid');
    assert.deepEqual(result.chunks, [], title);
  }
});

test('standalone questions need specific coverage but can retain evidence when some modifiers are absent', async (t) => {
  const f = await fixture(t);
  const quote = '经销商返利结算按季度核对回款记录，确认后下月抵扣货款。';
  const page = await f.wiki.create(bodyInput('经销商返利结算', '## 来源事实\n\n' + quote));
  const examples = [
    { title: '经销商返利结算可以申请线上免息贷款或者跨境保函吗？', expected: false },
    { title: '经销商返利结算核对回款记录后何时抵扣货款，能走加急通道吗？', expected: true },
  ];
  for (const { title, expected } of examples) {
    // The answer service passes the question as both title and content.
    const result = await retrieveKnowledgeContextDetailed(
      f.wiki,
      f.rawStore,
      [{ title, content: title, tags: title.split(/[，？]/u).filter(Boolean) }],
      { includeSources: true },
    );
    assert.equal(result.engine, 'sqlite_fts');
    if (!expected) assert.deepEqual(result.context, [], title);
    else
      assert(
        result.chunks.some((chunk) => chunk.pageId === page.id && chunk.rawText.includes(quote)),
        title,
      );
  }
});

test('store size and operating hours paraphrases retrieve original evidence for the requested storefront', async (t) => {
  const f = await fixture(t);
  const discountArea = '单店营业面积在 280–340㎡。';
  const discountHours = '每天 08:30 到 21:00 营业。';
  const memberArea = '门店占地约 5200 平方米。';
  const memberHours = '每天营业十六小时。';
  const freshHours = '营业时间为 07:15 至 20:30。';
  const discount = await f.wiki.create(
    bodyInput('折扣店经营口径', ['## 经营规模', discountArea, '## 开店安排', discountHours].join('\n\n')),
  );
  const member = await f.wiki.create(
    bodyInput('仓储会员店', ['## 经营规模', memberArea, '## 开店安排', memberHours].join('\n\n')),
  );
  const fresh = await f.wiki.create(bodyInput('社区生鲜店运营记录', '## 开店安排\n\n' + freshHours));
  await f.wiki.create(
    bodyInput('折扣店物流规范', '## 配送\n\n货架投影面积 2 平方米。营业商品在 10 小时内送到，司机本人验收交接单。'),
  );
  const examples = [
    { title: '折扣超市一般占地多少？', page: discount, heading: '经营规模', quote: discountArea },
    { title: '折扣店从几点到几点营业？', page: discount, heading: '开店安排', quote: discountHours },
    { title: '会员制超市店面有多大？', page: member, heading: '经营规模', quote: memberArea },
    { title: '仓储会员店每天开几个小时？', page: member, heading: '开店安排', quote: memberHours },
    { title: '请问社区生鲜店几点关门？', page: fresh, heading: '开店安排', quote: freshHours },
  ];
  for (const { title, page, heading, quote } of examples) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts', title);
    assert.deepEqual(
      result.chunks.map(({ pageId, headingPath }) => [pageId, headingPath]),
      [[page.id, heading]],
      title,
    );
    const start = page.body.indexOf(quote);
    assert(quoteInWikiContext(result.context, page.id, start, start + quote.length, quote), title);
  }

  const title = '折扣店店面多大和每天营业多久？';
  const both = await retrieveKnowledgeContextDetailed(
    f.wiki,
    f.rawStore,
    [{ title, content: title, tags: ['折扣店店面多大', '每天营业多久'] }],
    { includeSources: true },
  );
  assert.equal(both.engine, 'sqlite_fts');
  assert.deepEqual(
    both.context.map(({ id }) => id),
    [discount.id],
  );
  for (const quote of [discountArea, discountHours]) {
    const start = discount.body.indexOf(quote);
    assert(quoteInWikiContext(both.context, discount.id, start, start + quote.length, quote));
  }
});

test('store fact evidence excludes another storefront, unrelated units and delivery obligations', async (t) => {
  const f = await fixture(t);
  await f.wiki.create(
    bodyInput(
      '药店经营资料',
      '## 配送\n\n货架占用面积约 2 平方米，店面到配送站距离为 6 公里。登记的营业面积单位误为 6 平方公里。营业商品承诺 24 小时内送达，签收交由司机。',
    ),
  );
  await f.wiki.create(bodyInput('咖啡店', '## 开店安排\n\n店面占地 150 平方米，每天 8 点开门。'));
  await f.wiki.create(
    bodyInput(
      '商业街巡查记录',
      '## 门店\n\n甲商铺的营业面积 850 平米，营业时间为 09:00 至 21:00。药店的清洁用品已经送到。',
    ),
  );
  for (const title of [
    '药店通常多大？',
    '药店每天营业多久？',
    '药店半夜冷链配送必须实名出示身份证并由本人验收吗？',
    '药店营业结束后送出的处方药，必须由下单人本人持证验收吗？',
  ]) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts', title);
    assert.deepEqual(result.context, [], title);
  }
});

test('store evidence follows the subject of each fact before inheriting the page title', async (t) => {
  const f = await fixture(t);
  await f.wiki.create(bodyInput('药店巡检', '隔壁咖啡店营业面积为 120 平方米，每天营业十小时。'));
  await f.wiki.create(bodyInput('药店资料', '货架占地 2 平方米。'));
  await f.wiki.create(bodyInput('眼镜店案例', '同一楼层的百货店到了旺季，每天 8 点开门。展台占地三平方米。'));
  const pharmacy = await f.wiki.create(bodyInput('药店记录', '门店营业面积为 85 平方米。'));
  const optical = await f.wiki.create(bodyInput('眼镜店', '每天营业十二小时。'));

  for (const [title, page, quote] of [
    ['药店通常多大？', pharmacy, '门店营业面积为 85 平方米。'],
    ['眼镜店每天营业多久？', optical, '每天营业十二小时。'],
  ] as const) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts', title);
    assert.deepEqual(
      result.context.map(({ id }) => id),
      [page.id],
      title,
    );
    assert(quoteInWikiContext(result.context, page.id, 0, quote.length, quote), title);
  }
  for (const title of ['药店每天营业多久？', '眼镜店的门店面积？']) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts', title);
    assert.deepEqual(result.context, [], title);
  }
});

test('three long pages yield all nine distant original blocks, with permission and strict coordinate checks', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 3; n++) {
    const sections = Array.from(
      { length: 3 },
      (_, i) => '## 定位' + i + '\n\n探针 marker' + n + 'x' + i + ' 🧾 核对尾数。\n\n' + '无关记录已归档。'.repeat(800),
    );
    const page = await f.wiki.create(bodyInput('位置样本' + n, sections.join('\n\n')));
    assert(page.body.length > 15000);
    for (const [i] of sections.entries()) {
      const result = await f.retrieve('marker' + n + 'x' + i);
      assert.equal(result.chunks.length, 1);
      const [hit] = result.chunks;
      assert.equal(hit.pageId, page.id);
      assert.equal(hit.headingPath, '定位' + i);
      assert.equal(page.body.slice(hit.startOffset, hit.endOffset), hit.rawText);
    }
  }
  const denied = await f.wiki.create(bodyInput('限制记录', '## 来源事实\n\nmarker0x1 受限专有正文。'));
  await f.wiki.writePageLocked({ ...denied, sources: [randomUUID()] });
  const result = await f.retrieve('marker0x1');
  assert(!JSON.stringify(result).includes(denied.id));
  assert(!JSON.stringify(result).includes('受限专有正文'));
});

test('formal create/edit/delete sync, nonblocking failure degrades, disk recovery rebuilds, and explicit legacy ignores the index', async (t) => {
  const f = await fixture(t);
  const page = await f.wiki.create(bodyInput('毛利月报', 'oldmarker 旧数值。'));
  assert.equal((await f.retrieve('oldmarker')).chunks[0].pageId, page.id);
  const updated = await f.wiki.update(page.id, page.revision, { ...page, body: 'newmarker 新数值。' });
  assert.equal((await f.retrieve('oldmarker')).chunks.length, 0);
  assert.equal((await f.retrieve('newmarker')).chunks[0].pageId, page.id);
  const file = path.join(f.root, 'knowledge', 'wiki', page.id + '.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('新数值', '磁盘外部修改'));
  const stale = await f.retrieve('毛利月报');
  assert.equal(stale.engine, 'legacy_scan');
  assert.equal(stale.degraded, true);
  assert.deepEqual(stale.chunks, []);
  assert.equal(stale.records[0].body, 'newmarker 磁盘外部修改。');
  assert(f.index.isDirty);
  assert.equal(await f.index.reconcileOnStartup(), true);
  assert.equal((await f.retrieve('newmarker')).engine, 'sqlite_fts');
  assert.equal((await f.wiki.delete(page.id, updated.revision)).id, page.id);
  assert.equal((await f.retrieve('newmarker')).chunks.length, 0);
  assert.equal(
    f.index.read(
      (db) => db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE page_id = ?').get(page.id) as { n: number },
    ).n,
    0,
  );

  await f.index.close();
  await writeFile(f.index.databaseFile, 'broken SQLite');
  const saved = await f.wiki.create(bodyInput('动销回退', '落盘成功。'));
  assert.equal((await f.wiki.get(saved.id))?.body, '落盘成功。');
  assert.equal((await f.retrieve('动销回退')).degraded, true);
  assert.equal(await f.index.reconcileOnStartup(), true);
  assert.equal((await f.retrieve('动销回退')).chunks[0].pageId, saved.id);
  const prior = process.env.SEARCH_ENGINE;
  try {
    process.env.SEARCH_ENGINE = 'legacy_scan';
    await f.index.close();
    await rm(f.index.databaseFile);
    const legacy = await f.retrieve('动销回退');
    assert.equal(legacy.engine, 'legacy_scan');
    assert.equal(legacy.degraded, false);
    const projected = await retrieveKnowledgeContext(f.wiki, f.rawStore, query('动销回退'));
    assert.deepEqual(
      projected,
      legacy.records.map((record, index) => ({ ...record, freshness: projected[index].freshness })),
    );
    assert.equal(projected[0].freshness?.status, 'unverified');
  } finally {
    if (prior === undefined) delete process.env.SEARCH_ENGINE;
    else process.env.SEARCH_ENGINE = prior;
  }
});

test('answer provider receives only sent chunks and cannot cite the rest of a read page', async (t) => {
  const f = await fixture(t);
  const quote = 'sell-out 增长🧾 22%。';
  const unsent = '另有未经读取的口径。';
  const page = await f.wiki.create(bodyInput('测试口径', '## 来源事实\n\n' + quote + '\n\n## 另一项\n\n' + unsent));
  let proposedQuote = quote;
  const provider: LlmProvider = {
    name: 'fake',
    model: 'search-test',
    async complete({ user }) {
      const { wiki } = JSON.parse(user);
      assert.equal(wiki[0].id, page.id);
      assert(!Object.hasOwn(wiki[0], 'body'));
      assert.match(wiki[0].chunks[0].label, /来源事实.*事实.*块ID/u);
      assert(!user.includes(unsent));
      assert(JSON.stringify(wiki).length <= 48000);
      const start = page.body.indexOf(proposedQuote);
      return reply({
        version: 1,
        needsRaw: [],
        sections: [{ kind: 'fact', text: proposedQuote, citationIds: ['c1'] }],
        citations: [
          { id: 'c1', kind: 'wiki', recordId: page.id, quote: proposedQuote, start, end: start + proposedQuote.length },
        ],
      });
    },
  };
  const answers = new KnowledgeAnswerService({
    root: f.root,
    wiki: f.wiki,
    raws: f.rawStore,
    drafts: f.drafts,
    provider: () => provider,
  });
  await answers.initialize();
  const result = await answers.ask({ requestId: randomUUID(), question: 'sell-out' });
  assert.equal(result.wikiRetrieval?.engine, 'sqlite_fts');
  assert.equal(result.status, 'completed');
  assert.equal(result.citations[0].start, page.body.indexOf(quote));
  proposedQuote = unsent;
  const invalid = await answers.ask({ requestId: randomUUID(), question: 'sell-out' });
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.error?.code, 'ANSWER_CITATION_INVALID');
  assert.deepEqual(invalid.citations, []);
});

test('an answer rechecks disk and source permissions after the provider in every engine mode', async (t) => {
  for (const mode of ['sqlite_fts', 'legacy_scan', 'degraded'] as const) {
    await t.test(mode, async (s) => {
      const f = await fixture(s);
      const prior = process.env.SEARCH_ENGINE;
      try {
        if (mode !== 'degraded') process.env.SEARCH_ENGINE = mode;
        if (mode === 'degraded') f.index.markDirty('test', new Error('controlled index failure'));
        const raw = await f.rawStore.create({
          title: '来源复核',
          sourceType: 'report',
          sourceName: '合成',
          tags: [],
          body: '引用来源。',
        });
        const page = await f.wiki.create({ ...bodyInput('marginprobe', 'marginprobe oldvalue'), sources: [raw.id] });
        const wikiPath = path.join(f.root, 'knowledge', 'wiki', page.id + '.md');
        const rawPath = path.join(f.root, 'knowledge', 'raw', 'reports', raw.id + '.md');
        let duringCall = async () =>
          writeFile(wikiPath, (await readFile(wikiPath, 'utf8')).replace('oldvalue', 'newvalue'));
        const provider: LlmProvider = {
          name: 'fake',
          model: 'search-test',
          async complete() {
            await duringCall();
            return reply({
              version: 1,
              needsRaw: [],
              sections: [{ kind: 'fact', text: 'oldvalue', citationIds: ['c1'] }],
              citations: [{ id: 'c1', kind: 'wiki', recordId: page.id, quote: 'oldvalue', start: 12, end: 20 }],
            });
          },
        };
        const answers = new KnowledgeAnswerService({
          root: f.root,
          wiki: f.wiki,
          raws: f.rawStore,
          drafts: f.drafts,
          provider: () => provider,
        });
        const first = await answers.ask({ requestId: randomUUID(), question: 'marginprobe' });
        assert.deepEqual(first.citations, []);
        assert.equal(first.status, 'failed');
        assert.equal(first.error?.code, 'ANSWER_BASIS_CHANGED');
        assert.equal(first.wikiRetrieval?.engine, mode === 'degraded' ? 'legacy_scan' : mode);
        assert.equal(first.wikiRetrieval?.degraded, mode === 'degraded');

        await writeFile(wikiPath, f.wiki.pageContent(page));
        if (mode === 'sqlite_fts') assert(await f.index.reconcileOnStartup());
        duringCall = async () =>
          writeFile(rawPath, (await readFile(rawPath, 'utf8')).replace(/^---\n/u, '---\norigin: restricted\n'));
        const requestId = randomUUID();
        await assert.rejects(answers.ask({ requestId, question: 'marginprobe' }), {
          code: 'MEETING_SOURCE_RESTRICTED',
        });
        const denied = await answers.get(requestId);
        assert.equal(denied?.status, 'failed');
        assert.equal(denied?.error?.code, 'MEETING_SOURCE_RESTRICTED');
        assert.deepEqual(denied?.citations, []);
      } finally {
        if (prior === undefined) delete process.env.SEARCH_ENGINE;
        else process.env.SEARCH_ENGINE = prior;
      }
    });
  }
});

test('answer maintenance sends only chunks and appends a scoped draft to the authorized complete baseline', async (t) => {
  const f = await fixture(t);
  const quote = 'marginprobe 旧的门店陈述。';
  const footnotes = Array.from({ length: 20 }, (_, index) => 'footnotetoken' + index + 'x');
  const history = footnotes.map((marker) => marker + ' ' + 'archivedhistoricalparagraph. '.repeat(95)).join('\n\n');
  const page = await f.wiki.create(
    bodyInput('marginprobe', '## 来源事实\n\n' + quote + '\n\n## 人工备注\n\n' + history),
  );
  const explicit = await f.wiki.create(bodyInput('manualarchive', '## 旧的人工规则\n\n' + history));
  const addition = '## 本次整理\n\n更新片段，只追加已核验结论。';
  let maintenanceCalls = 0;
  let reviseTarget = false;
  const provider: LlmProvider = {
    name: 'fake',
    model: 'search-test',
    async complete({ user, system }) {
      const parsed = JSON.parse(user);
      if (parsed.stage === 'knowledge_answer') {
        const start = page.body.indexOf(quote);
        return reply({
          version: 1,
          needsRaw: [],
          sections: [{ kind: 'fact', text: quote, citationIds: ['c1'] }],
          citations: [{ id: 'c1', kind: 'wiki', recordId: page.id, quote, start, end: start + quote.length }],
        });
      }
      assert.equal(parsed.stage, 'answer_maintenance');
      const target = parsed.preview.targetWikiId === page.id ? page : explicit;
      const sent = parsed.context.find((record: { id: string }) => record.id === target.id);
      assert(sent?.chunks.length);
      assert(!Object.hasOwn(sent, 'body'));
      assert(footnotes.some((marker) => !user.includes(marker)));
      assert(parsed.partialTargetIds.includes(target.id));
      assert(system.includes('仅写应追加'));
      assert(JSON.stringify(parsed.context).length <= 48000);
      maintenanceCalls++;
      if (reviseTarget)
        await f.wiki.update(target.id, target.revision, { ...target, body: target.body + '\n新人工内容' });
      return reply({
        action: 'update',
        targetWikiId: target.id,
        baseRevision: target.revision,
        title: target.title,
        type: 'concept',
        category: 'channel',
        body: addition,
        tags: [],
        reason: '补充内容。',
        summary: ['追加结论'],
        questions: [],
      });
    },
  };
  const answers = new KnowledgeAnswerService({
    root: f.root,
    wiki: f.wiki,
    raws: f.rawStore,
    drafts: f.drafts,
    provider: () => provider,
  });
  const save = async (target: typeof page) => {
    const answer = await answers.ask({ requestId: randomUUID(), question: 'marginprobe' });
    assert.equal(answer.status, 'completed');
    return answers.save(answer.id, {
      key: randomUUID(),
      resultRevision: answer.revision,
      preview: {
        title: 'marginprobe',
        conclusion: quote,
        inferences: '',
        tags: [],
        targetWikiId: target.id,
        selectedSectionIds: answer.sections.map((section) => section.id),
        selectedText: answerText(answer.sections),
        citationIds: answer.citations.map((citation) => citation.id),
      },
    });
  };
  for (const target of [page, explicit]) {
    const saved = await save(target);
    assert.equal(saved.status, 'draft_created');
    const draft = await f.drafts.getKnowledge(saved.draftId!);
    assert(draft?.maintenance);
    assert.equal(draft.maintenance.context.find((record) => record.id === target.id)?.body, target.body);
    assert.equal(draft.maintenance.changes[0].candidate.body, target.body + '\n\n' + addition);
    assert.equal((await f.wiki.get(target.id))?.body, target.body);
  }
  assert.equal(maintenanceCalls, 2);
  reviseTarget = true;
  await assert.rejects(save(explicit), { code: 'ANSWER_BASIS_CHANGED' });
  assert.equal((await f.drafts.listKnowledge()).length, 2);
});

test('inspection related expansion and Prompt explicit selection use chunks with serialized limits', async (t) => {
  const f = await fixture(t);
  const selected = await f.wiki.create(bodyInput('经营对比', '## 来源事实\n\ncomparisonterm 基准。'));
  const related = await f.wiki.create(
    bodyInput('同类分析', '## 来源事实\n\ncomparisonterm 对比。\n\n## 整理\n\n无关正文。'),
  );
  const denied = await f.wiki.create(bodyInput('受限分析', '## 来源事实\n\ncomparisonterm 受限。'));
  await f.wiki.writePageLocked({ ...denied, sources: [randomUUID()] });
  const inspectionProvider: LlmProvider = {
    name: 'fake',
    model: 'search-test',
    async complete({ user }) {
      const { wiki } = JSON.parse(user);
      assert.equal(wiki[0].id, selected.id);
      assert.equal(wiki[1].id, related.id);
      assert(!Object.hasOwn(wiki[1], 'body'));
      assert.doesNotMatch(user, /无关正文|受限分析/u);
      assert(!user.includes(denied.id));
      assert(JSON.stringify(wiki).length <= 48000);
      return reply({ version: 1, findings: [] });
    },
  };
  const inspections = new KnowledgeInspectionService({
    root: f.root,
    wiki: f.wiki,
    raws: f.rawStore,
    drafts: f.drafts,
    provider: () => inspectionProvider,
  });
  await inspections.initialize();
  const requestId = randomUUID();
  await inspections.start({ requestId, wikiIds: [selected.id, denied.id], includeRelated: true });
  assert.equal((await inspections.wait(requestId))?.status, 'partial');
  assert.equal((await inspections.get(requestId))?.wikiRetrieval?.engine, 'sqlite_fts');

  const ids: string[] = [];
  for (let n = 0; n < 6; n++)
    ids.push(
      (
        await f.wiki.create(
          bodyInput(
            '模型资料' + n,
            Array.from(
              { length: 5 },
              (_, i) => '## 位置 ' + i + '\n\npromptterm ' + '资料\\给定「促销」'.repeat(94),
            ).join('\n\n'),
          ),
        )
      ).id,
    );
  const excluded = await f.wiki.create(bodyInput('非用户选页', 'promptterm 禁止发送。'));
  const prompts = new PromptStore(f.root, f.wiki);
  await prompts.initialize();
  let sent = 0;
  const promptProvider: LlmProvider = {
    name: 'fake',
    model: 'search-test',
    async complete({ user }) {
      const { relatedWiki } = JSON.parse(user.split('\n').at(-1)!);
      assert(relatedWiki.length > 1);
      if (sent === 0) assert(relatedWiki.some((page: { chunks: unknown[] }) => page.chunks.length > 1));
      else assert(relatedWiki.every((page: { excerpt: string }) => typeof page.excerpt === 'string'));
      assert(relatedWiki.every((page: { id: string }) => ids.includes(page.id) && JSON.stringify(page).length <= 3000));
      assert(JSON.stringify(relatedWiki).length <= 12000);
      assert(!user.includes(excluded.id));
      sent++;
      return reply({
        version: 1,
        name: '生成测试',
        category: 'customer',
        scenario: '访谈',
        sections: [{ heading: '任务目标', content: '分析' }],
        inputRequirements: '资料',
        outputRequirements: '结果',
        examples: '',
        tags: [],
      });
    },
  };
  const promptAi = new PromptAiService(f.root, f.wiki, prompts, () => promptProvider, f.rawStore);
  await promptAi.initialize();
  const brief = {
    taskName: 'promptterm',
    taskType: '访谈',
    role: '产品经理',
    goal: '核验',
    context: '测试',
    input: '资料',
    tasks: '准备',
    constraints: '客观',
    output: '结果',
  };
  const generated = await promptAi.generate(brief, ids);
  assert.equal(sent, 1);
  assert.deepEqual(generated.preview.relatedWikiIds, ids);
  assert.equal(generated.wikiRetrieval.engine, 'sqlite_fts');
  await f.index.close();
  const degraded = await promptAi.generate(brief, ids);
  assert.deepEqual(degraded.wikiRetrieval, {
    engine: 'legacy_scan',
    degraded: true,
    degradeReason: 'sqlite_unavailable',
  });
  assert.equal(sent, 2);
});

test('extraction uses chunk context, updates from full authoritative baseline, and indexes the confirmed draft', async (t) => {
  const f = await fixture(t);
  const markers = Array.from({ length: 12 }, (_, index) => `retentionmark${index}x`);
  const old = await f.wiki.create({
    ...bodyInput(
      '渠道覆盖',
      '## 来源事实\n\n2025年渠道覆盖100家。\n\n' +
        markers
          .map((marker) => '\n\n## 人工补充\n\n' + marker + ' 手工核实旧口径。' + '尚存历史记录。'.repeat(155))
          .join(''),
    ),
    type: 'metric',
  });
  const raw = await f.rawStore.create({
    title: '渠道覆盖新资料',
    sourceType: 'report',
    sourceName: '合成数据',
    tags: ['渠道覆盖'],
    body: '2026年渠道覆盖120家，按签约门店口径。',
  });
  const draft = await f.generate(raw.id);
  const planning = f.requests.find((r) => r.user.includes('请对下列全部已验证事实规划知识页'))!;
  const initial = f.requests.filter((r) => JSON.parse(r.user.split('\n').at(-1)!).stage === 'maintenance');
  assert.match(planning.user, /"chunks"/u);
  const unseen = markers.find((marker) => !planning.user.includes(marker));
  assert(unseen);
  assert.equal(initial.length, 2);
  const [first, second] = initial.map((r) => JSON.parse(r.user));
  assert.equal(first.context[0].id, old.id);
  assert(!Object.hasOwn(first.context[0], 'body'));
  assert.equal(second.requested.targetWikiId, old.id);
  assert.deepEqual(second.context, [old]);
  assert(JSON.stringify(second.context).length <= 48000);
  assert.equal(draft.maintenance?.context[0].body, old.body);
  assert(draft.maintenance?.changes[0].candidate.body.startsWith(old.body));
  assert.equal((await f.wiki.get(old.id))?.body, old.body);
  const committed = await f.confirm(await f.accept(draft));
  assert.equal(committed.manifest.status, 'completed');
  const updated = (await f.wiki.get(old.id))!;
  assert.match(updated.body, /2026年渠道覆盖120家/u);
  assert(updated.body.includes(unseen + ' 手工核实旧口径。'));
  const indexed = f.index.read((db) => db.prepare('SELECT raw_text FROM chunks WHERE page_id = ?').all(old.id));
  assert.match(JSON.stringify(indexed), /2026年渠道覆盖120家/u);
});
