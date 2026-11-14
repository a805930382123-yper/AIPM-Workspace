import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2],'utf8'));
const output = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-R2-CONSOLIDATION-20261110-ui-evidence');
await mkdir(output,{recursive:true});
const {chromium} = createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({executablePath:path.join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),args:['--no-proxy-server'],headless:true});
const page = await browser.newPage({viewport:{width:1536,height:1050}});
page.setDefaultTimeout(15000);
const evidence = {success:false,checks:[],screenshots:[],pageErrors:[],outside:[],posts:[]};
page.on('pageerror',error => evidence.pageErrors.push(error.message));
page.on('request',request => {
  const url = new URL(request.url());
  if(['http:','https:'].includes(url.protocol) && url.origin!==session.url) evidence.outside.push(url.origin);
  if(request.method()==='POST' && url.pathname!=='/api/news/today/ensure') evidence.posts.push(url.pathname);
});
const sha = data => createHash('sha256').update(data).digest('hex');
const get = async route => {
  const response = await fetch(session.url+route);
  assert(response.ok,`GET ${route} ${response.status} ${await response.clone().text()}`);
  return response;
};
const json = async route => (await get(route)).json();
const calls = () => json('/__control/counters');
const button = name => page.getByRole('button',{name,exact:typeof name==='string'});
const cleanup = () => page.getByRole('region',{name:'PDF 内容清理与知识草稿'});
const shot = async (name,locator) => {
  if(locator) await locator.scrollIntoViewIfNeeded();
  const file = path.join(output,`builder-${name}.png`);
  await page.screenshot({path:file});
  evidence.screenshots.push(file);
};
const post = async (route,label,status) => {
  const waiting = page.waitForResponse(response => response.request().method()==='POST' && new URL(response.url()).pathname===route);
  await button(label).click();
  const response = await waiting;
  const body = await response.json();
  assert.equal(response.status(),status,JSON.stringify(body));
  return body;
};
const wikiSnapshot = async () => {
  const dir = path.join(session.root,'knowledge','wiki');
  const files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file,sha(await readFile(path.join(dir,file)))])));
};

