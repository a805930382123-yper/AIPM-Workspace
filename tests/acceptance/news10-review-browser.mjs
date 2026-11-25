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
import {build,preview} from 'vite';

const base=path.resolve('node_modules/.cache/news10-review');
await mkdir(base,{recursive:true});
const run=await mkdtemp(path.join(base,'browser-'));
const envDir=path.join(run,'empty-env');
await mkdir(envDir);
if(process.argv[2]==='build'){
  const config=path.join(run,'tsconfig.json');
  await writeFile(config,JSON.stringify({
    extends:path.resolve('tsconfig.json'),
    include:['app/pages/NewsPage.tsx','services/news/service.ts'].map(file=>path.resolve(file)),
    exclude:[],
  }));
  const child=spawn(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p',config,'--pretty','false'],{stdio:'inherit',windowsHide:true});
  assert.equal((await once(child,'close'))[0],0);
  console.log('NEWS10 TypeScript passed.');
  await build({configFile:false,plugins:[react()],envDir,build:{outDir:path.join(run,'dist'),emptyOutDir:false}});
  process.exit(0);
}
const now=new Date();
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(+now-offset*86400000));
const [today,prior,published]=[0,1,8].map(day);
const data=path.join(run,'data'), news=path.join(data,'state','news');
await mkdir(news,{recursive:true});
const config=path.join(run,'isolated-provider.env'), blocked=path.join(run,'blocked.log');
await writeFile(config,'');
await writeFile(blocked,'');
const item=(id,sourceId,sourceName,title,research,extra={})=>({
  id,sourceId,sourceName,title,publishedAt:published,fetchedAt:new Date(prior+'T09:26:00+08:00').toISOString(),
  url:'https://example.invalid/'+id,excerpt:'合成研究正文 '+id+'。\n\n'+('消费者调研显示购买方式和渠道偏好有所变化。保留出处、限定和标点。'.repeat(15)),
  evidenceKind:'article_excerpt',research,...extra,
});
const kpmg=item('report','kpmg','KPMG','中国食品饮料章节示例',{
  kind:'行业研究报告PDF摘录，含机构分析及引用数据',dataPeriod:'2026年上半年',
  pdfUrl:'https://example.invalid/research.pdf',pageRange:'第 63 页',
},{publishedAt:published.slice(0,7)});
const mintel=item('public','mintel','Mintel','公开零售洞察示例',{
  kind:'公开洞察正文',dataPeriod:null,
});
const summary=item('summary','mintel','Mintel','公开调查摘要示例',{
  kind:'公开报告摘要，未取得报告全文',dataPeriod:'调查时间：2026年7月至8月',
});
const aiItem=item('ai','aihot','AIHOT','隔离的原AI条目',undefined,{evidenceKind:'source_summary'});
const section=(items,extra={})=>({
  contentVersion:'research-v1',status:'source_only',attempt:1,startedAt:now.toISOString(),finishedAt:now.toISOString(),items,sources:[],...extra,
});
const file=date=>path.join(news,date+'.json');
const seed=(date,sections)=>writeFile(file(date),JSON.stringify({schemaVersion:1,date,updatedAt:now.toISOString(),sections}));
await seed(today,{fmcg:section([mintel]),ai:section([aiItem],{contentVersion:undefined})});
await seed(prior,{fmcg:section([kpmg,summary])});
const initial=[await readFile(file(today),'utf8'),await readFile(file(prior),'utf8')];

