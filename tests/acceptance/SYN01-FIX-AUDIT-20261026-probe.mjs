// Independently authored synthetic ID-binding probe; no provider/network/disk Store.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installOfflineGuard} from './SYN01-PREP-20261025-core.mjs';
const guard=installOfflineGuard();
const {KnowledgeWorkflowStore}=await import('../../services/wiki/knowledge-workflows.ts');
const sha=s=>createHash('sha256').update(s).digest('hex');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const data=new Map([a,b].map(id=>[id,{id,title:'SYNTHETIC identical text',body:'同一段😀。',bodySha256:sha('同一段😀。')}]));
const store=new KnowledgeWorkflowStore('SYNTHETIC-no-disk',{schema:async()=>({categories:[{id:'other',label:'其他'}]})},{get:async id=>data.get(id)});
let saves=0,reply,lastInput;
store.save=async v=>{saves++;return v;};
const provider={name:'SYNTHETIC',model:'independent',secrets:[],complete:async req=>{lastInput=JSON.parse(req.user);return {text:JSON.stringify(reply(lastInput)),finishReason:'stop',bytes:1};}};
const empty=()=>({synthesis_format_version:1,title:'SYNTHETIC',category:'other',agreement:[],conflicts:[],suggestedAdditions:[],inferences:[],openQuestions:[]});
const run=(ids=[a,b])=>store.createSynthesis({rawIds:ids,provider});
try{
  let oldId;
  reply=input=>{const x=input.raws.find(r=>r.id===a),y=input.raws.find(r=>r.id===b);assert.notEqual(x.locators[0].id,y.locators[0].id);oldId=x.locators[0].id;return {...empty(),agreement:[{text:'SYNTHETIC B',rawId:b,locatorId:y.locators[0].id}]};};
  const valid=await run([b,a]);assert.equal(valid.evidence[0].rawId,b);assert.equal(valid.evidence[0].quote,data.get(b).body);assert.equal(saves,1);
  reply=()=>({...empty(),agreement:[{text:'SYNTHETIC wrong identity',rawId:b,locatorId:oldId}]});
  await assert.rejects(run(),{code:'EVIDENCE_INVALID'});assert.equal(saves,1);
  data.set(a,{...data.get(a),body:'新正文😀。',bodySha256:sha('新正文😀。')});
  reply=input=>{assert.notEqual(input.raws.find(r=>r.id===a).locators[0].id,oldId);return {...empty(),agreement:[{text:'SYNTHETIC stale',rawId:a,locatorId:oldId}]};};
  await assert.rejects(run(),{code:'EVIDENCE_INVALID'});assert.equal(saves,1);
  console.log(JSON.stringify({synthetic:true,checks:['identical-body-different-Raw-and-reversed-order','cross-Raw-replay-rejected','actual-changed-body-old-ID-rejected'],saves,realCalls:0,guard:guard.observed}));
}finally{guard.restore();}
