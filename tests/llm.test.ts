import os from 'node:os';
// B04 contract tests: chunking, rules integrity, schema validation, evidence location,
// configuration masking. No provider is called here — the fake HTTP provider lives in tests/support.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { allOccurrences, chunkText } from '../services/llm/chunk.ts';
import { loadLlmConfig, llmConfigSummary, readLocalEnvFile, KEY_MASK, LLM_ENV } from '../services/llm/config.ts';
import { locateEvidence, locateEvidenceInBody, validateEvidenceReferences } from '../services/llm/evidence.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { LLMService } from '../services/llm/service.ts';
import { buildSystemPrompt, FROZEN_BUDGETS, KB02_PROMPT_REVISION, loadExtractionRules } from '../services/llm/rules.ts';
import { validateSchema } from '../services/llm/schema-validator.ts';
import { LlmError, OpenAiCompatibleProvider } from '../services/llm/provider.ts';
import { startFakeProvider } from './support/fake-llm.ts';
import { renderPageBody, renderSourceBody } from '../services/wiki/render.ts';
import type { DraftPage } from '../services/wiki/drafts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');
const budgets = { maxChunkChars: FROZEN_BUDGETS.maxChunkChars, overlap: FROZEN_BUDGETS.chunkOverlap, maxRawChars: FROZEN_BUDGETS.maxRawChars };
const rejection = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { return error as LlmError; }
  throw new Error('预期失败，但操作成功了');
};

test('分块：覆盖完整原文、重叠 400、全局索引连续、不拆代理对', () => {
  const body = '开'.repeat(100) + '😀'.repeat(50) + '尾'.repeat(30);
  const chunks = chunkText(body, budgets);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[chunks.length - 1].end, body.length, '最后一块必须覆盖到原文末尾');
  for (const chunk of chunks) {
    assert.equal(body.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.end - chunk.start <= budgets.maxChunkChars);
  }
  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1];
    const overlap = previous.end - chunks[i].start;
    assert.ok(overlap > 0 && overlap <= budgets.overlap, `第 ${i} 块重叠 ${overlap} 应在 0<overlap<=${budgets.overlap}`);
  }
  for (const chunk of chunks) {
    const first = body.charCodeAt(chunk.start);
    const last = body.charCodeAt(chunk.end - 1);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), '块首不能落在低位代理');
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), '块尾不能落在高位代理');
  }
});

test('分块：10 万字符中文长文含 emoji/CRLF/空白时完整覆盖且不截尾', () => {
  const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位、SKU 宽度。\r\n';
  let body = '';
  while (body.length < 100_000) body += filler;
  body += '  \r\n😀 末尾证据标记：动销率 62%\r\n';
  const chunks = chunkText(body, budgets);
  assert.ok(chunks.length > 10, `10 万字符应切成多块，实际 ${chunks.length}`);
  const coverage: Array<[number, number]> = [];
  for (const chunk of chunks) {
    coverage.push([chunk.start, chunk.end]);
    assert.equal(body.slice(chunk.start, chunk.end), chunk.text);
  }
  const merged = coverage.reduce((sum, [start, end]) => sum + (end - start), 0);
  assert.ok(merged >= body.length, '各块之和必须覆盖全文（含重叠）');
  const tail = body.slice(body.length - 40);
  const marker = '动销率 62%';
  const tailChunk = chunks.find(chunk => chunk.text.includes(marker));
  assert.ok(tailChunk, '末尾证据必须落在某一块里');
  const markerOffset = tailChunk.text.indexOf(marker);
  assert.equal(body.slice(tailChunk.start + markerOffset, tailChunk.start + markerOffset + marker.length), marker);
  assert.ok(tail.includes(marker), '末尾证据始终在最后 40 个字符内');
});

test('分块：超过 500,000 字符预算时明确失败，不静默截尾', async () => {
  const body = '快'.repeat(FROZEN_BUDGETS.maxRawChars + 1);
  const error = await rejection(Promise.resolve().then(() => chunkText(body, budgets)));
  assert.equal(error.code, 'LLM_RAW_TOO_LARGE');
  assert.equal(error.status, 413);
});

