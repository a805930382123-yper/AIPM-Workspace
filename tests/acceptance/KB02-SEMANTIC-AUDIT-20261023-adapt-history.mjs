// Copy only two historical pipeline positive harnesses; leave all old assets untouched.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const base='tests/acceptance/',name='KB02-SEMANTIC-AUDIT-20261023',rows=[];
const helper=`\n// Controlled pass is protocol accommodation, never independent semantic truth.\nfunction independentAuditReply(r){const {plan}=JSON.parse(r.user.split('\\n').at(-1));const text=JSON.stringify({version:1,pages:plan.pages.map((p,pageIndex)=>({pageIndex,decision:'pass',code:'OK',unitIds:[p.factUnitIds[0]],reason:'Historical mechanical regression only; fake pass is not quality evidence.'}))});return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};}\n`;
for(const kind of ['FIELDS','REGION']){
 const old=base+`KB02-${kind}-AUDIT-${kind==='FIELDS'?'20261022':'20261023'}-boundary.test.mjs`,source=await fs.readFile(old,'utf8');let next=source;
 const needle='calls++;request=r;return';assert(next.includes(needle));next=next.replace(needle,"calls++;if(r.user.startsWith('请审核下列完整候选知识规划'))return independentAuditReply(r);request=r;return");
 if(kind==='FIELDS'){const needle='assert.equal(f.calls,1);});';// Only lawful pair tests reach review; original invalid/secret guards remain unchanged.
  const start=next.indexOf('for(const type of'),end=next.indexOf("test('FIELDS independent secret",start);assert(start>=0&&end>start);let block=next.slice(start,end);assert(block.includes(needle));block=block.replace(needle,'assert.equal(f.calls,2);});');next=next.slice(0,start)+block+next.slice(end);
 }else{const needle='const result=await f.run();assert.equal(f.calls,1);';assert(next.includes(needle));next=next.replace(needle,'const result=await f.run();assert.equal(f.calls,2);');}
 next+=helper;const destination=base+name+'-historical-'+kind.toLowerCase()+'.test.mjs';await fs.writeFile(destination,next,{flag:'wx'});
 rows.push({source:old,sha256:createHash('sha256').update(source).digest('hex'),destination,changes:'Only successful complete-pipeline cases add one fake review response/count; planning request remains recorded. Early invalid schema, secret and incompatible revision still require original zero/one calls. All original assertions otherwise retained.'});
}
await fs.writeFile('docs/reports/'+name+'-history-adaptation.json',JSON.stringify({at:new Date().toISOString(),rows,testsRun:0},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(rows));
