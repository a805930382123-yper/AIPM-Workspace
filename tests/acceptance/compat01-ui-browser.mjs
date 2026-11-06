import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)(
  'C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const out = path.join('docs/reports/COMPAT01-20261105-ui-evidence', 'browser-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(out, { recursive: true });
const evidence = { success: false, screenshots: [], pageErrors: [], console: [], HTTPFailures: [], externalRequests: [] };
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:OPENAI|ANTHROPIC|GEMINI|PROVIDER|LLM_|AI_API|API_KEY)/i.test(key)));
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/compat01-ui-isolated.ts'], { env, windowsHide: true });
const stopped = once(server, 'exit');
let serverOut = '', serverErrors = '';
server.stdout.on('data', chunk => { serverOut += chunk; });
server.stderr.on('data', chunk => { serverErrors += chunk; });
let browser, page, session;
const startDeadline = AbortSignal.timeout(60_000);

async function api(route, method = 'GET', body) {
  const response = await fetch(session.api + route, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${method} ${route}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}

async function snapshot(subdir) {
  const hashes = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else hashes[path.relative(session.root, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await walk(path.join(session.root, 'knowledge', subdir));
  return hashes;
}

async function screenshot(name) {
  const file = name + '.png';
  await page.screenshot({ path: path.join(out, file) });
  evidence.screenshots.push(file);
}

async function mutation(suffix, work, status = 200) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix));
  await work();
  const response = await pending;
  assert.equal(response.status(), status, await response.text());
  await page.locator('.draft-page[aria-busy="false"]').waitFor();
  return response.json();
}

const button = (container, name) => container.getByRole('button', { name, exact: typeof name === 'string' });
const confirm = () => button(page, /^确认写入 Wiki/);
const card = () => page.locator('section[aria-label^="知识变更 "]').first();
const checkbox = () => card().getByRole('checkbox');
async function approve() {
  await mutation('/changes/review', () => button(card(), '接受此项').click());
  assert(await confirm().isDisabled());
  await mutation('/changes/review', () => checkbox().click());
  assert(await checkbox().isChecked());
  assert(await confirm().isEnabled());
}

async function draftFor(rawId) {
  const { items } = await api('/api/drafts?rawId=' + rawId);
  assert.equal(items.length, 1);
  return api('/api/drafts/' + items[0].id);
}

async function expectReview() {
  await page.getByRole('heading', { name: '审核知识变更', exact: true }).waitFor();
  assert(await confirm().isDisabled());
  assert(await checkbox().isDisabled());
}

