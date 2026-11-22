import { persistedUpdateInput, approveWorkflow } from './support/human-review.ts';
import { synthesisFixture } from './acceptance/SYN01-FIX-20261026-fake.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { type LlmCompletionRequest, type LlmProvider } from '../services/llm/provider.ts';

const oldBody =
  '目标门店100家。铺货率=在售门店数÷目标门店数，旧值20%。门店数不等于销量。AI未上线，仅建议将来用于分析。异常审批负责人未知。\nKB02_HUMAN 人工口径备注。';
const newBody =
  '目标门店总数为100家。铺货率=在售门店数÷目标门店数，新值30%。本期新增渠道复核。AI未上线，仅建议将来用于分析。异常审批负责人未知。';
const empty = () => ({
  suggestedAdditions: [] as any[],
  conflicts: [] as any[],
  agreement: [] as any[],
  inferences: [] as string[],
  openQuestions: [] as string[],
});
async function fixture(existing = oldBody, incoming = newBody) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-final-agreement-')),
    raws = new RawStore(root);
  await raws.initialize();
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  const first = await raws.create({
      title: '虚构旧来源',
      sourceType: 'report',
      sourceName: '隔离',
      tags: [],
      body: existing,
    }),
    raw = await raws.create({
      title: '虚构新来源',
      sourceType: 'report',
      sourceName: '隔离',
      tags: [],
      body: incoming,
    });
  const target = await wiki.create({
    title: '虚构指标',
    type: 'metric',
    category: 'metric',
    sources: [first.id],
    tags: [],
    knowledge_status: 'source_supported',
    confidence: 'medium',
    source_level: 'C',
    review_status: 'unreviewed',
    aliases: [],
    body: existing,
  });
  const draftId = randomUUID(),
    pageId = randomUUID(),
    draftInput = {
      id: draftId,
      rawId: raw.id,
      revision: 1,
      rawSha256: raw.bodySha256,
      pages: [
        {
          pageId,
          source_facts: [{ text: incoming, evidenceIds: ['new-e1'] }],
          source_evidence: [{ id: 'new-e1', rawId: raw.id, quote: incoming, start: 0, end: incoming.length }],
          ai_organized: [],
          ai_inferences: [],
          open_questions: [],
        },
      ],
    };
  const draft = await persistedUpdateInput(root, raw, draftInput);
  const requests: LlmCompletionRequest[] = [];
  let reply = (input: any): any => ({
    ...empty(),
    agreement: [
      {
        text: '目标门店100家。',
        evidenceId: input.newSource.evidence[0].id,
        existingLocatorId: input.existing.locators[0].id,
      },
    ],
  });
  const provider: LlmProvider = {
    name: 'fake',
    model: 'final-agreement',
    secrets: ['synthetic-final-secret'],
    complete: async (r) => {
      requests.push(r);
      return { text: JSON.stringify(await reply(JSON.parse(r.user))), bytes: 1, finishReason: 'stop' };
    },
  };
  const args = {
    draftId: draft.id,
    pageId: draft.pages[0].pageId,
    baseRevision: draft.revision,
    targetWikiId: target.id,
    draft,
    raw,
    target,
    provider,
  };
  return {
    root,
    raws,
    wiki,
    workflows,
    first,
    raw,
    target,
    args,
    requests,
    setReply: (fn: typeof reply) => {
      reply = fn;
    },
    run: () => workflows.createUpdate(args),
    clean: () => rm(root, { recursive: true, force: true }),
  };
}

test('FINAL-02 request requires minimal common propositions per assertion and version-bound two-sided IDs', async () => {
  const f = await fixture();
  try {
    const flow = await f.run(),
      request = f.requests[0],
      input = JSON.parse(request.user);
    for (const rule of [
      '最小共同命题',
      '逐断言判断',
      '新来源未提及不等于新来源同意',
      '旧侧独有内容保留existing',
      '新侧独有且有证据的内容进入suggestedAdditions',
      '20%与新30%必须列conflicts',
      '不知道/未上线/将来建议',
      'existingLocatorId',
    ])
      assert(request.system.includes(rule), rule);
    assert.equal(input.existing.wikiId, f.target.id);
    assert.equal(input.existing.revision, f.target.revision);
    assert.equal(input.existing.locators.map((x: any) => x.text).join(''), f.target.body);
    for (const l of input.existing.locators) {
      assert.equal(f.target.body.slice(l.start, l.end), l.text);
      assert.match(l.id, /^wiki-[a-f0-9]{64}-\d+$/u);
    }
    assert.equal(flow.baseWiki!.body, f.target.body);
    assert.equal(flow.baseRevision, f.target.revision);
    assert.deepEqual(flow.evidence![0], {
      section: 'agreement',
      text: '目标门店100家。',
      rawId: f.raw.id,
      quote: f.raw.body,
      start: 0,
      end: f.raw.body.length,
    });
    assert(!JSON.stringify(flow).includes('existingLocatorId'));
    assert(!Object.hasOwn(flow.sections, 'locators'));
    assert.equal((await f.wiki.get(f.target.id))!.body, f.target.body);
  } finally {
    await f.clean();
  }
});

