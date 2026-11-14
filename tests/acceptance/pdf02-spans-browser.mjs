import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2],'utf8'));
const fixture = session.fixtures.spans;
assert(fixture,'Start pdf02-consolidation-isolated.ts with --spans');
const summaryOnly = process.argv.includes('--summary-only');
const out = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-R2-SPANS-20261112-ui-evidence');
await mkdir(out,{recursive:true});
const {chromium} = createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({executablePath:path.join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),args:['--no-proxy-server'],headless:true});
const page = await browser.newPage({viewport:{width:1536,height:1050}});
page.setDefaultTimeout(12000);
const report = {success:false,screenshots:[],posts:[],pageErrors:[],outside:[]};
page.on('pageerror',error => report.pageErrors.push(error.message));
page.on('request',request => {
  const url = new URL(request.url());
  if(['http:','https:'].includes(url.protocol) && url.origin!==session.url) report.outside.push(url.origin);
  if(request.method()==='POST' && url.pathname!=='/api/news/today/ensure') report.posts.push(url.pathname);
});
const get = async route => {
  const response = await fetch(session.url+route);
  assert(response.ok,`${route} ${response.status} ${await response.clone().text()}`);
  return response;
};
const json = async route => (await get(route)).json();
const button = name => page.getByRole('button',{name,exact:typeof name==='string'});
const post = async (route,label,status) => {
  const pending = page.waitForResponse(response => response.request().method()==='POST' && new URL(response.url()).pathname===route);
  const [response] = await Promise.all([pending,button(label).click()]);
  const result = await response.json();
  assert.equal(response.status(),status,JSON.stringify(result));
  return result;
};
const shot = async (name,locator) => {
  if(locator) await locator.scrollIntoViewIfNeeded();
  const target = path.join(out,`${name}.png`);
  await page.screenshot({path:target});
  report.screenshots.push(target);
};
const snapshot = async () => {
  const dir = path.join(session.root,'knowledge','wiki');
  const files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file,createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex')])));
};

async function verifySummaries() {
  const expected = new Map([
    [fixture.coverageTitle,fixture.common],
    [fixture.usersTitle,fixture.users],
    [fixture.merchantsTitle,'merchants reached 61.'],
  ]);
  const excerpts = {};
  for(const [title,text] of expected) {
    const excerpt = await page.getByRole('article',{name:`成果 ${title}`}).locator('.outcome-excerpt').innerText();
    assert.equal(excerpt,text);
    excerpts[title] = excerpt;
  }
  report.excerpts = excerpts;
  await shot('04-scoped-candidate-summaries',page.getByRole('article',{name:`成果 ${fixture.usersTitle}`}));
}

