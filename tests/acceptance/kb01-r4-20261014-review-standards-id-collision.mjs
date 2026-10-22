// Independent memory-only reserved-ID collision probe. No external provider/config/data.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LLMService } from '../../services/llm/service.ts';

const body = '甲'.repeat(8000) + '乙'.repeat(2000);
const ids = [['e', 'e-c2', 'e-c2-2'], ['e', 'e-c2-c2']];
const raw = { id: 'review-id-collision', title: '隔离ID碰撞', sourceType: 'note', sourceName: 'memory', tags: [] };
const expected = [];
let mergeEntries;
const provider = { name: 'memory', model: 'id-collision', secrets: [], async complete(request) {
  if (request.user.includes('完整结构化结果')) {
    mergeEntries = JSON.parse(request.user.slice(request.user.indexOf('[{')));
    return { text: JSON.stringify({ document: { title: '文档', main_topic: '主题', summary: '汇总' } }), bytes: 100, finishReason: 'stop' };
  }
  const catalog = JSON.parse(request.user.split('当前分块证据 locator 目录（只用于选择定位ID，不是事实来源）：\n')[1].split('\n\n资料正文：')[0]);
  const chunk = Number(/第 (\d+) 段，覆盖/.exec(request.user)[1]) - 1;
  const source_evidence = ids[chunk].map((id, index) => ({ id, locatorId: catalog[index].id }));
  const source_facts = ids[chunk].map((id, index) => {
    const text = `chunk ${chunk} fact ${id}`;
    expected.push({ text, quote: catalog[index].text });
    return { text, evidenceIds: [id] };
  });
  return { text: JSON.stringify({ evidence_format_version: 2,
    document: { title: '文档', main_topic: '主题', summary: `块${chunk}` },
    suggested_pages: [{ title: '同主题', type: 'concept', category: 'industry_basics', one_line_definition: '定义',
      source_facts, source_evidence, ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [] }],
  }), bytes: 100, finishReason: 'stop' };
} };
const outcome = await new LLMService('rules').wikiExtract({ raw, body, provider });
const page = outcome.pages[0];
assert.equal(outcome.chunkCount, 2);
assert.equal(outcome.callCount, 3);
assert.equal(page.source_evidence.length, 5);
assert.equal(new Set(page.source_evidence.map(item => item.id)).size, 5);
assert.equal(page.source_facts.length, 5);
assert.ok(page.source_evidence.some(item => item.id === 'e-c2-3'));
for (const item of expected) {
  const fact = page.source_facts.find(fact => fact.text === item.text);
  assert.ok(fact);
  const evidence = page.source_evidence.find(evidence => evidence.id === fact.evidenceIds[0]);
  assert.ok(evidence);
  assert.equal(evidence.quote, item.quote);
  assert.equal(body.slice(evidence.start, evidence.end), evidence.quote);
}
assert.deepEqual(mergeEntries.map(entry => entry.pages[0].source_facts.map(fact => fact.evidence[0].id)), ids, 'aggregate renaming must not mutate per-chunk snapshots');
const report = { at: new Date().toISOString(), status: 'PASS', scope: 'memory-only; reserved current/aggregate suffix collision; exact source and fact references; no network',
  serviceSha256: createHash('sha256').update(await readFile('services/llm/service.ts')).digest('hex'),
  chunkCount: outcome.chunkCount, callCount: outcome.callCount, evidenceIds: page.source_evidence.map(item => item.id), facts: page.source_facts.length, mergeSnapshotIds: ids };
await writeFile('docs/reports/KB01-R4-20261014-review-standards-id-collision.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
