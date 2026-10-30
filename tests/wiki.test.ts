import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { RawStore, type RawInput } from '../services/raw/store.ts';
import { WikiError, WikiStore, type WikiInput, type WikiType } from '../services/wiki/store.ts';
import { getStats } from '../services/stats/index.ts';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-data-wiki-'));
  const rawStore = new RawStore(root);
  await rawStore.initialize();
  const wikiStore = new WikiStore(root, rawStore);
  await wikiStore.initialize();
  // M04: seed through the store to keep this legacy no-origin Meeting Raw fixture compatible.
  const legacy: RawInput = { title: '门店访谈', sourceType: 'meeting', sourceName: '经销商访谈', tags: [], body: '原始正文需要保持不变。' };
  const raw = await rawStore.create(legacy);
  const clean = () => rm(root, { recursive: true, force: true });
  return { root, rawStore, wikiStore, raw, clean };
}
function input(type: WikiType, title: string, overrides: Partial<WikiInput> = {}): WikiInput {
  return {
    title, type, category: 'industry_basics', sources: [], tags: [], aliases: [],
    knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'reviewed',
    body: '## 定义\n\n待补充来源支持的说明。', ...overrides,
  };
}

test('规则文件为UI提供六类型、13分类、枚举、Source Policy和真实页面模板', async () => {
  const { wikiStore, clean } = await setup();
  try {
    const schema = await wikiStore.schema();
    assert.deepEqual(schema.types.map(item => item.id), ['source', 'concept', 'entity', 'business_process', 'metric', 'synthesis']);
    assert.equal(schema.categories.length, 13);
    assert.ok(schema.pageTemplates.business_process.sections.some(section => section.label === '可能的 AI 机会'));
    assert.ok(schema.pageTemplates.metric.sections.some(section => section.label === '计算方式'));
    assert.match(schema.sourcePolicy.guidance, /verified.*reviewed/);
  } finally { await clean(); }
});

test('统计读取统一created字段，Index和回收页不算正式Wiki或本周新增', async () => {
  const { root, rawStore, wikiStore, clean } = await setup();
  try {
    const item = await wikiStore.create(input('concept', '新建指标', { category: 'metric' }));
    let stats = await getStats(root, rawStore, new Date());
    assert.equal(stats.wikiCount, 1);
    assert.equal(stats.thisWeekNewCount, 2);
    await wikiStore.delete(item.id, item.revision);
    stats = await getStats(root, rawStore, new Date());
    assert.equal(stats.wikiCount, 0);
    assert.equal(stats.thisWeekNewCount, 1);
  } finally { await clean(); }
});

test('六种Wiki都可创建、回读与导出；YAML符合统一结构且不重复写正文', async () => {
  const { root, wikiStore, raw, clean } = await setup();
  try {
    const types: WikiType[] = ['source', 'concept', 'entity', 'business_process', 'metric', 'synthesis'];
    const pages = [];
    for (const type of types) {
      const sources = type === 'source' ? [raw.id] : [];
      pages.push(await wikiStore.create(input(type, `${type} 页面`, { sources, body: `## 正文\n\n${type}内容。` })));
    }
    const categoryCounts = await wikiStore.categoryCounts();
    assert.equal(categoryCounts.industry_basics, 6);
    const source = pages[0];
    const disk = await readFile(path.join(root, 'knowledge', 'wiki', `${source.id}.md`), 'utf8');
    const closeAt = disk.indexOf('\n---\n');
    const metadata = yaml.load(disk.slice(4, closeAt)) as Record<string, unknown>;
    for (const field of ['id', 'title', 'type', 'domain', 'category', 'created', 'updated', 'sources', 'tags', 'knowledge_status', 'confidence', 'source_level', 'review_status', 'aliases', 'revision']) assert.ok(field in metadata, `缺少 ${field}`);
    assert.equal('body' in metadata, false);
    assert.equal((await wikiStore.get(source.id))?.body, '## 正文\n\nsource内容。');
    const exported = await wikiStore.exportMarkdown(source.id);
    assert.equal(exported?.markdown, disk);
    assert.equal((await wikiStore.list()).length, 6);
  } finally { await clean(); }
});

test('五字段中文搜索含分类label，13分类数量不受搜索条件影响', async () => {
  const { wikiStore, clean } = await setup();
  try {
    await wikiStore.create(input('concept', '门店销量波动', { category: 'supply_chain', aliases: ['动销起伏'], tags: ['促销计划'], body: '重点分析折扣率变化。' }));
    for (const query of ['销量波动', '动销起伏', '促销计划', '折扣率', '供应链']) assert.equal((await wikiStore.list({ q: query })).length, 1, query);
    assert.equal((await wikiStore.list({ q: '折扣率' }))[0].title, '门店销量波动');
    assert.equal((await wikiStore.categoryCounts()).supply_chain, 1);
    assert.equal(Object.keys(await wikiStore.categoryCounts()).length, 13);
  } finally { await clean(); }
});

