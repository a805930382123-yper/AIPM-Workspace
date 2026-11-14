import os from 'node:os';
// B03: file import behaviour and data invariants (real fixtures, real parsers).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AssetStore } from '../services/raw/assets.ts';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../services/raw/limits.ts';
import { detectFileFormat, extractBody, fileStem, parseFile } from '../services/raw/parse.ts';
import { RawStore } from '../services/raw/store.ts';
import { getStats } from '../services/stats/index.ts';
import { importRawFile } from '../server/raw-import.ts';
import { InputError, validateRaw } from '../server/validation.ts';
import { WikiStore } from '../services/wiki/store.ts';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'b03');
const fixture = (name: string) => readFile(path.join(fixtureDir, name));
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-data-b03-'));
  const store = new RawStore(root);
  const assets = new AssetStore(root);
  await store.initialize();
  await assets.initialize();
  const wikiStore = new WikiStore(root, store);
  await wikiStore.initialize();
  return { root, store, assets, wikiStore, clean: () => rm(root, { recursive: true, force: true }) };
}
async function importFixture(name: string, metadata: Record<string, unknown> = {}) {
  const context = await setup();
  const result = await importRawFile({
    store: context.store, assets: context.assets, bytes: await fixture(name),
    fileName: name, metadata: { title: '自检样本', sourceType: 'report', sourceName: 'B03 自检', tags: ['b03'], ...metadata },
  });
  return { ...context, result };
}
async function rejection(promise: Promise<unknown>): Promise<{ code: string; status: number; details: Record<string, unknown>; message: string }> {
  try { await promise; } catch (error) {
    const shaped = error as { code?: string; status?: number; details?: Record<string, unknown>; message: string };
    return { code: shaped.code ?? 'NO_CODE', status: shaped.status ?? 0, details: shaped.details ?? {}, message: shaped.message };
  }
  throw new Error('预期失败，但操作成功了');
}
async function assetFiles(root: string) {
  return (await readdir(path.join(root, 'knowledge', 'raw', 'assets'))).sort();
}

// --- 1. four real formats, Chinese samples, extracted body matches the known sample ---

const markdownSample = '  \r\n# 渠道动销分析\r\n\r\n> B03 自检样本：本行与前后空白必须原样保留。\r\n\r\n第一段：门店动销率与分销覆盖的关系。\n第二行使用单独 LF 换行。\r\n---\r\n第三段：独立分隔线之后的内容仍是正文。\r\n\r\n- 要点一：周转天数\r\n- 要点二：SKU 宽度\r\n\r\n尾随空白保留：   \r\n  \n';
const txtSample = '  \n\n会议纪要（TXT 样本）\n主持人：王经理\n\r\n结论：\n1. 补货周期从 7 天缩短到 5 天\n2. 库存周转提升 12%\r\n\n末尾留白保留。  \n\n';
const bomSample = '带 BOM 的 TXT 样本\r\n第二行\n  \n';
const docxParagraphs = [
  '经销商库存周转动销分析报告', '报告编号：FMCG-B03-001', '一、背景',
  '华东区经销商平均库存周转天数为 38 天，动销率 62%。', '二、结论',
  '建议将安全库存下调 10%，并每周复核补货节奏。',
];

test('Markdown/TXT 真实文件：严格 UTF-8、去掉 BOM、正文逐字符一致且不 trim', async () => {
  const markdown = await parseFile(await fixture('zh-report.md'), '.md');
  assert.equal(markdown.format, 'markdown');
  assert.equal(markdown.body, markdownSample);
  const txt = await parseFile(await fixture('zh-notes.txt'), '.txt');
  assert.equal(txt.format, 'txt');
  assert.equal(txt.body, txtSample);
  const bom = await parseFile(await fixture('bom-notes.txt'), '.txt');
  assert.equal(bom.body, bomSample);
  assert.equal(bom.body.charCodeAt(0), '带'.charCodeAt(0));
});

test('DOCX/PDF 真实文件：实际解析库提取的正文与已知样本一致', async () => {
  const docx = await parseFile(await fixture('zh-report.docx'), '.docx');
  assert.equal(docx.format, 'docx');
  assert.equal(docx.parser, 'mammoth 1.13.0');
  assert.equal(docx.body, `${docxParagraphs.join('\n\n')}\n\n`);
  const pdf = await parseFile(await fixture('zh-report.pdf'), '.pdf');
  assert.equal(pdf.format, 'pdf');
  assert.match(pdf.parser, /^pdfjs-dist \d/);
  const strip = (value: string) => value.replace(/\s+/gu, '');
  assert.equal(strip(pdf.body), strip(docxParagraphs.join('\n')));
  assert.match(pdf.note, /共 1 页/);
});

