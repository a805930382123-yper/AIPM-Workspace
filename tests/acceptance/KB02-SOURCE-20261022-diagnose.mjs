import fs from 'node:fs/promises';
import { coverageDiagnostic, hasCoverageErrors } from '../../services/llm/knowledge-atoms.ts';
const prefix='docs/reports/KB02-SOURCE-20261022-';
const source='docs/reports/KB02-PLAN-AUDIT-20261022-';
const trace=(await fs.readFile(source+'provider-trace.jsonl','utf8')).trim().split(/\r?\n/u).map(s=>JSON.parse(s)).find(t=>t.sequence===121);
const input=JSON.parse(trace.request.messages.find(m=>m.role==='user').content.split('\n').at(-1));
const plan=JSON.parse(trace.response.content),cp=JSON.parse(await fs.readFile(source+'long-checkpoint.json','utf8'));
const diagnostic=coverageDiagnostic(input.facts.map(i=>i.id),input.questions.map(i=>i.id),plan.pages);
const groups=new Map();
for(const column of ['facts','questions'])for(const item of input[column]) {
 const key=JSON.stringify([item.sourceId,item.text,column,column==='facts'?item.kind:null]);
 if(!groups.has(key))groups.set(key,{sourceId:item.sourceId,column,kind:item.kind,text:item.text,ids:[]});
 groups.get(key).ids.push(item.id);
}
const duplicates=[...groups.values()].filter(g=>g.ids.length>1).map(g=>({...g,pages:plan.pages.filter(p=>g.ids.some(id=>p[g.column==='facts'?'factIds':'questionIds'].includes(id))).map(p=>p.title)}));
const report={at:new Date().toISOString(),sequence:121,inputCounts:{facts:input.facts.length,questions:input.questions.length,contexts:input.sourceContexts.length},oldCoverageAccepted:!hasCoverageErrors(diagnostic),diagnostic,duplicateUnits:duplicates.length,split:duplicates.filter(g=>g.pages.length>1),checkpointContainsBadPlan:JSON.stringify(cp.plan.pages)===JSON.stringify(plan.pages),facts:cp.completedChunks.flatMap(c=>c.facts).filter(f=>['f-c6-3','f-c7-1'].includes(f.id)),realProviderCalls:0};
await fs.writeFile(prefix+'diagnosis.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
