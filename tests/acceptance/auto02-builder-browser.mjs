import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {createServer as createHttp} from 'node:http';
import {createRequire} from 'node:module';
import {createServer as createSocket} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {build,preview} from 'vite';
import {lwFixture} from '../lw01-fixture.ts';

const root = await mkdtemp(path.join(os.tmpdir(),'auto02-chrome-'));
const data = path.join(root,'data');
const evidence = path.resolve(process.env.AUTO02_BUILDER_EVIDENCE ?? path.join(root,'evidence'));
const envDir = path.join(root,'empty-env');
const config = path.join(root,'fake.env');
await Promise.all([mkdir(envDir),mkdir(evidence,{recursive:true}),writeFile(config,'')]);
const f = await lwFixture(data);
const raw = await f.rawStore.create({title:'AUTO02 渠道整理样例',body:'2026年渠道覆盖20家。\n\n渠道回访记录共30份。',sourceType:'report',sourceName:'仅用于 AUTO02 的合成资料',tags:[]});
const first = 'AUTO02 渠道覆盖';
const second = 'AUTO02 渠道回访';
const edited = '人工核对补充：回访范围仅限本次样本。';
f.setTopics([first,second]);

let release;
const gate = new Promise(resolve => {release=resolve;});
let calls = 0;
const fake = createHttp(async (req,res) => {
  try {
    if (++calls === 1) await gate;
    let text = '';
    for await (const chunk of req) text += chunk;
    const {messages} = JSON.parse(text);
    const result = await f.provider.complete({purpose:'knowledge',system:messages[0].content,user:messages[1].content,timeoutMs:10000});
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:result.text},finish_reason:'stop'}]}));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
fake.listen(0,'127.0.0.1');
await once(fake,'listening');
const freePort = async () => {
  const socket = createSocket().listen(0,'127.0.0.1');
  await once(socket,'listening');
  const {port} = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const apiPort = await freePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const child = spawn(process.execPath,['--import','tsx','server/index.ts'],{windowsHide:true,stdio:'inherit',env:{
  ...cleanEnv,FMCG_DATA_DIR:data,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config,
  FMCG_LLM_BASE_URL:`http://127.0.0.1:${fake.address().port}/v1`,FMCG_LLM_MODEL:'fake',FMCG_LLM_API_KEY:'auto02-test-key',
}});
const stopped = once(child,'exit');
const request = async (route,body) => {
  const response = await fetch(apiBase+route,body===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const json = await response.json();
  assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(json)}`);
  return json;
};
const poll = async (fn,predicate) => {
  for (let index=0;index<100;index++) {
    const result = await fn();
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.fail('Timed out waiting for the expected application state');
};
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const snapshot = async () => {
  const paths = ['knowledge/raw','knowledge/wiki','state/extraction-jobs','state/raw-processing','state/wiki-commits'];
  const files = (await Promise.all(paths.map(async name => (await readdir(path.join(data,name),{recursive:true,withFileTypes:true})).filter(file => file.isFile()).map(file => path.join(file.parentPath,file.name))))).flat().sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [path.relative(data,file),await sha(file)])));
};
const playwright = createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
let ui, browser;
try {
  await poll(() => request('/api/health').catch(() => null),Boolean);
  const vite = {envDir,build:{outDir:path.join(root,'dist')},server:{proxy:{'/api':apiBase}}};
  await build(vite);
  ui = await preview({...vite,preview:{host:'127.0.0.1',port:await freePort(),strictPort:true}});
  const chrome = path.join(process.env.ProgramFiles ?? 'C:/Program Files','Google/Chrome/Application/chrome.exe');
  browser = await playwright.chromium.launch({executablePath:chrome,args:['--no-proxy-server'],headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  const button = (name,scope=page) => scope.getByRole('button',{name,exact:true});
  const nav = title => page.locator('.nav-item').filter({hasText:title}).click();
  const rawDetail = async () => {
    await nav('Raw 原始资料');
    await page.locator('.raw-list-item').filter({hasText:raw.title}).click();
  };
  const action = page.getByRole('article',{name:raw.title,exact:true});
  const later = page.getByRole('region',{name:'稍后处理',exact:true});
  const topic = title => page.getByRole('article',{name:`成果 ${title}`,exact:true});
  const heading = () => page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  const capture = name => page.screenshot({path:path.join(evidence,`${name}.png`)});
  await page.goto(`http://127.0.0.1:${ui.httpServer.address().port}`,{waitUntil:'domcontentloaded'});
  await rawDetail();
  await page.getByLabel('整理模式',{exact:true}).selectOption('standard');
  const starting = page.waitForResponse(response => response.request().method()==='POST' && response.url().endsWith('/extract'));
  await button('整理到知识库').click();
  const started = await (await starting).json();
  await nav('首页');
  await action.getByText('整理中',{exact:true}).waitFor();
  assert.equal(await action.count(),1);
  await action.scrollIntoViewIfNeeded();
  await capture('01-running-home-desktop');
  await button('查看整理进度',action).click();
  await page.getByRole('heading',{name:raw.title,exact:true}).waitFor();
  await nav('首页');
  await action.getByText('整理中',{exact:true}).waitFor();
  release();
  await button('继续审核',action).waitFor();
  assert.equal(await action.count(),1);
  const job = await request(`/api/extraction-jobs/${started.jobId}`);
  const draftId = job.draftId;
  assert.ok(draftId);
  const draftRoute = `/api/drafts/${draftId}`;
  await button('继续审核',action).click();
  await heading();
  await topic(second).getByText('阅读完整主题成果',{exact:true}).click();
  await button('编辑主题成果',topic(second)).click();
  const input = topic(second).locator('textarea');
  await input.fill(`${await input.inputValue()}\n\n${edited}`);
  assert.ok(await button('稍后处理').isDisabled());
  await button('保存成果编辑',topic(second)).click();
  await page.getByText('草稿已保存，请查看更新后的成果。',{exact:true}).waitFor();
  await topic(first).getByRole('checkbox').check();
  await button('确认所选成果入库（1）').click();
  await page.getByRole('heading',{name:'已入库成果',exact:true}).waitFor();
  const before = await request(draftRoute);
  const firstOperation = await request(`/api/wiki-commits/${before.commitOperationId}`);
  const firstWiki = path.join(data,'knowledge/wiki',`${firstOperation.wikiIds[0]}.md`);
  const firstSha = await sha(firstWiki);
  const beforeFiles = await snapshot();
  const beforeCalls = calls;
  const pauseRoute = `**${draftRoute}/defer`;
  await page.route(pauseRoute,route => route.fulfill({status:503,json:{error:{message:'合成保存失败，请重试。'}}}),{times:1});
  await button('稍后处理').click();
  await page.getByRole('alert').filter({hasText:'合成保存失败，请重试。'}).waitFor();
  assert.equal((await request(draftRoute)).deferredAt,undefined);
  await button('稍后处理').click();
  await button('继续处理').waitFor();
  await page.getByRole('region',{name:'稍后处理',exact:true}).scrollIntoViewIfNeeded();
  await capture('02-deferred-review-desktop');
  const stored = JSON.parse(await readFile(path.join(data,'drafts',`${draftId}.json`),'utf8'));
  assert.ok(stored.deferredAt);
  assert.equal(stored.revision,before.revision+1);
  assert.deepEqual(stored.maintenance,before.maintenance);
  await button('返回').click();
  await button('查看暂缓成果',later).waitFor();
  assert.equal(await action.count(),1);
  await page.reload({waitUntil:'domcontentloaded'});
  await button('查看暂缓成果',later).waitFor();
  await page.setViewportSize({width:390,height:844});
  await later.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture('03-deferred-home-narrow');
  const openDraft = page.waitForResponse(response => response.request().method()==='GET' && response.url().endsWith(draftRoute));
  await button('查看暂缓成果',later).click();
  assert.equal((await (await openDraft).json()).id,draftId);
  await heading();
  await button('继续处理').waitFor();
  assert.equal((await request(draftRoute)).deferredAt,stored.deferredAt);
  await page.getByRole('region',{name:'稍后处理',exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture('04-deferred-review-narrow');
  await button('查看原始资料').click();
  await button('查看暂缓成果').waitFor();
  await page.getByRole('region',{name:'整理状态',exact:true}).scrollIntoViewIfNeeded();
  await capture('05-deferred-raw-narrow');
  await button('查看暂缓成果').click();
  await heading();
  await button('继续处理').click();
  await page.getByText('已恢复处理，可以重新选择待确认的成果。',{exact:true}).waitFor();
  const resumed = await request(draftRoute);
  assert.equal(resumed.deferredAt,undefined);
  assert.deepEqual(resumed.maintenance,before.maintenance);
  assert.deepEqual(await snapshot(),beforeFiles);
  assert.equal(calls,beforeCalls);
  await nav('首页');
  await action.getByText('部分已入库',{exact:true}).waitFor();
  assert.equal(await later.getByRole('article',{name:raw.title,exact:true}).count(),0);
  await button('继续审核',action).click();
  await heading();
  assert.equal(await topic(first).getByRole('checkbox').count(),0);
  await topic(second).getByRole('checkbox').check();
  const saving = page.waitForResponse(response => response.request().method()==='POST' && response.url().endsWith(`${draftRoute}/confirm`));
  await button('确认所选成果入库（1）').click();
  const finalOperation = await (await saving).json();
  await page.getByText('本次所选成果已确认入库。',{exact:true}).waitFor();
  assert.notEqual(finalOperation.operationId,before.commitOperationId);
  assert.equal(await sha(firstWiki),firstSha);
  const final = await request(draftRoute);
  assert.equal(final.status,'confirmed');
  assert.equal(final.maintenance.changes[0].committedOperationId,before.commitOperationId);
  assert.equal(final.maintenance.changes[1].committedOperationId,finalOperation.operationId);
  const published = await request(`/api/wiki/${finalOperation.wikiIds[0]}`);
  assert.ok(published.body.includes(edited));
  assert.ok(published.sources.includes(raw.id));
  await nav('首页');
  await page.getByText('当前没有需要处理的事项。',{exact:true}).waitFor();
  assert.equal(await action.count(),0);
  await rawDetail();
  await button('查看整理结果').waitFor();
  await button('查看整理结果').click();
  await heading();
  await button('打开正式主题',topic(second)).click();
  await page.getByText(edited,{exact:true}).waitFor();
  await capture('06-final-wiki-narrow');
  assert.deepEqual(errors,[]);
  assert.equal(calls,beforeCalls);
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({
    browser:browser.version(),root,rawId:raw.id,draftId,jobId:started.jobId,calls,firstOperation:before.commitOperationId,
    finalOperation:finalOperation.operationId,firstWikiSha256:firstSha,unchangedFilesDuringPause:Object.keys(beforeFiles).length,
    savedEditReadBack:true,browserPageErrors:errors,viewports:[{width:1440,height:960},{width:390,height:844}],
  },null,2)+'\n');
  console.log(`AUTO02 Chrome scenario passed. Evidence: ${evidence}`);
} finally {
  release();
  await browser?.close();
  await new Promise(resolve => ui ? ui.httpServer.close(resolve) : resolve());
  if (child.exitCode===null && child.signalCode===null) child.kill();
  await stopped;
  await new Promise(resolve => fake.close(resolve));
}