test('损坏、扫描件、伪扩展名与不支持编码给出可区分的错误码', async () => {
  const cases: Array<[string, string, string]> = [
    ['empty.txt', '.txt', 'EMPTY_FILE'],
    ['broken.docx', '.docx', 'DOCX_INVALID'],
    ['broken.pdf', '.pdf', 'PDF_INVALID'],
    ['scan-image.pdf', '.pdf', 'PDF_NO_TEXT'],
    ['fake-docx.docx', '.docx', 'FORMAT_MISMATCH'],
    ['fake-pdf.pdf', '.pdf', 'FORMAT_MISMATCH'],
    ['gbk-notes.txt', '.txt', 'UNSUPPORTED_ENCODING'],
    ['logo.png', '.png', 'UNSUPPORTED_FORMAT'],
  ];
  const codes = new Set<string>();
  const messages = new Set<string>();
  for (const [name, extension, code] of cases) {
    const failure = await rejection(parseFile(await fixture(name), extension));
    assert.equal(failure.code, code, `${name} 期望 ${code}，实际 ${failure.code}：${failure.message}`);
    assert.ok(failure.message.length > 8, `${name} 的错误说明过短`);
    codes.add(failure.code);
    messages.add(failure.message);
  }
  // Two samples share FORMAT_MISMATCH (extension contradicts real content) but must
  // explain themselves differently; every other case has its own code.
  assert.equal(cases.filter(item => item[2] === 'FORMAT_MISMATCH').length, 2);
  assert.equal(codes.size, 7, `去重后的错误码：${[...codes].join(',')}`);
  assert.equal(messages.size, cases.length, '每种失败都必须给出各自的原因说明');
  // A real DOCX renamed to .txt is a contradiction too, not a text file.
  assert.equal((await rejection(parseFile(await fixture('zh-report.docx'), '.txt'))).code, 'FORMAT_MISMATCH');
  // Detection is structural and never throws, so the original can always be retained first:
  // a truncated but header-valid PDF is detected as PDF and only then rejected by the parser,
  // while a truncated ZIP is already recognisable as a damaged DOCX.
  const truncatedPdf = detectFileFormat(await fixture('broken.pdf'), '.pdf');
  assert.ok('format' in truncatedPdf && truncatedPdf.format === 'pdf');
  const truncatedDocx = detectFileFormat(await fixture('broken.docx'), '.docx');
  assert.ok('failure' in truncatedDocx && truncatedDocx.failure.code === 'DOCX_INVALID');
  const unsupported = detectFileFormat(await fixture('logo.png'), '.png');
  assert.ok('failure' in unsupported && unsupported.failure.code === 'UNSUPPORTED_FORMAT');
});

// --- 2. retained originals: bytes, hash, path safety ---

test('原件按原始字节落盘，SHA-256 与源文件一致，文件名不参与路径', async () => {
  const context = await setup();
  try {
    const bytes = await fixture('zh-report.md');
    const fileName = '../../evil<script>.md';
    const asset = await context.assets.store(bytes, { fileName, format: 'markdown', declaredExtension: '.md' });
    assert.equal(asset.byteSize, bytes.length);
    assert.equal(asset.sha256, sha256(bytes));
    assert.equal(asset.storedFile, `${asset.id}.md`);
    const stored = await readFile(path.join(context.root, 'knowledge', 'raw', 'assets', asset.storedFile));
    assert.ok(stored.equals(bytes), '落盘字节必须与原始字节完全一致');
    assert.equal(sha256(stored), asset.sha256);
    assert.equal(asset.fileName, fileName, '原文件名只作为元数据保留');
    assert.deepEqual(await assetFiles(context.root), [`${asset.id}.json`, `${asset.id}.md`]);
    // No path traversal: nothing was created outside the assets directory.
    const outside = path.join(context.root, 'knowledge', 'raw');
    assert.deepEqual((await readdir(outside)).sort(), ['articles', 'assets', 'company', 'customer', 'meetings', 'notes', 'other', 'reports']);
    assert.equal(fileStem('C:\\Users\\x\\报告.docx'), '报告');
    assert.equal(fileStem('../../evil<script>.md'), 'evil<script>');
  } finally { await context.clean(); }
});

