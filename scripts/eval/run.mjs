import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { loadExtractionRules, FROZEN_BUDGETS } from '../../services/llm/rules.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { assertNoKnownSecret, sanitizeDeep } from '../../services/llm/provider.ts';
import { writeJsonAtomic } from '../../services/storage/files.ts';
import { score } from './score.mjs';
const root = process.cwd(), rulesDir = path.join(root, 'rules'), results = path.join(root, 'evals/results');
const sha = s => createHash('sha256').update(s).digest('hex');
const canonical = v => JSON.stringify(v, function (k, x) { return x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b, 'en'))) : x; });
const digest = v => sha(canonical(v));
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const write = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeJsonAtomic(file, value); };
const normalize = s => s.replace(/\r\n?/gu, '\n');
const reqHash = r => digest({ system: r.system, user: r.user, purpose: r.purpose, structuredOutput: r.structuredOutput });
const stamp = () => new Date().toISOString();
const ratio = x => x.total ? x.passed / x.total : null;
const sourceRunId = '2026-11-15T10-34-38-191Z-832c444a';
const sourceSha = 'ca9a118ee1f7bba97facaf49c186675537e8ad5612a6d2398b8d33ecd3387b61';
const sourceRecordingBytes = ['c9ef7235c3cbfa32600b3ea7a138beac9ce3971d96b8b31ce476c45294493feb','c196ff11e93c40987def15b483c75c3293353cc11a4ff894f32506d84691b942','1412e1f8614432fd2eea9b97fd3da4ee437c4130646b8dc2930a43528d7ee9b1','cb39cc3063a8942274dc0c2ea86305e3cbf04fff1058f5008be76bd57fff80f3'];
const sourceCases = ['basic-01-timeout','basic-02-cutoff','basic-03-scope','basic-04-repeat','basic-05-reconcile','basic-06-rate','trap-01-forecast','trap-02-units'];
function passes(m, t) { return m.validFields.pass && m.evidence.total > 0 && ratio(m.evidence) >= t.evidence && ratio(m.facts) >= t.factRecallPerCase && (m.questions.total === 0 || ratio(m.questions) >= t.questionRecall) && m.forbidden.length <= t.forbiddenAssertions && m.partition.length <= t.partitionViolations && (m.duplicates.total === 0 || m.duplicates.count / m.duplicates.total <= t.duplicateRate) && m.emptyTopics <= t.emptyTopics; }
function parseArgs(args) { let o = { chain: '', mode: 'replay', recording: 'live-20261115-baseline', record: false }; for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a === '--record')
        o.record = true;
    else if (['--chain', '--case', '--mode', '--recording', '--baseline', '--resume-from', '--resume-sha256'].includes(a)) {
        if (!args[i + 1] || args[i + 1].startsWith('--'))
            throw Error(`Missing ${a}`);
        o[a.slice(2)] = args[++i];
    }
    else
        throw Error(`Unknown argument ${a}`);
} if (o.chain !== 'standard-extract' || !['replay', 'live'].includes(o.mode) || !/^[-a-z0-9]+$/u.test(o.recording) || o.record && o.mode !== 'live' || o.case && !/^[-a-z0-9]+$/u.test(o.case))
    throw Error('Invalid chain, mode, case, recording or record');
 if ((o['resume-from'] || o['resume-sha256']) && (!o['resume-from'] || o['resume-sha256'] !== sourceSha || o.mode !== 'live' || !o.record || o.case || o.baseline || o.recording !== 'live-20261115-baseline')) throw Error('Invalid resume arguments');
 return o; }
