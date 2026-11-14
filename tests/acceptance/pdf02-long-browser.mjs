import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2],'utf8'));
const fixture = session.fixtures.long;
assert(fixture,'Start the isolated service with --long');
const out = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-LONG-20261112-ui-evidence');
await mkdir(out,{recursive:true});
const {chromium} = createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({executablePath:path.join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),args:['--no-proxy-server'],headless:true});
const page = await browser.newPage({viewport:{width:1536,height:1050}});
page.setDefaultTimeout(28000);
const evidence = {success:false,screenshots:[],posts:[],pageErrors:[],outside:[]};
page.on('pageerror',error => evidence.pageErrors.push(error.message));
page.on('request',request => {
  const url = new URL(request.url());
  if(['http:','https:'].includes(url.protocol)&&url.origin!==session.url)evidence.outside.push(url.origin);
  if(request.method()==='POST'&&url.pathname!=='/api/news/today/ensure')evidence.posts.push(url.pathname);
});
const get = async route => {
  const response = await fetch(session.url+route);
  assert(response.ok,`${route} ${response.status} ${await response.clone().text()}`);
  return response;
};
const json = async route => (await get(route)).json();
const button = name => page.getByRole('button',{name,exact:typeof name==='string'});
const post = async (route,label,status) => {
  const pending = page.waitForResponse(response => response.request().method()==='POST'&&new URL(response.url()).pathname===route);
  const [response] = await Promise.all([pending,button(label).click()]);
  const body = await response.json();
  assert.equal(response.status(),status,`${route} ${JSON.stringify(body)}`);
  return body;
};
const shot = async (name,locator) => {
  if(locator)await locator.scrollIntoViewIfNeeded();
  const target = path.join(out,`${name}.png`);
  await page.screenshot({path:target});
  evidence.screenshots.push(target);
};
const wikiSnapshot = async () => {
  const dir = path.join(session.root,'knowledge','wiki');
  const files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file,createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex')])));
};

