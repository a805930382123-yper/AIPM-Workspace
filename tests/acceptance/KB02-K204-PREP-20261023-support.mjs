// Offline fixtures only. No configuration loader or real Provider constructor is used.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {chunkText} from '../../services/llm/chunk.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';

export const P='docs/reports/KB02-K204-PREP-20261023-';
export const SPEC='docs/reports/KB02-K204-PREP-AUDIT-20261023-spec.json';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const save=(name,value)=>fs.writeFile(P+name+'.json',JSON.stringify(value,null,2)+'\n');
export function offlineArgs(args=process.argv.slice(2)) { assert.equal(args.length,0,'OFFLINE_ONLY: no command line modes or authorization flags'); }
export async function frozen() {
  const bytes=await fs.readFile(SPEC);assert.equal(sha(bytes),'d722f40b885c2ebd02142ba530153fae672b57b38c9bc0167c62a44a59ee49f9');
  const card=await fs.readFile('docs/handoffs/KB02-K204-PREP-20261023-task.md');assert.equal(sha(card),'bb1ff979a164a01c93d5439326b1137dc75ce51b23472c28cd7eb242e08abca2');
  const spec=JSON.parse(bytes),source=await fs.readFile(spec.sourceFile.path);assert.equal(sha(source),spec.sourceFile.sha256);
  for(const f of spec.files)assert.equal(sha(await fs.readFile(f.path)),f.sha256,f.path);
  const bundle=await loadExtractionRules('rules');assert.equal(bundle.rulesVersion,spec.rulesVersion);assert.deepEqual(bundle.rules.budgets,spec.budgets);
  const fixtures=JSON.parse(source).fixtures;
  for(const s of spec.samples){const f=fixtures.find(x=>x.id===s.id);assert(f);assert.equal(sha(f.body),s.bodySha256);assert.equal(f.body.length,s.chars);assert.equal(Buffer.byteLength(f.body),s.utf8Bytes);assert.deepEqual(chunkText(f.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),s.chunks);assert.equal(s.normalExtractionCalls,s.chunks.length+1);}
  assert.equal(spec.stages.reduce((n,s)=>n+s.calls,0),22);assert(spec.stages.every(s=>s.approved===false));assert.equal(spec.budget.authorizedNow,0);
  return {spec,fixtures,bundle};
}
export function guardNetwork() {
  const original={fetch:globalThis.fetch,httpRequest:http.request,httpGet:http.get,httpsRequest:https.request,httpsGet:https.get};
  // Counts describe this wrapper, not a packet monitor. Destination hit counts in the
  // repair regression independently prove redirects/options did not reach another server.
  const allowed=new Set(),state={blocked:0,localRequests:0,redirectsBlocked:0,deniedSignatures:0};
  const deny=()=>{state.blocked++;throw Error('OFFLINE_NETWORK_DENIED');};
  const signatureDenied=()=>{state.deniedSignatures++;return deny();};
  const href=input=>typeof input==='string'?input:input instanceof URL?Object.getOwnPropertyDescriptor(URL.prototype,'href').get.call(input):signatureDenied();
  const check=input=>{let url;try{url=new URL(href(input));}catch(error){if(error.message==='OFFLINE_NETWORK_DENIED')throw error;return deny();}if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!allowed.has(url.origin))return deny();return url.href;};
  globalThis.fetch=async(input,init)=>{
    // Request objects and custom dispatcher/transport/redirect options are not supported.
    // Copy only data properties so input/init cannot change the validated destination.
    const url=check(input),safe={};
    if(init!==undefined){if(!init||![Object.prototype,null].includes(Object.getPrototypeOf(init)))return signatureDenied();for(const key of Reflect.ownKeys(init)){if(!['method','headers','body','signal'].includes(key))return signatureDenied();const descriptor=Object.getOwnPropertyDescriptor(init,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))return signatureDenied();safe[key]=descriptor.value;}}
    state.localRequests++;const response=await original.fetch(url,{...safe,redirect:'manual'});
    if(response.status>=300&&response.status<400){state.redirectsBlocked++;await response.body?.cancel();return deny();}return response;
  };
  // Only URL[, callback] is supported; reject URL+options, options-only, custom agent,
  // lookup and createConnection before dispatch. A private Agent avoids globalAgent overrides.
  const agent=new http.Agent({keepAlive:false});
  const httpCall=method=>(...args)=>{if(args.length<1||args.length>2||(args.length===2&&typeof args[1]!=='function'))return signatureDenied();const url=check(args[0]);state.localRequests++;return original[method](url,{agent},args[1]);};
  http.request=httpCall('httpRequest');http.get=httpCall('httpGet');
  https.request=https.get=deny;syncBuiltinESMExports();
  return {state,allow:base=>{const url=new URL(href(base));assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert(!url.username&&!url.password);allowed.add(url.origin);},restore:()=>{agent.destroy();globalThis.fetch=original.fetch;http.request=original.httpRequest;http.get=original.httpGet;https.request=original.httpsRequest;https.get=original.httpsGet;syncBuiltinESMExports();}};
}
export function businessRanges(body) {
  return [...body.matchAll(/虚构区域\d{2}2026年9月/g)].map(m=>({subject:m[0].slice(0,6),start:m.index,end:body.indexOf('\n',m.index)}));
}
export function assertFakeDispatch(request,sample,seen,normalCalls) {
  assert(!request.user.startsWith('请审核'),'B1/extra request forbidden');
  assert(seen<normalCalls,'EXTRA_FAKE_CALL_FORBIDDEN');
  const planning=request.user.startsWith('请对下列全部已验证事实规划知识页');
  assert.equal(planning,seen===normalCalls-1,'Unexpected extraction/planning order');
}
export function fakeReply(request, sample, trace) {
  assert.equal(request.purpose,'knowledge');assert(!request.user.startsWith('请审核'),'B1/extra request forbidden');
  const planning=request.user.startsWith('请对下列全部已验证事实规划知识页');
  const data=JSON.parse(request.user.slice(request.user.lastIndexOf('\n')+1));let result;
  if(planning){
    const units=[...data.factUnits,...data.questionUnits],ranges=businessRanges(sample.body);
    const groups=new Map();
    for(const u of units){const context=data.sourceContexts.find(x=>x.id===u.sourceId);let key='main';
      if(sample.id==='long-original'){const r=ranges.find(r=>context.start<r.end&&context.end>r.start);assert(r,'Nonbusiness atom entered long planning');key=r.subject;}
      else if(sample.id==='supplement-original'&&context.start>=sample.body.indexOf('补充规则'))key='human-organization';
      if(!groups.has(key))groups.set(key,{facts:[],questions:[]});groups.get(key)[u.id.startsWith('fu-')?'facts':'questions'].push(u.id);
    }
    result={version:3,document:{title:'离线虚构资料候选 '+sample.id,main_topic:'资料整理'},pages:[...groups].map(([key,g])=>({title:key==='human-organization'?'补充资料人工整理（组织选择）':sample.id==='long-original'?key+'门店经营记录':sample.id==='mixed-short-original'?'甲桥门店经营记录':'甲桥门店数铺货率',type:key==='human-organization'||sample.id==='mixed-short-original'?'concept':'metric',category:key==='human-organization'?'other':'metric',factUnitIds:g.facts,questionUnitIds:g.questions}))};
  }else{
    assert(Array.isArray(data));const ranges=businessRanges(sample.body),facts=[],questions=[],notes=[];
    for(const a of data){let chosen=true;if(sample.id==='long-original') {const match=/^c(\d+)-a/.exec(a.id);assert(match);const chunkStart=(Number(match[1])-1)*7600;const candidates=[];let p=sample.body.indexOf(a.text,chunkStart);while(p>=0&&p<chunkStart+8000){candidates.push(p);p=sample.body.indexOf(a.text,p+1);}chosen=candidates.some(p=>ranges.some(r=>p<r.end&&p+a.text.length>r.start));}
      else chosen=!a.text.includes('【虚构');
      if(!chosen){if(notes.length<1)notes.push({atomId:a.id});continue;}
      if(/未知|未注明|待访谈|需访谈/.test(a.text))questions.push({atomId:a.id});else facts.push({atomId:a.id,kind:a.fragment?'ambiguous':'fact'});
    }
    result={version:2,facts,questions,sourceNotes:notes};
  }
  trace.push({stage:planning?'planning':'extracting',sample:sample.id,requestHash:sha(JSON.stringify({system:request.system,user:request.user})),timeoutMs:request.timeoutMs,maxOutputBytes:request.maxOutputBytes,response:result});
  const text=JSON.stringify(result);return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};
}
