// B07 construction self-test: the whole Prompt Library exercised over real HTTP against a
// throwaway FMCG_DATA_DIR on a free port, with no LLM configured at all.
//
// Run:  node tests/b07-prompt-http.mjs
// Output: docs/reports/B07-builder-http-evidence.json  (plus a short console log)
//
// This is a *construction* self-test, not independent acceptance: it is written by the same agent
// that wrote the product code. Its results must never be reported as an independent PASS.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import {
  createHarness,
  createRecorder,
  delay,
  digest,
  expectError,
  expectJson,
  fileSnapshot,
  promptInput,
  request,
  toEditInput,
  uuid,
} from './b07-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const evidenceDir = path.join(repo, 'docs', 'reports');
const faultHook = path.join(here, 'b07-fault-hook.mjs');

const CATEGORIES = ['industry_learning', 'business_analysis', 'customer', 'product', 'ai', 'office'];
const CATEGORY_LABELS = ['行业学习', '业务分析', '客户', '产品', 'AI', '日常办公'];

const recorder = createRecorder();
const startedAt = new Date().toISOString();
const t0 = Date.now();

const harness = await createHarness({ faultHook });
const root = harness.root;
const promptDir = path.join(root, 'prompts');
const recycleDir = path.join(promptDir, 'recycle');
const knowledgeLog = path.join(root, 'knowledge', 'logs', 'wiki.jsonl');
let service = await harness.start();

const create = async (input = promptInput(), requestId = uuid()) => {
  const body = await expectJson(service, '/api/prompts', 'POST', { requestId, ...input }, 201);
  return { prompt: body.prompt, requestId, input };
};
const readFileAt = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file) =>
  readFile(file, 'utf8').then(
    () => true,
    () => false,
  );
const readText = async (file) => ((await exists(file)) ? readFile(file, 'utf8') : null);
const getPrompt = async (id) => (await expectJson(service, `/api/prompts/${id}`, 'GET')).prompt;
/** Query values are always URL-encoded here, so Chinese filters are exercised exactly as the UI sends them. */
const listAll = async (params) => {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v !== undefined)).toString();
  return (await expectJson(service, `/api/prompts${query ? `?${query}` : ''}`, 'GET')).items;
};
const listResponse = async (params) => {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v !== undefined)).toString();
  return expectJson(service, `/api/prompts${query ? `?${query}` : ''}`, 'GET');
};
const stats = async () => expectJson(service, '/api/stats', 'GET');
/** The armed fault file lives in the isolated root, so injected faults can only hit this test's data. */
const armFault = async (fault) => writeFile(path.join(root, '.b07-fault.json'), JSON.stringify(fault));
const disarmFault = async () => rm(path.join(root, '.b07-fault.json'), { force: true });

