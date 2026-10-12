import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHarness,request,fileSnapshot} from './b08-harness.mjs';
import {task,brief} from './b08-fixtures.mjs';
let release;const pending=new Promise(r=>{release=r});const h=await createHarness(()=>pending);const result={provider:'independent nonresponding fake',dataRoot:h.dataRoot};
try{
 const s=await h.start();const before={prompts:await fileSnapshot(path.join(h.dataRoot,'prompts')),drafts:await fileSnapshot(path.join(h.dataRoot,'drafts')),knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge'))};
 const start=Date.now();const r=await request(s,'/api/prompt-ai/brief','POST',{task,template:'custom'});result.elapsedMs=Date.now()-start;result.response=r.json;result.httpStatus=r.status;assert.equal(r.status,504);assert.equal(r.json.error.code,'LLM_TIMEOUT');assert.ok(result.elapsedMs>=59000&&result.elapsedMs<80000);
 const after={prompts:await fileSnapshot(path.join(h.dataRoot,'prompts')),drafts:await fileSnapshot(path.join(h.dataRoot,'drafts')),knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge'))};assert.deepEqual(after,before);result.assetsUnchanged=true;result.result='PASS';
}catch(e){result.result='FAIL';result.error=String(e);}finally{release(brief);await h.close();result.closed=true;await fs.writeFile('docs/reports/B08-final-timeout.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.result!=='PASS')process.exitCode=1;}
