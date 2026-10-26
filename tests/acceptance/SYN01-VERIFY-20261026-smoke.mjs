// New binding/App/save smoke only. Reservation restart/state mechanics reuse RECHECK evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {fileMap} from './SYN01-PREP-20261025-core.mjs';
import {prepare,durable,sha,readJson,freeze,sessionAt} from './SYN01-VERIFY-20261026-core.mjs';
import {createLab,startUi} from './SYN01-VERIFY-20261026-server.mjs';

export async function smoke({reportPrefix='SYN01-VERIFY-20261026-'}={}) {
  assert.match(reportPrefix,/^SYN01-VERIFY-(?:AUDIT-)?20261026-$/);
  const report={startedAt:new Date().toISOString(),realCalls:0,configReads:0,pass:false,checks:[],chrome:'NOT_RUN'},file=`docs/reports/${reportPrefix}smoke-${Date.now()}.json`;
  let lab,ui,dom,root,act;const nativeFetch=globalThis.fetch,globals=new Map();
  try{
    await assert.rejects(sessionAt(path.resolve('.scratch-SYN01-RECHECK-20261026-not-read')),/ISOLATED_ROOT_REQUIRED/);
    assert.equal(sha(await fs.readFile('services/wiki/knowledge-workflows.ts')),'eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032');
    const session=await prepare('fake');assert.equal(session.sequence,244);assert.equal(session.maxCalls,1);assert.equal(session.knowledgeBefore,243);
    report.root=session.root;report.freeze=await readJson(path.join(session.root,'freeze.json'));lab=await createLab(session.root);ui=await startUi(lab);report.ui=ui.url;
    const request=async(route,method='GET',body,status=200)=>{const response=await nativeFetch(ui.url+route,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const result=await response.json();assert.equal(response.status,status,result.error?.code);return result;};
    const body={rawIds:session.samples.map(s=>s.id),sourceIds:[]};await request('/api/knowledge/syntheses','POST',body,409);assert.equal((await lab.engine.status()).attempt,null);assert.equal(lab.engine.configReads,0);
    const release={released:true,issuedBy:'main',issuedAt:new Date().toISOString(),mode:'fake',sessionId:session.id,sequence:244,maxCalls:1,bindings:await lab.engine.bindings()},releaseFile=path.join(session.root,'fake-release.json');await durable(releaseFile,release);
    await request('/__syn01-verify/arm','POST',{releaseFile,exactSha256:sha(await fs.readFile(releaseFile))});
    assert((await(await nativeFetch(ui.url)).text()).includes('/app/main.tsx'));assert((await(await nativeFetch(ui.url+'/app/main.tsx')).text()).includes('App'));
    report.checks.push('New current-product freeze / fixed244-before243 / old root denied / unarmed0 / matching release / actual App+API');
    const rawBefore=await fileMap(path.join(session.root,'knowledge/raw'));dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:ui.url,pretendToBeVisual:true});const w=dom.window;
    for(const[name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,CustomEvent:w.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true})){globals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
    let createElement,createRoot,App;({act,createElement}=await import('react'));({createRoot}=await import('react-dom/client'));({App}=await import('../../app/App.tsx'));
    globalThis.fetch=(url,init)=>nativeFetch(String(url).startsWith('/api/')?ui.url+url:url,init);
    const buttons=label=>[...w.document.querySelectorAll('button')].filter(x=>x.textContent.trim()===label),wait=async(check,label)=>{const until=Date.now()+8000;while(Date.now()<until){await act(async()=>new Promise(r=>setTimeout(r,20)));if(check())return;}throw Error('App smoke timeout '+label+' '+w.document.body.textContent.slice(-300));},click=async button=>{assert(button&&!button.disabled);await act(async()=>button.click());};
    root=createRoot(w.document.getElementById('root'));await act(async()=>root.render(createElement(App)));await wait(()=>w.document.querySelectorAll('.recent-row').length===2,'home');
    await click([...w.document.querySelectorAll('nav button')].find(x=>x.textContent.includes('Raw 原始资料')));await wait(()=>buttons('多来源综合').length===1,'Raw');await click(buttons('多来源综合')[0]);await wait(()=>w.document.querySelectorAll('.confirm-dialog input').length===2,'chooser');for(const check of w.document.querySelectorAll('.confirm-dialog input'))await click(check);await click(buttons('生成 Synthesis 草稿')[0]);await wait(()=>buttons('确认本页主题与完整归属').length===1,'new candidate');
    const captured=await readJson(path.join(session.root,'request-244.json')),input=JSON.parse(captured.request.user),candidate=await readJson(path.join(session.root,'candidate-original.json'));
    assert.equal(input.synthesis_format_version,1);assert.equal(input.raws.length,2);assert(captured.request.system.includes('必须实际写入输出section的text或字符串正文'));assert(captured.request.system.includes('另一条引用不能替本条补支持'));
    let status=await lab.engine.status();assert.equal(status.attempt.sequence,244);assert.equal(status.result.status,'completed');assert.equal(status.fakeCalls,1);assert.equal(status.knowledgeUsed,243);assert.equal(status.configReads,0);
    await request('/api/knowledge/syntheses','POST',body,409);
    await click(buttons('确认本页主题与完整归属')[0]);await wait(()=>w.document.body.textContent.includes('本页已审查'),'review');await click(buttons('保存草稿')[0]);await wait(()=>!buttons('保存草稿')[0].disabled,'save');
    const saved=await request('/api/knowledge/workflows/'+candidate.id);assert.equal(saved.status,'pending_confirmation');assert.equal(saved.humanReview.approvals.length,1);assert.equal((await request('/api/wiki')).items.length,0);assert(!buttons('确认写入')[0].disabled);
    const exported=await request('/__syn01-verify/export');assert(exported.artifacts.response);assert.equal(exported.artifacts['request-244.json'].sequence,244);assert.deepEqual(await fileMap(path.join(session.root,'knowledge/raw')),rawBefore);
    assert.equal((await freeze()).sha256,session.freezeSha256);report.attempt=status.attempt;report.fakeCalls=1;report.pass=true;
    report.checks.push('Actual App fixed-source generation with current SEM prompt / only fake244 / existing attempt denied / review+save+read/export / confirm enabled / no formal Wiki / Raw unchanged');
    report.reused='RECHECK completed/pending/failed/restart reservation and formal confirm routes: same core/server mechanism apart from prefix+sequence+baseline, not rerun';
  }catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
  finally{if(root)await act(async()=>root.unmount());globalThis.fetch=nativeFetch;await ui?.close();await lab?.close();dom?.window.close();for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];report.finishedAt=new Date().toISOString();report.servicesClosed=true;await durable(file,report);console.log(JSON.stringify({pass:report.pass,realCalls:0,configReads:0,file,error:report.error}));}
  return report;
}