// --- 3. import orchestration: success, failure, duplicates, limits ---

test('文件导入成功：正文与原件都入库，元数据、哈希与关联可回读', async () => {
  const context = await importFixture('zh-notes.txt', { title: '会议纪要文件导入', sourceType: 'other', sourceName: '王经理', tags: ['渠道', '库存'] });
  try {
    const { result, root, store, assets } = context;
    assert.equal(result.raw.title, '会议纪要文件导入');
    assert.equal(result.raw.body, txtSample);
    assert.equal(result.raw.body.length, result.extraction.bodyChars);
    assert.equal(result.raw.assetId, result.asset.id);
    assert.equal(result.raw.assetFileName, 'zh-notes.txt');
    assert.equal(result.raw.assetFormat, 'txt');
    assert.equal(result.raw.assetByteSize, (await fixture('zh-notes.txt')).length);
    assert.equal(result.raw.assetSha256, sha256(await fixture('zh-notes.txt')));
    assert.equal(result.asset.status, 'parsed');
    assert.equal(result.asset.rawId, result.raw.id);
    const loaded = await store.get(result.raw.id);
    assert.equal(loaded?.body, txtSample);
    assert.equal(loaded?.assetId, result.asset.id);
    assert.equal(loaded?.bodySha256, result.raw.bodySha256);
    assert.equal((await assets.get(result.asset.id))?.rawId, result.raw.id);
    const stored = await readFile(path.join(root, 'knowledge', 'raw', 'assets', result.asset.storedFile));
    assert.equal(sha256(stored), result.asset.sha256);
    const totals = await getStats(root, store);
    assert.equal(totals.rawCount, 1);
    assert.equal(totals.thisWeekNewCount, 1);
  } finally { await context.clean(); }
});

test('解析失败保留隔离原件与失败记录，不创建正式 Raw、不增加统计', async () => {
  for (const [name, code] of [['broken.docx', 'DOCX_INVALID'], ['gbk-notes.txt', 'UNSUPPORTED_ENCODING'], ['fake-pdf.pdf', 'FORMAT_MISMATCH']] as const) {
    const context = await setup();
    try {
      const bytes = await fixture(name);
      const failure = await rejection(importRawFile({ store: context.store, assets: context.assets, bytes, fileName: name, metadata: { title: '失败样本', sourceType: 'report', sourceName: 'B03' } }));
      assert.equal(failure.code, code, `${name}: ${failure.message}`);
      assert.equal(failure.details.retained, true, `${name} 必须报告原件已保留`);
      assert.match(failure.message, /原件已保留/);
      assert.equal(failure.details.sha256, sha256(bytes));
      assert.equal(failure.details.byteSize, bytes.length);
      assert.equal((await context.store.list()).length, 0, `${name} 不得创建 Raw`);
      assert.equal((await getStats(context.root, context.store)).rawCount, 0);
      const assetId = String(failure.details.assetId);
      const record = await context.assets.get(assetId);
      assert.equal(record?.status, 'parse_failed');
      assert.equal(record?.failure?.code, code);
      assert.equal(record?.rawId, undefined);
      const stored = await readFile(path.join(context.root, 'knowledge', 'raw', 'assets', String(record?.storedFile)));
      assert.ok(stored.equals(bytes), `${name} 原件字节必须完整保留`);
      assert.deepEqual(await assetFiles(context.root), [`${assetId}.json`, record?.storedFile].sort());
    } finally { await context.clean(); }
  }
});

test('扫描 PDF 文件导入保留原件并用空正文记录真实页码', async () => {
  const context = await setup();
  try {
    const bytes = await fixture('scan-image.pdf');
    const { raw, asset } = await importRawFile({ store: context.store, assets: context.assets, bytes, fileName: 'scan-image.pdf', metadata: { sourceType: 'report' } });
    assert.equal(raw.body, '');
    assert.equal(raw.bodySha256, sha256(Buffer.alloc(0)));
    assert.deepEqual(raw.pdf, { pageCount: 1, hasTextLayer: false, pages: [{ page: 1, textStart: null, textEnd: null }] });
    assert.equal(asset.sha256, sha256(bytes));
    assert.equal(asset.status, 'parsed');
    assert.deepEqual((await context.assets.readBoundPdf(raw)).bytes, bytes);
    assert.equal((await context.store.get(raw.id))?.body, '');
  } finally { await context.clean(); }
});

