import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExtractionCheckpointStore, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { chunkText } from '../services/llm/chunk.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { expandKnowledgePlan, projectKnowledgePlan, type KnowledgePlanningInput, type KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { approveDraft } from './support/human-review.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const quotes = [
  '【虚构】门店补货是根据门店库存与需求补充商品的业务活动。',
  '【虚构】门店补货的目的是降低缺货风险。',
  '【虚构】当门店库存低于安全库存时，由店长发起补货申请。',
  '【虚构】店长提交补货单，库管核对可用库存后安排发货。',
  '【虚构】AI尚未上线，仅为未来建议，收益未知。',
  '【虚构】异常审批负责人未知。',
];
const editedText = '门店补货是结合门店库存与需求补充商品的活动，适用口径仍需核对。';
const retainUi = process.argv.includes('--retain-ui-fixture');

async function fixture(mutate?: (wire: KnowledgeWirePlan) => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r1618-fields-lab-'));
  const raws = new RawStore(root), states = new RawStateStore(root), drafts = new DraftStore(root), checkpoints = new ExtractionCheckpointStore(root);
  await Promise.all([raws.initialize(), states.initialize(), drafts.initialize(), checkpoints.initialize()]);
  const body = quotes.join('');
  const raw = await raws.create({title:'R1618 AI字段虚构工程夹具',sourceType:'note',sourceName:'fake，不是真实自动质量证据',tags:['虚构'],body});
  const bundle = await loadExtractionRules('rules');
  const rules = {types:bundle.fmcg.types.map(item=>item.id),categories:bundle.fmcg.categories.map(item=>item.id),knowledge_status:bundle.fmcg.enums.knowledge_status,confidence:bundle.fmcg.enums.confidence,source_level:bundle.fmcg.enums.source_level,review_status:bundle.fmcg.enums.review_status};
  const requests: LlmCompletionRequest[] = [];
  const provider: LlmProvider = {name:'fake',model:'r1618-engineering',complete:async request=>{
    requests.push(request);
    const input = JSON.parse(request.user.split('\n').at(-1)!);
    if (!request.user.includes('请对下列全部已验证事实规划知识页')) return {text:JSON.stringify({version:2,facts:input.slice(0,5).map((atom:{id:string})=>({atomId:atom.id,kind:'fact'})),questions:[{atomId:input[5].id}],sourceNotes:[]}),bytes:1,finishReason:'stop'};
    const units = input.factUnits as Array<{id:string}>;
    const field = (text:string, ...indices:number[]) => ({text,factUnitIds:indices.map(index=>units[index].id)});
    const wire: KnowledgeWirePlan = {version:3,document:{title:'来源：虚构门店补货',main_topic:'补货'},pages:[
      {title:'虚构门店补货概念',type:'concept',category:'supply_chain',factUnitIds:units.slice(0,2).map(unit=>unit.id),questionUnitIds:[],templateFields:{
        one_line_explanation:field('门店补货是按门店库存与需求补充商品的业务活动。',0),definition:field('根据库存与需求补充门店商品。',0),why_important:field('以降低缺货风险为目标。',1),
      }},
      {title:'虚构门店补货流程',type:'business_process',category:'supply_chain',factUnitIds:units.slice(2).map(unit=>unit.id),questionUnitIds:input.questionUnits.map((unit:{id:string})=>unit.id),templateFields:{
        trigger:field('门店库存低于安全库存时，由店长发起申请。',2),steps:field('店长提交补货单，库管核对可用库存后安排发货。',3),ai_opportunities:field('建议未来探索AI辅助核对；当前未上线，收益未知。',4),
      }},
    ]};
    mutate?.(wire);
    return {text:JSON.stringify(wire),bytes:1,finishReason:'stop'};
  }};
  let checkpoint = await checkpoints.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:raw.bodySha256,pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'fake|r1618-engineering',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
  const args = {raw,body,bodySha256:raw.bodySha256,provider,rulesDir:path.resolve('rules'),beforeCall:async(stage:'extracting'|'planning')=>checkpoint=await checkpoints.save({...checkpoint,stage,attempts:checkpoint.attempts+1}),saveCheckpoint:async(value:Omit<ExtractionCheckpoint,'integrity'>)=>checkpoint=await checkpoints.save(value)};
  const create = (outcome: Awaited<ReturnType<typeof runKnowledgePipeline>>['outcome'])=>drafts.create({raw,body,rules,jobId:checkpoint.jobId,outcome});
  return {root,raw,raws,states,drafts,checkpoints,bundle,rules,body,requests,args,create,get checkpoint(){return checkpoint;},run:()=>runKnowledgePipeline({...args,checkpoint}),clean:()=>rm(root,{recursive:true,force:true})};
}

