import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const cache = path.resolve('node_modules/.cache/meetui01-review');
const output = path.resolve('docs/reports/MEETUI01-20261107-evidence');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const temp = await mkdtemp(path.join(cache, 'run-'));
const service = spawn(process.execPath, ['--import', 'tsx', 'scripts/ui04-isolated.ts'], {
  windowsHide: true,
  env: { ...process.env, TEMP: temp, TMP: temp },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopped = once(service, 'close');
let serverLog = '';
service.stdout.on('data', data => { serverLog += data; });
service.stderr.on('data', data => { serverLog += data; });
const evidence = { success: false, checks: [], screenshots: [], pageErrors: [], requests: [], contrast: [] };
let browser, page;

async function startSession() {
  for (let attempt = 0; attempt < 200 && service.exitCode === null; attempt++) {
    const root = (await readdir(temp)).find(name => /^ui04-[A-Za-z0-9]{6}$/.test(name));
    if (root) {
      const folder = path.join(temp, root);
      if ((await readdir(folder)).includes('isolated-session.json') && serverLog.includes('"pid":')) {
        return JSON.parse(await readFile(path.join(folder, 'isolated-session.json'), 'utf8'));
      }
    }
    await wait(100);
  }
  assert.fail(`隔离会议服务未启动\n${serverLog}`);
}

async function capture(locator, name) {
  const file = `review-${name}.png`;
  await locator.screenshot({ path: path.join(output, file), animations: 'disabled' });
  evidence.screenshots.push(file);
}

async function effectiveContrast(button, state) {
  const colors = await button.evaluate(element => {
    const read = text => text.match(/[\d.]+/g).map(Number);
    const mix = (foreground, background, alpha) => foreground.slice(0, 3).map((value, i) => value * alpha + background[i] * (1 - alpha));
    let parentBg = [255, 255, 255];
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.unshift(read(getComputedStyle(parent).backgroundColor));
    for (const rgba of ancestors) parentBg = mix(rgba, parentBg, rgba[3] ?? 1);
    const style = getComputedStyle(element), background = read(style.backgroundColor), color = read(style.color), opacity = Number(style.opacity);
    const fill = mix(background, parentBg, background[3] ?? 1);
    const luminance = rgb => rgb.reduce((sum, value, i) => {
      const channel = value / 255;
      return sum + [0.2126, 0.7152, 0.0722][i] * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    }, 0);
    const values = [luminance(mix(fill, parentBg, opacity)), luminance(mix(mix(color, fill, color[3] ?? 1), parentBg, opacity))].sort((a, b) => a - b);
    return { color: style.color, background: style.backgroundColor, opacity, ratio: (values[1] + .05) / (values[0] + .05) };
  });
  evidence.contrast.push({ state, viewport: page.viewportSize().width, ...colors });
  assert.ok(colors.ratio >= 4.5, `${state} 删除文字对比度 ${colors.ratio.toFixed(2)} 低于 4.5`);
  return colors;
}

async function run() {
  const session = await startSession();
  for (const endpoint of [session.api, session.url]) assert.equal(new URL(endpoint).hostname, '127.0.0.1');
  async function api(route, { method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(session.api + route, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  }
  assert.equal((await api('/api/health')).isolated, true);
  const counters = await api('/__control/counters');
  assert.equal(counters.config, 'not-connected');
  const rawBaseline = await api('/api/raw');
  const catalog = await api('/api/meeting-catalog');
  const title = 'MEETUI01 独验合成会议';
  const meeting = await api('/api/meetings', { method: 'POST', status: 201, body: {
    requestId: randomUUID(), title, meeting_date: '2026-11-07', meeting_type: catalog.types[0].id, confidentiality: 'Public',
  } });
  const resource = `/api/meetings/${meeting.meeting_id}`;
  const read = () => api(resource);
  await api(resource + '/policy', { method: 'PATCH', body: { baseRevision: meeting.revision, storage_mode: 'local_archive' } });

  const { chromium } = createRequire(import.meta.url)(process.env.MEETUI01_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.MEETUI01_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('request', request => {
    const route = new URL(request.url()).pathname;
    if (route.startsWith('/api/meetings') && request.method() !== 'GET') {
      evidence.requests.push({ method: request.method(), route });
    }
  });
  const importRoute = resource + '/minutes/import';
  const uploadKeys = [];
  await page.route(`**${importRoute}`, async pending => {
    const request = pending.request();
    if (request.headers()['content-type']?.startsWith('multipart/form-data')) {
      uploadKeys.push(request.postData()?.match(/name="requestId"\r\n\r\n([^\r\n]+)/)?.[1]);
    }
    await pending.continue();
  });
  const details = page.locator('.meeting-detail');
  const minutes = page.locator('.meeting-minutes');
  const groupSummary = page.locator('summary').filter({ hasText: '本地会议纪要 ·' });
  const button = name => minutes.getByRole('button', { name, exact: true });
  const save = button('保存会议档案');
  const clear = button('删除全部本地纪要');
  const fileInput = minutes.locator('input[type=file]');
  const paste = minutes.getByLabel('粘贴会议纪要', { exact: true });
  const editor = minutes.getByLabel('编辑纪要工作副本', { exact: true });
  const versions = minutes.getByLabel('查看纪要版本', { exact: true });
  const fileCount = () => fileInput.evaluate(input => input.files.length);
  const savedStatus = () => minutes.getByRole('status').filter({ hasText: '纪要已保存' }).waitFor();
  const listCount = count => groupSummary.filter({ hasText: `${count} 个版本` }).waitFor();
  const mutationCount = () => evidence.requests.length;
  const resize = async width => {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const respond = (method, route) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === route);
  async function mutate(method, route, action, status = 200) {
    const next = respond(method, route);
    await action();
    const response = await next;
    assert.equal(response.status(), status, await response.text());
    return response.json();
  }
  async function open(title) {
    await page.locator('.meeting-row').filter({ hasText: title }).click();
    await details.getByRole('heading', { name: title, exact: true }).waitFor();
    await groupSummary.click();
  }
  async function holdMutation(method, route, click, during) {
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const matcher = `**${route}`;
    const handler = async pending => {
      if (pending.request().method() !== method) return pending.fallback();
      entered();
      await gate;
      await pending.fallback();
    };
    await page.route(matcher, handler);
    try {
      return await mutate(method, route, async () => {
        try {
          await click();
          await waiting;
          await during();
        } finally { release(); }
      }, method === 'POST' ? 201 : 200);
    } finally { await page.unroute(matcher, handler); }
  }

  await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '会议档案', exact: true }).click();
  await open(title);
  assert.equal(await save.isDisabled(), true);
  await button('上传文件').click();
  await fileInput.setInputFiles(session.fixtures.files.docx.path);
  assert.equal(await save.isEnabled(), true);
  assert.equal(mutationCount(), 0);
  await api('/__control/fail-upload', { method: 'POST' });
  await mutate('POST', resource + '/minutes/import', () => save.click(), 503);
  await minutes.getByRole('alert').filter({ hasText: '输入仍保留' }).waitFor();
  assert.equal(await fileCount(), 1);
  assert.equal((await read()).imports.length, 0);
  assert.equal(await minutes.getByRole('status').filter({ hasText: '纪要已保存' }).count(), 0);
  await holdMutation('POST', resource + '/minutes/import', () => save.click(), async () => {
    await minutes.getByRole('status').filter({ hasText: '处理中' }).waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.equal(await fileInput.isDisabled(), true);
    assert.equal(await button('粘贴').isDisabled(), true);
    await save.evaluate(element => element.click());
    assert.equal(mutationCount(), 2);
  });
  await listCount(1);
  await savedStatus();
  assert.equal(await fileCount(), 0);
  assert.equal(await save.isDisabled(), true);
  await save.evaluate(element => element.click());
  assert.equal(mutationCount(), 2);
  const [first] = (await read()).imports;
  assert.equal(first.original_filename, path.basename(session.fixtures.files.docx.path));
  assert.equal(first.imported_minutes, session.fixtures.files.docx.text);
  assert.equal(first.file_sha256, session.fixtures.files.docx.sha256);
  assert.equal(uploadKeys.length, 2);
  assert.ok(uploadKeys[0]);
  assert.equal(uploadKeys[0], uploadKeys[1]);
  evidence.sameMultipartRetryKey = true;
  await fileInput.setInputFiles(session.fixtures.files.docx.path);
  assert.equal(await fileCount(), 1);
  assert.equal(await save.isDisabled(), true);
  const confirmVersion = minutes.getByLabel(/^确认新增版本/);
  await confirmVersion.check();
  assert.equal(await save.isEnabled(), true);
  await button('清空待导入内容').click();
  assert.equal(await fileCount(), 0);

  await button('粘贴').click();
  const pasted = 'MEETUI01 合成粘贴纪要\n门店名称及数量待确认。';
  await paste.fill(pasted);
  assert.equal(await save.isDisabled(), true);
  const edit = button('编辑工作副本');
  if (await edit.isEnabled()) await edit.click();
  assert.equal(await editor.count(), 0);
  assert.equal(await paste.inputValue(), pasted);
  await confirmVersion.check();
  await confirmVersion.focus();
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press('Tab');
    if (await save.evaluate(node => document.activeElement === node)) break;
  }
  assert.equal(await save.evaluate(node => document.activeElement === node && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'), true);
  await mutate('POST', resource + '/minutes/import', () => page.keyboard.press('Enter'), 201);
  await listCount(2);
  await savedStatus();
  assert.equal(await paste.inputValue(), '');
  assert.equal(await save.isDisabled(), true);
  const afterImport = await read();
  const current = afterImport.imports.find(record => record.import_id === afterImport.active_import_id);
  assert.equal(current.imported_minutes, pasted);
  assert.deepEqual(afterImport.imports.find(record => record.import_id === first.import_id), first);
  await versions.selectOption(first.import_id);
  assert.equal(await edit.count(), 0);
  await versions.selectOption(current.import_id);
  evidence.checks.push('M02 file and paste persist on bottom save, no duplicate on no-op, same file reselects; M04 original read-only and import failure retains same request ID/file');

  await edit.click();
  assert.equal(await save.isDisabled(), true);
  assert.equal(await paste.isDisabled(), true);
  assert.equal(await button('上传文件').isDisabled(), true);
  await editor.fill('取消后不保存的内容');
  const beforeCancel = mutationCount();
  await button('取消编辑').click();
  assert.equal(mutationCount(), beforeCancel);
  assert.equal((await read()).revision, afterImport.revision);
  await edit.click();
  const edited = pasted + '\n人工核对后补充渠道范围。';
  await editor.fill(edited);
  const newTitle = title + '（并发版本）';
  await api(resource, { method: 'PATCH', body: { baseRevision: afterImport.revision, title: newTitle } });
  const patchRoute = resource + '/minutes/' + current.import_id;
  await mutate('PATCH', patchRoute, () => save.click(), 409);
  await minutes.getByRole('alert').filter({ hasText: '工作副本仍保留' }).waitFor();
  assert.equal(await editor.inputValue(), edited);
  assert.equal(await minutes.getByRole('status').filter({ hasText: '纪要已保存' }).count(), 0);
  await button('重载最新版').click();
  await details.getByRole('heading', { name: newTitle, exact: true }).waitFor();
  assert.equal(await editor.inputValue(), edited);
  const updated = await holdMutation('PATCH', patchRoute, () => save.click(), async () => {
    assert.equal(await save.isDisabled(), true);
    assert.equal(await editor.isDisabled(), true);
    assert.equal(await button('取消编辑').isDisabled(), true);
  });
  await savedStatus();
  await minutes.getByText('人工核对后补充渠道范围。', { exact: false }).waitFor();
  const stored = await read();
  assert.equal(stored.revision, updated.revision);
  assert.equal(stored.imports.length, 2);
  assert.equal(stored.imports[1].imported_minutes, pasted);
  assert.equal(stored.imports[1].editable_minutes, edited);
  assert.deepEqual(stored.imports[0], first);
  evidence.checks.push('M03 edit/clear pending are mutually exclusive, cancel read-only; M04 actual 409 preserves draft, reload/retry persists editable copy only');

  await details.getByRole('button', { name: '编辑', exact: true }).click();
  const metadata = page.getByRole('dialog', { name: '编辑会议信息', exact: true });
  const metadataSave = metadata.locator('footer').getByRole('button', { name: '保存会议档案', exact: true });
  const description = 'MEETUI01 只更新会议信息';
  await metadata.getByLabel(/^备注/).fill(description);
  await mutate('PATCH', resource, () => metadataSave.click());
  await page.getByRole('status').filter({ hasText: '会议信息已保存' }).waitFor();
  const persisted = await read();
  assert.equal(persisted.description, description);
  assert.deepEqual(persisted.imports, stored.imports);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '会议档案', exact: true }).click();
  await details.getByRole('heading', { name: newTitle, exact: true }).waitFor();
  await details.getByText(description, { exact: true }).waitFor();
  await groupSummary.click();
  await minutes.getByText('人工核对后补充渠道范围。', { exact: false }).waitFor();
  evidence.checks.push('M05 metadata footer PATCH feedback and app refresh; meeting originals and editable text still present');

  const confirmDelete = minutes.getByLabel(/^我确认删除全部/);
  for (const width of [1440, 390]) {
    await resize(width);
    assert.ok(await minutes.evaluate(node => document.documentElement.scrollWidth <= innerWidth && node.scrollWidth <= node.clientWidth + 1));
    const [saveBox, clearBox] = await Promise.all([save.boundingBox(), clear.boundingBox()]);
    assert.ok(saveBox.y >= clearBox.y + clearBox.height, '纪要保存栏应在删除确认区之后');
    assert.equal(await clear.isDisabled(), true);
    const inactive = await effectiveContrast(clear, 'disabled');
    await capture(minutes, `disabled-${width}`);
    await confirmDelete.check();
    assert.equal(await clear.isEnabled(), true);
    const active = await effectiveContrast(clear, 'enabled');
    assert.notDeepEqual([active.color, active.background], [inactive.color, inactive.background]);
    await confirmDelete.focus();
    await page.keyboard.press('Tab');
    assert.equal(await clear.evaluate(node => document.activeElement === node && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'), true);
    await capture(minutes, `confirmed-${width}`);
    await confirmDelete.uncheck();
  }
  const beforeDelete = mutationCount();
  await clear.evaluate(element => element.click());
  assert.equal(mutationCount(), beforeDelete);
  assert.equal((await read()).imports.length, 2);
  await confirmDelete.check();
  await holdMutation('DELETE', resource + '/minutes', () => clear.click(), async () => {
    assert.equal(await clear.isDisabled(), true);
    for (const width of [390, 1440]) {
      await resize(width);
      await effectiveContrast(clear, 'processing');
      await capture(minutes, `delete-processing-${width}`);
    }
  });
  await listCount(0);
  assert.equal((await read()).imports.length, 0);
  assert.equal(await clear.count(), 0);
  const restricted = await api('/api/meetings/' + session.fixtures.meetingIds.Restricted);
  await open(restricted.title);
  assert.equal(await button('上传文件').count(), 0);
  assert.equal(await minutes.getByRole('button', { name: '保存会议档案', exact: true, disabled: false }).count(), 0);
  evidence.checks.push('M01 readable disabled/enabled/processing delete and focus at wide/narrow sizes; M04 only confirmed delete writes, Restricted has no usable local save');
  assert.deepEqual(await api('/api/raw'), rawBaseline);
  evidence.providerCallsDuringReview = (await api('/__control/counters')).provider - counters.provider;
  assert.equal(evidence.providerCallsDuringReview, 0);
  assert.deepEqual(evidence.pageErrors, []);
  evidence.success = true;
  console.log(JSON.stringify({ chrome: browser.version(), checks: evidence.checks, contrast: evidence.contrast }, null, 2));
}

try {
  await run();
} catch (error) {
  evidence.failure = error.stack;
  if (page) await capture(page, 'failure');
  throw error;
} finally {
  if (browser) {
    evidence.chrome = browser.version();
    await browser.close();
  }
  if (service.exitCode === null && service.signalCode === null) service.kill();
  await stopped;
  await writeFile(path.join(temp, 'service.log'), serverLog);
  await writeFile(path.join(output, 'review-browser.json'), JSON.stringify(evidence, null, 2));
}
