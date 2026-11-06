import {lwFixture} from '../lw01-fixture.ts';
import {writeFile} from 'node:fs/promises';
const results=[];
{
 const f=await lwFixture(),raw=await f.rawStore.create({title:'独验未归属',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n渠道有效门店15家。'});
 let d=await f.generate(raw.id);const unit=d.humanReview.units[0];
 d=await f.drafts.reviewOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[unit.id],pageId:null},{body:raw.body,rulesDir:'rules'});
 d=await f.accept(d);
 try{const r=await f.confirm(d);results.push({case:'unresolved-unit',expected:'reject',actual:r.manifest.status,unresolved:d.humanReview.assignments[unit.id],formal:(await f.wiki.allRecords()).length,root:f.root});}catch(e){results.push({case:'unresolved-unit',code:e.code,message:e.message,root:f.root});}
}
{
 const f=await lwFixture();f.setTopics(['渠道覆盖','回访周期']);const raw=await f.rawStore.create({title:'独验键复用',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n回访周期9天。'});
 let d=await f.generate(raw.id);d=await f.accept(d,['change-0']);const first=await f.confirm(d,'review-same-key');
 d=await f.accept(await f.drafts.get(d.id),['change-1']);
 try{const second=await f.confirm(d,'review-same-key');results.push({case:'same-key-different-selection',expected:'409',actual:second.manifest.status,first:first.manifest.operationId,second:second.manifest.operationId,root:f.root});}catch(e){results.push({case:'same-key-different-selection',code:e.code,message:e.message,root:f.root});}
}
await writeFile('docs/reports/LW01-20261101-review-gates.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
