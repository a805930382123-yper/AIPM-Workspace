import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
// B02 independent acceptance: real public HTTP + Markdown assets, no product imports.
// Run only after frozen handoff: node tests/acceptance/b02-http.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, mkdir, rename, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runTag = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const evidencePath = path.join(root, 'docs/reports/B02-api-evidence.json');
const archivedEvidencePath = path.join(root, `docs/reports/B02-api-${runTag}.json`);
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fmcg-b02-acceptance-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const report = { startedAt: new Date().toISOString(), dataRoot, evidencePath, archivedEvidencePath, version: {}, checks: [], notes: ['Public HTTP/file evidence only; main agent supplies real browser evidence.', 'Isolated fixture directories retained; user service/data untouched.'] };
async function filesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full)); else files.push(full);
  }
  return files;
}
async function fingerprint() {
  const result = {};
  const files = ['package.json', 'package-lock.json', ...(await Promise.all(['server', 'services', 'rules'].map(folder => filesUnder(path.join(root, folder))))).flat().map(file => path.relative(root, file))];
  for (const rel of files.sort()) result[rel.replaceAll('\\', '/')] = hash(await readFile(path.join(root, rel)));
  return result;
}
report.version = await fingerprint();
let service;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const blocked = message => Object.assign(new Error(message), { blocked: true });
async function check(id, fn) {
  const started = Date.now();
  try { const evidence = await fn(); report.checks.push({ id, status: 'PASS', elapsedMs: Date.now() - started, evidence }); console.log(`PASS ${id}`); }
  catch (error) { report.checks.push({ id, status: error.blocked ? 'BLOCKED' : 'FAIL', elapsedMs: Date.now() - started, error: String(error.stack || error).slice(0, 5000) }); console.log(`${error.blocked ? 'BLOCKED' : 'FAIL'} ${id}: ${error.message}`); }
}
async function port() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).once('error', reject));
  const result = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return result;
}
async function start(dir) {
  const value = await port();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env: withoutInheritedEmbeddings({ ...process.env, FMCG_DATA_DIR: dir, FMCG_PORT: String(value) }), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = { child, base: `http://127.0.0.1:${value}`, dir, logs: '' };
  child.stdout.on('data', chunk => { result.logs += chunk; });
  child.stderr.on('data', chunk => { result.logs += chunk; });
  let startupError;
  child.on('error', error => { startupError = error; });
  let lastFetchError;
  for (let i = 0; i < 80; i++) {
    if (startupError || child.exitCode !== null) throw blocked(`Server cannot start: ${startupError || result.logs}`);
    try { const response = await fetch(`${result.base}/api/health`, { signal: AbortSignal.timeout(500) }); if (response.ok && (await response.json()).ok) return result; } catch (error) { lastFetchError = error; }
    await delay(100);
  }
  child.kill();
  throw blocked(`Loopback readiness failed: ${lastFetchError?.message}; ${result.logs}`);
}
async function stop() {
  if (!service) return;
  const current = service;
  service = undefined;
  if (current.child.exitCode !== null) return;
  const done = once(current.child, 'exit');
  let timeout;
  try { current.child.kill(); await Promise.race([done, new Promise((_, reject) => { timeout = setTimeout(() => reject(blocked('Server did not stop')), 5000); })]); }
  finally { clearTimeout(timeout); }
}
async function request(url, { method = 'GET', value } = {}) {
  const response = await fetch(`${service.base}${url}`, { method, ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  let json;
  if (text && response.headers.get('content-type')?.includes('json')) json = JSON.parse(text);
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) };
}
const wikiUrl = id => `/api/wiki/${encodeURIComponent(id)}`;
async function getWiki(id) { const response = await request(wikiUrl(id)); assert.equal(response.status, 200); return response.json; }
async function list(q = '', category = '') {
  const response = await request(`/api/wiki?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.json?.items), 'list.items must be an array');
  return response.json;
}
async function snapshotFiles(dir) { const result = {}; for (const file of await filesUnder(dir)) result[path.relative(dir, file).replaceAll('\\', '/')] = hash(await readFile(file)); return result; }
function parseMarkdown(text) {
  assert.match(text, /^---\r?\n/);
  const rest = text.slice(text.indexOf('\n') + 1);
  const closing = /^---\r?\n/m.exec(rest);
  assert.ok(closing, 'frontmatter has a closing delimiter');
  const metadata = yaml.load(rest.slice(0, closing.index));
  for (const key of ['created', 'updated']) if (metadata[key] instanceof Date) metadata[key] = metadata[key].toISOString();
  const content = rest.slice(closing.index + closing[0].length);
  const titleHeading = `# ${metadata.title}\n\n`;
  return { metadata, content, body: content.startsWith(titleHeading) ? content.slice(titleHeading.length) : content };
}
const expectedTypes = ['source', 'concept', 'entity', 'business_process', 'metric', 'synthesis'];
const expectedCategories = ['行业基础', '品类', '渠道', '销售', '门店', '经销商', '供应链', '商品', '数据指标', 'AI应用', '公司业务', '客户', '其他'];
const requiredSections = {
  source: ['摘要', 'Key Takeaways', '涉及概念', '涉及实体', '涉及业务流程', '涉及指标', '重要观点', '待验证内容'],
  concept: ['一句话解释', '定义', '为什么重要', '在业务中的位置', '关键特征', '常见分类', '与其他概念关系', '常见业务场景', '待确认问题'],
  entity: ['一句话说明', '基本信息', '在当前业务中的角色', '相关业务', '相关概念', '相关流程'],
  business_process: ['业务目标', '涉及角色', '触发条件', '输入', '完整流程', '输出', '使用系统', '关键规则', '人工判断点', '异常情况', '痛点', '可能的 AI 机会', '相关指标', '相关知识'],
  metric: ['定义', '业务含义', '计算方式', '适用范围', '数据来源', '如何解读', '常见误区', '相关指标'],
  synthesis: ['主要来源', '一致观点', '冲突', '待确认问题'],
};
let schema;
let rawRecords = [];
let rawHashes;
const records = {};
let searchRecord;
let secondCandidate;
const oldTitle = '验收动销概念';
const commonAlias = '共同别名验收';
function categoryId(label) { const category = schema.categories.find(item => (typeof item === 'string' ? item : item.label) === label); assert.ok(category, label); return typeof category === 'string' ? category : category.id; }
function wikiInput(type = 'concept', changes = {}) {
  const sections = schema.pageTemplates[type].sections;
  return { title: `验收-${type}`, type, category: categoryId('行业基础'), domain: 'fmcg', sources: (type === 'source' ? rawRecords.slice(0, 1) : rawRecords).map(item => item.id), tags: ['验收资料'], aliases: [], knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed', body: sections.map(section => `## ${section.label}\n\n${section.key === 'ai_opportunities' ? '分析建议：' : ''}验收资料；未确认内容保持待确认。`).join('\n\n') + '\n\n## 来源\n\n已关联验收Raw。\n', ...changes };
}
async function createWiki(value) { const response = await request('/api/wiki', { method: 'POST', value }); assert.equal(response.status, 201, JSON.stringify(response.json)); return response.json; }
function assertCategoryCounts(result, items) {
  assert.equal(Object.keys(result.categoryCounts || {}).length, 13, 'all 13 category counts included');
  for (const category of schema.categories) {
    const key = typeof category === 'string' ? category : category.id;
    assert.equal(result.categoryCounts[key], items.filter(item => item.category === key).length, key);
  }
  assert.equal(Object.values(result.categoryCounts).reduce((sum, count) => sum + count, 0), items.length);
}
function link(record, target) { const value = record.links?.find(item => item.target === target); assert.ok(value, `GET detail.links includes ${target}`); return value; }

try {
  service = await start(path.join(dataRoot, 'main'));
  await check('B02-01-schema-rules-six-templates', async () => {
    const response = await request('/api/wiki/schema');
    assert.equal(response.status, 200);
    schema = response.json;
    assert.deepEqual(schema.types.map(item => typeof item === 'string' ? item : item.id).sort(), [...expectedTypes].sort());
    assert.deepEqual(schema.categories.map(item => typeof item === 'string' ? item : item.label).sort(), [...expectedCategories].sort());
    assert.deepEqual(schema.enums.knowledge_status, ['verified', 'source_supported', 'ai_organized', 'inferred', 'needs_verification']);
    assert.deepEqual(schema.enums.confidence, ['high', 'medium', 'low']);
    assert.deepEqual(schema.enums.source_level, ['A', 'B', 'C', 'D']);
    assert.deepEqual(schema.enums.review_status, ['unreviewed', 'reviewed']);
    const ruleTemplates = yaml.load(await readFile(path.join(root, 'rules/page-templates.yaml'), 'utf8')).templates;
    const sections = {};
    for (const type of expectedTypes) {
      assert.deepEqual(schema.pageTemplates[type].sections, ruleTemplates[type].sections, `HTTP ${type} template uses rules`);
      sections[type] = schema.pageTemplates[type].sections.map(section => section.label);
      for (const required of requiredSections[type]) assert.ok(sections[type].includes(required), `${type}: ${required}`);
    }
    return { types: expectedTypes, categories: schema.categories, sections };
  });
  if (!schema?.pageTemplates) throw blocked('Schema response/template contract prerequisite incomplete');
  for (let i = 0; i < 2; i++) {
    const response = await request('/api/raw', { method: 'POST', value: { title: `B02验收原始资料${i + 1}`, sourceType: 'note', sourceName: '独立验收（非业务资料）', author: '测试', publishedAt: '2026-09-27', url: '', tags: ['验收资料'], body: ` \r\nRaw事实${i + 1}：库存与动销。\n---\n正文不能被Wiki改写。\r\n ` } });
    assert.equal(response.status, 201);
    rawRecords.push(response.json);
  }
  rawHashes = await snapshotFiles(path.join(service.dir, 'knowledge/raw'));

  await check('B02-02-six-types-frontmatter-source', async () => {
    const titles = { source: '../验收来源摘要', concept: oldTitle, entity: '验收业务实体', business_process: '验收门店补货流程', metric: '验收库存周转率', synthesis: '验收渠道综合' };
    for (const type of expectedTypes) {
      const value = wikiInput(type, { title: titles[type], aliases: type === 'concept' ? ['动销别名验收', commonAlias] : [], ...(type === 'entity' ? { body: `验收实体正文。\n[[${oldTitle}]] [[${commonAlias}]] [[验收不存在]]` } : {}) });
      const created = await createWiki(value);
      records[type] = created;
      assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(created.revision, 1);
      assert.equal(created.domain, 'fmcg');
      assert.equal(created.type, type);
      const detail = await getWiki(created.id);
      const file = path.join(service.dir, 'knowledge/wiki', `${created.id}.md`);
      const parsed = parseMarkdown(await readFile(file, 'utf8'));
      for (const key of ['id', 'title', 'type', 'domain', 'category', 'created', 'updated', 'sources', 'tags', 'knowledge_status', 'confidence', 'source_level', 'review_status', 'aliases', 'revision']) {
        assert.ok(Object.hasOwn(parsed.metadata, key), `${type} ${key}`);
        assert.deepEqual(parsed.metadata[key], detail[key], `${type} ${key}`);
      }
      assert.equal(parsed.body, value.body);
      assert.equal(detail.body, value.body);
      assert.deepEqual(detail.sources, value.sources);
    }
    for (const raw of rawRecords) assert.deepEqual((await request(`/api/raw/${raw.id}`)).json, raw);
    assert.deepEqual(await snapshotFiles(path.join(service.dir, 'knowledge/raw')), rawHashes);
    return { records: Object.fromEntries(Object.entries(records).map(([type, item]) => [type, { id: item.id, revision: item.revision, sources: item.sources }])), rawHashes };
  });
  if (!records.concept || !records.entity || !records.metric) throw blocked('Six-page fixture creation incomplete');

  await check('B02-03-invalid-status-source-no-write', async () => {
    const before = await snapshotFiles(service.dir);
    const cases = [
      ['verified-no-source', { knowledge_status: 'verified', sources: [] }],
      ['supported-no-source', { knowledge_status: 'source_supported', sources: [] }],
      ['verified-unreviewed', { knowledge_status: 'verified', review_status: 'unreviewed' }],
      ['missing-raw', { sources: ['00000000-0000-4000-8000-000000000000'] }],
      ['invalid-type', { type: 'chart' }], ['invalid-category', { category: 'unknown' }],
      ['invalid-confidence', { confidence: '100' }], ['invalid-source-level', { source_level: 'Z' }],
      ['blank-title', { title: ' \n ' }], ['invalid-aliases', { aliases: '别名' }],
    ];
    const errors = [];
    for (const [name, changes] of cases) {
      const response = await request('/api/wiki', { method: 'POST', value: wikiInput('concept', changes) });
      assert.ok(response.status >= 400 && response.status < 500, name);
      assert.ok(response.json?.error?.code, name);
      assert.ok(response.json?.error?.message, name);
      assert.deepEqual(await snapshotFiles(service.dir), before, `${name} must not write any asset`);
      errors.push({ name, status: response.status, error: response.json.error });
    }
    const minimal = await createWiki({ title: '验收默认状态', type: 'concept', category: categoryId('其他'), sources: [], body: '待确认；无来源。' });
    assert.equal(minimal.knowledge_status, 'needs_verification');
    assert.equal(minimal.review_status, 'reviewed');
    assert.equal(minimal.revision, 1);
    const supportedUnreviewed = await createWiki(wikiInput('concept', { title: '验收来源支持未审核', review_status: 'unreviewed' }));
    assert.equal(supportedUnreviewed.knowledge_status, 'source_supported');
    assert.equal(supportedUnreviewed.review_status, 'unreviewed');
    const verified = await createWiki(wikiInput('concept', { title: '验收有来源人工核验', knowledge_status: 'verified', confidence: 'high', source_level: 'A' }));
    assert.equal(verified.knowledge_status, 'verified');
    assert.equal(verified.confidence, 'high');
    assert.equal(verified.source_level, 'A');
    return { errors, defaultRecord: { id: minimal.id, knowledge_status: minimal.knowledge_status, review_status: minimal.review_status }, supportedUnreviewedId: supportedUnreviewed.id, verifiedId: verified.id };
  });
  await check('B02-04-update-stale-and-concurrent-revision', async () => {
    const previous = await getWiki(records.concept.id);
    const revisedBody = ' \r\n## 定义\n验收编辑正文。\n---\n<script>只应作为文本</script>\n ';
    const response = await request(wikiUrl(previous.id), { method: 'PUT', value: { ...previous, title: '验收门店动销', body: revisedBody, baseRevision: previous.revision } });
    assert.equal(response.status, 200);
    records.concept = response.json;
    assert.equal(response.json.revision, previous.revision + 1);
    assert.equal(response.json.created, previous.created);
    assert.equal(response.json.body, revisedBody);
    assert.ok(response.json.aliases.includes(oldTitle), 'rename retains previous title alias');
    const snapshot = await snapshotFiles(service.dir);
    const staleUpdate = await request(wikiUrl(previous.id), { method: 'PUT', value: { ...previous, title: '过期更新不得生效', baseRevision: previous.revision } });
    const staleDelete = await request(wikiUrl(previous.id), { method: 'DELETE', value: { baseRevision: previous.revision } });
    assert.equal(staleUpdate.status, 409);
    assert.equal(staleDelete.status, 409);
    assert.deepEqual(await snapshotFiles(service.dir), snapshot);
    const metric = await getWiki(records.metric.id);
    const race = await Promise.all(['甲', '乙'].map(marker => request(wikiUrl(metric.id), { method: 'PUT', value: { ...metric, body: `验收并发${marker}`, baseRevision: metric.revision } })));
    assert.deepEqual(race.map(item => item.status).sort(), [200, 409]);
    const after = await getWiki(metric.id);
    assert.equal(after.revision, metric.revision + 1);
    assert.equal(after.created, metric.created);
    assert.equal(after.body, race.find(item => item.status === 200).json.body);
    records.metric = after;
    assert.deepEqual(await snapshotFiles(path.join(service.dir, 'knowledge/raw')), rawHashes);
    return { conceptId: previous.id, revision: response.json.revision, staleStatuses: [staleUpdate.status, staleDelete.status], raceStatuses: race.map(item => item.status), metricRevision: after.revision };
  });
  await check('B02-05-alias-rename-ambiguity-references', async () => {
    const entity = await getWiki(records.entity.id);
    assert.equal(link(entity, oldTitle).status, 'resolved');
    assert.deepEqual(link(entity, oldTitle).candidates.map(item => item.id), [records.concept.id]);
    assert.equal(link(entity, '验收不存在').status, 'missing');
    assert.deepEqual(link(entity, '验收不存在').candidates, []);
    secondCandidate = await createWiki(wikiInput('entity', { title: '验收第二候选', aliases: [commonAlias] }));
    const ambiguous = link(await getWiki(entity.id), commonAlias);
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual(ambiguous.candidates.map(item => item.id).sort(), [records.concept.id, secondCandidate.id].sort());
    const references = await request(`${wikiUrl(records.concept.id)}/references`);
    assert.equal(references.status, 200);
    assert.ok(references.json.items.some(item => item.id === entity.id), 'ambiguous/old-title inbound reference included');
    assert.ok(references.json.items.every(item => typeof item.id === 'string' && typeof item.title === 'string'));
    return { oldTitle, resolvedTargetId: records.concept.id, ambiguous, references: references.json.items };
  });
  await check('B02-06-five-fields-chinese-search', async () => {
    searchRecord = await createWiki(wikiInput('concept', { title: '中文标题独立探针', aliases: ['中文别名独立探针', 'ＫＡ全角探针'], tags: ['中文标签独立探针'], body: '中文正文独立探针', category: categoryId('渠道') }));
    const all = await list();
    assertCategoryCounts(all, all.items);
    const results = [];
    for (const query of ['中文标题独立探针', '中文别名独立探针', '中文标签独立探针', '中文正文独立探针', '渠道', 'KA全角探针']) {
      const result = await list(query);
      assert.ok(result.items.some(item => item.id === searchRecord.id), query);
      assert.deepEqual(result.categoryCounts, all.categoryCounts, 'counts do not depend on search query');
      results.push({ query, ids: result.items.map(item => item.id) });
    }
    const categoryResult = await list('', categoryId('渠道'));
    assert.ok(categoryResult.items.length > 0);
    assert.ok(categoryResult.items.every(item => item.category === categoryId('渠道')));
    const update = await request(wikiUrl(searchRecord.id), { method: 'PUT', value: { ...searchRecord, tags: ['更新标签探针'], body: '更新正文探针', baseRevision: searchRecord.revision } });
    assert.equal(update.status, 200);
    searchRecord = update.json;
    assert.equal((await list('中文正文独立探针')).items.length, 0);
    assert.equal((await list('中文标签独立探针')).items.length, 0);
    assert.ok((await list('更新正文探针')).items.some(item => item.id === searchRecord.id));
    return { results, categoryCounts: all.categoryCounts, categoryIds: categoryResult.items.map(item => item.id), qmdUsed: false };
  });
  await check('B02-07-real-markdown-download', async () => {
    const detail = await getWiki(records.entity.id);
    const response = await request(`${wikiUrl(detail.id)}/export`);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-disposition'] || '', /attachment/i);
    assert.match(response.headers['content-type'] || '', /markdown|plain|octet-stream/i);
    const stored = await readFile(path.join(service.dir, 'knowledge/wiki', `${detail.id}.md`), 'utf8');
    assert.equal(response.text, stored);
    const parsed = parseMarkdown(response.text);
    assert.equal(parsed.metadata.id, detail.id);
    assert.deepEqual(parsed.metadata.sources, detail.sources);
    assert.equal(parsed.body, detail.body);
    assert.ok(parsed.body.includes(`[[${oldTitle}]]`));
    const artifact = path.join(dataRoot, 'downloaded-wiki.md');
    await writeFile(artifact, response.text, 'utf8');
    return { id: detail.id, contentDisposition: response.headers['content-disposition'], artifact, fileSha256: hash(response.text), frontmatter: parsed.metadata };
  });
  await check('B02-08-delete-effects-recycle-and-missing-link', async () => {
    const target = await getWiki(records.concept.id);
    const entity = await getWiki(records.entity.id);
    const referenceFile = path.join(service.dir, 'knowledge/wiki', `${entity.id}.md`);
    const referenceHash = hash(await readFile(referenceFile));
    const before = await list();
    const response = await request(wikiUrl(target.id), { method: 'DELETE', value: { baseRevision: target.revision } });
    assert.ok(response.status === 200 || response.status === 204);
    assert.equal((await request(wikiUrl(target.id))).status, 404);
    const after = await list();
    assert.equal(after.items.length, before.items.length - 1);
    assertCategoryCounts(after, after.items);
    const referencedAfter = await getWiki(entity.id);
    assert.equal(referencedAfter.body, entity.body);
    assert.equal(referencedAfter.revision, entity.revision);
    assert.equal(hash(await readFile(referenceFile)), referenceHash);
    assert.equal(link(referencedAfter, oldTitle).status, 'missing');
    const archiveFiles = (await filesUnder(service.dir)).filter(file => file.includes(target.id) && file.endsWith('.md'));
    assert.equal(archiveFiles.length, 1, 'one archived page preserved');
    assert.ok(!path.relative(path.join(service.dir, 'knowledge/wiki'), archiveFiles[0]).startsWith(`${target.id}.md`));
    assert.ok(path.relative(path.join(service.dir, 'knowledge/wiki'), archiveFiles[0]).startsWith('..'), 'archive outside wiki directory');
    assert.equal(parseMarkdown(await readFile(archiveFiles[0], 'utf8')).metadata.id, target.id);
    return { deletedId: target.id, referenceId: entity.id, referenceHash, archiveFile: archiveFiles[0], wikiCount: after.items.length };
  });
  await check('B02-09-index-log-category-counts', async () => {
    const result = await list();
    assertCategoryCounts(result, result.items);
    const indexFile = path.join(service.dir, 'knowledge/wiki/index.md');
    const index = await readFile(indexFile, 'utf8');
    for (const item of result.items) assert.ok(index.includes(item.title), `index includes ${item.title}`);
    assert.ok(!index.includes(records.concept.id), 'index excludes deleted page');
    const logs = await filesUnder(path.join(service.dir, 'knowledge/logs'));
    assert.ok(logs.length > 0, 'knowledge operation log exists');
    const text = (await Promise.all(logs.map(file => readFile(file, 'utf8')))).join('\n');
    for (const action of ['create', 'update', 'delete']) assert.ok(text.includes(action), `log contains ${action}`);
    assert.ok(text.includes(records.concept.id), 'deleted target remains traceable in log');
    const stats = await request('/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.wikiCount, result.items.length);
    assert.equal(stats.json.rawCount, 2);
    assert.equal(stats.json.thisWeekNewCount, result.items.length + 2);
    return { wikiCount: result.items.length, categoryCounts: result.categoryCounts, indexFile, indexSha256: hash(index), logFiles: logs, logSha256: hash(text), stats: stats.json };
  });
  await check('B02-10-real-write-and-derived-file-failure', async () => {
    const wikiDir = path.join(service.dir, 'knowledge/wiki');
    const backup = path.join(service.dir, 'knowledge/wiki.acceptance-backup');
    const before = await snapshotFiles(service.dir);
    await rename(wikiDir, backup);
    await writeFile(wikiDir, '验收故障：wiki目录位置被文件占用');
    let response;
    try { response = await request('/api/wiki', { method: 'POST', value: wikiInput('concept', { title: '验收失败不得入库' }) }); }
    finally { const blocker = path.join(dataRoot, 'wiki-directory-blocker.txt'); await rename(wikiDir, blocker); await rename(backup, wikiDir); }
    assert.equal(response.status, 500);
    assert.ok(response.json?.error?.code);
    assert.deepEqual(await snapshotFiles(service.dir), before);

    const indexFile = path.join(wikiDir, 'index.md');
    const savedIndex = path.join(dataRoot, 'saved-index.md');
    await rename(indexFile, savedIndex);
    await mkdir(indexFile);
    await writeFile(path.join(indexFile, 'blocker.txt'), '验收故障：阻止index原子替换');
    let derivedResponse;
    try { derivedResponse = await request('/api/wiki', { method: 'POST', value: wikiInput('concept', { title: '验收派生失败恢复' }) }); }
    finally { await rename(indexFile, path.join(dataRoot, 'index-directory-blocker')); await rename(savedIndex, indexFile); }
    assert.equal(derivedResponse.status, 500, 'derived write failure must not be reported as success');
    assert.ok(derivedResponse.json?.error?.code);
    const survivor = (await list()).items.find(item => item.title === '验收派生失败恢复');
    const recovery = await createWiki(wikiInput('concept', { title: '验收派生恢复触发' }));
    const rebuiltIndex = await readFile(indexFile, 'utf8');
    assert.ok(rebuiltIndex.includes(recovery.title));
    if (survivor) assert.ok(rebuiltIndex.includes(survivor.title), 'surviving committed page reappears in recovered index');
    assert.ok(!(await filesUnder(wikiDir)).some(file => file.endsWith('.tmp')));
    assert.deepEqual(await snapshotFiles(path.join(service.dir, 'knowledge/raw')), rawHashes);
    return { mainFailureStatus: response.status, derivedFailureStatus: derivedResponse.status, survivorId: survivor?.id || null, recoveryId: recovery.id, rawHashesUnchanged: true };
  });
  await check('B02-11-restart-wiki-and-raw-preservation', async () => {
    const before = await list();
    const detailedBefore = await Promise.all(before.items.map(item => getWiki(item.id)));
    const wikiHashes = await snapshotFiles(path.join(service.dir, 'knowledge/wiki'));
    const currentDir = service.dir;
    await stop();
    service = await start(currentDir);
    const after = await list();
    assert.deepEqual(after, before);
    assert.deepEqual(await Promise.all(after.items.map(item => getWiki(item.id))), detailedBefore);
    const actualWikiHashes = await snapshotFiles(path.join(service.dir, 'knowledge/wiki'));
    for (const [file, digest] of Object.entries(wikiHashes)) if (file !== 'index.md') assert.equal(actualWikiHashes[file], digest, file);
    assert.deepEqual(await snapshotFiles(path.join(service.dir, 'knowledge/raw')), rawHashes);
    for (const raw of rawRecords) assert.deepEqual((await request(`/api/raw/${raw.id}`)).json, raw);
    return { wikiCount: before.items.length, preservedWikiHashes: wikiHashes, rawHashes, noLlmRequired: true };
  });
  await check('B02-12-created-field-shanghai-week-stats', async () => {
    await stop();
    service = await start(path.join(dataRoot, 'created-week-boundaries'));
    const shifted = new Date(Date.now() + 8 * 3600000);
    const localDay = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    const startUtc = localDay - ((shifted.getUTCDay() + 6) % 7) * 86400000 - 8 * 3600000;
    const dates = [startUtc - 1000, startUtc, startUtc + 1000, startUtc + 7 * 86400000];
    const samples = [];
    for (const milliseconds of dates) {
      const record = await createWiki(wikiInput('concept', { title: '验收Wiki周界', sources: [], knowledge_status: 'needs_verification' }));
      const file = path.join(service.dir, 'knowledge/wiki', `${record.id}.md`);
      const text = await readFile(file, 'utf8');
      const created = new Date(milliseconds).toISOString();
      assert.match(text, /^created:.*$/m);
      await writeFile(file, text.replace(/^created:.*$/m, `created: '${created}'`), 'utf8');
      samples.push({ id: record.id, created });
    }
    const stats = await request('/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.rawCount, 0);
    assert.equal(stats.json.wikiCount, 4);
    assert.equal(stats.json.thisWeekNewCount, 2, 'created supports actual Shanghai [start,end) range');
    const result = await list();
    assertCategoryCounts(result, result.items);
    assert.equal(result.items.length, 4, 'index.md excluded');
    return { samples, stats: stats.json, categoryCounts: result.categoryCounts };
  });
} catch (error) {
  report.checks.push({ id: 'HARNESS-PREREQUISITE', status: error.blocked ? 'BLOCKED' : 'FAIL', error: String(error.stack || error).slice(0, 5000) });
} finally {
  try { await stop(); } catch (error) { report.notes.push(`Server stop issue: ${error.message}`); }
  const current = await fingerprint();
  if (JSON.stringify(current) !== JSON.stringify(report.version)) report.checks.push({ id: 'FROZEN-VERSION', status: 'BLOCKED', changed: [...new Set([...Object.keys(current), ...Object.keys(report.version)])].filter(file => current[file] !== report.version[file]) });
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(status => [status, report.checks.filter(check => check.status === status).length]));
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const content = JSON.stringify(report, null, 2) + '\n';
  await writeFile(archivedEvidencePath, content);
  await writeFile(evidencePath, content);
  console.log(JSON.stringify({ summary: report.summary, evidencePath, archivedEvidencePath, dataRoot }));
  process.exitCode = report.summary.FAIL || report.summary.BLOCKED ? 1 : 0;
}
