import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildKnowledgePlanningInput,projectKnowledgePlan,expandKnowledgePlan} from '../../services/llm/knowledge-planning.ts';
import {chunkText} from '../../services/llm/chunk.ts';
import {buildEvidenceLocatorCatalog} from '../../services/llm/locators.ts';
const source=JSON.parse(await fs.readFile('tests/acceptance/KB02-SOURCE-20261022-seq121-fixture.json','utf8'));
const catalogs=new Map(chunkText(source.raw.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(c=>[c.index,buildEvidenceLocatorCatalog(source.raw.body,c)]));
const input=()=>buildKnowledgePlanningInput(source.raw.body,structuredClone(source.checkpoint.completedChunks),catalogs);
const wire=p=>({version:3,document:{title:'隔离',main_topic:'隔离'},pages:[{title:'甲',type:'metric',category:'metric',factUnitIds:p.factUnits.map(u=>u.id),questionUnitIds:p.questionUnits.map(u=>u.id)}]});
test('Independent fixed-unit reverse projection rejects duplicate, removed and split members before deduplicating',()=>{
 const p=input(),good={document:{title:'隔离',main_topic:'隔离',summary:''},pages:expandKnowledgePlan(wire(p),p)};
 assert.equal(good.pages[0].factIds.length,79);assert.equal(good.pages[0].questionIds.length,25);assert.deepEqual(projectKnowledgePlan(good,p),wire(p));
 for(const fault of ['duplicate','remove','split']){const bad=structuredClone(good);if(fault==='duplicate')bad.pages[0].factIds.push('f-c6-3');else{bad.pages[0].factIds.splice(bad.pages[0].factIds.indexOf('f-c6-3'),1);if(fault==='split')bad.pages.push({...bad.pages[0],title:'乙',factIds:['f-c6-3'],questionIds:[]});}assert.throws(()=>projectKnowledgePlan(bad,p),{code:'LLM_CHECKPOINT_CORRUPT'});}
});
test('Independent same location kind and column boundaries preserve all records without false same-source ownership constraints',()=>{
 const chunks=structuredClone(source.checkpoint.completedChunks),record=chunks.flatMap(c=>c.facts).find(f=>f.id==='f-c6-3');record.kind='ambiguous';
 const p=buildKnowledgePlanningInput(source.raw.body,chunks,catalogs),a=p.factUnits.find(u=>u.memberIds.includes('f-c6-3')),b=p.factUnits.find(u=>u.memberIds.includes('f-c7-1'));
 assert.notEqual(a.id,b.id);assert.equal(a.sourceId,b.sourceId);assert.equal(a.kind,'ambiguous');assert.equal(b.kind,'fact');
 const w=wire(p);w.pages[0].factUnitIds=w.pages[0].factUnitIds.filter(id=>id!==a.id);w.pages.push({title:'歧义',type:'metric',category:'metric',factUnitIds:[a.id],questionUnitIds:[]});
 const stored={document:{...w.document,summary:''},pages:expandKnowledgePlan(w,p)};assert.equal(stored.pages.flatMap(p=>p.factIds).length,79);assert.deepEqual(projectKnowledgePlan(stored,p),w);
});
