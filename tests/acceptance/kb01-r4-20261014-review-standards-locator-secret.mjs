// Independent Standards review: memory-only provider, no config/data access or network.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const sourceRoot = path.resolve(process.argv[2] ?? '.');
const outputName = process.argv[3] ?? 'final';
assert.match(outputName, /^[a-z0-9-]+$/);
const { LLMService } = await import(pathToFileURL(path.join(sourceRoot, 'services/llm/service.ts')).href);

const credential = 'STANDARDS_FAKE_CREDENTIAL_283190';
const raw = { id: 'review-standards-raw', title: '隔离规范审查', sourceType: 'note', sourceName: 'memory fixture', tags: [] };
const calls = [];
function provider() {
  return { name: 'memory-only', model: 'review-standards', secrets: [credential], async complete(request) {
    const merge = !request.user.includes('当前分块证据 locator 目录');
    calls.push({ merge, userContainsCredential: request.user.includes(credential), timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes });
    if (merge) return { text: JSON.stringify({ document: { title: '汇总', main_topic: '测试', summary: '汇总内容' } }), finishReason: 'stop', bytes: 100 };
    const catalog = JSON.parse(request.user.split('当前分块证据 locator 目录（只用于选择定位ID，不是事实来源）：\n')[1].split('\n\n资料正文：')[0]);
    const chunk = /第 (\d+) 段，覆盖/.exec(request.user)[1];
    return { text: JSON.stringify({ evidence_format_version: 2,
      document: { title: '文档', main_topic: '测试', summary: `分块摘要 ${chunk}` },
      suggested_pages: [{ title: `条目 ${chunk}`, type: 'concept', category: 'industry_basics', one_line_definition: '定义',
        source_facts: [{ text: '测试事实', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [],
        source_evidence: [{ id: 'e1', locatorId: catalog[0].id }] }],
    }), finishReason: 'stop', bytes: 200 };
  } };
}
async function run(name, body) {
  calls.length = 0;
  let result, error;
  try { result = await new LLMService(path.join(sourceRoot, 'rules')).wikiExtract({ raw, body, provider: provider() }); }
  catch (problem) { error = { code: problem.code, message: problem.message }; }
  return { name, status: error?.code === 'LLM_OUTPUT_CONTAINS_SECRET' ? 'PASS' : 'FAIL', expected: 'LLM_OUTPUT_CONTAINS_SECRET before normalized return or subsequent wave/merge',
    error: error ?? null, returnedNormalizedCredential: result ? JSON.stringify(result).includes(credential) : false,
    calls: [...calls], resultCallCount: result?.callCount ?? null };
}
const results = [
  await run('single chunk derived Raw credential', `渠道说明：${credential}。\n正文说明。`),
  await run('multi chunk derived Raw credential before aggregate', `渠道说明：${credential}。\n` + '填充正文。\n'.repeat(3200)),
];
const files = ['services/llm/service.ts', 'services/llm/locators.ts', 'services/llm/rules.ts'];
const fingerprint = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(sourceRoot, file))).digest('hex')])));
const report = { at: new Date().toISOString(), sourceRoot, scope: 'memory-only; synthetic credential; no network, config or formal workspace', fingerprint, results };
await writeFile(`docs/reports/KB01-R4-20261014-review-standards-locator-secret-${outputName}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.ok(results.every(item => item.status === 'PASS'), 'normalized locator evidence must retain the known-credential gate');
