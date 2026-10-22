import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { findDuplicateCandidates } from '../services/search/duplicates.ts';
import type { LlmProvider } from '../services/llm/provider.ts';

const wikiInput = (title: string, overrides: Partial<WikiInput> = {}): WikiInput => ({ title, type: 'concept', category: 'industry_basics', sources: [], tags: [], aliases: [], knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'reviewed', body: '基础内容', ...overrides });

test('B05 五维候选显示标题、别名、分类、标签和内容理由，分类单独命中权重低', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const alias = await wiki.create(wikiInput('渠道利润', { aliases: ['经销商毛利'], tags: ['利润分析'], body: '经销商渠道利润与毛利核算方式。' }));
    const match = findDuplicateCandidates({ title: '经销商毛利', category: 'industry_basics', tags: ['利润分析'], content: '经销商渠道利润与毛利核算方式。' }, [alias]);
    assert.ok(match[0].matches.some(item => item.dimension === 'aliases'));
    assert.ok(match[0].matches.some(item => item.dimension === 'tags'));
    assert.ok(match[0].matches.some(item => item.dimension === 'content'));
    const categoryOnly = findDuplicateCandidates({ title: '完全不同', category: 'industry_basics', content: '无关正文' }, [alias]);
    assert.ok(categoryOnly[0].score < 0.1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('B05 synthesis 确认创建Source与综合页，按Raw去重并支持确认幂等', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const one = await raws.create({ title: '报告甲', sourceType: 'report', sourceName: '甲', tags: [], body: '销量增长10%。' });
    const two = await raws.create({ title: '报告乙', sourceType: 'report', sourceName: '乙', tags: [], body: '销量增长12%。' });
    const provider: LlmProvider = { name: 'fake-test', model: 'b05', secrets: [], complete: async () => ({ text: JSON.stringify({ title: '销量综合', category: 'industry_basics', agreement: [{ text: '销量增长', rawId: one.id, quote: '销量增长10%', start: 0, end: 7 }], conflicts: [{ text: '幅度不同', rawId: two.id, quote: '销量增长12%', start: 0, end: 7 }], inferences: ['需核对统计口径'], openQuestions: ['口径是否一致？'], suggestedAdditions: [] }), finishReason: 'stop', bytes: 300 }) };
    const service = new KnowledgeWorkflowStore(root, wiki, raws); await service.initialize();
    const draft = await service.createSynthesis({ rawIds: [one.id, two.id, one.id], provider });
    assert.equal(draft.sources.length, 2);
    assert.equal((await wiki.allRecords()).length, 0);
    const result = await service.confirm(draft.id, draft.revision, 'key-one');
    const completedPage = await wiki.get(result.wikiId);
    await wiki.update(result.wikiId, completedPage!.revision, { ...completedPage!, body: `${completedPage!.body}\n人工完成后编辑` });
    const retry = await service.confirm(draft.id, result.workflow.revision, 'key-two');
    assert.equal(retry.reused, true);
    assert.ok((await wiki.get(result.wikiId))?.body.includes('人工完成后编辑'));
    assert.equal((await wiki.allRecords()).filter(item => item.type === 'source').length, 2);
    const synthesis = await wiki.get(result.wikiId);
    assert.ok(synthesis?.body.includes('销量增长10%'));
    assert.ok(synthesis?.body.includes('销量增长12%'));
    assert.deepEqual([await raws.get(one.id), await raws.get(two.id)].map(item => item?.bodySha256), [one.bodySha256, two.bodySha256]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('B05 非法综合分类在保存草稿前拒绝', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const one = await raws.create({ title: '来源甲', sourceType: 'report', sourceName: '甲', tags: [], body: '市场增长10%。' });
    const two = await raws.create({ title: '来源乙', sourceType: 'report', sourceName: '乙', tags: [], body: '市场增长12%。' });
    const provider: LlmProvider = { name: 'fake-test', model: 'b05', secrets: [], complete: async () => ({ text: JSON.stringify({ title: '综合', category: 'not-a-real-category', agreement: [], conflicts: [], inferences: [], openQuestions: [], suggestedAdditions: [] }), finishReason: 'stop', bytes: 200 }) };
    const service = new KnowledgeWorkflowStore(root, wiki, raws); await service.initialize();
    await assert.rejects(() => service.createSynthesis({ rawIds: [one.id, two.id], provider }), (error: any) => error.code === 'LLM_SCHEMA_INVALID');
    assert.equal((await service.list()).length, 0);
    assert.equal((await wiki.allRecords()).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('B05 Raw正文与frontmatter哈希不一致时拒绝生成及确认', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const one = await raws.create({ title: '来源甲', sourceType: 'report', sourceName: '甲', tags: [], body: '市场增长10%。' });
    const two = await raws.create({ title: '来源乙', sourceType: 'report', sourceName: '乙', tags: [], body: '市场增长12%。' });
    const provider: LlmProvider = { name: 'fake-test', model: 'b05', secrets: [], complete: async () => ({ text: JSON.stringify({ title: '市场综合', category: 'industry_basics', agreement: [], conflicts: [], inferences: [], openQuestions: [], suggestedAdditions: [] }), finishReason: 'stop', bytes: 200 }) };
    const service = new KnowledgeWorkflowStore(root, wiki, raws); await service.initialize();
    const draft = await service.createSynthesis({ rawIds: [one.id, two.id], provider });
    const tamperedFile = path.join(root, 'knowledge', 'raw', 'reports', `${one.id}.md`);
    await appendFile(tamperedFile, '\n外部追加但未更新frontmatter哈希');
    await assert.rejects(() => service.confirm(draft.id, draft.revision, 'tampered-key'), (error: any) => error.code === 'RAW_CHANGED');
    assert.equal((await wiki.allRecords()).length, 0);
    assert.equal((await service.get(draft.id))?.status, 'pending_confirmation');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('B05 重启恢复完成提交后收敛workflow，completed manifest不覆盖后续人工编辑', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const one = await raws.create({ title: '来源甲', sourceType: 'report', sourceName: '甲', tags: [], body: '销量增长10%。' });
    const two = await raws.create({ title: '来源乙', sourceType: 'report', sourceName: '乙', tags: [], body: '销量增长12%。' });
    const provider: LlmProvider = { name: 'fake-test', model: 'b05', secrets: [], complete: async () => ({ text: JSON.stringify({ title: '销量综合', category: 'industry_basics', agreement: [], conflicts: [], inferences: [], openQuestions: [], suggestedAdditions: [] }), finishReason: 'stop', bytes: 200 }) };
    const service = new KnowledgeWorkflowStore(root, wiki, raws); await service.initialize();
    const draft = await service.createSynthesis({ rawIds: [one.id, two.id], provider });
    const rebuild = wiki.rebuildIndexLocked.bind(wiki);
    (wiki as any).rebuildIndexLocked = async () => { throw new Error('injected index EIO'); };
    await assert.rejects(() => service.confirm(draft.id, draft.revision, 'recovery-key'), (error: any) => error.code === 'WORKFLOW_COMMIT_PENDING');
    (wiki as any).rebuildIndexLocked = rebuild;
    const restartedWiki = new WikiStore(root, raws); await restartedWiki.initialize();
    const restarted = new KnowledgeWorkflowStore(root, restartedWiki, raws); await restarted.initialize();
    const recovered = await restarted.get(draft.id);
    assert.equal(recovered?.status, 'confirmed');
    assert.ok(recovered?.commitOperationId);
    assert.ok(recovered?.committedWikiId);
    const manifest = await restarted.getCommit(recovered!.commitOperationId!);
    assert.equal(manifest?.status, 'completed');
    const committedPage = await restartedWiki.get(recovered!.committedWikiId!);
    await restartedWiki.update(committedPage!.id, committedPage!.revision, { ...committedPage!, body: `${committedPage!.body}\n恢复后人工编辑` });
    const retry = await restarted.confirm(draft.id, recovered!.revision, 'different-key');
    assert.equal(retry.reused, true);
    assert.ok((await restartedWiki.get(committedPage!.id))?.body.includes('恢复后人工编辑'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('B05 更新预览保留两套公式，Raw证据可定位，旧revision会拒绝覆盖', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-b05-'));
  try {
    const raws = new RawStore(root); await raws.initialize();
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const oldRaw = await raws.create({ title: '旧口径', sourceType: 'report', sourceName: '甲', tags: [], body: '毛利率=毛利/销售额。' });
    const newRaw = await raws.create({ title: '新口径', sourceType: 'report', sourceName: '乙', tags: [], body: '毛利率=毛利/含税销售额。' });
    const target = await wiki.create(wikiInput('毛利率', { type: 'metric', category: 'metric', sources: [oldRaw.id], knowledge_status: 'source_supported', source_level: 'C', body: '既有公式：毛利率=毛利/销售额。' }));
    const provider: LlmProvider = { name: 'fake-test', model: 'b05', secrets: [], complete: async () => ({ text: JSON.stringify({ suggestedAdditions: [{ text: '新来源采用含税销售额', evidenceId: 'new-evidence' }], conflicts: [{ text: '分母口径不同', evidenceId: 'new-evidence' }], inferences: ['统计范围需要确认'], openQuestions: ['两种口径适用场景是什么？'], agreement: [] }), finishReason: 'stop', bytes: 300 }) };
    const service = new KnowledgeWorkflowStore(root, wiki, raws); await service.initialize();
    const draft = { id: 'draft', revision: 2, rawId: newRaw.id, rawSha256: newRaw.bodySha256, pages: [{ pageId: 'page', title: '毛利率', source_facts: [{ text: newRaw.body, evidenceIds: ['new-evidence'] }], source_evidence: [{ id: 'new-evidence', rawId: newRaw.id, quote: newRaw.body, start: 0, end: newRaw.body.length }], ai_organized: [], ai_inferences: [], open_questions: [] }] };
    const workflow = await service.createUpdate({ draftId: draft.id, pageId: 'page', baseRevision: 2, targetWikiId: target.id, draft, raw: newRaw, target, provider });
    assert.equal((await wiki.get(target.id))?.body, target.body);
    const result = await service.confirm(workflow.id, workflow.revision, 'update-key');
    const updated = await wiki.get(target.id);
    assert.ok(updated?.body.includes('既有公式：毛利率=毛利/销售额。'));
    assert.ok(updated?.body.includes('毛利率=毛利/含税销售额。'));
    assert.deepEqual(new Set(updated?.sources), new Set([oldRaw.id, newRaw.id]));
    assert.equal((await wiki.allRecords()).filter(item => item.type === 'source' && item.sources.includes(newRaw.id)).length, 1);
    assert.equal(result.workflow.status, 'confirmed');

    const targetNow = await wiki.get(target.id);
    const stale = await service.createUpdate({ draftId: draft.id, pageId: 'page', baseRevision: 2, targetWikiId: target.id, draft, raw: newRaw, target: targetNow!, provider });
    await wiki.update(target.id, targetNow!.revision, { ...targetNow!, body: `${targetNow!.body}\n人工新编辑` });
    await assert.rejects(() => service.confirm(stale.id, stale.revision, 'stale-key'), /已被修改/);
    assert.ok((await wiki.get(target.id))?.body.includes('人工新编辑'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
