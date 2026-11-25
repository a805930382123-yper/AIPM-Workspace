import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';

// Third-repair scope is F04-11 only. Historic scripts and evidence stay unchanged.
process.env.B04_ONLY ??= 'F04-11';
const root = process.cwd(), startAt = Date.now();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fmcg-b04-recheck3-'));
const tag = new Date().toISOString().replaceAll(':', '-');
const evidencePath = path.join(root, `docs/reports/B04-recheck3-http-${tag}.json`);
const sha = x => createHash('sha256').update(x).digest('hex');
const report = { startedAt: new Date().toISOString(), node: process.version, dataRoot, productImports: false, provider: 'Independent fake localhost HTTP provider; NOT real AI', calendarDate: '2026-10-06', scope: ['F04-11 immutable chunk snapshots and evidence references only'], checks: [], services: [], fakeRequests: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function files(dir) { let result = []; for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) { const p = path.join(dir, e.name); result.push(...(e.isDirectory() ? await files(p) : [p])); } return result; }
async function snapshot(dir) { const result = {}; for (const f of await files(dir)) result[path.relative(dir, f).replaceAll('\\', '/')] = sha(await readFile(f)); return result; }
async function freeze() { const result = {}; for (const f of ['README.md', 'package.json', 'package-lock.json', '.gitignore', '.env.example', ...((await Promise.all(['app', 'server', 'services', 'rules'].map(d => files(path.join(root, d))))).flat().map(f => path.relative(root, f)))]) result[f.replaceAll('\\', '/')] = sha(await readFile(path.join(root, f))); return result; }
report.frozenBefore = await freeze();
const build = await readFile(path.join(root, 'docs/reports/B04-repair3-build.md'), 'utf8');
report.builderFingerprintMismatches = [...build.matchAll(/\| ([^|]+?) \| [^|]+ \| `([a-f0-9]{64})`/g)].filter(m => report.frozenBefore[m[1]] && report.frozenBefore[m[1]] !== m[2]).map(m => m[1]);
let handler, currentLabel = '', requests = [], active = 0, maxActive = 0;
const fakeKey = 'acceptance-' + randomUUID();
function payload(user, count = 3) {
  const range = /第 (\d+) 段，覆盖原文全局区间 \[(\d+), (\d+)\)/.exec(user);
  const rawId = /rawId 填 "([^"]+)"/.exec(user)?.[1];
  const text = user.slice(user.lastIndexOf('<<<\n') + 4, user.lastIndexOf('\n>>>'));
  const start = Number(range?.[2] ?? 0), chunk = Number(range?.[1] ?? 1);
  return { document: { title: currentLabel + 'Source', main_topic: '渠道库存与业务', summary: '分块' + chunk + '摘要' }, suggested_pages: Array.from({ length: count }, (_, i) => {
    let offset = i === 1 ? Math.max(0, text.length - 16) : 0;
    if (text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) offset++;
    let end = Math.min(text.length, offset + 16);
    if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    const quote = text.slice(offset, end);
    return { title: currentLabel + '知识' + (i + 1), type: i === 1 ? 'metric' : 'concept', category: 'industry_basics', one_line_definition: '定义' + i, source_facts: [{ text: '原文事实' + i, evidenceIds: ['e1'] }], ai_organized: ['整理' + i], ai_inferences: ['推断' + i], related_pages: [currentLabel + '知识' + ((i + 1) % count + 1)], open_questions: ['问题' + i], source_evidence: [{ id: 'e1', rawId, quote, start: start + offset, end: start + offset + quote.length }] };
  }) };
}
const fake = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', async () => {
    active++; maxActive = Math.max(maxActive, active);
    try {
      const body = JSON.parse(Buffer.concat(chunks)); const user = body.messages.find(x => x.role === 'user').content, system = body.messages.find(x => x.role === 'system').content;
      const record = { user, system, model: body.model, streaming: body.stream, authCorrect: req.headers.authorization === 'Bearer ' + fakeKey };
      requests.push(record);
      const output = await handler(user, record, req, res);
      if (res.destroyed || res.writableEnded) return;
      if (output?.status) { res.writeHead(output.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(output.body ?? { error: { message: 'fake error' } })); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: typeof output?.content === 'string' ? output.content : JSON.stringify(output ?? payload(user)) }, finish_reason: output?.finish ?? 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } })); }
    } finally { active--; }
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}/v1`;
let service, sequence = 0;
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(dir, configured = true) {
  const p = await port(), env = { ...process.env, FMCG_DATA_DIR: dir, FMCG_PORT: String(p), FMCG_LLM_BASE_URL: configured ? fakeUrl : '', FMCG_LLM_MODEL: configured ? 'independent-fake-model' : '', FMCG_LLM_API_KEY: configured ? fakeKey : '' };
  const child = spawn(process.execPath, ['--import', './tests/acceptance/b04-recheck3-fault-hook.mjs', '--import', 'tsx', 'server/index.ts'], { cwd: root, env: withoutInheritedEmbeddings(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { child, dir, base: `http://127.0.0.1:${p}`, logs: '' }; child.stdout.on('data', b => s.logs += b); child.stderr.on('data', b => s.logs += b);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw new Error('START_FAILED ' + s.logs); try { if ((await fetch(s.base + '/api/health', { signal: AbortSignal.timeout(250) })).ok) return s; } catch {} await delay(75); }
  child.kill(); throw new Error('START_TIMEOUT ' + s.logs);
}
async function stop() { if (!service) return; const s = service; service = undefined; if (s.child.exitCode === null) { const done = once(s.child, 'exit'); s.child.kill(); await done; } report.services.push({ pid: s.child.pid, base: s.base, dir: s.dir, closed: s.child.exitCode !== null || s.child.signalCode !== null, exitCode: s.child.exitCode, logs: s.logs.replaceAll(fakeKey, '[redacted]') }); }
function normalReply(user) { if (user.includes('<<<\n')) return payload(user); const entries = JSON.parse(user.slice(user.indexOf('[{"chunk"'))); return { document: { title: currentLabel + 'Source', main_topic: '汇总', summary: entries.map(e => e.document.summary).join('\n') } }; }
async function reset(label, configured = true) { await stop(); currentLabel = label; handler = normalReply; requests = []; maxActive = 0; service = await start(path.join(dataRoot, `${++sequence}-${label}`), configured); }
async function req(url, method = 'GET', body) { const r = await fetch(service.base + url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; }
async function check(id, run) { if (process.env.B04_ONLY && !process.env.B04_ONLY.split(',').some(p => id.startsWith(p))) return; const began = Date.now(); let observed; try { const evidence = await run(value => observed = value); report.checks.push({ id, status: 'PASS', elapsedMs: Date.now() - began, evidence: evidence ?? observed }); console.log('PASS ' + id); } catch (error) { report.checks.push({ id, status: 'FAIL', elapsedMs: Date.now() - began, error: String(error.stack), observed }); console.log('FAIL ' + id + ' ' + error.message); } await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n'); }
async function raw(body = '渠道库存为三十天。终端覆盖为一百家。\r\n原文末尾😀可核验证据。') { const r = await req('/api/raw', 'POST', { title: currentLabel + '真实Raw标题', sourceType: 'report', sourceName: '独立来源名', author: '独立作者', publishedAt: '2026-10-03', url: 'https://example.com/acceptance', tags: ['独立验收'], body }); assert.equal(r.status, 201, r.text); return r.json; }
async function settled(id, deadline = 12000) { const until = Date.now() + deadline; for (;;) { const r = await req('/api/extraction-jobs/' + id); if (r.json.status !== 'running') return r.json; assert.ok(Date.now() < until, 'job did not settle'); await delay(25); } }
async function draft(body) { const r = await raw(body), beforeRaw = await snapshot(path.join(service.dir, 'knowledge/raw')), beforeFormal = await formal(); const started = await req('/api/raw/' + r.id + '/extract', 'POST', {}); assert.equal(started.status, 202, started.text); const j = await settled(started.json.jobId); assert.equal(j.status, 'completed', JSON.stringify(j)); const d = (await req('/api/drafts/' + j.draftId)).json; assert.deepEqual(await snapshot(path.join(service.dir, 'knowledge/raw')), beforeRaw); assert.deepEqual(await formal(), beforeFormal); assert.equal((await req('/api/raw/' + r.id)).json.body, r.body); (report.rawPreservationProofs ??= []).push({ rawId: r.id, beforeExtraction: beforeRaw, afterExtraction: await snapshot(path.join(service.dir, 'knowledge/raw')), zeroFormalWrites: true }); return { r, j, d }; }
const confirmation = (d, key = 'independent-key', selected = d.pages.map(p => p.pageId)) => ({ baseRevision: d.revision, selectedPageIds: selected, idempotencyKey: key });
async function formal() { return { wiki: await snapshot(path.join(service.dir, 'knowledge/wiki')), logs: await snapshot(path.join(service.dir, 'knowledge/logs')) }; }
async function fault(rule) { await writeFile(path.join(service.dir, '.acceptance-fault.json'), JSON.stringify({ ...rule, tag: randomUUID() })); }
async function clearFault() { await rm(path.join(service.dir, '.acceptance-fault.json'), { force: true }); }
async function restart() { const dir = service.dir; await stop(); service = await start(dir); }
async function wikiInput(rawId, title, type = 'concept') { return { title, type, category: 'industry_basics', body: '## 手动\n独立旧正文', sources: [rawId], tags: [], aliases: [], knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed' }; }

function validateAggregate(d, rawBody, rawId) {
  for (const page of d.pages) {
    const ids = new Set(page.source_evidence.map(e => e.id));
    assert.equal(ids.size, page.source_evidence.length, 'duplicate aggregate evidence ID');
    for (const fact of page.source_facts) { assert.ok(fact.evidenceIds.length); for (const id of fact.evidenceIds) assert.ok(ids.has(id), 'dangling aggregate fact reference ' + id); }
    for (const e of page.source_evidence) { assert.equal(e.rawId, rawId); assert.equal(rawBody.slice(e.start, e.end), e.quote); }
  }
}
function validateChunkSnapshots(entries, d, body, rawId) {
  for (const entry of entries) {
    assert.equal(entry.document.summary, '分块' + entry.chunk + '摘要');
    assert.equal(entry.pages.length, 3);
    for (const p of entry.pages) {
      for (const field of ['title','type','category','one_line_definition','source_facts','ai_organized','ai_inferences','open_questions','related_pages']) assert.ok(field in p);
      assert.equal(p.source_facts.length, 1, 'chunk snapshot was mutated by aggregation');
      for (const f of p.source_facts) {
        assert.equal(f.evidence.length, 1, 'chunk fact acquired evidence from other chunks');
        for (const e of f.evidence) {
          assert.equal(e.id, 'e1', 'chunk snapshot evidence was renamed by aggregation');
          assert.equal(e.rawId, rawId); assert.equal(e.chunkIndex, entry.chunk - 1);
          assert.equal(body.slice(e.start, e.end), e.quote);
          assert.ok(e.start >= entry.chunkRange.start && e.end <= entry.chunkRange.end);
          assert.ok(d.pages.some(p => p.source_evidence.some(x => x.rawId === e.rawId && x.quote === e.quote && x.start === e.start && x.end === e.end && x.chunkIndex === e.chunkIndex)));
        }
      }
    }
  }
}
async function confirmAggregate(d, r, body) {
  validateAggregate(d, body, r.id);
  const rawFilesBefore = await snapshot(path.join(service.dir, 'knowledge/raw'));
  const result = await req('/api/drafts/' + d.id + '/confirm', 'POST', confirmation(d, 'independent-third-repair'));
  assert.equal(result.status, 201, result.text); assert.equal(result.json.wikiIds.length, d.pages.length);
  const pages = [];
  for (const id of result.json.wikiIds) {
    const p = (await req('/api/wiki/' + id)).json, original = d.pages.find(x => x.title === p.title);
    assert.ok(original); assert.ok(p.sources.includes(r.id));
    for (const f of original.source_facts) { assert.ok(p.body.includes(f.text)); for (const eid of f.evidenceIds) assert.ok(p.body.includes(eid)); }
    for (const e of original.source_evidence) assert.ok(p.body.includes(e.id + '｜原文 [' + e.start + ', ' + e.end + ')：' + e.quote));
    pages.push(p);
  }
  assert.equal((await req('/api/wiki')).json.items.length, d.pages.length + 1);
  assert.equal((await req('/api/raw/' + r.id)).json.body, body);
  assert.deepEqual(await snapshot(path.join(service.dir, 'knowledge/raw')), rawFilesBefore);
  const log = await readFile(path.join(service.dir, 'knowledge/logs/wiki.jsonl'), 'utf8');
  assert.equal(log.trim().split('\n').length, d.pages.length + 1);
  return { response: result, pages, rawFilesBefore, rawFilesAfter: await snapshot(path.join(service.dir, 'knowledge/raw')), formalPageCount: d.pages.length + 1, logLines: d.pages.length + 1 };
}

try {
  await check('F04-11-long-coverage-complete-summary-http', async observe => { await reset('long-summary'); const body = ' \r\n' + Array.from({ length: 7000 }, (_, i) => '段落' + String(i).padStart(5, '0') + '库存😀资料。\r\n').join('') + '末尾唯一证据终点。'; handler = (user, record) => { if (!user.includes('<<<\n')) { const entries = JSON.parse(user.slice(user.indexOf('[{"chunk"'))); record.summaryPayload = entries; return { document: { title: currentLabel + 'Source', main_topic: '完整汇总', summary: entries.map(e => e.document.summary).join('\n') } }; } return payload(user); }; const { r, j, d } = await draft(body); const chunks = requests.filter(x => x.user.includes('<<<\n')).map(x => { const m = /第 (\d+) 段，覆盖原文全局区间 \[(\d+), (\d+)\)/.exec(x.user); return { index: +m[1], start: +m[2], end: +m[3], text: x.user.slice(x.user.lastIndexOf('<<<\n') + 4, x.user.lastIndexOf('\n>>>')) }; }).sort((a, b) => a.index - b.index), merge = requests.find(r => r.summaryPayload); observe({ chars: body.length, bodySha: sha(body), chunks: chunks.map(({ text, ...x }) => x), callCount: j.callCount, maxActive, summaryPayload: merge?.summaryPayload, normalizedEvidence: d.pages.flatMap(page => page.source_evidence) }); assert.ok(body.length > 100000); assert.ok(merge); assert.equal(merge.summaryPayload.length, chunks.length); assert.equal(j.callCount, chunks.length + 1); assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1).end, body.length); assert.ok(maxActive <= 2); chunks.forEach((c, i) => { assert.equal(c.text, body.slice(c.start, c.end)); assert.ok(c.end - c.start <= 8000); if (i) assert.ok(c.start <= chunks[i - 1].end); }); for (const e of merge.summaryPayload) { assert.ok(e.document.summary); for (const p of e.pages) { for (const key of ['category', 'one_line_definition', 'source_facts', 'ai_organized', 'ai_inferences', 'open_questions', 'related_pages']) assert.ok(key in p); for (const f of p.source_facts) for (const ev of f.evidence) { assert.equal(ev.rawId, r.id); assert.ok(Number.isInteger(ev.chunkIndex) && ev.chunkIndex >= 0 && ev.chunkIndex < merge.summaryPayload.length); const origin = merge.summaryPayload.find(entry => entry.chunk === ev.chunkIndex + 1).chunkRange; assert.ok(ev.start >= origin.start && ev.end <= origin.end); assert.equal(body.slice(ev.start, ev.end), ev.quote); assert.ok(d.pages.some(page => page.source_evidence.some(item => item.rawId === ev.rawId && item.quote === ev.quote && item.start === ev.start && item.end === ev.end && item.chunkIndex === ev.chunkIndex))); } } } assert.ok(d.pages.some(p => p.source_evidence.some(e => e.end === body.length))); assert.equal((await req('/api/raw/' + r.id)).json.body, body); validateChunkSnapshots(merge.summaryPayload, d, body, r.id); const committed = await confirmAggregate(d, r, body); return { chars: body.length, bodySha: sha(body), chunks: chunks.map(({ text, ...x }) => x), callCount: j.callCount, maxActive, summaryPayload: merge.summaryPayload, normalizedEvidence: d.pages.flatMap(p => p.source_evidence), formal: committed }; });
  await check('F04-11-no-provider-offsets-summary-gets-located-evidence', async observe => { await reset('no-offsets'); const body = Array.from({ length: 1700 }, (_, i) => '唯一段' + String(i).padStart(6, '0') + '库存材料正文。').join(''); handler = (user, record) => { if (!user.includes('<<<\n')) { const entries = JSON.parse(user.slice(user.indexOf('[{"chunk"'))); record.summaryPayload = entries; return { document: { title: currentLabel + 'Source', main_topic: '汇总', summary: '所有段的摘要' } }; } const p = payload(user); for (const page of p.suggested_pages) for (const e of page.source_evidence) { delete e.start; delete e.end; } return p; }; const { r, j, d } = await draft(body); const merge = requests.find(r => r.summaryPayload); assert.ok(merge); observe({ summaryPayload: merge.summaryPayload, normalizedEvidence: d.pages.flatMap(p => p.source_evidence) }); for (const e of merge.summaryPayload) for (const p of e.pages) for (const f of p.source_facts) for (const ev of f.evidence) { assert.ok(Number.isInteger(ev.start) && Number.isInteger(ev.end), 'summary uses provider optional offsets instead of server located offsets'); assert.equal(ev.rawId, r.id); assert.ok(Number.isInteger(ev.chunkIndex) && ev.chunkIndex >= 0 && ev.chunkIndex < merge.summaryPayload.length); const origin = merge.summaryPayload.find(entry => entry.chunk === ev.chunkIndex + 1).chunkRange; assert.ok(ev.start >= origin.start && ev.end <= origin.end); assert.equal(body.slice(ev.start, ev.end), ev.quote); assert.ok(d.pages.some(page => page.source_evidence.some(item => item.rawId === ev.rawId && item.quote === ev.quote && item.start === ev.start && item.end === ev.end && item.chunkIndex === ev.chunkIndex))); } assert.equal(j.callCount, merge.summaryPayload.length + 1); assert.equal((await req('/api/raw/' + r.id)).json.body, body); assert.ok(maxActive <= 2); assert.ok(d.pages.some(p => p.source_evidence.some(e => e.end === body.length))); validateChunkSnapshots(merge.summaryPayload, d, body, r.id); const committed = await confirmAggregate(d, r, body); return { summaryPayload: merge.summaryPayload, normalizedEvidence: d.pages.flatMap(p => p.source_evidence), chars: body.length, chunkCount: merge.summaryPayload.length, callCount: j.callCount, maxActive, formal: committed }; });
  await check('F04-11-no-offsets-distinct-page-control', async observe => {
    await reset('no-offset-control'); const body = Array.from({ length: 1700 }, (_, i) => '唯一段' + String(i).padStart(6, '0') + '库存材料正文。').join('');
    handler = (user, record) => { if (!user.includes('<<<\n')) { const entries = JSON.parse(user.slice(user.indexOf('[{"chunk"'))); record.summaryPayload = entries; return { document: { title: '独立无重名对照Source', main_topic: '完整汇总', summary: entries.map(e => e.document.summary).join('\n') } }; }
      const p = payload(user), chunk = /第 (\d+) 段/.exec(user)[1]; for (const page of p.suggested_pages) { page.title += '第' + chunk + '块独立主题'; for (const e of page.source_evidence) { delete e.start; delete e.end; } } return p; };
    const { r, j, d } = await draft(body), merge = requests.find(r => r.summaryPayload); assert.ok(merge); assert.equal(merge.summaryPayload.length, 4); assert.equal(j.callCount, 5); assert.equal(d.pages.length, 12);
    for (const entry of merge.summaryPayload) for (const p of entry.pages) for (const f of p.source_facts) for (const ev of f.evidence) {
      assert.equal(ev.rawId, r.id); assert.equal(ev.chunkIndex, entry.chunk - 1); assert.ok(Number.isInteger(ev.start) && Number.isInteger(ev.end)); assert.equal(body.slice(ev.start, ev.end), ev.quote);
      assert.ok(d.pages.some(p => p.source_evidence.some(e => e.rawId === ev.rawId && e.quote === ev.quote && e.start === ev.start && e.end === ev.end && e.chunkIndex === ev.chunkIndex)));
    } assert.equal((await req('/api/raw/' + r.id)).json.body, body); assert.equal(Object.keys((await formal()).wiki).filter(p => p !== 'index.md').length, 0);
    validateChunkSnapshots(merge.summaryPayload, d, body, r.id); const committed = await confirmAggregate(d, r, body); return { summaryPayload: merge.summaryPayload, normalizedEvidence: d.pages.flatMap(p => p.source_evidence), chunks: 4, callCount: j.callCount, unresolved: 0, rawUnchanged: true, formal: committed };
  });
  await check('F04-11-ordinary-single-chunk-confirm', async observe => {
    await reset('single'); const body = '单块回归：渠道覆盖一百家，库存三十天。\r\n保留空白与emoji😀的尾部证据。'; const { r, j, d } = await draft(body);
    assert.equal(j.callCount, 1); assert.equal(requests.length, 1); assert.ok(requests[0].user.includes('<<<\n')); assert.equal(d.pages.length, 3);
    validateAggregate(d, body, r.id); const committed = await confirmAggregate(d, r, body);
    return { chars: body.length, callCount: j.callCount, summaryRequests: 0, normalizedEvidence: d.pages.flatMap(p => p.source_evidence), formal: committed };
  });
} catch (error) { report.checks.push({ id: 'HARNESS', status: 'BLOCKED', error: String(error.stack) }); }
finally {
  await stop(); fake.closeAllConnections(); await new Promise(r => fake.close(r));
  report.frozenAfter = await freeze(); report.frozenChanged = Object.keys(report.frozenBefore).filter(f => report.frozenBefore[f] !== report.frozenAfter[f]);
  // Historic round evidence combined these two assertions under FROZEN-VERSION. Future
  // reruns distinguish immutable runtime bytes from an inaccurate builder document.
  report.checks.push({ id: 'FROZEN-VERSION', status: report.frozenChanged.length ? 'FAIL' : 'PASS', changed: report.frozenChanged });
  report.checks.push({ id: 'BUILDER-FINGERPRINT-DOC', status: report.builderFingerprintMismatches.length ? 'FAIL' : 'PASS', mismatches: report.builderFingerprintMismatches });
  report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - startAt; report.summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(s => [s, report.checks.filter(x => x.status === s).length]));
  report.cleanup = { ownServicesClosed: report.services.every(s => s.closed), fakeClosed: !fake.listening, isolatedDataRetained: true, formalWorkspaceTouched: false };
  await writeFile(evidencePath, JSON.stringify(report, null, 2).replaceAll(fakeKey, '[redacted-fake-key]') + '\n'); console.log(JSON.stringify({ evidencePath, dataRoot, summary: report.summary, elapsedMs: report.elapsedMs }));
  process.exitCode = report.summary.FAIL || report.summary.BLOCKED ? 1 : 0;
}
