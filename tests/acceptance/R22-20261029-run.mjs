// R22 engineering/UI only. serve uses the complete product backend and complete built App,
// with real LLM configuration disabled. No implicit real-model mode is provided.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { KnowledgeWorkflowStore } from '../../services/wiki/knowledge-workflows.ts';
import { ExtractionRunner, ExtractionJobStore } from '../../services/llm/jobs.ts';
import { LLMService } from '../../services/llm/service.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { LLM_ENV } from '../../services/llm/config.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const save = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const must = (condition, reason) => { if (!condition) throw new Error(reason); };
async function freeze() {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push({ path: file.replaceAll('\\','/'), sha256: hash(await fs.readFile(file)) });
    }
  }
  for (const dir of ['services','server','app','rules']) await walk(dir);
  for (const file of ['tests/acceptance/R22-20261029-run.mjs','docs/handoffs/R22-20261029-task.md','package.json','package-lock.json']) files.push({ path: file, sha256: hash(await fs.readFile(file)) });
  files.sort((a,b) => a.path.localeCompare(b.path)); return { files, sha256: hash(JSON.stringify(files)) };
}
export async function prepare() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r22-lab-'));
  const raws = new RawStore(root), drafts = new DraftStore(root), states = new RawStateStore(root), jobs = new ExtractionJobStore(root);
  await Promise.all([raws.initialize(), drafts.initialize(), states.initialize(), jobs.initialize()]);
  const wiki = new WikiStore(root, raws); await wiki.initialize();
  const raw = await raws.create({ title: 'R22虚构公司正式报告', sourceType: 'report', sourceName: '虚构甲公司正式经营报告', author: '虚构甲公司', tags: ['虚构','R22工程'], body: '【虚构】甲渠道本月覆盖20家门店。' });
  const existingRaw = await raws.create({ title: 'R22虚构专业研究', sourceType: 'report', sourceName: '虚构乙专业研究机构', tags: ['虚构','R22工程'], body: '【虚构】乙渠道本月覆盖25家门店。' });
  const unknownRaw = await raws.create({ title: 'R22虚构未知来源', sourceType: 'note', sourceName: '来源未知', tags: ['虚构','R22工程'], body: '【虚构】乙渠道统计口径尚未确认。' });
  const existingSource = await wiki.create({ title: existingRaw.title, type: 'source', category: 'metric', sources: [existingRaw.id], tags: ['虚构'], aliases: [], knowledge_status: 'source_supported', confidence: 'medium', source_level: 'B', review_status: 'unreviewed', body: existingRaw.body });
  let fakeCalls = 0;
  const provider = { name: 'synthetic-engineering', model: 'r22-fixture', complete: async request => {
    fakeCalls++;
    let value;
    if (request.user.startsWith('请对下列全部已验证事实规划知识页')) {
      const data = JSON.parse(request.user.split('\n').at(-1));
      value = { version: 3, document: { title: raw.title, main_topic: '渠道覆盖', source_level: 'A' }, pages: [{ title: 'R22虚构渠道覆盖', type: 'metric', category: 'metric', factUnitIds: data.factUnits.map(unit => unit.id), questionUnitIds: data.questionUnits.map(unit => unit.id) }] };
    } else if (request.user.startsWith('{')) {
      const data = JSON.parse(request.user);
      value = { synthesis_format_version: 1, title: 'R22虚构渠道综合', category: 'metric', sourceLevels: data.raws.map(item => ({ rawId: item.id, source_level: item.id === unknownRaw.id ? 'D' : 'A' })), suggestedAdditions: data.raws.map(item => ({ text: item.body, rawId: item.id, locatorId: item.locators[0].id })), conflicts: [], agreement: [], inferences: [], openQuestions: [] };
    } else {
      const atoms = JSON.parse(request.user.split('\n').at(-1));
      value = { version: 2, facts: atoms.map(atom => ({ atomId: atom.id, kind: 'fact' })), questions: [], sourceNotes: [] };
    }
    const response = { text: JSON.stringify(value), finishReason: 'stop', bytes: 1 };
    await save(path.join(root, `fake-request-${fakeCalls}.json`), request); await save(path.join(root, `fake-response-${fakeCalls}.json`), response); return response;
  } };
  const bundle = await loadExtractionRules('rules');
  const rules = { types: bundle.fmcg.types.map(item => item.id), categories: bundle.fmcg.categories.map(item => item.id), ...bundle.fmcg.enums };
  const runner = new ExtractionRunner({ root, rawStore: raws, rawStates: states, jobs, drafts, llm: new LLMService('rules'), rulesDir: 'rules', provider: () => provider, draftRules: async () => rules });
  const started = await runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  const settled = await runner.waitForSettlement(started.job.id); must(settled.job?.status === 'completed', 'ENGINEERING_EXTRACT_FAILED');
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws); await workflows.initialize();
  const workflow = await workflows.createSynthesis({ rawIds: [existingRaw.id, unknownRaw.id], provider });
  const frozen = await freeze(); await save(path.join(root, 'freeze.json'), frozen);
  const meta = { kind: 'r22-engineering-app-v1', root, draftId: settled.job.draftId, rawId: raw.id, workflowId: workflow.id, existingSourceId: existingSource.id, rawIds: [raw.id,existingRaw.id,unknownRaw.id], rawShas: [raw,existingRaw,unknownRaw].map(item => ({ id: item.id, sha256: item.bodySha256 })), initialFormal: await wiki.allRecords(), freezeSha256: frozen.sha256, fakeCalls, realCalls: 0, realConfigReads: 0, knowledgeUsed: 258, promptUsed: 15 };
  await save(path.join(root, 'r22-session.json'), meta); await fs.writeFile(path.join(root, 'empty.env'), '');
  return meta;
}
export async function serve(root, uiPort = 5178, apiPort = 63991, smoke = false) {
  root = path.resolve(root); must(path.dirname(root).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase() && path.basename(root).startsWith('r22-lab-'), 'ISOLATED_ROOT_REQUIRED');
  const meta = await read(path.join(root, 'r22-session.json')); must(meta.root === root && meta.kind === 'r22-engineering-app-v1', 'SESSION_INVALID');
  must((await freeze()).sha256 === meta.freezeSha256, 'SOURCE_FREEZE_DRIFT');
  const env = { ...process.env, FMCG_DATA_DIR: root, FMCG_PORT: String(apiPort), FMCG_LLM_CONFIG_FILE: path.join(root,'empty.env') };
  for (const key of Object.values(LLM_ENV)) delete env[key];
  const child = spawn(process.execPath, ['--import','tsx','server/index.ts'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const log = await fs.open(path.join(root,'backend.log'),'a');
  child.stdout.on('data', bytes => { void log.write(bytes); }); child.stderr.on('data', bytes => { void log.write(bytes); });
  const api = `http://127.0.0.1:${apiPort}`, app = express();
  app.use('/api', (req,res) => {
    const outgoing = http.request(api + '/api' + req.url, { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
      void fs.appendFile(path.join(root,'ui-http.jsonl'), JSON.stringify({ at: new Date().toISOString(), method: req.method, path: '/api'+req.url, status: response.statusCode })+'\n');
    }); outgoing.on('error', () => { if (!res.headersSent) res.status(502).end(); }); req.pipe(outgoing);
  });
  app.get('/r22/export', async (_req,res,next) => {
    try { const raws = new RawStore(root), wiki = new WikiStore(root,raws), drafts = new DraftStore(root), workflows = new KnowledgeWorkflowStore(root,wiki,raws); res.json({ ...meta, draft: await drafts.get(meta.draftId), workflow: await workflows.get(meta.workflowId), formal: await wiki.allRecords(), raws: await Promise.all(meta.rawIds.map(id => raws.get(id))) }); } catch(error) { next(error); }
  });
  app.use(express.static(path.resolve('dist')));
  const ui = app.listen(Number(uiPort),'127.0.0.1'); await new Promise(resolve => ui.once('listening', resolve));
  const stop = async () => { child.kill(); await new Promise(resolve => child.once('exit',resolve)); await new Promise(resolve => ui.close(resolve)); await log.close(); };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  for (let attempt=0;attempt<100;attempt++) {
    const response = await fetch(api+'/api/health').catch(() => null); if (response?.ok) break;
    must(child.exitCode === null && attempt < 99,'BACKEND_NOT_READY'); await new Promise(resolve => setTimeout(resolve,100));
  }
  const result = { ...meta, url: `http://127.0.0.1:${uiPort}`, exportUrl: `http://127.0.0.1:${uiPort}/r22/export`, backend: 'complete server/index.ts', llm: 'disabled; empty isolated config; no real credentials', uiTest: 'NOT_RUN' };
  await fs.writeFile(path.join(root,'active-app.json'),JSON.stringify(result,null,2)+'\n');
  if (smoke) {
    try {
    const assert = (await import('node:assert/strict')).default;
    for (const route of ['/','/api/health','/api/stats','/api/raw','/api/raw-processing','/api/wiki/schema',`/api/drafts/${meta.draftId}`,`/api/knowledge/workflows/${meta.workflowId}`,'/r22/export']) {
      const response = await fetch(result.url+route); assert.equal(response.status,200,route); await response.text();
    }
    const exported = await (await fetch(result.exportUrl)).json(); assert.equal(exported.draft.source.source_level,'A'); assert.equal(exported.workflow.source_level,'D'); assert.deepEqual(exported.workflow.sections.sourceList.map(source => source.source_level),['B','D']); assert.equal(exported.formal.length,1);
    return { pass: true, root, httpChecks: 9, fakeCalls: meta.fakeCalls, realCalls: 0, realConfigReads: 0, uiTest: 'NOT_RUN' };
    } finally { await stop(); }
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command,...args] = process.argv.slice(2);
  try {
    const result = command === 'prepare' ? await prepare() : command === 'serve' ? await serve(...args) : command === 'smoke' ? await serve((await prepare()).root,5178,63991,true) : (()=>{throw Error('COMMAND_INVALID');})();
    console.log(JSON.stringify(result,null,2));
  } catch(error) { console.error(JSON.stringify({ code: error.code ?? error.message, realCalls: 0, realConfigReads: 0 })); process.exitCode=1; }
}
