import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2],'utf8'));
assert(session.fixtures.scan,'Start the isolated service with --r3');
const entryOnly = process.argv.includes('--entry-only');
const importOnly = process.argv.includes('--import-entry-only');
const out = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-R3-20261112-ui-evidence');
await mkdir(out,{recursive:true});
const {chromium} = createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({executablePath:path.join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),args:['--no-proxy-server'],headless:true});
const page = await browser.newPage({viewport:{width:1536,height:1050}});
page.setDefaultTimeout(14000);
const report = {success:false,screenshots:[],posts:[],pageErrors:[],outside:[]};
page.on('pageerror',error => report.pageErrors.push(error.message));
page.on('request',request => {
  const url = new URL(request.url());
  if(['http:','https:'].includes(url.protocol)&&url.origin!==session.url)report.outside.push(url.origin);
  if(request.method()==='POST'&&url.pathname!=='/api/news/today/ensure')report.posts.push(url.pathname);
});
const get = async route => {
  const response = await fetch(session.url+route);
  assert(response.ok,`${route} ${response.status} ${await response.clone().text()}`);
  return response;
};
const json = async route => (await get(route)).json();
const modelCalls = async () => (await json('/__control/counters')).calls;
const button = name => page.getByRole('button',{name,exact:typeof name==='string'});
const rawNav = () => page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
const pdfPanel = () => page.getByRole('region',{name:'PDF 逐页阅读'});
const cleanupPanel = () => page.getByRole('region',{name:'PDF 内容清理与知识草稿'});
const post = async (route,action,allowed) => {
  const pending = page.waitForResponse(response => response.request().method()==='POST'&&new URL(response.url()).pathname===route);
  const [response] = await Promise.all([pending,action()]);
  const body = await response.json();
  assert(allowed.includes(response.status()),`${route} ${response.status()} ${JSON.stringify(body)}`);
  return body;
};
const shot = async (name,locator) => {
  if(locator)await locator.scrollIntoViewIfNeeded();
  const target = path.join(out,`${name}.png`);
  await page.screenshot({path:target});
  report.screenshots.push(target);
};
const snapshot = async () => {
  const dir = path.join(session.root,'knowledge','wiki');
  const files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file,createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex')])));
};
const upload = async (filename,openLabel,importShot) => {
  await button(/导入资料/).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab',{name:/上传文件/}).click();
  await dialog.locator('input[type=file]').setInputFiles(filename);
  if(importShot) {
    assert.equal(await dialog.getByRole('button',{name:'保存并生成 Wiki 草稿',exact:true}).count(),0);
    assert.equal(await dialog.locator('.primary-button').innerText(),'仅保存 Raw');
    await shot(importShot,dialog);
  }
  const {raw} = await post('/api/raw/import',()=>button('仅保存 Raw').click(),[201]);
  await button(openLabel).click();
  return raw;
};
const pageImage = async number => {
  const image = pdfPanel().getByRole('img',{name:`PDF 第 ${number} 页`,exact:true});
  await image.evaluate(element => element.decode());
  assert(await image.evaluate(element => element.naturalWidth>0));
};

