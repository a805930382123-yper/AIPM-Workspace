import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHarness,expect,request,rawInput,wikiInput,fileSnapshot} from './b08-harness.mjs';
let raw;
const h=await createHarness(()=>({replacement:'Audit回显 '+h.fakeKey,rationale:'隔离测试，非真实凭证',evidence:[{rawId:raw.id,quote:raw.body}]}));
const report={scope:'real product HTTP + OpenAiCompatibleProvider adapter + local fake responder; no real credential/provider',expected:'reject output containing known provider credential before persistence'};
try{
const s=await h.start();
raw=await expect(s,'/api/raw','POST',rawInput('FULL secret probe','订货流程先核库存。'),201);
const wiki=await expect(s,'/api/wiki','POST',wikiInput('FULL secret probe',[raw.id],'待修订流程。'),201);
const audit=await expect(s,'/api/audits','POST',{wikiId:wiki.id,scope:'page',severity:'warning',comment:'核实步骤'},201);
const rawBefore=await fileSnapshot(path.join(h.dataRoot,'knowledge/raw'));
const r=await request(s,`/api/audits/${audit.id}/propose`,'POST',{});
report.proposeStatus=r.status;report.secretInHttpResponse=r.text.includes(h.fakeKey);
report.secretInDraft=r.json?.draft?.id ? (await fs.readFile(path.join(h.dataRoot,'drafts/audit',r.json.draft.id+'.json'),'utf8')).includes(h.fakeKey):false;
report.providerActuallyCalled=h.requests.length===1;report.authenticationMatched=h.requests[0]?.authCorrect;
report.rawUnchanged=JSON.stringify(rawBefore)===JSON.stringify(await fileSnapshot(path.join(h.dataRoot,'knowledge/raw')));
assert.equal(report.proposeStatus,201);assert.equal(report.secretInHttpResponse,true);assert.equal(report.secretInDraft,true);
report.acceptance='FAIL';report.reproduction='CONFIRMED';report.dataRoot=h.dataRoot;
}finally{await h.close();report.servicesClosed=h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null);await fs.writeFile('docs/reports/FULL-20261009-audit-secret-http.json',JSON.stringify(report,null,2));}
console.log(report);