for (const variant of [
  'missing-old',
  'missing-new',
  'wrong-side-old',
  'wrong-side-new',
  'unknown-old',
  'unknown-new',
  'extra-field',
  'wrong-version',
  'cross-target',
] as const)
  test(`FINAL-02 ${variant} rejects without workflow or Wiki writes`, async () => {
    const f = await fixture();
    try {
      let foreign = '';
      if (variant === 'wrong-version' || variant === 'cross-target') {
        await f.run();
        const captured = JSON.parse(f.requests[0].user);
        foreign = captured.existing.locators[0].id;
        // A saved valid preview is unrelated to the rejected response; count it as baseline.
        if (variant === 'wrong-version')
          f.args.target = await f.wiki.update(f.target.id, f.target.revision, { ...f.target, body: f.target.body });
        else {
          const t = await f.wiki.create({ ...f.target, title: '另一虚构目标', body: f.target.body });
          f.args.target = t;
          f.args.targetWikiId = t.id;
        }
      }
      const before = (await f.workflows.list()).length,
        current = await f.wiki.get(f.args.target.id);
      f.setReply((input) => {
        const item: any = {
          text: '目标门店100家。',
          evidenceId: input.newSource.evidence[0].id,
          existingLocatorId: input.existing.locators[0].id,
        };
        if (variant === 'missing-old') delete item.existingLocatorId;
        if (variant === 'missing-new') delete item.evidenceId;
        if (variant === 'wrong-side-old') item.existingLocatorId = input.newSource.evidence[0].id;
        if (variant === 'wrong-side-new') item.evidenceId = input.existing.locators[0].id;
        if (variant === 'unknown-old') item.existingLocatorId = 'wiki-missing';
        if (variant === 'unknown-new') item.evidenceId = 'another-page-evidence';
        if (variant === 'extra-field') item.revision = input.existing.revision;
        if (variant === 'wrong-version' || variant === 'cross-target') item.existingLocatorId = foreign;
        return { ...empty(), agreement: [item] };
      });
      await assert.rejects(f.run(), (e: any) => ['LLM_SCHEMA_INVALID', 'EVIDENCE_INVALID'].includes(e.code));
      assert.equal((await f.workflows.list()).length, before);
      assert.deepEqual(await f.wiki.get(f.args.target.id), current);
    } finally {
      await f.clean();
    }
  });

test('FINAL-02 original seq82 unilateral compound agreement lacks old-side binding and is rejected, no auto-fill', async () => {
  const fixture = JSON.parse(
      await readFile('tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-failure-fixture.json', 'utf8'),
    ),
    f = await fixtureFromTrace(fixture);
  try {
    f.setReply(() => fixture.update.response);
    await assert.rejects(f.run(), { code: 'LLM_SCHEMA_INVALID' });
    assert.equal(f.requests.length, 1);
    assert.equal((await f.workflows.list()).length, 0);
    assert.equal((await f.wiki.get(f.target.id))!.body, f.target.body);
    assert(fixture.update.response.agreement[1].text.includes('均强调门店数不代表销量'));
    assert(!f.raw.body.includes('不代表销量'));
  } finally {
    await f.clean();
  }
});
async function fixtureFromTrace(value: any) {
  const input = JSON.parse(value.update.request.messages.find((m: any) => m.role === 'user').content);
  return fixture(input.existing.body, input.newSource.body);
}

