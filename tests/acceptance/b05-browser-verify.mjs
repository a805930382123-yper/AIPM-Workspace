import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileSnapshot } from './b05-harness.mjs';
const runtime = JSON.parse(await readFile('docs/reports/B05-acceptance-browser-runtime.json', 'utf8'));
const get = async url => { const response = await fetch(runtime.api + url); return { status: response.status, data: await response.json() }; };
const workflows = [];
for (const file of await readdir(path.join(runtime.dataRoot, 'drafts', 'knowledge-workflows'))) if (file.endsWith('.json')) workflows.push(JSON.parse(await readFile(path.join(runtime.dataRoot, 'drafts', 'knowledge-workflows', file), 'utf8')));
const wiki = await get(`/api/wiki/${runtime.oldId}`), list = await get('/api/wiki');
const evidence = { workflows, wiki: wiki.data, list: list.data.items.map(x => ({ id: x.id, type: x.type, title: x.title, sources: x.sources })), rawUnchanged: JSON.stringify(runtime.beforeRaw) === JSON.stringify(await fileSnapshot(path.join(runtime.dataRoot, 'knowledge', 'raw'))), formalUnchanged: JSON.stringify(runtime.beforeKnowledge) === JSON.stringify(await fileSnapshot(path.join(runtime.dataRoot, 'knowledge'))), savedWorkflowExists: workflows.some(x => x.title === '铺货率 人工更名'), updateTitleLost: workflows.some(x => x.status === 'confirmed' && x.title === '铺货率 浏览器确认更名') && wiki.data.title !== '铺货率 浏览器确认更名', contentPreserved: wiki.data.body.includes('浏览器确认内容') };
const phase = process.argv[2];
await writeFile(phase === 'cancel' ? 'docs/reports/B05-acceptance-browser-cancel.json' : 'docs/reports/B05-acceptance-browser-files.json', JSON.stringify(evidence, null, 2));
process.stdout.write(JSON.stringify({ rawUnchanged: evidence.rawUnchanged, formalUnchanged: evidence.formalUnchanged, savedWorkflowExists: evidence.savedWorkflowExists, updateTitleLost: evidence.updateTitleLost, contentPreserved: evidence.contentPreserved, wikiTitle: wiki.data.title, wikiCount: evidence.list.length }) + '\n');
assert.ok(evidence.rawUnchanged);
if (phase === 'cancel') assert.ok(evidence.formalUnchanged);
if (phase === 'final') { assert.ok(!evidence.updateTitleLost); assert.ok(evidence.contentPreserved); assert.equal(evidence.wiki.title, '铺货率 浏览器确认更名'); }
