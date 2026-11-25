import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import react from '@vitejs/plugin-react';
import {build,createServer as vite} from 'vite';

const base=path.resolve('node_modules/.cache/news08-review');
await mkdir(base,{recursive:true});
const run=await mkdtemp(path.join(base,'browser-'));
const envDir=path.join(run,'empty-env');
await mkdir(envDir);
if(process.argv[2]==='build'){
  const tsconfig=path.join(run,'tsconfig.json');
  await writeFile(tsconfig,JSON.stringify({
    extends:path.resolve('tsconfig.json'),
    include:['app/pages/NewsPage.tsx','services/news/service.ts'].map(file=>path.resolve(file)),
    exclude:[],
  }));
  const compiler=spawn(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p',tsconfig,'--pretty','false'],{stdio:'inherit',windowsHide:true});
  const [code]=await once(compiler,'close');
  assert.equal(code,0);
  console.log('NEWS08 product TypeScript check passed.');
  await build({configFile:false,plugins:[react()],envDir,build:{outDir:path.join(run,'dist'),emptyOutDir:false}});
  process.exit(0);
}

const now=new Date();
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(+now-offset*86400000));
const [today,prior,older,legacy,tooOld]=[0,1,2,3,31].map(day);
const at=(date,time)=>new Date(date+'T'+time+':00+08:00').toISOString();
const data=path.join(run,'data');
const state=path.join(data,'state','news');
await mkdir(state,{recursive:true});
const config=path.join(run,'isolated-provider.env');
const blockedOutbound=path.join(run,'blocked-outbound.log');
await writeFile(config,'');
await writeFile(blockedOutbound,'');
const stateFile=date=>path.join(state,date+'.json');
const seed=(date,sections)=>writeFile(stateFile(date),JSON.stringify({
  schemaVersion:1,date,updatedAt:now.toISOString(),sections,
}));
const research=(id,title,fetchedAt,extra={})=>({
  id,title,fetchedAt,url:'https://example.invalid/'+id,publishedAt:day(100),
  sourceName:'独立浏览器隔离来源',sourceId:'worldpanel',evidenceKind:'article_excerpt',
  excerpt:'隔离的原始证据。'+id+'\n\n第二段原文，保留符号与空格  🧪。',
  research:{kind:'官方研究正文摘录，非全文',dataPeriod:null},...extra,
});
const todayA=research('today-z','本期新增快消第一条',at(today,'11:12'));
const todayB=research('today-a','本期新增快消第二条',at(today,'11:12'));
const recentA=research('recent-a','昨天快消可保存',at(prior,'09:26'));
const recentB=research('recent-b','昨天快消第二条',at(prior,'09:27'));
const recentC=research('recent-c','前天快消已保存',at(older,'10:38'));
const recentD=research('recent-d','前天快消第四个候选','invalid-legacy-time');
const oldNews=research('old-news','旧版普通快消新闻',at(legacy,'13:11'));
const oldResearch=research('too-old','31天前的研报',at(tooOld,'13:23'));
const fmcg=(date,status,items,extra={})=>({
  contentVersion:'research-v1',status,items,attempt:1,startedAt:at(date,'08:02'),
  finishedAt:at(date,'08:04'),sources:[],...extra,
});
const aiItem=research('ai-one','隔离的AI原有条目',at(today,'11:12'),{sourceId:'aihot',evidenceKind:'source_summary',research:undefined});
const ai={status:'source_only',attempt:1,startedAt:at(today,'11:12'),finishedAt:at(today,'11:13'),items:[aiItem],sources:[]};
const success=fmcg(today,'source_only',[todayA,todayB],{shortageReasons:['只取得两条可核验新报告。']});
await seed(today,{fmcg:success,ai});
await seed(prior,{fmcg:fmcg(prior,'source_only',[recentA,recentB])});
await seed(older,{fmcg:fmcg(older,'source_only',[recentC,recentD])});
await seed(legacy,{fmcg:fmcg(legacy,'source_only',[oldNews],{contentVersion:undefined})});
await seed(tooOld,{fmcg:fmcg(tooOld,'source_only',[oldResearch])});
const todayBytes=await readFile(stateFile(today),'utf8');