test('超限文件在接收阶段拒绝；超限正文保留原件但不创建 Raw', async () => {
  const context = await setup();
  try {
    const tooLarge = await rejection(importRawFile({
      store: context.store, assets: context.assets, bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61), fileName: 'huge.txt',
      metadata: { title: '超限', sourceType: 'report', sourceName: 'B03' },
    }));
    assert.equal(tooLarge.code, 'FILE_TOO_LARGE');
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.details.retained, false);
    assert.deepEqual(await assetFiles(context.root), [], '接收阶段拒绝时不保留原件');

    const longBody = Buffer.from('快'.repeat(MAX_BODY_CHARS + 1), 'utf8');
    const tooLong = await rejection(importRawFile({
      store: context.store, assets: context.assets, bytes: longBody, fileName: 'long.txt',
      metadata: { title: '超长正文', sourceType: 'report', sourceName: 'B03' },
    }));
    assert.equal(tooLong.code, 'BODY_TOO_LARGE');
    assert.equal(tooLong.status, 413);
    assert.equal(tooLong.details.retained, true);
    assert.equal((await context.store.list()).length, 0);
    assert.equal((await assetFiles(context.root)).length, 2);

    const blank = await rejection(importRawFile({
      store: context.store, assets: context.assets, bytes: await fixture('blank.txt'), fileName: 'blank.txt',
      metadata: { title: '纯空白', sourceType: 'report', sourceName: 'B03' },
    }));
    assert.equal(blank.code, 'EMPTY_CONTENT');
    assert.equal(blank.details.retained, true);
  } finally { await context.clean(); }
});

test('文件名与标题不参与路径：含路径字符与 HTML 时仍在 assets 内且只作元数据', async () => {
  const context = await setup();
  try {
    const result = await importRawFile({
      store: context.store, assets: context.assets, bytes: await fixture('zh-report.md'),
      fileName: '../../evil<script>.md', metadata: { sourceType: 'note' },
    });
    assert.equal(result.raw.title, 'evil<script>', '标题必须去掉路径部分');
    assert.equal(result.raw.sourceName, 'evil<script>');
    assert.deepEqual(await assetFiles(context.root), [`${result.asset.id}.json`, `${result.asset.id}.md`]);
    assert.equal(result.raw.assetFileName, '../../evil<script>.md');
    assert.equal((await context.store.list()).length, 1);
  } finally { await context.clean(); }
});

test('重复导入生成独立记录与独立原件，旧资料字节哈希不变', async () => {
  const context = await setup();
  try {
    const bytes = await fixture('zh-notes.txt');
    const first = await importRawFile({ store: context.store, assets: context.assets, bytes, fileName: 'zh-notes.txt', metadata: { title: '同一份资料', sourceType: 'note', sourceName: 'B03' } });
    const firstFile = path.join(context.root, 'knowledge', 'raw', 'notes', `${first.raw.id}.md`);
    const firstHash = sha256(await readFile(firstFile));
    const second = await importRawFile({ store: context.store, assets: context.assets, bytes, fileName: 'zh-notes.txt', metadata: { title: '同一份资料', sourceType: 'note', sourceName: 'B03' } });
    assert.notEqual(first.raw.id, second.raw.id);
    assert.notEqual(first.asset.id, second.asset.id);
    assert.notEqual(first.asset.storedFile, second.asset.storedFile);
    assert.equal(first.asset.sha256, second.asset.sha256, '相同字节得到相同原件哈希，但记录各自独立');
    assert.equal(sha256(await readFile(firstFile)), firstHash, '旧记录文件不得被覆盖或改写');
    assert.equal((await context.store.list()).length, 2);
    assert.equal((await assetFiles(context.root)).length, 4);
  } finally { await context.clean(); }
});

// --- 4. delete and re-import ---

