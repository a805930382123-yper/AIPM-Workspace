import fs from 'node:fs/promises';
import path from 'node:path';
import {createHarness,request,expect,rawInput,delay} from './FULL2-20261010-spec-secret-harness.mjs';
import {fakeReply} from './b05-fake-reply.mjs';
const checks=[],harnesses=[];
async function probe(id,credential,fn){
 const h=await createHarness(()=>({}),undefined,credential);harnesses.push(h);let s;
 try{s=await h.start();checks.push({id,...await fn(h,s)});}
 catch(e){checks.push({id,result:'BLOCKED',reason:String(e).replaceAll(h.fakeKey,'[REDACTED]')});}
 finally{await h.close();checks.at(-1).servicesClosed=h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null);}
}
await probe('S03-synthesis-known-credential',undefined,async(h,s)=>{
 const a=await expect(s,'/api/raw','POST',rawInput('秘密探针A','原始材料A，无凭证。'),201);
 const b=await expect(s,'/api/raw','POST',rawInput('秘密探针B','原始材料B，无凭证。'),201);
 h.setReply(()=>({title:'隔离综合',category:'industry_basics',agreement:[],conflicts:[],suggestedAdditions:[],inferences:['供应商回显 '+h.fakeKey],openQuestions:[]}));
 const r=await request(s,'/api/knowledge/syntheses','POST',{rawIds:[a.id,b.id]});
 const persisted=r.json?.id?await fs.readFile(path.join(h.dataRoot,'drafts/knowledge-workflows',r.json.id+'.json'),'utf8'):'';
 const leaked=r.text.includes(h.fakeKey)||persisted.includes(h.fakeKey);
 return {result:leaked?'FAIL':'PASS',status:r.status,secretInHttpResponse:r.text.includes(h.fakeKey),secretInPersistedDraft:persisted.includes(h.fakeKey),providerCalled:h.requests.length>0,authenticationMatched:h.requests.every(x=>x.authCorrect),dataRoot:h.dataRoot};
});
await probe('S04-brief-short-known-credential','a9Zq!',async(h,s)=>{
 h.setReply(()=>({taskName:'任务 '+h.fakeKey,taskType:'business analysis',role:'analyst',goal:'整理任务',context:'fixture',input:'fixture',tasks:'review',constraints:'do not invent facts',output:'structured JSON'}));
 const r=await request(s,'/api/prompt-ai/brief','POST',{task:'普通业务整理任务',template:'business_process'});
 const persisted=r.json?.draftId?await fs.readFile(path.join(h.dataRoot,'drafts/prompts',r.json.draftId+'.json'),'utf8'):'';
 const leaked=r.text.includes(h.fakeKey)||persisted.includes(h.fakeKey);
 return {result:leaked?'FAIL':'PASS',status:r.status,credentialLength:h.fakeKey.length,secretInHttpResponse:r.text.includes(h.fakeKey),secretInPersistedDraft:persisted.includes(h.fakeKey),providerCalled:h.requests.length>0,authenticationMatched:h.requests.every(x=>x.authCorrect),dataRoot:h.dataRoot};
});
await probe('S04-extraction-short-known-credential','a9Zq!',async(h,s)=>{
 const raw=await expect(s,'/api/raw','POST',rawInput('短凭证提取探针','原文不含凭证，仅讨论业务口径。'),201);
 h.setReply(input=>{const o=fakeReply(input);o.document.summary+=' 供应商回显 '+h.fakeKey;return o;});
 const started=await expect(s,`/api/raw/${raw.id}/extract`,'POST',{},202);let job;
 for(let i=0;i<200;i++){job=await expect(s,`/api/extraction-jobs/${started.jobId}`);if(job.status!=='running')break;await delay(60);}
 const r=job.draftId?await request(s,`/api/drafts/${job.draftId}`):{text:''};
 const files=await fs.readdir(path.join(h.dataRoot,'drafts'));let stored='';
 for(const f of files)if(f.endsWith('.json'))stored+=await fs.readFile(path.join(h.dataRoot,'drafts',f),'utf8');
 // DraftStore uses a dedicated subdirectory; public detail plus its bytes are inspected recursively.
 async function scan(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await scan(p);else stored+=await fs.readFile(p,'utf8');}}
 await scan(path.join(h.dataRoot,'drafts'));
 const leaked=r.text.includes(h.fakeKey)||stored.includes(h.fakeKey);
 return {result:leaked?'FAIL':'PASS',jobStatus:job.status,credentialLength:h.fakeKey.length,secretInHttpResponse:r.text.includes(h.fakeKey),secretInPersistedDraft:stored.includes(h.fakeKey),providerCalled:h.requests.length>0,authenticationMatched:h.requests.every(x=>x.authCorrect),rawUnchanged:(await expect(s,`/api/raw/${raw.id}`)).body===raw.body,dataRoot:h.dataRoot};
});
await fs.writeFile('docs/reports/FULL2-20261010-spec-secret-http.json',JSON.stringify({scope:'real product HTTP + OpenAI-compatible adapter + local fake; no real credential/provider',checks},null,2));
console.log(JSON.stringify(checks.map(({id,result,status,jobStatus})=>({id,result,status,jobStatus}))));
