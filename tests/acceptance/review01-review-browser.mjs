import assert from 'node:assert/strict';
import {readFile,writeFile,cp,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {createWeeklyFixture,formalHashes} from './review01-review-fixture.mjs';
import {startWeeklyService} from './review01-review-service.mjs';

const f=await createWeeklyFixture();
console.log('Evidence',f.run);
const server=await startWeeklyService(f,'fake',path.resolve('tests/acceptance/review01-review-guard.mjs'));
const result={errors:[],expectedConflicts:[],screens:[],widths:[]};
let browser,site;
try{
 const before=await formalHashes(f.data);
 const job=await server.run();assert.equal(job.status,'succeeded');const url='/api/automation/weekly-reviews/'+f.weekKey;
 let saved=await server.json(url);assert.equal(saved.aiStatus,'ready');
 const outDir=path.join(f.run,'dist');
 await build({configFile:false,plugins:[react()],envDir:f.envDir,build:{outDir}});
 site=await preview({configFile:false,envDir:f.envDir,build:{outDir},preview:{host:'127.0.0.1',port:server.uiPort,strictPort:true,proxy:{'/api':server.api}}});
 const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});result.browser=browser.version();
 for(const [width,height] of [[1440,900],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width===390,acceptDownloads:true});page.setDefaultTimeout(13000);
  page.on('pageerror',e=>result.errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'){if(msg.text().includes('409')&&msg.location().url.endsWith(url))result.expectedConflicts.push(width);else result.errors.push(msg.text());}});
  const btn=(name)=>page.getByRole('button',{name,exact:true});
  const screen=async name=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');const file=name+'-'+width+'.png';await page.screenshot({path:path.join(f.run,file)});result.screens.push(file);};
  await page.goto(server.ui);await btn('周期回顾').click();
  await page.getByRole('tab',{name:'实时周期查询'}).waitFor();await page.getByLabel('开始日期（含）').fill(f.periodStart);
  await page.getByLabel('结束日期（不含）').fill(f.periodEnd);
  const [realtime]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/home/review'&&r.url().includes(f.periodStart)),btn('刷新回顾').click()]);assert(realtime.ok());
  await screen('realtime');await page.getByRole('tab',{name:'自动周报草稿'}).click();
  await page.getByRole('heading',{name:'AI 周报草稿',exact:true}).waitFor();
  await page.getByText('本周形成合成门店陈列指引。',{exact:true}).waitFor();
  const cited=page.getByRole('group',{name:'事实依据'}).first().getByRole('button').first();
  const [source]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/wiki/'+f.knownIds[0]),cited.click()]);assert(source.ok());
  await page.locator('.nav-item').filter({hasText:'首页'}).click();await btn('周期回顾').click();await page.getByRole('tab',{name:'自动周报草稿'}).click();
  await screen('weekly');
  const note=page.getByLabel('人工审阅备注（Markdown）');
  await note.fill('合成人工审阅 '+width);
  saved=await server.json(url);
  await server.json(url,'PATCH',{baseRevision:saved.revision,userMarkdown:'另一位合成审阅者 '+width});
  const [conflict]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===url),btn('保存人工备注').click()]);
  assert.equal(conflict.status(),409);
  await page.getByText(/周报已被其他操作更新/).waitFor();assert.equal(await note.inputValue(),'合成人工审阅 '+width);
  await screen('conflict');await btn('读取最新版本').click();await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('另一位合成'));
  await note.fill('最终审阅 '+width);
  await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.ok()),btn('保存人工备注').click()]);
  if((await server.json(url)).status==='reviewed'){await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.ok()),btn('恢复为草稿').click()]);}
  await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.ok()),btn('标记已审阅归档').click()]);
  assert.equal((await server.json(url)).status,'reviewed');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'导出 Markdown'}).click()]);assert(download.suggestedFilename().includes(f.weekKey));
  const md=await readFile(await download.path(),'utf8');assert(md.includes('最终审阅 '+width)&&md.includes('本周形成合成门店陈列指引。')&&md.includes('事实'));
  await page.locator('.nav-item').filter({hasText:'自动化'}).click();
  const task=page.getByRole('article',{name:'每周工作回顾草稿'});
  await task.getByRole('button',{name:/成功/}).click();await btn('打开周报 '+f.weekKey).click();
  await page.getByRole('heading',{name:f.weekKey+' 周报'}).waitFor();await screen('archive');result.widths.push(width);
  await page.close();
 }
 assert.deepEqual(await formalHashes(f.data),before);assert.deepEqual(result.errors,[]);
}finally{await writeFile(path.join(f.run,'browser-result.json'),JSON.stringify(result,null,2));await browser?.close();if(site)await new Promise(r=>site.httpServer.close(r));await server.stop();}