export async function run(options, synthetic = false) {
    const base = path.join(root, 'evals/cases/standard-extract'), ids = (await readdir(base, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
    if (options.case && !ids.includes(options.case))
        throw Error('Unknown case');
    let selected = options.case ? [options.case] : ids;
    const { weeklyReview, ...threshold } = await json(path.join(root, 'evals/thresholds.json'));
    const bundle = await loadExtractionRules(rulesDir), cases = [];
    for (const id of selected) {
        let dir = path.join(base, id), c = await json(path.join(dir, 'case.json')), g = await json(path.join(dir, 'gold.json'));
        if (c.id !== id || c.chain !== options.chain || !['synthetic', 'own'].includes(c.license) || c.bodyNormalization !== 'lf-v1' || c.input.mode !== 'standard' || c.input.bodyFile !== 'body.txt')
            throw Error(`Invalid case ${id}`);
        let body = normalize(await readFile(path.join(dir, c.input.bodyFile), 'utf8'));
        let chunks = chunkText(body, FROZEN_BUDGETS);
        if (chunks.length !== 1)
            throw Error(`Expected one chunk: ${id}`);
        cases.push({ id, dir, c, g, body, chunks, caseHash: digest(c), goldHash: digest(g), bodyHash: sha(body) });
    }
    if (options.mode === 'live' && options.record)
        for (const item of (options['resume-from'] ? cases.slice(4) : cases)) {
            const f = path.join(item.dir, 'recordings', `${options.recording}.json`);
            try {
                await readFile(f);
                throw Error(`Recording already exists: ${item.id}`);
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        }
    let baseline;
    if (options.baseline) {
        baseline = await json(path.resolve(options.baseline));
        const metrics = baseline.summary?.measures, keys = ['structure', 'evidence', 'factRecall', 'questionRecall', 'forbidden', 'partition', 'duplicateRate', 'emptyTopics'];
        if (baseline.schemaVersion !== 1 || baseline.scoringSchemaVersion !== 2 || baseline.chain !== options.chain || !Array.isArray(baseline.cases) || canonical(baseline.cases.map(x => [x.id, x.bodyHash, x.goldHash])) !== canonical(cases.map(x => [x.id, x.bodyHash, x.goldHash])) || baseline.cases.some(x => !['PASS', 'FAIL'].includes(x.status)) || !metrics || Object.keys(metrics).length !== keys.length || keys.some(k => !Object.hasOwn(metrics, k) || (metrics[k] !== null && (typeof metrics[k] !== 'number' || !Number.isFinite(metrics[k])))))
            throw Error('Incompatible baseline');
    }
    let source, replayed = [];
    if (options['resume-from']) {
        if (options.mode !== 'live' || !options.record || options.case || options.baseline || options.recording !== 'live-20261115-baseline' || options['resume-sha256'] !== sourceSha) throw Error('Invalid resume arguments');
        const bytes = await readFile(path.resolve(options['resume-from']));
        if (sha(bytes) !== sourceSha) throw Error('Resume source SHA mismatch');
        source = JSON.parse(bytes.toString('utf8'));
        if (source.runId !== sourceRunId || source.schemaVersion !== 1 || source.scoringSchemaVersion !== 1 || source.mode !== 'live' || source.chain !== options.chain || source.rulesVersion !== bundle.rulesVersion || source.thresholdHash !== digest(threshold) || canonical(cases.map(x=>x.id)) !== canonical(sourceCases) || !Array.isArray(source.cases) || source.cases.length !== 8 || source.cases.some((x,i)=>x.id!==cases[i].id || x.status !== (i<3?'PASS':i===3?'FAIL':'NOT_RUN') || x.caseHash!==cases[i].caseHash || x.goldHash!==cases[i].goldHash || x.bodyHash!==cases[i].bodyHash)) throw Error('Incompatible resume source');
        if (!Array.isArray(source.ledger) || source.ledger.length!==8 || source.ledger.some((x,i)=>x.caseId!==sourceCases[Math.floor(i/2)] || x.stage!==(i%2?'planning':'extracting') || x.status!=='success')) throw Error('Invalid source ledger');
        const walk=async dir=>(await Promise.all((await readdir(path.join(root,dir),{withFileTypes:true})).map(e=>e.isDirectory()?walk(`${dir}/${e.name}`):e.isFile()?[`${dir}/${e.name}`]:[]))).flat();
        const names=(await Promise.all(['services/llm','services/wiki','services/storage'].map(walk))).flat().sort();
        const product=[];for(const name of names)product.push([name,sha(normalize(await readFile(path.join(root,name),'utf8')))]);
        if(sha(JSON.stringify(product))!=='20d80ac6f25b61d97862ff926823dd716649771d9ab962c61407f24e3ae93602')throw Error('Product fingerprint mismatch');
        for(let i=0;i<4;i++){
            const f=path.join(cases[i].dir,'recordings',`${options.recording}.json`), raw=await readFile(f), rec=JSON.parse(raw.toString('utf8'));
            if(sha(raw)!==sourceRecordingBytes[i] || digest(rec)!==source.cases[i].recordingHash || rec.origin!=='live' || rec.provider?.name!=='openai-compatible' || rec.provider?.model!=='gpt-6.1-terra' || canonical(rec.provider)!==canonical(source.cases[i].provider) || !Array.isArray(rec.calls) || rec.calls.length!==2 || rec.calls.some((c,j)=>c.stage!==(j?'planning':'extracting') || typeof c.requestHash!=='string' || typeof c.completion?.text!=='string' || typeof c.completion?.bytes!=='number' || !(typeof c.completion.finishReason==='string'||c.completion.finishReason===null)))throw Error(`Invalid source recording ${cases[i].id}`);
        }
        for(let i=0;i<4;i++){
            const r=await run({chain:options.chain,mode:'replay',recording:options.recording,record:false,case:cases[i].id});
            if(!r.summary.pass)throw Error(`Resume replay failed: ${cases[i].id}`);
            replayed.push({...r.cases[0],executionMode:'replay',oldStatus:source.cases[i].status});
        }
        try { await readFile(path.join(results,`resume-${sourceSha}.json`)); throw Error('Resume permit already exists'); }
        catch(e) { if(e.code!=='ENOENT') throw e; }
    }
    let real;
    if (options.mode === 'live') {
        const { loadLlmConfig } = await import('../../services/llm/config.ts');
        const { OpenAiCompatibleProvider } = await import('../../services/llm/provider.ts');
        real = new OpenAiCompatibleProvider(await loadLlmConfig({ filePath: path.resolve(root, process.env.FMCG_LLM_CONFIG_FILE || '.env.local') }));
        if(source && (real.name!=='openai-compatible'||real.model!=='gpt-6.1-terra'))throw Error('Provider identity mismatch');
    }
    const keyFiles = {};
    for (const name of ['scripts/eval/run.mjs', 'scripts/eval/score.mjs', 'evals/thresholds.json'])
        keyFiles[name] = sha(await readFile(path.join(root, name)));
    let runId = `${stamp().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`, file = path.join(results, `${runId}-${options.chain}.json`), result = { schemaVersion: 1, scoringSchemaVersion: 2, runId, mode: source?'mixed':synthetic ? 'synthetic' : options.mode, chain: options.chain, startedAt: stamp(), bodyNormalization: 'lf-v1', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), keyFiles, rulesVersion: bundle.rulesVersion, thresholdHash: digest(threshold), cases: cases.map(c => ({ id: c.id, bodyHash: c.bodyHash, goldHash: c.goldHash, caseHash: c.caseHash, status: 'NOT_RUN' })), ledger: [] };
    if(source){result.cases.splice(0,4,...replayed);result.sourceRunId=sourceRunId;result.sourceResultSha=sourceSha;result.sourceResult=path.resolve(options['resume-from']);result.sourceLedgerSha=digest(source.ledger);result.replayCalls=source.ledger.length;result.sourceUsage={requests:source.ledger.length,promptTokens:source.ledger.reduce((n,x)=>n+(x.usage?.promptTokens??0),0),completionTokens:source.ledger.reduce((n,x)=>n+(x.usage?.completionTokens??0),0),unknownRequests:source.ledger.filter(x=>x.unknownUsage).length};}
    await write(file, result);
    console.log(source?'Reused 4 cases / 8 prior requests; live 4 cases / at most 8 requests; cumulative at most 16.':`Cases: ${cases.length}; expected provider calls: ${cases.reduce((n, c) => n + c.chunks.length + 1, 0)}; mode: ${result.mode}`);
    if(source){const permit=await open(path.join(results,`resume-${sourceSha}.json`),'wx');try{await permit.writeFile(JSON.stringify({sourceSha,runId,status:'occupied'})+'\n');await permit.sync();}finally{await permit.close();}}
    let stopped = false;
    for (const [index, item] of cases.entries()) {
        if(source && index<4)continue;
        if (stopped)
            break;
        const { id, dir, c, g, body, chunks, caseHash, goldHash, bodyHash } = item;
        let row = result.cases[index], recFile = path.join(dir, 'recordings', `${options.recording}.json`), recording;
        if(source)row.executionMode='live';
        if (options.mode === 'replay' && !synthetic) {
            recording = await json(recFile);
            if (recording.schemaVersion !== 1 || !['live', 'synthetic'].includes(recording.origin) || recording.bodyNormalization !== 'lf-v1' || recording.caseHash !== caseHash || recording.goldHash !== goldHash || recording.bodyHash !== bodyHash || recording.rulesVersion !== bundle.rulesVersion || !Array.isArray(recording.calls))
                throw Error(`Incompatible recording ${id}; explicit re-record required`);
            row.recordingHash = digest(recording);
        }
        if (options.mode === 'live' && options.record) {
            try {
                await readFile(recFile);
                throw Error(`Recording already exists: ${id}`);
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        }
        let calls = [], cursor = 0, stage = 'extracting';
        let provider = { name: real?.name ?? recording?.provider.name ?? 'synthetic', model: real?.model ?? recording?.provider.model ?? 'synthetic-v1', secrets: real?.secrets ?? [], complete: async (request) => {
                let hash = reqHash(request), summary = { systemSha256: sha(request.system), userSha256: sha(request.user), purpose: request.purpose, structuredOutput: !!request.structuredOutput };
                if (options.mode === 'replay' && !synthetic) {
                    let call = recording.calls[cursor++];
                    if (!call || call.stage !== stage || call.requestHash !== hash || typeof call.completion?.text !== 'string' || typeof call.completion?.bytes !== 'number' || !(typeof call.completion.finishReason === 'string' || call.completion.finishReason === null))
                        throw Error(`Recording request/completion mismatch ${id} ${stage}`);
                    return call.completion;
                }
                let completion;
                if (synthetic) {
                    let payload = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
                    let obj;
                    if (stage === 'extracting') {
                        let business = payload.filter(x => !x.text.includes('合成模拟材料'));
                        let qs = business.filter(x => /负责人未知|样本条件待确认|附件尚未/u.test(x.text));
                        obj = { version: 2, facts: business.filter(x => !qs.includes(x)).map(x => ({ atomId: x.id, kind: x.fragment ? 'ambiguous' : 'fact' })), questions: qs.map(x => ({ atomId: x.id })), sourceNotes: [] };
                    }
                    else
                        obj = { version: 3, document: { source_level: 'D', title: c.input.title, main_topic: '合成业务' }, pages: [{ title: '合成业务', type: 'metric', category: 'metric', factUnitIds: payload.factUnits.map(x => x.id), questionUnitIds: payload.questionUnits.map(x => x.id) }] };
                    let text = JSON.stringify(obj);
                    completion = { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
                }
                else {
                    if(source && result.ledger.length>=8)throw Error('Resume request limit exceeded');
                    let entry = { caseId: id, stage, status: 'attempted', startedAt: stamp(), unknownUsage: true };
                    result.ledger.push(entry);
                    await write(file, result);
                    let start = Date.now();
                    try {
                        completion = await real.complete(request);
                        assertNoKnownSecret(completion, real.secrets);
                        entry.status = 'success';
                        entry.durationMs = Date.now() - start;
                        entry.usage = completion.usage ?? {};
                        entry.unknownUsage = completion.usage?.promptTokens === undefined || completion.usage?.completionTokens === undefined;
                        await write(file, result);
                    }
                    catch (e) {
                        entry.status = 'failed';
                        entry.durationMs = Date.now() - start;
                        entry.usage = e.details?.usage ?? {};
                        entry.unknownUsage = entry.usage.promptTokens === undefined || entry.usage.completionTokens === undefined;
                        entry.error = sanitizeDeep({ code: e.code ?? 'ERROR', message: e.message }, real.secrets);
                        await write(file, result);
                        throw e;
                    }
                }
                calls.push({ stage, requestSummary: summary, requestHash: hash, completion });
                return completion;
            } };
        let cp = { version: 1, jobId: randomUUID(), rawId: c.input.rawId, rawSha256: bodyHash, pipelineVersion: 'kb02-2', rulesVersion: bundle.rulesVersion, providerIdentity: 'eval', chunks: chunks.map(({ index, start, end }) => ({ index, start, end })), completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: stamp(), integrity: '' };
        let store = new ExtractionCheckpointStore(root);
        cp = store.prepare(cp);
        const save = async (value) => { cp = store.prepare(value); return cp; };
        try {
            let raw = { id: c.input.rawId, title: c.input.title, sourceType: c.input.sourceType, sourceName: c.input.sourceName, tags: c.input.tags };
            let out = await runKnowledgePipeline({ raw, body, bodySha256: bodyHash, rulesDir, provider, checkpoint: cp, beforeCall: async (s) => { stage = s; return save({ ...cp, attempts: cp.attempts + 1 }); }, saveCheckpoint: save, beforePlanning: async (current) => save({ ...current, maintenance: { version: 1, context: [] } }) });
            if (recording && cursor !== recording.calls.length)
                throw Error('Unused recording calls');
            row.metrics = score(out.outcome, body, c.input.rawId, g);
            row.status = passes(row.metrics, threshold) ? 'PASS' : 'FAIL';
            row.provider = out.outcome.provider;
        }
        catch (e) {
            row.status = 'FAIL';
            row.error = sanitizeDeep({ code: e.code ?? 'EVAL_ERROR', message: e.message, details: e.details }, provider.secrets);
            row.metrics = { validFields: null, evidence: null, facts: { passed: 0, total: g.requiredFacts.length, details: g.requiredFacts.map(f => ({ id: f.id, locations: [] })) }, questions: null, forbidden: null, partition: null, duplicates: null, emptyTopics: null };
        }
        if ((synthetic || options.mode === 'live' && options.record) && calls.length) {
            let rec = { schemaVersion: 1, origin: synthetic ? 'synthetic' : 'live', bodyNormalization: 'lf-v1', caseHash, goldHash, bodyHash, rulesVersion: bundle.rulesVersion, provider: { name: provider.name, model: provider.model }, calls };
            assertNoKnownSecret(rec, provider.secrets);
            await write(recFile, rec);
            row.recordingHash = digest(rec);
        }
        await write(file, result);
        if (options.mode === 'live' && row.status !== 'PASS')
            stopped = true;
    }
    const rows = result.cases;
    let passed = rows.filter(x => x.status === 'PASS').length, factPassed = rows.reduce((a, x) => a + (x.metrics?.facts.passed ?? 0), 0), factTotal = rows.reduce((a, x) => a + (x.metrics?.facts.total ?? 0), 0);
    const sum = (fn) => rows.reduce((a, x) => a + (x.metrics ? fn(x.metrics) : 0), 0);
    const div = (a, b) => b ? a / b : null;
    const complete = rows.every(x => x.metrics?.validFields);
    const measures = { structure: div(rows.filter(x => x.metrics?.validFields?.pass).length, rows.length), evidence: complete ? div(sum(m => m.evidence?.passed ?? 0), sum(m => m.evidence?.total ?? 0)) : null, factRecall: div(factPassed, factTotal), questionRecall: complete ? div(sum(m => m.questions?.passed ?? 0), sum(m => m.questions?.total ?? 0)) : null, forbidden: complete ? sum(m => m.forbidden?.length ?? 0) : null, partition: complete ? sum(m => m.partition?.length ?? 0) : null, duplicateRate: complete ? div(sum(m => m.duplicates?.count ?? 0), sum(m => m.duplicates?.total ?? 0)) : null, emptyTopics: complete ? sum(m => m.emptyTopics ?? 0) : null };
    result.summary = { passed, total: rows.length, facts: { passed: factPassed, total: factTotal }, measures, pass: passed === rows.length && measures.structure >= threshold.structure && factTotal > 0 && factPassed / factTotal >= threshold.factRecallMicro };
    if(source){const token=key=>result.ledger.reduce((sum,x)=>sum+(x.usage?.[key]??0),0);result.summary.usage={sourceRequests:result.sourceUsage.requests,newRequests:result.ledger.length,totalRequests:result.sourceUsage.requests+result.ledger.length,promptTokens:result.sourceUsage.promptTokens+token('promptTokens'),completionTokens:result.sourceUsage.completionTokens+token('completionTokens'),unknownRequests:result.sourceUsage.unknownRequests+result.ledger.filter(x=>x.unknownUsage).length};}
    result.finishedAt = stamp();
    if (baseline) {
        result.baseline = { runId: baseline.runId, rulesVersion: baseline.rulesVersion, providers: baseline.cases.map(x => x.provider), measures: Object.fromEntries(Object.keys(measures).map(k => [k, { before: baseline.summary.measures[k], after: measures[k], delta: baseline.summary.measures[k] === null || measures[k] === null ? null : measures[k] - baseline.summary.measures[k] }])) };
    }
    await write(file, result);
    let markdown = `# ${options.chain}\n\n${passed}/${rows.length} cases; facts ${factPassed}/${factTotal}; ${result.summary.pass ? 'PASS' : 'FAIL'}\n\n` + rows.map(x => `- ${x.id}: ${x.status}${x.error ? ' ' + x.error.code : ''}`).join('\n') + (result.baseline ? '\n\nBaseline metrics: ' + JSON.stringify(result.baseline.measures) : '') + '\n';
    await writeFile(file.replace(/\.json$/u, '.md'), markdown);
    console.log(markdown, `Result: ${file}`);
    return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/eval/run.mjs')) {
    const args = process.argv.slice(2);
    const chain = args[args.indexOf('--chain') + 1];
    const execute = async () => chain === 'news-relevance'
        ? (await import('./news-relevance.mjs')).runNewsRelevance(args)
        : chain === 'weekly-review' ? (await import('./weekly-review.mjs')).runWeeklyReview(args) : run(parseArgs(args));
    execute().then(r => { if (!r.summary.pass) process.exitCode = 1; })
        .catch(e => { console.error(e.message); process.exitCode = 1; });
}