try {
  // ---------------------------------------------------------------------------------------------
  // E07-01 记录 / 校验
  // ---------------------------------------------------------------------------------------------
  const created = {};
  await recorder.test('E07-01', '记录与校验', async () => {
    // -- six frozen categories, in order, straight from rules/prompt-rules.yaml -----------------
    const schema = await expectJson(service, '/api/prompts/schema', 'GET');
    assert.deepEqual(
      schema.categories.map((item) => item.id),
      CATEGORIES,
      JSON.stringify(schema.categories),
    );
    assert.deepEqual(
      schema.categories.map((item) => item.label),
      CATEGORY_LABELS,
    );
    assert.ok(
      schema.categories.every((item) => !('prompts' in item) && !('count' in item)),
      'schema must not carry seed prompts or counts',
    );

    // -- full-field create, then read it back over HTTP and from disk ---------------------------
    const body10k =
      `\n\n  请阅读下面的资料，围绕 {{客户名称}} 输出结论。  \n` +
      '第一段：中文标点，包括“引号”、顿号、破折号——以及 \\ 反斜杠和 " 双引号。\n' +
      "第二段：特殊字符 $& $1 $' $< 与百分号 %、制表符\t结束。\n" +
      `${'长正文填充。'.repeat(1800)}\n\n\t `;
    assert.ok(body10k.length > 10_000, `fixture body must exceed 10k chars, got ${body10k.length}`);
    const input = promptInput({
      name: '客户访谈提纲（长正文保真）',
      scenario: '  场景前后有空格  ',
      body: body10k,
      examples: '\n示例块第一行\n第二行\n',
      tags: ['访谈', '  访谈  ', '客户'],
    });
    const { prompt, requestId } = await create(input);
    created.long = { prompt, requestId, input };
    assert.equal(prompt.version, 1);
    assert.equal(prompt.source, 'manual');
    assert.equal(prompt.category, 'customer');
    assert.deepEqual(prompt.variables, ['客户名称']);
    assert.deepEqual(prompt.tags, ['访谈', '客户'], 'tags are trimmed and de-duplicated');
    assert.equal(prompt.favorite, false);

    const detail = await expectJson(service, `/api/prompts/${prompt.id}`, 'GET');
    assert.deepEqual(detail.prompt, prompt);
    assert.deepEqual(detail.wikiLinks, []);
    assert.equal(
      detail.prompt.body,
      body10k,
      'body must be byte-for-byte identical (whitespace/newlines/specials kept)',
    );
    assert.equal(detail.prompt.examples, input.examples, 'examples keep their original string');

    const file = await readFileAt(path.join(promptDir, `${prompt.id}.json`));
    assert.equal(file.id, prompt.id);
    assert.deepEqual(file.current, prompt);
    assert.equal(file.versions.length, 1);
    assert.equal(file.versions[0].version, 1);
    assert.equal(file.versions[0].changeSource, 'manual');
    assert.deepEqual(file.versions[0].snapshot, prompt);
    assert.equal(file.creation.requestId, requestId);
    assert.equal(file.creation.input.body, body10k);

    // -- every rejected shape must fail without leaving a record behind --------------------------
    const before = (await readdir(promptDir)).length;
    const reject = async (expectedCode, label, mutate, extra) => {
      const payload = { requestId: uuid(), ...promptInput(), ...mutate, ...extra };
      const error = await expectError(service, '/api/prompts', 'POST', payload, 400, expectedCode);
      assert.ok(error.message.length > 0, `${label}: the message must be readable`);
    };
    await reject('INVALID_CATEGORY', 'illegal category', { category: '不存在的分类' });
    await reject('INVALID_FIELD', 'non-array tags', { tags: '访谈' });
    await reject('INVALID_FIELD', 'non-boolean favorite', { favorite: 'true' });
    await reject('INVALID_WIKI_ID', 'non-uuid related wiki', { relatedWikiIds: ['../../etc/passwd'] });
    await reject('REQUIRED_FIELD', 'empty name', { name: '   ' });
    await reject('REQUIRED_FIELD', 'empty body', { body: '\n\t  \n' });
    await reject('SYSTEM_FIELD_NOT_ALLOWED', 'forged version', { version: 99 });
    await reject('SYSTEM_FIELD_NOT_ALLOWED', 'forged id', { id: uuid() });
    await reject('SYSTEM_FIELD_NOT_ALLOWED', 'forged variables', { variables: ['x'] });
    await reject('SYSTEM_FIELD_NOT_ALLOWED', 'forged source', { source: 'ai_generated' });
    await reject('SYSTEM_FIELD_NOT_ALLOWED', 'forged createdAt', { createdAt: '2020-01-01T00:00:00.000Z' });
    await reject('UNKNOWN_FIELD', 'unknown field', { 备注: 'x' });
    await reject('INVALID_REQUEST_ID', 'non-uuid requestId', {}, { requestId: 'not-a-uuid' });
    await reject('FIELD_TOO_LARGE', 'over-limit body', { body: '字'.repeat(100_001) });
    await reject('FIELD_TOO_LARGE', 'over-limit name', { name: '字'.repeat(201) });
    await reject('FIELD_TOO_LARGE', 'too many tags', { tags: Array.from({ length: 51 }, (_, i) => `标签${i}`) });

    await expectError(service, '/api/prompts/..%2F..%2Fetc%2Fpasswd', 'GET', undefined, 400, 'INVALID_ID');
    await expectError(service, '/api/prompts/not-a-uuid', 'GET', undefined, 400, 'INVALID_ID');
    await expectError(
      service,
      `/api/prompts/${prompt.id}`,
      'PUT',
      { ...promptInput(), baseVersion: 0 },
      400,
      'INVALID_BASE_VERSION',
    );
    await expectError(
      service,
      `/api/prompts/${prompt.id}`,
      'PUT',
      { ...promptInput(), baseVersion: 1.5 },
      400,
      'INVALID_BASE_VERSION',
    );
    await expectError(service, `/api/prompts/${prompt.id}`, 'DELETE', { baseVersion: -1 }, 400, 'INVALID_BASE_VERSION');

    const after = (await readdir(promptDir)).length;
    assert.equal(after, before, 'rejected requests must not leave any file in prompts/');
    assert.equal((await listAll()).length, 1);
    assert.equal(await exists(path.join(promptDir, `${prompt.id}.json`)), true);

    return {
      schemaCategories: schema.categories.map((item) => `${item.id}=${item.label}`),
      createdFields: Object.keys(prompt),
      bodyChars: prompt.body.length,
      bodyRoundTrip: 'exact',
      rejectedCodes: [
        'INVALID_CATEGORY',
        'INVALID_FIELD',
        'REQUIRED_FIELD',
        'SYSTEM_FIELD_NOT_ALLOWED',
        'UNKNOWN_FIELD',
        'INVALID_REQUEST_ID',
        'INVALID_ID',
        'INVALID_BASE_VERSION',
        'FIELD_TOO_LARGE',
      ],
      filesBefore: before,
      filesAfter: after,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-02 列表 / 搜索 / 筛选
  // ---------------------------------------------------------------------------------------------
  const fixtures = {};
  await recorder.test('E07-02', '列表与中文搜索', async () => {
    fixtures.a = (
      await create(
        promptInput({
          name: '门店动销复盘',
          category: 'business_analysis',
          tags: ['复盘', '动销'],
          body: '请复盘 {{门店名称}} 的动销数据。',
        }),
      )
    ).prompt;
    fixtures.b = (
      await create(
        promptInput({
          name: '新品上架计划',
          category: 'product',
          tags: ['新品'],
          favorite: true,
          body: '为 {{新品名称}} 生成上架计划。',
        }),
      )
    ).prompt;
    fixtures.c = (
      await create(
        promptInput({
          name: '行业趋势速读',
          category: 'industry_learning',
          tags: ['趋势'],
          body: '总结这份行业报告的三个要点，无变量。',
        }),
      )
    ).prompt;

    const all = await listAll();
    assert.equal(all.length, 4, 'E07-01 fixture plus three new prompts');
    assert.deepEqual(
      (await listAll({ category: 'product' })).map((item) => item.id),
      [fixtures.b.id],
    );
    assert.deepEqual(
      (await listAll({ tag: '复盘' })).map((item) => item.id),
      [fixtures.a.id],
    );
    assert.deepEqual(
      (await listAll({ favorite: true })).map((item) => item.id),
      [fixtures.b.id],
    );
    assert.deepEqual(
      (await listAll({ favorite: false })).map((item) => item.id).sort(),
      [fixtures.a.id, fixtures.c.id, created.long.prompt.id].sort(),
    );

    // Chinese search over name / tags / body, plus the category label
    assert.deepEqual(
      (await listAll({ q: '门店动销' })).map((item) => item.id),
      [fixtures.a.id],
      'name match',
    );
    assert.deepEqual(
      (await listAll({ q: '趋势' })).map((item) => item.id),
      [fixtures.c.id],
      'tag match',
    );
    assert.deepEqual(
      (await listAll({ q: '上架计划' })).map((item) => item.id),
      [fixtures.b.id],
      'body match',
    );
    assert.deepEqual(
      (await listAll({ q: '访谈提纲' })).map((item) => item.id),
      [created.long.prompt.id],
      'name match on a longer phrase',
    );
    assert.deepEqual(
      (await listAll({ q: '动销数据' })).map((item) => item.id),
      [fixtures.a.id],
      'a phrase that only appears in the body still matches',
    );
    assert.equal(
      (await listAll({ q: '客户' })).length,
      4,
      'the 场景 text is searchable: every fixture mentions 客户 there',
    );
    assert.deepEqual(await listAll({ q: '不存在的关键词' }), [], 'no match must be empty');
    assert.equal((await listAll({ q: '   ' })).length, 4, 'a whitespace-only query behaves like no query');
    // combined filters intersect
    assert.deepEqual(
      await listAll({ category: 'product', q: '门店动销' }),
      [],
      'a category that cannot match the term returns nothing',
    );
    assert.deepEqual(
      (await listAll({ category: 'business_analysis', q: '动销', tag: '复盘', favorite: false })).map(
        (item) => item.id,
      ),
      [fixtures.a.id],
    );
    // clearing the query restores the full list
    assert.equal((await listAll({ q: '' })).length, 4);
    // bad filters are rejected, never silently ignored
    await expectError(service, '/api/prompts?category=nope', 'GET', undefined, 400, 'INVALID_CATEGORY');
    await expectError(service, '/api/prompts?favorite=yes', 'GET', undefined, 400, 'INVALID_FILTER');

    const counts = (await listResponse()).categoryCounts;
    assert.deepEqual(Object.keys(counts), CATEGORIES);
    assert.deepEqual(counts, { industry_learning: 1, business_analysis: 1, customer: 1, product: 1, ai: 0, office: 0 });
    // counts describe the whole library, not the current filter
    assert.deepEqual((await listResponse({ category: 'product' })).categoryCounts, counts);

    const sorted = await listAll();
    assert.ok(
      sorted.every((item, i) => i === 0 || sorted[i - 1].updatedAt >= item.updatedAt),
      'newest update first',
    );

    return {
      total: all.length,
      categoryCounts: counts,
      searches: { name: '门店动销', tag: '趋势', body: '上架计划', empty: '不存在的关键词' },
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-03 版本历史
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-03', '版本历史', async () => {
    const prompt = fixtures.a;
    const v1 = (await expectJson(service, `/api/prompts/${prompt.id}/versions`, 'GET')).items;
    assert.equal(v1.length, 1);

    const edit = async (patch) => {
      const current = await getPrompt(prompt.id);
      const body = await expectJson(
        service,
        `/api/prompts/${prompt.id}`,
        'PUT',
        { ...toEditInput(current), ...patch, baseVersion: current.version },
        200,
      );
      return body.prompt;
    };

    const p2 = await edit({ name: '门店动销复盘 v2', outputRequirements: '表格 + 三段结论' });
    assert.equal(p2.version, 2);
    const p3 = await edit({ body: '请复盘 {{门店名称}} 在 {{统计周期}} 的动销数据。' });
    assert.equal(p3.version, 3);
    assert.deepEqual(p3.variables, ['门店名称', '统计周期']);
    assert.equal(p3.name, '门店动销复盘 v2', 'an unrelated field keeps its value across saves');

    // favourite and tags are real saves with their own versions
    const p4 = await edit({ favorite: true });
    assert.equal(p4.version, 4);
    const p5 = await edit({ tags: ['复盘', '动销', '周报'] });
    assert.equal(p5.version, 5);
    assert.equal(p5.favorite, true, 'the favourite survives the later tag save');

    const versions = (await expectJson(service, `/api/prompts/${prompt.id}/versions`, 'GET')).items;
    assert.deepEqual(
      versions.map((item) => item.version),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      versions.map((item) => item.changeSource),
      ['manual', 'manual', 'manual', 'manual', 'manual'],
    );
    // old snapshots keep their own content and timestamp
    assert.equal(versions[0].snapshot.name, prompt.name);
    assert.equal(versions[0].snapshot.favorite, false);
    assert.equal(versions[0].snapshot.variables.length, 1);
    assert.equal(versions[2].snapshot.body, '请复盘 {{门店名称}} 在 {{统计周期}} 的动销数据。');
    assert.equal(versions[3].snapshot.favorite, true);
    assert.equal(versions[4].snapshot.tags.length, 3);
    assert.equal(versions[0].savedAt, prompt.updatedAt, 'v1 keeps its original save time');
    assert.ok(versions.every((item, i) => i === 0 || versions[i - 1].savedAt <= item.savedAt));
    assert.equal(
      (await expectJson(service, `/api/prompts/${prompt.id}/versions/1`, 'GET')).version.snapshot.name,
      prompt.name,
    );
    await expectError(service, `/api/prompts/${prompt.id}/versions/99`, 'GET', undefined, 404, 'NOT_FOUND');
    await expectError(service, `/api/prompts/${prompt.id}/versions/0`, 'GET', undefined, 400, 'INVALID_VERSION');

    // saving identical content is not a version
    const file = path.join(promptDir, `${prompt.id}.json`);
    const before = await readFile(file);
    const same = await expectJson(
      service,
      `/api/prompts/${prompt.id}`,
      'PUT',
      { ...toEditInput(p5), baseVersion: p5.version },
      200,
    );
    assert.equal(same.prompt.version, 5, 'a no-change save must not create a version');
    assert.equal(same.prompt.updatedAt, p5.updatedAt, 'a no-change save must not move the time');
    assert.ok((await readFile(file)).equals(before), 'a no-change save must not rewrite the file');

    // still complete after a real restart of the process
    await harness.stop(service);
    service = await harness.start();
    const afterRestart = await getPrompt(prompt.id);
    assert.equal(afterRestart.version, 5);
    assert.equal(afterRestart.favorite, true);
    assert.equal((await expectJson(service, `/api/prompts/${prompt.id}/versions`, 'GET')).items.length, 5);

    return {
      versions: versions.map((item) => `${item.version}@${item.savedAt}`),
      noChangeSaveKeptVersion: same.prompt.version,
      restartVersion: afterRestart.version,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-04 冲突 / 创建重试
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-04', '并发冲突与创建重试', async () => {
    // -- two concurrent updates on the same baseVersion: exactly one wins ------------------------
    const target = (await create(promptInput({ name: '并发写入目标', category: 'ai' }))).prompt;
    const put = (name) =>
      request(service, `/api/prompts/${target.id}`, 'PUT', {
        ...promptInput({ name, category: target.category, body: target.body }),
        baseVersion: target.version,
      });
    const [first, second] = await Promise.all([put('并发写入 A'), put('并发写入 B')]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `expected one 200 and one 409, got ${statuses} (${first.text} / ${second.text})`,
    );
    const loser = first.status === 409 ? first : second;
    assert.equal(loser.json.error.code, 'VERSION_CONFLICT');
    assert.equal(loser.json.error.details.currentVersion, 2);
    const settled = await getPrompt(target.id);
    assert.equal(settled.version, 2, 'only one write may land');
    assert.equal((await expectJson(service, `/api/prompts/${target.id}/versions`, 'GET')).items.length, 2);

    // -- a stale update keeps the asset untouched and returns 409 with the real version ----------
    const file = path.join(promptDir, `${target.id}.json`);
    const frozen = await readFile(file);
    const stale = await expectError(
      service,
      `/api/prompts/${target.id}`,
      'PUT',
      { ...promptInput({ name: '过期写入', category: 'ai' }), baseVersion: 1 },
      409,
      'VERSION_CONFLICT',
    );
    assert.equal(stale.details.currentVersion, 2);
    assert.ok((await readFile(file)).equals(frozen), 'a rejected update must not touch the file');

    // -- a stale delete keeps the record --------------------------------------------------------
    await expectError(service, `/api/prompts/${target.id}`, 'DELETE', { baseVersion: 1 }, 409, 'VERSION_CONFLICT');
    assert.ok(await exists(file), 'a rejected delete must keep the record');

    // -- create retry: same requestId + same payload returns the current object ------------------
    const requestId = uuid();
    const initial = promptInput({ name: '重试创建样本', category: 'office' });
    const firstCreate = await create(initial, requestId);
    assert.equal(firstCreate.prompt.version, 1);
    const retry = await expectJson(service, '/api/prompts', 'POST', { requestId, ...initial }, 200);
    assert.equal(retry.reused, true);
    assert.equal(retry.prompt.id, firstCreate.prompt.id);
    assert.equal(retry.prompt.version, 1, 'a retry must not add a version');
    assert.equal((await listAll({ q: '重试创建样本' })).length, 1, 'a retry must not create a second record');

    // -- a retry after a manual edit must not overwrite the edit --------------------------------
    const edited = (
      await expectJson(
        service,
        `/api/prompts/${firstCreate.prompt.id}`,
        'PUT',
        { ...initial, name: '重试创建样本（已编辑）', baseVersion: 1 },
        200,
      )
    ).prompt;
    assert.equal(edited.version, 2);
    const retryAfterEdit = await expectJson(service, '/api/prompts', 'POST', { requestId, ...initial }, 200);
    assert.equal(retryAfterEdit.reused, true);
    assert.equal(retryAfterEdit.prompt.name, '重试创建样本（已编辑）');
    assert.equal(retryAfterEdit.prompt.version, 2);
    // -- a different payload on the same requestId is a conflict --------------------------------
    await expectError(
      service,
      '/api/prompts',
      'POST',
      { requestId, ...promptInput({ name: '另一组初始内容', category: 'office' }) },
      409,
      'REQUEST_ID_CONFLICT',
    );
    assert.equal(
      (await getPrompt(firstCreate.prompt.id)).version,
      2,
      'a conflicting requestId must not write anything',
    );

    // -- an id that was deleted can never come back --------------------------------------------
    const recyclable = await create(promptInput({ name: '回收后不可复活', category: 'office' }));
    await expectJson(service, `/api/prompts/${recyclable.prompt.id}`, 'DELETE', { baseVersion: 1 }, 200);
    const revived = await expectError(
      service,
      '/api/prompts',
      'POST',
      { requestId: recyclable.requestId, ...recyclable.input },
      409,
      'PROMPT_RECYCLED',
    );
    assert.equal(revived.details.id, recyclable.prompt.id);
    assert.equal(
      await exists(path.join(promptDir, `${recyclable.prompt.id}.json`)),
      false,
      'a recycled id must not be recreated',
    );

    // -- a second explicit new session with the same name is simply a new record ---------------
    const second2 = await create(promptInput({ name: '重试创建样本', category: 'office' }), uuid());
    assert.notEqual(second2.prompt.id, firstCreate.prompt.id);
    assert.equal(second2.prompt.name, '重试创建样本');

    return {
      concurrentStatuses: statuses,
      staleUpdateKeptFile: true,
      staleDeleteKeptFile: true,
      retryReused: retry.reused,
      retryAfterEditName: retryAfterEdit.prompt.name,
      recycledCode: revived.code,
      duplicateAllowed: true,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-05 变量填充
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-05', '变量提取与填充', async () => {
    const input = promptInput({
      name: '变量覆盖样本',
      category: 'ai',
      body:
        '开头 {{客户名称}} 中间 {{ 客户名称 }} 再 {{访谈主题}}，末行 {{客户名称}}。\n' +
        '无变量文本、`{{}}`、`{{ {{x}} }}`、`{{a\nb}}`、未闭合 {{ 都必须原样保留。',
    });
    const { prompt } = await create(input);
    assert.deepEqual(
      prompt.variables,
      ['客户名称', '访谈主题'],
      'first-appearance order, de-duplicated, boundary spaces are the same variable',
    );

    const logBefore = await readText(knowledgeLog);
    const file = path.join(promptDir, `${prompt.id}.json`);
    const before = await readFile(file);

    const render = async (values, status = 200, code) => {
      if (code)
        return expectError(
          service,
          `/api/prompts/${prompt.id}/render`,
          'POST',
          { baseVersion: prompt.version, values },
          status,
          code,
        );
      return expectJson(
        service,
        `/api/prompts/${prompt.id}/render`,
        'POST',
        { baseVersion: prompt.version, values },
        status,
      );
    };
    const tail = '无变量文本、`{{}}`、`{{ {{x}} }}`、`{{a\nb}}`、未闭合 {{ 都必须原样保留。';
    const filled = await render({ 客户名称: '华东某连锁商超', 访谈主题: '门店动销' });
    assert.equal(filled.body, `开头 华东某连锁商超 中间 华东某连锁商超 再 门店动销，末行 华东某连锁商超。\n${tail}`);
    assert.deepEqual(filled.missingVariables, []);

    // literal values: $&, $1, backslashes, newlines and a literal {{...}} are never re-scanned
    const trickyValue = '$& $1 \\n 反斜杠 \\ 与 {{访谈主题}} 字面';
    const tricky = await render({ 客户名称: trickyValue, 访谈主题: "$` 与 $'" });
    assert.equal(tricky.body, `开头 ${trickyValue} 中间 ${trickyValue} 再 $\` 与 $'，末行 ${trickyValue}。\n${tail}`);
    const multiline = await render({ 客户名称: '第一行\n第二行', 访谈主题: '主题' });
    assert.ok(multiline.body.startsWith('开头 第一行\n第二行 中间'));

    // missing / blank / unknown / wrong-typed values
    const missing = await render({ 客户名称: '某商超' }, 422, 'MISSING_VARIABLES');
    assert.deepEqual(missing.details.missingVariables, ['访谈主题']);
    const blank = await render({ 客户名称: '   \n ', 访谈主题: '主题' }, 422, 'MISSING_VARIABLES');
    assert.deepEqual(blank.details.missingVariables, ['客户名称'], 'whitespace-only counts as unfilled');
    await render({ 客户名称: 'x', 访谈主题: 'y', 不存在的变量: 'z' }, 400, 'UNKNOWN_VARIABLE');
    await render({ 客户名称: 0, 访谈主题: 'y' }, 400, 'INVALID_VALUES');
    await render({ 客户名称: null, 访谈主题: 'y' }, 400, 'INVALID_VALUES');
    await expectError(
      service,
      `/api/prompts/${prompt.id}/render`,
      'POST',
      { baseVersion: 999, values: {} },
      409,
      'VERSION_CONFLICT',
    );

    // `0` is a valid value, not "empty"
    const zero = await create(promptInput({ name: '零值变量', category: 'ai', body: '数量：{{数量}} 单价：{{单价}}' }));
    const zeroRender = await expectJson(
      service,
      `/api/prompts/${zero.prompt.id}/render`,
      'POST',
      { baseVersion: 1, values: { 数量: '0', 单价: '0' } },
      200,
    );
    assert.equal(zeroRender.body, '数量：0 单价：0');

    // a body without variables renders unchanged
    const plain = await create(
      promptInput({ name: '无变量模板', category: 'ai', body: '这是一段没有任何变量的正文。' }),
    );
    const plainRender = await expectJson(
      service,
      `/api/prompts/${plain.prompt.id}/render`,
      'POST',
      { baseVersion: 1, values: {} },
      200,
    );
    assert.equal(plainRender.body, plain.prompt.body);
    assert.deepEqual(plain.prompt.variables, []);

    // prototype keys are read as own keys only and never touch Object.prototype
    const proto = await create(
      promptInput({ name: '原型键样本', category: 'ai', body: '值：{{__proto__}}|{{constructor}}' }),
    );
    const protoRender = await expectJson(
      service,
      `/api/prompts/${proto.prompt.id}/render`,
      'POST',
      { baseVersion: 1, values: JSON.parse('{"__proto__":"甲","constructor":"乙"}') },
      200,
    );
    assert.equal(protoRender.body, '值：甲|乙');
    assert.equal(Object.prototype.constructor, Object, 'Object.prototype must not have been written through');
    assert.equal({}.甲, undefined);

    // filling variables is pure computation: not one byte of the record may change
    await render({ 客户名称: '另一个值', 访谈主题: '另一个主题' });
    const after = await readFile(file);
    assert.ok(before.equals(after), 'render must not modify the stored Prompt');
    assert.equal((await getPrompt(prompt.id)).version, 1);
    assert.equal(await readText(knowledgeLog), logBefore, 'render must not write the knowledge log');

    return {
      variables: prompt.variables,
      literalValues: 'preserved',
      protoKeys: protoRender.body,
      fileShaUnchanged: digest(after),
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-07 删除
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-07', '删除与回收', async () => {
    const target = await create(promptInput({ name: '待删除样本', category: 'office', tags: ['临时'] }));
    const keeper = await create(promptInput({ name: '删除后的存活样本', category: 'office' }));
    const countsBefore = (await listResponse()).categoryCounts.office;
    const statsBefore = (await stats()).promptCount;
    const knowledgeBefore = await fileSnapshot(path.join(root, 'knowledge'));
    const keeperFile = path.join(promptDir, `${keeper.prompt.id}.json`);
    const keeperBefore = digest(await readFile(keeperFile));

    await expectJson(service, `/api/prompts/${target.prompt.id}`, 'DELETE', { baseVersion: 1 }, 200);
    await expectError(service, `/api/prompts/${target.prompt.id}`, 'DELETE', { baseVersion: 1 }, 404, 'NOT_FOUND');
    assert.equal(await exists(path.join(promptDir, `${target.prompt.id}.json`)), false, 'the active file must be gone');
    assert.ok(
      await exists(path.join(recycleDir, `${target.prompt.id}.json`)),
      'the record must be preserved in prompts/recycle',
    );

    await expectError(service, `/api/prompts/${target.prompt.id}`, 'GET', undefined, 404, 'NOT_FOUND');
    await expectError(service, `/api/prompts/${target.prompt.id}/versions`, 'GET', undefined, 404, 'NOT_FOUND');
    assert.deepEqual(await listAll({ q: '待删除样本' }), []);
    assert.ok(!(await listAll()).some((item) => item.id === target.prompt.id));
    assert.equal((await listResponse()).categoryCounts.office, countsBefore - 1);
    assert.equal((await stats()).promptCount, statsBefore - 1);

    // junk in prompts/ must never be counted as a prompt
    const junkTemp = path.join(promptDir, `.${uuid()}.json.abc.tmp`);
    const junkNote = path.join(promptDir, 'notes.json');
    const junkSub = path.join(promptDir, 'sub');
    await writeFile(junkTemp, '{"half":"written"}');
    await writeFile(junkNote, '{"note":"hand written"}');
    await writeFile(path.join(recycleDir, `${uuid()}.json`), '{"recycled":true}');
    await mkdir(junkSub, { recursive: true });
    await writeFile(
      path.join(junkSub, `${uuid()}.json`),
      JSON.stringify({ id: uuid(), current: { id: uuid() }, versions: [], creation: {} }),
    );
    assert.equal((await stats()).promptCount, statsBefore - 1, 'temp/recycle/sub-directory JSON must not be counted');
    assert.equal((await listAll()).length, statsBefore - 1);

    assert.equal(digest(await readFile(keeperFile)), keeperBefore, 'deleting one Prompt must not touch another');
    assert.deepEqual(
      await fileSnapshot(path.join(root, 'knowledge')),
      knowledgeBefore,
      'a Prompt delete must not touch knowledge/',
    );

    await harness.stop(service);
    service = await harness.start();
    await expectError(service, `/api/prompts/${target.prompt.id}`, 'GET', undefined, 404, 'NOT_FOUND');
    assert.equal((await stats()).promptCount, statsBefore - 1, 'the deletion must survive a restart');
    assert.ok(await exists(path.join(recycleDir, `${target.prompt.id}.json`)));

    await rm(junkSub, { recursive: true, force: true });
    await rm(junkNote, { force: true });
    await rm(junkTemp, { force: true });
    return {
      recyclePath: `prompts/recycle/${target.prompt.id}.json`,
      officeCounts: [countsBefore, countsBefore - 1],
      promptCounts: [statsBefore, statsBefore - 1],
      junkIgnored: true,
      survivedRestart: true,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-08 与 Wiki 的松耦合
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-08', '与知识库松耦合', async () => {
    const wiki = await expectJson(
      service,
      '/api/wiki',
      'POST',
      {
        title: 'B07 隔离验收 Wiki',
        type: 'metric',
        category: 'metric',
        sources: [],
        tags: [],
        aliases: [],
        body: '隔离自测用页面，本轮结束后随临时目录一起丢弃。',
        knowledge_status: 'needs_verification',
        confidence: 'low',
        source_level: 'D',
        review_status: 'reviewed',
      },
      201,
    );
    const linked = await create(promptInput({ name: '关联 Wiki 的模板', category: 'ai', relatedWikiIds: [wiki.id] }));
    const detail = await expectJson(service, `/api/prompts/${linked.prompt.id}`, 'GET');
    assert.deepEqual(detail.wikiLinks, [{ id: wiki.id, title: 'B07 隔离验收 Wiki', status: 'resolved' }]);

    // a brand-new link to a Wiki that does not exist is refused, on create and on update
    await expectError(
      service,
      '/api/prompts',
      'POST',
      { requestId: uuid(), ...promptInput({ name: '坏关联', category: 'ai', relatedWikiIds: [uuid()] }) },
      400,
      'INVALID_WIKI_LINK',
    );
    await expectError(
      service,
      `/api/prompts/${linked.prompt.id}`,
      'PUT',
      { ...promptInput({ name: '关联 Wiki 的模板', category: 'ai', relatedWikiIds: [uuid()] }), baseVersion: 1 },
      400,
      'INVALID_WIKI_LINK',
    );
    assert.equal((await getPrompt(linked.prompt.id)).version, 1, 'a refused link must not write');

    // delete the Wiki, then the Prompt keeps working and simply reports the link as missing
    await expectJson(service, `/api/wiki/${wiki.id}`, 'DELETE', { baseRevision: wiki.revision }, 200);
    const orphan = await expectJson(service, `/api/prompts/${linked.prompt.id}`, 'GET');
    assert.deepEqual(orphan.wikiLinks, [{ id: wiki.id, title: null, status: 'missing' }]);
    assert.ok(
      await exists(path.join(promptDir, `${linked.prompt.id}.json`)),
      'deleting a Wiki must not cascade into the Prompt',
    );

    const orphanRender = await expectJson(
      service,
      `/api/prompts/${linked.prompt.id}/render`,
      'POST',
      { baseVersion: orphan.prompt.version, values: { 客户名称: '某客户', 访谈主题: '某主题' } },
      200,
    );
    assert.equal(
      orphanRender.body,
      orphan.prompt.body.replace('{{客户名称}}', '某客户').replace('{{访谈主题}}', '某主题'),
    );
    const orphanExport = await request(service, `/api/prompts/${linked.prompt.id}/export`, 'GET');
    assert.equal(orphanExport.status, 200);
    assert.ok(orphanExport.text.includes('关联已失效'), 'the export must mark the dead link');
    assert.ok(orphanExport.text.includes(wiki.id));
    const orphanEdit = await expectJson(
      service,
      `/api/prompts/${linked.prompt.id}`,
      'PUT',
      {
        ...promptInput({ name: '关联 Wiki 的模板（已改）', category: 'ai', relatedWikiIds: [wiki.id] }),
        baseVersion: orphan.prompt.version,
      },
      200,
    );
    assert.equal(
      orphanEdit.prompt.relatedWikiIds.length,
      1,
      'an already-linked Wiki may be kept; only *new* links are checked',
    );
    assert.equal((await listAll({ q: '关联 Wiki 的模板' })).length, 1, 'search still finds it');

    // the Prompt must never leak into the knowledge base
    const wikiSearch = await expectJson(service, `/api/wiki?q=${encodeURIComponent('关联 Wiki 的模板')}`, 'GET');
    assert.deepEqual(wikiSearch.items, [], 'a Prompt must never be returned as a Wiki');
    const wikiAll = await expectJson(service, '/api/wiki', 'GET');
    assert.ok(!wikiAll.items.some((item) => item.id === linked.prompt.id));
    const lint = await request(service, '/api/wiki-lint', 'GET');
    assert.ok(lint.status < 500, `/api/wiki-lint -> ${lint.status} ${lint.text}`);
    assert.ok(!lint.text.includes(linked.prompt.id), 'Lint must not see Prompts as Wiki pages');

    return {
      resolvedThenMissing: true,
      exportMarksDead: true,
      wikiSearchHits: wikiSearch.items.length,
      lintStatus: lint.status,
      promptLeakedIntoWiki: false,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-09 Markdown 导出
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-09', 'Markdown 导出', async () => {
    const fenced = '第一行\n```js\nconst a = `反引号`;\n```\n结尾 {{客户名称}} 与 | 表格竖线 |';
    const { prompt } = await create(
      promptInput({
        name: '导出样本',
        category: 'business_analysis',
        scenario: '导出格式检查',
        body: fenced,
        inputRequirements: '输入要求正文',
        outputRequirements: '输出要求正文',
        examples: '示例正文',
        tags: ['导出', '格式'],
      }),
    );
    const file = path.join(promptDir, `${prompt.id}.json`);
    const before = await readFile(file);
    const result = await request(service, `/api/prompts/${prompt.id}/export`, 'GET');
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /text\/markdown/);
    assert.match(
      result.headers.get('content-disposition'),
      new RegExp(`attachment; filename="prompt-${prompt.id}\\.md"`),
    );

    const markdown = result.text;
    const meta = yaml.load(markdown.split('---')[1]);
    assert.equal(meta.id, prompt.id);
    assert.equal(meta.name, '导出样本');
    assert.equal(meta.category, 'business_analysis');
    assert.equal(meta.categoryLabel, '业务分析');
    assert.deepEqual(meta.variables, ['客户名称']);
    assert.equal(meta.source, 'manual');
    assert.equal(meta.version, 1);
    assert.equal(meta.favorite, false);
    assert.deepEqual(meta.tags, ['导出', '格式']);
    assert.deepEqual(meta.relatedWiki, []);
    assert.ok(meta.createdAt && meta.updatedAt);
    assert.ok(markdown.includes('# 导出样本'));
    assert.ok(markdown.includes('## 输入要求\n\n输入要求正文'));
    assert.ok(markdown.includes('## 输出要求\n\n输出要求正文'));
    assert.ok(markdown.includes('## 示例\n\n示例正文'));
    assert.ok(markdown.includes(`## Prompt 正文\n\n${fenced}`), 'the fenced body must survive verbatim');
    assert.ok(markdown.trimEnd().endsWith('| 表格竖线 |'));
    assert.ok((await readFile(file)).equals(before), 'export must not modify the stored Prompt');

    assert.equal((await request(service, `/api/prompts/${uuid()}/export`, 'GET')).status, 404);

    return {
      contentType: result.headers.get('content-type'),
      filename: result.headers.get('content-disposition'),
      bytes: markdown.length,
      frontmatterKeys: Object.keys(meta),
      fencedBodyKept: true,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-10 磁盘故障
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-10', '磁盘故障注入与恢复', async () => {
    const { prompt } = await create(
      promptInput({ name: '故障注入样本', category: 'office', body: '正文一 {{变量甲}}' }),
    );
    const file = path.join(promptDir, `${prompt.id}.json`);
    const good = await readFile(file);
    const update = (patch) =>
      request(service, `/api/prompts/${prompt.id}`, 'PUT', {
        ...promptInput({ name: prompt.name, category: 'office', body: prompt.body }),
        ...patch,
        baseVersion: 1,
      });

    // (a) the temp write fails -> nothing is written, nothing is versioned
    await armFault({ method: 'writeFile', match: `/prompts/.${prompt.id}.json.`, action: 'error', tag: 'temp' });
    const tempFailure = await update({ name: '不该被保存的名字' });
    await disarmFault();
    assert.equal(tempFailure.status, 500, `expected a readable failure, got ${tempFailure.status} ${tempFailure.text}`);
    assert.equal(tempFailure.json.error.code, 'PROMPT_WRITE_FAILED');
    assert.ok(tempFailure.json.error.message.length > 0);
    assert.ok((await readFile(file)).equals(good), 'a failed temp write must leave the record untouched');

    // (b) the final rename fails -> the old file survives and the version is not inflated
    await armFault({ method: 'rename', match: `/prompts/${prompt.id}.json`, action: 'error', tag: 'final' });
    const renameFailure = await update({ name: '同样不该被保存' });
    await disarmFault();
    assert.equal(renameFailure.status, 500);
    assert.equal(renameFailure.json.error.code, 'PROMPT_WRITE_FAILED');
    assert.ok((await readFile(file)).equals(good), 'a failed rename must leave the old current intact');
    assert.equal((await getPrompt(prompt.id)).version, 1, 'a failed save must not bump the version');
    assert.equal((await expectJson(service, `/api/prompts/${prompt.id}/versions`, 'GET')).items.length, 1);
    assert.equal(await exists(file), true);

    // (c) the recycle rename fails -> the delete is reported as failed and the record stays
    await armFault({ method: 'rename', match: '/prompts/recycle/', action: 'error', tag: 'recycle' });
    const deleteFailure = await request(service, `/api/prompts/${prompt.id}`, 'DELETE', { baseVersion: 1 });
    await disarmFault();
    assert.equal(deleteFailure.status, 500);
    assert.equal(deleteFailure.json.error.code, 'PROMPT_DELETE_FAILED');
    assert.ok(await exists(file), 'a failed delete must keep the active record');
    assert.equal((await listAll({ q: '故障注入样本' })).length, 1);

    // (d) with the fault cleared, the very same operations succeed
    const recovered = await update({ name: '故障解除后保存成功' });
    assert.equal(recovered.status, 200, recovered.text);
    assert.equal(recovered.json.prompt.version, 2);
    const deleted = await request(service, `/api/prompts/${prompt.id}`, 'DELETE', { baseVersion: 2 });
    assert.equal(deleted.status, 200, deleted.text);

    // (e) leftovers in prompts/ never reach the Library or the stats, and a restart is clean
    const leftovers = (await readdir(promptDir)).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'a failed write must clean up its temp file');
    const statsBefore = (await stats()).promptCount;
    await harness.stop(service);
    service = await harness.start();
    assert.equal((await stats()).promptCount, statsBefore);
    assert.ok(!(await listAll()).some((item) => item.id === prompt.id));

    const observed = await readFileAt(path.join(root, '.b07-fault-observed.json')).catch(() => undefined);
    return {
      failureCodes: ['PROMPT_WRITE_FAILED', 'PROMPT_DELETE_FAILED'],
      versionAfterFailures: 2,
      tempLeftovers: leftovers.length,
      recovered: true,
      lastInjectedFault: observed,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-11 首页统计与知识日志（UI 侧的切换行为见 tests/prompt-ui.test.tsx）
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-11', '首页数量与知识日志隔离', async () => {
    const logBefore = await readText(knowledgeLog);
    const start = (await stats()).promptCount;
    const { prompt } = await create(promptInput({ name: '首页计数样本', category: 'office' }));
    assert.equal((await stats()).promptCount, start + 1, 'create must show up immediately');

    await expectJson(
      service,
      `/api/prompts/${prompt.id}`,
      'PUT',
      { ...promptInput({ name: '首页计数样本', category: 'office', favorite: true }), baseVersion: 1 },
      200,
    );
    assert.equal((await stats()).promptCount, start + 1, 'an edit must not change the count');
    await expectJson(service, `/api/prompts/${prompt.id}`, 'DELETE', { baseVersion: 2 }, 200);
    assert.equal((await stats()).promptCount, start, 'delete must show up immediately');

    assert.equal(
      await readText(knowledgeLog),
      logBefore,
      'manual Prompt operations must not append to knowledge/logs/wiki.jsonl',
    );
    assert.ok(!((await readText(knowledgeLog)) ?? '').includes(prompt.id));

    // the count only ever describes valid `current` records, and the list agrees with it
    const files = (await readdir(promptDir)).filter((name) => name.endsWith('.json'));
    assert.equal(files.length, start, 'prompts/ holds exactly one file per counted Prompt');
    assert.equal((await listAll()).length, start, 'the list and the homepage count must agree');

    return {
      counts: { start, afterCreate: start + 1, afterEdit: start + 1, afterDelete: start },
      knowledgeLogUnchanged: true,
      listMatchesCount: true,
      filesInPromptDir: files.length,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // F07-01 返修：损坏的 UUID 记录（独立验收 E07-extra-damaged-record-valid-counting 的同一原因）
  // ---------------------------------------------------------------------------------------------
  await recorder.test('F07-01', '损坏记录不计入有效数量且读取受控失败', async () => {
    const start = (await stats()).promptCount;
    const damagedId = uuid();
    const damagedFile = path.join(promptDir, `${damagedId}.json`);
    await writeFile(
      damagedFile,
      JSON.stringify({ id: damagedId, current: { id: damagedId }, versions: [], creation: {} }),
    );
    const damagedBefore = digest(await readFile(damagedFile));

    // the same file that used to raise the homepage count must not be counted anywhere
    assert.equal((await stats()).promptCount, start, 'a damaged record must not raise the homepage count');
    assert.equal((await listAll()).length, start, 'the list must not contain a damaged record');
    assert.equal(
      Object.values((await listResponse()).categoryCounts).reduce((sum, count) => sum + count, 0),
      start,
      'category counts stay library-wide and valid-only',
    );
    assert.ok(!(await listAll()).some((item) => item.id === damagedId));

    // reading it directly answers with a controlled error, not an unrelated internal failure
    const detail = await expectError(service, `/api/prompts/${damagedId}`, 'GET', undefined, 500, 'CORRUPT_PROMPT');
    assert.equal(detail.details?.id, damagedId);
    await expectError(service, `/api/prompts/${damagedId}/versions`, 'GET', undefined, 500, 'CORRUPT_PROMPT');
    await expectError(service, `/api/prompts/${damagedId}/export`, 'GET', undefined, 500, 'CORRUPT_PROMPT');

    // damage is preserved, never repaired, rewritten or discarded
    assert.equal(digest(await readFile(damagedFile)), damagedBefore, 'the damaged file must not be rewritten');
    assert.ok(await exists(damagedFile), 'the damaged file must not be deleted');
    await harness.stop(service);
    service = await harness.start();
    assert.equal((await stats()).promptCount, start, 'the damaged record stays excluded after a restart');
    assert.equal(digest(await readFile(damagedFile)), damagedBefore);

    // ... and it cannot be overwritten by a create that happens to reuse its id
    await expectError(
      service,
      '/api/prompts',
      'POST',
      { requestId: damagedId, ...promptInput({ name: '不应写入' }) },
      500,
      'CORRUPT_PROMPT',
    );
    assert.equal(digest(await readFile(damagedFile)), damagedBefore);

    // a valid record in the same folder is still fully readable
    const { prompt } = await create(promptInput({ name: '损坏记录旁的有效样本', category: 'customer' }));
    assert.equal((await getPrompt(prompt.id)).name, '损坏记录旁的有效样本');
    assert.equal((await stats()).promptCount, start + 1, 'valid records are still counted normally');

    // this scenario's own fixture is removed afterwards; the product never touched it (SHA above)
    await rm(damagedFile, { force: true });
    await rm(path.join(promptDir, `${prompt.id}.json`), { force: true });
    return {
      damagedId,
      countedBefore: start,
      detailCode: detail.code,
      versionsCode: 'CORRUPT_PROMPT',
      exportCode: 'CORRUPT_PROMPT',
      shaUnchanged: true,
      survivedRestart: true,
      validRecordUnaffected: true,
    };
  });

  // ---------------------------------------------------------------------------------------------
  // E07-12 无 LLM / 回归
  // ---------------------------------------------------------------------------------------------
  await recorder.test('E07-12', '无 LLM 可用与既有入口回归', async () => {
    const health = await expectJson(service, '/api/health', 'GET');
    assert.equal(health.ok, true);

    // the whole manual chain works with no provider configured
    const { prompt } = await create(
      promptInput({ name: '无 LLM 手工链路', category: 'industry_learning', body: '请总结 {{资料名称}}。' }),
    );
    const rendered = await expectJson(
      service,
      `/api/prompts/${prompt.id}/render`,
      'POST',
      { baseVersion: 1, values: { 资料名称: '隔离样本' } },
      200,
    );
    assert.equal(rendered.body, '请总结 隔离样本。');
    assert.equal((await request(service, `/api/prompts/${prompt.id}/export`, 'GET')).status, 200);
    assert.deepEqual(
      (await listAll({ q: '无 LLM' })).map((item) => item.id),
      [prompt.id],
    );

    // existing entries still respond
    const entries = {};
    for (const [name, url] of [
      ['raw', '/api/raw'],
      ['wiki', '/api/wiki'],
      ['wikiSchema', '/api/wiki/schema'],
      ['stats', '/api/stats'],
      ['audits', '/api/audits'],
      ['wikiLint', '/api/wiki-lint'],
      ['promptSchema', '/api/prompts/schema'],
    ]) {
      const response = await request(service, url, 'GET');
      entries[name] = response.status;
      assert.ok(response.status < 500, `${url} -> ${response.status} ${response.text}`);
    }
    // and the AI paths are still the ones that require a provider
    const raw = await expectJson(
      service,
      '/api/raw',
      'POST',
      {
        title: 'B07 回归样本',
        sourceType: 'report',
        sourceName: '隔离样本',
        author: '验收样本',
        publishedAt: '2026-10-01',
        url: 'https://example.com/b07-regression',
        tags: [],
        body: '回归用正文。',
      },
      201,
    );
    const extraction = await request(service, `/api/raw/${raw.id}/extract`, 'POST', {});
    const outcome = { httpStatus: extraction.status, jobStatus: null, code: extraction.json?.error?.code ?? null };
    if (extraction.status === 202) {
      for (let n = 0; n < 120; n++) {
        const job = await expectJson(service, `/api/extraction-jobs/${extraction.json.jobId}`, 'GET');
        if (job.status !== 'running') {
          outcome.jobStatus = job.status;
          outcome.code = job.error?.code ?? job.error?.message ?? 'failed';
          break;
        }
        await delay(80);
      }
    }
    assert.ok(
      outcome.httpStatus >= 400 || outcome.jobStatus === 'failed',
      `without an LLM the extraction must fail loudly, got ${JSON.stringify(outcome)} ${extraction.text}`,
    );

    // the B06 cross-page fixes are untouched: these files still parse and the routes above answered
    const wikiList = await expectJson(service, '/api/wiki', 'GET');
    assert.ok(Array.isArray(wikiList.items));

    return { entries, manualChainWithoutLlm: true, extractionResponse: outcome };
  });

  // E07-06 needs a real browser clipboard; it is recorded honestly instead of being faked.
  recorder.skip(
    'E07-06',
    '真实浏览器复制/粘贴',
    '本机没有可由脚本驱动的真实浏览器，本轮不执行剪贴板实测；UI 层的复制分支（未填变量阻止复制、剪贴板失败提示）由 tests/prompt-ui.test.tsx 用桩验证，但那不是真实剪贴板证据，不能替代。留待 Codex 主 Agent 用真实浏览器独立验收。',
  );
} finally {
  await disarmFault().catch(() => undefined);
  await harness.close().catch(() => undefined);
}

const finishedAt = new Date().toISOString();
const report = {
  batch: 'B07',
  kind: 'construction-self-test',
  script: 'tests/b07-prompt-http.mjs',
  note: '施工自测证据，不是独立验收。由施工 Agent 编写并执行；不得据此标记独立 PASS。',
  startedAt,
  finishedAt,
  durationMs: Date.now() - t0,
  dataRoot: root,
  dataRootDisposedWithWorkspace: false,
  llmConfigured: false,
  passed: recorder.items.filter((item) => item.status === 'PASS').length,
  failed: recorder.items.filter((item) => item.status === 'FAIL').length,
  notRun: recorder.items.filter((item) => item.status === 'NOT_RUN').length,
  items: recorder.items,
};
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, 'B07-builder-http-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `\nB07 construction self-test: ${report.passed} PASS / ${report.failed} FAIL / ${report.notRun} NOT_RUN in ${report.durationMs}ms`,
);
console.log(`data root (temporary): ${root}`);
console.log('evidence: docs/reports/B07-builder-http-evidence.json');
process.exit(report.failed ? 1 : 0);
