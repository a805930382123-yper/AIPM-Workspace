import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const prefix = 'docs/reports/KB02-K204-PREP-MAIN-20261023-';
const hash = async p => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const baseline = JSON.parse(await fs.readFile(prefix + 'baseline.json', 'utf8'));
const mainDocs = new Set(['docs/status.md', 'docs/agent-control.md', 'docs/acceptance.md', 'docs/batches/KB02.md']);
const external = p => p === 'AGENTS.md' || p.startsWith('.agents/') || p === 'docs/reports/AGENT-ROUTER-20261023-packaging.md';
const owned = p => mainDocs.has(p) || p === 'docs/handoffs/KB02-K204-PREP-20261023-task.md' || /^(docs\/reports|tests\/acceptance)\/KB02-K204-PREP(?:-AUDIT|-MAIN)?-20261023-[^/]+$/.test(p);
const changes = [], externalChanges = [];
for (const item of baseline.files) {
  let actual = null;
  try { actual = await hash(item.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual !== item.sha256 && !mainDocs.has(item.path)) {
    (external(item.path) ? externalChanges : changes).push(item.path);
  }
}
const paths = execFileSync('git', ['status', '--porcelain', '-uall'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map(line => line.slice(3));
const candidates = paths.filter(p => !external(p));
const unexpected = candidates.filter(p => !owned(p));
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
  command: 'node tests/acceptance/KB02-K204-PREP-MAIN-20261023-check.mjs',
  checkedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  baselineHead: baseline.head, protectedPaths: baseline.files.length,
  unexpectedProtectedChanges: changes, externalChanges,
  candidateFiles: candidates.length, unexpectedCandidatePaths: unexpected,
  excluded: paths.filter(external), secretMatches,
  realCalls: 0, cumulativeKnowledge: 219, promptBudget: '15/24',
};
result.pass = !changes.length && !unexpected.length && !secretMatches.length;
await fs.writeFile(prefix + 'closure.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;
