import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir = 'docs/reports';
async function files(root) { const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []); return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]))).flat(); }
async function snapshot(paths) { return Promise.all(paths.sort().map(async p => ({ path: p, sha256: crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex') }))); }
const product = await snapshot((await Promise.all(['app','server','services','rules','scripts'].map(files))).flat());
if (process.argv[2] === 'freeze') { await fs.writeFile(`${dir}/B06-acceptance-frozen.json`, JSON.stringify(product, null, 2)); console.log('Frozen product files: ' + product.length); }
else {
  const compare = (a, b) => { const before = new Map(a.map(e => [e.path,e.sha256])), after = new Map(b.map(e => [e.path,e.sha256])); const changedPaths = [...new Set([...before.keys(),...after.keys()])].filter(p => before.get(p) !== after.get(p)); return { unchanged: !changedPaths.length, baselineCount: before.size, currentCount: after.size, changedPaths }; };
  const read = async name => JSON.parse(await fs.readFile(`${dir}/${name}`, 'utf8'));
  const workspace = compare(await read('B06-baseline/workspace-sha256.json'), await snapshot(await files('workspace')));
  const code = compare(await read('B06-acceptance-frozen.json'), product);
  const beforeUiRepair = await read('B06-before-ui-repair-frozen.json');
  const uiRepairScope = compare(beforeUiRepair,product);
  const backendUnchanged = compare(beforeUiRepair.filter(f=>!f.path.startsWith('app\\')&&!f.path.startsWith('app/')),product.filter(f=>!f.path.startsWith('app\\')&&!f.path.startsWith('app/')));
  const http = await read('B06-acceptance-http.json'); const browser = await read('B06-acceptance-browser-runtime.json');
  const regression = await read('B06-regression-b05-http.json');
  const b05Restored = crypto.createHash('sha256').update(await fs.readFile(`${dir}/B05-acceptance-http.json`)).digest('hex') === crypto.createHash('sha256').update(await fs.readFile(`${dir}/B06-baseline/B05-acceptance-http.json`)).digest('hex');
  const result = { clientDate:'2026-10-07', node: process.version, product:code, uiRepairScope, backendUnchanged, workspace, configPresence: { localFileExists: await fs.access('.env.local').then(()=>true,()=>false), baseUrlPresent: Boolean(process.env.FMCG_LLM_BASE_URL?.trim()), modelPresent: Boolean(process.env.FMCG_LLM_MODEL?.trim()), keyPresent: Boolean(process.env.FMCG_LLM_API_KEY?.trim()) }, http: { ...http.summary, durationMs: http.durationMs, allServicesClosed: http.services.every(s => s.closed) }, regression: { ...regression.summary, durationMs:regression.durationMs, allServicesClosed:regression.services.every(s=>s.closed), originalB05ReportRestored:b05Restored }, browserClosed: browser.closed };
  await fs.writeFile(`${dir}/B06-acceptance-final-checks.json`, JSON.stringify(result,null,2));
  assert.equal(code.unchanged,true); assert.equal(backendUnchanged.unchanged,true); assert.equal(workspace.unchanged,true); assert.equal(result.http.allServicesClosed,true); assert.equal(browser.closed.api && browser.closed.ui,true); assert.equal(result.regression.allServicesClosed,true); assert.equal(b05Restored,true);
  for (const [source,dest] of [['B04-http-evidence.json','B06-acceptance-b04-http-evidence.json'],['B04-repair3-merge-payload.json','B06-acceptance-b04-merge-payload.json']]) {
    await fs.copyFile(`${dir}/${source}`,`${dir}/${dest}`);
    await fs.copyFile(`${dir}/B06-baseline/${source}`,`${dir}/${source}`);
  }
  console.log(JSON.stringify(result));
}