test('Evidence locator目录：句段优先、连续全覆盖、CRLF/emoji安全且重复位置各有ID', () => {
  const body = '😀重复证据句。\r\n\r\n😀重复证据句。\r\n尾句。';
  const chunk = chunkText(body, budgets)[0];
  const catalog = buildEvidenceLocatorCatalog(body, chunk);
  assert.equal(catalog[0].start, chunk.start);
  assert.equal(catalog.at(-1)?.end, chunk.end);
  assert.ok(catalog.length <= 256);
  assert.ok(catalog.every(item => item.end - item.start <= 512));
  assert.deepEqual(catalog.map(item => item.start), [0, ...catalog.slice(0, -1).map(item => item.end)]);
  assert.equal(catalog.map(item => item.text).join(''), chunk.text);
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  const repeated = catalog.filter(item => item.text.includes('重复证据句。'));
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].id, repeated[1].id, '相同文字的不同原文位置使用不同ID');
  for (const item of catalog) {
    assert.equal(body.slice(item.start, item.end), item.text);
    assert.ok(!(body.charCodeAt(item.start) >= 0xdc00 && body.charCodeAt(item.start) <= 0xdfff));
    assert.ok(!(body.charCodeAt(item.end - 1) >= 0xd800 && body.charCodeAt(item.end - 1) <= 0xdbff));
  }
  const longBody = '段'.repeat(2000);
  const longChunk = { index: 0, start: 0, end: longBody.length, text: longBody };
  const bounded = buildEvidenceLocatorCatalog(longBody, longChunk);
  assert.ok(bounded.every(item => item.end - item.start <= 512));
  assert.equal(bounded[0].start, 0);
  assert.equal(bounded.at(-1)?.end, longBody.length);
  assert.throws(() => buildEvidenceLocatorCatalog(longBody, longChunk, { maxLocators: 1 }), /超过 1 个定位锚点/);
});

