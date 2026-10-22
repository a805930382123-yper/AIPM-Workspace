import fs from 'node:fs/promises';
const prior=JSON.parse(await fs.readFile('tests/acceptance/KB02-PLAN-20261022-sol-failure-fixture.json','utf8')).cases[0];
const source='docs/reports/KB02-PLAN-AUDIT-20261022-',cp=JSON.parse(await fs.readFile(source+'long-checkpoint.json','utf8'));
const trace=(await fs.readFile(source+'provider-trace.jsonl','utf8')).trim().split(/\r?\n/u).map(s=>JSON.parse(s)).find(t=>t.sequence===121);
const input=JSON.parse(trace.request.messages.find(m=>m.role==='user').content.split('\n').at(-1)),response=JSON.parse(trace.response.content);
const raw={...prior.raw,id:cp.rawId};if(raw.bodySha256!==cp.rawSha256)throw Error('Raw identity mismatch');
const expectedAreas={};for(const item of [...input.facts,...input.questions]){const context=input.sourceContexts.find(c=>c.id===item.sourceId),section=raw.body.slice(0,context.start+1).match(/虚构区域\d{2}/gu)?.at(-1);expectedAreas[item.id]=item.text.match(/虚构区域(\d{2})/u)?.[1]??section?.slice(-2);if(!expectedAreas[item.id])throw Error('No fixture label');}
await fs.writeFile('tests/acceptance/KB02-SOURCE-20261022-seq121-fixture.json',JSON.stringify({source:'KB02-PLAN-AUDIT-20261022 seq121 original real response/checkpoint; no generated product facts',sequence:121,raw,checkpoint:cp,input,response,expectedAreas},null,2));
let p='services/llm/knowledge-extraction.ts',s=await fs.readFile(p,'utf8');const marker='    if (current.plan.document.summary !==';
const before=`    // The stored plan keeps original IDs; it is not a v3 Provider response.
    const pagesSchema=bundle.kb02PlanningSchema.properties!.pages!, unitPage=pagesSchema.items!;
    const {factUnitIds,questionUnitIds,...pageMetadata}=unitPage.properties!;
    const storedSchema={...bundle.kb02PlanningSchema,properties:{...bundle.kb02PlanningSchema.properties,version:{type:'integer',enum:[2]},pages:{...pagesSchema,items:{...unitPage,required:unitPage.required!.map(key=>key==='factUnitIds'?'factIds':key==='questionUnitIds'?'questionIds':key),properties:{...pageMetadata,factIds:factUnitIds,questionIds:questionUnitIds}}}}};
    try { exact({version:2,...current.plan,document:{title:current.plan.document.title,main_topic:current.plan.document.main_topic}},storedSchema,'检查点原ID规划'); } catch { throw new LlmError('LLM_CHECKPOINT_CORRUPT','检查点原ID规划不符合严格结构，已拒绝恢复。',409); }
`;
s=s.replace(marker,before+marker);await fs.writeFile(p,s);