test('FINAL-02 controlled synonym/one-sided/partial compound/conflict/unknown/future samples preserve exact support boundaries', async () => {
  const f = await fixture();
  try {
    // Expected answers are authored fixture labels. This does not prove a model follows these semantics.
    f.setReply((input) => ({
      ...empty(),
      agreement: [
        { text: '目标门店100家。', evidenceId: 'new-e1', existingLocatorId: input.existing.locators[0].id },
        {
          text: '铺货率=在售门店数÷目标门店数。',
          evidenceId: 'new-e1',
          existingLocatorId: input.existing.locators.find((l: any) => l.text.includes('铺货率')).id,
        },
        {
          text: 'AI未上线，仅建议将来用于分析；异常审批负责人未知。',
          evidenceId: 'new-e1',
          existingLocatorId: input.existing.locators.find((l: any) => l.text.includes('AI未上线')).id,
        },
      ],
      suggestedAdditions: [{ text: '本期新增渠道复核。', evidenceId: 'new-e1' }],
      conflicts: [{ text: '旧20%，新30%；可比口径待确认，保留两值。', evidenceId: 'new-e1' }],
      openQuestions: ['两次统计时点是否可比？'],
    }));
    const flow = await f.run();
    assert.equal(flow.sections.agreement.length, 3);
    assert(!flow.sections.agreement.some((t) => t.includes('不等于销量')));
    assert(flow.sections.existing!.includes('门店数不等于销量'));
    assert.deepEqual(flow.sections.suggestedAdditions, ['本期新增渠道复核。']);
    assert(flow.sections.conflicts[0].includes('20%') && flow.sections.conflicts[0].includes('30%'));
    assert.equal((await f.wiki.get(f.target.id))!.revision, f.target.revision);
    const reboot = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
    await reboot.initialize();
    assert.deepEqual((await reboot.get(flow.id))!.sections, flow.sections);
    flow.revision = (await approveWorkflow(reboot, flow.id)).revision;
    const done = await reboot.confirm(flow.id, flow.revision, 'final-two-sided-confirm'),
      saved = await f.wiki.get(f.target.id);
    assert.equal(done.workflow.status, 'confirmed');
    assert(saved!.body.includes(oldBody));
    assert(saved!.body.includes('KB02_HUMAN'));
    assert(saved!.body.includes('20%') && saved!.body.includes('30%'));
    assert(saved!.sources.includes(f.first.id) && saved!.sources.includes(f.raw.id));
    const restart = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
    await restart.initialize();
    const again = await restart.confirm(flow.id, flow.revision, 'final-two-sided-confirm');
    assert(again.reused);
    assert.deepEqual(await f.wiki.get(f.target.id), saved);
  } finally {
    await f.clean();
  }
});

test('FINAL-02 only-old statements may produce empty agreement without inventing a shared claim', async () => {
  const f = await fixture('门店数不等于销量。KB02_HUMAN', '在售门店30家。');
  try {
    f.setReply(() => ({ ...empty(), suggestedAdditions: [{ text: '在售门店30家。', evidenceId: 'new-e1' }] }));
    const flow = await f.run();
    assert.deepEqual(flow.sections.agreement, []);
    assert.equal(flow.sections.existing, f.target.body);
  } finally {
    await f.clean();
  }
});

test('FINAL-02 target edited during provider call rejects bound old version with no saved preview', async () => {
  const f = await fixture();
  try {
    f.setReply(async (input) => {
      await f.wiki.update(f.target.id, f.target.revision, { ...f.target, body: f.target.body + '\n人工新版本。' });
      return {
        ...empty(),
        agreement: [
          { text: '目标门店100家。', evidenceId: 'new-e1', existingLocatorId: input.existing.locators[0].id },
        ],
      };
    });
    await assert.rejects(f.run(), { code: 'WIKI_REVISION_CONFLICT' });
    assert.equal((await f.workflows.list()).length, 0);
    assert((await f.wiki.get(f.target.id))!.body.endsWith('人工新版本。'));
  } finally {
    await f.clean();
  }
});

test('FINAL-02 synthesis stored evidence contract remains unchanged', async () => {
  const f = await fixture();
  try {
    f.setReply((input) =>
      synthesisFixture(
        { user: JSON.stringify(input) },
        {
          title: '虚构综合',
          category: 'metric',
          ...empty(),
          agreement: [{ text: '旧来源目标100家。', rawId: f.first.id, quote: '目标门店100家。', start: 0, end: 9 }],
        },
      ),
    );
    const flow = await f.workflows.createSynthesis({ rawIds: [f.first.id, f.raw.id], provider: f.args.provider });
    assert.equal(flow.kind, 'synthesis');
    assert(!f.requests[0].system.includes('existingLocatorId'));
    assert.deepEqual(
      Object.keys(flow.evidence![0]).sort(),
      ['section', 'text', 'rawId', 'quote', 'start', 'end'].sort(),
    );
  } finally {
    await f.clean();
  }
});
