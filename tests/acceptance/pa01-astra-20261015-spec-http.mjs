import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHarness,request,expect} from './kb02-20261015-standards-harness.mjs';
import {OPTIMIZATION_CONTRACT,contentContract} from '../../services/prompt-ai/contract.ts';
let response=OPTIMIZATION_CONTRACT.example;
const h=await createHarness(()=>response,'astra-spec-fictional-key');
const rows=[];
try{
 const s=await h.start();
 const c=await expect(s,'/api/prompt-ai/optimize/check','POST',{body:'虚构原文'},201);
 response=contentContract(['customer']).example;
 const r=await expect(s,`/api/prompt-ai/drafts/${c.draftId}/rewrite`,'POST',{requestId:randomUUID()});
 const id=randomUUID();
 await fs.writeFile(path.join(h.dataRoot,'drafts','prompts',id+'.json'),JSON.stringify({id,kind:'optimizer',createdAt:new Date().toISOString(),status:'pending',originalBody:c.originalBody,checks:c.checks,improvements:c.improvements,preview:r.preview}));
 const before=await request(s,`/api/prompt-ai/drafts/${id}`);
 const saved=await request(s,`/api/prompt-ai/drafts/${id}/confirm`,'POST',{requestId:id,mode:'new',input:r.preview});
 const after=await request(s,`/api/prompt-ai/drafts/${id}`);
 const replay=await request(s,`/api/prompt-ai/drafts/${id}/confirm`,'POST',{requestId:id,mode:'new',input:r.preview});
 rows.push({id:'SH01-legacy-confirm',result:before.status===200&&saved.status===201&&after.status===200&&replay.status===200?'PASS':'FAIL',before:before.status,saved:saved.status,after:{status:after.status,error:after.json?.error},replay:{status:replay.status,error:replay.json?.error}});
 response=OPTIMIZATION_CONTRACT.example;
 const c2=await expect(s,'/api/prompt-ai/optimize/check','POST',{body:'第二条虚构原文'},201);
 response=contentContract(['customer']).example;
 const n=h.requests.length;
 const invalid=await request(s,`/api/prompt-ai/drafts/${c2.draftId}/rewrite`,'POST',{requestId:'-'.repeat(36)});
 const invalidRead=await request(s,`/api/prompt-ai/drafts/${c2.draftId}`);
 rows.push({id:'SH02-invalid-request-id',result:invalid.status===400&&h.requests.length===n&&invalidRead.status===200?'PASS':'FAIL',rewriteStatus:invalid.status,extraLocalCalls:h.requests.length-n,read:{status:invalidRead.status,error:invalidRead.json?.error}});
 const conflict=await request(s,'/api/prompt-ai/optimize/check','POST',{body:'虚构冲突原文',targetPromptId:saved.json.prompt.id,baseVersion:2});
 rows.push({id:'SH03-version-conflict-diagnostic',result:conflict.status===409&&conflict.json.error.details?.category==='conflict'&&conflict.json.error.details?.stage==='check'?'PASS':'FAIL',status:conflict.status,error:conflict.json?.error});
}finally{
 await h.close();
 const report={at:new Date().toISOString(),root:h.dataRoot,externalCalls:0,fakeCalls:h.requests.length,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null),rows};
 await fs.writeFile('docs/reports/PA01-ASTRA-20261015-spec-http.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