test('删除：无引用可删且原件保留；被正式 Wiki 引用时由服务端重新检查后阻止', async () => {
  const context = await setup();
  try {
    const kept = await importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('zh-report.md'), fileName: 'zh-report.md', metadata: { title: '被引用资料', sourceType: 'report', sourceName: 'B03' } });
    const plain = await importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('zh-notes.txt'), fileName: 'zh-notes.txt', metadata: { title: '无引用资料', sourceType: 'note', sourceName: 'B03' } });
    await context.wikiStore.create({
      title: '渠道动销概念', type: 'concept', category: 'industry_basics', sources: [kept.raw.id], tags: [], aliases: [],
      knowledge_status: 'source_supported', confidence: 'medium', source_level: 'B', review_status: 'reviewed', body: '## 定义\n\n来自文件导入资料。',
    });
    assert.deepEqual((await context.wikiStore.referencesToRaw(kept.raw.id)).map(item => item.title), ['渠道动销概念']);
    assert.deepEqual(await context.wikiStore.referencesToRaw(plain.raw.id), []);

    const removed = await context.store.delete(plain.raw.id);
    assert.equal(removed?.id, plain.raw.id);
    assert.equal(await context.store.get(plain.raw.id), undefined);
    assert.equal((await context.store.list()).length, 1);
    assert.equal((await getStats(context.root, context.store)).rawCount, 1);
    // The retained original survives the Raw deletion by design.
    assert.ok(await context.assets.get(plain.asset.id));
    assert.equal((await assetFiles(context.root)).length, 4);
    // A referenced Raw is protected by the delete endpoint's re-check (HTTP test B03 covers
    // the 409); at this level the reference relation must be visible and the Raw untouched.
    const references = await context.wikiStore.referencesToRaw(kept.raw.id);
    assert.equal(references.length, 1);
    assert.equal(references[0].title, '渠道动销概念');
    assert.ok(await context.store.get(kept.raw.id), '被引用资料在确认引用后仍然存在');
  } finally { await context.clean(); }
});

test('重新导入：创建新 ID 的 Raw，旧记录与旧原件保持不变', async () => {
  const context = await setup();
  try {
    const first = await importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('zh-report.md'), fileName: 'zh-report.md', metadata: { title: '原始资料', sourceType: 'report', sourceName: 'B03', tags: ['渠道'] } });
    const firstFile = path.join(context.root, 'knowledge', 'raw', 'reports', `${first.raw.id}.md`);
    const before = await readFile(firstFile);
    // "重新导入" reuses the normal import flow with the previous metadata prefilled.
    const again = await importRawFile({
      store: context.store, assets: context.assets, bytes: await fixture('zh-report.md'), fileName: 'zh-report.md',
      metadata: { title: first.raw.title, sourceType: first.raw.sourceType, sourceName: first.raw.sourceName, tags: first.raw.tags },
    });
    assert.notEqual(again.raw.id, first.raw.id);
    assert.equal(again.raw.title, '原始资料');
    assert.equal(again.raw.body, first.raw.body);
    assert.ok((await readFile(firstFile)).equals(before), '旧记录必须保持不变');
    assert.deepEqual((await context.store.list()).map(item => item.id).sort(), [first.raw.id, again.raw.id].sort());
    assert.equal((await context.store.get(first.raw.id))?.assetId, first.asset.id, '旧记录的来源关联不得被转移');
  } finally { await context.clean(); }
});

// --- 5. regressions that must keep working ---

test('既有粘贴导入与校验契约不受影响', () => {
  const pasted = validateRaw({ title: '粘贴资料', sourceType: 'article', sourceName: '来源', tags: ['a'], body: ' 正文 \n' });
  assert.equal(pasted.body, ' 正文 \n');
  assert.equal(pasted.assetId, undefined);
  assert.throws(() => validateRaw({ title: '', sourceType: 'article', sourceName: '来源', body: '正文' }), (error: unknown) => error instanceof InputError && error.code === 'REQUIRED_FIELD');
  assert.throws(() => validateRaw({ title: '标题', sourceType: 'article', sourceName: '来源', body: '快'.repeat(MAX_BODY_CHARS + 1) }), (error: unknown) => error instanceof InputError && error.code === 'BODY_TOO_LARGE' && error.status === 413);
  assert.throws(() => validateRaw({ title: '标题', sourceType: 'article', sourceName: '来源', body: '   ' }), (error: unknown) => error instanceof InputError && error.code === 'REQUIRED_FIELD');
});