test('R1618 AUTO: 新链两类型字段、原ID持久恢复、编辑失审、正式新建回读及引用保全', async()=>{
  const f = await fixture();
  let keep = false;
  try {
    const rawPath = path.join(f.root,'knowledge/raw/notes',`${f.raw.id}.md`), rawBefore = await readFile(rawPath,'utf8');
    const {outcome} = await f.run();
    assert.equal(f.requests.length,2,'同一次planning，无新增调用');
    assert(f.requests[1].system.includes('不能凭标题或关键词机械填充'));
    const persisted = (await f.checkpoints.get(f.checkpoint.jobId))!;
    await validateKnowledgeCheckpoint({...f.args,checkpoint:persisted});
    const resumed = await runKnowledgePipeline({...f.args,checkpoint:persisted});
    assert.deepEqual(resumed.outcome.pages,outcome.pages);
    assert.equal(f.requests.length,2,'已保存规划恢复不调用');
    assert.deepEqual(outcome.pages[0].templateFields!.one_line_explanation!.aiContent!.factIds,['f-c1-1']);
    assert.deepEqual(persisted.plan!.pages[0].templateFields!.definition!.factIds,['f-c1-1']);
    assert.equal(outcome.pages[0].templateFields!.scenarios,undefined);
    assert.equal(outcome.pages[1].templateFields!.roles,undefined);
    for (const page of outcome.pages) for (const field of Object.values(page.templateFields!)) {
      assert.equal(field.humanText,undefined);
      assert.deepEqual(field.evidenceIds,[]);
      assert(field.aiContent!.evidenceIds.every(id=>page.source_evidence.some(e=>e.id===id)));
    }
    assert.deepEqual(outcome.pages.flatMap(page=>page.source_facts.map(fact=>fact.text)),quotes.slice(0,5));
    assert.deepEqual(outcome.pages[1].open_questions,[quotes[5]]);
    let draft = await f.create(outcome);
    const originals = draft.pages.map(page=>({facts:structuredClone(page.source_facts),evidence:structuredClone(page.source_evidence)}));
    const initialPreview = f.drafts.view(draft).pages;
    assert(initialPreview[0].renderedBody.includes('AI整理（待核对）'));
    assert(initialPreview[1].renderedBody.includes('分析建议｜AI整理（待核对）'));
    assert(!initialPreview[0].renderedBody.includes('来源摘录（用户归位）：'));
    assert(initialPreview[0].renderedBody.includes('## 常见业务场景\n\n待确认。'));
    assert(initialPreview[1].renderedBody.includes(quotes[4]));
    draft = await f.drafts.patch(draft.id,{baseRevision:draft.revision,pages:draft.pages.map(page=>({pageId:page.pageId,selected:true}))},{body:f.body,rules:f.rules});
    draft = await approveDraft(f.drafts,draft.id,f.body);
    assert.equal(draft.humanReview!.approvals.length,2);
    const concept = draft.pages[0];
    const fields = structuredClone(concept.templateFields!);
    fields.one_line_explanation!.aiContent!.text = editedText;
    fields.one_line_explanation!.humanText = '人工说明保持独立。';
    fields.one_line_explanation!.evidenceIds = [concept.source_evidence[0].id];
    draft = await f.drafts.patch(draft.id,{baseRevision:draft.revision,pages:[{pageId:concept.pageId,templateFields:fields}]},{body:f.body,rules:f.rules});
    assert.equal(draft.humanReview!.approvals.length,0);
    assert.equal(draft.pages[0].templateFields!.one_line_explanation!.aiContent!.humanEdited,true,'服务端依据文本差异标记');
    const resend = structuredClone(draft.pages[0].templateFields!);
    delete resend.one_line_explanation!.aiContent!.humanEdited;
    draft = await f.drafts.patch(draft.id,{baseRevision:draft.revision,pages:[{pageId:concept.pageId,templateFields:resend,title:'人工核对后的补货概念标题'}]},{body:f.body,rules:f.rules});
    assert.equal(draft.pages[0].templateFields!.one_line_explanation!.aiContent!.humanEdited,true,'客户端省略不能抹除标记');
    assert.deepEqual(draft.pages[0].templateFields!.one_line_explanation!.aiContent!.factIds,['f-c1-1'],'改标题不改引用');
    const removedAi = structuredClone(draft.pages[0].templateFields!);
    removedAi.definition!.humanText = '定义字段人工补充。';
    removedAi.definition!.evidenceIds = [concept.source_evidence[0].id];
    delete removedAi.definition!.aiContent;
    draft = await f.drafts.patch(draft.id,{baseRevision:draft.revision,pages:[{pageId:concept.pageId,templateFields:removedAi}]},{body:f.body,rules:f.rules});
    assert.equal(draft.pages[0].templateFields!.definition!.aiContent,undefined);
    assert.equal(draft.pages[0].templateFields!.definition!.humanText,'定义字段人工补充。');
    assert.deepEqual(draft.pages[0].templateFields!.definition!.evidenceIds,removedAi.definition!.evidenceIds);
    const beforeRejected = (await f.drafts.get(draft.id))!;
    const unit = draft.humanReview!.units.find(unit=>unit.memberIds.includes('f-c1-1'))!;
    await assert.rejects(f.drafts.reviewOperation(draft.id,{action:'move',baseRevision:draft.revision,unitIds:[unit.id],pageId:draft.pages[1].pageId},{body:f.body,rulesDir:'rules'}),{code:'TEMPLATE_AI_FACT_UNKNOWN'});
    assert.deepEqual(await f.drafts.get(draft.id),beforeRejected);
    const bad = structuredClone(draft.pages[0].templateFields!);
    bad.one_line_explanation!.aiContent!.factIds=['f-c1-3'];
    await assert.rejects(f.drafts.patch(draft.id,{baseRevision:draft.revision,pages:[{pageId:concept.pageId,templateFields:bad}]},{body:f.body,rules:f.rules}),{code:'TEMPLATE_AI_REFERENCES_IMMUTABLE'});
    assert.deepEqual(await f.drafts.get(draft.id),beforeRejected);
    const wiki = new WikiStore(f.root,f.raws); await wiki.initialize();
    const commits = new WikiCommitService({root:f.root,wikiStore:wiki,rawStore:f.raws,rawStates:f.states,drafts:f.drafts}); await commits.initialize();
    const input = {draftId:draft.id,baseRevision:draft.revision,selectedPageIds:draft.pages.map(page=>page.pageId),idempotencyKey:randomUUID(),operationId:randomUUID(),now:new Date().toISOString()};
    await assert.rejects(wiki.withLock(()=>commits.confirm(input)),{code:'HUMAN_REVIEW_INCOMPLETE'});
    draft = await approveDraft(f.drafts,draft.id,f.body);
    const preview = f.drafts.view(draft).pages;
    assert(preview[0].renderedBody.includes('AI草稿经人工修改（待核对）'));
    assert(preview[0].renderedBody.includes('人工说明（待核对）：人工说明保持独立。'));
    const confirmed = await wiki.withLock(()=>commits.confirm({...input,baseRevision:draft.revision}));
    assert.equal(confirmed.manifest.status,'completed');
    const formal = await new WikiStore(f.root,new RawStore(f.root)).allRecords();
    assert.equal(formal.length,3);
    for (const [index,page] of draft.pages.entries()) {
      assert.equal(formal.find(record=>record.title===page.title)!.body,preview[index].renderedBody);
      assert.deepEqual(page.source_facts,originals[index].facts);
      assert.deepEqual(page.source_evidence,originals[index].evidence);
    }
    const reloaded = (await new DraftStore(f.root).get(draft.id))!;
    assert.equal(reloaded.pages[0].templateFields!.one_line_explanation!.aiContent!.humanEdited,true);
    assert.equal(await readFile(rawPath,'utf8'),rawBefore);
    if (retainUi) {
      const uiDraft = await f.create(outcome);
      const meta = {kind:'r1618-fields-lab-v1',root:f.root,baseline:'6581884',draftId:uiDraft.id,rawId:f.raw.id,originalRawSha256:sha(rawBefore),originalPages:uiDraft.pages.map(page=>({pageId:page.pageId,source_facts:page.source_facts,source_evidence:page.source_evidence})),realCalls:0,fixtureKind:'r1618-auto-fake-not-real-quality'};
      await writeFile(path.join(f.root,'r1618-lab.json'),JSON.stringify(meta,null,2)+'\n');
      console.log(`R1618_AUTO_UI_FIXTURE ${f.root}`);
      keep = true;
    }
  } finally { if (!keep) await f.clean(); }
});

