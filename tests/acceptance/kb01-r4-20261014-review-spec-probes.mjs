// Independent Spec probes. In-memory providers only; no network/config/workspace reads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LLMService } from '../../services/llm/service.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { FROZEN_BUDGETS } from '../../services/llm/rules.ts';

const rulesDir = path.resolve('rules');
const raw = { id: 'independent-spec-raw', title: '虚构重叠证据测试', sourceType: 'note', sourceName: '内存夹具', tags: [] };
const checks = [];
const body = '填'.repeat(7598) + '\n\n' + '虚构事实：门店覆盖20%。' + '间'.repeat(185) + '\n\n' + '尾'.repeat(500);
const chunkOptions = { maxChunkChars:FROZEN_BUDGETS.maxChunkChars, overlap:FROZEN_BUDGETS.chunkOverlap, maxRawChars:FROZEN_BUDGETS.maxRawChars };
const chunks = chunkText(body, chunkOptions);
const catalogs = chunks.map(chunk => buildEvidenceLocatorCatalog(body, chunk));
const shared = catalogs[0].find(a => catalogs[1].some(b => a.start === b.start && a.end === b.end));
assert(shared, 'Fixture must offer a shared exact locator slice inside chunk overlap.');
const reply = (locatorId, id) => ({ evidence_format_version: 2,
  document: { title: '虚构资料', main_topic: '覆盖率', summary: '虚构资料摘要' },
  suggested_pages: [{ title: '覆盖率', type: 'metric', category: 'metric', one_line_definition: '目标门店覆盖比例。',
    source_facts: [{ text: '虚构事实：门店覆盖20%。', evidenceIds: [id] }],
    ai_organized: ['整理内容'], ai_inferences: ['推断内容'], related_pages: [], open_questions: ['待确认内容'],
    source_evidence: [{ id, locatorId }] }],
});
async function runOverlap(distinctIds) {
  let calls = 0;
  const provider = { name: 'memory', model: 'spec', secrets: [], complete: async input => {
    calls++;
    const match = input.user.match(/第 (\d+) 段，覆盖原文全局区间/);
    assert(match, 'Must be a real chunk call, not document merge.');
    const index = Number(match[1]) - 1;
    const locator = catalogs[index].find(item => item.start === shared.start && item.end === shared.end);
    assert(locator, 'Every selected anchor must exist inside its own actual chunk.');
    return { text: JSON.stringify(reply(locator.id, distinctIds ? `e${index+1}` : 'e1')), bytes: 100, finishReason: 'stop' };
  }};
  try {
    const outcome = await new LLMService(rulesDir).wikiExtract({ raw, body, provider });
    assert.equal(outcome.chunkCount, chunks.length);
    assert.equal(outcome.pages.length, 1);
    assert.deepEqual(outcome.pages[0].ai_organized, ['整理内容']);
    assert.deepEqual(outcome.pages[0].ai_inferences, ['推断内容']);
    assert.deepEqual(outcome.pages[0].open_questions, ['待确认内容']);
    return { result: 'PASS', calls, chunkCount: outcome.chunkCount, evidenceCount: outcome.pages[0].source_evidence.length,
      evidence: outcome.pages[0].source_evidence.map(({id,start,end,chunkIndex}) => ({id,start,end,chunkIndex})) };
  } catch (error) { return { result: 'FAIL', code: error.code, message: error.message, calls }; }
}
checks.push({ id: 'SP01-overlap-same-page-same-id-same-slice', expectation: 'Valid chunk-local evidence can be aggregated without duplicate evidence IDs.', ...await runOverlap(false) });
checks.push({ id: 'SP02-overlap-distinct-id-control', expectation: 'The identical valid locator choices should succeed with unrelated provider evidence IDs.', ...await runOverlap(true) });

const longBody = ('😀虚构渠道说明。\r\n重复说明。\r\n').repeat(6000).slice(0,106400);
const longChunks = chunkText(longBody, chunkOptions);
for (const chunk of longChunks) {
  const catalog = buildEvidenceLocatorCatalog(longBody, chunk);
  assert.equal(catalog.map(item => item.text).join(''), chunk.text);
  assert.equal(catalog[0].start, chunk.start);
  assert.equal(catalog.at(-1).end, chunk.end);
  assert(catalog.length <= 256);
  assert(catalog.every(item => item.end - item.start <= 512));
}
checks.push({id:'SP03-106400-catalog-actual-cover', result:'PASS', length:longBody.length, chunkCount:longChunks.length, tail:longChunks.at(-1).end});
const report = { at: new Date().toISOString(), scope:'In-memory actual LLMService and locator catalog; no external Provider, HTTP, storage or browser.',
  sharedSlice:{start:shared.start,end:shared.end}, checks,
  summary:{pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length} };
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec-probes-'+(process.argv[2]??'recheck')+'.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
