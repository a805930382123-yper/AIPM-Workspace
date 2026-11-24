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
    assert.equal(result.degraded, false);
    assert.equal(result.chunks[0].pageId, page.id);
  }
  for (const title of ['', '* - : ^ ()？', '请问门店情况如何？']) {
    const result = await f.retrieve(title);
    assert.equal(result.engine, 'sqlite_fts');
    assert.deepEqual(result.chunks, [], title);
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
    assert.deepEqual(legacy.records, await retrieveKnowledgeContext(f.wiki, f.rawStore, query('动销回退')));
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
        if (mode === 'legacy_scan') process.env.SEARCH_ENGINE = 'legacy_scan';
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
  assert.deepEqual(degraded.wikiRetrieval, { engine: 'legacy_scan', degraded: true });
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
