import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
// B03 construction self-check over the real public HTTP interface.
// Runs its own isolated server + data directory on a free port; the user's data directory
// and any unknown process are never touched.
//   node tests/acceptance/b03-http.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'tests', 'fixtures', 'b03');
const runTag = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const evidencePath = path.join(root, 'docs/reports/B03-api-evidence.json');
const archivedEvidencePath = path.join(root, `docs/reports/B03-api-${runTag}.json`);
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fmcg-b03-selfcheck-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const report = {
  startedAt: new Date().toISOString(), dataRoot, evidencePath, archivedEvidencePath, version: {}, checks: [],
  notes: [
    'Isolated FMCG_DATA_DIR + own port; the user workspace was not imported into.',
    'Browser interaction is not covered here; the build report records it separately.',
  ],
};
async function filesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full)); else files.push(full);
  }
  return files;
}
async function fingerprint() {
  const result = {};
  const folders = ['app', 'server', 'services', 'rules', 'tests/fixtures/b03'];
  const files = ['package.json', 'package-lock.json', ...(await Promise.all(folders.map(folder => filesUnder(path.join(root, folder))))).flat().map(file => path.relative(root, file))];
  for (const rel of files.sort()) result[rel.replaceAll('\\', '/')] = hash(await readFile(path.join(root, rel)));
  return result;
}
report.version = await fingerprint();

let service;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const blocked = message => Object.assign(new Error(message), { blocked: true });
async function check(id, fn) {
  const started = Date.now();
  try { const evidence = await fn(); report.checks.push({ id, status: 'PASS', elapsedMs: Date.now() - started, evidence }); console.log(`PASS ${id}`); }
  catch (error) {
    report.checks.push({ id, status: error.blocked ? 'BLOCKED' : 'FAIL', elapsedMs: Date.now() - started, error: String(error.stack || error).slice(0, 5000) });
    console.log(`${error.blocked ? 'BLOCKED' : 'FAIL'} ${id}: ${error.message}`);
  }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).once('error', reject));
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return value;
}
async function start(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root, env: withoutInheritedEmbeddings({ ...process.env, FMCG_DATA_DIR: dir, FMCG_PORT: String(port) }),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = { child, base: `http://127.0.0.1:${port}`, dir, logs: '' };
  child.stdout.on('data', chunk => { result.logs += chunk; });
  child.stderr.on('data', chunk => { result.logs += chunk; });
  let startupError;
  child.on('error', error => { startupError = error; });
  let lastError;
  for (let i = 0; i < 100; i++) {
    if (startupError || child.exitCode !== null) throw blocked(`服务无法启动：${startupError || result.logs}`);
    try {
      const response = await fetch(`${result.base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).ok) return result;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  child.kill();
  throw blocked(`回环健康检查失败：${lastError?.message}；${result.logs}`);
}
async function stop() {
  if (!service) return;
  const current = service;
  service = undefined;
  if (current.child.exitCode !== null) return;
  const done = once(current.child, 'exit');
  let timeout;
  try {
    current.child.kill();
    await Promise.race([done, new Promise((_, reject) => { timeout = setTimeout(() => reject(blocked('服务未能停止')), 8000); })]);
  } finally { clearTimeout(timeout); }
}
async function request(url, { method = 'GET', value } = {}) {
  const response = await fetch(`${service.base}${url}`, {
    method, ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let json;
  if (text && response.headers.get('content-type')?.includes('json')) json = JSON.parse(text);
  return { status: response.status, json, text };
}
async function upload(fileName, bytes, metadata, { field = 'file', extra } = {}) {
  const form = new FormData();
  if (metadata !== undefined) form.append('metadata', typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  if (bytes !== undefined) form.append(field, new Blob([bytes]), fileName);
  if (extra) form.append(extra.field, new Blob([extra.bytes]), extra.fileName);
  const response = await fetch(`${service.base}/api/raw/import`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  let json;
  if (text && response.headers.get('content-type')?.includes('json')) json = JSON.parse(text);
  return { status: response.status, json, text };
}
/** Sends a multipart body over a raw socket so a mid-upload rejection is still observable. */
function rawMultipart(body, boundary) {
  const target = new URL(`${service.base}/api/raw/import`);
  return new Promise((resolve, reject) => {
    let status;
    let text = '';
    let responseStarted = false;
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const finish = socketError => {
      let json;
      try { json = JSON.parse(text); } catch { json = undefined; }
      settle(resolve, { status, json, text, socketError });
    };
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) } },
    response => {
      responseStarted = true;
      status = response.statusCode;
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => finish());
      response.on('error', error => finish(error.code));
      response.on('aborted', () => finish('aborted'));
    });
    // Rejecting an over-limit upload closes the socket while the client is still writing;
    // whatever the server already answered is the evidence, so a write error is not fatal.
    req.on('error', error => { if (responseStarted) finish(error.code); else settle(reject, error); });
    req.write(body);
    req.end();
  });
}
const fixture = name => readFile(path.join(fixtures, name));
/** Hand-built multipart body: a hostile client can send any file name, unlike browser FormData. */
function multipartBody({ fileName, bytes, metadata, boundary }) {
  const head = Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\ncontent-type: application/octet-stream\r\n\r\n`, 'utf8');
  return Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
}
const assetDir = () => path.join(service.dir, 'knowledge', 'raw', 'assets');
async function assetNames() { return (await readdir(assetDir()).catch(() => [])).sort(); }
async function allAssetRecords() {
  const names = (await assetNames()).filter(name => name.endsWith('.json'));
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(assetDir(), name), 'utf8'))));
}
async function rawList() { const response = await request('/api/raw'); assert.equal(response.status, 200); return response.json.items; }
async function stats() { const response = await request('/api/stats'); assert.equal(response.status, 200); return response.json; }
async function rawFile(id) {
  const folders = ['articles', 'reports', 'company', 'customer', 'meetings', 'notes', 'other'];
  for (const folder of folders) {
    const file = path.join(service.dir, 'knowledge', 'raw', folder, `${id}.md`);
    if (await stat(file).then(() => true, () => false)) return { file, text: await readFile(file, 'utf8') };
  }
  return undefined;
}
function frontmatter(text) {
  assert.match(text, /^---\r?\n/);
  const rest = text.slice(text.indexOf('\n') + 1);
  const closing = /^---\r?\n/m.exec(rest);
  assert.ok(closing, 'frontmatter 必须闭合');
  const metadata = yaml.load(rest.slice(0, closing.index));
  for (const key of ['importedAt']) if (metadata[key] instanceof Date) metadata[key] = metadata[key].toISOString();
  return { metadata, body: rest.slice(closing.index + closing[0].length) };
}
const standardMetadata = (title, extra = {}) => ({ title, sourceType: 'report', sourceName: 'B03 自检来源', author: '自检', publishedAt: '2026-10-01', url: 'https://example.com/b03', tags: ['自检', 'b03'], ...extra });
const strip = value => value.replace(/\s+/gu, '');
function expectFailure(result, status, code) {
  assert.equal(result.status, status, `期望 HTTP ${status}，实际 ${result.status}：${result.text.slice(0, 300)}`);
  assert.equal(result.json?.error?.code, code, `期望错误码 ${code}，实际 ${result.json?.error?.code}：${result.text.slice(0, 300)}`);
  assert.ok(result.json?.error?.message?.length >= 6, '必须给出可读的错误说明');
  return result.json.error;
}

