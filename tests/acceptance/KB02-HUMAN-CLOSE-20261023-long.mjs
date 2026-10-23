import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
const original=JSON.parse(await fs.readFile('docs/reports/KB02-REGION-AUDIT-20261023-long-checkpoint.json','utf8'));
let body='';for(let n=1;n<=14;n++){const region='虚构区域'+String(n).padStart(2,'0');let block=`【长文验收附录${n}，虚构】\n${region}2026年9月有100家目标门店，${n+10}家在售，门店数铺货率${n+10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。\n`,line=0;while(block.length<7600)block+=`附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;body+=block.slice(0,7600);}
assert.equal(createHash('sha256').update(body).digest('hex'),original.rawSha256);
let cp={...original,rulesVersion:(await loadExtractionRules('rules')).rulesVersion};
const result=await runKnowledgePipeline({raw:{id:cp.rawId,title:'独立长文逐主体核对',sourceType:'report',sourceName:'历史离线',tags:[]},body,bodySha256:cp.rawSha256,checkpoint:cp,rulesDir:'rules',provider:{name:'fake',model:'no-call',complete:async()=>{throw Error('No calls allowed');}},beforeCall:async()=>{throw Error('No calls allowed');},saveCheckpoint:async value=>cp={...value,integrity:original.integrity}});
const basis=result.outcome.reviewBasis,rows=[];
assert.equal(basis.units.length,55);assert.deepEqual(basis.units.flatMap(u=>u.memberIds).sort(),original.completedChunks.flatMap(c=>[...c.facts,...c.questions].map(r=>r.id)).sort());
for(let n=1;n<=14;n++){const region='虚构区域'+String(n).padStart(2,'0'),pageIndex=result.outcome.pages.findIndex(p=>p.title.includes(region));assert(pageIndex>=0);const assigned=basis.units.filter(u=>basis.pageUnitIds[pageIndex].includes(u.id));assert(assigned.length>0);for(const u of assigned){assert(u.start>=(n-1)*7600&&u.end<=n*7600,`${region}: cross-subject assignment ${u.id}`);assert.equal(body.slice(u.start,u.end),u.text);assert.equal(basis.pageUnitIds.flat().filter(id=>id===u.id).length,1);}const text=assigned.map(u=>u.text).join('\n');for(const value of ['2026年9月','100家目标门店',`${n+10}家在售`,`${n+10}%`,'未知','未来'])assert(text.includes(value),`${region}: ${value}`);rows.push({region,unitCount:assigned.length,originalIds:assigned.flatMap(u=>u.memberIds).length,date:'2026年9月',target:100,selling:n+10,percent:n+10,unknownAndFuturePreserved:true});}
const report={pass:true,head:'28b6d144a07d03d4e85fc8cc766027a763012c0e',node:process.version,realCalls:0,fakeCalls:0,chars:body.length,units:basis.units.length,originalIds:basis.units.flatMap(u=>u.memberIds).length,rows,limitation:'Historical validated extraction and plan replay only; not a fresh real Provider long-text quality result.'};
await fs.writeFile('docs/reports/KB02-HUMAN-CLOSE-20261023-long.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,subjects:rows.length,units:55,originalIds:101,realCalls:0}));
