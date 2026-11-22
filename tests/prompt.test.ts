import os from 'node:os';
// B07: unit coverage for the Prompt Library services (variables, validation, store, stats wiring).
// The HTTP/UI behaviour is covered by tests/b07-prompt-http.mjs and tests/prompt-ui.test.tsx.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { getStats } from '../services/stats/index.ts';
import { PromptError } from '../services/prompt/errors.ts';
import { MAX_BODY_CHARS, MAX_NAME_CHARS, MAX_TAGS } from '../services/prompt/limits.ts';
import { PromptStore, countActivePrompts, type Prompt } from '../services/prompt/store.ts';
import { canonicalInput, normalizePromptInput, normalizeVariableValues } from '../services/prompt/validate.ts';
import { extractVariables, renderTemplate, scanPlaceholders } from '../services/prompt/variables.ts';

const CATEGORIES = ['industry_learning', 'business_analysis', 'customer', 'product', 'ai', 'office'];

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-data-prompt-'));
  const rawStore = new RawStore(root);
  await rawStore.initialize();
  const wikiStore = new WikiStore(root, rawStore);
  await wikiStore.initialize();
  const store = new PromptStore(root, wikiStore);
  await store.initialize();
  const clean = () => rm(root, { recursive: true, force: true });
  return { root, rawStore, wikiStore, store, clean };
}

const uuid = () => crypto.randomUUID();
function input(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: '访谈提纲',
    category: 'customer',
    scenario: '拜访前准备',
    body: '围绕 {{客户名称}} 输出提纲。',
    inputRequirements: '客户名称',
    outputRequirements: '三段式',
    relatedWikiIds: [],
    examples: '',
    tags: ['访谈'],
    favorite: false,
    ...overrides,
  };
}
async function rejection(work: () => Promise<unknown>): Promise<PromptError> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof PromptError, `expected a PromptError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected the call to fail');
}

// ---------------------------------------------------------------------------------------------
// variables
// ---------------------------------------------------------------------------------------------

test('变量扫描：中文、重复、边界空格，以及必须原样保留的畸形占位符', () => {
  assert.deepEqual(extractVariables('{{客户名称}} 与 {{客户名称}}，再加 {{ 客户名称 }}'), ['客户名称']);
  assert.deepEqual(extractVariables('b {{乙}} a {{甲}}'), ['乙', '甲'], '首次出现顺序');
  assert.deepEqual(extractVariables('{{a b}}'), ['a b'], '名称内部空格原样保留');
  assert.deepEqual(extractVariables('{{}} {{   }}'), [], '空名称不是变量');
  assert.deepEqual(extractVariables('{{ {{x}} }}'), [], '嵌套花括号不是变量');
  assert.deepEqual(extractVariables('{{a\nb}}'), [], '名称内含换行不是变量');
  assert.deepEqual(extractVariables('未闭合 {{ 之后'), [], '未闭合不是变量');
  assert.deepEqual(extractVariables('没有任何变量的正文'), []);
  // a malformed candidate consumes its own span, so it can never be re-read as a smaller variable
  const scan = scanPlaceholders('{{ {{x}} }} 与 {{甲}}');
  assert.deepEqual(
    scan.variables.map((span) => span.name),
    ['甲'],
  );
  assert.equal(scan.malformed[0].reason, 'braces');
  assert.equal(scan.malformed[0].text, '{{ {{x}}', '畸形候选只消费到第一个 }}，不会被重新读成更小的变量');
  // the span end offset is exact, so rendering leaves the malformed text byte-for-byte intact
  assert.equal(renderTemplate('{{ {{x}} }} 与 {{甲}}', { 甲: 'A' }).body, '{{ {{x}} }} 与 A');
});

test('变量填充：单次替换、字面值、缺值与 0', () => {
  const body = 'A {{甲}} B {{乙}} C {{甲}}';
  assert.equal(renderTemplate(body, { 甲: '1', 乙: '2' }).body, 'A 1 B 2 C 1');
  assert.deepEqual(renderTemplate(body, { 甲: '1', 乙: '2' }).missingVariables, []);
  assert.deepEqual(renderTemplate(body, { 甲: '1' }).missingVariables, ['乙']);
  assert.deepEqual(renderTemplate(body, { 甲: '   ', 乙: '2' }).missingVariables, ['甲'], '只有空白视为未填');
  assert.deepEqual(renderTemplate(body, { 甲: '0', 乙: '0' }).missingVariables, [], '0 是有效值');
  // values are inserted literally: never interpreted, never re-scanned, never recursive
  const tricky = renderTemplate('{{甲}}|{{乙}}', { 甲: "$& $1 $' $` \\ \n 换行", 乙: '{{甲}} 字面' });
  assert.equal(tricky.body, "$& $1 $' $` \\ \n 换行|{{甲}} 字面");
  assert.equal(renderTemplate('{{甲}}', { 甲: 'a' }).body, 'a');
});

