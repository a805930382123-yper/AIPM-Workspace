// Coordinator handoff check. Reads frozen source and prior evidence; never runs product code.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const prefix = 'docs/reports/KB02-STORAGE-20261020-';
const baseline = JSON.parse(await fs.readFile(prefix + 'builder-baseline.json', 'utf8'));
const frozen = JSON.parse(await fs.readFile(prefix + 'builder-main-frozen.json', 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function changed(map) {
  const differences = [];
  for (const [file, expected] of Object.entries(map ?? {})) {
    try {
      const actual = sha(await fs.readFile(file));
      if (actual !== expected) differences.push({file, expected, actual});
    } catch (error) { differences.push({file, expected, missing: error.code === 'ENOENT', error: error.code}); }
  }
  return differences;
}
async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, {withFileTypes:true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}
const frozenProduct = frozen.product ?? {};
const frozenTests = frozen.tests ?? {};
if (!Object.keys(frozenProduct).length || !Object.keys(frozenTests).length) throw Error('Missing frozen product/tests');
const currentProduct = (await Promise.all(['app','server','services','rules','scripts'].map(walk))).flat();
const currentTests = (await walk('tests')).filter(file => !file.startsWith('tests/acceptance/'));
const workspaceAdded = (await walk('workspace')).filter(file => !Object.hasOwn(baseline.protected ?? {}, file));
const configAdded = (await walk('config')).filter(file => !Object.hasOwn(baseline.protected ?? {}, file));
const result = {
  at:new Date().toISOString(),
  scope:'coordinator handoff integrity check; not independent acceptance',
  counts:{product:Object.keys(frozenProduct).length, tests:Object.keys(frozenTests).length, protected:Object.keys(baseline.protected ?? {}).length},
  frozenProductChanges:await changed(frozenProduct),
  frozenTestChanges:await changed(frozenTests),
  frozenScriptChanges:await changed(frozen.acceptanceScripts ?? frozen.scripts ?? {}),
  frozenFixtureChanges:await changed(frozen.fixtures ?? {}),
  protectedChanges:await changed(baseline.protected),
  unexpectedProduct:currentProduct.filter(file => !Object.hasOwn(frozenProduct,file)),
  unexpectedTests:currentTests.filter(file => !Object.hasOwn(frozenTests,file)),
  workspaceAdded,configAdded,
  changedProduct:await changed(baseline.product),
  changedTests:await changed(baseline.tests),
  addedProduct:Object.keys(frozenProduct).filter(file => !Object.hasOwn(baseline.product,file)),
  addedTests:Object.keys(frozenTests).filter(file => !Object.hasOwn(baseline.tests,file)),
  historicalLimit:'Prior PA01 evidence drift remains unresolved; this checks current round only',
};
result.pass = ['frozenProductChanges','frozenTestChanges','frozenScriptChanges','frozenFixtureChanges','protectedChanges','unexpectedProduct','unexpectedTests','workspaceAdded','configAdded'].every(key => !result[key].length);
await fs.writeFile(prefix + 'main-integrity.json', JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify({...result,changedProduct:result.changedProduct.map(x=>x.file),changedTests:result.changedTests.map(x=>x.file)}));
if (!result.pass) process.exitCode = 1;
