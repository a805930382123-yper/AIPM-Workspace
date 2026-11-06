import test from 'node:test';
import assert from 'node:assert/strict';
import {lwFixture} from '../lw01-fixture.ts';
import {ExtractionCheckpointStore} from '../../services/llm/checkpoints.ts';
import {preserveDeepBoundaries,checkDeepNote,deepLeaves} from '../../services/llm/knowledge-deep.ts';
test('review deep: cross-block reason merge, unlocated retention, stable reassembly and zero extra calls',async()=>{
 const f=await lwFixture(),raw=await f.rawStore.create({title:'独验原句',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖存在口径疑点。'}),draft=await f.generate(raw.id,'deep');
 const cp=await new ExtractionCheckpointStore(f.root).get(draft.jobId),fact=cp.completedChunks[0].facts[0];
 const attr={role:'needs_verification',factIds:[fact.id]},outline={version:1,sections:[{id:'one',title:'口径',question:'如何核对',factIds:[fact.id],questionIds:[]}],excluded:[]};
 const note={version:1,orientation:'独验来源边界',sections:[{id:'one',title:'口径',question:'如何核对',blocks:[
 {type:'paragraph',...attr,text:fact.text,reason:'甲：统计日期缺失'},
 {type:'list',items:[{...attr,text:fact.text,reason:'乙：样本范围不明'},{role:'needs_verification',factIds:[],text:fact.text,reason:'丙：没有可靠定位'},{role:'needs_verification',factIds:[],text:fact.text,reason:'丁：也没有可靠定位'}]},
 {type:'table',title:'核对事项',headings:['原句'],rows:[{...attr,cells:[fact.text],reason:'戊：核对原始报表'}]}
 ]}]};
 const count=f.requests.length,normalized=preserveDeepBoundaries(note,outline,cp);checkDeepNote(normalized,outline,cp);
 assert.deepEqual(preserveDeepBoundaries(normalized,outline,cp),normalized);assert.equal(f.requests.length,count);
 const leaves=deepLeaves(normalized),mapped=leaves.filter(l=>l.prose===fact.text&&l.factIds.includes(fact.id));assert.equal(mapped.length,1);
 for(const text of ['甲：统计日期缺失','乙：样本范围不明','戊：核对原始报表'])assert(mapped[0].reason.includes(text));
 for(const text of ['丙：没有可靠定位','丁：也没有可靠定位'])assert(leaves.some(l=>l.reason===text));
 assert((await f.drafts.get(draft.id)).structuredNote);assert((await new ExtractionCheckpointStore(f.root).get(draft.jobId)).deep.note);
});