test('变量值只接受由自己键读取的字符串，原型键不会污染原型', () => {
  const values = normalizeVariableValues(JSON.parse('{"__proto__":"甲","constructor":"乙","普通":"丙"}'));
  assert.equal(values['__proto__'], '甲');
  assert.equal(values['constructor'], '乙');
  assert.equal(values['普通'], '丙');
  assert.equal(Object.getPrototypeOf(values), null);
  assert.equal(Object.prototype.constructor, Object, '原型没有被写入');
  assert.equal(({} as Record<string, unknown>)['甲'], undefined);
  assert.equal(renderTemplate('{{__proto__}}', values).body, '甲');
  assert.throws(
    () => normalizeVariableValues({ 甲: 1 }),
    (error: PromptError) => error.code === 'INVALID_VALUES',
  );
  assert.throws(
    () => normalizeVariableValues(['甲']),
    (error: PromptError) => error.code === 'INVALID_VALUES',
  );
  assert.deepEqual(normalizeVariableValues(undefined), {});
});

// ---------------------------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------------------------

test('输入校验：白名单字段、系统字段与长度上限', () => {
  const clean = normalizePromptInput(input(), CATEGORIES);
  assert.deepEqual(
    Object.keys(clean).sort(),
    [
      'body',
      'category',
      'examples',
      'favorite',
      'inputRequirements',
      'name',
      'outputRequirements',
      'relatedWikiIds',
      'scenario',
      'tags',
    ].sort(),
  );
  const rejects = (payload: unknown, code: string) =>
    assert.throws(
      () => normalizePromptInput(payload, CATEGORIES),
      (error: PromptError) => error.code === code,
      `${code}`,
    );
  rejects(input({ category: '未知分类' }), 'INVALID_CATEGORY');
  rejects(input({ tags: '访谈' }), 'INVALID_FIELD');
  rejects(input({ favorite: 1 }), 'INVALID_FIELD');
  rejects(input({ name: '' }), 'REQUIRED_FIELD');
  rejects(input({ body: ' \n ' }), 'REQUIRED_FIELD');
  rejects(input({ id: uuid() }), 'SYSTEM_FIELD_NOT_ALLOWED');
  rejects(input({ variables: ['x'] }), 'SYSTEM_FIELD_NOT_ALLOWED');
  rejects(input({ version: 2 }), 'SYSTEM_FIELD_NOT_ALLOWED');
  rejects(input({ source: 'manual' }), 'SYSTEM_FIELD_NOT_ALLOWED');
  rejects(input({ updatedAt: 'now' }), 'SYSTEM_FIELD_NOT_ALLOWED');
  rejects(input({ 额外字段: 1 }), 'UNKNOWN_FIELD');
  rejects(input({ name: '字'.repeat(MAX_NAME_CHARS + 1) }), 'FIELD_TOO_LARGE');
  rejects(input({ body: '字'.repeat(MAX_BODY_CHARS + 1) }), 'FIELD_TOO_LARGE');
  rejects(input({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) }), 'FIELD_TOO_LARGE');
  rejects(input({ relatedWikiIds: ['not-a-uuid'] }), 'INVALID_WIKI_ID');
  // the body and the examples keep their original string; everything else is trimmed
  const preserved = normalizePromptInput(input({ body: '\n  正文\n\n', examples: ' 示例 \n' }), CATEGORIES);
  assert.equal(preserved.body, '\n  正文\n\n');
  assert.equal(preserved.examples, ' 示例 \n');
  assert.equal(normalizePromptInput(input({ name: '  名称  ' }), CATEGORIES).name, '名称');
  // tags are trimmed, de-duplicated and blank entries dropped
  assert.deepEqual(normalizePromptInput(input({ tags: [' a ', 'a', '', '  ', 'b'] }), CATEGORIES).tags, ['a', 'b']);
  assert.equal(canonicalInput(preserved), canonicalInput(preserved));
});

