// One concrete UI race; jsdom and memory fetch only, no live HTTP or Provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/',pretendToBeVisual:true});
const w = dom.window;
for(const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,
  HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,
  Event:w.Event,MouseEvent:w.MouseEvent,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))
  Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react');
const {createRoot}=await import('react-dom/client');
const {DraftReviewPage}=await import('../../app/pages/DraftReviewPage.tsx');
const raw={id:'raw-race',title:'虚构资料',body:'虚构事实。',bodySha256:'a'.repeat(64),sourceType:'note',sourceName:'内存',tags:[]};
const draft={id:'draft-race',rawId:raw.id,rawTitle:raw.title,status:'pending_confirmation',revision:1,
  rulesVersion:'locator-v2',provider:{name:'memory',model:'fixture'},document:{title:raw.title,main_topic:'主题',summary:'摘要'},
  source:{title:raw.title,body:'摘要',summary:'摘要',key_takeaways:[],category:'other',knowledge_status:'source_supported',confidence:'low',source_level:'C'},
  pages:[{pageId:'page-1',title:'原始标题',type:'concept',category:'other',one_line_definition:'定义',
    source_facts:[{text:'虚构事实',evidenceIds:['e1']}],source_evidence:[{id:'e1',rawId:raw.id,quote:raw.body,start:0,end:raw.body.length,chunkIndex:0}],
    ai_organized:[],ai_inferences:[],related_pages:[],open_questions:[],selected:true,knowledge_status:'source_supported',confidence:'low',source_level:'C'}],
  warnings:[],raw,preview:{rawExists:true,rawSha256Matches:true,titleConflicts:[],batchDuplicateTitles:[],sourceReuse:null,sourceAmbiguous:null}};
const schema={types:[{id:'concept',label:'概念'}],categories:[{id:'other',label:'其它'}],enums:{knowledge_status:['source_supported'],confidence:['low']},sourcePolicy:{levels:[{id:'C',label:'C'}]}};
let hold=false,held=0,release;
const gate=new Promise(resolve=>release=resolve),calls=[];
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  const p=String(url),method=options.method??'GET';calls.push({path:p,method,...(options.body?{body:JSON.parse(options.body)}:{})});
  if(p.includes('/duplicates')) {if(hold){held++;await gate;}return response({draftId:draft.id,pageId:'page-1',draftRevision:draft.revision,decision:null,targetWikiId:null,candidates:[]});}
  if(p==='/api/wiki/schema')return response(schema);
  if(p.startsWith('/api/raw/'))return response(raw);
  if(p.endsWith('/confirm'))return response({operationId:'op-race',sourceId:'source',wikiIds:['wiki'],sourceReused:false,warnings:[]});
  if(p.startsWith('/api/wiki-commits/'))return response({status:'completed',phases:[],warnings:[]});
  if(p.startsWith('/api/drafts/'))return response(draft);
  throw Error('Unexpected memory endpoint '+p);
};
const root=createRoot(w.document.getElementById('root'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const tick=async()=>act(async()=>{await delay(0);});
const click=async element=>act(async()=>{element.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await delay(0);});
let report;
try {
  await act(async()=>{root.render(createElement(DraftReviewPage,{draftId:draft.id,onBack:()=>{},onCommitted:async()=>{},onOpenRaw:()=>{}}));await delay(0);});
  await act(async()=>{await delay(150);});
  hold=true;
  await click([...w.document.querySelectorAll('button')].find(x=>x.textContent.includes('确认写入 Wiki')));
  assert(held>0,'Confirmation must actually await the duplicate response.');
  const checkbox=w.document.querySelector('.draft-select input');
  const wasEnabled=!checkbox.disabled;
  const mutableControls=[...w.document.querySelectorAll('.draft-source-summary input,.draft-source-summary textarea,.draft-source-summary select,.draft-card input,.draft-card textarea,.draft-card select')];
  const selectionButtons=[...w.document.querySelectorAll('button')].filter(x=>['全选','全不选'].includes(x.textContent.trim()));
  const selectionButtonsLocked=selectionButtons.every(x=>x.disabled);
  const allMutableLocked=mutableControls.length>0&&mutableControls.every(x=>x.disabled)&&selectionButtonsLocked;
  if(wasEnabled)await click(checkbox);
  const visibleSelectionAfterChange=checkbox.checked;
  if(wasEnabled)assert.equal(visibleSelectionAfterChange,false,'The user must visibly cancel selection while confirmation is waiting.');
  release();
  for(let i=0;i<20&&!calls.some(x=>x.path.endsWith('/confirm'));i++)await tick();
  const submitted=calls.find(x=>x.path.endsWith('/confirm'));
  report={at:new Date().toISOString(),scope:'Actual DraftReviewPage in jsdom + memory fetch; no real browser/HTTP/Provider',
    id:'SP04-selection-changed-during-confirm-candidate-await',result:wasEnabled?(submitted?'FAIL':'PASS'):(allMutableLocked?'PASS':'FAIL'),
    expected:'No formal confirm for a visibly deselected page, or controls locked before the user can change selection.',
    checkboxEnabledDuringConfirm:wasEnabled,allMutableLocked,mutableControlCount:mutableControls.length,selectionButtonsLocked,visibleSelectionAfterChange,submittedPageIds:submitted?.body.selectedPageIds??[],
    calls:calls.filter(x=>x.method!=='GET')};
} finally {release();await act(async()=>root.unmount());w.close();}
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec-ui-race-'+(process.argv[2]??'recheck')+'.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
