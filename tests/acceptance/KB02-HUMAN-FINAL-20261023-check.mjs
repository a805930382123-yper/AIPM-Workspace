import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Read-only release verification, except for this run's new evidence file.
const prefix = 'docs/reports/KB02-HUMAN-20261023-';
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const sha = async p => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const freeze = await read(prefix + 'freeze.json');
const baseline = await read(prefix + 'baseline.json');
const productPaths = new Set(freeze.files.map(x => x.path));
const docs = new Set(['docs/status.md', 'docs/agent-control.md', 'docs/acceptance.md', 'docs/architecture.md', 'docs/product-spec.md', 'docs/batches/KB02.md', 'docs/handoffs/KB02-HUMAN-20261023-task.md']);
const external = p => p === 'AGENTS.md' || p.startsWith('.agents/') || p === 'docs/reports/AGENT-ROUTER-20261023-packaging.md';
const owned = p => productPaths.has(p) || docs.has(p) || /^(docs\/reports|tests\/acceptance)\/KB02-HUMAN(?:-AUDIT|-CLOSE|-FINAL)?-20261023-[^/]+$/.test(p);
const paths = execFileSync('git', ['status', '--porcelain', '-uall'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map(x => x.slice(3));
const candidates = paths.filter(p => !external(p));
const unexpectedPaths = candidates.filter(p => !owned(p));
const drift = [];
for (const item of freeze.files) if (await sha(item.path) !== item.sha256) drift.push(item.path);
const protectionChanges = [];
for (const item of baseline.files) {
  let actual = null;
  try { actual = await sha(item.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual !== item.sha256 && !productPaths.has(item.path) && !external(item.path)) protectionChanges.push(item.path);
}
const secrets = [];
try {
  for (const line of (await fs.readFile('.env.local', 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)\s*=\s*["']?(.+?)["']?\s*$/);
    if (match && match[1].length >= 8) secrets.push(match[1]);
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const secretMatches = [];
for (const p of candidates) {
  const content = await fs.readFile(p, 'utf8');
  if (secrets.some(secret => content.includes(secret))) secretMatches.push(p);
}
const result = {
  command: 'node tests/acceptance/KB02-HUMAN-FINAL-20261023-check.mjs',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checkedAt: new Date().toISOString(),
  freezeAggregateSha256: freeze.aggregateSha256,
  frozenFiles: freeze.files.length, drift,
  protectedFiles: baseline.files.length, protectionChanges,
  candidateFiles: candidates.length, unexpectedPaths,
  excluded: paths.filter(external), secretMatches,
  realCalls: 0, knowledgeBudget: '219/500', promptBudget: '15/24',
};
result.pass = !drift.length && !protectionChanges.length && !unexpectedPaths.length && !secretMatches.length;
const output = 'docs/reports/KB02-HUMAN-FINAL-20261023-check.json';
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;