test('改名自动保留旧标题别名；Wikilink唯一解析、缺失与歧义明确', async () => {
  const { wikiStore, clean } = await setup();
  try {
    const target = await wikiStore.create(input('concept', '动销'));
    const ref = await wikiStore.create(input('entity', '经销商手册', { body: '参见 [[动销]]、[[不存在知识]]。' }));
    assert.equal((await wikiStore.links(ref.id)).find(link => link.text === '动销')?.status, 'found');
    assert.equal((await wikiStore.links(ref.id)).find(link => link.text === '不存在知识')?.status, 'missing');
    const renamed = await wikiStore.update(target.id, target.revision, input('concept', '动销指标'));
    assert.ok(renamed.aliases.includes('动销'));
    assert.equal((await wikiStore.links(ref.id)).find(link => link.text === '动销')?.candidates[0].id, target.id);
    await wikiStore.create(input('metric', '销售指标', { aliases: ['动销'] }));
    assert.equal((await wikiStore.links(ref.id)).find(link => link.text === '动销')?.status, 'ambiguous');
  } finally { await clean(); }
});

test('revision冲突阻止覆盖；删除前返回入链并将资产移出有效Wiki目录', async () => {
  const { root, wikiStore, clean } = await setup();
  try {
    const target = await wikiStore.create(input('concept', '铺货'));
    const page = await wikiStore.create(input('entity', '渠道记录', { body: '流程参考 [[铺货]]。' }));
    const updated = await wikiStore.update(target.id, target.revision, input('concept', '铺货率'));
    await assert.rejects(wikiStore.update(target.id, target.revision, input('concept', '过期写入')), (error: unknown) => error instanceof WikiError && error.status === 409);
    const references = await wikiStore.references(target.id);
    assert.deepEqual(references.map(reference => reference.pageId), [page.id]);
    const removed = await wikiStore.delete(target.id, updated.revision);
    assert.equal(removed.references[0].pageId, page.id);
    assert.equal(await wikiStore.get(target.id), undefined);
    assert.ok((await readdir(path.join(root, 'knowledge', 'recycle', 'wiki'))).includes(`${target.id}.md`));
    assert.equal((await wikiStore.list()).length, 1);
    const index = await readFile(path.join(root, 'knowledge', 'wiki', 'index.md'), 'utf8');
    assert.equal(index.includes(target.id), false);
    const log = await readFile(path.join(root, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8');
    assert.match(log, /"action":"delete"/);
  } finally { await clean(); }
});

test('verified需要Raw且reviewed；source_supported只需要有效Raw；Raw摘要保持不变', async () => {
  const { root, rawStore, wikiStore, raw, clean } = await setup();
  try {
    const filePath = path.join(root, 'knowledge', 'raw', 'meetings', `${raw.id}.md`);
    const before = await readFile(filePath, 'utf8');
    await assert.rejects(wikiStore.create(input('concept', '无来源核验', { knowledge_status: 'verified' })), (error: unknown) => error instanceof WikiError && error.code === 'STATUS_REQUIRES_REVIEWED_SOURCE');
    await assert.rejects(wikiStore.create(input('concept', '未审核核验', { sources: [raw.id], knowledge_status: 'verified', review_status: 'unreviewed' })), WikiError);
    await wikiStore.create(input('concept', '来源支持条目', { sources: [raw.id], knowledge_status: 'source_supported', review_status: 'unreviewed' }));
    assert.equal(await readFile(filePath, 'utf8'), before);
    assert.equal((await rawStore.get(raw.id))?.body, '原始正文需要保持不变。');
  } finally { await clean(); }
});

test('Index失败明确报告已提交revision并在重启时通过pending记录恢复', async () => {
  const { root, rawStore, clean } = await setup();
  try {
    const wikiStore = new WikiStore(root, rawStore);
    await rm(path.join(root, 'knowledge', 'wiki', 'index.md'));
    await mkdir(path.join(root, 'knowledge', 'wiki', 'index.md'));
    let committedId = '';
    await assert.rejects(wikiStore.create(input('concept', '待恢复条目')), (error: unknown) => {
      if (!(error instanceof WikiError) || error.code !== 'DERIVED_FILES_PENDING') return false;
      const details = error.details as {committed: boolean; id: string; revision: number; recoverable: boolean};
      assert.equal(details.committed, true); assert.equal(details.revision, 1); assert.equal(details.recoverable, true);
      committedId = details.id;
      return true;
    });
    assert.ok(await wikiStore.get(committedId));
    await rm(path.join(root, 'knowledge', 'wiki', 'index.md'), { recursive: true, force: true });
    const recovered = new WikiStore(root, rawStore);
    await recovered.initialize();
    const index = await readFile(path.join(root, 'knowledge', 'wiki', 'index.md'), 'utf8');
    assert.ok(index.includes(committedId));
    const log = await readFile(path.join(root, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8');
    assert.equal(log.split(/\r?\n/).filter(line => line.includes(committedId)).length, 1);
    assert.equal((await readdir(path.join(root, 'state', 'wiki-operations'))).length, 0);
  } finally { await clean(); }
});
