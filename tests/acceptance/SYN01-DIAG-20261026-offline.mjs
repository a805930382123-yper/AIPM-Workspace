// Diagnosis only. Original response remains unchanged; synthetic variants isolate validators.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {installOfflineGuard} from './SYN01-PREP-20261025-core.mjs';

const guard=installOfflineGuard();
const {KnowledgeWorkflowStore}=await import('../../services/wiki/knowledge-workflows.ts');
const {WikiStore}=await import('../../services/wiki/store.ts');
const {OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');
const {buildEvidenceLocatorCatalog}=await import('../../services/llm/locators.ts');
const sha=value=>createHash('sha256').update(value).digest('hex');
const source='docs/reports/SYN01-REAL-20261025-export-1792936917825.json';
const sourceBytes=await fs.readFile(source);
const exp=JSON.parse(sourceBytes),original=JSON.parse(exp.artifacts.response.text);
const recordedRequest=exp.artifacts['request-242.json'].request;
const rawMap=new Map(exp.raws.map(raw=>[raw.id,raw]));
const rawStore={get:async id=>rawMap.get(id)};
const schema=await new WikiStore('docs/reports/SYN01-DIAG-20261026-not-created',rawStore).schema();
const ordered=JSON.parse(recordedRequest.user);
assert.deepEqual(ordered.map(r=>[r.id,r.body]),ordered.map(r=>[r.id,rawMap.get(r.id).body]));
assert(exp.raws.every(r=>sha(r.body)===r.bodySha256));

async function replay(name,text,expectedCode,expectedSchemaReads){
  let saves=0,schemaReads=0,calls=0;
  const service=new KnowledgeWorkflowStore('docs/reports/SYN01-DIAG-20261026-not-created',{
    schema:async()=>{schemaReads++;return schema;},
  },rawStore);
  service.save=async()=>{saves++;throw new Error('UNEXPECTED_PERSISTENCE');};
  const provider={name:'offline-response-replay',model:'synthetic-provider',secrets:[],complete:async request=>{
    calls++;assert.deepEqual(request,recordedRequest);return {...exp.artifacts.response,text};
  }};
  let caught;
  try{await service.createSynthesis({rawIds:ordered.map(r=>r.id),provider});}catch(error){caught=error;}
  assert.equal(caught?.code,expectedCode);assert.equal(schemaReads,expectedSchemaReads);assert.equal(saves,0);assert.equal(calls,1);
  return {name,code:caught.code,message:caught.message,schemaReads,saves,inMemoryProviderReplays:calls};
}

const replays=[];
replays.push(await replay('REAL_SEQ242_ORIGINAL_UNCHANGED',exp.artifacts.response.text,'LLM_SCHEMA_INVALID',0));
const withArray={...structuredClone(original),suggestedAdditions:[]};
replays.push(await replay('SYNTHETIC_ONLY_missing_array_supplied_to_expose_category',JSON.stringify(withArray),'LLM_SCHEMA_INVALID',1));
const validCategory={...withArray,category:'metric'};
replays.push(await replay('SYNTHETIC_ONLY_array_and_category_supplied_to_expose_evidence',JSON.stringify(validCategory),'EVIDENCE_INVALID',1));
const evidence=['agreement','conflicts'].flatMap(section=>original[section].map((item,index)=>{
  const body=rawMap.get(item.rawId).body,occurrences=[];
  for(let pos=body.indexOf(item.quote);pos>=0;pos=body.indexOf(item.quote,pos+1))occurrences.push([pos,pos+item.quote.length]);
  assert.equal(body.slice(item.start,item.end)===item.quote,false);
  assert.equal(occurrences.length,1);assert.equal(occurrences[0][0],item.start);assert.equal(occurrences[0][1]-item.end,1);
  return {section,index,rawId:item.rawId,start:item.start,end:item.end,quoteLength:item.quote.length,allExactOccurrences:occurrences,sliceMatches:false};
}));
assert.equal(evidence.length,8);

const catalogs=exp.raws.map(raw=>({rawId:raw.id,bodySha256:raw.bodySha256,locators:buildEvidenceLocatorCatalog(raw.body,{index:0,start:0,end:raw.body.length,text:raw.body})}));
for(const catalog of catalogs){assert.equal(catalog.locators.map(l=>l.text).join(''),rawMap.get(catalog.rawId).body);assert.equal(catalog.locators.length,1);}
assert.equal(catalogs[0].locators[0].id,catalogs[1].locators[0].id); // Bare chunk-local IDs collide across Raws.
const repeated='同句。\n同句。\n😀尾句。';
const repeatedCatalog=buildEvidenceLocatorCatalog(repeated,{index:0,start:0,end:repeated.length,text:repeated},{maxLocatorChars:5});
assert.equal(repeatedCatalog.map(l=>l.text).join(''),repeated);
assert.equal(new Set(repeatedCatalog.map(l=>l.id)).size,repeatedCatalog.length);
for(const l of repeatedCatalog){assert.equal(repeated.slice(l.start,l.end),l.text);assert(!/[\uD800-\uDBFF]$/u.test(l.text));assert(!/^[\uDC00-\uDFFF]/u.test(l.text));}

// Reconstruct current adapter serialization using synthetic configuration and in-memory fetch.
// This is not a capture of seq242's actual HTTP request and never opens a socket.
let wire,wireCalls=0;
const guardedFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  wireCalls++;wire={url:String(url),body:JSON.parse(init.body),authorizationPresent:typeof init.headers.authorization==='string'};
  return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}),{status:200});
};
try{
  const adapter=new OpenAiCompatibleProvider({baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'GLM-5.3-Flash',apiKey:'SYNTHETIC-DIAG-CREDENTIAL-ONLY'});
  await adapter.complete(recordedRequest);
}finally{globalThis.fetch=guardedFetch;}
assert.equal(wireCalls,1);assert.equal(wire.body.messages[0].content,recordedRequest.system);assert.equal(wire.body.messages[1].content,recordedRequest.user);
assert.deepEqual(wire.body.response_format,{type:'json_object'});assert.equal(wire.body.reasoning_effort,'low');assert.equal(wire.body.stream,false);assert.equal(wire.body.temperature,0);
assert(!('json_schema' in wire.body.response_format));
assert.equal(sha(await fs.readFile(source)),sha(sourceBytes));
const files=['services/wiki/knowledge-workflows.ts','services/llm/provider.ts','services/llm/locators.ts','rules/fmcg-schema.yaml',source];
const fileHashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await fs.readFile(file))])));
const result={kind:'OFFLINE_DIAGNOSIS_NOT_REAL_ACCEPTANCE',node:process.version,sourceSha256:sha(sourceBytes),fileHashes,
  replays,evidence,originalCategory:original.category,validCategoryIds:schema.categories.map(c=>c.id),originalCategoryValid:schema.categories.some(c=>c.id===original.category),
  adapterReconstruction:{synthetic:true,actualWireCaptured:false,inMemoryFetchCalls:wireCalls,messagesMatchRecordedRequest:true,bodyKeys:Object.keys(wire.body),responseFormat:wire.body.response_format,reasoningEffort:wire.body.reasoning_effort},
  catalogs:catalogs.map(c=>({rawId:c.rawId,bodySha256:c.bodySha256,locatorCount:c.locators.length,firstId:c.locators[0].id,firstStart:c.locators[0].start,lastEnd:c.locators.at(-1).end})),
  syntheticRepeatedEmojiCatalog:repeatedCatalog,guardObserved:guard.observed,realCalls:0,actualConfigReads:0,servicesStarted:0};
guard.restore();
console.log(JSON.stringify(result,null,2));