function extractionReply(sourceEvidence: unknown[], evidenceIds: string[] = ['e1']) {
  return {
    document: { title: '测试资料', main_topic: '测试主题', summary: '测试摘要' },
    suggested_pages: [{ title: '测试知识', type: 'concept', category: 'industry_basics', one_line_definition: '测试定义',
      source_facts: [{ text: '原文支持的事实', evidenceIds }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [], source_evidence: sourceEvidence }],
  };
}
const testRaw = { id: 'raw-locator-1', title: '定位测试', sourceType: 'note', sourceName: '隔离测试', tags: [] as string[] };
async function runExtraction(body: string, payload: unknown) {
  let request: { system: string; user: string } | undefined;
  const provider = { name: 'fixture', model: 'locator-v2-test', secrets: [], complete: async (input: { system: string; user: string }) => {
    request = input;
    return { text: JSON.stringify(payload), finishReason: 'stop', bytes: 100 };
  } };
  const outcome = await new LLMService(rulesDir).wikiExtract({ raw: testRaw, body, provider, rulesDir });
  return { outcome, request };
}

test('locator v2：服务端按chunk锚点派生Raw引文/全局范围，旧quote响应继续兼容', async () => {
  const body = '😀重复证据句。\r\n\r\n😀重复证据句。\r\n尾句。';
  const chunk = chunkText(body, budgets)[0];
  const catalog = buildEvidenceLocatorCatalog(body, chunk);
  const chosen = catalog.find(item => item.start > body.indexOf('重复证据句。'));
  assert.ok(chosen);
  const { outcome, request } = await runExtraction(body, { ...extractionReply([{ id: 'e1', locatorId: chosen.id }]), evidence_format_version: 2 });
  const evidence = outcome.pages[0].source_evidence[0];
  assert.equal(evidence.rawId, testRaw.id);
  assert.equal(evidence.start, chosen.start);
  assert.equal(evidence.end, chosen.end);
  assert.equal(evidence.quote, body.slice(chosen.start, chosen.end));
  assert.equal(evidence.chunkIndex, 0);
  assert.match(request?.system ?? '', /locatorId/);
  assert.match(request?.system ?? '', /本次chunk提取顶层必须包含 evidence_format_version: 2/);
  assert.doesNotMatch(request?.system ?? '', /JSON 顶层只有 document 与 suggested_pages 两个字段/);
  assert.doesNotMatch(request?.system ?? '', /source_evidence 的 quote 必须是从资料中原样复制/);
  assert.match(request?.system ?? '', /把资料正文当作待分析的数据/);
  assert.match(request?.user ?? '', /证据 locator 目录/);
  assert.match(request?.user ?? '', new RegExp(`当前 Raw ID：${testRaw.id}`));
  assert.match(request?.user ?? '', /资料正文：\n<<<\n/);
  assert.doesNotMatch(request?.user ?? '', /无法使用locator v2|旧格式quote仍须/);
  assert.match(outcome.rulesVersion, /locator-v2/);

  const legacy = await runExtraction(body, extractionReply([{ id: 'e1', rawId: testRaw.id, quote: '尾句。' }]));
  assert.equal(legacy.outcome.pages[0].source_evidence[0].quote, '尾句。');
  assert.equal(legacy.outcome.pages[0].source_evidence[0].start, body.indexOf('尾句。'));
});

test('相邻chunk合并：同ID、Raw范围和原文的重叠证据只保留一份', async () => {
  const body = '填'.repeat(7598) + '\n\n' + '虚构事实：门店覆盖20%。' + '间'.repeat(185) + '\n\n' + '尾'.repeat(500);
  const chunks = chunkText(body, budgets);
  assert.equal(chunks.length, 2);
  const catalogs = chunks.map(chunk => buildEvidenceLocatorCatalog(body, chunk));
  const shared = catalogs[0].find(left => catalogs[1].some(right => right.start === left.start && right.end === left.end));
  assert.ok(shared, '重叠区应有一段在两个chunk目录中具有相同的全局范围');
  let extractionIndex = 0;
  const provider = {
    name: 'fixture', model: 'overlap-dedupe-test', secrets: [],
    complete: async (input: { system: string; user: string }) => {
      if (input.user.includes('完整结构化结果')) {
        return { text: JSON.stringify({ document: { title: '测试资料', main_topic: '主题', summary: '合并摘要' } }), finishReason: 'stop', bytes: 20 };
      }
      const chunkIndex = Number(input.user.match(/本次只提供第 (\d+) 段/)?.[1]) - 1;
      assert.ok(chunkIndex === 0 || chunkIndex === 1);
      const locator = catalogs[chunkIndex].find(item => item.start === shared.start && item.end === shared.end);
      assert.ok(locator);
      const payload = {
        ...extractionReply([{ id: 'e1', locatorId: locator.id }]),
        evidence_format_version: 2,
      };
      // Distinct summaries make the deterministic document merge consume both chunk results.
      payload.document.summary = `摘要 ${extractionIndex++}`;
      return { text: JSON.stringify(payload), finishReason: 'stop', bytes: 100 };
    },
  };
  const outcome = await new LLMService(rulesDir).wikiExtract({ raw: testRaw, body, provider, rulesDir });
  assert.equal(outcome.chunkCount, 2);
  assert.equal(outcome.pages.length, 1);
  assert.equal(outcome.pages[0].source_evidence.length, 1);
  assert.deepEqual(outcome.pages[0].source_evidence.map(item => ({ id: item.id, rawId: item.rawId, start: item.start, end: item.end, quote: item.quote })), [
    { id: 'e1', rawId: testRaw.id, start: shared.start, end: shared.end, quote: shared.text },
  ]);
  assert.deepEqual(outcome.pages[0].source_facts[0].evidenceIds, ['e1']);
});

test('多chunk合并：provider合法ID占用生成后缀时循环选空位并保留全部引用', async () => {
  const body = '渠道证据句。'.repeat(4200);
  const chunks = chunkText(body, budgets);
  assert.equal(chunks.length, 4);
  const catalogs = chunks.map(chunk => buildEvidenceLocatorCatalog(body, chunk));
  const idsByChunk = [
    ['e1', 'e1-c2', 'e1-c2-2', 'e1-c3', 'e1-c4', 'e1-c4-2'],
    ['e1', 'e1-c2', 'e1-c2-2', 'e1-c2-c2'],
    ['e1', 'e1-c3-2'],
    ['e1', 'e1-c4'],
  ];
  let extractionCalls = 0;
  const provider = {
    name: 'fixture', model: 'merge-id-collision-test', secrets: [],
    complete: async (input: { system: string; user: string }) => {
      if (input.user.includes('完整结构化结果')) {
        return { text: JSON.stringify({ document: { title: '测试资料', main_topic: '渠道', summary: '汇总' } }), finishReason: 'stop', bytes: 20 };
      }
      const chunkIndex = Number(input.user.match(/本次只提供第 (\d+) 段/)?.[1]) - 1;
      const evidenceIds = idsByChunk[chunkIndex];
      assert.ok(evidenceIds);
      assert.ok(evidenceIds.length <= catalogs[chunkIndex].length);
      const sourceEvidence = evidenceIds.map((id, index) => ({ id, locatorId: catalogs[chunkIndex][index].id }));
      const payload = {
        evidence_format_version: 2,
        document: { title: '测试资料', main_topic: '渠道', summary: `分块摘要${chunkIndex}` },
        suggested_pages: [{ title: '相同主题', type: 'concept', category: 'industry_basics', one_line_definition: '渠道证据',
          source_facts: evidenceIds.map(id => ({ text: `块${chunkIndex}事实${id}`, evidenceIds: [id] })),
          ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [], source_evidence: sourceEvidence }],
      };
      extractionCalls += 1;
      return { text: JSON.stringify(payload), finishReason: 'stop', bytes: 100 };
    },
  };
  const outcome = await new LLMService(rulesDir).wikiExtract({ raw: testRaw, body, provider, rulesDir });
  const page = outcome.pages[0];
  const evidenceIds = page.source_evidence.map(item => item.id);
  assert.equal(extractionCalls, 4);
  assert.equal(outcome.chunkCount, 4);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length, '聚合后的证据ID必须全局唯一');
  for (const generated of ['e1-c2-3', 'e1-c2-c2-2', 'e1-c3-3', 'e1-c4-3']) {
    assert.ok(evidenceIds.includes(generated), `碰撞后应稳定选择未占用ID ${generated}`);
  }
  const allIds = new Set(evidenceIds);
  assert.equal(page.source_facts.length, idsByChunk.reduce((sum, ids) => sum + ids.length, 0), '每块的事实均保留');
  for (const fact of page.source_facts) {
    assert.equal(fact.evidenceIds.length, 1);
    assert.ok(allIds.has(fact.evidenceIds[0]), `事实 ${fact.text} 的证据引用必须保留并解析`);
  }
  assert.ok(page.source_evidence.every(item => body.slice(item.start, item.end) === item.quote), '重命名不改变来源区间或原文引文');
});