try {
  const f = session.fixtures;
  const before = await wikiSnapshot();
  await page.goto(session.url,{waitUntil:'domcontentloaded'});
  await page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
  await button(/导入资料/).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab',{name:/上传文件/}).click();
  await dialog.locator('input[type=file]').setInputFiles(f.pdf);
  const {raw} = await post('/api/raw/import','仅保存 Raw',201);
  assert.equal(raw.body,f.original);
  await button('查看这条资料').click();
  const rawRoute = `/api/raw/${raw.id}`;
  const pdfRoute = `${rawRoute}/pdf`;
  const cleanupRoute = `${pdfRoute}/cleanup`;
  const initial = await calls();
  assert.deepEqual(initial,{calls:[],realProviderCalls:0});
  await post(`${pdfRoute}/understand`,'开始 AI 页理解',202);
  await page.getByRole('status').filter({hasText:'整份 PDF 已完成页理解 · 3/3 页'}).waitFor();
  const pageTwoBefore = await json(`${pdfRoute}/pages/2`);
  await post(cleanupRoute,'开始内容清理',202);
  await cleanup().getByRole('status').filter({hasText:'已完成 · 清理与归并完成'}).waitFor();
  const cleaned = await json(cleanupRoute);
  assert.equal(cleaned.job.topics.length,1);
  assert.deepEqual(cleaned.job.topics.map(topic => topic.title),[f.title]);
  const representative = cleaned.job.decisions.find(item => item.text===f.original && item.origin==='text');
  const restatement = cleaned.job.decisions.find(item => item.text===f.restatement && item.origin==='image');
  assert(representative && restatement);
  assert(cleaned.job.presentation.groups.some(group => group.representativeId===representative.id && group.memberIds.includes(restatement.id)));
  await cleanup().getByText(/查看保留、归并与略过理由/).click();
  await cleanup().getByText(f.restatement,{exact:true}).waitFor();
  await shot('01-cleanup-original-decisions',cleanup().getByText(f.restatement,{exact:true}));
  const processed = await calls();
  assert.equal(processed.realProviderCalls,0);
  assert.deepEqual(processed.calls.map(call => call.stage),['pdf_page_understanding','pdf_page_understanding','pdf_page_understanding','pdf_cleanup','pdf_topic_index','pdf_presentation']);
  const index = processed.calls.find(call => call.stage==='pdf_topic_index');
  assert.deepEqual(index.topics.slice().sort(),['覆盖规模','试点覆盖'].sort());
  assert(index.basis.some(group => group.samples.some(unit => unit.text===f.original)));
  assert(index.basis.some(group => group.topic==='试点覆盖' && group.samples.some(unit => unit.origin==='image')));
  const inputUnits = processed.calls.find(call => call.stage==='pdf_cleanup').units;
  assert(index.basis.every(group => group.samples.every(sample => inputUnits.some(unit => unit.id===sample.id && unit.text===sample.text))));
  const presentation = processed.calls.find(call => call.stage==='pdf_presentation');
  assert.deepEqual([...new Set(presentation.units.map(unit => unit.topic))],[f.title]);

  const drafted = await post(`${cleanupRoute}/draft`,'生成知识草稿',200);
  const view = await json(`/api/drafts/${drafted.job.draftId}`);
  const sourceEvidence = view.pages[0].pdfEvidence;
  assert.equal(view.pages.length,1);
  assert.equal(sourceEvidence.length,6);
  assert(sourceEvidence.some(item => item.text===f.original && item.page===1 && item.kind==='text'));
  assert(sourceEvidence.some(item => item.text===f.restatement && item.page===2 && item.kind==='image' && item.start===undefined));
  await button('打开知识草稿').click();
  await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  const article = page.getByRole('article',{name:`成果 ${f.title}`});
  await article.getByText(/阅读完整主题成果/).click();
  const reader = article.locator('.formal-note-reader');
  const body = await reader.innerText();
  assert.equal(body.split(f.original).length-1,1);
  assert(!body.includes(f.restatement));
  assert.match(body,/归并展示/);
  for (const text of [f.differentYear,f.differentSample,f.merchants,f.shoppers]) assert(body.includes(text),text);
  const consolidated = reader.getByRole('listitem').filter({hasText:f.original});
  assert.equal(await consolidated.getByRole('link',{name:'第 1 页',exact:true}).getAttribute('href'),`${pdfRoute}/original#page=1`);
  assert.equal(await consolidated.getByRole('link',{name:'第 2 页',exact:true}).getAttribute('href'),`${pdfRoute}/original#page=2`);
  await shot('02-draft-consolidated-content',reader);

  const summary = article.getByText(/PDF 原页依据/);
  await summary.click();
  const detail = summary.locator('..');
  for (const [number,material] of [[1,f.original],[2,f.restatement]]) {
    const row = detail.getByRole('listitem').filter({hasText:material});
    const link = row.getByRole('link',{name:`打开原 PDF 第 ${number} 页`,exact:true});
    await link.waitFor();
    const [opened,response] = await Promise.all([
      page.waitForEvent('popup'),
      page.context().waitForEvent('response',response => new URL(response.url()).pathname===`${pdfRoute}/original`),
      link.click(),
    ]);
    assert.equal(new URL(opened.url()).hash,`#page=${number}`);
    assert.match(response.headers()['content-type'],/^application\/pdf/);
    assert.match(response.headers()['content-disposition'],/^inline/);
    await opened.close();
  }
  await shot('03-dual-original-evidence',detail.getByText(f.restatement,{exact:true}));
  await page.getByText('整理依据与生成记录',{exact:true}).click();
  await page.getByText('阅读只读原文',{exact:true}).click();
  assert.equal(await page.locator('.draft-raw-preview').innerText(),f.original);
  await article.getByRole('checkbox',{name:`选择入库 ${f.title}`}).check();
  assert(await button('确认所选成果入库（1）').isEnabled());
  assert.deepEqual(await wikiSnapshot(),before);
  assert.deepEqual(await json(`${pdfRoute}/pages/2`),pageTwoBefore);
  assert.deepEqual(await json(rawRoute),raw);
  const originalBytes = await readFile(f.pdf);
  assert.deepEqual(Buffer.from(await (await get(`${pdfRoute}/original`)).arrayBuffer()),originalBytes);
  assert.equal(sha(originalBytes),raw.assetSha256);
  assert.deepEqual(await calls(),processed);
  assert.deepEqual(evidence.posts,['/api/raw/import',`${pdfRoute}/understand`,cleanupRoute,`${cleanupRoute}/draft`]);
  assert.deepEqual(evidence.pageErrors,[]);
  assert.deepEqual(evidence.outside,[]);
  evidence.wiki = before;
  evidence.assetSha256 = raw.assetSha256;
  evidence.calls = processed.calls;
  evidence.checks.push('正文一条代表合并双页，原件链接实际打开第1页和第2页。','不同年份、规模、样本条件和新增商户/消费者原样并列。','全部六条证据及清理决定仍可查看，选入前正式 Wiki、原件、Raw 和页理解不变。');
  evidence.success = true;
} catch(error) {
  evidence.failure = error.stack ?? String(error);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output,'builder-browser-result.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  await browser.close();
}
