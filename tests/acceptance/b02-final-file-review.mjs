// Read-only review of browser fixtures and downloaded asset. No product imports/HTTP.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const browser = JSON.parse(await readFile(path.join(root, 'docs/reports/B02-browser-evidence.json'), 'utf8'));
const before = JSON.parse(await readFile(path.join(root, 'docs/reports/B02-browser-pages-before-delete.json'), 'utf8')).items;
function parse(text) {
  const rest = text.slice(text.indexOf('\n') + 1);
  const close = /^---\r?\n/m.exec(rest);
  assert.ok(close);
  const metadata = yaml.load(rest.slice(0, close.index));
  const content = rest.slice(close.index + close[0].length);
  const title = `# ${metadata.title}\n\n`;
  return { ...metadata, body: content.startsWith(title) ? content.slice(title.length) : content };
}
function normalize(record) {
  return Object.fromEntries(Object.keys(record).filter(key => key !== 'links').sort().map(key => [key, ['created', 'updated'].includes(key) ? new Date(record[key]).toISOString() : record[key]]));
}
const report = { date: new Date().toISOString(), dataRoot: browser.dataRoot, notes: ['Read-only supporting file review; B02 final decision stays in acceptance report.', 'UI-04 metric edit after deletion is explicitly authorized test activity, not deletion damage.'] };
const download = await readFile(path.join(root, 'docs/reports/fixtures/B02-downloaded-source.md'));
const source = browser.sixTypesCreatedThroughUI.find(item => item.type === 'source');
assert.ok(source);
assert.equal(download.byteLength, browser.download.bytes);
assert.equal(hash(download), browser.download.sha256);
assert.deepEqual(download, await readFile(path.join(browser.dataRoot, 'knowledge/wiki', `${source.id}.md`)));
report.download = { bytes: download.byteLength, sha256: hash(download), exactStoredFile: true, rawIds: parse(download.toString('utf8')).sources };
report.raw = [];
for (const item of browser.rawChecks) {
  let raw;
  for (const folder of ['meetings', 'notes']) {
    try { raw = parse(await readFile(path.join(browser.dataRoot, 'knowledge/raw', folder, `${item.id}.md`), 'utf8')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.ok(raw, item.id);
  assert.equal(hash(raw.body), item.bodySha256);
  assert.equal(raw.bodySha256, item.bodySha256);
  report.raw.push({ id: item.id, bodySha256: hash(raw.body), unchangedFromBrowserBaseline: true });
}
assert.equal(before.length, 6);
assert.equal(new Set(before.map(item => item.type)).size, 6);
report.pages = [];
for (const record of before) {
  const deleted = record.id === browser.deletion.id;
  const file = path.join(browser.dataRoot, deleted ? 'knowledge/recycle/wiki' : 'knowledge/wiki', `${record.id}.md`);
  const stored = parse(await readFile(file, 'utf8'));
  const beforeNormalized = normalize(record);
  const afterNormalized = normalize(stored);
  const authorizedLaterEdit = record.id === '5b6c3f81-e361-4d26-9cd0-0863fc74cd31' && stored.revision > record.revision;
  if (authorizedLaterEdit) {
    for (const key of ['body', 'updated', 'revision']) { delete beforeNormalized[key]; delete afterNormalized[key]; }
    assert.ok(stored.body.includes('[[B02验收-访谈摘要]]'));
  }
  assert.deepEqual(afterNormalized, beforeNormalized, record.id);
  if (record.type === 'business_process') assert.ok(stored.body.includes('分析建议'));
  if (record.type === 'synthesis') assert.equal(stored.sources.length, 2);
  report.pages.push({ id: record.id, type: record.type, deleted, revision: stored.revision, unchangedFromDeletionBaseline: !authorizedLaterEdit, authorizedLaterEdit, sha256: hash(await readFile(file)) });
}
await writeFile(path.join(root, 'docs/reports/B02-final-file-review.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ download: report.download, rawRecords: report.raw.length, pageRecords: report.pages.length, authorizedLaterEdits: report.pages.filter(item => item.authorizedLaterEdit).map(item => ({ id: item.id, revision: item.revision })) }));
