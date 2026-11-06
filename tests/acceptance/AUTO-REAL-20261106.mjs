import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmConfigSummary, loadLlmConfig } from '../../services/llm/config.ts';
import { assertNoKnownSecret, OpenAiCompatibleProvider, sanitizeProviderText } from '../../services/llm/provider.ts';
import { lwFixture } from '../lw01-fixture.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(repo, 'node_modules', '.cache');
const root = path.join(cache, 'auto-real-20261106');
const task = 'AUTO-REAL-20261106';
const limit = 2;
const baseline = '5717c9589c9f7a93f7306cebd4b6f62cdba01a5e';
const host = 'api.openai.com', model = 'gpt-6.1-terra';
const endpoint = 'https://api.openai.com/v1/chat/completions';
const endpointSha = 'd9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e';
const mode = 'direct';
const sources = {
  A: '2024年，东岸样板组模拟开业33家。',
  B: '2025年，星桥直营城区样本目标100家，实际开业80家。',
  R: '2026年，星桥直营试点样本目标120家，实际开业90家。\n\n回访负责人尚未指定。AI工具尚未上线，试点收益尚未核验。\n\n2026年试点统计是否纳入演示店，待确认。',
};
const oldTitle = '星桥东岸样板组年度观察', oldNote = '东岸样板组仅用于培训演示。';
const newTitle = '星桥直营网点年度观察', newNote = '各年度按各自统计范围并列，不跨年相加。开业须通过首单验收。';
const topicTitles = ['2026 年开业口径', '回访与上线状态'];
const frozenFiles = ['docs/handoffs/AUTO-REAL-20261106-task.md', 'tests/acceptance/AUTO-REAL-20261106.mjs', 'tests/lw01-fixture.ts',
  'services/llm/jobs.ts', 'services/llm/knowledge-extraction.ts', 'services/llm/knowledge-maintenance.ts', 'services/llm/checkpoints.ts',
  'services/llm/config.ts', 'services/llm/provider.ts', 'services/llm/openai-structured.ts', 'services/wiki/drafts.ts', 'services/wiki/maintenance.ts'];
const sha = value => createHash('sha256').update(value).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const freeze = () => Promise.all(frozenFiles.map(async file => [file, sha(await fs.readFile(path.join(repo, file)))]));
const dataPath = location => path.join(location, 'data');
const attemptPath = location => path.join(location, 'ledger', 'attempt-01');

async function writeEvidence(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

async function snapshot(directory) {
  const files = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name))).sort();
  return Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(directory, file)))]));
}

function wire(target, pages, body, reason) {
  return { version:1, changes:[{pageIndexes:pages.map((_, index) => index), action:'update', targetWikiId:target.id, baseRevision:target.revision,
    title:target.title, body, aliases:[], tags:[], reason, summary:[reason], questions:pages.flatMap(page => page.open_questions), dependsOn:[]}] };
}

