import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {PREFIX,sha,readJson,writeJson,fileMap,sourceFreeze,installOfflineGuard,offlineOptions} from './SYN01-PREP-20261025-core.mjs';

export async function call(lab,url,method='GET',body,status=200){
  const response=await fetch(lab.base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const json=await response.json();assert.equal(response.status,status,`${method} ${url}: ${json.error?.code??'response'}`);return json;
}
export async function selftest({reportPrefix=PREFIX}={}){
  assert.match(reportPrefix,/^SYN01-(?:PREP|AUDIT)-20261025-[a-zA-Z0-9-]*$/);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),reportFile=`docs/reports/${reportPrefix}engineering-${stamp}.json`;
  const report={startedAt:new Date().toISOString(),node:process.version,baseCommit:'ba2d8541d061f06cca27ff7dc729d984472b0854',productCommit:'60f83adba102d887fcd925df13a8021ff7669de1',simulationOnly:true,realCalls:0,knowledgeCalls:241,promptCalls:15,rows:[],pass:false,independentAcceptance:'PENDING',realQuality:'NOT_RUN',chrome:'NOT_RUN',fullProduct:'NOT_PASSED'};
  const guard=installOfflineGuard(),labs=[];let dom,reactRoot,act,guardedFetch,freeze;
  const add=(id,detail)=>report.rows.push({id,pass:true,...detail});
  try{
    freeze=await sourceFreeze();report.freeze=freeze;
    const historical=await readJson('docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json');
    for(const [file,expected]of Object.entries(historical.expected))assert.equal(sha(await fs.readFile(file)),expected,file);
    report.reusedEvidence={file:'docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json',sha256:sha(await fs.readFile('docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json')),checkedFiles:Object.keys(historical.expected).length,checks:'H09 synthesis review/legacy migration; prior 445/build only, not rerun'};
    const fixture=await readJson('tests/acceptance/SYN01-PREP-20261025-fixtures.json'),card=await fs.readFile(fixture.sourceCard,'utf8');
    for(const item of fixture.raws){assert(card.includes('标题：'+item.title+'。正文：'+item.body));}
    const {createLab}=await import('./SYN01-PREP-20261025-server.mjs');
    for(const options of [{mode:'real'},{mode:'unknown'},{readConfig:()=>{}},{provider:{}},{transport:()=>{}},{mode:'fake',releaseFile:'anything'}])await assert.rejects(createLab(options));
    assert.throws(()=>offlineOptions({mode:'REAL'}));
    const lab=await createLab();labs.push(lab);report.root=lab.root;const initialRaw=await fileMap(path.join(lab.root,'knowledge/raw'));
    const samples=lab.session.samples,ids=samples.map(x=>x.id),url=id=>`/api/knowledge/workflows/${id}`;
    assert.equal(new Set(ids).size,2);assert.equal((await lab.drafts.list()).length,0);assert.equal(lab.requests.length,0);
    for(const [index,sample]of samples.entries()){const raw=await call(lab,`/api/raw/${sample.id}`);assert.equal(raw.body,fixture.raws[index].body);assert.equal(raw.title,fixture.raws[index].title);assert.equal(raw.bodySha256,sha(raw.body));assert.equal(raw.origin,undefined);}
    report.raws=samples;add('SP01-fixed-card-input',{rawBodyHashes:samples.map(x=>({id:x.id,sha256:x.bodySha256})),rawFiles:initialRaw});

    for(const route of ['/api/raw/other/extract','/api/knowledge/updates','/api/prompts/brief','/api/prompts/generate','/api/prompts/optimize','/api/audits/other/resolve','/api/settings/llm/test','/__stage/arm'])await call(lab,route,'POST',{},403);
    await call(lab,'/api/settings/llm','GET',undefined,403);await call(lab,'/api/knowledge/syntheses','POST',{rawIds:[ids[0],ids[0]]},400);
    const meeting=(await lab.raws.createMeetingRegistration({id:randomUUID(),title:'隔离会议负例',sourceName:'虚构',tags:[],body:'仅本机。',importedAt:new Date().toISOString(),origin:{kind:'meeting',meeting_id:randomUUID(),import_id:randomUUID(),original_sha256:sha('仅本机。'),registered_confidentiality:'Public',processing_policy:'meeting_local_only'}})).record;
    await call(lab,'/api/knowledge/syntheses','POST',{rawIds:[ids[0],meeting.id]},403);
    const rawFile=path.join(lab.root,'knowledge/raw/reports',ids[0]+'.md'),rawBytes=await fs.readFile(rawFile);
    await fs.writeFile(rawFile,Buffer.concat([rawBytes,Buffer.from('破坏正文')]));
    try{await call(lab,'/api/knowledge/syntheses','POST',{rawIds:ids},409);}finally{await fs.writeFile(rawFile,rawBytes);}
    assert.equal(lab.requests.length,0);assert.equal((await lab.wiki.allRecords()).length,0);
    add('SP03-pre-provider-source-gates',{duplicateRaw:400,meeting:403,integrity:409,fakeCalls:0});

    for(const failure of ['schema','rawId','quote','index']){lab.state.failure=failure;const before=await fileMap(path.join(lab.root,'drafts'));const failed=await call(lab,'/api/knowledge/syntheses','POST',{rawIds:ids},502);assert.equal(failed.error.code,failure==='schema'?'LLM_SCHEMA_INVALID':'EVIDENCE_INVALID');assert.deepEqual(await fileMap(path.join(lab.root,'drafts')),before);assert.equal((await lab.wiki.allRecords()).length,0);add('SP03-invalid-'+failure,{code:failed.error.code,preservedFailure:lab.requests.length});}
    // Keep the negative meeting fixture; compare original A/B separately as well.
    const rawBaseline=await fileMap(path.join(lab.root,'knowledge/raw'));
    const rawRecords=await Promise.all(ids.map(id=>lab.raws.get(id)));
    dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:lab.base,pretendToBeVisual:true});const w=dom.window;
    const previousGlobals=new Map();for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true})){previousGlobals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}report._restoreGlobals=()=>{for(const [name,descriptor]of previousGlobals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];};
    let createElement,createRoot,RawPage,KnowledgeWorkflowPage;({act,createElement}=await import('react'));({createRoot}=await import('react-dom/client'));({RawPage}=await import('../../app/pages/RawPage.tsx'));({KnowledgeWorkflowPage}=await import('../../app/pages/KnowledgeWorkflowPage.tsx'));
    let workflowId,done=0,capturedConfirm;
    guardedFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const target=String(input).startsWith('/api/')?lab.base+input:String(input);if(target.endsWith('/confirm'))capturedConfirm=JSON.parse(init.body);return guardedFetch(target,init);};
    const buttons=label=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent.trim()===label),text=()=>w.document.body.textContent;
    const wait=async(check,label)=>{const end=Date.now()+8000;while(Date.now()<end){await act(async()=>new Promise(r=>setTimeout(r,15)));if(check())return;}assert.fail('React timeout: '+label+' '+text().slice(-400));};
    const click=async(button)=>{assert(button&&!button.disabled,'enabled action '+button?.textContent);await act(async()=>button.click());};
    const change=async(element,value)=>{assert(element);await act(async()=>{const proto=element instanceof w.HTMLSelectElement?w.HTMLSelectElement.prototype:element instanceof w.HTMLTextAreaElement?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new w.Event('input',{bubbles:true}));element.dispatchEvent(new w.Event('change',{bubbles:true}));});};
    const mount=async(Component,props)=>{if(reactRoot)await act(async()=>reactRoot.unmount());reactRoot=createRoot(w.document.getElementById('root'));await act(async()=>reactRoot.render(createElement(Component,props)));};
    await mount(RawPage,{items:rawRecords,selectedId:ids[0],processing:{},job:null,openImport:false,onSelected:()=>{},onOpenImport:()=>{},onCommitted:async()=>{},onCloseImport:()=>{},onDeleted:async()=>{},onJobStarted:()=>{},onOpenDraft:()=>{},onRefresh:async()=>{},onOpenWorkflow:id=>{workflowId=id;}});
    await wait(()=>buttons('多来源综合').length===1,'RawPage');assert(text().includes(rawRecords[0].body));await click(buttons('多来源综合')[0]);await wait(()=>buttons('生成 Synthesis 草稿').length===1,'source picker');assert(buttons('生成 Synthesis 草稿')[0].disabled);
    const checks=w.document.querySelectorAll('.confirm-dialog input[type=checkbox]');assert.equal(checks.length,2);await click(checks[0]);assert(buttons('生成 Synthesis 草稿')[0].disabled);await click(checks[1]);assert(!buttons('生成 Synthesis 草稿')[0].disabled);await click(buttons('生成 Synthesis 草稿')[0]);await wait(()=>!!workflowId,'generated via RawPage');
    assert.equal(lab.requests.length,5);const initialWorkflow=await call(lab,url(workflowId));assert.equal(initialWorkflow.status,'pending_confirmation');assert.equal((await lab.wiki.allRecords()).length,0);
    assert.deepEqual(initialWorkflow.sources,ids);assert.deepEqual(initialWorkflow.sections.sourceList.map(x=>x.id),ids);
    for(const e of initialWorkflow.evidence){const raw=rawRecords.find(x=>x.id===e.rawId);assert(raw);assert.equal(raw.body.slice(e.start,e.end),e.quote);assert.equal(e.text,e.quote);}
    const units=structuredClone(initialWorkflow.humanReview.units);
    await writeJson(path.join(lab.root,'candidate-original.json'),initialWorkflow);
    add('SP02-actual-RawPage-generation',{workflowId,fakeCallsThisGeneration:1,evidenceCount:initialWorkflow.evidence.length,noExtraction:true});

    const workflowProps={workflowId,onBack:()=>{},onDone:async()=>{done++;}};
    await mount(KnowledgeWorkflowPage,workflowProps);await wait(()=>buttons('确认本页主题与完整归属').length===1,'workflow component');
    for(const label of ['一致观点','冲突（保留双方）','AI 推断','待确认问题','原文证据定位',...samples.map(x=>x.id)])assert(text().includes(label),label);
    await click(buttons('确认写入')[0]);await wait(()=>text().includes('请先保存并审查'),'unreviewed UI blocked');assert.equal(done,0);
    let flow=await call(lab,url(workflowId));await call(lab,url(workflowId)+'/confirm','POST',{baseRevision:flow.revision,idempotencyKey:'unreviewed'},409);
    const firstUnit=units[0].id,selector=`select[aria-label="归属 ${firstUnit}"]`;
    await change(w.document.querySelector(selector),'');await wait(()=>text().includes('未解决 1 项'),'unresolved');flow=await call(lab,url(workflowId));await call(lab,url(workflowId)+'/confirm','POST',{baseRevision:flow.revision,idempotencyKey:'unresolved'},409);
    await click(buttons('确认写入')[0]);await wait(()=>text().includes('解决所有未解决项'),'unresolved UI blocked');assert.equal(done,0);
    await change(w.document.querySelector(selector),workflowId);await wait(()=>text().includes('未解决 0 项')&&!buttons('确认本页主题与完整归属')[0].disabled,'resolved');
    const approve=async()=>{await click(buttons('确认本页主题与完整归属')[0]);await wait(()=>text().includes('本页已审查')&&!buttons('保存草稿')[0].disabled,'explicit reviewed');};await approve();
    flow=await call(lab,url(workflowId));const priorRevision=flow.revision;
    const title=w.document.querySelector('label.field input');await change(title,flow.title+'（人工审定）');await wait(()=>text().includes('有未保存编辑'),'dirty');await click(buttons('确认写入')[0]);assert.equal(done,0);await click(buttons('保存草稿')[0]);await wait(()=>text().includes('本页尚未完成审查')&&!text().includes('有未保存编辑')&&!buttons('保存草稿')[0].disabled,'saved invalidated');
    flow=await call(lab,url(workflowId));assert.equal(flow.humanReview.approvals.length,0);assert.deepEqual(flow.humanReview.units,units);await call(lab,url(workflowId)+'/confirm','POST',{baseRevision:priorRevision,idempotencyKey:'stale'},409);await call(lab,url(workflowId)+'/confirm','POST',{baseRevision:flow.revision,idempotencyKey:'edited-unreviewed'},409);
    await approve();flow=await call(lab,url(workflowId));const reviewedRevision=flow.revision;await mount(KnowledgeWorkflowPage,workflowProps);await wait(()=>text().includes('本页已审查'),'remount persisted approvals');assert.equal((await lab.wiki.allRecords()).length,0);
    await click(buttons('确认写入')[0]);await wait(()=>done===1,'explicit formal confirmation');assert.equal(capturedConfirm.baseRevision,reviewedRevision);
    const committed=await call(lab,url(workflowId));assert.equal(committed.status,'confirmed');const records=(await call(lab,'/api/wiki')).items;assert.equal(records.length,3);assert.equal(records.filter(x=>x.type==='source').length,2);const synthesis=records.find(x=>x.type==='synthesis');assert(synthesis);assert.equal(synthesis.revision,1);assert.deepEqual(synthesis.sources,ids);
    const formal=await call(lab,`/api/wiki/${synthesis.id}`);assert.deepEqual(formal.body,(await lab.wiki.get(synthesis.id)).body);
    for(const fragment of ['100','2026年9月','在售门店20家','铺货率20%','在售门店30家','铺货率30%','在售门店数除以目标门店数','审批负责人尚未确认','采样日是否一致尚未确认','尚未上线，收益未知',...ids])assert(formal.body.includes(fragment),fragment);
    for(const id of ids){const back=await call(lab,`/api/raw/${id}`);assert.equal(back.body,rawRecords.find(x=>x.id===id).body);const refs=await call(lab,`/api/raw/${id}/references`);assert(refs.items.some(x=>x.id===synthesis.id));}
    const log=await fs.readFile(path.join(lab.root,'knowledge/logs/wiki.jsonl'),'utf8'),lines=log.trim().split('\n').map(JSON.parse);assert.equal(lines.length,3);assert(lines.every(x=>x.operationId===committed.commitOperationId));
    const beforeIdempotent=await fileMap(lab.root),again=await call(lab,url(workflowId)+'/confirm','POST',capturedConfirm);assert.equal(again.reused,true);assert.equal(again.operationId,committed.commitOperationId);assert.deepEqual(await fileMap(lab.root),beforeIdempotent);assert.deepEqual(await fileMap(path.join(lab.root,'knowledge/raw')),rawBaseline);
    assert.deepEqual((await fileMap(path.join(lab.root,'knowledge/raw'))).filter(x=>x.path.startsWith('reports/')),initialRaw);report.confirm={workflowId,wikiId:synthesis.id,operationId:again.operationId,revision:reviewedRevision,idempotencyKey:capturedConfirm.idempotencyKey,filesUnchanged:beforeIdempotent.length,logEntries:lines.length};
    await writeJson(path.join(lab.root,'formal-readback.json'),{workflow:committed,records,log:lines});add('SP02-SP03-actual-workflow-review-save-confirm-readback',{units:units.length,staleRevision:409,formalRecords:3,sameKeyReused:true,rawUnchanged:true});

    await act(async()=>reactRoot.unmount());reactRoot=null;globalThis.fetch=guardedFetch;guardedFetch=null;
    const root=lab.root;await lab.close();labs.splice(labs.indexOf(lab),1);const reboot=await createLab({root});labs.push(reboot);assert.deepEqual(await fileMap(root),beforeIdempotent.concat(await fileMap(root).then(x=>x.filter(e=>e.path==='formal-readback.json'))).sort((a,b)=>a.path.localeCompare(b.path)));
    const restarted=await call(reboot,url(workflowId));assert.equal(restarted.status,'confirmed');const stable=await fileMap(root);await call(reboot,url(workflowId)+'/confirm','POST',capturedConfirm);assert.deepEqual(await fileMap(root),stable);assert.equal(reboot.requests.length,0);add('SP03-completed-restart-idempotency',{newFakeCalls:0,allFilesUnchanged:true});

    // A single controlled disk-write failure exercises production manifest recovery.
    const recovery=await createLab();labs.push(recovery);const recoveryIds=recovery.session.samples.map(x=>x.id);let pending=await call(recovery,'/api/knowledge/syntheses','POST',{rawIds:recoveryIds},201);pending=await call(recovery,`/api/knowledge/workflows/${pending.id}/review/pages/${pending.id}`,'POST',{baseRevision:pending.revision,reviewContentDigest:pending.reviewContentDigest,confirmed:true});
    const write=recovery.wiki.writePageLocked.bind(recovery.wiki);let count=0;recovery.wiki.writePageLocked=async record=>{if(++count===2)throw Error('SYN01_SYNTHETIC_DISK_STOP');return write(record);};
    const failure=await call(recovery,`/api/knowledge/workflows/${pending.id}/confirm`,'POST',{baseRevision:pending.revision,idempotencyKey:'recovery-fixed'},500);assert.equal(failure.error.code,'WORKFLOW_COMMIT_PENDING');assert.equal((await recovery.wiki.allRecords()).length,1);recovery.wiki.writePageLocked=write;
    const recoveryRoot=recovery.root;await recovery.close();labs.splice(labs.indexOf(recovery),1);const recovered=await createLab({root:recoveryRoot});labs.push(recovered);const recoveredFlow=await call(recovered,`/api/knowledge/workflows/${pending.id}`);assert.equal(recoveredFlow.status,'confirmed');assert.equal((await recovered.wiki.allRecords()).length,3);assert.equal(recovered.requests.length,0);const recoveryStable=await fileMap(recoveryRoot);const reused=await call(recovered,`/api/knowledge/workflows/${pending.id}/confirm`,'POST',{baseRevision:pending.revision,idempotencyKey:'recovery-fixed'});assert(reused.reused);assert.deepEqual(await fileMap(recoveryRoot),recoveryStable);report.recoveryRoot=recoveryRoot;add('SP03-production-partial-write-recovery',{code:failure.error.code,writesBefore:1,writesAfter:3,restartFakeCalls:0,sameKeyUnchanged:true});

    for(const file of ['.env.local','workspace/knowledge/raw/probe.md'])await assert.rejects(async()=>fs.readFile(file),/CONFIG_OR_OFFICIAL_DATA_READ_DENIED/);
    await assert.rejects(fetch('https://example.invalid'),/NETWORK_TARGET_DENIED/);assert.throws(()=>http.get(reboot.base),/HTTP_TRANSPORT_DENIED/);assert.throws(()=>net.connect({host:'127.0.0.1',port:1}),/NET_TRANSPORT_DENIED/);await assert.rejects(fetch(reboot.base,{dispatcher:{}}),/FETCH_OPTIONS_DENIED/);
    assert.equal(lab.requests.length,5);assert.equal(recovery.requests.length,1);report.fakeCalls=6;report.offlineGuard={...guard.observed,successfulConfigReads:0,realSends:0};add('SP04-fail-closed-mode-routes-config-network',{...report.offlineGuard,realPathImplemented:false});
    assert.deepEqual(await sourceFreeze(),freeze);report.pass=true;
  }catch(error){report.error={message:error.message,stack:error.stack,...(error.cause?{cause:{code:error.cause.code,message:error.cause.message}}:{})};process.exitCode=1;}
  finally{
    if(reactRoot)try{await act(async()=>reactRoot.unmount());}catch{}
    if(guardedFetch)globalThis.fetch=guardedFetch;
    for(const lab of labs.reverse())try{await lab.close();}catch(error){report.cleanupError=error.message;report.pass=false;process.exitCode=1;}
    dom?.window.close();report._restoreGlobals?.();delete report._restoreGlobals;guard.restore();report.finishedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.finishedAt)-Date.parse(report.startedAt);report.servicesClosed=true;
    if(freeze)report.freezeUnchanged=JSON.stringify(await sourceFreeze())===JSON.stringify(freeze);
    await writeJson(reportFile,report);console.log(JSON.stringify({selfcheck:report.pass?'PASS':'FAIL',rows:report.rows.length,realCalls:0,evidence:reportFile,error:report.error}));
  }
  return report;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await selftest();