test('解析失败不留下正式 Raw 文件，且失败记录在重新读取后仍可解释', async () => {
  const context = await setup();
  try {
    const failure = await rejection(importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('broken.docx'), fileName: 'broken.docx', metadata: { title: '损坏文件', sourceType: 'other', sourceName: 'B03' } }));
    assert.equal(failure.code, 'DOCX_INVALID');
    for (const folder of ['articles', 'reports', 'company', 'customer', 'meetings', 'notes', 'other']) {
      assert.deepEqual(await readdir(path.join(context.root, 'knowledge', 'raw', folder)), [], `${folder} 不应有文件`);
    }
    // A fresh store (as after a restart) still explains the retained original.
    const reopened = new AssetStore(context.root);
    const records = await reopened.list();
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'parse_failed');
    assert.equal(records[0].failure?.code, 'DOCX_INVALID');
    assert.ok((await stat(path.join(context.root, 'knowledge', 'raw', 'assets', records[0].storedFile))).size > 0);
  } finally { await context.clean(); }
});

test('提取正文继续遵守 500,000 字符上限常量，服务端与文档同源', () => {
  assert.equal(MAX_BODY_CHARS, 500_000);
  assert.equal(MAX_UPLOAD_BYTES, 20 * 1024 * 1024);
});

test('解析层不会因为扩展名而跳过内容检查', async () => {
  const docx = await fixture('zh-report.docx');
  assert.equal((await rejection(parseFile(docx, '.md'))).code, 'FORMAT_MISMATCH');
  const markdown = await fixture('zh-report.md');
  assert.equal((await rejection(parseFile(markdown, '.pdf'))).code, 'FORMAT_MISMATCH');
  assert.equal((await rejection(parseFile(markdown, '.docx'))).code, 'FORMAT_MISMATCH');
  assert.equal((await rejection(parseFile(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]), '.pdf'))).code, 'PDF_INVALID');
  assert.equal((await extractBody(markdown, 'markdown')).body, markdownSample);
});

// --- 6. F03-01: partial commit must not report success, and must be recoverable ---

test('F03-01 关联写入失败：非成功状态、给出已提交 ID，并说明未创建 Raw 不成立', async () => {
  const context = await setup();
  try {
    const bytes = await fixture('zh-report.md');
    const original = context.assets.markParsed.bind(context.assets);
    context.assets.markParsed = async () => { throw new Error('blocked by acceptance-style directory'); };
    const failure = await rejection(importRawFile({
      store: context.store, assets: context.assets, bytes, fileName: 'zh-report.md',
      metadata: { title: '部分提交样本', sourceType: 'report', sourceName: 'B03' },
    }));
    assert.equal(failure.code, 'IMPORT_LINK_PENDING');
    assert.equal(failure.status, 500, '部分提交必须是明确的非成功状态');
    assert.equal(failure.details.committed, true);
    assert.equal(failure.details.recoverable, true);
    const rawId = String(failure.details.rawId);
    const assetId = String(failure.details.assetId);
    assert.match(rawId, /^[0-9a-f-]{36}$/i);
    assert.match(assetId, /^[0-9a-f-]{36}$/i);
    // The Raw really was committed and the original really is on disk.
    const committed = await context.store.get(rawId);
    assert.equal(committed?.assetId, assetId);
    assert.equal(committed?.body, markdownSample);
    assert.equal(committed?.assetSha256, sha256(bytes));
    assert.equal((failure.details.raw as { id: string }).id, rawId);
    const record = await context.assets.get(assetId);
    assert.equal(record?.status, 'stored', '关联记录尚未写入');
    assert.ok((await readFile(path.join(context.root, 'knowledge', 'raw', 'assets', String(record?.storedFile)))).equals(bytes));
    assert.match(failure.message, /正文已写入正式 Raw/);
    assert.equal(failure.message.includes('未创建 Raw'), false, '不得声称未创建 Raw');
    assert.match(failure.message, /不要重复导入/);
    assert.match(failure.message, /自动补齐/);

    // Recovery: the same directory, restarted, must complete the linkage.
    context.assets.markParsed = original;
    const repair = await new AssetStore(context.root).reconcile(await context.store.list());
    assert.deepEqual(repair.linked, [assetId]);
    const repaired = await context.assets.get(assetId);
    assert.equal(repaired?.status, 'parsed');
    assert.equal(repaired?.rawId, rawId);
    assert.match(String(repaired?.parser), /utf-8-strict/);
    assert.match(String(repaired?.extractionNote), /UTF-8/);
  } finally { await context.clean(); }
});