async function prepare(location, kind) {
  await fs.mkdir(path.dirname(attemptPath(location)));
  const f = await lwFixture(dataPath(location));
  const raw = {};
  for (const [name, title] of [['A',oldTitle], ['B',newTitle], ['R','星桥直营网点2026年试点记录']]) {
    raw[name] = await f.rawStore.create({title, body:sources[name], sourceType:'report', sourceName:'完全虚构 AUTO-REAL 验收样例', tags:['星桥','直营网点']});
  }
  const create = (source, note) => f.wiki.create({title:source.title, body:`## 旧来源事实\n\n${source.body}\n\n## 人工补充\n\n${note}`,
    sources:[source.id], type:'metric', category:'channel', aliases:[], tags:['星桥'], knowledge_status:'source_supported',
    confidence:'medium', source_level:'D', review_status:'reviewed'});
  const old = await create(raw.A, oldNote), target = await create(raw.B, newNote);
  let fakeCalls = 0;
  f.provider.complete = async request => {
    fakeCalls++;
    const input = JSON.parse(request.user.split('\n').at(-1));
    let response;
    if (Array.isArray(input)) {
      const pending = atom => atom.text.includes('演示店');
      response = {version:2, facts:input.filter(atom => !pending(atom)).map(atom => ({atomId:atom.id,kind:'fact'})),
        questions:input.filter(pending).map(atom => ({atomId:atom.id})), sourceNotes:[]};
    } else if (input.stage === 'maintenance') {
      assert.ok(input.context.some(page => page.id === old.id));
      response = wire(old, input.pages, `${old.body}\n\n${sources.R}`, '仅供准备原目标的本地 fake。');
    } else {
      const opening = unit => !/回访负责人|AI工具|试点收益/u.test(unit.text);
      response = {version:3, document:{title:raw.R.title,main_topic:'星桥试点记录',source_level:'D'}, pages:topicTitles.map((title,index) => ({
        title, type:'metric', category:'channel', factUnitIds:input.factUnits.filter(unit => opening(unit)===(index===0)).map(unit => unit.id),
        questionUnitIds:index===0 ? input.questionUnits.map(unit => unit.id) : [],
      }))};
    }
    const text = JSON.stringify(response);
    return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};
  };
  const draft = await f.generate(raw.R.id);
  assert.equal(fakeCalls,3);
  assert.deepEqual(draft.pages.map(page => page.title),topicTitles);
  assert.equal(draft.maintenance.changes.length,1);
  const [change] = draft.maintenance.changes;
  assert.equal(change.targetWikiId,old.id);
  assert.deepEqual(change.pageIndexes,[0,1]);
  assert.ok(draft.pages[0].open_questions.some(question => question.includes('演示店')));
  const manifest = {task,kind,baseline,limit,scope:'retarget-update-A-to-B',network:mode,fakeCalls,
    rawIds:Object.fromEntries(Object.entries(raw).map(([key,value]) => [key,value.id])), draftId:draft.id, jobId:draft.jobId,
    oldId:old.id,targetId:target.id, files:await freeze(), data:await snapshot(dataPath(location))};
  const file = path.join(location,'manifest.json');
  await writeEvidence(file,manifest);
  return sha(await fs.readFile(file));
}

async function validate(location, manifestSha, kind) {
  const file = path.join(location,'manifest.json');
  const bytes = await fs.readFile(file);
  assert.equal(sha(bytes),manifestSha,'Prepared manifest SHA mismatch');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.task,task);
  assert.equal(manifest.kind,kind);
  assert.equal(manifest.baseline,baseline);
  assert.equal(manifest.limit,limit);
  assert.equal(manifest.scope,'retarget-update-A-to-B');
  assert.equal(manifest.network,mode);
  assert.deepEqual(manifest.files,await freeze(),'Frozen tool or product bytes changed');
  assert.deepEqual(manifest.data,await snapshot(dataPath(location)),'Frozen synthetic fixture changed');
  return manifest;
}

async function checkUnused(location) {
  const attempts = await fs.readdir(path.dirname(attemptPath(location))).catch(error => {
    if (error.code==='ENOENT') return [];
    throw error;
  });
  assert.equal(attempts.length,0,'Sample already reserved, including pending or failed attempts');
}