test('locator v2和legacy：未知/跨chunk/混合定位与页间证据引用均fail closed', async () => {
  const body = '第一句证据。第二句证据。';
  const catalog = buildEvidenceLocatorCatalog(body, chunkText(body, budgets)[0]);
  const invalid = async (payload: unknown, sourceBody = body) => rejection(new LLMService(rulesDir).wikiExtract({
    raw: testRaw, body: sourceBody, rulesDir,
    provider: { name: 'fixture', model: 'invalid', secrets: [], complete: async () => ({ text: JSON.stringify(payload), finishReason: 'stop', bytes: 10 }) },
  }));
  const unknown = await invalid({ ...extractionReply([{ id: 'e1', locatorId: 'c1-l999' }]), evidence_format_version: 2 });
  assert.equal(unknown.code, 'LLM_EVIDENCE_UNKNOWN_LOCATOR');
  const mixed = await invalid({ ...extractionReply([{ id: 'e1', locatorId: catalog[0].id, quote: '第一句证据。' }]), evidence_format_version: 2 });
  assert.equal(mixed.code, 'LLM_SCHEMA_INVALID');
  const extraRawId = await invalid({ ...extractionReply([{ id: 'e1', locatorId: catalog[0].id, rawId: testRaw.id }]), evidence_format_version: 2 });
  assert.equal(extraRawId.code, 'LLM_SCHEMA_INVALID', 'v2 rawId由当前Raw绑定，不接受模型额外指定');
  const missingLocator = await invalid({ ...extractionReply([{ id: 'e1' }]), evidence_format_version: 2 });
  assert.equal(missingLocator.code, 'LLM_SCHEMA_INVALID');
  const missingRef = await invalid({ ...extractionReply([{ id: 'e1', locatorId: catalog[0].id }]), evidence_format_version: 2, suggested_pages: [{ ...extractionReply([{ id: 'e1', locatorId: catalog[0].id }]).suggested_pages[0], source_facts: [{ text: '事实', evidenceIds: ['missing'] }] }] });
  assert.equal(missingRef.code, 'LLM_EVIDENCE_UNKNOWN_ID');

  const crossChunkBody = '甲'.repeat(8000) + '😀末块句。';
  const otherChunkId = 'c2-l001';
  const crossChunk = await invalid({ ...extractionReply([{ id: 'e1', locatorId: otherChunkId }]), evidence_format_version: 2 }, crossChunkBody);
  assert.equal(crossChunk.code, 'LLM_EVIDENCE_UNKNOWN_LOCATOR');

  const crossPagePayload = {
    document: { title: '测试资料', main_topic: '测试主题', summary: '测试摘要' },
    suggested_pages: [
      { ...extractionReply([{ id: 'e1', locatorId: catalog[0].id }]).suggested_pages[0], title: '页一' },
      { ...extractionReply([{ id: 'e2', locatorId: catalog[1]?.id ?? catalog[0].id }]).suggested_pages[0], title: '页二', source_facts: [{ text: '错误跨页引用', evidenceIds: ['e1'] }] },
    ], evidence_format_version: 2,
  };
  const crossPage = await invalid(crossPagePayload);
  assert.equal(crossPage.code, 'LLM_EVIDENCE_UNKNOWN_ID');
  const repeatedLegacy = await invalid(extractionReply([{ id: 'e1', rawId: testRaw.id, quote: '句证据。' }]), '第一句证据。第二句证据。');
  assert.equal(repeatedLegacy.code, 'LLM_EVIDENCE_AMBIGUOUS', '旧quote格式遇到歧义仍严格失败');
  assert.ok(crossChunkBody.length > 8000);
});