test('R1618 AUTO: 未知/跨页unit及错误类型字段拒绝，失败不保存错误规划',async()=>{
  const invalid: Array<(wire:KnowledgeWirePlan)=>void> = [
    wire=>{wire.pages[0].templateFields!.definition!.factUnitIds=['unknown-unit'];},
    wire=>{wire.pages[0].templateFields!.definition!.factUnitIds=[wire.pages[1].factUnitIds[0]];},
    wire=>{wire.pages[0].templateFields!.trigger={text:'不能跨类型',factUnitIds:[wire.pages[0].factUnitIds[0]]};},
  ];
  for (const mutate of invalid) {
    const f = await fixture(mutate);
    try {
      await assert.rejects(f.run(),{code:'LLM_PLAN_FIELD_INVALID'});
      assert.equal(f.checkpoint.plan,undefined);
      assert.equal(f.requests.length,2);
      assert.equal(f.checkpoint.completedChunks[0].facts.length,5);
    } finally { await f.clean(); }
  }
});

test('R1618 AUTO: 旧无字段plan与草稿仍可恢复，不自动补写字段',async()=>{
  const f = await fixture(wire=>{for (const page of wire.pages) delete page.templateFields;});
  try {
    const {outcome} = await f.run();
    const saved = (await f.checkpoints.get(f.checkpoint.jobId))!;
    await validateKnowledgeCheckpoint({...f.args,checkpoint:saved});
    const restored = await runKnowledgePipeline({...f.args,checkpoint:saved});
    assert.equal(f.requests.length,2);
    assert.deepEqual(restored.outcome.pages,outcome.pages);
    const draft = await f.create(outcome);
    const old = (await new DraftStore(f.root).get(draft.id))!;
    assert(old.pages.every(page=>page.templateFields===undefined));
    const body = f.drafts.view(old).pages[0].renderedBody;
    assert(body.includes('## 一句话解释\n\n虚构门店补货概念'));
    assert(body.includes('## 定义\n\n待确认。'));
    assert(!body.includes('AI归位'));
  } finally { await f.clean(); }
});

