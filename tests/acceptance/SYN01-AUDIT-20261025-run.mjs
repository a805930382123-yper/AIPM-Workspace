import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha = x => createHash('sha256').update(x).digest('hex');
const prefix = 'docs/reports/SYN01-AUDIT-20261025-';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const record = {startedAt:new Date().toISOString(), realCalls:0, rows:[], pass:false};
const check = (id, evidence) => record.rows.push({id, pass:true, evidence});
try {
  record.head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  const productDiff = execFileSync('git', ['diff', '--name-only', '60f83adba102d887fcd925df13a8021ff7669de1', '--', 'app', 'services', 'server', 'rules', 'package.json', 'package-lock.json'], {encoding:'utf8'}).trim();
  assert.equal(productDiff, '');
  const prior = JSON.parse(await fs.readFile('docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json', 'utf8'));
  for (const [file, expected] of Object.entries(prior.expected)) assert.equal(sha(await fs.readFile(file)), expected, file);
  check('same-product-and-historical-freeze', {product:'60f83ad', files:Object.keys(prior.expected).length});
  const fixture = JSON.parse(await fs.readFile('tests/acceptance/SYN01-PREP-20261025-fixtures.json', 'utf8'));
  const originalCard = await fs.readFile('docs/handoffs/NEXT-PREP-20261024-next-task.md', 'utf8');
  assert.equal(fixture.raws.length, 2);
  assert.deepEqual(fixture.raws.map(x=>x.key), ['A','B']);
  for(const x of fixture.raws) assert(originalCard.includes(`- Raw ${x.key}标题：${x.title}。正文：${x.body}`));
  check('exact-original-input', fixture.raws.map(x=>({key:x.key, title:x.title, sha256:sha(x.body)})));
  const {sourceFreeze, offlineOptions, isolatedRoot} = await import('./SYN01-PREP-20261025-core.mjs');
  const before = await sourceFreeze(); record.freeze = before;
  for (const value of [null, [], {mode:'real'}, {mode:'REAL'}, {mode:'production'}, {config:'.env.local'}, {provider:{}}, {apiKey:'synthetic-denied'}]) assert.throws(()=>offlineOptions(value));
  assert.throws(()=>isolatedRoot('workspace'));
  assert.throws(()=>isolatedRoot('../.scratch-SYN01-PREP-outside'));
  assert.equal(offlineOptions().mode, undefined);
  check('independent-option-root-rejection', 'real/unknown/config/provider/secret option and official/outside root rejected before lab creation');
  const {selftest} = await import('./SYN01-PREP-20261025-engineering.mjs');
  const outcome = await selftest({reportPrefix:'SYN01-AUDIT-20261025-'});
  record.selftest = {pass:outcome.pass, startedAt:outcome.startedAt, root:outcome.root, rows:outcome.rows, error:outcome.error, fakeCalls:outcome.fakeCalls, confirm:outcome.confirm, cleanupError:outcome.cleanupError};
  assert.equal(outcome.pass, true, outcome.error?.stack);
  assert.equal(outcome.realCalls, 0);
  assert.equal(outcome.freezeUnchanged, true);
  assert.equal(outcome.servicesClosed, true);
  assert.deepEqual(await sourceFreeze(), before);
  check('independent-frozen-rerun', {rows:outcome.rows.length, fakeCalls:outcome.fakeCalls, realCalls:0, servicesClosed:true});
  const {createLab} = await import('./SYN01-PREP-20261025-server.mjs');
  const {installOfflineGuard, fileMap} = await import('./SYN01-PREP-20261025-core.mjs');
  const {call} = await import('./SYN01-PREP-20261025-engineering.mjs');
  const persistedBefore = await fileMap(outcome.root), guard = installOfflineGuard();
  let lab;
  try {
    lab = await createLab({root:outcome.root, mode:'offline'});
    const list = await call(lab, '/api/knowledge/workflows');
    assert(list.items.some(x=>x.id===outcome.confirm.workflowId && x.status==='confirmed'));
    const commit = await call(lab, '/api/knowledge/commits/'+outcome.confirm.operationId);
    assert.equal(commit.status, 'completed'); assert.equal(commit.writtenIds.length, 3);
    const wiki = await call(lab, '/api/wiki');
    for(const item of wiki.items) {
      const detail = await call(lab, '/api/wiki/'+item.id);
      assert.equal(detail.revision, 1);
      const response = await fetch(lab.base+'/api/wiki/'+item.id+'/export');
      assert.equal(response.status, 200);
      assert.equal(await response.text(), (await lab.wiki.exportMarkdown(item.id)).markdown);
      await call(lab, '/api/wiki/'+item.id+'/references');
    }
    assert.equal(lab.requests.length, 0);
    check('independent-public-list-commit-export-references', {formalPages:wiki.items.length, trace:lab.trace, fakeCalls:0});
  } finally {if(lab) await lab.close(); guard.restore();}
  assert.deepEqual(await fileMap(outcome.root), persistedBefore);
  check('independent-reopen-readonly-byte-stability', {files:persistedBefore.length});
  record.pass = true;
} catch(error) {record.error={message:error.message, stack:error.stack}; process.exitCode=1;}
record.finishedAt = new Date().toISOString();
record.limitations = 'Independent frozen rerun and source review; fake React/jsdom + localhost HTTP only. No Chrome, real model quality, or whole-product acceptance.';
await fs.writeFile(prefix+'execution-'+stamp+'.json', JSON.stringify(record,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify({pass:record.pass, checks:record.rows.length, error:record.error, evidence:prefix+'execution-'+stamp+'.json'}));