let cleanupPath;
try {
  const wiki = await wikiSnapshot();
  await page.goto(session.url,{waitUntil:'domcontentloaded'});
  await page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
  await button(/导入资料/).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab',{name:/上传文件/}).click();
  await dialog.locator('input[type=file]').setInputFiles(session.fixtures.pdf);
  const {raw} = await post('/api/raw/import','仅保存 Raw',201);
  assert(raw.body.includes(fixture.native));
  await button('查看这条资料').click();
  const rawPath = `/api/raw/${raw.id}`;
  const pdfPath = `${rawPath}/pdf`;
  cleanupPath = `${pdfPath}/cleanup`;
  await post(`${pdfPath}/understand`,'开始 AI 页理解',202);
  await page.getByRole('status').filter({hasText:'整份 PDF 已完成页理解 · 4/4 页'}).waitFor();
  const initialPages = await Promise.all([1,2,3,4].map(number => json(`${pdfPath}/pages/${number}`)));
  await post(cleanupPath,'开始内容清理',202);
  const cleanup = page.getByRole('region',{name:'PDF 内容清理与知识草稿'});
  await cleanup.getByRole('status').filter({hasText:/已完成.*清理|已完成.*写作/}).waitFor();
  const {job} = await json(cleanupPath);
  assert.equal(job.promptRevision,6);
  assert(job.writing?.length);
  assert.deepEqual(job.topics.map(topic=>topic.title),[fixture.title]);
  const expectedUnits = fixture.pageCount*fixture.linesPerPage+2;
  assert.equal(job.decisions.length,expectedUnits);
  const processed = await json('/__control/counters');
  assert.equal(processed.realProviderCalls,0);
  const indexes = processed.calls.filter(item=>item.stage==='pdf_topic_index');
  assert.equal(indexes.length,1);
  assert.deepEqual(indexes[0].topics.slice().sort(),fixture.labels.slice().sort());
  const writes = processed.calls.filter(item=>item.stage==='pdf_topic_write');
  const packs = writes.flatMap(call=>call.topics.flatMap(topic=>topic.items));
  assert(packs.length<expectedUnits/10);
  const packedText = packs.flatMap(item=>item.text.split(/\r?\n/u).filter(Boolean));
  assert.equal(packedText.length,expectedUnits);
  assert.deepEqual(new Set(packedText),new Set(job.decisions.map(item=>item.text)));
  const batch = writes.findIndex(call=>call.topics.some(topic=>topic.items.some(item=>item.text.includes(fixture.forecast)&&item.text.includes(fixture.actual))));
  assert(batch>=0,'The page 2 facts should share one evidence pack');
  const topic = writes[batch].topics.find(item=>item.items.some(pack=>pack.text.includes(fixture.forecast)));
  const pack = topic.items.find(item=>item.text.includes(fixture.forecast));
  const assignment = job.writing[batch].topics[topic.id];
  assert.deepEqual(assignment.coverage[pack.id].blockIndexes.map(index=>assignment.blocks[index].text).filter(text=>[fixture.forecast,fixture.actual].includes(text)),[fixture.forecast,fixture.actual]);
  await shot('01-full-topic-after-cleanup',cleanup.getByText(/主题.*试点覆盖与样本/));

  const generated = await post(`${cleanupPath}/draft`,'生成知识草稿',200);
  const draft = await json(`/api/drafts/${generated.job.draftId}`);
  assert.deepEqual(draft.pages.map(item=>item.title),[fixture.title]);
  assert.equal(draft.pages[0].pdfEvidence.length,expectedUnits);
  assert(draft.pages[0].pdfEvidence.some(item=>item.page===4&&item.text===fixture.tail));
  await cleanup.getByRole('button',{name:'打开知识草稿',exact:true}).click();
  await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  const article = page.getByRole('article',{name:`成果 ${fixture.title}`});
  await article.getByText(/阅读完整主题成果/).click();
  const reader = article.locator('.formal-note-reader');
  const sourceParagraphs = [[fixture.forecast,2],[fixture.actual,2],[fixture.method,3],[fixture.tail,4]];
  for(const [text,number] of sourceParagraphs) {
    const row = reader.getByText(text,{exact:false});
    assert.equal(await row.count(),1,text);
    assert.equal(await row.getByRole('link',{name:`第 ${number} 页`,exact:true}).getAttribute('href'),`${pdfPath}/original#page=${number}`);
  }
  await shot('02-same-pack-two-paragraphs',reader.getByText(fixture.forecast,{exact:false}));
  await shot('03-tail-result-in-the-same-topic',reader.getByText(fixture.tail,{exact:false}));
  const summary = article.getByText(/PDF 原页依据/);
  await summary.click();
  const details = summary.locator('..');
  for(const [text,number] of [[fixture.forecast,2],[fixture.tail,4]]) {
    const row = details.getByRole('listitem').filter({has:page.getByText(text,{exact:true})});
    const link = row.getByRole('link',{name:`打开原 PDF 第 ${number} 页`,exact:true});
    const [popup,response] = await Promise.all([
      page.waitForEvent('popup'),
      page.context().waitForEvent('response',item=>new URL(item.url()).pathname===`${pdfPath}/original`),
      link.click(),
    ]);
    assert.equal(new URL(popup.url()).hash,`#page=${number}`);
    assert.match(response.headers()['content-type'],/^application\/pdf/);
    await popup.close();
  }
  await shot('04-tail-source-available',details.getByText(fixture.tail,{exact:true}));
  await article.getByRole('checkbox',{name:`选择入库 ${fixture.title}`}).check();
  assert(await button('确认所选成果入库（1）').isEnabled());
  assert.deepEqual(await wikiSnapshot(),wiki);
  assert.deepEqual(await json(rawPath),raw);
  assert.deepEqual(await Promise.all([1,2,3,4].map(number=>json(`${pdfPath}/pages/${number}`))),initialPages);
  assert.deepEqual(Buffer.from(await (await get(`${pdfPath}/original`)).arrayBuffer()),await readFile(session.fixtures.pdf));
  assert.deepEqual(await json('/__control/counters'),processed);
  assert.deepEqual(evidence.posts,['/api/raw/import',`${pdfPath}/understand`,cleanupPath,`${cleanupPath}/draft`]);
  assert.deepEqual(evidence.outside,[]);
  assert.deepEqual(evidence.pageErrors,[]);
  Object.assign(evidence,{success:true,units:expectedUnits,evidenceCount:draft.pages[0].pdfEvidence.length,packs:packs.length,
    labels:indexes[0].topics,topic:fixture.title,wiki,assetSha256:raw.assetSha256,
    calls:processed.calls.map(item=>({stage:item.stage,page:item.page,bytes:item.bytes}))});
} catch(error) {
  evidence.failure = error.stack ?? String(error);
  if(cleanupPath) {
    const view = await json(cleanupPath).catch(()=>null);
    if(view?.job)evidence.job = {status:view.job.status,stage:view.job.stage,attempts:view.job.attempts,error:view.job.error};
  }
  await shot('failure').catch(()=>{});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out,'browser-result.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  await browser.close();
}
