import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const name = 'KB02-FIELDS-20261022', prefix = `docs/reports/${name}-`, sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(dir) {
  const out = [];
  try { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const file = path.posix.join(dir, entry.name); if (entry.isDirectory()) out.push(...await files(file)); else if (entry.isFile()) out.push(file); } }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return out;
}
async function snapshot(paths) { return Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async file => [file, sha(await fs.readFile(file))]))); }
async function changes(map) { const result = []; for (const [file, hash] of Object.entries(map)) { try { if (sha(await fs.readFile(file)) !== hash) result.push(file); } catch { result.push(file); } } return result; }

const baseline = JSON.parse(await fs.readFile('docs/reports/KB02-FIELDS-AUDIT-20261022-baseline.json', 'utf8'));
const frozen = JSON.parse(await fs.readFile(prefix + 'frozen.json', 'utf8'));
const productPaths = ['services/llm/knowledge-extraction.ts', 'services/llm/rules.ts'];
const testPaths = (await files('tests')).filter(file => /^tests\/[^/]+\.test\.tsx?$/u.test(file));
const fixturePaths = Object.keys(baseline.protected).filter(file => file.startsWith('tests/acceptance/'));
const scriptPaths = (await files('tests/acceptance')).filter(file => path.basename(file).startsWith(name) && /\.(?:mjs|mts|ts)$/u.test(file));
const now = { product: await snapshot(productPaths), tests: await snapshot(testPaths), fixtures: await snapshot(fixturePaths), acceptanceScripts: await snapshot(scriptPaths) };
const scope = JSON.parse(await fs.readFile(prefix + 'scope.json', 'utf8'));
const protectedFiles = { ...baseline.protected, ...baseline.workspace, ...baseline.config };
const protectedAdded = (await Promise.all(['docs/reports', 'tests/acceptance', 'workspace', 'config'].map(files))).flat().filter(file => {
  if (Object.hasOwn(protectedFiles, file)) return false;
  return !['KB02-FIELDS-20261022', 'KB02-FIELDS-AUDIT-20261022'].some(start => path.basename(file).startsWith(start));
});
const report = { at: new Date().toISOString(), sourceHead: frozen.sourceHead, codeFreezeSHA256: sha(Buffer.from(JSON.stringify(frozen))), product: {}, tests: {}, fixtures: {}, acceptanceScripts: {}, protected: { changed: await changes(protectedFiles), added: protectedAdded }, scopeExact: false };
for (const key of ['product', 'tests', 'fixtures', 'acceptanceScripts']) {
  report[key] = { changed: await changes(frozen[key]), added: Object.keys(now[key]).filter(file => !Object.hasOwn(frozen[key], file)) };
}
report.scopeExact = [...(await changes(baseline.product)), ...(await changes(baseline.tests))].sort().join('\n') === scope.modified.slice().sort().join('\n') && Object.keys(now.tests).filter(file => !Object.hasOwn(baseline.tests, file)).sort().join('\n') === scope.addedTests.slice().sort().join('\n');
report.pass = ['product', 'tests', 'fixtures', 'acceptanceScripts'].every(key => !report[key].changed.length && !report[key].added.length) && !report.protected.changed.length && !report.protected.added.length && report.scopeExact;
await fs.writeFile(prefix + 'integrity.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;