test('R1618 AUTO: 字段unit展开与反投影保留全部等价原ID，重命名不影响引用',()=>{
  const input: KnowledgePlanningInput = {facts:[],questions:[],sourceContexts:[],factUnits:[{id:'fu-a',sourceId:'s-0-2',text:'原文',kind:'fact',memberIds:['f-c1-1','f-c2-1']}],questionUnits:[]};
  const wire: KnowledgeWirePlan = {version:3,document:{title:'来源',main_topic:'主题'},pages:[{title:'概念',type:'concept',category:'other',factUnitIds:['fu-a'],questionUnitIds:[],templateFields:{definition:{text:'AI解释',factUnitIds:['fu-a']}}}]};
  const pages = expandKnowledgePlan(wire,input);
  assert.deepEqual(pages[0].templateFields!.definition!.factIds,['f-c1-1','f-c2-1']);
  assert.deepEqual(projectKnowledgePlan({document:{...wire.document,summary:'原文'},pages},input),wire);
  pages[0].title='新标题';
  assert.deepEqual(projectKnowledgePlan({document:{...wire.document,summary:'原文'},pages},input).pages[0].templateFields,wire.pages[0].templateFields);
  pages[0].templateFields!.definition!.factIds.pop();
  assert.throws(()=>projectKnowledgePlan({document:{...wire.document,summary:'原文'},pages},input),{code:'LLM_CHECKPOINT_CORRUPT'});
});
