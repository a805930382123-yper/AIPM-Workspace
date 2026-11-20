import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, preview } from 'vite';
import { lwFixture } from '../lw01-fixture.ts';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';

const real = process.argv.includes('--real');
const run = execFileSync(process.execPath, ['--import', 'tsx', 'tests/acceptance/kbmaint01-review-fixture.mjs'], { encoding: 'utf8' }).trim();
console.log('Evidence', run);
const { data, ids } = JSON.parse(await readFile(path.join(run, 'fixture.json'), 'utf8'));
const guard = path.join(run, 'network.mjs');
const config = real ? path.resolve('.env.local') : path.join(run, 'empty-provider.env');
const wire = path.join(run, 'provider-attempts');
await writeFile(wire, '');
if (!real) await writeFile(config, 'FMCG_LLM_BASE_URL=http://127.0.0.1:1/v1\nFMCG_LLM_MODEL=fixture\nFMCG_LLM_API_KEY=test-only\n');
await writeFile(guard, `
import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  if (!new URL(url).pathname.endsWith('/chat/completions') || options?.method !== 'POST') throw Error('Other network disabled in inspection test');
  const input = JSON.parse(JSON.parse(options.body).messages.find(m=>m.role==='user').content);
  const allowed = ${JSON.stringify(ids)};
  if (input.stage !== 'knowledge_inspection' || !input.wiki?.length || input.wiki.some(p=>!allowed.includes(p.id))) throw Error('Outside synthetic inspection');
  if (++calls > ${real ? 1 : 2}) throw Error('Inspection test call limit reached');
  appendFileSync(${JSON.stringify(wire)}, 'knowledge_inspection\\n');
  if (${real}) {
    const file = ${JSON.stringify(path.join(run, 'provider-transport.json'))};
    try {
      const response = await original(url, options);
      appendFileSync(file, JSON.stringify({ httpStatus: response.status, httpClass: Math.floor(response.status / 100) + 'xx' }));
      return response;
    } catch (error) {
      const code = error?.cause?.code;
      const knownCodes = ['ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
      appendFileSync(file, JSON.stringify({ httpStatus: null, causeCode: knownCodes.includes(code) ? code : 'unknown' }));
      throw error;
    }
  }
  const match = input.wiki.filter(p=>p.title.includes('计划'));
  const finding = {type:'conflict',wikiIds:match.map(p=>p.id),summary:'同区域同期间的门店目标不同',reason:'同一计划两份材料的期末目标分别为80家和110家。',differences:'保留两份目标原文，需核实来源。',nextStep:'add_note',evidence:match.map(p=>({wikiId:p.id,start:0,end:p.body.length,quote:p.body}))};
  return Response.json({choices:[{message:{content:JSON.stringify({version:1,findings:[finding]})},finish_reason:'stop'}],usage:{prompt_tokens:57,completion_tokens:19}});
};
`);
const free = async () => {
  const s = createServer().listen(0,'127.0.0.1'); await once(s,'listening'); const port=s.address().port;
  await new Promise(resolve=>s.close(resolve)); assert(port!==4317); return port;
};
const apiPort=await free(), uiPort=await free();
assert.notEqual(apiPort,uiPort);
const api='http://127.0.0.1:'+apiPort, base='http://127.0.0.1:'+uiPort;
const envDir=path.join(run,'vite-env'), outDir=path.join(run,'dist');
await build({ configFile:false, envDir, plugins:[react()],build:{outDir} });
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^NODE_OPTIONS$/i.test(key)));
Object.assign(env, { FMCG_PORT:String(apiPort),FMCG_DATA_DIR:data,FMCG_LLM_CONFIG_FILE:config,FMCG_UI_ORIGIN:base,FMCG_NEWS_AI_ENABLED:'false' });
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'--import','tsx','server/index.ts'],{env,windowsHide:true,stdio:'ignore'});
const close=once(child,'close');
let browser,ui;
const report={real,node:process.version,viewport:[],errors:[],runs:[],hashes:[],screens:[]};
const json=async url=>{const response=await fetch(api+url); assert(response.ok, url+' '+response.status); return response.json();};
const hashes=async()=>{
  const result={};
  for (const name of ['knowledge/wiki','knowledge/raw','drafts']) {
    for (const f of await readdir(path.join(data,name),{recursive:true,withFileTypes:true})) {
      if (!f.isFile()) continue;
      const filename=path.join(f.parentPath,f.name);
      result[path.relative(data,filename)]=createHash('sha256').update(await readFile(filename)).digest('hex');
    }
  }
  return result;
};
try {
  for(let i=0;!await fetch(api+'/api/health').then(r=>r.ok,()=>false);i++){assert(i<300 && child.exitCode===null,'isolated API unavailable');await delay(100);}
  const {writeToken}=await json('/api/automation/status');
  for(const task of (await json('/api/automation/schedules')).items) {
    const response=await fetch(api+'/api/automation/schedules/'+task.type,{method:'PATCH',headers:{'content-type':'application/json','x-fmcg-automation-token':writeToken},body:JSON.stringify({enabled:false,revision:task.revision})}); assert(response.ok);
  }
  ui=await preview({configFile:false,envDir,build:{outDir},preview:{host:'127.0.0.1',port:uiPort,strictPort:true,proxy:{'/api':api}}});
  const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
  report.browser=browser.version();
  for(const [width,height] of [[1440,900],[390,844]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce',isMobile:width===390});
    page.setDefaultTimeout(12000);
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    const button=(root,name)=>root.getByRole('button',{name});
    const screenshot=async name=>{const file=name+'-'+width+'.png';await page.screenshot({path:path.join(run,file)});report.screens.push(file);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflows');};
    const nav=async title=>{const item=page.locator('.nav-item').filter({hasText:title}).first();if(!await item.isVisible()){await button(page,/打开导航|导航菜单|展开导航|打开菜单/).first().click();}await item.click();};
    await page.goto(base);
    await nav('自动化');
    const lint=page.getByRole('article',{name:'知识库结构巡检',exact:true}), inspect=page.getByRole('article',{name:'知识库主动巡检',exact:true});
    await button(inspect,'编辑计划').click();
    const form=inspect.getByRole('form');
    await form.getByLabel('调度方式').selectOption('weekly');
    await form.locator('select').nth(1).selectOption(width===1440?'4':'7');
    await form.locator('input[type=time]').fill(width===1440?'10:10':'12:12');
    await screenshot('weekly');
    await button(form,'保存计划').click();
    await form.waitFor({state:'hidden'});
    const saved=(await json('/api/automation/schedules')).items.find(x=>x.type==='wiki.inspect');
    assert.equal(saved.plan.weekday,width===1440?4:7);
    const runTask=async (card,type)=>{
      const before=await hashes();
      const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname==='/api/automation/tasks/'+type+'/run'),button(card,'立即运行').click()]);
      assert.equal(response.status(),202);
      const {id}=await response.json();let record;
      for(let n=0;n<800;n++){record=await json('/api/automation/runs/'+id);if(!['running','queued'].includes(record.status))break;await delay(250);}
      report.runs.push({id,type,status:record.status,usage:record.usage,artifacts:record.artifacts,error:record.error});
      assert.deepEqual(await hashes(),before);report.hashes.push(type);
      assert.equal(record.status,'succeeded',record.error);return record;
    };
    if(width===1440 || !real){
      await runTask(lint,'wiki.lint');
      const f=await lwFixture(data);const p=await f.wiki.get(ids[2]);
      await f.wiki.update(p.id,p.revision,{...p,body:p.body+'\n[[隔离不存在的盘点页'+width+']]'});
      const latest=await runTask(lint,'wiki.lint');
      const snap=await json('/api/automation/wiki-lint/'+latest.artifacts.lintSnapshotId);
      assert(snap.diff.addedCount>0);
      await page.locator('summary').filter({hasText:'新增问题'}).click();
      await screenshot('lint-diff');
    }
    if(!real||width===1440){
      const inspectionRun=await runTask(inspect,'wiki.inspect');
      const inspectionId=inspectionRun.artifacts.inspectionIds[0];
      assert.equal(inspectionRun.usage.requests,1);
      const [opened]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/knowledge/inspections/'+inspectionId),button(page,'查看本次检查记录').click()]);
      assert(opened.ok()); await page.getByRole('region',{name:'主动知识检查'}).waitFor();
      await nav('自动化');
    }
    await page.getByRole('heading',{name:'知识库巡检摘要'}).waitFor();
    const summary=page.getByRole('region',{name:'知识库巡检摘要'});
    await screenshot('summary');
    await button(summary,'查看结构检查').click();
    assert.equal(await page.getByRole('tab',{name:/结构检查/}).getAttribute('aria-selected'),'true');
    await nav('自动化');
    await button(summary,'查看主动检查').click();
    await page.getByRole('region',{name:'主动知识检查'}).waitFor();
    const ref=button(page,/查看依据/).first();await ref.waitFor();
    await screenshot('inspection');
    const [evidence]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.includes('/evidence/')),ref.click()]);assert(evidence.ok());
    await nav('首页');
    await button(page,/结构检查新增/).click();
    await page.getByRole('region',{name:'结构检查结果'}).waitFor();
    await nav('首页'); await screenshot('home');
    await button(page,/主动检查有.*待核发现/).click();
    await button(page,/查看依据/).first().waitFor();
    report.viewport.push({width,height,weekly:saved.plan,evidenceStatus:evidence.status()});
    await page.close();
  }
  assert.deepEqual(report.errors,[]);
  if (!real) {
    const archive=path.join(run,'backup.json'),restored=path.join(run,'restored');
    await exportWorkspace(data,archive);
    await restoreWorkspace(archive,restored);
    const folder='state/automation/wiki-lint';
    const files=await readdir(path.join(data,folder));
    assert(files.length>0);
    for(const file of files) assert.deepEqual(await readFile(path.join(restored,folder,file)),await readFile(path.join(data,folder,file)));
    report.restoredSnapshots=files.length;
  }
} finally {
  report.providerAttempts=(await readFile(wire,'utf8')).trim().split('\n').filter(Boolean).length;
  await writeFile(path.join(run,'browser-result.json'),JSON.stringify(report,null,2));
  await browser?.close(); if(ui)await new Promise(resolve=>ui.httpServer.close(resolve)); child.kill();await close;
}