async function run() {
  const fixture = session.fixtures.synthesis;
  const before = await snapshot();
  await page.goto(session.url,{waitUntil:'domcontentloaded'});
  await rawNav();
  if(importOnly) {
    const calls = await modelCalls();
    for(const [name,filename,label] of [['mixed',session.fixtures.pdf,'查看这条资料'],['scan',session.fixtures.scan,'查看 PDF 页面']]) {
      const imported = await upload(filename,label,`${name}-pdf-import-primary-save`);
      assert.equal(imported.body,name==='mixed'?fixture.original:'');
      const entry = page.getByRole('link',{name:'前往 PDF 逐页阅读',exact:true});
      await entry.waitFor();
      assert.equal(await button('整理到知识库').count(),0);
      assert.equal((await json(`/api/raw/${imported.id}/pdf`)).job,null);
      await shot(`${name}-pdf-entry-after-import`,entry);
    }
    assert.deepEqual(await modelCalls(),calls);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(report.posts,['/api/raw/import','/api/raw/import']);
    assert.deepEqual(report.outside,[]);
    assert.deepEqual(report.pageErrors,[]);
    report.success = true;
    return;
  }
  if(entryOnly) {
    const calls = await modelCalls();
    for(const [name,filename] of [['mixed',session.fixtures.pdf],['scan',session.fixtures.scan]]) {
      await page.locator('.raw-list-item').filter({hasText:path.basename(filename,'.pdf')}).click();
      const entry = page.getByRole('link',{name:'前往 PDF 逐页阅读',exact:true});
      await entry.waitFor();
      assert.equal(await button('整理到知识库').count(),0);
      assert.match(await page.locator('.raw-next-actions').innerText(),/PDF 处理/);
      await shot(`final-${name}-entry`,entry);
    }
    assert.deepEqual(await modelCalls(),calls);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(report.posts,[]);
    assert.deepEqual(report.outside,[]);
    assert.deepEqual(report.pageErrors,[]);
    report.success = true;
    return;
  }
  const mixed = await upload(session.fixtures.pdf,'查看这条资料');
  assert.equal(mixed.body,fixture.original);
  const raw = `/api/raw/${mixed.id}`;
  const pdf = `${raw}/pdf`;
  const cleanup = `${pdf}/cleanup`;
  await pageImage(1);
  assert.equal(await button('整理到知识库').count(),0);
  assert.deepEqual(await modelCalls(),[]);
  const mixedEntry = page.getByRole('link',{name:'前往 PDF 逐页阅读',exact:true});
  await shot('01-pdf-primary-entry',mixedEntry);
  await mixedEntry.click();
  await pdfPanel().getByText(/页理解按整份 PDF 进行/).waitFor();
  await post(`${pdf}/understand`,()=>pdfPanel().getByRole('button',{name:'开始 AI 页理解',exact:true}).click(),[202]);
  await pdfPanel().getByRole('status').filter({hasText:/页理解未完成.*2\/3/}).waitFor();
  const failed = await modelCalls();
  assert.deepEqual(failed.map(call => call.page),[1,2,3]);
  await page.reload({waitUntil:'domcontentloaded'});
  await rawNav();
  await pdfPanel().getByRole('status').filter({hasText:/页理解未完成.*2\/3/}).waitFor();
  assert.deepEqual(await modelCalls(),failed);
  await post(`${pdf}/understand`,()=>pdfPanel().getByRole('button',{name:'继续 AI 页理解',exact:true}).click(),[202]);
  await pdfPanel().getByRole('status').filter({hasText:/页理解未完成.*2\/3/}).waitFor();
  assert.deepEqual((await modelCalls()).map(call => call.page),[1,2,3,3]);
  const readPages = await Promise.all([1,2,3].map(number => json(`${pdf}/pages/${number}`)));

  await cleanupPanel().getByText(/第 3 页。请先完成/).waitFor();
  await cleanupPanel().getByText(/清理和主题写作只处理所选页范围/).waitFor();
  assert(await cleanupPanel().getByRole('button',{name:/^开始内容清理/}).isDisabled());
  await shot('02-partial-understanding-and-missing-page',cleanupPanel());
  await cleanupPanel().getByLabel('清理范围').selectOption('range');
  await cleanupPanel().getByLabel('结束页').fill('2');
  await post(cleanup,()=>cleanupPanel().getByRole('button',{name:/^开始内容清理/}).click(),[202]);
  const resume = cleanupPanel().getByRole('button',{name:/继续内容清理|继续清理与主题写作/});
  await resume.waitFor();
  const failedWriting = await json(cleanup);
  assert.equal(failedWriting.job.status,'failed');
  assert.equal(failedWriting.job.completedBatches,1);
  await shot('03-writing-failure-and-explicit-resume',cleanupPanel());
  const callsBeforeRefresh = await modelCalls();
  await page.reload({waitUntil:'domcontentloaded'});
  await rawNav();
  await resume.waitFor();
  assert.deepEqual(await modelCalls(),callsBeforeRefresh);
  await post(cleanup,()=>resume.click(),[202]);
  await cleanupPanel().getByRole('status').filter({hasText:/已完成.*清理|已完成.*写作/}).waitFor();
  const cleaned = await json(cleanup);
  assert.deepEqual([cleaned.job.startPage,cleaned.job.endPage,cleaned.pageCount],[1,2,3]);
  assert.match(await cleanupPanel().innerText(),/第 1–2 页 · 共 3 页/);
  const ran = await modelCalls();
  assert.deepEqual(ran.slice(4).map(call=>call.stage),['pdf_cleanup','pdf_topic_index','pdf_topic_write','pdf_topic_write']);
  await cleanupPanel().getByText(/查看保留、归并与略过理由/).click();
  const evidenceRow = cleanupPanel().getByRole('listitem').filter({hasText:fixture.second});
  const evidence = evidenceRow.getByRole('button',{name:'查看第 2 页证据',exact:true});
  await evidence.click();
  await pageImage(2);
  const back = pdfPanel().getByRole('button',{name:/返回.*清理/});
  await back.waitFor();
  await shot('04-page-two-and-return-link',back);
  await back.click();
  assert(await evidence.evaluate(element => document.activeElement===element));
  assert.equal(await evidenceRow.evaluate(element=>element.closest('details')?.open),true);
  await shot('05-back-to-original-evidence-focus',evidence);

  const generated = await post(`${cleanup}/draft`,()=>cleanupPanel().getByRole('button',{name:/生成知识草稿/}).click(),[200]);
  const draftPath = `/api/drafts/${generated.job.draftId}`;
  await cleanupPanel().getByRole('button',{name:/打开知识草稿|审核成果/}).click();
  await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
  const draft = await json(draftPath);
  assert.deepEqual(draft.pages.map(item=>item.title).sort(),[fixture.coverageTitle,fixture.usersTitle].sort());
  const coverage = page.getByRole('article',{name:`成果 ${fixture.coverageTitle}`});
  await coverage.getByText(/阅读完整主题成果/).click();
  await coverage.getByRole('button',{name:'编辑主题成果',exact:true}).click();
  const note = 'Review note: verify store scope before applying.';
  const editor = coverage.getByLabel('成果正文');
  await editor.fill(`${await editor.inputValue()}\n\n${note}`);
  await coverage.getByRole('button',{name:'保存成果编辑',exact:true}).click();
  await page.getByText('草稿已保存，请查看更新后的成果。',{exact:true}).waitFor();
  const saved = await json(draftPath);
  assert.notEqual(saved.outcomeDigest,draft.outcomeDigest);
  assert(saved.maintenance.changes.find(change=>change.candidate.title===fixture.coverageTitle).candidate.body.includes(note));
  await coverage.getByRole('checkbox',{name:`选择入库 ${fixture.coverageTitle}`}).check();
  const chosen = page.getByRole('region',{name:'整体确认入库'});
  await shot('06-edited-one-topic-selected',chosen);
  assert.deepEqual(await snapshot(),before);
  const committed = await post(`${draftPath}/confirm`,()=>button('确认所选成果入库（1）').click(),[200,201]);
  assert.equal(committed.wikiIds.length,1);
  const official = await json(`/api/wiki/${committed.wikiIds[0]}`);
  assert.equal(official.title,fixture.coverageTitle);
  assert(official.body.includes(note));
  assert(official.sources.includes(mixed.id));
  assert(official.body.includes('#page=1')&&official.body.includes('#page=2')&&!official.body.includes('#page=3'));
  assert(!(await json('/api/wiki')).items.some(item=>item.title===fixture.usersTitle));
  const wikiAfter = await snapshot();
  assert.notDeepEqual(wikiAfter,before);
  await page.getByRole('region',{name:'已入库成果',exact:true}).getByRole('button',{name:'打开正式主题',exact:true}).click();
  const detail = page.locator('.wiki-detail');
  await detail.getByRole('heading',{name:fixture.coverageTitle,exact:true}).waitFor();
  await detail.getByRole('button',{name:'阅读视图',exact:true}).click();
  await detail.getByText(note,{exact:true}).waitFor();
  await shot('07-formal-wiki-readback',detail.getByText(note,{exact:true}));
  assert.deepEqual(await json(raw),mixed);
  assert.deepEqual(await Promise.all([1,2,3].map(number=>json(`${pdf}/pages/${number}`))),readPages);
  assert.deepEqual(Buffer.from(await (await get(`${pdf}/original`)).arrayBuffer()),await readFile(session.fixtures.pdf));
  assert.deepEqual(await modelCalls(),ran);

  await rawNav();
  const scan = await upload(session.fixtures.scan,'查看 PDF 页面');
  assert.equal(scan.body,'');
  await pageImage(1);
  assert.equal(await button('整理到知识库').count(),0);
  const scanEntry = page.getByRole('link',{name:'前往 PDF 逐页阅读',exact:true});
  await shot('08-scan-primary-entry',scanEntry);
  await scanEntry.click();
  const scanPdf = `/api/raw/${scan.id}/pdf`;
  await post(`${scanPdf}/understand`,()=>pdfPanel().getByRole('button',{name:'开始 AI 页理解',exact:true}).click(),[202]);
  await pdfPanel().getByText('The scanned page contains 42 entries.',{exact:true}).waitFor();
  assert(await cleanupPanel().getByRole('button',{name:/^开始内容清理/}).isEnabled());
  await shot('09-scan-page-understood',pdfPanel().getByText('The scanned page contains 42 entries.',{exact:true}));
  assert.deepEqual(await snapshot(),wikiAfter);
  assert.equal((await json('/__control/counters')).realProviderCalls,0);
  assert(!report.posts.some(route=>route.endsWith('/extract')));
  assert.deepEqual(report.outside,[]);
  assert.deepEqual(report.pageErrors,[]);
  Object.assign(report,{success:true,wikiBefore:before,wikiAfter,mixedAssetSha256:mixed.assetSha256,scanAssetSha256:scan.assetSha256,modelCalls:(await modelCalls()).map(call=>({stage:call.stage,page:call.page,bytes:call.bytes}))});
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
