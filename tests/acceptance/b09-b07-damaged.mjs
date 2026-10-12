import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createHarness,expect,request,fileSnapshot} from './b07-harness.mjs';
const h=await createHarness(()=>{throw Error('no LLM');});let s=await h.start(h.dataRoot,false);
const report={dataRoot:h.dataRoot,checks:[]};
try{
 const input={requestId:randomUUID(),name:'有效记录',body:'正文 {{客户}}',category:'customer',scenario:'',inputRequirements:'',outputRequirements:'',relatedWikiIds:[],examples:'',tags:[],favorite:false};
 const p=(await expect(s,'/api/prompts','POST',input,201)).prompt;
 const original=JSON.parse(await fs.readFile(path.join(h.dataRoot,'prompts',p.id+'.json'),'utf8'));
 const badIds=[];
 for(const kind of ['missing-fields','filename-id-mismatch','current-id-mismatch','malformed-json']){
  const id=randomUUID(),bad=structuredClone(original);let content;
  if(kind==='missing-fields')content=JSON.stringify({id,current:{id},versions:[],creation:{}});
  else if(kind==='filename-id-mismatch')content=JSON.stringify(bad);
  else if(kind==='current-id-mismatch'){bad.id=id;content=JSON.stringify(bad);}
  else content='{broken json';
  await fs.writeFile(path.join(h.dataRoot,'prompts',id+'.json'),content);badIds.push(id);
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  for(const suffix of ['','/versions','/export']){const r=await request(s,'/api/prompts/'+id+suffix);assert.equal(r.status,500);assert.equal(r.json.error.code,'CORRUPT_PROMPT');assert.equal(r.json.error.details.id,id);}
  assert.equal((await expect(s,'/api/stats','GET')).promptCount,1);assert.deepEqual((await expect(s,'/api/prompts','GET')).items.map(x=>x.id),[p.id]);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'prompts')),before);
  report.checks.push({kind,result:'PASS',id,preserved:true});
 }
 const apiPort=s.port;await h.stop(s);s=await h.start(h.dataRoot,false,apiPort);assert.equal((await expect(s,'/api/stats','GET')).promptCount,1);
 assert.equal((await expect(s,'/api/prompts/'+p.id,'GET')).prompt.body,input.body);report.restart='PASS';
}finally{await h.close();report.closed=true;await fs.writeFile('docs/reports/B09-regression-acceptance-b07-damaged.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({pass:report.checks.length,restart:report.restart,closed:report.closed}));

