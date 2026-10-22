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

const baseline = JSON.parse(await fs.readFile('docs/reports/KB02-FIELDS-AUDIT-20261022-baseline.json', 'utf8'));
const productPaths = ['services/llm/knowledge-extraction.ts', 'services/llm/rules.ts'];
const testPaths = (await files('tests')).filter(file => /^tests\/[^/]+\.test\.tsx?$/u.test(file));
const fixturePaths = Object.keys(baseline.protected).filter(file => file.startsWith('tests/acceptance/'));
const scriptPaths = (await files('tests/acceptance')).filter(file => path.basename(file).startsWith(name) && /\.(?:mjs|mts|ts)$/u.test(file));
const result = {
  at: new Date().toISOString(),
  sourceHead: baseline.head,
  productCommit: baseline.productCommit,
  product: await snapshot(productPaths),
  tests: await snapshot(testPaths),
  fixtures: await snapshot(fixturePaths),
  acceptanceScripts: await snapshot(scriptPaths),
};
await fs.writeFile(prefix + 'frozen.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ product: Object.keys(result.product).length, tests: Object.keys(result.tests).length, fixtures: Object.keys(result.fixtures).length, acceptanceScripts: Object.keys(result.acceptanceScripts).length, sourceHead: result.sourceHead }));
