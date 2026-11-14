import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import express from 'express';
import {build} from 'vite';
import {AssetStore} from '../../services/raw/assets.ts';
import {PdfPageService} from '../../services/raw/pdf-pages.ts';
import {PdfCleanupService} from '../../services/raw/pdf-cleanup.ts';
import {importRawFile} from '../../server/raw-import.ts';
import {lwFixture} from '../lw01-fixture.ts';
import {synthesisFixture} from './pdf02-synthesis-fixture.ts';

const out=path.resolve(process.argv[2]??'docs/reports/RAWEDIT01-20261114-builder-evidence');
await mkdir(out,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'rawedit01-'));
const envDir=path.join(root,'empty-vite-env');
await mkdir(envDir);
const config=path.join(root,'empty-provider.env');
await writeFile(config,'');
const dist=path.join(root,'dist');
const data=path.join(root,'data');
const report={success:false,root,envDir,config,steps:[],screenshots:[],pageErrors:[],external:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(read,condition)=>{
  for(let i=0;i<150;i++){
    const current=await read();
    if(condition(current))return current;
    await delay(100);
  }
  assert.fail('Timed out waiting for isolated state');
};
async function listen(server){
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const {port}=server.address();
  assert(![5151,5173].includes(port));
  return port;
}
async function close(server){
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

const f=await lwFixture(data);
const assets=new AssetStore(data);
await assets.initialize();
const bytes=synthesisFixture.pdf();
const imported=await importRawFile({store:f.rawStore,assets,bytes,fileName:'RAWEDIT PDF 样本.pdf',metadata:{sourceType:'report'}});
const rawPdf=imported.raw;
const pdfCalls=[];
let generating=true;
const provider={name:'fake',model:'rawedit01-fixture',async complete(request){
  assert(generating,'A draft edit must never call the fake provider');
  const input=JSON.parse(request.user);
  pdfCalls.push(input.stage);
  let result;
  if(input.stage==='pdf_page_understanding'){
    result={blank:false,content:synthesisFixture.outputs[input.page-1],visuals:'',inference:'',questions:[]};
  }else if(input.stage==='pdf_cleanup'){
    result={decisions:Object.fromEntries(input.units.map(unit=>[unit.id,{decision:'keep',reason:'测试保留来源',topic:synthesisFixture.classify(unit.text)}]))};
  }else if(input.stage==='pdf_topic_index'){
    result={assignments:Object.fromEntries(input.topics.map(topic=>[topic,topic]))};
  }else if(input.stage==='pdf_topic_write'){
    result={topics:synthesisFixture.writeTopics(input.topics)};
  }else assert.fail(input.stage);
  const text=JSON.stringify(result);
  return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};
}};
const pdf=new PdfPageService({root:data,raws:f.rawStore,assets,provider:async()=>provider});
const cleanup=new PdfCleanupService({root:data,pdf,raws:f.rawStore,drafts:f.drafts,wiki:f.wiki,rawStates:f.rawStates,provider:async()=>provider});
await pdf.start(rawPdf.id);
await wait(()=>pdf.get(rawPdf.id),v=>v.job?.status==='completed'||v.job?.status==='failed').then(v=>assert.equal(v.job.status,'completed',JSON.stringify(v.job)));
const range={startPage:1,endPage:3};
await cleanup.start(rawPdf.id,range);
await wait(()=>cleanup.get(rawPdf.id),v=>v.job?.status==='completed'||v.job?.status==='failed').then(v=>assert.equal(v.job.status,'completed',JSON.stringify(v.job)));
const pdfDraft=await f.drafts.get((await cleanup.draft(rawPdf.id,range)).job.draftId);
assert(pdfDraft?.maintenance.changes.length>=2);

const rawStandard=await f.rawStore.create({title:'RAWEDIT 标准样本',sourceType:'report',sourceName:'合成 fixture',tags:[],body:'门店覆盖12家。\n回访周期7天。'});
const rawDeep=await f.rawStore.create({title:'RAWEDIT 深度样本',sourceType:'report',sourceName:'合成 fixture',tags:[],body:'配送门店覆盖14家。\n回访周期8天。'});
const create=f.drafts.create.bind(f.drafts);
f.drafts.create=({maintenance:_maintenance,...input},deep)=>create(input,deep);
f.setTopics(['测试标准覆盖','测试标准回访']);
const standard=await f.generate(rawStandard.id);
assert(!standard.maintenance);
f.drafts.create=create;
f.setTopics(['测试深度覆盖','测试深度回访']);
const deep=await f.generate(rawDeep.id,'deep');
assert(deep.structuredNote&&deep.maintenance);
const deepReviewed=await f.accept(deep);
assert(deepReviewed.noteApproval);
generating=false;
report.fixtureCalls={pdf:pdfCalls.length,raw:f.requests.length};

let child,frontend,browser;
try {
  await build({configFile:false,root:process.cwd(),envDir,plugins:[react()],build:{outDir:dist,emptyOutDir:true}});
  const reservation=http.createServer();
  const apiPort=await listen(reservation);
  await close(reservation);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(FMCG_|OPENAI_|ANTHROPIC_|GEMINI_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{
    cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...env,FMCG_DATA_DIR:data,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config},
  });
  const apiOrigin=`http://127.0.0.1:${apiPort}`;
  let apiLog='';
  child.stdout.on('data',chunk=>apiLog+=chunk);
  child.stderr.on('data',chunk=>apiLog+=chunk);
  await wait(()=>fetch(apiOrigin+'/api/health').catch(()=>null),response=>response?.ok);
  const app=express();
  app.use('/api/news',(_req,res)=>res.sendStatus(503));
  app.use('/api',(req,res)=>{
    const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:req.originalUrl,method:req.method,headers:{...req.headers,host:`127.0.0.1:${apiPort}`}},response=>{
      res.writeHead(response.statusCode??502,response.headers);
      response.pipe(res);
    });
    upstream.on('error',()=>res.destroy());
    req.pipe(upstream);
  });
  app.use(express.static(dist));
  frontend=http.createServer(app);
  const url=`http://127.0.0.1:${await listen(frontend)}`;
  report.services={harnessPid:process.pid,apiPid:child.pid,url,apiOrigin};
  const api=async(route,options,expected=200)=>{
    const response=await fetch(apiOrigin+route,options);
    const value=await response.json();
    assert.equal(response.status,expected,`${route}: ${JSON.stringify(value)}`);
    return value;
  };
  const json=(route,body,method,expected)=>api(route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},expected);
  const wiki=()=>api('/api/wiki');
  const draftRoute=id=>`/api/drafts/${id}`;
  const configSummary=await api('/api/llm/config');
  assert.equal(configSummary.keyConfigured,false);
  assert.equal(configSummary.configured,false);
  assert.equal(configSummary.baseUrl,'');
  report.providerConfigured=false;
  const originalRaws=await Promise.all([rawPdf,rawStandard,rawDeep].map(raw=>api(`/api/raw/${raw.id}`)));
  const pdfDirectory=path.join(data,'state','raw-pdf',rawPdf.id);
  const pdfFiles=async()=>Object.fromEntries(await Promise.all((await readdir(pdfDirectory,{withFileTypes:true})).filter(entry=>entry.isFile()).map(async entry=>[entry.name,sha(await readFile(path.join(pdfDirectory,entry.name)))])));
  const initialPdfFiles=await pdfFiles();

  const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const executablePath=[path.join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),path.join(process.env.ProgramFiles??'C:/Program Files','Google/Chrome/Application/chrome.exe')].find(existsSync);
  assert(executablePath,'Chrome installation required for full-App verification');
  browser=await chromium.launch({executablePath,args:['--no-proxy-server'],headless:true});
  const page=await browser.newPage({viewport:{width:1536,height:1050}});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.route('**/*',route=>{
    const target=new URL(route.request().url());
    if(/^https?:$/.test(target.protocol)&&target.origin!==url){report.external.push(target.origin);return route.abort();}
    return route.continue();
  });
  const mutations=[];
  page.on('request',req=>{
    const target=new URL(req.url());
    if(['PATCH','POST'].includes(req.method())&&target.pathname.startsWith('/api/')&&!target.pathname.startsWith('/api/news'))mutations.push([req.method(),target.pathname]);
  });
  const button=(name,where=page)=>where.getByRole('button',{name,exact:typeof name==='string'});
  const card=title=>page.getByRole('article',{name:`成果 ${title}`,exact:true});
  const select=(title,where=page)=>where.getByRole('checkbox',{name:`选择入库 ${title}`,exact:true});
  const edit=where=>button('编辑主题成果',where).click();
  const confirm=()=>page.getByRole('region',{name:'整体确认入库'}).locator('button.primary-button');
  const editSection=()=>page.getByRole('group',{name:'编辑成果'});
  const save=()=>button('保存成果编辑').click();
  const screenshot=async(name,target)=>{
    await target.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,name+'.png')});
    report.screenshots.push(name+'.png');
  };
  const open=async raw=>{
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('.home-actions').getByRole('article',{name:raw.title,exact:true}).getByRole('button',{name:'继续审核',exact:true}).click();
    await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  };
  const record=step=>{report.steps.push(step);console.log(step);};
  const noWiki=async()=>assert.deepEqual((await wiki()).items,[]);

  // PDF topic editor is available before expanding the long full preview.
  await open(rawPdf);
  const pdfBefore=await api(draftRoute(pdfDraft.id));
  const [first,second]=pdfBefore.maintenance.changes;
  const originalTitle=first.candidate.title;
  const pdfTitle='人工修订 PDF 样本覆盖';
  const pdfBody=first.candidate.body+'\n\n## 人工口径\n\n**仅限本样本。**\n\n'+Array.from({length:20},(_,i)=>`第 ${i+1} 条复核记录。`).join('\n\n');
  await select(originalTitle).check();
  await select(second.candidate.title).check();
  await edit(card(originalTitle));
  await editSection().getByLabel('成果标题').fill('临时取消内容');
  assert(await button('返回').isDisabled()&&await button('查看原始资料').isDisabled()&&await confirm().isDisabled());
  await button('取消编辑').click();
  assert(await select(originalTitle).isChecked()&&await select(second.candidate.title).isChecked());
  assert.equal((await api(draftRoute(pdfDraft.id))).revision,pdfBefore.revision);
  await edit(card(originalTitle));
  await editSection().getByLabel('成果标题').fill(pdfTitle);
  await editSection().getByLabel('成果正文').fill(pdfBody);
  await screenshot('01-pdf-editor',editSection());
  const readRoute='**'+draftRoute(pdfDraft.id);
  await page.route(readRoute,route=>route.fulfill({status:503,json:{error:{code:'FIXTURE_READ',message:'模拟读取失败'}}}),{times:1});
  await save();
  await page.getByRole('alert').filter({hasText:'草稿已保存，暂时无法读取最新内容'}).waitFor();
  assert.equal(await editSection().getByLabel('成果正文').inputValue(),pdfBody);
  assert(await confirm().isDisabled());
  assert.equal(await button('取消编辑').count(),0);
  const written=await api(draftRoute(pdfDraft.id));
  assert.equal(written.revision,pdfBefore.revision+1);
  assert.equal(written.maintenance.changes[0].candidate.body,pdfBody);
  await noWiki();
  await screenshot('02-pdf-readback-retry',editSection());
  const afterPost=mutations.length;
  await button('重新读取已保存草稿').click();
  await card(pdfTitle).waitFor();
  assert.equal(mutations.length,afterPost);
  assert(!(await select(pdfTitle).isChecked())&&await select(second.candidate.title).isChecked());
  await open(rawPdf);
  await card(pdfTitle).getByText(/阅读完整主题成果/).click();
  await card(pdfTitle).getByRole('heading',{name:'人工口径'}).waitFor();
  await card(pdfTitle).getByText(/PDF 原页依据/).click();
  const evidenceLink=card(pdfTitle).getByRole('link',{name:/打开原 PDF 第/}).first();
  const href=await evidenceLink.getAttribute('href');
  assert.match(href,/\/pdf\/original#page=\d+$/u);
  const popup=page.waitForEvent('popup');
  await evidenceLink.click();
  const pdfPage=await popup;
  await pdfPage.waitForURL(url+href);
  await pdfPage.close();
  assert.deepEqual(written.pages.map(p=>p.pdfEvidence),pdfBefore.pages.map(p=>p.pdfEvidence));
  assert.deepEqual(written.pdfInput,pdfBefore.pdfInput);
  const intent={baseRevision:written.revision,selectedPageIds:[pdfBefore.pages[first.pageIndex].pageId],outcomeDigest:pdfBefore.outcomeDigest,idempotencyKey:randomUUID()};
  assert.equal((await json(draftRoute(pdfDraft.id)+'/confirm',intent,'POST',409)).error.code,'REVIEW_CONTENT_CHANGED');
  await noWiki();
  record('PDF: cancel, navigation lock, multiline persistence, readback 503 then GET, original-page link and stale digest 409');

  // Legacy standard title, explanation, organized text and independent Source draft.
  await open(rawStandard);
  const standardBefore=await api(draftRoute(standard.id));
  const standardOld=standardBefore.pages[0].title;
  const standardTitle='人工修订标准主题';
  await select(standardOld).check();
  await edit(card(standardOld));
  await editSection().getByLabel('成果标题').fill(standardTitle);
  await editSection().getByLabel('一句话说明').fill('人工标准说明');
  await editSection().getByLabel('整理内容（每行一项）').fill('人工标准段落一\n人工标准段落二');
  await page.route('**'+draftRoute(standard.id),route=>route.fulfill({status:503,json:{error:{message:'模拟保存暂不可用'}}}),{times:1});
  await save();
  await editSection().getByRole('alert').filter({hasText:'模拟保存暂不可用'}).waitFor();
  assert.equal(await editSection().getByLabel('成果标题').inputValue(),standardTitle);
  assert.equal((await api(draftRoute(standard.id))).revision,standardBefore.revision);
  await save();
  await card(standardTitle).waitFor();
  assert(!(await select(standardTitle).isChecked()));
  let standardSaved=await api(draftRoute(standard.id));
  assert.deepEqual(standardSaved.pages[0].source_facts,standardBefore.pages[0].source_facts);
  assert.deepEqual(standardSaved.pages[0].source_evidence,standardBefore.pages[0].source_evidence);
  assert.deepEqual(standardSaved.pages[0].ai_organized,['人工标准段落一','人工标准段落二']);
  assert.equal(standardSaved.pages[0].one_line_definition,'人工标准说明');
  await open(rawStandard);
  await card(standardTitle).waitFor();
  await select(standardTitle).check();
  await select(standardSaved.pages[1].title).check();
  await button('编辑来源笔记').click();
  await editSection().getByLabel('成果标题').fill('人工来源笔记标题');
  await editSection().getByLabel('成果正文').fill('人工来源笔记正文。');
  await save();
  await page.getByText('人工来源笔记标题',{exact:true}).waitFor();
  assert(!(await select(standardTitle).isChecked())&&!(await select(standardSaved.pages[1].title).isChecked()));
  await open(rawStandard);
  standardSaved=await api(draftRoute(standard.id));
  assert.equal(standardSaved.source.body,'人工来源笔记正文。');
  assert.equal(standardSaved.source.title,'人工来源笔记标题');
  await card(standardTitle).getByText(/阅读完整主题成果/).click();
  await card(standardTitle).getByText('原文引用与位置',{exact:true}).click();
  await button(/打开原句/,card(standardTitle)).first().click();
  const located=standardBefore.pages[0].source_evidence[0];
  await page.locator('mark').filter({hasText:located.quote}).first().waitFor();
  await noWiki();
  record('Standard: actual 503, input retained, retry saved title/explanation/organized text; Source clears both choices; original quote opens');

  // Structured deep note cancellation, real validation, stale version, and save.
  await open(rawDeep);
  const deepTitle='人工修订深度主题';
  const deepTopicBefore=await api(draftRoute(deep.id));
  const deepOld=deepTopicBefore.maintenance.changes[0].candidate;
  const deepBody=deepOld.body+'\n\n## 人工深度口径\n\n保留独立的统计方法。';
  await select(deepOld.title).check();
  await edit(card(deepOld.title));
  await editSection().getByLabel('成果标题').fill(deepTitle);
  await editSection().getByLabel('成果正文').fill(deepBody);
  await save();
  await card(deepTitle).waitFor();
  assert(!(await select(deepTitle).isChecked()));
  const deepBefore=await api(draftRoute(deep.id));
  assert.equal(deepBefore.maintenance.changes[0].candidate.body,deepBody);
  assert(!deepBefore.maintenance.changes[0].approval);
  const deepTopics=deepBefore.maintenance.changes.map(c=>c.candidate.title);
  for(const title of deepTopics)await select(title).check();
  await page.getByText('查看或编辑深度笔记',{exact:true}).click();
  const note=page.getByRole('region',{name:'深度结构化笔记'});
  const orientation=note.getByLabel('知识定位');
  await button('编辑笔记',note).click();
  await orientation.fill('未保存深度定位');
  await button('添加人工问题',note).click();
  await note.getByLabel('人工问题（无原文证据）').fill('未保存问题');
  assert(await confirm().isDisabled()&&await button('查看原始资料').isDisabled());
  await button('取消笔记编辑',note).click();
  await note.getByText(`知识定位：${deepBefore.structuredNote.orientation}`,{exact:true}).waitFor();
  for(const title of deepTopics)assert(await select(title).isChecked());
  assert.equal((await api(draftRoute(deep.id))).revision,deepBefore.revision);
  await button('编辑笔记',note).click();
  await orientation.fill('');
  await button('保存笔记',note).click();
  await note.getByRole('alert').filter({hasText:'笔记结构、角色或事实引用无效'}).waitFor();
  assert.equal(await orientation.inputValue(),'');
  const noteEdit='人工复核深度定位，保留原始统计口径。';
  await orientation.fill(noteEdit);
  const concurrent=await json(draftRoute(deep.id)+'/structured-note',{baseRevision:deepBefore.revision,structuredNote:{...deepBefore.structuredNote,orientation:'并发独立修订'},exclusions:[],questionIds:[],humanQuestions:[]},'PATCH',200);
  await button('保存笔记',note).click();
  await note.getByRole('alert').filter({hasText:'草稿已变化'}).waitFor();
  assert.equal(await orientation.inputValue(),noteEdit);
  assert.equal((await api(draftRoute(deep.id))).revision,concurrent.revision);
  await screenshot('03-deep-stale-input-retained',note.getByRole('alert'));
  await button('取消笔记编辑',note).click();
  await open(rawDeep);
  for(const title of deepTopics)await select(title).check();
  await page.getByText('查看或编辑深度笔记',{exact:true}).click();
  await button('编辑笔记',note).click();
  assert.equal(await orientation.inputValue(),'并发独立修订');
  await orientation.fill(noteEdit);
  await button('保存笔记',note).click();
  await note.getByText(`知识定位：${noteEdit}`,{exact:true}).waitFor();
  for(const title of deepTopics)assert(!(await select(title).isChecked()));
  const deepSaved=await api(draftRoute(deep.id));
  assert.equal(deepSaved.structuredNote.orientation,noteEdit);
  assert(!deepSaved.noteApproval);
  assert.deepEqual(deepSaved.humanReview.units,deepBefore.humanReview.units);
  await open(rawDeep);
  await page.getByText('查看或编辑深度笔记',{exact:true}).click();
  await note.getByText(`知识定位：${noteEdit}`,{exact:true}).waitFor();
  await noWiki();
  record('Deep: cancel with no write, real validation and 409 preserve input, reopen latest and save clears all choices and old approval');

  const formalIds=[];
  const commit=async(raw,draft,title,body)=>{
    await open(raw);
    await select(title).check();
    const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===draftRoute(draft.id)+'/confirm');
    await confirm().click();
    const confirmed=await response;
    const result=await confirmed.json();
    assert(confirmed.ok(),JSON.stringify(result));
    await page.getByRole('region',{name:'已入库成果',exact:true}).waitFor();
    assert.equal(await button('编辑主题成果',card(title)).count(),0);
    assert.equal(result.wikiIds.length,1);
    const topic=await api(`/api/wiki/${result.wikiIds[0]}`);
    assert.equal(topic.title,title);
    assert(topic.body.includes(body));
    assert.deepEqual(topic.sources,[raw.id]);
    formalIds.push(result.sourceId,...result.wikiIds);
    return api(`/api/wiki/${result.sourceId}`);
  };
  await commit(rawPdf,pdfDraft,pdfTitle,pdfBody);
  await screenshot('04-pdf-explicit-confirm',page.getByRole('region',{name:'已入库成果',exact:true}));
  const sourceStandard=await commit(rawStandard,standard,standardTitle,'人工标准段落二');
  assert.equal(sourceStandard.title,'人工来源笔记标题');
  assert.match(sourceStandard.body,/人工来源笔记正文。/);
  const sourceDeep=await commit(rawDeep,deep,deepTitle,deepBody);
  assert(sourceDeep.body.includes(noteEdit));
  assert.deepEqual((await wiki()).items.map(item=>item.id).sort(),formalIds.sort());
  const original=Buffer.from(await (await fetch(apiOrigin+`/api/raw/${rawPdf.id}/pdf/original`)).arrayBuffer());
  assert.deepEqual(original,bytes);
  assert.deepEqual(await pdfFiles(),initialPdfFiles);
  assert.deepEqual(await Promise.all([rawPdf,rawStandard,rawDeep].map(raw=>api(`/api/raw/${raw.id}`))),originalRaws);
  report.originalPdfSha=sha(original);
  report.formalWikiIds=formalIds;
  assert.deepEqual({pdf:pdfCalls.length,raw:f.requests.length},report.fixtureCalls);
  assert.deepEqual(report.external,[]);
  assert.deepEqual(report.pageErrors,[]);
  record('Explicit confirm: latest PDF, standard and deep edits committed; raw records, original bytes, PDF evidence directory and provider counts unchanged');
  report.browserMutations=mutations;
  report.apiLog=apiLog;
  report.success=true;
} catch(error) {
  report.error=error.stack;
  if(browser){const [page]=browser.contexts()[0].pages();await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
  throw error;
} finally {
  if(browser)await browser.close();
  if(frontend)await close(frontend);
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
  report.cleanup={browserClosed:true,frontendClosed:!frontend?.listening,apiExited:!child||child.exitCode!==null||child.signalCode!==null};
  await writeFile(path.join(out,'browser-result.json'),JSON.stringify(report,null,2));
}
