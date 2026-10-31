/** Independent real Chrome acceptance. Run against a stopped-writing isolated harness session. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const resumeProcessing = process.argv.includes('--resume-processing');
const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const relativeRoot = path.relative(os.tmpdir(), path.resolve(session.root));
assert.ok(relativeRoot && !relativeRoot.startsWith('..') && !path.isAbsolute(relativeRoot), 'disposable TEMP root required');
assert.equal(path.resolve(session.requests), path.join(path.resolve(session.root), 'fake-requests.jsonl'));
for (const address of [session.url, session.api]) assert.equal(new URL(address).hostname, '127.0.0.1');
const evidenceDir = path.join(session.root, 'lifeos-l2-browser-evidence');
await mkdir(evidenceDir, { recursive: true });
const evidence = { mode: resumeProcessing ? 'resume-processing' : 'full', chrome: '', session: { url: session.url, api: session.api, root: session.root }, checks: [], screenshots: [], requests: [], browserErrors: [], externalRequests: [], success: false };
const fixture = prefix => { const value = session.fixtures.find(f => f.title.startsWith(prefix)); assert.ok(value, `fixture ${prefix}`); return value; };
const countFake = async () => (await readFile(session.requests, 'utf8')).trim().split(/\r?\n/).filter(Boolean).length;
const control = async suffix => { const response = await fetch(session.api + '/__control/' + suffix, { method: 'POST' }); assert.equal(response.status, 200); };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const page = await context.newPage();
evidence.chrome = browser.version();
page.on('pageerror', error => evidence.browserErrors.push(error.message));
page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/raw/') && request.url().endsWith('/extract')) evidence.requests.push({ url: request.url(), body: request.postDataJSON() }); });
await context.route('**/*', async route => { const url = new URL(route.request().url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { evidence.externalRequests.push(url.origin); await route.abort(); } else await route.continue(); });
const detail = page.locator('.raw-detail');
const summary = page.locator('.raw-status-summary');
async function rawNav() { await page.locator('.nav-item').filter({ hasText: 'Raw 原始资料' }).click(); }
async function openRaw(item) { await page.locator('.raw-list-item').filter({ hasText: item.title }).click(); await detail.getByRole('heading', { name: item.title, exact: true }).waitFor(); }
async function textHas(expression) { await page.waitForFunction(source => new RegExp(source).test(document.querySelector('.raw-status-summary')?.textContent ?? ''), expression.source); }
async function snapshot(name) {
  const file = path.join(evidenceDir, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex'), viewport: page.viewportSize() });
}
async function checkLayout(label) {
  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.raw-next-actions button')].map(e => ({ text: e.textContent, r: e.getBoundingClientRect().toJSON() }));
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, title: document.querySelector('.raw-detail h2').getBoundingClientRect().toJSON(), actions: document.querySelector('.raw-detail .detail-actions').getBoundingClientRect().toJSON(), buttons };
  });
  assert.ok(result.scrollWidth <= result.width + 1, label + ' horizontal overflow');
  assert.ok(result.title.bottom <= result.actions.top + 1, label + ' title overlaps actions');
  for (const b of result.buttons) assert.ok(b.r.width > 0 && b.r.left >= 0 && b.r.right <= result.width + 1, label + ' action visibility: ' + b.text);
  evidence.checks.push({ label, layout: result });
}
const rawBefore = await Promise.all(session.fixtures.map(async f => { const file = path.join(session.root, 'knowledge', 'raw', 'reports', f.rawId + '.md'); return { file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }; }));
try {
  await page.goto(session.url);
  await rawNav();
  const standard = fixture('01 '), deep = fixture('02 '), storage = fixture('03 '), pending = fixture('04 '), rawA = fixture('05 '), rawB = fixture('06 '), generated = fixture('07 ');
  if (!resumeProcessing) {
  await openRaw(standard);
  await textHas(/LLM_PLAN_COVERAGE_INVALID/);
  assert.equal(await summary.getByRole('button', { name: '仅重新规划（带覆盖诊断）', exact: true }).count(), 1);
  assert.match(await summary.innerText(), /使用既有提取结果重新规划，模型调用继续累计/);
  await snapshot('01-standard-failure-1440');
  await checkLayout('standard failure 1440');

  await openRaw(deep);
  await textHas(/沿用原任务深度模式/);
  assert.equal(await summary.getByRole('button', { name: '仅重新规划（带覆盖诊断）', exact: true }).count(), 0);
  await summary.getByLabel('整理模式').selectOption('standard');
  assert.match(await summary.innerText(), /按当前选择模式重新生成，不等同继续/);
  await snapshot('02-deep-failure-modes-1440');

  await openRaw(pending);
  await textHas(/草稿已保存，待你审核/);
  assert.doesNotMatch(await summary.innerText(), /已确认写入/);
  await snapshot('03-pending-1440');
  await summary.getByRole('button', { name: '继续审核', exact: true }).click();
  await page.locator('.draft-page').waitFor();
  await rawNav();
  await openRaw(pending);
  await page.reload();
  await rawNav();
  await openRaw(pending);
  await textHas(/草稿已保存，待你审核/);
  evidence.checks.push({ label: 'refresh preserves real persisted draft', draftId: pending.draftId });

  await openRaw(generated);
  await textHas(/已确认写入/);
  await snapshot('04-generated-1440');
  await checkLayout('generated 1440');

  await openRaw(rawB);
  await summary.getByLabel('整理模式').focus();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e); return { text: e.textContent, inActions: !!e.closest('.raw-next-actions'), focusVisible: e.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow }; });
  assert.ok(focus.inActions && focus.focusVisible);
  assert.ok((focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) > 0) || focus.boxShadow !== 'none', 'keyboard focus must be visible');
  evidence.checks.push({ label: 'keyboard focus', ...focus });
  await checkLayout('long title 1440');
  await snapshot('05-long-title-focus-1440');
  await page.setViewportSize({ width: 1024, height: 900 });
  await checkLayout('long title 1024');
  await snapshot('06-long-title-focus-1024');
  await page.setViewportSize({ width: 1440, height: 1080 });

  await control('hold-job/' + standard.jobId);
  const heldRequest = page.waitForRequest(r => r.url().endsWith('/api/extraction-jobs/' + standard.jobId));
  await openRaw(standard);
  await heldRequest;
  await openRaw(rawB);
  const releasedResponse = page.waitForResponse(r => r.url().endsWith('/api/extraction-jobs/' + standard.jobId));
  await control('release-job');
  await releasedResponse;
  assert.equal(await detail.getByRole('heading', { name: rawB.title, exact: true }).count(), 1);
  assert.doesNotMatch(await summary.innerText(), /LLM_PLAN_COVERAGE_INVALID|仅重新规划|沿用原任务标准模式/);
  evidence.checks.push({ label: 'late Raw A job response cannot replace Raw B', delayedJobId: standard.jobId, currentRawId: rawB.rawId });

  await openRaw(storage);
  await textHas(/任务已停止，状态保存失败/);
  await snapshot('07-storage-failure-1440');
  await checkLayout('storage failure 1440');
  const callsBefore = await countFake();
  const draftsBefore = (await (await fetch(session.api + '/api/raw-processing')).json()).items.find(x => x.rawId === storage.rawId);
  const draftFiles = (await readdir(path.join(session.root, 'drafts'), { recursive: true })).filter(file => file.endsWith('.json'));
  const savedDrafts = [];
  for (const name of draftFiles) { const file = path.join(session.root, 'drafts', name), bytes = await readFile(file); if (JSON.parse(bytes.toString()).rawId === storage.rawId) savedDrafts.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  assert.equal(savedDrafts.length, 1, 'actual saved draft exists before storage recovery');
  await control('release-storage');
  await summary.getByRole('button', { name: '重试保存状态', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('.draft-page') || /草稿已保存，待你审核/.test(document.querySelector('.raw-status-summary')?.textContent ?? ''));
  await rawNav();
  await openRaw(storage);
  await textHas(/草稿已保存，待你审核/);
  for (const draft of savedDrafts) assert.equal(createHash('sha256').update(await readFile(draft.file)).digest('hex'), draft.sha256, 'saved draft bytes retained');
  assert.equal(await summary.getByRole('button', { name: '重试保存状态', exact: true }).count(), 0);
  const callsAfter = await countFake();
  assert.equal(callsAfter, callsBefore);
  const statesAfter = (await (await fetch(session.api + '/api/raw-processing')).json()).items;
  const recovered = statesAfter.find(x => x.rawId === storage.rawId);
  assert.equal(recovered.status, 'pending_confirmation');
  assert.ok(recovered.draftId);
  await snapshot('08-storage-restored-pending-1440');
  await summary.getByRole('button', { name: '继续审核', exact: true }).click();
  await page.locator('.draft-page').waitFor();
  evidence.checks.push({ label: 'explicit storage recovery keeps draft with zero fake calls', callsBefore, callsAfter, savedDrafts, before: draftsBefore, after: recovered });

  await rawNav();
  await openRaw(deep);
  await textHas(/沿用原任务深度模式/);
  await summary.getByLabel('整理模式').selectOption('standard');
  const continueRequest = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/raw/' + deep.rawId + '/extract'));
  await summary.getByRole('button', { name: '显式继续提取', exact: true }).click();
  const continueBody = (await continueRequest).postDataJSON();
  assert.equal(continueBody.mode, 'deep'); assert.notEqual(continueBody.restart, true);
  await page.locator('.draft-page').waitFor({ timeout: 15000 });
  evidence.checks.push({ label: 'continue uses original deep mode after selecting standard', body: continueBody });

  await rawNav();
  await openRaw(standard);
  await textHas(/沿用原任务标准模式/);
  await summary.getByLabel('整理模式').selectOption('deep');
  const regenerateRequest = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/raw/' + standard.rawId + '/extract'));
  await summary.getByRole('button', { name: '明确重新生成', exact: true }).click();
  const regenerateBody = (await regenerateRequest).postDataJSON();
  assert.equal(regenerateBody.mode, 'deep'); assert.equal(regenerateBody.restart, true);
  await page.locator('.draft-page').waitFor({ timeout: 15000 });
  evidence.checks.push({ label: 'regenerate uses currently selected deep mode', body: regenerateBody });
  }

  await rawNav();
  await openRaw(rawA);
  if (!resumeProcessing) {
    await control('hold-provider');
    await summary.getByRole('button', { name: 'AI 整理知识', exact: true }).click();
  }
  await textHas(/当前阶段：.*提取/);
  await summary.getByRole('button', { name: '取消整理', exact: true }).waitFor();
  assert.equal(await summary.getByRole('button', { name: '取消整理', exact: true }).count(), 1);
  assert.doesNotMatch(await summary.innerText(), /已确认写入|草稿已保存，待你审核/);
  await snapshot('09-processing-1440');
  await checkLayout('processing 1440');
  await control('release-provider');
  await page.waitForFunction(() => !!document.querySelector('.draft-page') || /草稿已保存，待你审核/.test(document.querySelector('.raw-status-summary')?.textContent ?? ''), undefined, { timeout: 15000 });
  if (await page.locator('.draft-page').count() === 0) await summary.getByRole('button', { name: '继续审核', exact: true }).click();
  await page.locator('.draft-page').waitFor({ timeout: 15000 });
  evidence.checks.push({ label: 'running task renders as processing until saved draft' });

  for (const raw of rawBefore) assert.equal(createHash('sha256').update(await readFile(raw.file)).digest('hex'), raw.sha256, 'Raw bytes changed');
  assert.deepEqual(evidence.browserErrors, []);
  assert.deepEqual(evidence.externalRequests, []);
  evidence.checks.push({ label: 'all isolated Raw files unchanged', files: rawBefore });
  evidence.success = true;
} finally {
  await writeFile(path.join(evidenceDir, resumeProcessing ? 'processing-evidence.json' : 'evidence.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
  console.log(JSON.stringify({ evidence: path.join(evidenceDir, resumeProcessing ? 'processing-evidence.json' : 'evidence.json'), success: evidence.success, checks: evidence.checks.length, screenshots: evidence.screenshots.length }));
}
