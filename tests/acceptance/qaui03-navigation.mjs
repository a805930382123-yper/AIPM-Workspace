import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(session.provider, 'fake-only');
assert.equal(session.configuration, 'not-connected');
for (const url of [session.url, session.api]) assert.equal(new URL(url).hostname, '127.0.0.1');
const output = path.join(session.root, 'qaui03-navigation-evidence');
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.QAUI02_PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.QAUI02_BROWSER, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const nav = page.getByRole('navigation', { name: '主导航' });
const tabs = page.getByRole('tablist', { name: '知识库视图' });
const tab = name => tabs.getByRole('tab', { name, exact: true });
const button = name => page.getByRole('button', { name, exact: true });
const visiblePanel = page.getByRole('tabpanel');
const overview = '知识总览', ask = '向知识库提问', check = '主动知识检查', raw = '从 Raw 生成 Wiki 草稿', lint = '结构检查（Lint）';
const assertView = async name => {
  await page.getByRole('tabpanel', { name, exact: true }).waitFor();
  assert.equal(await visiblePanel.count(), 1);
  assert.equal(await tabs.getByRole('tab', { selected: true }).count(), 1);
  assert.equal(await tab(name).getAttribute('aria-selected'), 'true');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.wiki-view-tabs [aria-selected="true"]')).backgroundColor === 'rgb(79, 70, 229)');
};
const show = async name => { await tab(name).click(); await assertView(name); };
const responseFor = (pathname, method = 'GET') => page.waitForResponse(response =>
  new URL(response.url()).pathname === pathname && response.request().method() === method
);
const detailPanel = page.locator('.wiki-detail-panel');
const assertWiki = async title => {
  await assertView(overview);
  await detailPanel.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains('wiki-detail-panel'));
  const box = await detailPanel.getByRole('heading', { name: title, exact: true }).boundingBox();
  assert.ok(box.y >= 0 && box.y < page.viewportSize().height);
};
const screenshot = name => page.screenshot({ path: path.join(output, name + '.png') });

try {
  await page.goto(session.url);
  await nav.getByRole('button', { name: '知识库', exact: true }).click();
  await assertView(overview);
  assert.deepEqual(await tabs.getByRole('tab').allInnerTexts(), [overview, ask, check, raw, lint]);
  await page.getByRole('textbox', { name: '搜索 Wiki' }).waitFor();
  await detailPanel.locator('.wiki-detail h2').waitFor();
  await screenshot('desktop-overview');
  await tab(overview).focus();
  await tab(overview).press('ArrowRight');
  await assertView(ask);
  const question = page.getByRole('textbox', { name: '知识库问题' });
  await question.fill('尚未提交的问题保留');
  assert.equal(await button('收起问答').count(), 0);
  await show(check);
  const inspection = visiblePanel.locator('.wiki-inspection');
  const picker = inspection.locator('fieldset');
  await picker.getByLabel('渠道签约口径A', { exact: true }).check();
  await picker.getByLabel('渠道签约口径B', { exact: true }).check();
  await picker.getByLabel('旧年份历史参考', { exact: true }).uncheck();
  const started = responseFor('/api/knowledge/inspections', 'POST');
  await button('开始本次检查').click();
  assert.equal((await started).status(), 202);
  await show(raw);
  await visiblePanel.getByRole('heading', { name: '选择一条 Raw' }).waitFor();
  assert.equal(await visiblePanel.getByRole('dialog').count(), 0);
  assert.ok(await visiblePanel.getByRole('button', { name: /LW03 合成渠道旧资料/u }).isEnabled());
  await show(ask);
  assert.equal(await question.inputValue(), '尚未提交的问题保留');
  await show(check);
  assert.equal(await button('收起检查').count(), 0);
  const inspectionId = (await (await fetch(session.api + '/api/knowledge/inspections/current')).json()).id;
  const evidenceLink = visiblePanel.getByRole('button', { name: /^查看依据：渠道签约口径A/u }).first();
  await evidenceLink.waitFor();
  const resolved = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/knowledge/inspections/' + inspectionId + '/findings/')
    && new URL(response.url()).pathname.includes('/evidence/'));
  await evidenceLink.click();
  const evidence = await (await resolved).json();
  await assertWiki('渠道签约口径A');
  assert.equal(await detailPanel.locator('mark[data-inspection-evidence]').innerText(), evidence.quote);
  await show(check);
  assert.ok(await evidenceLink.isVisible());
  assert.ok(await picker.getByLabel('渠道签约口径B', { exact: true }).isChecked());
  console.log('Inspection survives a tab switch during execution and verified evidence opens the exact Wiki excerpt');

  const lintResponse = responseFor('/api/wiki-lint');
  await show(lint);
  const findings = await (await lintResponse).json();
  const finding = findings.findings.find(item => item.objectId === session.fixtures.wc);
  const findingLink = button(`${finding.code} · ${finding.file}:${finding.location.line} · ${finding.message}`);
  await findingLink.click();
  await assertWiki('旧年份历史参考');
  await show(lint);
  assert.ok(await findingLink.isVisible());
  assert.equal(await button('关闭').count(), 0);
  await button('手动创建 Wiki').click();
  await assertView(overview);
  await detailPanel.getByRole('heading', { name: '新建 Wiki', exact: true }).waitFor();
  const title = 'QAUI03 隔离验证新建';
  await detailPanel.getByRole('textbox', { name: /标题/u }).fill(title);
  await detailPanel.getByRole('textbox', { name: /知识内容/u }).fill('用于验证独立的新建流程。');
  const saved = responseFor('/api/wiki', 'POST');
  await button('保存 Wiki').click();
  assert.equal((await saved).status(), 201);
  await detailPanel.getByRole('heading', { name: title, exact: true }).waitFor();
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await page.locator('.recent-row').filter({ hasText: title }).first().click();
  await assertWiki(title);
  console.log('Lint findings, independent manual create/save and home deep link open the proper overview detail');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [ask, check, raw, lint, overview]) {
    await show(name);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows on mobile: ' + name);
    if (name === raw || name === ask) await screenshot('mobile-' + (name === raw ? 'raw' : 'ask'));
  }
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await button(raw).click();
  await assertView(raw);
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  const homeLintResponse = responseFor('/api/wiki-lint');
  await button('检查知识库').click();
  await assertView(lint);
  assert.equal((await homeLintResponse).status(), 200);
  await findingLink.click();
  await assertWiki('旧年份历史参考');
  assert.deepEqual(errors, []);
  console.log('All five views exclusive and fit 390px, home shortcuts open the correct tabs, zero page errors');
  console.log(output);
} finally {
  await browser.close();
}