// ---------------------------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------------------------

test('创建：requestId 成为 id，版本 1，变量由服务端提取，文件同时保存 current 与快照', async () => {
  const { root, store, clean } = await setup();
  try {
    const requestId = uuid();
    const { prompt, reused } = await store.create(requestId, input());
    assert.equal(reused, false);
    assert.equal(prompt.id, requestId);
    assert.equal(prompt.version, 1);
    assert.equal(prompt.source, 'manual');
    assert.deepEqual(prompt.variables, ['客户名称']);
    const file = JSON.parse(await readFile(path.join(root, 'prompts', `${prompt.id}.json`), 'utf8'));
    assert.deepEqual(file.current, prompt);
    assert.equal(file.versions.length, 1);
    assert.equal(file.versions[0].changeSource, 'manual');
    assert.equal(file.creation.requestId, requestId);
    // no temp file is left behind
    assert.deepEqual(
      (await readdir(path.join(root, 'prompts'))).filter((name) => name.endsWith('.tmp')),
      [],
    );
  } finally {
    await clean();
  }
});

test('保存：每次有效保存追加完整快照并递增版本；同内容保存不产生版本也不改时间', async () => {
  const { root, store, clean } = await setup();
  try {
    const { prompt } = await store.create(uuid(), input());
    const v2 = await store.update(prompt.id, 1, input({ name: '访谈提纲 v2' }));
    assert.equal(v2.version, 2);
    const v3 = await store.update(prompt.id, 2, input({ name: '访谈提纲 v2', favorite: true }));
    assert.equal(v3.version, 3);
    const versions = await store.getVersions(prompt.id);
    assert.deepEqual(
      versions.map((item) => item.version),
      [1, 2, 3],
    );
    assert.equal(versions[0].snapshot.name, '访谈提纲');
    assert.equal(versions[0].snapshot.favorite, false);
    assert.equal(versions[2].snapshot.favorite, true);
    assert.equal(versions[0].savedAt, prompt.updatedAt);
    // a no-change save
    const same = await store.update(prompt.id, 3, input({ name: '访谈提纲 v2', favorite: true }));
    assert.equal(same.version, 3);
    assert.equal(same.updatedAt, v3.updatedAt);
    assert.equal((await store.getVersions(prompt.id)).length, 3);
    // a restart reads everything back
    const reopened = new PromptStore(
      root,
      new (await import('../services/wiki/store.ts')).WikiStore(root, new RawStore(root)),
    );
    assert.equal((await reopened.get(prompt.id))?.version, 3);
  } finally {
    await clean();
  }
});

