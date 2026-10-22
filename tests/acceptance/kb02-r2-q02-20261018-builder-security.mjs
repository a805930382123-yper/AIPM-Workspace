// Changed KB02-2 wires only. All credentials and business data below are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHarness,expect,request,terminal,rawInput,wikiInput,fileSnapshot} from './kb02-20261015-standards-harness.mjs';
const rows=[],services=[],credentials=['r2-only-fake-long-secret!19','z7Q!'];
const decode=w=>{const user=w.messages.find(x=>x.role==='user').content;return {planning:user.includes('请对下列全部已验证事实规划知识页'),data:JSON.parse(user.slice(user.lastIndexOf('\n')+1))};};
const clean=w=>{if(w.messages[0].content.includes('知识更新建议器')){const d=JSON.parse(w.messages[1].content);return {suggestedAdditions:[{text:'新来源在售30家。',evidenceId:d.newSource.evidence[0].id}],conflicts:[],agreement:[],inferences:[],openQuestions:[]};}const p=decode(w);return p.planning?{version:2,document:{title:'虚构指标',main_topic:'指标'},pages:[{title:'虚构指标',type:'metric',category:'metric',factIds:p.data.facts.map(x=>x.id),questionIds:p.data.questions.map(x=>x.id)}]}:{version:2,facts:p.data.filter(x=>x.text.trim()).map(x=>({atomId:x.id,kind:'fact'})),questions:[],sourceNotes:[]};};
const snap=async root=>({knowledge:await fileSnapshot(path.join(root,'knowledge')),prompts:await fileSnapshot(path.join(root,'prompts')),drafts:await fileSnapshot(path.join(root,'drafts'))});
async function strings(dir){let result='';for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=path.join(dir,e.name);result+=e.isDirectory()?await strings(p):await fs.readFile(p,'utf8');}return result;}
const redact=s=>credentials.reduce((v,k)=>v.replaceAll(k,'[synthetic credential]'),String(s));
async function check(id,fn){try{rows.push({id,result:'PASS',evidence:await fn()});}catch(e){rows.push({id,result:'FAIL',error:redact(e.stack)});}console.log(id,rows.at(-1).result);}
for(const [index,key] of credentials.entries()){
 const h=await createHarness(clean,key),label=index?'short':'long';let s;
 try{
  s=await h.start();const old=await expect(s,'/api/raw','POST',rawInput('虚构旧来源','在售20家。'),201),target=await expect(s,'/api/wiki','POST',wikiInput('虚构旧指标',[old.id],'在售20家。KB02_HUMAN'),201);
  const source=await expect(s,'/api/raw','POST',rawInput('虚构更新来源','在售30家。'),201),start=await expect(s,'/api/raw/'+source.id+'/extract','POST',{},202),job=await terminal(s,start.jobId);assert.equal(job.status,'completed');let draft=await expect(s,'/api/drafts/'+job.draftId);
  await expect(s,`/api/knowledge/drafts/${draft.id}/pages/${draft.pages[0].pageId}/decision`,'PATCH',{baseRevision:draft.revision,decision:'update',targetWikiId:target.id});draft=await expect(s,'/api/drafts/'+draft.id);
  const update={draftId:draft.id,pageId:draft.pages[0].pageId,targetWikiId:target.id,baseRevision:draft.revision};
  for(const stage of ['extracting','planning','update'])for(const variant of ['value','key','escaped','nested-key'])await check(`${label}-${stage}-${variant}`,async()=>{
   let r;if(stage!=='update')r=await expect(s,'/api/raw','POST',rawInput('虚构安全边界','在售30家。负责人未知。'),201);
   const before=await snap(h.dataRoot),n=h.requests.length;
   h.setReply(w=>{const actual=w.messages[0].content.includes('知识更新建议器')?'update':decode(w).planning?'planning':'extracting';const v=clean(w);if(actual!==stage)return v;if(variant==='key')v[key]='x';else if(variant==='nested-key')v.extra={[key]:'x'};else if(actual==='update')v.suggestedAdditions[0].text=key;else if(actual==='planning')v.document.title=key;else v.facts[0].atomId=key;let text=JSON.stringify(v);if(variant==='escaped')text=text.replaceAll(key,[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));return text;});
   let publicText;
   if(stage==='update'){const response=await request(s,'/api/knowledge/updates','POST',update);assert.equal(response.status,502,response.text);assert.equal(response.json.error.code,'LLM_OUTPUT_CONTAINS_SECRET');publicText=response.text;}
   else{const st=await expect(s,'/api/raw/'+r.id+'/extract','POST',{},202),j=await terminal(s,st.jobId);assert.equal(j.status,'failed');assert.equal(j.error.code,'LLM_OUTPUT_CONTAINS_SECRET');assert(!j.draftId);publicText=JSON.stringify(j);}
   assert(!publicText.includes(key));assert(!s.logs.includes(key));assert(!(await strings(h.dataRoot)).includes(key));assert.deepEqual(await snap(h.dataRoot),before);assert.equal(h.requests.length-n,stage==='planning'?2:1);assert(h.requests.slice(n).every(x=>x.authCorrect));return {blocked:true,assetsUnchanged:true,noSecret:true,localhostCalls:h.requests.length-n};
  });
  await check(label+'-clean-update-control',async()=>{h.setReply(clean);const before={knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))};const d=await expect(s,'/api/knowledge/updates','POST',update,201);assert(d.evidence.length);assert.deepEqual({knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))},before);return {preview:true,noFormalWrites:true};});
  await check(label+'-meeting-zero-provider',async()=>{const catalog=await expect(s,'/api/meeting-catalog');let m=await expect(s,'/api/meetings','POST',{requestId:randomUUID(),title:'虚构受限来源',meeting_date:'2026-10-18',meeting_type:catalog.types[0].id,confidentiality:'Public'},201);m=await expect(s,'/api/meetings/'+m.meeting_id+'/policy','PATCH',{baseRevision:m.revision,storage_mode:'local_archive',raw_transfer_authorized:true,confirm_raw_transfer:true});m=await expect(s,'/api/meetings/'+m.meeting_id+'/minutes/import','POST',{baseRevision:m.revision,requestId:randomUUID(),text:'会议原件，仅本地。'},201);const link=await expect(s,'/api/meetings/'+m.meeting_id+'/raw-links','POST',{baseRevision:m.revision,requestId:randomUUID(),import_id:m.active_import_id,confirm:true},201),n=h.requests.length,before=await snap(h.dataRoot);assert.equal((await request(s,'/api/raw/'+link.raw_id+'/extract','POST',{})).status,403);assert.equal((await request(s,'/api/knowledge/syntheses','POST',{rawIds:[old.id,link.raw_id]})).status,403);assert.equal(h.requests.length,n);assert.deepEqual(await snap(h.dataRoot),before);return {extract403:true,synthesis403:true,providerCalls:0};});
 }catch(e){rows.push({id:label+'-setup',result:'FAIL',error:redact(e.stack)});}finally{await h.close();services.push({root:h.dataRoot,closed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)});}
}
const summary={pass:rows.filter(x=>x.result==='PASS').length,fail:rows.filter(x=>x.result==='FAIL').length};
await fs.writeFile('docs/reports/KB02-R2-Q02-20261018-builder-security.json',JSON.stringify({at:new Date().toISOString(),scope:'affected extraction/planning/update HTTP output safety and Meeting gates; localhost fake only',externalCalls:0,summary,rows,services},null,2));console.log(summary);if(summary.fail)process.exitCode=1;
