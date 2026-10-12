import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {AuditService} from '../../services/audit/service.ts';
import {fileSnapshot} from './b07-harness.mjs';
const prefix='docs/reports/FULL2-20261010-spec-secrets', started=Date.now(), checks=[];
const root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-audit-secret-repair-'));
const secrets=['isolated-first-credential','isolated-second-credential','q2!'];
try{
 const raws=new RawStore(root);await raws.initialize();
 const raw=await raws.create({title:'验收资料',sourceType:'report',sourceName:'隔离',tags:[],body:'原始证据。'});
 const wiki=new WikiStore(root,raws);await wiki.initialize();
 const page=await wiki.create({title:'隔离页面',type:'concept',category:'industry_basics',sources:[raw.id],tags:[],aliases:[],knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed',body:'人工正文。'});
 const audits=new AuditService(root,wiki,raws);await audits.initialize();const audit=await audits.create({wikiId:page.id,scope:'page',severity:'warning',comment:'验收'});
 for(let i=0;i<secrets.length;i++)for(const field of ['replacement','rationale']){
  const id=`S01-multi-secret-${i+1}-${field}`;
  try{
   const result={replacement:'安全建议',rationale:'安全理由',evidence:[],[field]:secrets[i]};
   const provider={name:'fixture',model:'fixture',secrets:[...secrets,''],async complete(){const text=JSON.stringify(result);return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};}};
   const before=await fileSnapshot(root);let caught;
   try{await audits.propose(audit.id,provider);}catch(e){caught=e;}
   assert.ok(caught,'Known credential output must fail');assert.equal(caught.code,'LLM_OUTPUT_CONTAINS_SECRET');assert.equal(caught.status,502);
   const exposed=JSON.stringify({code:caught.code,message:caught.message,details:caught.details});assert.ok(!secrets.some(k=>exposed.includes(k)),'Errors must not disclose any credential');
   assert.deepEqual(await fileSnapshot(root),before,'No mutations on rejected output');checks.push({id,result:'PASS',status:caught.status,noWrites:true,noCredentialInError:true});
  }catch(e){let message=String(e);for(const key of secrets)message=message.replaceAll(key,'[REDACTED]');checks.push({id,result:'FAIL',message});}
 }
}finally{
 if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('fmcg-audit-secret-repair-'))throw Error('Unsafe temporary cleanup path'); await fs.rm(root,{recursive:true,force:true});const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
 await fs.writeFile(prefix+'.json',JSON.stringify({durationMs:Date.now()-started,provider:'service fixture; HTTP separately verified',checks,summary,temporaryRootRemoved:true},null,2));console.log(JSON.stringify(summary));if(summary.fail)process.exitCode=1;
}