async function run() {
  const wiki = await snapshot();
  await page.goto(session.url,{waitUntil:'domcontentloaded'});
  await page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
  if(summaryOnly) {
    const before = await json('/__control/counters');
    await page.locator('.raw-list-item').filter({hasText:path.basename(session.fixtures.pdf,'.pdf')}).click();
    await button('打开知识草稿').click();
    await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
    await verifySummaries();
    assert.deepEqual(await json('/__control/counters'),before);
    assert.deepEqual(await snapshot(),wiki);
    assert.deepEqual(report.posts,[]);
    assert.deepEqual(report.outside,[]);
    assert.deepEqual(report.pageErrors,[]);
    report.success = true;
    return;
  }
  await button(/导入资料/).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab',{name:/上传文件/}).click();
  await dialog.locator('input[type=file]').setInputFiles(session.fixtures.pdf);
  const {raw} = await post('/api/raw/import','仅保存 Raw',201);
  assert.equal(raw.body,fixture.native);
  await button('查看这条资料').click();
  const rawPath = `/api/raw/${raw.id}`;
  const pdf = `${rawPath}/pdf`;
  const cleanup = `${pdf}/cleanup`;
  await post(`${pdf}/understand`,'开始 AI 页理解',202);
  await page.getByRole('status').filter({hasText:'整份 PDF 已完成页理解 · 2/2 页'}).waitFor();
  const originalPage = await json(`${pdf}/pages/2`);
  assert.equal(originalPage.understanding.content,fixture.mixed);
  await post(cleanup,'开始内容清理',202);
  const cleanupView = page.getByRole('region',{name:'PDF 内容清理与知识草稿'});
  await cleanupView.getByRole('status').filter({hasText:'已完成 · 清理与归并完成'}).waitFor();
  const {job} = await json(cleanup);
  assert.equal(job.promptRevision,4);
  const parent = job.decisions.find(item => item.page===2 && item.text===fixture.mixed);
  assert(parent);
  const fragments = job.fragments.filter(item => item.unitId===parent.id);
  assert.deepEqual(fragments.map(item => item.topic),[fixture.coverageTitle,fixture.usersTitle,fixture.merchantsTitle]);
  assert.equal(fragments.map(item => fixture.mixed.slice(item.start,item.end)).join(''),fixture.mixed);
  assert(fragments.every(item => item.origin==='image' && item.text===fixture.mixed.slice(item.start,item.end)));
  const group = job.presentation.groups.find(item => item.representativeId===fragments[0].id);
  assert(group?.memberIds.some(id => id.startsWith('p1-text')));
  const processed = await json('/__control/counters');
  assert.equal(processed.realProviderCalls,0);
  assert.deepEqual(processed.calls.map(item => item.stage),['pdf_page_understanding','pdf_page_understanding','pdf_cleanup','pdf_topic_index','pdf_presentation']);

  const generated = await post(`${cleanup}/draft`,'生成知识草稿',200);
  const draft = await json(`/api/drafts/${generated.job.draftId}`);
  const titles = [fixture.coverageTitle,fixture.usersTitle,fixture.merchantsTitle];
  assert.deepEqual(draft.pages.map(item => item.title).sort(),titles.slice().sort());
  const storedParents = draft.pages.map(item => item.pdfEvidence.find(evidence => evidence.unitId===parent.id));
  assert(storedParents.every(item => item?.kind==='image'&&item.page===2&&item.text===fixture.mixed&&item.start===undefined));
  assert(storedParents.every(item => item.resultSha256===storedParents[0].resultSha256));
  await button('打开知识草稿').click();
  await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  await verifySummaries();
  for(const [title, expected, others] of [
    [fixture.coverageTitle,fixture.common,[fixture.users,fixture.active]],
    [fixture.usersTitle,fixture.users,[fixture.common,fixture.active]],
    [fixture.merchantsTitle,fixture.active,[fixture.common,fixture.users]],
  ]) {
    const article = page.getByRole('article',{name:`成果 ${title}`});
    await article.getByText(/阅读完整主题成果/).click();
    const reader = article.locator('.formal-note-reader');
    const text = await reader.innerText();
    assert.equal(text.split(expected).length-1,1);
    assert(others.every(other => !text.includes(other)));
    assert.match(text,/PDF 页图 AI 解读/);
    if(title===fixture.coverageTitle) {
      assert.match(text,/归并展示/);
      assert(!text.includes('Pilot reached 173'));
      const row = reader.getByRole('listitem').filter({hasText:expected});
      for(const number of [1,2]) assert.equal(await row.getByRole('link',{name:`第 ${number} 页`,exact:true}).getAttribute('href'),`${pdf}/original#page=${number}`);
      await shot('01-coverage-once-two-pages',reader);
    }
    if(title===fixture.merchantsTitle) assert.match(text,/merchants reached 61/);
    const summary = article.getByText(/PDF 原页依据/);
    await summary.click();
    const details = summary.locator('..');
    const source = details.getByText(fixture.mixed,{exact:true});
    await source.waitFor();
    if(title===fixture.usersTitle) {
      await shot('02-users-with-full-parent-evidence',source);
      const link = details.getByRole('link',{name:'打开原 PDF 第 2 页',exact:true});
      const [popup] = await Promise.all([page.waitForEvent('popup'),link.click()]);
      assert.equal(new URL(popup.url()).hash,'#page=2');
      await popup.close();
    }
    if(title===fixture.merchantsTitle) await shot('03-merchant-counts-with-parent-evidence',source);
  }
  assert.deepEqual(await snapshot(),wiki);
  assert.deepEqual(await json(rawPath),raw);
  assert.deepEqual(await json(`${pdf}/pages/2`),originalPage);
  assert.deepEqual(Buffer.from(await (await get(`${pdf}/original`)).arrayBuffer()),await readFile(session.fixtures.pdf));
  assert.deepEqual(await json('/__control/counters'),processed);
  assert.deepEqual(report.posts,['/api/raw/import',`${pdf}/understand`,cleanup,`${cleanup}/draft`]);
  assert.deepEqual(report.outside,[]);
  assert.deepEqual(report.pageErrors,[]);
  Object.assign(report,{success:true,fragments,parentEvidence:storedParents[0],wiki,assetSha256:raw.assetSha256,calls:processed.calls.map(item=>({stage:item.stage,bytes:item.bytes}))});
}
try {
  await run();
} catch(error) {
  report.failure = error.stack ?? String(error);
  await shot('failure').catch(()=>{});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out,'browser-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
}
