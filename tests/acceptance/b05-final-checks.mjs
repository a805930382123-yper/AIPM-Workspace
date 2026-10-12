// Independent closeout: no product or user data writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const reportDir = 'docs/reports';
const readJson = async name => JSON.parse(await fs.readFile(`${reportDir}/${name}`, 'utf8'));
async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return nested.flat();
}
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function compare(baseline, current) {
  const before = new Map(baseline.map(e => [e.path, e.sha256]));
  const after = new Map(await Promise.all(current.map(async p => [p, await hash(p)])));
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p));
  return { unchanged: changedPaths.length === 0, baselineCount: before.size, currentCount: after.size, changedPaths };
}
const frozen = await readJson('B05-acceptance-frozen.json');
const current = (await Promise.all(['app', 'server', 'services', 'rules'].map(files))).flat();
const product = await compare(frozen, current);
const workspace = await compare(await readJson('B05-baseline/workspace-sha256.json'), (await files('workspace')).filter(p => !p.split(path.sep).includes('assets')));
const configPresence = {
  localFileExists: await fs.access('.env.local').then(() => true, () => false),
  baseUrlPresent: Boolean(process.env.FMCG_LLM_BASE_URL?.trim()),
  modelPresent: Boolean(process.env.FMCG_LLM_MODEL?.trim()),
  keyPresent: Boolean(process.env.FMCG_LLM_API_KEY?.trim()),
};
const http = await readJson('B05-acceptance-http.json');
const browser = await readJson('B05-acceptance-browser-runtime.json');
const result = { clientDate: '2026-10-07', node: process.version, product, workspace, configPresence,
  http: { ...http.summary, durationMs: http.durationMs, allServicesClosed: http.services.every(s => s.closed) },
  browserServicesClosed: browser.closed };
assert.equal(product.unchanged, true);
assert.equal(workspace.unchanged, true);
assert.equal(result.http.allServicesClosed, true);
assert.equal(browser.closed.api && browser.closed.ui, true);
await fs.writeFile(`${reportDir}/B05-acceptance-final-checks.json`, JSON.stringify(result, null, 2));
for (const [source, dest] of [['B04-http-evidence.json', 'B05-acceptance-b04-http-evidence.json'], ['B04-repair3-merge-payload.json', 'B05-acceptance-b04-merge-payload.json']]) {
  await fs.copyFile(`${reportDir}/${source}`, `${reportDir}/${dest}`);
}
console.log(JSON.stringify(result));
