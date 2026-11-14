import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2],'utf8'));
const fixture = session.fixtures.synthesis;
assert(fixture,'Start pdf02-consolidation-isolated.ts with --synthesis');
const summaryOnly = process.argv.includes('--summary-only');
const out = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-R2-SYNTHESIS-20261112-ui-evidence');
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
const wikiSnapshot = async () => {
  const dir = path.join(session.root,'knowledge','wiki');
  const files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file,createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex')])));
};

async function verifySummaries() {
  const expected = [[fixture.coverageTitle,fixture.coverageDraft],[fixture.usersTitle,fixture.usersDraft]];
  const excerpts = {};
  for(const [title,text] of expected) {
    const excerpt = await page.getByRole('article',{name:`成果 ${title}`}).locator('.outcome-excerpt').innerText();
    assert.equal(excerpt,text);
    excerpts[title] = excerpt;
  }
  report.excerpts = excerpts;
  await shot('04-summary-without-citation-text',page.getByRole('article',{name:`成果 ${fixture.usersTitle}`}));
}

async function run() {
  const wiki = await wikiSnapshot();
  await page.goto(session.url,{waitUntil:'domcontentloaded'});
  await page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
  if(summaryOnly) {
    const before = await json('/__control/counters');
    await page.locator('.raw-list-item').filter({hasText:path.basename(session.fixtures.pdf,'.pdf')}).click();
    await button('打开知识草稿').click();
    await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
    await verifySummaries();
    assert.deepEqual(await json('/__control/counters'),before);
    assert.deepEqual(await wikiSnapshot(),wiki);
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
  assert.equal(raw.body,fixture.original);
  await button('查看这条资料').click();
  const rawPath = `/api/raw/${raw.id}`;
  const pdf = `${rawPath}/pdf`;
  const cleanup = `${pdf}/cleanup`;
  const sourcePages = () => Promise.all([1,2,3].map(number => json(`${pdf}/pages/${number}`)));
  await post(`${pdf}/understand`,'开始 AI 页理解',202);
  await page.getByRole('status').filter({hasText:'整份 PDF 已完成页理解 · 3/3 页'}).waitFor();
  const initialPages = await sourcePages();
  await post(cleanup,'开始内容清理',202);
  const cleanupView = page.getByRole('region',{name:'PDF 内容清理与知识草稿'});
  await cleanupView.getByRole('status').filter({hasText:'已完成 · 清理与归并完成'}).waitFor();
  const {job} = await json(cleanup);
  assert.equal(job.promptRevision,5);
  assert(job.writing);
  const decisions = job.decisions.map(item => item.text);
  assert([fixture.logo,fixture.pageNumber,fixture.promotion].every(text => decisions.includes(text)));
  const processed = await json('/__control/counters');
  assert.equal(processed.realProviderCalls,0);
  assert.deepEqual(processed.calls.map(item => item.stage),['pdf_page_understanding','pdf_page_understanding','pdf_page_understanding','pdf_cleanup','pdf_topic_index','pdf_topic_write']);
  const writingCall = processed.calls.find(item => item.stage==='pdf_topic_write');
  assert.equal(writingCall.topics.length,3);
  const noise = writingCall.topics.find(topic => topic.title===fixture.noiseTitle);
  assert.equal(noise.items.length,3);
  const omitted = job.writing[0].topics[noise.id];
  assert.deepEqual(omitted.blocks,[]);
  assert.deepEqual(noise.items.map(item => omitted.coverage[item.id].action),['metadata','metadata','promotion']);
  assert(noise.items.every(item => omitted.coverage[item.id].blockIndex===null && omitted.coverage[item.id].reason));
  const generated = await post(`${cleanup}/draft`,'生成知识草稿',200);
  const draft = await json(`/api/drafts/${generated.job.draftId}`);
  assert.deepEqual(draft.pages.map(item => item.title).sort(),[fixture.coverageTitle,fixture.usersTitle].sort());
  const coverage = draft.pages.find(item => item.title===fixture.coverageTitle);
  assert.deepEqual(new Set(coverage.pdfEvidence.map(item=>item.text)),new Set([fixture.original,fixture.second,fixture.third,fixture.forecast]));
  assert(coverage.pdfEvidence.find(item => item.text===fixture.original).kind==='text');
  assert(draft.pages.find(item => item.title===fixture.usersTitle).pdfEvidence.some(item => item.text===fixture.users));
  assert(!coverage.source_facts.some(fact => fact.text===fixture.coverageDraft));
  await button('打开知识草稿').click();
  await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  await verifySummaries();
  assert.equal(await page.getByRole('article',{name:`成果 ${fixture.noiseTitle}`}).count(),0);
  const article = page.getByRole('article',{name:`成果 ${fixture.coverageTitle}`});
  await article.getByText(/阅读完整主题成果/).click();
  const reader = article.locator('.formal-note-reader');
  const body = await reader.innerText();
  assert.match(body,/AI\s*整理/);
  assert.equal(body.split(fixture.coverageDraft).length-1,1);
  assert.equal(body.split(fixture.forecastDraft).length-1,1);
  assert(![fixture.original,fixture.second,fixture.third,fixture.logo,fixture.pageNumber,fixture.promotion].some(text => body.includes(text)));
  const written = reader.getByText(fixture.coverageDraft,{exact:false});
  for(const number of [1,2,3]) assert.equal(await written.getByRole('link',{name:`第 ${number} 页`,exact:true}).getAttribute('href'),`${pdf}/original#page=${number}`);
  await shot('01-written-paragraph-and-distinct-forecast',reader);
  const summary = article.getByText(/PDF 原页依据/);
  await summary.click();
  const details = summary.locator('..');
  for(const text of [fixture.original,fixture.second,fixture.third,fixture.forecast])await details.getByText(text,{exact:true}).waitFor();
  await shot('02-all-source-material',details.getByText(fixture.third,{exact:true}));
  const [popup] = await Promise.all([page.waitForEvent('popup'),details.getByRole('link',{name:'打开原 PDF 第 3 页',exact:true}).click()]);
  assert.equal(new URL(popup.url()).hash,'#page=3');
  await popup.close();
  const users = page.getByRole('article',{name:`成果 ${fixture.usersTitle}`});
  await users.getByText(/阅读完整主题成果/).click();
  await users.locator('.formal-note-reader').getByText(fixture.usersDraft,{exact:false}).waitFor();
  await shot('03-new-users-kept',users);
  assert.deepEqual(await wikiSnapshot(),wiki);
  assert.deepEqual(await json(rawPath),raw);
  assert.deepEqual(await sourcePages(),initialPages);
  assert.deepEqual(Buffer.from(await (await get(`${pdf}/original`)).arrayBuffer()),await readFile(session.fixtures.pdf));
  assert.deepEqual(await json('/__control/counters'),processed);
  assert.deepEqual(report.posts,['/api/raw/import',`${pdf}/understand`,cleanup,`${cleanup}/draft`]);
  assert.deepEqual(report.outside,[]);
  assert.deepEqual(report.pageErrors,[]);
  Object.assign(report,{success:true,wiki,assetSha256:raw.assetSha256,writing:job.writing,calls:processed.calls.map(item=>({stage:item.stage,bytes:item.bytes}))});
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