try {
  while (!session) {
    const start = serverOut.indexOf('{\n');
    const end = serverOut.indexOf('\n}', start);
    if (start >= 0 && end > start) {
      session = JSON.parse(serverOut.slice(start, end + 2));
      break;
    }
    assert(server.exitCode === null && !startDeadline.aborted, 'Isolated App did not start: ' + serverErrors);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const relative = path.relative(await realpath(os.tmpdir()), await realpath(session.root));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  for (const url of [session.url, session.api]) assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(session.provider, 'fake-only');
  assert.equal(session.configLoader, 'not-connected');
  evidence.session = session;
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  evidence.browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) evidence.console.push({ type: message.type(), text: message.text(), location: message.location() });
  });
  page.on('response', response => {
    if (!response.ok()) evidence.HTTPFailures.push({ method: response.request().method(), route: new URL(response.url()).pathname, status: response.status() });
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === session.url) return route.continue();
    evidence.externalRequests.push(url.href);
    return route.abort();
  });

  const { a, b, theme } = session.fixtures;
  const rawBefore = await snapshot('raw');
  const wikiBefore = await snapshot('wiki');
  const firstRaw = await api('/api/raw/' + a);
  const secondRaw = await api('/api/raw/' + b);
  await page.goto(session.url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await button(page, '从 Raw 生成 Wiki 草稿').click();
  const chooser = page.getByRole('dialog', { name: '选择一条 Raw' });
  await button(chooser, new RegExp(firstRaw.title)).click();
  await expectReview();
  const initialDraft = await draftFor(a);
  assert.equal(initialDraft.maintenance.changes[0].action, 'create');
  await approve();
  await button(card(), '编辑候选正文').click();
  assert(await confirm().isDisabled());
  const editedText = '人工核对保留2025统计口径。';
  const body = card().getByRole('textbox', { name: '完整正文' });
  await body.fill((await body.inputValue()) + '\n\n' + editedText);
  await mutation('/changes/review', () => button(card(), '保存编辑并重新审核').click());
  assert.equal(await checkbox().isChecked(), false);
  assert(await confirm().isDisabled());
  const editedDraft = await draftFor(a);
  assert.equal(editedDraft.maintenance.changes[0].approval, undefined);
  assert(editedDraft.maintenance.changes[0].candidate.body.endsWith(editedText));
  assert.deepEqual(await snapshot('wiki'), wikiBefore);
  await screenshot('01-edited-approval-cleared');
  await mutation('/changes/review', () => checkbox().click());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const homeAction = page.locator('.home-action-row').filter({ hasText: firstRaw.title });
  await button(homeAction, '继续审核').click();
  await page.getByRole('heading', { name: '审核知识变更', exact: true }).waitFor();
  assert(await checkbox().isChecked());
  assert(await confirm().isEnabled());
  assert.deepEqual(await snapshot('wiki'), wikiBefore);
  const committed = await mutation('/confirm', () => confirm().click(), 201);
  await page.getByRole('status').filter({ hasText: '已保存本次 1 项变更' }).waitFor();
  assert.equal((await draftFor(a)).status, 'confirmed');
  const target = await api('/api/wiki/' + committed.wikiIds[0]);
  assert.deepEqual(target.sources, [a]);
  assert(target.body.endsWith(editedText));
  assert.equal((await api('/api/wiki/' + committed.sourceId)).type, 'source');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const recentWiki = page.locator('section.recent-panel').filter({ has: page.getByRole('heading', { name: '最近知识', exact: true }) });
  await button(recentWiki, new RegExp(theme)).click();
  await page.getByText(editedText, { exact: true }).waitFor();
  await screenshot('02-formal-wiki-after-refresh');

  await button(page.locator('.sidebar'), 'Raw 原始资料').click();
  const rawPage = page.locator('.raw-page');
  await rawPage.locator('.raw-list-item').filter({ hasText: secondRaw.title }).click();
  await rawPage.getByRole('heading', { name: secondRaw.title, exact: true }).waitFor();
  const trigger = button(rawPage.locator('.raw-heading'), /导入资料/);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '导入原始资料' });
  const title = dialog.getByRole('textbox', { name: /标题/ });
  const first = button(dialog, '关闭'), last = button(dialog, '保存并生成 Wiki 草稿');
  const isFocused = locator => locator.evaluate(element => element.ownerDocument.activeElement === element);
  await dialog.waitFor();
  assert(await isFocused(title));
  await screenshot('03-dialog-initial-title-focus');
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  assert(await isFocused(last));
  await screenshot('04-dialog-reverse-tab-wrap');
  await page.keyboard.press('Tab');
  assert(await isFocused(first));
  await page.keyboard.press('Escape');
  assert(await dialog.isVisible(), 'Escape keeps the current Raw import behavior');
  assert(await isFocused(first));
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  assert(await isFocused(trigger));
  await screenshot('05-dialog-focus-restored');
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  assert(await isFocused(title));
  await button(dialog, '取消').click();
  await dialog.waitFor({ state: 'detached' });
  assert(await isFocused(trigger));
  evidence.focus = ['title on entry', 'Shift+Tab first to last', 'Tab last to first', 'Escape unchanged', 'trigger restored', 'reopen title and cancel restore'];

  await page.getByLabel('整理模式', { exact: true }).selectOption('standard');
  await button(rawPage, '整理并融入知识库').click();
  await expectReview();
  const secondDraft = await draftFor(b);
  assert.equal(secondDraft.maintenance.changes[0].targetWikiId, target.id);
  assert.equal(secondDraft.maintenance.changes[0].action, 'update');
  await approve();
  const externalEdit = '人工先更新正式页，保留此内容。';
  await api('/api/wiki/' + target.id, 'PUT', { ...target, baseRevision: target.revision, body: target.body + '\n\n' + externalEdit });
  const wikiWithNewRevision = await snapshot('wiki');
  const conflict = await mutation('/confirm', () => confirm().click(), 409);
  assert.equal(conflict.error.code, 'WIKI_REVISION_CONFLICT');
  await page.getByRole('alert').filter({ hasText: /目标Wiki已变化/ }).waitFor();
  assert.equal(await page.getByText(/已保存本次/).count(), 0);
  assert.equal((await draftFor(b)).status, 'pending_confirmation');
  assert.deepEqual(await snapshot('wiki'), wikiWithNewRevision);
  assert((await api('/api/wiki/' + target.id)).body.endsWith(externalEdit));
  assert.deepEqual(await snapshot('raw'), rawBefore);
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot('06-confirmation-conflict-retained');

  const requests = await api('/__control/requests');
  const stages = requests.map(request => request.system.startsWith('知识维护提议')
    ? 'maintenance' : request.user.includes('请对下列全部已验证事实规划知识页') ? 'planning' : 'extraction');
  assert.deepEqual(stages, ['extraction', 'planning', 'maintenance', 'extraction', 'planning', 'maintenance']);
  const counters = await api('/__control/counters');
  assert.deepEqual(counters, { provider: 6, configuration: 'not-connected', realProviderCalls: 0 });
  assert.deepEqual(evidence.externalRequests, []);
  assert.deepEqual(evidence.pageErrors, []);
  const expectedFailure = { method: 'POST', route: '/api/drafts/' + secondDraft.id + '/confirm', status: 409 };
  assert.deepEqual(evidence.HTTPFailures, [expectedFailure]);
  assert(evidence.console.every(item => item.type === 'error' && item.text.includes('409') && item.location.url.endsWith(expectedFailure.route)), JSON.stringify(evidence.console));
  Object.assign(evidence, {
    success: true, stages, counters, rawBefore, rawAfter: await snapshot('raw'),
    successDraft: initialDraft.id, operationId: committed.operationId, sourceId: committed.sourceId,
    wikiId: target.id, conflictDraft: secondDraft.id, rejected: { status: 409, code: conflict.error.code },
  });
} catch (error) {
  evidence.failure = { message: error.message, stack: error.stack };
  if (page) await screenshot('attempt-failure');
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  evidence.serverExit = await stopped;
  evidence.browserClosed = !browser?.isConnected();
  await writeFile(path.join(out, 'server.txt'), serverOut + serverErrors);
  await writeFile(path.join(out, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(out);
}
