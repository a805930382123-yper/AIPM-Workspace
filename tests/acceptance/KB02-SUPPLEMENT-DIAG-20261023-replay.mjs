// Offline diagnosis only. Historical responses are injected; no product stores are opened.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { chunkText } from '../../services/llm/chunk.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { buildKnowledgePlanningInput, expandKnowledgePlan, projectKnowledgePlan, KNOWLEDGE_PLANNING_INSTRUCTION } from '../../services/llm/knowledge-planning.ts';
import { coverageDiagnostic, hasCoverageErrors } from '../../services/llm/knowledge-atoms.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { validateSchema } from '../../services/llm/schema-validator.ts';

const started = Date.now();
const prefix = 'docs/reports/KB02-SUPPLEMENT-DIAG-20261023-';
const historical = 'docs/reports/KB02-REGION-AUDIT-20261023-';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const write = async (name, data) => fs.writeFile(prefix + name + '.json', JSON.stringify(data, null, 2) + '\n');
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw Error('Offline diagnosis: network disabled'); };
globalThis.fetch = blocked;
for (const mod of [http, https]) { mod.request = blocked; mod.get = blocked; }
net.connect = blocked; net.createConnection = blocked; tls.connect = blocked;
const own = p => path.basename(p).startsWith('KB02-SUPPLEMENT-DIAG-20261023-') || path.basename(p).startsWith('KB02-SUPPLEMENT-AUDIT-20261023-');
const mainOwned = new Set(['docs/status.md', 'docs/agent-control.md']);
async function files(dir) {
  const out = [];
  try { for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p));
    else if (e.isFile()) out.push(p);
  } } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return out;
}
async function snapshot() {
  const top = await fs.readdir('.', {withFileTypes:true});
  const tracked = top.filter(e=>e.isFile()).map(e=>e.name);
  const other = (await Promise.all(['app','services','server','rules','tests','docs/reports','config','workspace','.githooks'].map(files))).flat();
  const paths = [...new Set([...tracked, ...other, '.env.local'])].filter(p => !mainOwned.has(p) && !own(p)).sort();
  const result = {};
  for (const p of paths) { try { result[p] = sha(await fs.readFile(p)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  return result;
}
const before = await snapshot();
const headPointer = (await fs.readFile('.git/HEAD','utf8')).trim();
const head = headPointer.startsWith('ref: ') ? (await fs.readFile(path.join('.git',headPointer.slice(5)),'utf8')).trim() : headPointer;
const gitBefore = 'Shell observed existing main-agent modifications: docs/status.md and docs/agent-control.md; diagnostic prefix added by this task. Git not spawned inside harness.';
await write('baseline', { at: new Date().toISOString(), head, node: process.version, gitBefore, protected: before, excluded: { ownAndIndependentReviewPrefixes: true, mainOwned: [...mainOwned] } });
const traces = (await fs.readFile(historical + 'provider-trace.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
const trace = n => { const t = traces.find(t => t.sequence === n); assert(t); return t; };
const inputOf = t => JSON.parse(t.request.messages.find(m => m.role === 'user').content.split('\n').at(-1));
const bundle = await loadExtractionRules('rules');
const defect = await read(historical + 'supplement-defect.json');
const supplementBody = inputOf(trace(202)).sourceContexts[0].text;
assert.equal(supplementBody.length, 160);
assert.equal(sha(supplementBody), defect.raw.sha256);
const raw = { id: defect.raw.id, title: 'KB02虚构铺货率复核', sourceType: 'report', sourceName: '离线虚构', tags: [], body: supplementBody };
const desc = chunkText(supplementBody, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 }).map(({ index,start,end }) => ({ index,start,end }));
function emptyCheckpoint(source = raw) {
  const chunks = chunkText(source.body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 }).map(({ index,start,end }) => ({ index,start,end }));
  return { version:1, jobId:randomUUID(), rawId:source.id, rawSha256:sha(source.body), pipelineVersion:'kb02-2', rulesVersion:bundle.rulesVersion, providerIdentity:'offline|historical', chunks, completedChunks:[], attempts:0, stage:'extracting', updatedAt:new Date().toISOString(), integrity:'in-memory-only' };
}
async function replay({ source = raw, initial = emptyCheckpoint(source), responses, exactPlanningInput, exactPlanningSystem }) {
  let cp = structuredClone(initial), calls = 0, writes = 0;
  const requests = [];
  const provider = { name:'offline-historical-response', model:'frozen-trace', secrets:[], complete:async request => {
    requests.push(request); const response = responses[calls++]; assert(response, 'Unexpected injected Provider call');
    if (request.user.startsWith('请对下列全部已验证事实规划知识页')) {
      if (exactPlanningInput) assert.deepEqual(inputOf({request:{messages:[{role:'user',content:request.user}]}}), exactPlanningInput);
      if (exactPlanningSystem) assert.equal(request.system, exactPlanningSystem);
    }
    return { text:typeof response === 'string' ? response : JSON.stringify(response), bytes:Buffer.byteLength(typeof response === 'string' ? response : JSON.stringify(response)), finishReason:'stop' };
  } };
  let result, error;
  try { result = await runKnowledgePipeline({raw:source,body:source.body,bodySha256:sha(source.body),rulesDir:'rules',provider,checkpoint:cp,beforeCall:async stage => cp = {...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async value => { writes++; return cp = value; }}); }
  catch (e) { error = { code:e.code, message:e.message }; }
  return {result,error,cp,calls,writes,requests};
}
const actualInput = inputOf(trace(202)), actualPlan = JSON.parse(trace(202).response.content);
const actualSystem = trace(202).request.messages.find(m => m.role === 'system').content;
assert(actualSystem.includes(KNOWLEDGE_PLANNING_INSTRUCTION));
for (const phrase of ['原文确有独立定义、触发条件或流程的AI机制','未知、否定、未上线、未来建议','不指令程序在响应后自动搬移','每页分别根据其实际内容判断两个字段']) assert(actualSystem.includes(phrase));
const original = await replay({responses:[trace(201).response.content,trace(202).response.content],exactPlanningInput:actualInput,exactPlanningSystem:actualSystem});
assert(!original.error, JSON.stringify(original.error)); assert.equal(original.calls,2);
const catalogs = new Map(chunkText(supplementBody,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(c => [c.index,buildEvidenceLocatorCatalog(supplementBody,c)]));
assert.deepEqual(buildKnowledgePlanningInput(supplementBody,original.cp.completedChunks,catalogs),actualInput);
assert.deepEqual(validateSchema(actualPlan,bundle.kb02PlanningSchema),[]);
const coverage = plan => coverageDiagnostic(actualInput.factUnits.map(u=>u.id),actualInput.questionUnits.map(u=>u.id),plan.pages.map(p=>({title:p.title,factIds:p.factUnitIds,questionIds:p.questionUnitIds})));
assert(!hasCoverageErrors(coverage(actualPlan)));
assert.deepEqual(expandKnowledgePlan(actualPlan,actualInput),original.cp.plan.pages);
assert.deepEqual(projectKnowledgePlan(original.cp.plan,actualInput),actualPlan);
const aiPage = original.result.outcome.pages.find(p=>p.title===defect.page.title);
assert(aiPage); assert.equal(aiPage.one_line_definition,aiPage.title);
assert.deepEqual(aiPage.source_facts.map(f=>f.text),['AI异常提示为未来建议，无上线或收益事实。']);
const storedDraft = (await read(historical+'real-http.json')).artifacts.updateDraft;
const storedAi = storedDraft.pages.find(p=>p.title===defect.page.title); assert(storedAi);
assert.equal(storedAi.type,aiPage.type); assert.equal(storedAi.category,aiPage.category);
assert.deepEqual(storedAi.source_facts,aiPage.source_facts);
const contexts = actualInput.sourceContexts.map(s => { assert.equal(s.text,supplementBody.slice(s.contextStart,s.contextEnd)); return {sourceId:s.id,range:[s.start,s.end],contextRange:[s.contextStart,s.contextEnd],fullRaw:s.text===supplementBody}; });

// A fixture supplied correct answer, proving representability only; never product repair.
const good = structuredClone(actualPlan);
good.pages[1].factUnitIds.push('fu-139-160-fact'); good.pages.pop();
let cached = structuredClone(original.cp); delete cached.plan; cached.stage='planning'; cached.attempts=1;
const goodReplay = await replay({initial:cached,responses:[good],exactPlanningInput:actualInput,exactPlanningSystem:actualSystem});
assert(!goodReplay.error); assert.equal(goodReplay.result.outcome.pages.length,2);
assert.deepEqual(goodReplay.cp.plan.pages.flatMap(p=>p.factIds).sort(),actualInput.facts.map(f=>f.id).sort());
assert.deepEqual(goodReplay.cp.plan.pages.flatMap(p=>p.questionIds).sort(),actualInput.questions.map(f=>f.id).sort());

const negatives = [];
for (const mode of ['missing','duplicate','unknown','invented-basis-field']) {
  const mutated=structuredClone(actualPlan);
  if(mode==='missing')mutated.pages.pop();
  if(mode==='duplicate')mutated.pages[0].factUnitIds.push('fu-139-160-fact');
  if(mode==='unknown')mutated.pages[2].factUnitIds=['fu-not-in-input'];
  if(mode==='invented-basis-field')mutated.pages[2].topicSupportUnitIds=['fu-139-160-fact'];
  const replayed=await replay({initial:cached,responses:[mutated]});
  assert(replayed.error); assert(!replayed.cp.plan); assert(!replayed.result);
  negatives.push({mode,error:replayed.error.code,fakeCalls:replayed.calls,noPlan:true,noOutcome:true});
}
const incompatible=structuredClone(cached); incompatible.rulesVersion='historical-or-next-revision-is-not-current';
const incompatibleBefore=JSON.stringify(incompatible);
const invalid=await replay({initial:incompatible,responses:[]});
assert.equal(invalid.error.code,'LLM_CHECKPOINT_INCOMPATIBLE'); assert.equal(invalid.calls,0); assert.equal(invalid.writes,0); assert.equal(JSON.stringify(invalid.cp),incompatibleBefore);

// Original short input/response, to distinguish legal shape from unmet metric oracle.
const shortInput=inputOf(trace(185)),shortPlan=JSON.parse(trace(185).response.content),shortBody=shortInput.sourceContexts[0].text;
const shortRaw={...raw,id:'75a08495-9a78-40f9-bc8c-cbaf4dc91ed3',title:'KB02虚构短文',body:shortBody};
const shortReplay=await replay({source:shortRaw,responses:[trace(184).response.content,trace(185).response.content],exactPlanningInput:shortInput,exactPlanningSystem:trace(185).request.messages.find(m=>m.role==='system').content});
assert(!shortReplay.error); assert.equal(shortReplay.result.outcome.pages[0].type,'concept'); assert(!shortReplay.result.outcome.pages.some(p=>p.type==='metric'));
assert.deepEqual(validateSchema(shortPlan,bundle.kb02PlanningSchema),[]);

// Current real long plan: unchanged 55 fixed units / 101 original IDs / 14 regions.
const longCp=await read(historical+'long-checkpoint.json');
let longBody='';
for(let n=1;n<=14;n++) { let block=`【长文验收附录${n}，虚构】\n虚构区域${String(n).padStart(2,'0')}2026年9月有100家目标门店，${n+10}家在售，门店数铺货率${n+10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。\n`,line=0;
  while(block.length<7600)block+=`附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;
  longBody+=block.slice(0,7600);
}
assert.equal(sha(longBody),longCp.rawSha256);
const longRaw={...raw,id:longCp.rawId,title:'KB02十四区域中文长文虚构验收',body:longBody};
const longInput=inputOf(trace(200)),longPlan=JSON.parse(trace(200).response.content);
let longInitial=structuredClone(longCp); delete longInitial.plan; delete longInitial.draftId; delete longInitial.lastError; longInitial.stage='planning'; longInitial.attempts=14;
const longReplay=await replay({source:longRaw,initial:longInitial,responses:[trace(200).response.content],exactPlanningInput:longInput,exactPlanningSystem:trace(200).request.messages.find(m=>m.role==='system').content});
assert(!longReplay.error); assert.deepEqual(longReplay.cp.plan.pages,longCp.plan.pages);
assert.equal([...longInput.factUnits,...longInput.questionUnits].length,55);
assert.equal([...longInput.factUnits,...longInput.questionUnits].flatMap(u=>u.memberIds).length,101);
const regionRows=[];
for(let n=1;n<=14;n++) {
  const region='虚构区域'+String(n).padStart(2,'0'),start=(n-1)*7600,end=n*7600;
  const sources=longInput.sourceContexts.filter(s=>s.start>=start&&s.end<=end);
  const units=[...longInput.factUnits.map(u=>({...u,column:'factUnitIds'})),...longInput.questionUnits.map(u=>({...u,column:'questionUnitIds'}))].filter(u=>sources.some(s=>s.id===u.sourceId));
  const boundary=units.filter(u=>u.text==='异常审批负责人未知，AI仅未来分析建议。');
  const owners=boundary.map(u=>longPlan.pages.filter(p=>p[u.column].includes(u.id)).map(p=>p.title));
  assert(boundary.length); assert(owners.every(t=>t.length===1&&t[0].includes(region)));
  regionRows.push({region,units:units.length,boundaryUnits:boundary.length,boundaryOwners:owners});
}

await write('source-evidence',{sequence:202,raw:{id:raw.id,chars:supplementBody.length,sha256:sha(supplementBody),body:supplementBody},actualInput,actualPlan,actualSystem,contexts,aiPage,originalId:'f-c1-4',unitId:'fu-139-160-fact',exactRequestRebuilt:true,originalResponseContainsMechanismTitle:true,storedDraftMatches:true,assemblyAddsMechanismClaimInOneLineDefinitionByCopyingTitle:true});
const after=await snapshot(); assert.deepEqual(after,before); assert.equal(networkAttempts,0);
const report={at:new Date().toISOString(),head,productCommit:'17121be7ec20f73b367750d281a4e1dd2c742a76',node:process.version,elapsedMs:Date.now()-started,
  sourceHashes:Object.fromEntries(await Promise.all(['provider-trace.jsonl','supplement-defect.json','real-http.json','long-checkpoint.json'].map(async n=>[historical+n,sha(await fs.readFile(historical+n))]))),
  supplement:{replayedSequences:[201,202],fakeCalls:original.calls,memoryWrites:original.writes,exactInput:true,exactSystem:true,fullRawContexts:contexts.filter(c=>c.fullRaw).length,totalContexts:contexts.length,unitCount:actualInput.factUnits.length+actualInput.questionUnits.length,originalIds:actualInput.facts.length+actualInput.questions.length,schemaAccepted:true,coverageAccepted:true,expansionAndProjectionExact:true,pages:original.result.outcome.pages.length,aiPageTitle:aiPage.title,aiPageFactCount:aiPage.source_facts.length,semanticDefectRemains:true,modelInternalCause:'not established'},
  correctFixtureOnly:{fakeCalls:goodReplay.calls,pages:goodReplay.result.outcome.pages.length,allUnitsAndIdsRetained:true,noProductRepair:true,modelQualityProof:false},
  negativeControls:negatives,revisionMismatch:{code:invalid.error.code,calls:invalid.calls,writes:invalid.writes,checkpointBytesUnchanged:true},
  short:{sequence:185,schemaAccepted:true,completePipelineAccepted:true,type:shortPlan.pages[0].type,metricTargetPresent:false,semanticTypeIllegalityEstablished:false},
  long:{sequence:200,chars:longBody.length,fakeCalls:longReplay.calls,units:55,originalIds:101,originalPlanUnchanged:true,regions:regionRows},
  integrity:{protectedPaths:Object.keys(before).length,changed:[],mainOwnedExcluded:[...mainOwned],productDefaultTestsHistoricalReportsWorkspaceConfigUnchanged:true},
  scope:{realProviderCalls:0,networkAttempts,networkGuards:['fetch','http.request/get','https.request/get','net.connect/createConnection','tls.connect'],persistentProductWrites:0,servicesStarted:0,browserStarted:false,kb02Cumulative:203,kb02Cap:500,promptCumulative:15,promptCap:24,defectFixed:false,kb02Passed:false}}
await write('replay',report);
console.log(JSON.stringify({...report,sourceHashes:undefined,long:{...report.long,regions:report.long.regions.length}}));