async function port(){
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const number=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return number;
}
const [apiPort,uiPort]=[await port(),await port()];
const apiBase='http://127.0.0.1:'+apiPort;
const uiBase='http://127.0.0.1:'+uiPort;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^NODE_OPTIONS$/i.test(key)));
Object.assign(env,{FMCG_DATA_DIR:data,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config,FMCG_UI_ORIGIN:uiBase,FMCG_NEWS_AI_ENABLED:'false',NEWS08_BLOCKED_OUTBOUND:blockedOutbound});
const guard='data:text/javascript,'+encodeURIComponent(
  "import { appendFileSync } from 'node:fs'; const original=fetch; "+
  "globalThis.fetch=(...args)=>{const url=new URL(args[0] instanceof Request?args[0].url:args[0]); "+
  "if(url.hostname==='127.0.0.1')return original(...args); "+
  "appendFileSync(process.env.NEWS08_BLOCKED_OUTBOUND,url.hostname+'\\n'); throw Error('External fetch blocked in NEWS08 review');};",
);
const apiProcess=spawn(process.execPath,['--import',guard,'--import','tsx','server/index.ts'],{env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});
const apiClosed=once(apiProcess,'close');
let log='',ui,browser;
apiProcess.stdout.on('data',chunk=>{log+=chunk;});
apiProcess.stderr.on('data',chunk=>{log+=chunk;});
const result={run,today,prior,older,requests:[],pageErrors:[],checks:[],closed:{api:false,ui:false,browser:false}};
const requested=Promise.withResolvers(), release=Promise.withResolvers();
const json={'content-type':'application/json'};
const saveRoute=date=>'/api/news/editions/'+date+'/items/save-raw';
const projectionRoute=date=>'/api/news/editions/'+date+'/saved-raws';
async function request(route,method='GET',body){
  const response=await fetch(apiBase+route,body?{method,headers:json,body:JSON.stringify(body)}:{method});
  assert.ok(response.ok,route+' HTTP '+response.status);
  return response.json();
}
try{
  for(let i=0;i<80;i++){
    if(await fetch(apiBase+'/api/health').then(r=>r.ok).catch(()=>false))break;
    if(i===79||apiProcess.exitCode!==null)throw Error('Isolated API did not start: '+log);
    await wait(100);
  }
  const preexisting=await request(saveRoute(older),'POST',{section:'fmcg',itemId:recentC.id});
  assert.equal(preexisting.created,true);
  ui=await vite({configFile:false,plugins:[react()],envDir,cacheDir:path.join(run,'vite-cache'),
    server:{host:'127.0.0.1',port:uiPort,strictPort:true,watch:{ignored:['**/node_modules/**','**/workspace/**','**/docs/**']},proxy:{'/api':apiBase}}});
  await ui.listen();
  const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
  result.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);
  await page.context().route('**/*',route=>route.request().url().startsWith(uiBase+'/')?route.continue():route.abort());
  await page.route('**'+projectionRoute(older),async route=>{
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  page.on('request',req=>{
    if(req.url().startsWith(uiBase+'/api/news/'))result.requests.push(req.method()+' '+new URL(req.url()).pathname);
  });
  page.on('pageerror',error=>result.pageErrors.push(error.message));
  const open=async()=>{
    await page.goto(uiBase);
    await page.getByRole('button',{name:'阅读资讯',exact:true}).click();
    await page.getByRole('heading',{name:'快消研报与洞察',exact:true}).waitFor();
  };
  const fmcgUI=page.locator('section.news-section').filter({has:page.getByRole('heading',{name:'快消研报与洞察',exact:true})});
  const card=(title)=>fmcgUI.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  const titleOrder=()=>fmcgUI.locator('article h3').allTextContents();
  const waitText=pattern=>fmcgUI.getByText(pattern).first().waitFor();
  const dates=page.getByRole('combobox',{name:'阅读日期'});
  await open();
  await waitText(/今日新增\s*2\s*条/);
  await waitText(/近期精选\s*3\s*条/);
  await waitText(/5\s*\/\s*5/);
  assert.deepEqual(await titleOrder(),[todayA.title,todayB.title,recentA.title,recentB.title,recentC.title]);
  assert.match(await fmcgUI.innerText(),/只取得两条可核验新报告/);
  assert.match(await fmcgUI.innerText(),/并非今日发布|不等于今天发布/);
  const recentCardA=card(recentA.title),recentCardC=card(recentC.title);
  assert.match(await recentCardA.locator('..').innerText(),new RegExp('原收录：'+prior));
  assert.match(await recentCardA.locator('..').innerText(),/原抓取：.*09:26/);
  assert.match(await recentCardC.locator('..').innerText(),new RegExp('原收录：'+older));
  assert.match(await recentCardC.locator('..').innerText(),/原抓取：.*10:38/);
  await Promise.race([requested.promise,wait(10000).then(()=>{throw Error('missing older projection request');})]);
  for(const date of [today,prior,older]) assert.equal(result.requests.filter(s=>s==='GET '+projectionRoute(date)).length,1);
  const savedResponse=page.waitForResponse(r=>r.url().endsWith(saveRoute(prior))&&r.request().method()==='POST');
  await recentCardA.getByRole('button',{name:'保存来源摘录到 Raw'}).click();
  const saved=await (await savedResponse).json();
  assert.equal(saved.created,true);
  await recentCardA.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  release.resolve();
  await recentCardC.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  assert.equal(await recentCardA.getByRole('button',{name:'查看 Raw',exact:true}).count(),1);
  assert.equal((await request('/api/raw/'+encodeURIComponent(saved.rawId))).body,recentA.excerpt);
  const replay=await request(saveRoute(prior),'POST',{section:'fmcg',itemId:recentA.id});
  assert.equal(replay.created,false);
  assert.equal(replay.rawId,saved.rawId);
  assert.equal(await readFile(stateFile(today),'utf8'),todayBytes);
  result.checks.push('2+3 ordering and dates, original Raw route/body, delayed B projection, idempotency');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.screenshot({path:path.join(run,'mobile.png'),fullPage:true});
  await dates.selectOption(older);
  await card(recentD.title).waitFor();
  assert.deepEqual(await titleOrder(),[recentC.title,recentD.title]);
  assert.doesNotMatch(await fmcgUI.innerText(),/今日新增|近期精选/);
  await dates.selectOption(legacy);
  await page.getByRole('heading',{name:'旧版快消新闻',exact:true}).waitFor();
  await page.getByRole('heading',{name:oldNews.title,exact:true}).waitFor();
  await dates.selectOption('');
  await recentCardA.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  await open();
  await recentCardA.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  await recentCardC.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  await request('/api/raw/'+encodeURIComponent(saved.rawId),'DELETE',{});
  await open();
  await recentCardA.getByText('原 Raw 已删除',{exact:true}).waitFor();
  result.checks.push('390px, historical selection, refresh, and deleted Raw projection');

  const currentError='隔离的今日快消错误';
  for(const [status,label] of [['empty',/今日暂无新增/],['failed',/今日读取失败/],['running',/今日.*中断/]]){
    await seed(today,{fmcg:fmcg(today,status,[],{error:status==='empty'?undefined:currentError}),ai});
    await open();
    await waitText(label);
    await waitText(/近期精选\s*4\s*条/);
    assert.deepEqual(await titleOrder(),[recentA.title,recentB.title,recentC.title,recentD.title]);
    assert.match(await card(recentD.title).locator('..').innerText(),/原抓取：未记录/);
    assert.equal(await card(oldResearch.title).count(),0);
    if(status!=='empty'){
      assert.doesNotMatch(await fmcgUI.innerText(),/今日暂无新增/);
      assert.match(await fmcgUI.innerText(),/08:02/);
      await fmcgUI.getByRole('button',{name:/重试/}).waitFor();
      await waitText(currentError);
    }
  }
  const view=await request('/api/news/today');
  const overlay=async next=>{
    await page.unroute('**/api/news/today');
    await page.route('**/api/news/today',route=>route.fulfill({json:next}));
    await open();
  };
  await overlay({...view,edition:{...view.edition,sections:{...view.edition.sections,fmcg:fmcg(today,'running',[])}}});
  await waitText(/今日正在准备|新增数量待定/);
  await waitText(/近期精选\s*4\s*条/);
  assert.doesNotMatch(await fmcgUI.innerText(),/今日暂无新增/);
  await overlay({...view,edition:null});
  await waitText(/今日尚未准备/);
  await waitText(/近期精选\s*4\s*条/);
  const {recentFmcg:unused,...legacyResponse}=view;
  await overlay({...legacyResponse,edition:null});
  await waitText(/今日尚未准备/);
  assert.equal((await titleOrder()).length,0);
  assert.equal(await page.getByRole('button',{name:/刷新|重新抓取/}).count(),0);
  result.checks.push('empty, failed, interrupted, active and missing state branches, no old API field');
  const completeWithPartialSource=fmcg(today,'source_only',[todayA,todayB,...['3','4','5'].map(i=>
    research('today-'+i,'本期新增快消第'+i+'条',at(today,'11:12')))],{
    sources:[{name:'隔离不可用来源',status:'failed',checkedAt:at(today,'08:02')}],
    shortageReasons:['隔离不可用来源：来源读取失败。'],
  });
  await overlay({...view,recentFmcg:[],edition:{...view.edition,sections:{...view.edition.sections,fmcg:completeWithPartialSource}}});
  await waitText(/今日新增\s*5\s*条/);
  await waitText(/部分来源不可用，覆盖不完整/);
  assert.equal((await titleOrder()).length,5);
  result.checks.push('source failure notice remains visible when five new items fill the quota');
  assert.deepEqual(result.pageErrors,[]);
  assert.equal(await readFile(blockedOutbound,'utf8'),'');
}finally{
  release.resolve();
  if(browser){await browser.close();result.closed.browser=true;}
  if(ui){await ui.close();result.closed.ui=true;}
  if(apiProcess.exitCode===null&&apiProcess.signalCode===null)apiProcess.kill();
  await apiClosed;
  result.closed.api=true;
  result.apiLog=log;
  await writeFile(path.join(base,'browser-result.json'),JSON.stringify(result,null,2));
}
