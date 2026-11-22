import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The standalone developer evaluation scorer is JavaScript.
import { score } from '../scripts/eval/score.mjs';
const body = '本月已售100箱。负责人未知。';
const gold = {
  requiredFields: {
    document: ['title', 'main_topic', 'summary', 'source_level'],
    pages: [
      'title',
      'type',
      'category',
      'source_facts',
      'source_evidence',
      'open_questions',
      'ai_organized',
      'ai_inferences',
    ],
  },
  requiredFacts: [{ id: 'f1', variants: [['已售', '100箱']] }],
  requiredQuestions: [{ id: 'q1', variants: [['负责人未知']] }],
  forbiddenAssertions: [
    {
      id: 'b1',
      variants: [['已售120箱']],
      exclude: [] as string[],
      scope: [
        'document',
        'source_facts',
        'open_questions',
        'ai_organized',
        'ai_inferences',
        'templateFields.aiContent',
      ],
    },
  ],
  partitionRules: [{ id: 'p1', variants: [['负责人未知']], exclude: [], scopes: ['source_facts'] }],
};
function fixture() {
  return {
    document: { title: '主题', main_topic: '主题', summary: '本月已售100箱。\n下月预计120箱。', source_level: 'D' },
    pages: [
      {
        title: '主题',
        type: 'metric',
        category: 'metric',
        source_facts: [{ text: '本月已售100箱。', evidenceIds: ['e1'] }],
        source_evidence: [{ id: 'e1', rawId: 'raw', start: 0, end: body.length, quote: body }],
        open_questions: ['负责人未知。'],
        ai_organized: [] as string[],
        ai_inferences: [] as string[],
      },
    ],
  };
}
test('EVAL01 score identifies lost facts, questions, false claims and evidence mutations', () => {
  let x = fixture(),
    s = score(x, body, 'raw', gold);
  assert.equal(s.facts.passed, 1);
  assert.equal(s.questions.passed, 1);
  assert.equal(s.forbidden.length, 0);
  assert.equal(s.evidence.failures.length, 0);
  x.pages[0].source_facts[0].text = '其他事实';
  assert.equal(score(x, body, 'raw', gold).facts.passed, 0);
  x = fixture();
  x.pages[0].open_questions = [];
  assert.equal(score(x, body, 'raw', gold).questions.passed, 0);
  x = fixture();
  x.pages[0].ai_organized = ['已售120箱'];
  assert.equal(score(x, body, 'raw', gold).forbidden.length, 1);
  x = fixture();
  x.pages[0].source_evidence[0].quote = '改' + body.slice(1);
  assert.equal(score(x, body, 'raw', gold).evidence.failures.length, 1);
});
test('EVAL01 detects wrong partition, repeated evidence and invalid fields', () => {
  let x = fixture();
  x.pages[0].source_facts.push({ text: '负责人未知。', evidenceIds: ['e1'] });
  assert.equal(score(x, body, 'raw', gold).partition.length, 1);
  x = fixture();
  x.pages[0].source_facts.push({ ...x.pages[0].source_facts[0] });
  assert.equal(score(x, body, 'raw', gold).duplicates.count, 1);
  x = fixture();
  x.pages[0].title = '';
  assert.equal(score(x, body, 'raw', gold).emptyTopics, 1);
  assert.equal(score(x, body, 'raw', gold).validFields.pass, false);
  x = fixture();
  x.pages[0].source_facts[0].evidenceIds = ['missing'];
  assert.equal(score(x, body, 'raw', gold).validFields.pass, false);
});
test('EVAL01 rejects out-of-range evidence and respects explicit exclusion', () => {
  let x = fixture();
  x.pages[0].source_evidence[0].end = body.length + 10;
  assert.equal(score(x, body, 'raw', gold).evidence.failures.length, 1);
  let g = structuredClone(gold);
  g.forbiddenAssertions = [
    { id: 'b', variants: [['所有请求', '失败']], exclude: ['不证明所有请求失败'], scope: ['source_facts'] },
  ];
  x = fixture();
  x.pages[0].source_facts[0].text = '不证明所有请求失败';
  assert.equal(score(x, body, 'raw', g).forbidden.length, 0);
  x.pages[0].source_facts[0].text = '所有请求失败';
  assert.equal(score(x, body, 'raw', g).forbidden.length, 1);
});
test('EVAL01 v2 local negation never masks a separate affirmative', () => {
  const g = structuredClone(gold);
  g.forbiddenAssertions = [
    { id: 'b', variants: [['所有大范围请求', '失败']], exclude: ['不证明所有大范围请求失败'], scope: ['ai_organized'] },
  ];
  const check = (text: string) => {
    const x = fixture();
    x.pages[0].ai_organized = [text];
    return score(x, body, 'raw', g).forbidden.length;
  };
  for (const s of ['不证明所有大范围请求失败', '仅验证了这一组请求，不能据此证明所有大范围请求都会失败。'])
    assert.equal(check(s), 0, s);
  for (const sep of ['。', '，', '；', '\n', '但', '并且'])
    assert.equal(check(`不能证明所有大范围请求失败${sep}所有大范围请求都会失败`), 1, sep);
  for (const s of [
    '所有大范围请求都会失败',
    '不能证明小范围请求失败，所有大范围请求失败',
    '所有大范围请求失败但不能证明所有大范围请求失败',
  ])
    assert.equal(check(s), 1, s);
  g.forbiddenAssertions = [
    { id: 'b', variants: [['全部门店', '亏损']], exclude: ['不证明全部门店亏损'], scope: ['ai_organized'] },
  ];
  assert.equal(check('不能由此证明全部门店都会亏损'), 0);
  assert.equal(check('不能证明全部门店亏损；全部门店亏损'), 1);
  g.forbiddenAssertions = [
    { id: 'b', variants: [['含税出库额', '净签收额', '相同口径']], exclude: [], scope: ['ai_organized'] },
  ];
  assert.equal(check('含税出库额，和净签收额处于相同口径'), 1);
});
test('EVAL01 local match spans remain UTF-16 offsets around emoji and delimiters', () => {
  const x = fixture();
  x.pages[0].ai_organized = ['😀但是是所有大范围请求失败'];
  const g = structuredClone(gold);
  g.forbiddenAssertions = [
    { id: 'b', variants: [['所有大范围请求', '失败']], exclude: ['不证明所有大范围请求失败'], scope: ['ai_organized'] },
  ];
  const found = score(x, body, 'raw', g).forbidden[0].spans[0];
  assert.equal(x.pages[0].ai_organized[0].slice(found.start, found.end), '所有大范围请求失败');
});