async function execute(location, manifest, manifestSha, provider, kind) {
  const dir = attemptPath(location), data = dataPath(location);
  await checkUnused(location);
  const f = await lwFixture(data);
  const [draft, old, target, raw] = await Promise.all([f.drafts.get(manifest.draftId), f.wiki.get(manifest.oldId), f.wiki.get(manifest.targetId), f.rawStore.get(manifest.rawIds.R)]);
  assert.equal(draft.jobId,manifest.jobId);
  assert.equal(draft.rawId,raw.id);
  assert.equal(raw.body,sources.R);
  assert.equal(new Set(Object.values(manifest.rawIds)).size,3);
  assert.notEqual(old.id,target.id);
  assert.deepEqual(old.sources,[manifest.rawIds.A]);
  assert.deepEqual(target.sources,[manifest.rawIds.B]);
  assert.ok(old.body.includes(sources.A) && old.body.includes(oldNote) && target.body.includes(sources.B) && target.body.includes(newNote));
  for (const page of draft.pages) {
    assert.ok(page.source_evidence.length);
    for (const evidence of page.source_evidence) {
      assert.equal(evidence.rawId,raw.id);
      assert.equal(raw.body.slice(evidence.start,evidence.end),evidence.quote);
    }
  }
  const formal = async () => ({knowledge:await snapshot(path.join(data,'knowledge')), commits:await snapshot(path.join(data,'state','wiki-commits'))});
  const before = await formal();
  assert.deepEqual(before.commits,[]);
  let reserved = false;
  Object.assign(f.provider, {name:provider.name,model:provider.model,cacheIdentity:provider.cacheIdentity,secrets:provider.secrets,complete:async request => {
    assert.ok(!reserved, 'Only one provider completion is authorized for this sample');
    const payload = JSON.parse(request.user);
    assert.equal(payload.stage,'maintenance');
    assert.equal(payload.source.id,raw.id);
    assert.deepEqual(payload.context,[target]);
    assert.deepEqual(payload.pages,JSON.parse(JSON.stringify(draft.pages)));
    assert.deepEqual(payload.document,draft.document);
    assert.deepEqual(payload.requested,{action:'update',targetWikiId:target.id});
    for (const oldValue of [old.id,manifest.rawIds.A,oldTitle,sources.A,oldNote]) assert.ok(!request.user.includes(oldValue),'Original target entered outgoing input');
    const outgoing = {system:request.system,user:request.user,structuredOutput:request.structuredOutput,timeoutMs:request.timeoutMs};
    assertNoKnownSecret(outgoing,provider.secrets);
    // Exclusive directory creation reserves the attempt even if the process stops before recording a response.
    await fs.mkdir(dir);
    reserved = true;
    await writeEvidence(path.join(dir,'reservation.json'),{task,kind,sequence:1,limit,manifestSha,network:kind==='real'?mode:'offline-fake',state:'pending',at:new Date().toISOString()});
    await writeEvidence(path.join(dir,'request.json'),outgoing);
    const started = Date.now();
    const result = await provider.complete(request);
    try {
      assertNoKnownSecret(result.text,provider.secrets);
      let parsed;
      try { parsed=JSON.parse(result.text); } catch { /* Preserve malformed provider text after the raw credential check. */ }
      assertNoKnownSecret(parsed,provider.secrets);
    } catch (error) {
      await writeEvidence(path.join(dir,'response.json'),{redacted:true,bytes:result.bytes,finishReason:result.finishReason,elapsedMs:Date.now()-started});
      throw error;
    }
    await writeEvidence(path.join(dir,'response.json'),{...result,textSha:sha(result.text),elapsedMs:Date.now()-started});
    return result;
  }});

  let next, failure;
  try {
    const [change] = draft.maintenance.changes;
    next = await f.runner.prepareChange(draft.id,{baseRevision:draft.revision,changeId:change.changeId,action:'update',targetWikiId:target.id},new AbortController().signal);
    assert.ok(reserved);
    assert.equal(next.status,'pending_confirmation');
    await writeEvidence(path.join(dir,'candidate.json'),next.maintenance.changes.length===1?next.maintenance.changes[0]:next.maintenance.changes);
    assert.equal(next.maintenance.changes.length,1);
    const [candidate] = next.maintenance.changes;
    assert.equal(candidate.action,'update');
    assert.equal(candidate.targetWikiId,target.id);
    assert.equal(candidate.baseRevision,target.revision);
    assert.deepEqual(candidate.pageIndexes,[0,1]);
    assert.deepEqual(candidate.candidate.sources,[manifest.rawIds.B,raw.id]);
    assert.deepEqual(next.pages,draft.pages);
  } catch (error) { failure=error; }

  const after = await formal();
  const unchanged = JSON.stringify(before)===JSON.stringify(after);
  const draftUnchanged = JSON.stringify(await f.drafts.get(draft.id))===JSON.stringify(draft);
  if (reserved) await writeEvidence(path.join(dir,'outcome.json'),{state:failure||!unchanged?'failed':'candidate-ready',
    error:failure?{code:sanitizeProviderText(failure.code??'CHECK_FAILED',provider.secrets),message:sanitizeProviderText(failure.message,provider.secrets)}:null,
    formalUnchanged:unchanged,draftUnchanged,before,after,realAttempts:kind==='real'?1:0,semanticReview:'independent-review-required'});
  if (failure || !unchanged) throw Error(reserved?'Attempt recorded, stop and inspect outcome.json':
    `Preflight stopped before reservation: ${sanitizeProviderText(failure?.message??'Frozen files changed',provider.secrets)}`);
  return {state:'candidate-ready',realAttempts:kind==='real'?1:0,fakeAttempts:kind==='offline'?1:0,ledger:dir};
}