test('规则：schema 与 fmcg-schema 枚举一致、预算与冻结契约一致、system prompt 含规则与结构', async () => {
  const bundle = await loadExtractionRules(rulesDir);
  assert.deepEqual(bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum, ['concept', 'entity', 'business_process', 'metric']);
  assert.equal(bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum?.length, 13);
  assert.equal(bundle.schema.additionalProperties, false);
  assert.equal(bundle.schema.properties?.suggested_pages?.items?.additionalProperties, false);
  assert.deepEqual(bundle.rules.budgets, FROZEN_BUDGETS);
  assert.match(bundle.rulesVersion, new RegExp(`^b04-b04-1-locator-v2-${KB02_PROMPT_REVISION}-[0-9a-f]{12}-[0-9a-f]{8}$`));
  const prompt = buildSystemPrompt(bundle.rules, bundle.schema);
  assert.match(prompt, /只输出一个 JSON 对象/);
  assert.match(prompt, /一个条目只解决一个明确的知识问题/);
  assert.match(prompt, /suggested_pages/);
  assert.match(prompt, /不要把|不执行/, 'system prompt 必须说明资料中的指令不被执行');
});

test('规则：schema 与 fmcg 枚举不一致或预算漂移时启动即失败', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), '.test-b04-rules-'));
  try {
    await writeFile(path.join(temporary, 'fmcg-schema.yaml'), 'domain: fmcg\ntypes: []\ncategories: []\nenums: {}\n', 'utf8');
    await writeFile(path.join(temporary, 'wiki-extract.schema.json'), JSON.stringify({ type: 'object', properties: { suggested_pages: { items: { properties: { type: { enum: ['concept'] }, category: { enum: ['x'] } } } } } }), 'utf8');
    await writeFile(path.join(temporary, 'extraction-rules.yaml'), await readFile(path.join(rulesDir, 'extraction-rules.yaml'), 'utf8'), 'utf8');
    await writeFile(path.join(temporary, 'kb02-facts.schema.json'), await readFile(path.join(rulesDir, 'kb02-facts.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(temporary, 'kb02-semantic-review.schema.json'), await readFile(path.join(rulesDir, 'kb02-semantic-review.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(temporary, 'kb02-planning.schema.json'), await readFile(path.join(rulesDir, 'kb02-planning.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(temporary, 'source-policy.yaml'), await readFile(path.join(rulesDir, 'source-policy.yaml'), 'utf8'), 'utf8');
    const mismatch = await rejection(loadExtractionRules(temporary));
    assert.equal(mismatch.code, 'LLM_RULES_INVALID');
  } finally { await rm(temporary, { recursive: true, force: true }); }

  const drifted = await mkdtemp(path.join(os.tmpdir(), '.test-b04-rules-'));
  try {
    await writeFile(path.join(drifted, 'fmcg-schema.yaml'), await readFile(path.join(rulesDir, 'fmcg-schema.yaml'), 'utf8'), 'utf8');
    await writeFile(path.join(drifted, 'wiki-extract.schema.json'), await readFile(path.join(rulesDir, 'wiki-extract.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(drifted, 'extraction-rules.yaml'), 'version: x\nrole: r\ninstructions: [a]\nbudgets: {maxChunkChars: 1}\n', 'utf8');
    await writeFile(path.join(drifted, 'kb02-facts.schema.json'), await readFile(path.join(rulesDir, 'kb02-facts.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(drifted, 'kb02-semantic-review.schema.json'), await readFile(path.join(rulesDir, 'kb02-semantic-review.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(drifted, 'kb02-planning.schema.json'), await readFile(path.join(rulesDir, 'kb02-planning.schema.json'), 'utf8'), 'utf8');
    await writeFile(path.join(drifted, 'source-policy.yaml'), await readFile(path.join(rulesDir, 'source-policy.yaml'), 'utf8'), 'utf8');
    const driftedError = await rejection(loadExtractionRules(drifted));
    assert.equal(driftedError.code, 'LLM_RULES_INVALID');
  } finally { await rm(drifted, { recursive: true, force: true }); }
});

test('结构校验：未知字段、错误枚举、错误类型、缺字段都被拒绝', async () => {
  const bundle = await loadExtractionRules(rulesDir);
  const valid = {
    document: { title: 't', main_topic: 'm', summary: 's' },
    suggested_pages: [{
      title: '概念', type: 'concept', category: 'industry_basics', one_line_definition: 'd',
      source_facts: [{ text: 'f', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [],
      source_evidence: [{ id: 'e1', rawId: 'r', quote: 'q' }],
    }],
  };
  assert.deepEqual(validateSchema(valid, bundle.schema), []);
  const unknownTop = validateSchema({ ...valid, extra: 1 }, bundle.schema);
  assert.ok(unknownTop.some(item => item.includes('未允许的字段 extra')));
  const unknownPage = validateSchema({ ...valid, suggested_pages: [{ ...valid.suggested_pages[0], extra: true }] }, bundle.schema);
  assert.ok(unknownPage.some(item => item.includes('未允许的字段 extra')));
  const badType = validateSchema({ ...valid, suggested_pages: [{ ...valid.suggested_pages[0], type: 'source' }] }, bundle.schema);
  assert.ok(badType.some(item => item.includes('不在允许的枚举内')));
  const badCategory = validateSchema({ ...valid, suggested_pages: [{ ...valid.suggested_pages[0], category: 'nope' }] }, bundle.schema);
  assert.ok(badCategory.some(item => item.includes('不在允许的枚举内')));
  const missing = validateSchema({ document: valid.document, suggested_pages: [{ title: 'x', type: 'concept' }] }, bundle.schema);
  assert.ok(missing.some(item => item.includes('缺少必需字段')));
  const emptyPages = validateSchema({ ...valid, suggested_pages: [] }, bundle.schema);
  assert.ok(emptyPages.some(item => item.includes('少于最小数量 1')));
  const tooMany = validateSchema({ ...valid, suggested_pages: Array.from({ length: 51 }, () => valid.suggested_pages[0]) }, bundle.schema);
  assert.ok(tooMany.some(item => item.includes('超过最大数量 50')));
  const emptyFactText = validateSchema({ ...valid, suggested_pages: [{ ...valid.suggested_pages[0], source_facts: [{ text: '', evidenceIds: ['e1'] }] }] }, bundle.schema);
  assert.ok(emptyFactText.some(item => item.includes('最小长度 1')));
});

test('证据定位：唯一匹配取全局索引，重复出现报歧义，找不到/越界/跨块明确失败', () => {
  const body = '第一段内容。动销率 62% 是本文重点。\n第二段：动销率 62% 再次出现。\n最后一段。';
  const chunk = { index: 0, start: 0, end: body.length, text: body };
  const unique = locateEvidence({ id: 'e1', rawId: 'raw-1', quote: '第一段内容。' }, { body, rawId: 'raw-1', chunk });
  assert.deepEqual({ start: unique.start, end: unique.end }, { start: 0, end: 6 });
  assert.equal(body.slice(unique.start, unique.end), '第一段内容。');

  const ambiguous = (() => { try { locateEvidence({ id: 'e1', rawId: 'raw-1', quote: '动销率 62%' }, { body, rawId: 'raw-1', chunk }); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(ambiguous?.code, 'LLM_EVIDENCE_AMBIGUOUS');
  assert.equal(ambiguous?.details && (ambiguous.details as { occurrences: number }).occurrences, 2);

  const hintStart = body.indexOf('动销率 62%', body.indexOf('第二段'));
  const hinted = locateEvidence({ id: 'e2', rawId: 'raw-1', quote: '动销率 62%', start: hintStart, end: hintStart + '动销率 62%'.length }, { body, rawId: 'raw-1', chunk });
  assert.ok(hinted.start > body.indexOf('第二段'));
  assert.equal(body.slice(hinted.start, hinted.end), '动销率 62%');

  const notFound = (() => { try { locateEvidence({ id: 'e1', rawId: 'raw-1', quote: '不存在的片段' }, { body, rawId: 'raw-1', chunk }); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(notFound?.code, 'LLM_EVIDENCE_QUOTE_NOT_FOUND');

  const wrongRaw = (() => { try { locateEvidence({ id: 'e1', rawId: 'other', quote: '第一段内容。' }, { body, rawId: 'raw-1', chunk }); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(wrongRaw?.code, 'LLM_EVIDENCE_INVALID_SOURCE');

  const halfChunk = { index: 1, start: 40, end: body.length, text: body.slice(40) };
  const outside = (() => { try { locateEvidence({ id: 'e1', rawId: 'raw-1', quote: '第一段内容。' }, { body, rawId: 'raw-1', chunk: halfChunk }); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(outside?.code, 'LLM_EVIDENCE_OUTSIDE_CHUNK');

  const surrogateBody = '正文😀继续';
  // A broken half-pair hint is never trusted; the quote is still located at its unique position.
  const fixedBySearch = locateEvidenceInBody({ id: 'e1', rawId: 'r', quote: '😀', start: 2, end: 3 }, surrogateBody, 'r');
  assert.deepEqual([fixedBySearch.start, fixedBySearch.end], [2, 4]);
  const brokenHintAmbiguous = (() => { try { locateEvidenceInBody({ id: 'e1', rawId: 'r', quote: '😀', start: 0, end: 1 }, '😀正文😀', 'r'); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(brokenHintAmbiguous?.code, 'LLM_EVIDENCE_AMBIGUOUS', '无效提示 + 多处匹配必须报歧义');
  const whole = locateEvidenceInBody({ id: 'e1', rawId: 'r', quote: '😀', start: 2, end: 4 }, surrogateBody, 'r');
  assert.deepEqual([whole.start, whole.end], [2, 4]);
  assert.equal(surrogateBody.slice(2, 4), '😀');
  assert.deepEqual(allOccurrences('aaa', 'a'), [0, 1, 2]);
});

test('证据引用：重复 id 与未知引用被拒绝', () => {
  const duplicate = (() => { try { validateEvidenceReferences('页', [{ text: 'f', evidenceIds: ['e1'] }], [{ id: 'e1' }, { id: 'e1' }]); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(duplicate?.code, 'LLM_EVIDENCE_DUPLICATE_ID');
  const unknown = (() => { try { validateEvidenceReferences('页', [{ text: 'f', evidenceIds: ['e9'] }], [{ id: 'e1' }]); } catch (error) { return error as LlmError; } return undefined; })();
  assert.equal(unknown?.code, 'LLM_EVIDENCE_UNKNOWN_ID');
});

test('配置：环境变量优先于本地文件、摘要只给掩码与主机', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), '.test-b04-config-'));
  const file = path.join(temporary, '.env.local');
  try {
    await writeFile(file, [
      '# 注释', `${LLM_ENV.baseUrl}=https://file.example.com/v1`, `${LLM_ENV.model}=file-model`, `${LLM_ENV.apiKey}="file-key-value"`,
    ].join('\n'), 'utf8');
    const parsed = await readLocalEnvFile(file);
    assert.equal(parsed[LLM_ENV.apiKey], 'file-key-value');
    const fromFile = await loadLlmConfig({ env: {}, filePath: file });
    assert.deepEqual({ baseUrl: fromFile.baseUrl, model: fromFile.model, source: fromFile.source }, { baseUrl: 'https://file.example.com/v1', model: 'file-model', source: 'local-file' });
    const fromEnv = await loadLlmConfig({ env: { [LLM_ENV.baseUrl]: 'https://env.example.com/v1', [LLM_ENV.model]: 'env-model', [LLM_ENV.apiKey]: 'env-key' }, filePath: file });
    assert.equal(fromEnv.baseUrl, 'https://env.example.com/v1');
    assert.equal(fromEnv.model, 'env-model');
    assert.equal(fromEnv.source, 'env');
    const summary = llmConfigSummary(fromEnv, file);
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('env-key'), false, '配置摘要绝不能包含 Key');
    assert.equal(summary.keyConfigured, true);
    assert.equal(summary.keyMask, KEY_MASK);
    assert.equal(summary.baseUrlHost, 'env.example.com');
    assert.equal(summary.configured, true);
    const empty = llmConfigSummary(await loadLlmConfig({ env: {}, filePath: path.join(temporary, 'missing.env') }), file);
    assert.equal(empty.configured, false);
    assert.equal(empty.keyConfigured, false);
    assert.deepEqual(empty.missing.sort(), [LLM_ENV.apiKey, LLM_ENV.baseUrl, LLM_ENV.model].sort());
    assert.equal(empty.source, 'none');
    assert.equal(empty.baseUrlHost, null);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('Provider 适配器：真实 HTTP 下的超时、响应超限、鉴权与截断都以明确错误码失败', async () => {
  const fake = await startFakeProvider(() => ({ kind: 'delay', ms: 300, content: '{}' }));
  try {
    const provider = new OpenAiCompatibleProvider({ baseUrl: fake.url, model: 'fake-model', apiKey: 'test-key', source: 'env' });
    const timeout = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 80, maxOutputBytes: 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(timeout?.code, 'LLM_TIMEOUT');
    assert.equal(timeout?.status, 504);
    assert.equal(JSON.stringify(timeout?.message).includes('test-key'), false);

    fake.setHandler(() => ({ kind: 'status', status: 429, body: { error: { message: 'slow down' } } }));
    const limited = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 5000, maxOutputBytes: 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(limited?.code, 'LLM_RATE_LIMITED');
    assert.equal(limited?.status, 429);

    fake.setHandler(() => ({ kind: 'status', status: 401, body: { error: { message: 'bad key test-key-should-not-leak-123456' } } }));
    const unauthorized = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 5000, maxOutputBytes: 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(unauthorized?.code, 'LLM_AUTH_FAILED');
    assert.equal(unauthorized?.status, 401);
    assert.equal(String(unauthorized?.message).includes('test-key-should-not-leak'), false, '鉴权错误必须脱敏');

    fake.setHandler(() => ({ kind: 'content', content: 'x'.repeat(2 * 1024 * 1024 + 10) }));
    const tooLarge = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 10_000, maxOutputBytes: 2 * 1024 * 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(tooLarge?.code, 'LLM_RESPONSE_TOO_LARGE');

    fake.setHandler(() => ({ kind: 'content', content: '{"a":1}', finishReason: 'length' }));
    const truncated = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(truncated?.code, 'LLM_OUTPUT_TRUNCATED');

    fake.setHandler(() => ({ kind: 'content', content: '   ' }));
    const empty = await (async () => {
      try { await provider.complete({ system: 's', user: 'u', timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(empty?.code, 'LLM_EMPTY_RESULT');

    const offline = new OpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'k', source: 'env' });
    const network = await (async () => {
      try { await offline.complete({ system: 's', user: 'u', timeoutMs: 3000, maxOutputBytes: 1024 }); }
      catch (error) { return error as LlmError; }
      return undefined;
    })();
    assert.equal(network?.code, 'LLM_NETWORK_ERROR');
  } finally { await fake.close(); }
});

test('渲染：事实/整理/推断/问题/证据分节，Source 是摘要而非全文', () => {
  const page: DraftPage = {
    pageId: 'p1', title: '动销率', type: 'metric', category: 'metric', one_line_definition: '衡量门店动销的指标',
    source_facts: [{ text: '动销率 62%', evidenceIds: ['e1'] }], ai_organized: ['整理一句话'], ai_inferences: ['推断一句话'],
    related_pages: ['库存周转'], open_questions: ['口径待确认'],
    source_evidence: [{ id: 'e1', rawId: 'r1', quote: '动销率 62%', start: 3, end: 12, chunkIndex: 0 }],
    knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'C', selected: true, provenance: [],
  };
  const body = renderPageBody(page, { sourceTitle: '来源：报告', rawId: 'r1', createdTitles: new Set(['动销率', '库存周转', '来源：报告']) });
  for (const section of ['## 一句话说明', '## 来源事实', '## AI 整理', '## AI 推断', '## 待确认问题', '## 来源证据', '## 关联', '## 来源']) {
    assert.ok(body.includes(section), `缺少分节 ${section}`);
  }
  assert.match(body, /动销率 62%（证据 e1）/);
  assert.match(body, /\[\[库存周转\]\]/);
  assert.match(body, /\[\[来源：报告\]\]（Raw r1）/);
  const source = renderSourceBody(
    { title: '来源：报告', category: 'other', summary: '摘要内容', key_takeaways: ['要点一'], body: '', knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C' },
    { rawId: 'r1', title: '原始标题', sourceType: 'report', sourceName: '某行业报告', author: '张三', publishedAt: '2026-09-01', url: 'https://example.com/r1', importedAt: '2026-10-05T00:00:00.000Z' },
    [page],
  );
  assert.match(source, /## 来源信息/);
  assert.match(source, /来源类型：行业报告（report）/);
  assert.match(source, /来源名称：某行业报告/);
  assert.match(source, /作者：张三/);
  assert.match(source, /原发布日期：2026-09-01/);
  assert.match(source, /原始链接：https:\/\/example\.com\/r1/);
  assert.match(source, /## 摘要/);
  assert.match(source, /## Key Takeaways/);
  assert.match(source, /## 涉及指标[\s\S]*\[\[动销率\]\]/);
  assert.match(source, /原始标题（Raw r1）/);
  assert.equal(source.includes('原文完整内容'), false);
});


