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

const base = path.resolve('node_modules/.cache/news07-review');
await mkdir(base,{recursive:true});
const run = await mkdtemp(path.join(base,'browser-'));
const envDir = path.join(run,'empty-env');
await mkdir(envDir);
if (process.argv[2]==='build') {
  const tsconfig = path.join(run,'tsconfig.json');
  await writeFile(tsconfig,JSON.stringify({
    extends:path.resolve('tsconfig.json'),
    include:['app','server','services','vite.config.ts'].map(file=>path.resolve(file)),
    exclude:[],
  }));
  const compiler=spawn(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p',tsconfig,'--pretty','false'],{stdio:'inherit',windowsHide:true});
  const [typecheckCode]=await once(compiler,'close');
  assert.equal(typecheckCode,0);
  console.log('Product TypeScript check passed.');
  await build({configFile:false,plugins:[react()],envDir,build:{outDir:path.join(run,'dist'),emptyOutDir:false}});
  process.exit(0);
}
const now = new Date();
const day = n => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(+now-n*86400000));
const [today,prior,older,legacy,empty] = [0,1,2,3,4].map(day);
const data = path.join(run,'data');
const state = path.join(data,'state','news');
await mkdir(state,{recursive:true});
const config = path.join(run,'isolated-provider.env');
await writeFile(config,'');
const blockedOutbound = path.join(run,'blocked-outbound.log');
await writeFile(blockedOutbound,'');
const result = name => readFile(path.join(base,name+'.json'),'utf8').then(text=>JSON.parse(text).result);
const bounded = (await result('bounded')).edition.sections;
const full = (await result('history')).edition.sections;
const noItems = (await result('empty')).edition.sections;
const timed = (section,d,at) => {
  const time = d+'T'+at+':00+08:00';
  return {
    ...section,startedAt:new Date(time).toISOString(),finishedAt:new Date(+new Date(time)+93000).toISOString(),
    sources:section.sources.map(s=>({...s,checkedAt:new Date(time).toISOString()})),
    items:section.items.map(i=>({...i,fetchedAt:new Date(time).toISOString()})),
  };
};
const seed = (d,sections) => writeFile(path.join(state,d+'.json'),JSON.stringify({
  schemaVersion:1,date:d,updatedAt:now.toISOString(),sections,
}));
const failure = {
  status:'failed',contentVersion:'research-v1',attempt:1,items:[],sources:[],
  error:'隔离验证：今日来源读取失败。',
};
await seed(today,{fmcg:timed(failure,today,'12:17'),ai:timed(bounded.ai,today,'13:11')});
await seed(prior,{fmcg:timed(bounded.fmcg,prior,'09:26')});
await seed(older,{fmcg:timed(full.fmcg,older,'15:38')});
await seed(legacy,{fmcg:{...timed({
  status:'source_only',contentVersion:'research-v1',attempt:1,sources:[],items:[bounded.fmcg.items[0]],
},legacy,'11:45'),startedAt:'invalid-legacy-time'}});
await seed(empty,{fmcg:timed(noItems.fmcg,empty,'14:08')});