async function offline() {
  const previous = globalThis.fetch;
  const results = [];
  for (const scenario of ['candidate','transport-failure','invalid-wire','credential-echo']) {
    const location = await fs.mkdtemp(path.join(cache,'auto-real-offline-'));
    const manifestSha = await prepare(location,'offline');
    const manifest = await validate(location,manifestSha,'offline');
    const provider = new OpenAiCompatibleProvider({baseUrl:'https://api.openai.com/v1',model,apiKey:'synthetic-auto-real-test-key',source:'env'});
    let intercepted = 0;
    globalThis.fetch = async (url,options) => {
      assert.equal(String(url),endpoint);
      intercepted++;
      if (scenario==='transport-failure') throw Error('synthetic-auto-real-test-key local fault');
      const input = JSON.parse(JSON.parse(options.body).messages[1].content);
      const content = scenario==='credential-echo'?'"synthetic-auto-real-test-\\u006bey"':scenario==='invalid-wire'?'{}':JSON.stringify(wire(input.context[0],input.pages,
        `${input.context[0].body}\n\n## 本次来源事实\n\n${sources.R}`, '离线测试结果。'));
      return Response.json({choices:[{message:{content},finish_reason:'stop'}]});
    };
    try {
      const run = () => execute(location,manifest,manifestSha,provider,'offline');
      if (scenario==='candidate') assert.equal((await run()).state,'candidate-ready');
      else await assert.rejects(run,/Attempt recorded/);
      await assert.rejects(run,/already reserved/);
      const outcome = await readJson(path.join(attemptPath(location),'outcome.json'));
      assert.equal(outcome.formalUnchanged,true);
      assert.equal(outcome.draftUnchanged,scenario!=='candidate');
      assert.equal(outcome.realAttempts,0);
      assert.equal(intercepted,1);
      assert.ok(!JSON.stringify(outcome).includes('synthetic-auto-real-test-key'));
      if (scenario==='credential-echo') {
        assert.equal(outcome.error.code,'LLM_OUTPUT_CONTAINS_SECRET');
        assert.equal((await readJson(path.join(attemptPath(location),'response.json'))).redacted,true);
      }
      results.push({scenario,state:outcome.state,fakeAttempts:intercepted,realAttempts:0});
    } finally { globalThis.fetch=previous; }
  }
  const pending = await fs.mkdtemp(path.join(cache,'auto-real-offline-'));
  await fs.mkdir(attemptPath(pending),{recursive:true});
  await assert.rejects(() => checkUnused(pending),/already reserved/);
  return {results,pendingReservationBlocks:true,configReads:0,realAttempts:0};
}

async function main() {
  const [command,manifestSha,network,...extra] = process.argv.slice(2);
  if (command==='offline' && !manifestSha) {
    await fs.mkdir(cache,{recursive:true});
    return offline();
  }
  if (command==='prepare' && !manifestSha) {
    await fs.mkdir(cache,{recursive:true});
    await fs.mkdir(root);
    return {task,root,manifestSha:await prepare(root,'real'),configReads:0,realAttempts:0};
  }
  if (command!=='run' || !/^[a-f0-9]{64}$/u.test(manifestSha??'') || network!==mode || extra.length) {
    throw Error('Use prepare, offline, or run <approved manifest SHA-256> direct');
  }
  assert.ok(!process.execArgv.includes('--use-env-proxy') && !process.env.NODE_OPTIONS?.includes('--use-env-proxy')
    && process.env.NODE_USE_ENV_PROXY!=='1','Direct release requires native proxy mode off');
  await checkUnused(root);
  const manifest = await validate(root,manifestSha,'real');
  const configFile = path.join(repo,'.env.local');
  const config = await loadLlmConfig({filePath:configFile});
  const summary = llmConfigSummary(config,configFile);
  assert.ok(summary.configured && summary.source==='local-file' && summary.baseUrlHost===host && summary.model===model
    && sha(summary.baseUrl)===endpointSha,'Authorized Provider identity mismatch');
  await writeEvidence(path.join(root,'config-read.json'),{configReads:1,source:summary.source,host,model,endpointSha,network});
  const original = globalThis.fetch;
  globalThis.fetch = (url,options) => {
    assert.equal(String(url),endpoint,'Only the authorized endpoint may be reached');
    return original(url,{...options,redirect:'error'});
  };
  try { return await execute(root,manifest,manifestSha,new OpenAiCompatibleProvider(config),'real'); }
  finally { globalThis.fetch=original; }
}

try { console.log(JSON.stringify(await main())); }
catch (error) { console.error(sanitizeProviderText(error.message)); process.exitCode=1; }