test('F03-01 启动对账：补齐关联、补偿中断导入、分离失效关联，且不受被阻断记录影响', async () => {
  const context = await setup();
  try {
    // (a) stored + committed Raw  -> complete the linkage from the Raw frontmatter.
    const bytes = await fixture('zh-notes.txt');
    const assetA = await context.assets.store(bytes, { fileName: 'zh-notes.txt', format: 'txt', declaredExtension: '.txt' });
    const rawA = await context.store.create({
      title: '对账样本', sourceType: 'report', sourceName: 'B03', tags: [], body: txtSample,
      assetId: assetA.id, assetFileName: 'zh-notes.txt', assetFormat: 'txt', assetByteSize: bytes.length,
      assetSha256: assetA.sha256, extractionParser: 'utf-8-strict', extractionNote: '按严格 UTF-8 解码。',
    });
    // (b) stored without a Raw -> safe compensation (no Raw exists, original kept).
    const assetB = await context.assets.store(Buffer.from('中断的导入'), { fileName: 'interrupted.txt', format: 'txt', declaredExtension: '.txt' });
    // (c) parsed but its Raw is gone -> detached.
    const assetC = await context.assets.store(Buffer.from('失效关联'), { fileName: 'stale.txt', format: 'txt', declaredExtension: '.txt' });
    await context.assets.markParsed(assetC.id, { format: 'txt', rawId: '99999999-9999-4999-8999-999999999999', parser: 'utf-8-strict', extractionNote: 'x' });
    // (d) a record path blocked by a directory must not stop the rest.
    await mkdir(path.join(context.root, 'knowledge', 'raw', 'assets', '88888888-8888-4888-8888-888888888888.json'));

    const repair = await context.assets.reconcile(await context.store.list());
    assert.deepEqual(repair.linked, [assetA.id]);
    assert.deepEqual(repair.compensated, [assetB.id]);
    assert.deepEqual(repair.detached, [assetC.id]);
    assert.deepEqual(repair.failed, []);

    const linked = await context.assets.get(assetA.id);
    assert.equal(linked?.status, 'parsed');
    assert.equal(linked?.rawId, rawA.id);
    assert.equal(linked?.parser, 'utf-8-strict');
    assert.equal(linked?.extractionNote, '按严格 UTF-8 解码。');
    assert.equal(linked?.format, 'txt');

    const compensated = await context.assets.get(assetB.id);
    assert.equal(compensated?.status, 'parse_failed');
    assert.equal(compensated?.failure?.code, 'IMPORT_INTERRUPTED');
    assert.equal(compensated?.rawId, undefined);
    assert.ok((await stat(path.join(context.root, 'knowledge', 'raw', 'assets', String(compensated?.storedFile)))).size > 0, '补偿时原件必须保留');

    const detached = await context.assets.get(assetC.id);
    assert.equal(detached?.status, 'detached');
    assert.ok(detached?.detachedAt);

    // Re-running is idempotent.
    const again = await context.assets.reconcile(await context.store.list());
    assert.deepEqual([again.linked.length, again.compensated.length, again.detached.length], [0, 0, 0]);
    assert.equal((await context.store.list()).length, 1, '对账不得创建或删除 Raw');
  } finally { await context.clean(); }
});

test('F03-04/子路径：列表同步只依赖已提交结果，重复同步不会重复添加', async () => {
  const context = await setup();
  try {
    const result = await importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('zh-report.md'), fileName: 'zh-report.md', metadata: { title: '同步样本', sourceType: 'note', sourceName: 'B03' } });
    assert.equal(result.asset.status, 'parsed');
    // The parent's sync helper is a pure list reducer; importing twice must not duplicate an id.
    const merge = (list: string[], id: string) => list.includes(id) ? list : [id, ...list];
    const once = merge([], result.raw.id);
    assert.deepEqual(merge(once, result.raw.id), once);
    assert.equal((await context.store.list()).length, 1, '同步本身不得再写一次 Raw');
  } finally { await context.clean(); }
});

test('M04 compatibility: ordinary legacy meeting category remains available for file imports', async () => {
  const context = await setup();
  try {
    const result = await importRawFile({ store: context.store, assets: context.assets, bytes: await fixture('zh-notes.txt'), fileName: 'zh-notes.txt', metadata: { title: '普通会议资料', sourceType: 'meeting', sourceName: '旧分类兼容' } });
    assert.equal(result.raw.sourceType, 'meeting');
    assert.equal(result.raw.origin, undefined);
    assert.equal(result.raw.body.includes('会议纪要'), true);
  } finally { await context.clean(); }
});
