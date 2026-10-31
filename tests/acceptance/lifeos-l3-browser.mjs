/** Independent actual Chrome checks. Usage: node <this-file> <isolated-session.json>. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
const { chromium } = createRequire(import.meta.url)('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rel = path.relative(os.tmpdir(), path.resolve(session.root));
assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
for (const address of [session.url, session.api]) assert.equal(new URL(address).hostname, '127.0.0.1');
const artifactRoot = path.join(session.root, 'lifeos-l3-browser-evidence');
await mkdir(artifactRoot, { recursive: true });
const evidence = { checks: [], screenshots: [], pageErrors: [], external: [], success: false, baseline: session.root };
const api = async url => { const response = await fetch(session.api + url); assert.equal(response.status, 200, url); return response.json(); };
const control = async (suffix, body) => { const response = await fetch(session.api + '/__control/' + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }); assert.equal(response.status, 200, suffix); };
async function businessSnapshot() {
  const files = {};
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else files[path.relative(session.root, file)] = createHash('sha256').update(await readFile(file)).digest('hex'); }
  }
  for (const root of ['knowledge', 'prompts', 'drafts', 'state', 'meetings']) await walk(path.join(session.root, root));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const page = await context.newPage();
evidence.chrome = browser.version();
page.on('pageerror', error => evidence.pageErrors.push(error.message));
await context.route('**/*', async route => { const url = new URL(route.request().url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { evidence.external.push(url.origin); await route.abort(); } else await route.continue(); });
const home = page.locator('#home-actions');
let current;
const isGet = (response, pathname) => response.request().method() === 'GET' && new URL(response.url()).pathname === pathname;
async function loadHome() {
  await page.locator('.nav-item').filter({ hasText: '首页' }).click();
  await home.waitFor();
  const result = page.waitForResponse(response => isGet(response, '/api/home/actions'));
  await home.getByRole('button', { name: '刷新', exact: true }).click();
  current = await (await result).json();
  await page.waitForFunction(count => document.querySelectorAll('.home-action-row').length === count, current.items.length);
  return current;
}
function row(item) { const index = current.items.findIndex(value => value.kind === item.kind && value.id === item.id); assert.ok(index >= 0, 'item exists in current home snapshot'); return page.locator('.home-action-row').nth(index); }
async function preflightClick(item, expectedStatus = 200) {
  const response = page.waitForResponse(value => isGet(value, '/api/home/actions/' + item.kind + '/' + item.id));
  await row(item).getByRole('button', { name: item.action, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), expectedStatus);
  const body = await result.json();
  if (expectedStatus === 200) { assert.equal(body.id, item.id); assert.equal(body.versionToken, item.versionToken); }
  return body;
}
async function snapshot(name) { const file = path.join(artifactRoot, name + '.png'); await page.screenshot({ path: file, fullPage: true }); evidence.screenshots.push({ file, viewport: page.viewportSize(), sha256: createHash('sha256').update(await readFile(file)).digest('hex') }); }
async function layout(label) {
  const observed = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, rows: [...document.querySelectorAll('.home-action-row')].map(row => ({ row: row.getBoundingClientRect().toJSON(), title: row.querySelector('b').getBoundingClientRect().toJSON(), button: row.querySelector('button').getBoundingClientRect().toJSON() })) }));
  assert.ok(observed.scrollWidth <= observed.width + 1, label + ' horizontal overflow');
  for (const { title, button, row } of observed.rows) { assert.ok(button.right <= row.right + 1 && button.left >= row.left - 1); assert.ok(title.right <= button.left + 1 || title.bottom <= button.top + 1, label + ' title/button overlap'); }
  evidence.checks.push({ label, observed });
}
async function navigate(item) {
  if (item.kind === 'raw-task') {
    const job = page.waitForResponse(r => isGet(r, '/api/extraction-jobs/' + item.target.jobId));
    await preflightClick(item);
    const body = await (await job).json();
    assert.equal(body.rawId, item.target.rawId); assert.equal(body.jobId, item.target.jobId);
    await page.locator('.raw-detail h2').filter({ hasText: item.title }).waitFor();
    evidence.checks.push({ label: 'precise Raw task', target: item.target, actual: { rawId: body.rawId, jobId: body.jobId } });
  } else if (item.kind === 'draft') {
    const detail = page.waitForResponse(r => isGet(r, '/api/drafts/' + item.id));
    await preflightClick(item);
    const body = await (await detail).json();
    assert.equal(body.id, item.id); assert.equal(body.revision, item.target.revision);
    await page.locator('.draft-page').waitFor();
    evidence.checks.push({ label: 'precise draft', id: body.id, revision: body.revision });
  } else if (item.kind === 'workflow') {
    const detail = page.waitForResponse(r => isGet(r, '/api/knowledge/workflows/' + item.id));
    await preflightClick(item);
    const body = await (await detail).json();
    assert.equal(body.id, item.id); assert.equal(body.revision, item.target.revision);
    await page.locator('.subheading').filter({ hasText: item.id }).waitFor();
    evidence.checks.push({ label: 'precise workflow', id: body.id, revision: body.revision });
  } else {
    const detail = page.waitForResponse(r => isGet(r, '/api/audits/' + item.id));
    await preflightClick(item);
    const body = await (await detail).json();
    assert.equal(body.audit.id, item.id); assert.equal(body.audit.revision, item.target.revision); assert.equal(body.audit.wikiId, item.target.wikiId);
    await page.locator('.audit-detail').waitFor();
    assert.ok((await page.locator('.audit-detail').innerText()).includes(item.problem));
    evidence.checks.push({ label: 'precise Audit', id: body.audit.id, revision: body.audit.revision, wikiId: body.audit.wikiId });
  }
}
try {
  await page.goto(session.url);
  await loadHome();
  const filesBefore = await businessSnapshot(), countsBefore = await api('/__control/counters');
  for (let i = 0; i < 2; i++) {
    const actions = await api('/api/home/actions');
    for (const item of actions.items.filter(item => !item.target.missing)) await api('/api/home/actions/' + item.kind + '/' + item.id + '?versionToken=' + encodeURIComponent(item.versionToken));
  }
  await page.reload();
  await loadHome();
  assert.deepEqual(await businessSnapshot(), filesBefore);
  assert.deepEqual(await api('/__control/counters'), countsBefore);
  evidence.checks.push({ label: 'home and preflight reads preserve all business files and counters', fileCount: Object.keys(filesBefore).length, countsBefore, countsAfter: await api('/__control/counters') });
  await layout('home 1440');
  await snapshot('01-home-1440');
  await page.setViewportSize({ width: 1024, height: 900 });
  await row(current.items[0]).getByRole('button').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const focus = await page.evaluate(() => { const element = document.activeElement, style = getComputedStyle(element); return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow }; });
  assert.ok(focus.visible && ((focus.outline !== 'none' && parseFloat(focus.width) > 0) || focus.shadow !== 'none'));
  await snapshot('02-home-focus-1024');
  await layout('home 1024');
  evidence.checks.push({ label: 'keyboard focus visible', focus });
  await page.setViewportSize({ width: 1440, height: 1080 });

  for (const kind of ['raw-task', 'draft', 'workflow', 'audit']) { await loadHome(); await navigate(current.items.find(item => item.kind === kind && !item.target.missing)); }
  await snapshot('03-exact-audit');

  await loadHome();
  const delayedAudit = current.items.find(item => item.kind === 'audit'), raw = current.items.find(item => item.kind === 'raw-task');
  const delayedPath = '/api/home/actions/audit/' + delayedAudit.id;
  await control('hold', { path: delayedPath });
  const requestStarted = page.waitForRequest(request => new URL(request.url()).pathname === delayedPath);
  await row(delayedAudit).getByRole('button', { name: delayedAudit.action, exact: true }).click();
  await requestStarted;
  await navigate(raw);
  const released = page.waitForResponse(response => isGet(response, delayedPath));
  await control('release'); await released;
  await page.locator('.raw-detail h2').filter({ hasText: raw.title }).waitFor();
  assert.equal(await page.locator('.audit-detail').count(), 0);
  evidence.checks.push({ label: 'late Audit preflight cannot replace newer Raw target', auditId: delayedAudit.id, rawId: raw.target.rawId });

  await loadHome();
  const recoveryRawIds = new Set(current.items.filter(item => item.kind === 'raw-task').map(item => item.target.rawId));
  const removed = current.items.find(item => item.kind === 'draft' && !recoveryRawIds.has(item.target.rawId));
  assert.ok(removed, 'independent pending draft for deletion scenario');
  await control('remove/draft/' + removed.id);
  await preflightClick(removed, 410);
  await home.getByRole('alert').filter({ hasText: /处理或删除/ }).waitFor();
  assert.equal(await page.locator('.draft-page').count(), 0);
  await snapshot('04-deleted-target');
  evidence.checks.push({ label: 'deleted target stays on home with explicit error', id: removed.id });

  await loadHome();
  const stale = current.items.find(item => item.kind === 'workflow');
  await control('version/workflow/' + stale.id);
  await preflightClick(stale, 409);
  await home.getByRole('alert').filter({ hasText: /变化/ }).waitFor();
  await snapshot('05-stale-version');
  await loadHome();
  const fresh = current.items.find(item => item.kind === 'workflow' && item.id === stale.id);
  assert.notEqual(fresh.versionToken, stale.versionToken);
  await navigate(fresh);
  evidence.checks.push({ label: 'version conflict requires refresh, then enters current version', before: stale.target.revision, after: fresh.target.revision });

  for (const kind of ['raw-task', 'draft', 'workflow', 'audit']) {
    await control('corrupt/' + kind);
    const before = await businessSnapshot(), counts = await api('/__control/counters');
    await loadHome();
    assert.equal(current.sources[kind].status, 'error');
    for (const other of ['raw-task', 'draft', 'workflow', 'audit'].filter(value => value !== kind)) assert.equal(current.sources[other].status, 'ok');
    await home.getByRole('alert').filter({ hasText: /读取失败/ }).waitFor();
    assert.equal(await home.getByText('当前没有需要处理的事项。', { exact: true }).count(), 0);
    assert.deepEqual(await businessSnapshot(), before); assert.deepEqual(await api('/__control/counters'), counts);
    if (kind === 'draft') await snapshot('06-source-error-1440');
    evidence.checks.push({ label: 'corrupt source is explicit and read-only', kind, sources: current.sources, count: current.items.length });
    await control('restore/' + kind); await loadHome(); assert.equal(current.sources[kind].status, 'ok');
  }

  await control('empty');
  const emptyBefore = await businessSnapshot(), emptyCounts = await api('/__control/counters');
  await loadHome(); assert.equal(current.items.length, 0);
  assert.ok(Object.values(current.sources).every(source => source.status === 'ok'));
  await home.getByText('当前没有需要处理的事项。', { exact: true }).waitFor();
  await snapshot('07-genuine-empty-1440');
  assert.deepEqual(await businessSnapshot(), emptyBefore); assert.deepEqual(await api('/__control/counters'), emptyCounts);
  await control('unempty'); await loadHome();
  evidence.checks.push({ label: 'genuine empty source states and read-only refresh' });

  const audit = current.items.find(item => item.kind === 'audit');
  await navigate(audit);
  await page.getByLabel('拒绝/延期理由', { exact: true }).fill('隔离验收：已人工核对，本次拒绝。');
  const resolve = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/audits/' + audit.id + '/resolve');
  await page.getByRole('button', { name: '拒绝并解决', exact: true }).click();
  const resolved = await resolve; assert.equal(resolved.status(), 200);
  assert.equal((await resolved.json()).audit.status, 'resolved');
  await loadHome(); assert.equal(current.items.some(item => item.kind === 'audit' && item.id === audit.id), false);
  evidence.checks.push({ label: 'explicit reject action updates home on return', auditId: audit.id });
  assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.external, []);
  evidence.finalCounters = await api('/__control/counters');
  evidence.success = true;
} finally {
  if (!evidence.success) await snapshot('failure-observation');
  await writeFile(path.join(artifactRoot, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
  console.log(JSON.stringify({ success: evidence.success, checks: evidence.checks.length, screenshots: evidence.screenshots.length, evidence: path.join(artifactRoot, 'evidence.json') }));
}