async function port(){
  const listener=createServer().listen(0,'127.0.0.1');
  await once(listener,'listening');
  const result=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return result;
}
const [apiPort,uiPort]=[await port(),await port()];
const apiBase='http://127.0.0.1:'+apiPort, uiBase='http://127.0.0.1:'+uiPort;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^NODE_OPTIONS$/i.test(key)));
Object.assign(env,{FMCG_DATA_DIR:data,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config,FMCG_UI_ORIGIN:uiBase,FMCG_NEWS_AI_ENABLED:'false',NEWS10_BLOCKED:blocked});
const guard='data:text/javascript,'+encodeURIComponent(
  "import { appendFileSync } from 'node:fs'; const original=fetch; "+
  "globalThis.fetch=(...args)=>{const url=new URL(args[0] instanceof Request?args[0].url:args[0]); "+
  "if(url.hostname==='127.0.0.1')return original(...args); "+
  "appendFileSync(process.env.NEWS10_BLOCKED,url.hostname+'\\n'); throw Error('External fetch blocked in NEWS10 review');};",
);
const child=spawn(process.execPath,['--import',guard,'--import','tsx','server/index.ts'],{env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});
const exited=once(child,'close');
let log='',ui,browser;
child.stdout.on('data',chunk=>{log+=chunk;});
child.stderr.on('data',chunk=>{log+=chunk;});
const observed={run,today,prior,pageErrors:[],closed:{api:false,ui:false,browser:false}};
try{
  for(let i=0;i<80;i++){
    if(await fetch(apiBase+'/api/health').then(r=>r.ok).catch(()=>false))break;
    if(i===79||child.exitCode!==null)throw Error('Isolated API did not start: '+log);
    await wait(100);
  }
  const outDir=path.join(run,'dist');
  await build({configFile:false,plugins:[react()],envDir,build:{outDir,emptyOutDir:false}});
  ui=await preview({configFile:false,envDir,build:{outDir},
    preview:{host:'127.0.0.1',port:uiPort,strictPort:true,proxy:{'/api':apiBase}}});
  const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
  observed.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);
  await page.context().route('**/*',route=>route.request().url().startsWith(uiBase+'/')?route.continue():route.abort());
  page.on('pageerror',error=>observed.pageErrors.push(error.message));
  const openNews=async()=>{
    await page.goto(uiBase,{waitUntil:'domcontentloaded',timeout:30000});
    await page.getByRole('button',{name:'阅读资讯',exact:true}).click();
  };
  await openNews();
  const fmcg=page.locator('section.news-section').filter({has:page.getByRole('heading',{name:'快消研报与洞察',exact:true})});
  const card=title=>fmcg.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await fmcg.getByText(/今日新增\s*1\s*条/).first().waitFor();
  await fmcg.getByText(/近期精选\s*2\s*条/).first().waitFor();
  assert.deepEqual(await fmcg.locator('article h3').allTextContents(),[mintel.title,kpmg.title,summary.title]);
  for(const material of [mintel,kpmg,summary]){
    const current=card(material.title);
    const metadata=await current.locator('p.news-meta').first().textContent();
    assert.ok(metadata.includes(material.publishedAt));
    assert.ok(metadata.includes(material.research.kind));
    assert.ok(metadata.includes(material.research.dataPeriod??'请以原文为准'));
    await current.locator('details summary').click();
    assert.equal(await current.locator('details[open] p').textContent(),material.excerpt);
  }
  const report=card(kpmg.title);
  assert.match(await report.locator('..').innerText(),new RegExp('原收录：'+prior));
  assert.match(await report.locator('..').innerText(),/原抓取：.*09:26/);
  assert.ok((await report.innerText()).includes(kpmg.publishedAt+'（仅知月份）'));
  assert.equal(await report.getByRole('link',{name:'报告 PDF'}).getAttribute('href'),kpmg.research.pdfUrl);
  assert.match(await report.innerText(),/第 63 页/);
  await page.getByRole('heading',{name:aiItem.title,exact:true}).waitFor();
  const savePath='/api/news/editions/'+prior+'/items/save-raw';
  const savedResponse=page.waitForResponse(response=>response.url().endsWith(savePath)&&response.request().method()==='POST');
  await report.getByRole('button',{name:'保存来源摘录到 Raw'}).click();
  const saved=await (await savedResponse).json();
  assert.equal(saved.created,true);
  await report.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  const raw=await (await fetch(apiBase+'/api/raw/'+encodeURIComponent(saved.rawId))).json();
  assert.equal(raw.body,kpmg.excerpt);
  assert.equal(raw.publishedAt,kpmg.publishedAt);
  assert.ok(raw.extractionNote.includes(kpmg.research.pdfUrl));
  assert.ok(raw.extractionNote.includes(kpmg.research.dataPeriod));
  assert.ok(raw.extractionNote.includes('第 63 页'));
  const repeat=await fetch(apiBase+savePath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({section:'fmcg',itemId:kpmg.id})}).then(response=>response.json());
  assert.equal(repeat.created,false);
  assert.equal(repeat.rawId,saved.rawId);
  assert.deepEqual([await readFile(file(today),'utf8'),await readFile(file(prior),'utf8')],initial);
  await page.setViewportSize({width:390,height:844});
  await openNews();
  await report.getByRole('button',{name:'查看 Raw',exact:true}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.screenshot({path:path.join(run,'mobile.png'),fullPage:true});
  assert.deepEqual(observed.pageErrors,[]);
  assert.equal(await readFile(blocked,'utf8'),'');
  observed.checks=['both new source labels and publication precision','raw excerpts expand unchanged','original-period PDF Raw save and idempotency','390px and preserved saved state'];
}finally{
  if(browser){await browser.close();observed.closed.browser=true;}
  if(ui){await ui.close();observed.closed.ui=true;}
  if(child.exitCode===null&&child.signalCode===null)child.kill();
  await exited;
  observed.closed.api=true;
  observed.apiLog=log;
  await writeFile(path.join(base,'browser-result.json'),JSON.stringify(observed,null,2));
}