const state = {};
let wikiSchema;

try {
  service = await start(path.join(dataRoot, 'main'));

  await check('B03-01-health-empty-baseline', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    const before = await stats();
    assert.deepEqual([before.rawCount, before.wikiCount, before.thisWeekNewCount, before.openAuditCount, before.promptCount], [0, 0, 0, 0, 0]);
    assert.deepEqual(await rawList(), []);
    assert.deepEqual(await assetNames(), []);
    return { health: health.json, stats: before, dataDir: service.dir };
  });

  await check('B03-02-regression-paste-text-import', async () => {
    const body = '  \n粘贴回归：中文正文包含 --- 分隔线\n第二行\r\n尾随空格  ';
    const created = await request('/api/raw', { method: 'POST', value: { title: '粘贴回归资料', sourceType: 'meeting', sourceName: '回归', tags: ['回归'], body } });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.body, body);
    assert.equal(created.json.assetId, undefined, '粘贴导入没有原件关联');
    assert.equal(created.json.bodySha256, hash(Buffer.from(body, 'utf8')));
    const single = await request(`/api/raw/${created.json.id}`);
    assert.equal(single.status, 200);
    assert.deepEqual(single.json, created.json);
    const summary = await request('/api/raw?summary=true');
    assert.equal(summary.json.items.length, 1);
    assert.equal('body' in summary.json.items[0], false);
    assert.equal((await stats()).rawCount, 1);
    state.pastedRaw = created.json;
    return { id: created.json.id, bodySha256: created.json.bodySha256 };
  });

  await check('B03-03-import-markdown-file', async () => {
    const bytes = await fixture('zh-report.md');
    const result = await upload('zh-report.md', bytes, standardMetadata('渠道动销分析（文件）', { sourceType: 'article' }));
    assert.equal(result.status, 201, result.text);
    const { raw, asset, extraction } = result.json;
    const expected = bytes.toString('utf8');
    assert.equal(raw.body, expected, 'Markdown 正文必须与文件内容逐字符一致');
    assert.equal(raw.assetId, asset.id);
    assert.equal(raw.assetFileName, 'zh-report.md');
    assert.equal(raw.assetFormat, 'markdown');
    assert.equal(raw.assetByteSize, bytes.length);
    assert.equal(raw.assetSha256, hash(bytes));
    assert.equal(asset.status, 'parsed');
    assert.equal(asset.rawId, raw.id);
    assert.equal(extraction.bodyChars, expected.length);
    const stored = await readFile(path.join(assetDir(), asset.storedFile));
    assert.ok(stored.equals(bytes), '原件字节必须原样落盘');
    assert.equal(hash(stored), asset.sha256);
    const disk = await rawFile(raw.id);
    assert.ok(disk, 'Raw 文件必须落在 knowledge/raw/<type>/');
    assert.match(disk.text, /assetId:/);
    const record = frontmatter(disk.text);
    assert.equal(record.metadata.assetId, asset.id);
    assert.equal(record.metadata.assetFormat, 'markdown');
    assert.ok(record.body.startsWith('  \r\n# 渠道动销分析'), '首部空白与 CRLF 必须保留');
    assert.ok(record.body.endsWith('  \n'), '尾部空白必须保留');
    state.markdownRaw = raw;
    return { rawId: raw.id, assetId: asset.id, byteSize: bytes.length, sha256: asset.sha256, storedFile: asset.storedFile, parser: extraction.parser };
  });

  await check('B03-04-import-txt-whitespace-and-bom', async () => {
    const bytes = await fixture('zh-notes.txt');
    const result = await upload('zh-notes.txt', bytes, standardMetadata('会议纪要（TXT）', { sourceType: 'meeting' }));
    assert.equal(result.status, 201, result.text);
    assert.equal(result.json.raw.body, bytes.toString('utf8'));
    assert.ok(result.json.raw.body.startsWith('  \n\n会议纪要'));
    assert.ok(result.json.raw.body.endsWith('\n\n'));
    assert.ok(result.json.raw.body.includes('\r\n'), '混合换行必须原样保留');
    const bom = await upload('bom-notes.txt', await fixture('bom-notes.txt'), standardMetadata('BOM 样本', { sourceType: 'note' }));
    assert.equal(bom.status, 201, bom.text);
    assert.equal(bom.json.raw.body.charCodeAt(0), '带'.charCodeAt(0), 'UTF-8 BOM 必须被去除');
    assert.equal(bom.json.raw.body, '带 BOM 的 TXT 样本\r\n第二行\n  \n');
    state.txtRaw = result.json.raw;
    state.bomRaw = bom.json.raw;
    return { txtId: result.json.raw.id, bomId: bom.json.raw.id, charCount: result.json.raw.body.length };
  });

  await check('B03-05-import-docx-real-parser', async () => {
    const bytes = await fixture('zh-report.docx');
    const result = await upload('zh-report.docx', bytes, standardMetadata('经销商报告（DOCX）'));
    assert.equal(result.status, 201, result.text);
    const { raw, asset, extraction } = result.json;
    assert.equal(raw.assetFormat, 'docx');
    assert.match(extraction.parser, /^mammoth /);
    assert.equal(extraction.note.includes('mammoth'), true);
    for (const line of ['经销商库存周转动销分析报告', '报告编号：FMCG-B03-001', '华东区经销商平均库存周转天数为 38 天，动销率 62%。', '建议将安全库存下调 10%，并每周复核补货节奏。']) {
      assert.ok(raw.body.includes(line), `DOCX 提取正文缺少：${line}`);
    }
    assert.ok(raw.body.split('\n\n').length >= 6, '段落之间应以空行分隔');
    assert.equal(hash(await readFile(path.join(assetDir(), asset.storedFile))), hash(bytes));
    state.docxRaw = raw;
    return { rawId: raw.id, parser: extraction.parser, bodyChars: extraction.bodyChars, note: extraction.note };
  });

  await check('B03-06-import-pdf-text-real-parser', async () => {
    const bytes = await fixture('zh-report.pdf');
    const result = await upload('zh-report.pdf', bytes, standardMetadata('经销商报告（PDF）'));
    assert.equal(result.status, 201, result.text);
    const { raw, asset, extraction } = result.json;
    assert.equal(raw.assetFormat, 'pdf');
    assert.match(extraction.parser, /^pdfjs-dist \d/);
    const flat = strip(raw.body);
    for (const line of ['经销商库存周转动销分析报告', '一、背景', '华东区经销商平均库存周转天数为 38 天，动销率 62%。', '建议将安全库存下调 10%，并每周复核补货节奏。']) {
      assert.ok(flat.includes(strip(line)), `PDF 提取正文缺少：${line}`);
    }
    assert.match(extraction.note, /共 1 页/);
    assert.equal(hash(await readFile(path.join(assetDir(), asset.storedFile))), hash(bytes));
    state.pdfRaw = raw;
    return { rawId: raw.id, parser: extraction.parser, bodyChars: extraction.bodyChars, note: extraction.note };
  });

  await check('B03-07-failure-matrix-keeps-original-and-adds-no-raw', async () => {
    const baseline = (await stats()).rawCount;
    const baselineAssets = (await assetNames()).length;
    const cases = [
      ['empty.txt', '.txt', 400, 'EMPTY_FILE'],
      ['blank.txt', '.txt', 422, 'EMPTY_CONTENT'],
      ['broken.docx', '.docx', 422, 'DOCX_INVALID'],
      ['broken.pdf', '.pdf', 422, 'PDF_INVALID'],
      ['scan-image.pdf', '.pdf', 422, 'PDF_NO_TEXT'],
      ['fake-docx.docx', '.docx', 415, 'FORMAT_MISMATCH'],
      ['fake-pdf.pdf', '.pdf', 415, 'FORMAT_MISMATCH'],
      ['gbk-notes.txt', '.txt', 415, 'UNSUPPORTED_ENCODING'],
      ['logo.png', '.png', 415, 'UNSUPPORTED_FORMAT'],
    ];
    const observed = [];
    for (const [name, extension, status, code] of cases) {
      const bytes = await fixture(name);
      const result = await upload(name, bytes, standardMetadata(`失败样本 ${name}`));
      const error = expectFailure(result, status, code);
      assert.equal(error.details?.retained, true, `${name} 必须报告原件已保留`);
      assert.equal(error.details?.sha256, hash(bytes), `${name} 原件哈希必须与源文件一致`);
      assert.equal(error.details?.byteSize, bytes.length);
      assert.match(error.message, /原件已保留/);
      const record = (await allAssetRecords()).find(item => item.id === error.details.assetId);
      assert.ok(record, `${name} 必须写入失败记录`);
      assert.equal(record.status, 'parse_failed');
      assert.equal(record.failure?.code, code);
      assert.equal(record.rawId, undefined);
      assert.ok((await readFile(path.join(assetDir(), record.storedFile))).equals(bytes), `${name} 原件字节必须完整保留`);
      observed.push({ file: name, status, code, assetId: record.id, storedFile: record.storedFile, sha256: record.sha256 });
    }
    assert.equal((await stats()).rawCount, baseline, '失败不得增加正式 Raw');
    assert.equal((await rawList()).length, baseline);
    assert.equal((await assetNames()).length, baselineAssets + cases.length * 2, '每个失败样本保留原件与失败记录');
    // Refresh/restart must still explain every retained original.
    const afterReload = await request('/api/raw/assets');
    assert.equal(afterReload.status, 200);
    assert.equal(afterReload.json.items.filter(item => item.status === 'parse_failed').length, cases.length);
    return { observed, baselineRawCount: baseline, assetCount: (await assetNames()).length };
  });

  await check('B03-08-oversize-rejected-while-receiving', async () => {
    const baselineAssets = (await assetNames()).length;
    const baselineRaw = (await stats()).rawCount;
    const payload = Buffer.alloc(21 * 1024 * 1024, 0x61);
    const boundary = '----fmcgB03Oversize';
    const head = Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(standardMetadata('超限文件'))}\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="oversize.txt"\r\ncontent-type: text/plain\r\n\r\n`, 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const result = await rawMultipart(Buffer.concat([head, payload, tail]), boundary);
    const error = expectFailure(result, 413, 'FILE_TOO_LARGE');
    assert.equal(error.details?.retained, false, '接收阶段拒绝：不保留原件');
    assert.equal(error.details?.limitBytes, 20 * 1024 * 1024);
    assert.equal((await assetNames()).length, baselineAssets);
    assert.equal((await stats()).rawCount, baselineRaw);
    return { status: result.status, code: error.code, message: error.message, limitBytes: error.details.limitBytes, payloadBytes: payload.length };
  });

  await check('B03-09-body-limit-retains-original-without-raw', async () => {
    const bytes = Buffer.from('快'.repeat(500_001), 'utf8');
    const result = await upload('long.txt', bytes, standardMetadata('超长正文'));
    const error = expectFailure(result, 413, 'BODY_TOO_LARGE');
    assert.equal(error.details?.retained, true);
    assert.equal(error.details?.byteSize, bytes.length);
    const record = (await allAssetRecords()).find(item => item.id === error.details.assetId);
    assert.equal(record?.failure?.code, 'BODY_TOO_LARGE');
    assert.ok((await readFile(path.join(assetDir(), record.storedFile))).equals(bytes));
    assert.equal((await rawList()).some(item => item.title === '超长正文'), false);
    return { code: error.code, message: error.message, assetId: record.id, bytes: bytes.length };
  });

  await check('B03-10-upload-request-errors', async () => {
    const noFile = await upload('none.txt', undefined, standardMetadata('缺少文件'));
    expectFailure(noFile, 400, 'MISSING_FILE');
    const badJson = await upload('zh-report.md', await fixture('zh-report.md'), '{不是 JSON');
    expectFailure(badJson, 400, 'INVALID_METADATA');
    const badType = await upload('zh-report.md', await fixture('zh-report.md'), standardMetadata('类型错误', { sourceType: 'not-a-type' }));
    expectFailure(badType, 400, 'INVALID_SOURCE_TYPE');
    const badUrl = await upload('zh-report.md', await fixture('zh-report.md'), standardMetadata('链接错误', { url: 'javascript:alert(1)' }));
    expectFailure(badUrl, 400, 'INVALID_URL');
    const wrongField = await upload('zh-report.md', await fixture('zh-report.md'), standardMetadata('字段名错误'), { field: 'upload' });
    expectFailure(wrongField, 400, 'INVALID_UPLOAD');
    const twoFiles = await upload('zh-report.md', await fixture('zh-report.md'), standardMetadata('两个文件'),
      { extra: { field: 'file', bytes: await fixture('zh-notes.txt'), fileName: 'zh-notes.txt' } });
    expectFailure(twoFiles, 400, 'INVALID_UPLOAD');
    const noBoundary = await fetch(`${service.base}/api/raw/import`, {
      method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'not multipart at all', signal: AbortSignal.timeout(10000),
    });
    assert.equal(noBoundary.status, 400, `无 boundary 的请求应被拒绝，实际 ${noBoundary.status}`);
    const noBoundaryJson = JSON.parse(await noBoundary.text());
    assert.equal(noBoundaryJson.error.code, 'INVALID_UPLOAD');
    return { codes: ['MISSING_FILE', 'INVALID_METADATA', 'INVALID_SOURCE_TYPE', 'INVALID_URL', 'INVALID_UPLOAD', 'INVALID_UPLOAD', noBoundaryJson.error.code] };
  });

  await check('B03-11-not-found-responses', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expectFailure(await request(`/api/raw/${missing}`), 404, 'NOT_FOUND');
    expectFailure(await request(`/api/raw/${missing}/references`), 404, 'NOT_FOUND');
    expectFailure(await request(`/api/raw/${missing}`, { method: 'DELETE' }), 404, 'NOT_FOUND');
    expectFailure(await request('/api/raw/not-a-uuid'), 404, 'NOT_FOUND');
    expectFailure(await request(`/api/raw/not-a-uuid`, { method: 'DELETE' }), 404, 'NOT_FOUND');
    return { missing };
  });

  await check('B03-12-duplicate-import-creates-independent-records', async () => {
    const bytes = await fixture('zh-notes.txt');
    const metadata = standardMetadata('重复资料', { sourceType: 'note' });
    const first = await upload('zh-notes.txt', bytes, metadata);
    assert.equal(first.status, 201, first.text);
    const firstFile = await rawFile(first.json.raw.id);
    const beforeHash = hash(Buffer.from(firstFile.text, 'utf8'));
    const second = await upload('zh-notes.txt', bytes, metadata);
    assert.equal(second.status, 201, second.text);
    assert.notEqual(first.json.raw.id, second.json.raw.id);
    assert.notEqual(first.json.asset.id, second.json.asset.id);
    assert.equal(first.json.asset.sha256, second.json.asset.sha256);
    assert.equal(hash(Buffer.from((await rawFile(first.json.raw.id)).text, 'utf8')), beforeHash, '旧记录不得被覆盖');
    assert.equal((await stats()).rawCount, (await rawList()).length);
    state.duplicateRaw = first.json.raw;
    return { firstId: first.json.raw.id, secondId: second.json.raw.id, firstFileHash: beforeHash, identicalSha256: first.json.asset.sha256 };
  });

  await check('B03-13-original-file-name-is-metadata-only', async () => {
    const bytes = await fixture('zh-report.md');
    // Browser FormData strips path separators from the file name, so a hostile name is sent raw.
    const boundary = '----fmcgB03HostileName';
    const hostile = await rawMultipart(multipartBody({
      fileName: '../../evil<script>.md', bytes, boundary,
      metadata: { sourceType: 'note', sourceName: '路径样本' },
    }), boundary);
    assert.equal(hostile.status, 201, hostile.text);
    assert.equal(hostile.json.raw.title, 'evil<script>', '标题必须去掉路径部分');
    // busboy/multer already drops directory components from multipart file names; the server
    // additionally derives the title without path parts. The stored name is never the input name.
    assert.equal(hostile.json.raw.assetFileName, 'evil<script>.md', 'multipart 解析会去掉原文件名中的目录部分');
    assert.equal(hostile.json.raw.sourceName, '路径样本');
    assert.equal(hostile.json.asset.storedFile, `${hostile.json.asset.id}.md`);
    assert.match(path.basename((await rawFile(hostile.json.raw.id)).file), /^[0-9a-f-]{36}\.md$/);
    assert.equal(await stat(path.join(dataRoot, 'evil<script>.md')).then(() => true, () => false), false, '不得写出数据目录');
    assert.equal(await stat(path.join(service.dir, '..', 'evil<script>.md')).then(() => true, () => false), false);
    assert.equal(await stat(path.join(service.dir, 'knowledge', 'evil<script>.md')).then(() => true, () => false), false);
    assert.equal(await stat(path.join(service.dir, 'knowledge', 'raw', 'evil<script>.md')).then(() => true, () => false), false);
    const folders = await readdir(path.join(service.dir, 'knowledge', 'raw'));
    assert.deepEqual(folders.sort(), ['articles', 'assets', 'company', 'customer', 'meetings', 'notes', 'other', 'reports']);
    // A user-supplied title containing path characters stays text metadata and never a path.
    const pathTitle = await upload('路径标题.txt', Buffer.from('路径标题正文', 'utf8'), { title: '..\\..\\evil-title', sourceType: 'note', sourceName: '路径标题来源' });
    assert.equal(pathTitle.status, 201, pathTitle.text);
    assert.equal(pathTitle.json.raw.title, '..\\..\\evil-title');
    assert.match(path.basename((await rawFile(pathTitle.json.raw.id)).file), /^[0-9a-f-]{36}\.md$/);
    assert.equal(await stat(path.join(dataRoot, 'evil-title.md')).then(() => true, () => false), false);
    assert.equal(await stat(path.join(service.dir, 'evil-title.md')).then(() => true, () => false), false);
    const html = await upload('标题样本.txt', Buffer.from('HTML 标题样本正文', 'utf8'), { title: '<img src=x onerror=alert(1)>渠道', sourceType: 'note', sourceName: '<b>来源</b>' });
    assert.equal(html.status, 201, html.text);
    assert.equal(html.json.raw.title, '<img src=x onerror=alert(1)>渠道');
    const reread = await request(`/api/raw/${html.json.raw.id}`);
    assert.equal(reread.json.title, '<img src=x onerror=alert(1)>渠道', 'HTML 标题只作为文本元数据');
    const chinese = await upload('中文资料.md', Buffer.from('中文文件名正文', 'utf8'), { sourceType: 'note' });
    assert.equal(chinese.status, 201, chinese.text);
    assert.equal(chinese.json.raw.assetFileName, '中文资料.md', '中文文件名必须按 UTF-8 解析');
    return { traversalTitle: hostile.json.raw.title, storedFile: hostile.json.asset.storedFile, htmlTitle: html.json.raw.title, chineseFileName: chinese.json.raw.assetFileName };
  });

  await check('B03-14-wiki-reference-listing-and-delete-blocked', async () => {
    const target = state.markdownRaw;
    const schema = await request('/api/wiki/schema');
    wikiSchema = schema.json;
    const category = wikiSchema.categories[0].id;
    const referencesBefore = await request(`/api/raw/${target.id}/references`);
    assert.equal(referencesBefore.status, 200);
    assert.deepEqual(referencesBefore.json.items, []);
    const created = await request('/api/wiki', { method: 'POST', value: {
      title: '来源引用验收页', type: 'source', category, sources: [target.id], tags: ['验收'], aliases: [],
      knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed',
      body: '## 摘要\n\n来自文件导入的 Raw。\n',
    } });
    assert.equal(created.status, 201, created.text);
    const references = await request(`/api/raw/${target.id}/references`);
    assert.equal(references.status, 200);
    assert.deepEqual(references.json.items.map(item => ({ id: item.id, title: item.title })), [{ id: created.json.id, title: created.json.title }]);
    const blocked = await request(`/api/raw/${target.id}`, { method: 'DELETE' });
    const error = expectFailure(blocked, 409, 'RAW_REFERENCED');
    assert.deepEqual(error.details.references.map(item => item.id), [created.json.id]);
    assert.match(error.message, /解除/);
    assert.ok(await request(`/api/raw/${target.id}`).then(response => response.status === 200), '被引用 Raw 必须仍然存在');
    assert.ok((await rawList()).some(item => item.id === target.id));
    state.referencingWiki = created.json;
    state.referencedRaw = target;
    return { rawId: target.id, wikiId: created.json.id, status: blocked.status, code: error.code, references: error.details.references };
  });

  await check('B03-15-delete-unreferenced-raw-keeps-original', async () => {
    const doomed = await upload('doomed.txt', await fixture('zh-notes.txt'), standardMetadata('待删除资料', { sourceType: 'other' }));
    assert.equal(doomed.status, 201, doomed.text);
    const id = doomed.json.raw.id;
    const assetId = doomed.json.asset.id;
    const before = await stats();
    const deleted = await request(`/api/raw/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.json.id, id);
    assert.equal(deleted.json.assetRetained, true);
    assert.equal(deleted.json.assetId, assetId);
    assert.equal((await request(`/api/raw/${id}`)).status, 404);
    assert.equal((await rawList()).some(item => item.id === id), false, '删除后不得出现在列表');
    const after = await stats();
    assert.equal(after.rawCount, before.rawCount - 1, '删除后统计必须减少');
    assert.equal(after.thisWeekNewCount, before.thisWeekNewCount - 1);
    assert.equal(await rawFile(id), undefined, 'Raw 文件必须被删除');
    const record = await request('/api/raw/assets').then(response => response.json.items.find(item => item.id === assetId));
    assert.ok(record, '原件记录必须保留');
    assert.equal(record.status, 'detached');
    assert.ok((await stat(path.join(assetDir(), record.storedFile))).size > 0, '原件字节必须保留（本批不清理原件）');
    state.deletedRawId = id;
    return { id, assetId, statsBefore: before.rawCount, statsAfter: after.rawCount, assetStatus: record.status };
  });

  await check('B03-16-wiki-save-rejects-deleted-raw-source', async () => {
    const category = wikiSchema.categories[0].id;
    const response = await request('/api/wiki', { method: 'POST', value: {
      title: '坏来源尝试', type: 'concept', category, sources: [state.deletedRawId], tags: [], aliases: [],
      knowledge_status: 'source_supported', confidence: 'low', source_level: 'D', review_status: 'unreviewed', body: '## 定义\n\n不应成功。\n',
    } });
    expectFailure(response, 400, 'INVALID_SOURCE');
    const references = await request(`/api/raw/${state.deletedRawId}/references`);
    assert.equal(references.status, 404);
    const pages = await request('/api/wiki').then(result => result.json.items);
    assert.equal(pages.some(page => page.title === '坏来源尝试'), false, '不得留下坏来源页面');
    return { status: response.status, code: response.json.error.code, wikiCount: pages.length };
  });

  await check('B03-17-reimport-creates-new-id-and-keeps-old', async () => {
    const original = state.markdownRaw;
    const originalFile = await rawFile(original.id);
    const beforeHash = hash(Buffer.from(originalFile.text, 'utf8'));
    const result = await upload('zh-report.md', await fixture('zh-report.md'), {
      title: original.title, sourceType: original.sourceType, sourceName: original.sourceName,
      author: original.author, publishedAt: original.publishedAt, url: original.url, tags: original.tags,
    });
    assert.equal(result.status, 201, result.text);
    assert.notEqual(result.json.raw.id, original.id);
    assert.equal(result.json.raw.title, original.title);
    assert.equal(result.json.raw.body, original.body);
    assert.equal(hash(Buffer.from((await rawFile(original.id)).text, 'utf8')), beforeHash, '旧记录必须保持不变');
    const old = await request(`/api/raw/${original.id}`);
    assert.equal(old.status, 200);
    assert.equal(old.json.assetId, original.assetId, '旧记录的来源关联不得转移');
    const newRecord = frontmatter((await rawFile(result.json.raw.id)).text);
    assert.equal(newRecord.metadata.assetId, result.json.asset.id);
    state.reimportedRaw = result.json.raw;
    return { oldId: original.id, newId: result.json.raw.id, oldFileHash: beforeHash, newAssetId: result.json.asset.id };
  });

  await check('B03-18-real-persistence-failure-reports-no-fake-success', async () => {
    const rawSnapshot = await filesUnder(path.join(service.dir, 'knowledge', 'raw', 'articles')).then(files => files.map(file => path.basename(file)).sort());
    const wikiSnapshot = await filesUnder(path.join(service.dir, 'knowledge', 'wiki')).then(files => files.map(file => path.basename(file)).sort());
    const beforeStats = await stats();

    // (a) original-file storage fails: assets path is occupied by a file, not a directory.
    const assetsDir = assetDir();
    const assetsBackup = path.join(service.dir, 'assets-backup');
    await rename(assetsDir, assetsBackup);
    await writeFile(assetsDir, 'blocked');
    let storageFailure;
    try {
      storageFailure = await upload('zh-notes.txt', await fixture('zh-notes.txt'), standardMetadata('原件写入失败'));
    } finally {
      await unlink(assetsDir);
      await rename(assetsBackup, assetsDir);
    }
    const storageError = expectFailure(storageFailure, 500, 'ASSET_WRITE_FAILED');
    assert.equal(storageError.details?.retained, false);
    assert.equal((await stats()).rawCount, beforeStats.rawCount, '原件写入失败不得创建 Raw');

    // (b) Raw persistence fails: the target folder is occupied by a file.
    // The company folder is used because it holds no successful Raw, so blocking it cannot
    // destroy earlier evidence (a real failure injection, not a mock).
    const companyDir = path.join(service.dir, 'knowledge', 'raw', 'company');
    await rm(companyDir, { recursive: true, force: true });
    await writeFile(companyDir, 'blocked');
    let rawFailure;
    try {
      rawFailure = await upload('zh-notes.txt', await fixture('zh-notes.txt'), standardMetadata('Raw 写入失败', { sourceType: 'company' }));
    } finally {
      await unlink(companyDir);
      await mkdir(companyDir, { recursive: true });
    }
    const rawError = expectFailure(rawFailure, 500, 'RAW_WRITE_FAILED');
    assert.equal(rawError.details?.retained, true, '提取成功但写入失败时必须报告原件已保留');
    assert.match(rawError.message, /原件已保留/);
    const failedRecord = (await allAssetRecords()).find(item => item.id === rawError.details.assetId);
    assert.equal(failedRecord?.status, 'parse_failed');
    assert.equal(failedRecord?.failure?.code, 'RAW_WRITE_FAILED');

    // (c) recovery: the same file imports fine once the folder is writable again.
    const recovered = await upload('zh-notes.txt', await fixture('zh-notes.txt'), standardMetadata('恢复后导入', { sourceType: 'company' }));
    assert.equal(recovered.status, 201, recovered.text);
    const afterStats = await stats();
    assert.equal(afterStats.rawCount, beforeStats.rawCount + 1, '只有恢复后的成功导入增加 Raw');
    assert.deepEqual(await filesUnder(path.join(service.dir, 'knowledge', 'raw', 'articles')).then(files => files.map(file => path.basename(file)).sort()), rawSnapshot, '已成功的 Raw 不受破坏');
    assert.deepEqual(await filesUnder(path.join(service.dir, 'knowledge', 'wiki')).then(files => files.map(file => path.basename(file)).sort()), wikiSnapshot, '已成功的 Wiki 不受破坏');
    state.recoveredRaw = recovered.json.raw;
    return { assetFailure: storageError.code, rawFailure: rawError.code, recoveredId: recovered.json.raw.id, rawCountBefore: beforeStats.rawCount, rawCountAfter: afterStats.rawCount };
  });

  await check('B03-19-restart-consistency-same-data-directory', async () => {
    const before = {
      raws: await rawList(), stats: await stats(),
      assets: await allAssetRecords(),
      references: await request(`/api/raw/${state.referencedRaw.id}/references`).then(result => result.json.items),
    };
    const beforeHashes = {};
    for (const item of before.raws) beforeHashes[item.id] = hash(Buffer.from((await rawFile(item.id)).text, 'utf8'));
    await stop();
    service = await start(path.join(dataRoot, 'main'));

    const afterRaws = await rawList();
    assert.deepEqual(afterRaws.map(item => item.id).sort(), before.raws.map(item => item.id).sort(), '重启后 Raw 集合必须一致');
    for (const item of before.raws) {
      const reloaded = await request(`/api/raw/${item.id}`);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.json.body, item.body, '重启后正文必须逐字符一致');
      assert.equal(reloaded.json.assetId, item.assetId);
      assert.equal(reloaded.json.assetFileName, item.assetFileName);
      assert.equal(reloaded.json.assetFormat, item.assetFormat);
      assert.equal(reloaded.json.assetByteSize, item.assetByteSize);
      assert.equal(reloaded.json.assetSha256, item.assetSha256);
      assert.equal(reloaded.json.bodySha256, item.bodySha256);
      assert.equal(hash(Buffer.from((await rawFile(item.id)).text, 'utf8')), beforeHashes[item.id], '重启后磁盘文件必须一致');
    }
    const afterStats = await stats();
    assert.equal(afterStats.rawCount, before.stats.rawCount);
    assert.equal(afterStats.wikiCount, before.stats.wikiCount);
    assert.equal(afterStats.thisWeekNewCount, before.stats.thisWeekNewCount);
    assert.equal((await request(`/api/raw/${state.deletedRawId}`)).status, 404, '删除结果在重启后保持');
    assert.equal(afterRaws.some(item => item.id === state.deletedRawId), false);
    const failedAfterRestart = (await request('/api/raw/assets?status=parse_failed')).json.items;
    assert.ok(failedAfterRestart.length >= 10, `失败记录应在重启后仍可解释，实际 ${failedAfterRestart.length}`);
    for (const record of failedAfterRestart) {
      assert.ok(record.failure?.code && record.failure?.message, '每条失败记录必须有原因');
      const file = path.join(assetDir(), record.storedFile);
      const stored = await readFile(file).catch(() => undefined);
      assert.ok(stored, `失败记录对应的原件缺失：${JSON.stringify({ id: record.id, storedFile: record.storedFile, code: record.failure?.code })}`);
      assert.equal(stored.length, record.byteSize, '重启后原件字节数一致');
      assert.equal(hash(stored), record.sha256, '重启后原件哈希一致');
    }
    const references = await request(`/api/raw/${state.referencedRaw.id}/references`);
    assert.deepEqual(references.json.items.map(item => item.id), before.references.map(item => item.id), '重启后 Wiki 引用关系一致');
    const wiki = await request(`/api/wiki/${state.referencingWiki.id}`);
    assert.equal(wiki.status, 200);
    assert.deepEqual(wiki.json.sources, [state.referencedRaw.id]);
    return {
      rawCount: afterRaws.length, stats: afterStats, retainedOriginals: (await assetNames()).length,
      failureRecordsAfterRestart: failedAfterRestart.length, deletedRawStatus: 404, references: references.json.items.length,
    };
  });

  await check('B03-20-home-stats-and-search-regression', async () => {
    const totals = await stats();
    const raws = await rawList();
    assert.equal(totals.rawCount, raws.length);
    assert.ok(totals.wikiCount >= 1);
    assert.ok(totals.thisWeekNewCount >= raws.length, '本批导入的 Raw 都应计入本周新增');
    const search = await request('/api/wiki?q=' + encodeURIComponent('来源引用'));
    assert.equal(search.status, 200);
    assert.ok(search.json.items.some(item => item.id === state.referencingWiki.id), 'B02 搜索仍可用');
    const exported = await request(`/api/wiki/${state.referencingWiki.id}/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.text, new RegExp(state.referencedRaw.id), '导出的 Markdown 仍保留来源 ID');
    const pdf = await request(`/api/raw/${state.pdfRaw.id}`);
    assert.equal(pdf.json.body, state.pdfRaw.body, 'PDF 提取正文在回归后仍一致');
    return { stats: totals, wikiSearchHits: search.json.items.length, exportBytes: exported.text.length };
  });

  await check('B03-21-concurrent-raw-delete-and-wiki-save-stay-consistent', async () => {
    const target = await upload('race.txt', Buffer.from('并发样本正文', 'utf8'), standardMetadata('并发样本资料', { sourceType: 'note' }));
    assert.equal(target.status, 201, target.text);
    const rawId = target.json.raw.id;
    const [wikiResult, deleteResult] = await Promise.all([
      request('/api/wiki', { method: 'POST', value: {
        title: '并发引用验收页', type: 'concept', category: wikiSchema.categories[0].id, sources: [rawId], tags: [], aliases: [],
        knowledge_status: 'source_supported', confidence: 'low', source_level: 'D', review_status: 'unreviewed', body: '## 定义\n\n并发保存与删除同时发生。\n',
      } }),
      request(`/api/raw/${rawId}`, { method: 'DELETE' }),
    ]);
    const rawExists = (await request(`/api/raw/${rawId}`)).status === 200;
    if (deleteResult.status === 200) {
      assert.notEqual(wikiResult.status, 201, `Raw 已删除，Wiki 不得保存成功：${wikiResult.text.slice(0, 200)}`);
      assert.equal(rawExists, false);
    } else {
      expectFailure(deleteResult, 409, 'RAW_REFERENCED');
      assert.equal(rawExists, true, '被引用时 Raw 必须保留');
      assert.equal(wikiResult.status, 201, `Raw 未被删除时 Wiki 保存应成功：${wikiResult.status} ${wikiResult.text.slice(0, 200)}`);
    }
    // Whatever the interleaving, no formal Wiki may point at a missing Raw.
    const pages = (await request('/api/wiki')).json.items;
    for (const page of pages) {
      for (const source of page.sources) {
        assert.equal((await request(`/api/raw/${source}`)).status, 200, `正式 Wiki「${page.title}」的来源 ${source} 必须存在`);
      }
    }
    const references = rawExists ? (await request(`/api/raw/${rawId}/references`)).json.items : [];
    return { wikiStatus: wikiResult.status, deleteStatus: deleteResult.status, rawExists, referencedBy: references.map(item => item.title) };
  });

  await check('B03-22-node-minimum-consistent-with-locked-dependencies', async () => {
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const pdfjs = JSON.parse(await readFile(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'));
    assert.equal(manifest.engines?.node, '>=22.13.0', 'package.json 必须声明真实的最低 Node 版本');
    assert.equal(readme.includes('Node.js 20 或更高'), false, 'README 不得声明依赖不支持的 Node 20');
    assert.match(readme, /Node\.js 22\.13 或更高/);
    assert.match(readme, new RegExp(pdfjs.version.replaceAll('.', '\\.')), 'README 必须记录锁定的 PDF 解析库版本');
    const declared = /(\d+)\.(\d+)/.exec(manifest.engines.node);
    const required = /(\d+)\.(\d+)/.exec(pdfjs.engines.node);
    assert.ok(Number(declared[1]) > Number(required[1]) || (Number(declared[1]) === Number(required[1]) && Number(declared[2]) >= Number(required[2])),
      `声明下限 ${manifest.engines.node} 必须满足依赖要求 ${pdfjs.engines.node}`);
    assert.match(readme, /Node v\d+\.\d+\.\d+/, 'README 必须如实记录实际验证的 Node 版本');
    const recorded = /Node (v\d+\.\d+\.\d+)/.exec(readme)?.[1];
    // The real PDF path must still work on the Node that is actually running this check.
    const result = await upload('zh-report.pdf', await fixture('zh-report.pdf'), standardMetadata('版本一致性 PDF'));
    assert.equal(result.status, 201, result.text);
    assert.equal(result.json.extraction.parser, `pdfjs-dist ${pdfjs.version}`);
    return { declaredMin: manifest.engines.node, pdfjsEngines: pdfjs.engines.node, pdfjsVersion: pdfjs.version, recordedTestedNode: recorded, runningNode: process.version, sameAsRecorded: recorded === process.version };
  });

  await check('B03-23-cross-file-link-failure-non-success-and-restart-recovery', async () => {
    // Reproduces the independent acceptance E03-12 fault: block the linkage record's second
    // write while the import is parsing, then repair the directory and restart.
    await stop();
    service = await start(path.join(dataRoot, 'cross-file'));
    const directory = assetDir();
    const bytes = await fixture('zh-report.pdf');
    const pending = upload('cross.pdf', bytes, standardMetadata('交叉文件故障样本'));
    let recordName;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      recordName = (await readdir(directory).catch(() => [])).find(name => /^[0-9a-f-]{36}\.json$/i.test(name));
      if (recordName) break;
      await delay(1);
    }
    assert.ok(recordName, '必须先观察到原件记录的首次写入');
    const target = path.join(directory, recordName);
    const backup = `${target}.selfcheck-backup`;
    await rename(target, backup);
    await mkdir(target);
    let result;
    try { result = await pending; }
    finally { await rename(target, `${target}.directory-blocker`); await rename(backup, target); }
    const error = expectFailure(result, 500, 'IMPORT_LINK_PENDING');
    assert.equal(error.details?.committed, true);
    assert.equal(error.details?.recoverable, true);
    assert.match(error.message, /正文已写入正式 Raw/);
    assert.equal(error.message.includes('未创建 Raw'), false, '不得声称未创建 Raw');
    assert.match(error.message, /不要重复导入/);
    assert.match(error.message, /自动补齐/);
    const rawId = String(error.details.rawId);
    const assetId = String(error.details.assetId);
    const committed = await request(`/api/raw/${rawId}`);
    assert.equal(committed.status, 200, '已提交的 Raw 必须可读');
    assert.equal(committed.json.assetId, assetId);
    const rawCountBefore = (await stats()).rawCount;
    const before = (await allAssetRecords()).find(item => item.id === assetId);
    assert.equal(before?.status, 'stored', '关联记录尚未写入');

    // Repair the directory and restart the same data directory: the linkage must be completed.
    const restartDir = service.dir;
    await stop();
    service = await start(restartDir);
    const repaired = (await allAssetRecords()).find(item => item.id === assetId);
    assert.equal(repaired?.status, 'parsed', '重启后必须自动补齐关联');
    assert.equal(repaired?.rawId, rawId);
    assert.equal(repaired?.parser, `pdfjs-dist ${JSON.parse(await readFile(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')).version}`);
    const committedAfter = await request(`/api/raw/${rawId}`);
    assert.equal(repaired?.extractionNote, committedAfter.json.extractionNote, '补齐的关联必须与 Raw frontmatter 的提取说明完全一致');
    assert.equal(repaired?.format, committedAfter.json.assetFormat);
    assert.match(String(repaired?.extractionNote), /页/, '补齐的关联必须带上真实的提取边界说明');
    assert.equal((await stats()).rawCount, rawCountBefore, '对账不得新增或删除 Raw');
    const raws = await rawList();
    assert.equal(raws.filter(item => item.assetId === assetId).length, 1);
    assert.ok((await readFile(path.join(directory, String(repaired.storedFile)))).equals(bytes), '原件字节必须完整保留');
    const replayed = await upload('cross.pdf', bytes, standardMetadata('交叉文件故障样本'));
    assert.equal(replayed.status, 201, replayed.text);
    assert.notEqual(replayed.json.raw.id, rawId, '重新导入仍是新的 Raw，不覆盖已提交记录');
    return {
      response: result.status, code: error.code, rawId, assetId, beforeRestart: before?.status, afterRestart: repaired?.status,
      parser: repaired?.parser, rawCount: rawCountBefore, replayedId: replayed.json.raw.id,
    };
  });
} catch (error) {
  report.checks.push({ id: 'HARNESS-PREREQUISITE', status: error.blocked ? 'BLOCKED' : 'FAIL', error: String(error.stack || error).slice(0, 5000) });
} finally {
  try { await stop(); } catch (error) { report.notes.push(`停止服务时出现问题：${error.message}`); }
  const current = await fingerprint();
  if (JSON.stringify(current) !== JSON.stringify(report.version)) {
    report.checks.push({ id: 'FROZEN-VERSION', status: 'BLOCKED', changed: [...new Set([...Object.keys(current), ...Object.keys(report.version)])].filter(file => current[file] !== report.version[file]) });
  }
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(status => [status, report.checks.filter(item => item.status === status).length]));
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const content = JSON.stringify(report, null, 2) + '\n';
  await writeFile(archivedEvidencePath, content);
  await writeFile(evidencePath, content);
  console.log(JSON.stringify({ summary: report.summary, evidencePath, archivedEvidencePath, dataRoot }));
  process.exitCode = report.summary.FAIL || report.summary.BLOCKED ? 1 : 0;
}