async function port() {
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const number=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return number;
}
const [apiPort,uiPort] = [await port(),await port()];
const apiBase='http://127.0.0.1:'+apiPort;
const uiBase='http://127.0.0.1:'+uiPort;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^NODE_OPTIONS$/i.test(key)));
Object.assign(env,{FMCG_DATA_DIR:data,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config,FMCG_UI_ORIGIN:uiBase,FMCG_NEWS_AI_ENABLED:'false',NEWS07_BLOCKED_OUTBOUND:blockedOutbound});
const denyOutbound='data:text/javascript,'+encodeURIComponent(
  "import { appendFileSync } from 'node:fs'; const original = fetch; " +
  "globalThis.fetch = (...args) => { const url = new URL(args[0] instanceof Request ? args[0].url : args[0]); " +
  "if (url.hostname === '127.0.0.1') return original(...args); " +
  "appendFileSync(process.env.NEWS07_BLOCKED_OUTBOUND, url.hostname + '\\n'); throw Error('External fetch blocked in NEWS07 review'); };",
);
const child=spawn(process.execPath,['--import',denyOutbound,'--import','tsx','server/index.ts'],{env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});
const stopped=once(child,'close');
let log='',server,browser;
child.stdout.on('data',chunk=>{log+=chunk;});
child.stderr.on('data',chunk=>{log+=chunk;});
const artifacts = {days:{today,prior,older,legacy,empty},requests:[],pageErrors:[],sections:{},apiLog:'',browserClosed:false,apiClosed:false,uiClosed:false};
try {
  for (let i=0;i<80;i++) {
    if (await fetch(apiBase+'/api/health').then(r=>r.ok).catch(()=>false)) break;
    if (i===79 || child.exitCode!==null) throw Error('Isolated API did not start: '+log);
    await wait(100);
  }
  server=await vite({configFile:false,plugins:[react()],envDir,cacheDir:path.join(run,'vite-cache'),
    server:{host:'127.0.0.1',port:uiPort,strictPort:true,watch:{ignored:['**/node_modules/**','**/workspace/**','**/docs/**']},proxy:{'/api':apiBase}}});
  await server.listen();
  const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser=await chromium.launch({
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--disable-background-networking','--disable-component-update','--no-proxy-server'],
  });
  artifacts.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(12000);
  await page.context().route('**/*',route=>route.request().url().startsWith(uiBase+'/')?route.continue():route.abort());
  page.on('request',request=>{
    if (request.url().startsWith(uiBase+'/api/news/')) artifacts.requests.push(request.method()+' '+new URL(request.url()).pathname);
  });
  page.on('pageerror',e=>artifacts.pageErrors.push(e.message));
  await page.goto(uiBase);
  await page.getByRole('button',{name:'阅读资讯',exact:true}).click();
  const fmcg=page.locator('section.news-section').filter({has:page.getByRole('heading',{name:'快消研报与洞察',exact:true})});
  const ai=page.locator('section.news-section').filter({has:page.getByRole('heading',{name:'AI 前沿',exact:true})});
  const info = locator => locator.locator('p').allTextContents();
  const byCount = (locator,n) => locator.getByText(new RegExp(n+'\\s*/\\s*5')).first();
  const capture = async(name,locator)=>{artifacts.sections[name]=(await info(locator)).filter(s=>!s.startsWith('仅保存'));};
  await fmcg.getByText('隔离验证：今日来源读取失败。').waitFor();
  await byCount(fmcg,3).waitFor();
  await byCount(ai,1).waitFor();
  const fallbackText=await fmcg.innerText();
  assert.match(fallbackText,new RegExp(prior));
  const fallbackTime=await fmcg.getByText(/^内容抓取开始/).textContent();
  const attemptedTime=await fmcg.getByText(/^今日尝试开始/).textContent();
  assert.match(fallbackTime,/09:26/);
  assert.doesNotMatch(fallbackTime,/12:17/);
  assert.match(attemptedTime,/12:17/);
  assert.doesNotMatch(attemptedTime,/09:26/);
  assert.match(fallbackText,/预算|上限/);
  assert.match(fallbackText,/正文|读取|提取/);
  assert.equal(await fmcg.locator('article').count(),3);
  assert.equal(await ai.locator('article').count(),1);
  assert.match(await ai.innerText(),/13:11/);
  assert.match(await ai.innerText(),/分析/);
  assert.equal(await fmcg.getByRole('button',{name:/重试/}).count(),1);
  assert.equal(await page.getByRole('button',{name:/刷新|重新抓取/}).count(),0);
  await capture('fallback',fmcg);
  await capture('analysisShort',ai);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.screenshot({path:path.join(run,'fallback-390.png'),fullPage:true});
  const dates=page.getByRole('combobox',{name:'阅读日期'});
  await dates.selectOption(older);
  await byCount(fmcg,5).waitFor();
  assert.equal(await fmcg.locator('article').count(),5);
  assert.match(await fmcg.innerText(),/15:38/);
  assert.doesNotMatch(await fmcg.innerText(),/不足原因|未达到/);
  await capture('fullHistory',fmcg);
  await dates.selectOption(legacy);
  await byCount(fmcg,1).waitFor();
  assert.match(await fmcg.innerText(),/旧记录未记录具体不足原因/);
  assert.match(await fmcg.innerText(),/内容抓取开始：未记录/);
  assert.match(await fmcg.innerText(),/11:46/);
  await capture('legacyCache',fmcg);
  await dates.selectOption(empty);
  await byCount(fmcg,0).waitFor();
  assert.equal(await fmcg.locator('article').count(),0);
  assert.match(await fmcg.innerText(),/暂无新的可核验研报/);
  assert.match(await fmcg.innerText(),/14:08/);
  await capture('emptyHistory',fmcg);

  const running=timed({...failure,status:'running',error:undefined},today,'16:51');
  delete running.finishedAt;
  await page.route('**/api/news/today',route=>route.fulfill({json:{
    date:today,aiEnabled:false,edition:{schemaVersion:1,date:today,updatedAt:now.toISOString(),sections:{fmcg:running}},fallbacks:{},
  }}));
  await page.reload();
  await page.getByRole('button',{name:'阅读资讯',exact:true}).click();
  await fmcg.getByText(/正在准备|正在抓取/).first().waitFor();
  assert.doesNotMatch(await fmcg.innerText(),/不足原因|未达到|暂无新的可核验/);
  await capture('running',fmcg);
  assert.deepEqual(artifacts.pageErrors,[]);
  assert.equal(artifacts.requests.filter(s=>s.includes('/retry')).length,0);
  assert.equal(await readFile(blockedOutbound,'utf8'),'');
} finally {
  if (browser) {await browser.close();artifacts.browserClosed=true;}
  if (server) {await server.close();artifacts.uiClosed=true;}
  if (child.exitCode===null && child.signalCode===null) child.kill();
  await stopped;
  artifacts.apiClosed=true;
  artifacts.apiLog=log;
  await writeFile(path.join(base,'browser-result.json'),JSON.stringify(artifacts,null,2));
}