test('冲突：同 baseVersion 只有一个成功，过期写入与删除返回 409 且不改动资产', async () => {
  const { root, store, clean } = await setup();
  try {
    const { prompt } = await store.create(uuid(), input());
    const results = await Promise.allSettled([
      store.update(prompt.id, 1, input({ name: 'A' })),
      store.update(prompt.id, 1, input({ name: 'B' })),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    assert.equal((rejected.reason as PromptError).code, 'VERSION_CONFLICT');
    assert.deepEqual((rejected.reason as PromptError).details, { currentVersion: 2 });
    const file = path.join(root, 'prompts', `${prompt.id}.json`);
    const before = await readFile(file);
    await assert.rejects(
      store.update(prompt.id, 1, input({ name: '过期' })),
      (error: PromptError) => error.code === 'VERSION_CONFLICT',
    );
    await assert.rejects(store.delete(prompt.id, 1), (error: PromptError) => error.code === 'VERSION_CONFLICT');
    assert.ok((await readFile(file)).equals(before));
  } finally {
    await clean();
  }
});

test('创建重试：同 requestId 同内容返回当前对象，不同内容 409，已回收 id 不复活', async () => {
  const { root, store, clean } = await setup();
  try {
    const requestId = uuid();
    const first = await store.create(requestId, input());
    const retry = await store.create(requestId, input());
    assert.equal(retry.reused, true);
    assert.equal(retry.prompt.version, 1);
    await store.update(requestId, 1, input({ name: '人工改过的名字' }));
    const afterEdit = await store.create(requestId, input());
    assert.equal(afterEdit.reused, true);
    assert.equal(afterEdit.prompt.name, '人工改过的名字', '重试不得覆盖后续的人工编辑');
    assert.equal(afterEdit.prompt.version, 2);
    await assert.rejects(
      store.create(requestId, input({ name: '另一组初始内容' })),
      (error: PromptError) => error.code === 'REQUEST_ID_CONFLICT',
    );
    assert.equal((await store.get(requestId))?.name, '人工改过的名字');
    // deleted -> recycled -> never revived
    await store.delete(requestId, 2);
    const revived = await rejection(() => store.create(requestId, input()));
    assert.equal(revived.code, 'PROMPT_RECYCLED');
    assert.equal(await store.get(requestId), undefined);
    assert.deepEqual(await readdir(path.join(root, 'prompts', 'recycle')), [`${requestId}.json`]);
    assert.equal(first.prompt.id, requestId);
  } finally {
    await clean();
  }
});

test('删除：原子转移到回收区，从读取/版本接口消失，其他 Prompt 不受影响', async () => {
  const { root, store, clean } = await setup();
  try {
    const a = (await store.create(uuid(), input())).prompt;
    const b = (await store.create(uuid(), input({ name: '留下的' }))).prompt;
    const bFile = path.join(root, 'prompts', `${b.id}.json`);
    const bBefore = await readFile(bFile);
    await store.delete(a.id, a.version);
    assert.equal(await store.get(a.id), undefined);
    await assert.rejects(store.getVersions(a.id), (error: PromptError) => error.code === 'NOT_FOUND');
    assert.equal((await store.list()).map((item) => item.id).join(), b.id);
    assert.ok((await readFile(bFile)).equals(bBefore));
    assert.equal((await readFile(path.join(root, 'prompts', 'recycle', `${a.id}.json`), 'utf8')).length > 0, true);
  } finally {
    await clean();
  }
});

test('列表：中文名称/标签/正文搜索、分类标签收藏筛选与分类计数', async () => {
  const { store, clean } = await setup();
  try {
    const a = (
      await store.create(uuid(), input({ name: '门店动销复盘', category: 'business_analysis', tags: ['复盘'] }))
    ).prompt;
    const b = (
      await store.create(
        uuid(),
        input({
          name: '新品计划',
          category: 'product',
          tags: ['新品'],
          favorite: true,
          body: '为 {{新品名称}} 生成计划。',
        }),
      )
    ).prompt;
    assert.deepEqual(
      (await store.list({ q: '门店动销' })).map((item) => item.id),
      [a.id],
    );
    assert.deepEqual(
      (await store.list({ q: '复盘' })).map((item) => item.id),
      [a.id],
    );
    assert.deepEqual(
      (await store.list({ q: '生成计划' })).map((item) => item.id),
      [b.id],
    );
    assert.deepEqual(await store.list({ q: '不存在的词' }), []);
    assert.deepEqual(
      (await store.list({ category: 'product' })).map((item) => item.id),
      [b.id],
    );
    assert.deepEqual(
      (await store.list({ tag: '新品' })).map((item) => item.id),
      [b.id],
    );
    assert.deepEqual(
      (await store.list({ favorite: true })).map((item) => item.id),
      [b.id],
    );
    assert.deepEqual(
      (await store.list({ favorite: false })).map((item) => item.id),
      [a.id],
      'favorite=false 只看未收藏',
    );
    assert.deepEqual(
      (await store.list({ category: 'product', tag: '新品', favorite: true, q: '新品' })).map((item) => item.id),
      [b.id],
    );
    assert.deepEqual(await store.list({ category: 'product', q: '门店' }), []);
    // Unicode 归一化：全角与半角、大小写视为同一输入，原始记录不被改写
    assert.deepEqual(
      (await store.list({ q: 'ＮＥＷ' })).map((item) => item.id),
      [],
      '归一化不会凭空匹配',
    );
    const counts = await store.categoryCounts();
    assert.equal(counts.product, 1);
    assert.equal(counts.business_analysis, 1);
    assert.equal(counts.customer, 0);
    assert.deepEqual(Object.keys(counts), CATEGORIES);
  } finally {
    await clean();
  }
});

test('变量渲染：纯计算、缺值 422、未知键 400、版本不符 409，都不改文件', async () => {
  const { root, store, clean } = await setup();
  try {
    const { prompt } = await store.create(uuid(), input({ body: '开头 {{甲}} 中 {{甲}} 尾 {{乙}}' }));
    const file = path.join(root, 'prompts', `${prompt.id}.json`);
    const before = await readFile(file);
    const rendered = await store.renderVariables(prompt.id, 1, { 甲: '一', 乙: '二' });
    assert.equal(rendered.body, '开头 一 中 一 尾 二');
    const missing = await rejection(() => store.renderVariables(prompt.id, 1, { 甲: '一' }));
    assert.equal(missing.code, 'MISSING_VARIABLES');
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.details, { missingVariables: ['乙'] });
    const unknown = await rejection(() => store.renderVariables(prompt.id, 1, { 甲: '一', 乙: '二', 丙: '三' }));
    assert.equal(unknown.code, 'UNKNOWN_VARIABLE');
    const stale = await rejection(() => store.renderVariables(prompt.id, 2, {}));
    assert.equal(stale.code, 'VERSION_CONFLICT');
    assert.ok((await readFile(file)).equals(before), '渲染不得改写记录');
  } finally {
    await clean();
  }
});

test('导出：YAML 元数据 + 正文原文，围栏与反引号不会被破坏', async () => {
  const { store, clean } = await setup();
  try {
    const body = '第一行\n```js\nconst a = `x`;\n```\n{{客户名称}}';
    const { prompt } = await store.create(uuid(), input({ body, examples: '示例正文', scenario: '场景正文' }));
    const result = await store.exportMarkdown(prompt.id);
    assert.ok(result);
    const meta = yaml.load(result.markdown.split('---')[1]) as Record<string, unknown>;
    assert.equal(meta.id, prompt.id);
    assert.equal(meta.category, 'customer');
    assert.equal(meta.categoryLabel, '客户');
    assert.deepEqual(meta.variables, ['客户名称']);
    assert.equal(meta.source, 'manual');
    assert.equal(meta.version, 1);
    assert.ok(!result.markdown.includes('## 相关 Wiki'), '没有关联时不写空的段落');
    assert.ok(result.markdown.includes('## 场景\n\n场景正文'));
    assert.ok(result.markdown.includes('## 示例\n\n示例正文'));
    assert.ok(result.markdown.endsWith(`## Prompt 正文\n\n${body}\n`), '正文逐字节保留');
    assert.equal(await store.exportMarkdown(uuid()), undefined);
  } finally {
    await clean();
  }
});

test('关联 Wiki：已失效的旧关联仍可读，新增不存在的关联被拒绝', async () => {
  const { root, wikiStore, store, clean } = await setup();
  try {
    const page = await wikiStore.create({
      title: '指标页',
      type: 'metric',
      category: 'metric',
      sources: [],
      tags: [],
      aliases: [],
      knowledge_status: 'needs_verification',
      confidence: 'low',
      source_level: 'D',
      review_status: 'reviewed',
      body: '正文。',
    });
    const { prompt } = await store.create(uuid(), input({ relatedWikiIds: [page.id] }));
    assert.deepEqual(await store.wikiLinks(prompt), [{ id: page.id, title: '指标页', status: 'resolved' }]);
    await assert.rejects(
      store.create(uuid(), input({ relatedWikiIds: [uuid()] })),
      (error: PromptError) => error.code === 'INVALID_WIKI_LINK',
    );
    await wikiStore.delete(page.id, page.revision);
    const orphan = await store.get(prompt.id);
    assert.ok(orphan);
    assert.deepEqual(await store.wikiLinks(orphan), [{ id: page.id, title: null, status: 'missing' }]);
    // 已失效的关联仍然可以保留，编辑、渲染、导出照常工作
    const edited = await store.update(prompt.id, 1, { ...input({ relatedWikiIds: [page.id] }), name: '改过的名字' });
    assert.equal(edited.version, 2);
    assert.equal((await store.renderVariables(prompt.id, 2, { 客户名称: '某客户' })).body.includes('某客户'), true);
    const exported = await store.exportMarkdown(prompt.id);
    assert.ok(exported?.markdown.includes('关联已失效'));
    assert.ok(
      (await readFile(path.join(root, 'prompts', `${prompt.id}.json`), 'utf8')).includes(page.id),
      '损坏的知识链接不影响 Prompt 记录',
    );
  } finally {
    await clean();
  }
});

test('统计：只统计顶层有效的 current 记录，回收/临时/其他 JSON 一律不算', async () => {
  const { root, rawStore, store, clean } = await setup();
  try {
    const { prompt } = await store.create(uuid(), input());
    assert.equal((await getStats(root, rawStore, new Date(), store)).promptCount, 1);
    assert.equal(await countActivePrompts(root), 1);
    const prompts = path.join(root, 'prompts');
    await writeFile(path.join(prompts, 'notes.json'), '{"note":true}');
    await writeFile(path.join(prompts, `.${uuid()}.json.abc.tmp`), '{"partial":true}');
    await mkdir(path.join(prompts, 'sub'), { recursive: true });
    await writeFile(
      path.join(prompts, 'sub', `${uuid()}.json`),
      JSON.stringify({ id: uuid(), current: {}, versions: [] }),
    );
    assert.equal((await getStats(root, rawStore, new Date(), store)).promptCount, 1);
    assert.equal(await countActivePrompts(root), 1);
    await store.delete(prompt.id, 1);
    assert.equal((await getStats(root, rawStore, new Date(), store)).promptCount, 0);
    await writeFile(path.join(prompts, 'recycle', `${uuid()}.json`), '{"recycled":true}');
    assert.equal((await getStats(root, rawStore, new Date(), store)).promptCount, 0);
    assert.equal(
      (await getStats(root, rawStore, new Date())).promptCount,
      0,
      '没有注入 store 时使用同一套有效记录规则',
    );
  } finally {
    await clean();
  }
});

// B07 返修 F07-01: a damaged file used to inflate the homepage count (10→11 in acceptance) and then
// fail on read with an unrelated internal error (`current.relatedWikiIds is not iterable`). The list,
// the detail read and the statistics now share one validity rule, and damage is never rewritten away.
test('返修 F07-01：结构损坏或身份不一致的记录不计为有效，直接读取给出受控错误且文件保持原样', async () => {
  const { root, rawStore, store, clean } = await setup();
  try {
    const good = (await store.create(uuid(), input({ name: '有效模板甲' }))).prompt;
    const other = (await store.create(uuid(), input({ name: '有效模板乙', tags: ['乙'] }))).prompt;
    assert.equal(await countActivePrompts(root), 2);
    const prompts = path.join(root, 'prompts');
    const sha = async (file: string) =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex');

    // 1) 缺字段的损坏记录：验收复现用的最小形状，文件名是合法 UUID
    const damagedId = uuid();
    const damagedFile = path.join(prompts, `${damagedId}.json`);
    await writeFile(
      damagedFile,
      JSON.stringify({ id: damagedId, current: { id: damagedId }, versions: [], creation: {} }),
    );
    const damagedBefore = await sha(damagedFile);

    // 2) 合法 UUID 文件名与内部 id/current.id 不一致的记录（内容本身完整）
    const mismatchedId = uuid();
    const mismatchedFile = path.join(prompts, `${mismatchedId}.json`);
    const complete = JSON.parse(await readFile(path.join(prompts, `${other.id}.json`), 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(mismatchedFile, JSON.stringify(complete));
    const mismatchedBefore = await sha(mismatchedFile);

    // 列表/统计/分类计数仍只看两条真实记录，损坏文件不充数
    assert.equal(await countActivePrompts(root), 2, '损坏记录不得计入有效数量');
    assert.equal((await getStats(root, rawStore, new Date(), store)).promptCount, 2);
    assert.deepEqual((await store.list()).map((item) => item.id).sort(), [good.id, other.id].sort());
    assert.deepEqual(
      Object.values(await store.categoryCounts()).reduce((sum, count) => sum + count, 0),
      2,
    );

    // 直接读取损坏记录：明确受控错误，而不是缺字段导致的 INTERNAL_ERROR
    for (const [id, label] of [
      [damagedId, '缺字段'],
      [mismatchedId, '文件名与内部 id 不一致'],
    ] as const) {
      const error = await rejection(() => store.get(id));
      assert.equal(error.code, 'CORRUPT_PROMPT', `${label}的记录必须报 CORRUPT_PROMPT，实际 ${error.code}`);
      assert.equal(error.status, 500);
      assert.equal((error.details as { id?: string } | undefined)?.id, id);
      assert.match(error.message, /已保留原文件/);
      const versionsError = await rejection(() => store.getVersions(id));
      assert.equal(versionsError.code, 'CORRUPT_PROMPT');
    }

    // 不修改也不丢弃损坏实物：两次读取后内容逐字节不变，文件仍然存在
    assert.equal(await sha(damagedFile), damagedBefore, '损坏文件不得被改写');
    assert.equal(await sha(mismatchedFile), mismatchedBefore, '身份不一致的文件不得被改写');
    assert.deepEqual(
      (await readdir(prompts)).filter((name) => name.endsWith('.json')).sort(),
      [good.id, other.id, damagedId, mismatchedId].map((id) => `${id}.json`).sort(),
    );
    // 也不能借同名 requestId 的新建覆盖它
    const createError = await rejection(() => store.create(damagedId, input()));
    assert.equal(createError.code, 'CORRUPT_PROMPT');
    assert.equal(await sha(damagedFile), damagedBefore, '新建重名请求不得覆盖损坏文件');

    // 有效模板仍然正常可读，版本与渲染不受影响
    assert.equal((await store.get(good.id))?.name, '有效模板甲');
    assert.equal((await store.get(other.id))?.name, '有效模板乙');
    assert.deepEqual(
      (await store.getVersions(good.id)).map((item) => item.version),
      [1],
    );
    assert.equal((await store.renderVariables(good.id, 1, { 客户名称: '华东' })).body, '围绕 华东 输出提纲。');
    assert.equal(await store.get(uuid()), undefined, '不存在的 id 仍然是 undefined，不是损坏');
  } finally {
    await clean();
  }
});

test('分类规则文件提供六个固定分类且不带任何预置 Prompt', async () => {
  const { store, clean } = await setup();
  try {
    const schema = await store.schema();
    assert.deepEqual(
      schema.categories.map((item) => item.id),
      CATEGORIES,
    );
    assert.deepEqual(
      schema.categories.map((item) => item.label),
      ['行业学习', '业务分析', '客户', '产品', 'AI', '日常办公'],
    );
    assert.deepEqual(await store.list(), [], '不带任何预置 Prompt');
    const raw = JSON.parse(JSON.stringify(schema.categories));
    assert.ok(raw.every((item: Record<string, unknown>) => !('prompts' in item) && !('count' in item)));
  } finally {
    await clean();
  }
});

test('保存失败时报告可读错误，且不产生新版本或半成品文件', async () => {
  const { root, store, clean } = await setup();
  const { prompt } = await store.create(uuid(), input());
  const file = path.join(root, 'prompts', `${prompt.id}.json`);
  try {
    const before = await readFile(file);
    // A read-only destination makes the final atomic rename fail, which is the same real-world
    // condition an antivirus/backup lock produces. The record itself is still readable.
    await chmod(file, 0o444);
    try {
      await assert.rejects(store.update(prompt.id, 1, input({ name: '不应保存' })), (error: PromptError) => {
        assert.equal(error.code, 'PROMPT_WRITE_FAILED');
        assert.equal(error.status, 500);
        assert.ok(error.message.length > 0, '失败信息必须可读');
        return true;
      });
      assert.ok((await readFile(file)).equals(before), '失败后旧记录保持不变');
      assert.equal((await store.getVersions(prompt.id)).length, 1, '失败不得虚增版本');
    } finally {
      await chmod(file, 0o666);
    }
    // 解除故障后可以重试
    const recovered = await store.update(prompt.id, 1, input({ name: '解除后保存成功' }));
    assert.equal(recovered.version, 2);
    assert.equal(
      (await readdir(path.join(root, 'prompts'))).filter((name) => name.endsWith('.tmp')).length,
      0,
      '不残留临时文件',
    );
  } finally {
    await chmod(file, 0o666).catch(() => undefined);
    await clean();
  }
});

test('系统字段由服务端维护：客户端提交的一律被拒绝', async () => {
  const { store, clean } = await setup();
  try {
    const { prompt } = await store.create(uuid(), input());
    for (const forged of [
      { id: uuid() },
      { version: 9 },
      { source: 'ai_generated' },
      { variables: ['x'] },
      { createdAt: 'x' },
      { updatedAt: 'x' },
    ]) {
      const error = await rejection(() => store.update(prompt.id, 1, { ...input(), ...forged }));
      assert.equal(error.code, 'SYSTEM_FIELD_NOT_ALLOWED', JSON.stringify(forged));
    }
    const stored: Prompt | undefined = await store.get(prompt.id);
    assert.equal(stored?.version, 1);
    assert.equal(stored?.source, 'manual');
  } finally {
    await clean();
  }
});
