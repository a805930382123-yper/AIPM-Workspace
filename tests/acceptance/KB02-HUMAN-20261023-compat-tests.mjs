import fs from 'node:fs/promises';
const updates=[],report=[];
async function edit(name,fn){const file='tests/'+name,old=await fs.readFile(file,'utf8'),next=fn(old);if(next===old)throw Error('No compatibility change '+name);updates.push({file,next});report.push(file);}
for(const name of ['llm-flow.test.ts','llm-repair.test.ts','llm-repair2.test.ts','llm-repair3.test.ts'])await edit(name,s=>"import {addLegacyReviewPrecondition} from './support/human-review.ts';\n"+s.replace('await Promise.all([rawStates.initialize(), drafts.initialize(), jobs.initialize(), commits.initialize()]);','await Promise.all([rawStates.initialize(), drafts.initialize(), jobs.initialize(), commits.initialize()]);\n  addLegacyReviewPrecondition(commits,drafts,rawStore);'));
await edit('kb02-final-agreement.test.ts',s=>"import {persistedUpdateInput,approveWorkflow} from './support/human-review.ts';\n"+s.replace('draft={id:draftId','draftInput={id:draftId').replace(' const requests:LlmCompletionRequest[]=[];',' const draft=await persistedUpdateInput(root,raw,draftInput);\n const requests:LlmCompletionRequest[]=[];').replace('const args={draftId,pageId,baseRevision:1,','const args={draftId:draft.id,pageId:draft.pages[0].pageId,baseRevision:draft.revision,'));
await edit('b05.test.ts',s=>{
 s="import {persistedUpdateInput,approveWorkflow} from './support/human-review.ts';\n"+s;
 s=s.replace(/const draft = \{ id: 'draft'([^\n]+) \};/u,"const draft = await persistedUpdateInput(root,newRaw,{ id: 'draft'$1 });");
 s=s.replaceAll("pageId: 'page', baseRevision: 2, targetWikiId",'pageId: draft.pages[0].pageId, baseRevision: draft.revision, targetWikiId');
 // Keep fault/Raw/revision assertions after an actual explicit review of each output.
 s=s.replace(/(const (draft|workflow|stale) = await service\.create(?:Synthesis|Update)\([^\n]+\);)/gu,'$1\n    const $2Reviewed = await approveWorkflow(service,$2.id);\n    $2.revision=$2Reviewed.revision;');
 return s;
});
await edit('pa01-r01-r02.test.ts',s=>{
 s="import {persistedUpdateInput,approveWorkflow} from './support/human-review.ts';\n"+s;
 s=s.replace('draft={id:draftId','draftInput={id:draftId');
 s=s.replace(' const update=await store.createUpdate({draftId,pageId,baseRevision:1,',' const draft=await persistedUpdateInput(root,a,draftInput);\n const update=await store.createUpdate({draftId:draft.id,pageId:draft.pages[0].pageId,baseRevision:draft.revision,');
 s=s.replace("if(v.kind==='update')v.inputDraft={draftId:'draft',pageId:'page',revision:2};","if(v.kind==='update')v.inputDraft=structuredClone(original.inputDraft);");
 s=s.replace("const result=await f.store.confirm(v.id,2,randomUUID());","const reviewed=await approveWorkflow(f.store,v.id);const result=await f.store.confirm(v.id,reviewed.revision,randomUUID());");return s;
});
await edit('kb02-r2.test.ts',s=>{
 s="import {persistedUpdateInput,approveWorkflow} from './support/human-review.ts';\n"+s;
 s=s.replace('draft={id:draftId','draftInput={id:draftId');
 s=s.replace('};let calls=0;const provider:LlmProvider','};const draft=await persistedUpdateInput(root,r,draftInput);let calls=0;const provider:LlmProvider');
 s=s.replace('const args={draftId,pageId,baseRevision:1,','const args={draftId:draft.id,pageId:draft.pages[0].pageId,baseRevision:draft.revision,');
 s=s.replace("await store.confirm(flow.id,flow.revision,'kb02-r2-confirm')","await store.confirm(flow.id,(await approveWorkflow(store,flow.id)).revision,'kb02-r2-confirm')");return s;
});
await edit('llm-http.test.ts',s=>s.replace("const request = async (url: string, method = 'GET', body?: unknown): Promise<Reply> => {",`const request = async (url: string, method = 'GET', body?: unknown): Promise<Reply> => {
    // Legacy HTTP transaction tests perform the new required individual user actions first.
    if(method==='POST'&&/^\\/api\\/drafts\\/[^/]+\\/confirm$/u.test(url)){
      const base=url.slice(0,-8),input=body as any,view=await request(base);let draft=view.json as any;
      if(view.status===200&&draft.status==='pending_confirmation'&&draft.revision===input.baseRevision&&input.selectedPageIds?.length&&input.selectedPageIds.every((id:string)=>draft.pages.some((p:any)=>p.pageId===id))){
        const started=await request(base+'/review/start','POST',{baseRevision:draft.revision});if(started.status===200){draft=started.json;for(const page of draft.pages){const result=await request(base+'/review/pages/'+page.pageId,'POST',{baseRevision:draft.revision,reviewContentDigest:draft.reviewContentDigest,confirmed:true});assert.equal(result.status,200,result.text);draft=result.json;}body={...input,baseRevision:draft.revision};}
      }
    }`));
for(const u of updates)await fs.writeFile(u.file,u.next);
await fs.writeFile('docs/reports/KB02-HUMAN-20261023-compat-migration.json',JSON.stringify({files:report,purpose:'Only test scaffolding adds explicit per-page review; original transaction and safety assertions retained. HUMAN service/HTTP tests remain unwrapped.'},null,2),{flag:'wx'});console.log(report);
