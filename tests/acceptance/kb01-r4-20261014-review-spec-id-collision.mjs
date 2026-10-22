// Concrete remaining merge risk: valid provider IDs already reserve the generated suffix.
import fs from 'node:fs/promises';
import path from 'node:path';
import {LLMService} from '../../services/llm/service.ts';
import {chunkText} from '../../services/llm/chunk.ts';
import {buildEvidenceLocatorCatalog} from '../../services/llm/locators.ts';
const body='虚构渠道事实。'.repeat(1400),chunks=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
let calls=0;
const provider={name:'memory',model:'collision',secrets:[],complete:async input=>{
  calls++;
  const index=Number(input.user.match(/第 (\d+) 段，覆盖原文全局区间/)[1])-1;
  const catalog=buildEvidenceLocatorCatalog(body,chunks[index]);
  const evidence=index===0?[{id:'e1',locatorId:catalog[0].id},{id:'e1-c2',locatorId:catalog[1].id}]:[{id:'e1',locatorId:catalog[0].id}];
  return {bytes:100,finishReason:'stop',text:JSON.stringify({evidence_format_version:2,document:{title:'虚构资料',main_topic:'渠道',summary:'共同摘要'},
    suggested_pages:[{title:'共同主题',type:'concept',category:'channel',one_line_definition:'渠道事实',
      source_facts:evidence.map(e=>({text:'事实'+e.id,evidenceIds:[e.id]})),source_evidence:evidence,
      ai_organized:[],ai_inferences:[],related_pages:[],open_questions:[]}]})};
}};
let report={at:new Date().toISOString(),scope:'Actual LLMService; in-memory provider; no HTTP/config/user data',id:'SP05-generated-id-reserved-by-earlier-valid-provider-id'};
try{const outcome=await new LLMService(path.resolve('rules')).wikiExtract({raw:{id:'raw-independent-collision',title:'虚构资料',sourceType:'note',sourceName:'内存',tags:[]},body,provider});report={...report,result:'PASS',calls,evidenceIds:outcome.pages[0].source_evidence.map(e=>e.id)};}
catch(error){report={...report,result:'FAIL',calls,code:error.code,message:error.message};}
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec-id-collision.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
