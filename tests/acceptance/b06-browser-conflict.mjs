// Independent HTTP fixture for observing a retained recovery conflict in the UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {wikiInput} from './b06-harness.mjs';
const run=JSON.parse(await fs.readFile('docs/reports/B06-acceptance-browser-runtime.json','utf8'));
async function call(route,method='GET',body,expected=200){const r=await fetch(run.api+route,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));return j;}
if(process.argv[2]==='seed'){
  const wiki=await call('/api/wiki','POST',wikiInput('B06浏览器冲突恢复复验',[run.rawId],'隔离冲突测试原正文。'),201);
  const original=await call('/api/audits','POST',{wikiId:wiki.id,scope:'page',severity:'warning',comment:'浏览器冲突提示验收：中断后保留人工修改。'},201);
  const proposed=await call(`/api/audits/${original.id}/propose`,'POST',{},201);
  const fault=path.join(run.dataRoot,'.b06-fault.json');
  await fs.writeFile(fault,JSON.stringify({tag:randomUUID(),method:'rename',match:'/knowledge/wiki/index.md',action:'throw'}));
  let failure;
  try{failure=await call(`/api/audits/${original.id}/resolve`,'POST',{baseAuditRevision:proposed.audit.revision,decision:'accepted',confirm:true,draftId:proposed.draft.id,baseDraftRevision:proposed.draft.revision},500);}finally{await fs.rm(fault,{force:true});}
  const current=await call('/api/wiki/'+wiki.id);
  await call('/api/wiki/'+wiki.id,'PUT',{...wikiInput(current.title,current.sources,'',current),body:'中断后人工保存的冲突样本，必须保留。',baseRevision:current.revision});
  await fs.writeFile('docs/reports/B06-acceptance-browser-conflict.json',JSON.stringify({wikiId:wiki.id,auditId:original.id,failure},null,2));
  await fs.writeFile(path.join(run.dataRoot,'.restart-api'),'');
  console.log(JSON.stringify({wikiId:wiki.id,auditId:original.id,failure}));
}else if(process.argv[2]==='fix-fixture'){
  const report=JSON.parse(await fs.readFile('docs/reports/B06-acceptance-browser-conflict.json','utf8'));
  const current=await call('/api/wiki/'+report.wikiId);
  await call('/api/wiki/'+report.wikiId,'PUT',{...wikiInput(current.title,current.sources,'',current),body:'中断后人工保存的冲突样本，必须保留。',baseRevision:current.revision});
  await fs.writeFile(path.join(run.dataRoot,'.restart-api'),'');
}else{
  const report=JSON.parse(await fs.readFile('docs/reports/B06-acceptance-browser-conflict.json','utf8'));
  const detail=await call('/api/audits/'+report.auditId),wiki=await call('/api/wiki/'+report.wikiId);
  assert.equal(detail.audit.status,'open');assert.equal(detail.conflicts.length,1);
  assert.equal(wiki.body,'中断后人工保存的冲突样本，必须保留。');
  Object.assign(report,{detail,wiki});await fs.writeFile('docs/reports/B06-acceptance-browser-conflict.json',JSON.stringify(report,null,2));console.log(JSON.stringify(detail.conflicts));
}
