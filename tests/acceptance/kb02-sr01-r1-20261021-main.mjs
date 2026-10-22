import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const prefix = 'docs/reports/KB02-SR01-R1-20261021-';
const scriptPrefix = 'tests/acceptance/kb02-sr01-r1-20261021-';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(dir) {
  const files = [];
  try { for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory()) files.push(...await walk(file)); else if (entry.isFile()) files.push(file);
  } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}
async function hashes(files) {
  const result = {};
  for (const file of files) { try { result[file] = sha(await fs.readFile(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return result;
}
async function changed(expected, root = '.') {
  const actual = await hashes(Object.keys(expected).map(file => path.join(root, file)));
  return Object.entries(expected).filter(([file, hash]) => actual[path.join(root, file)] !== hash).map(([file]) => file);
}
const prior = JSON.parse(await fs.readFile('docs/reports/KB02-STORAGE-20261020-builder-main-frozen.json', 'utf8'));
const mode = process.argv[2];
if (mode === 'baseline') {
  const product = await hashes(Object.keys(prior.product));
  const tests = await hashes((await walk('tests')).filter(file => !file.startsWith('tests/acceptance/')));
  const protection = (await Promise.all(['docs/reports', 'tests/acceptance', 'workspace', 'config'].map(walk))).flat().concat(['.env', '.env.local', '.env.example']);
  const protectedFiles = await hashes(protection.filter(file => !file.startsWith(prefix) && !file.startsWith(scriptPrefix)));
  const baseline = { at: new Date().toISOString(), product, tests, protected: protectedFiles, priorChanges: await changed({ ...prior.product, ...prior.tests, ...prior.fixtures, ...prior.acceptanceScripts }) };
  await fs.mkdir(prefix + 'source', { recursive: true });
  await fs.copyFile('services/llm/jobs.ts', prefix + 'source/jobs.ts');
  await fs.writeFile(prefix + 'baseline.json', JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify({ priorChanges: baseline.priorChanges, product: Object.keys(product).length, tests: Object.keys(tests).length, protected: Object.keys(protectedFiles).length }));
} else if (mode === 'freeze') {
  const baseline = JSON.parse(await fs.readFile(prefix + 'baseline.json', 'utf8'));
  const frozen = { at: new Date().toISOString(), product: await hashes(Object.keys(prior.product)), tests: await hashes((await walk('tests')).filter(file => !file.startsWith('tests/acceptance/'))), fixtures: await hashes(Object.keys(prior.fixtures)), acceptanceScripts: await hashes((await walk('tests/acceptance')).filter(file => file.startsWith(scriptPrefix))) };
  const diff = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).map(file => ({ file, before: before[file] ?? null, after: after[file] ?? null }));
  await fs.writeFile(prefix + 'frozen.json', JSON.stringify(frozen, null, 2));
  await fs.writeFile(prefix + 'scope.json', JSON.stringify({ at: frozen.at, product: diff(baseline.product, frozen.product), tests: diff(baseline.tests, frozen.tests) }, null, 2));
  console.log(JSON.stringify({ at: frozen.at, counts: Object.fromEntries(Object.entries(frozen).filter(([, v]) => typeof v === 'object').map(([key, value]) => [key, Object.keys(value).length])) }));
} else if (mode === 'verify') {
  const baseline = JSON.parse(await fs.readFile(prefix + 'baseline.json', 'utf8'));
  const frozen = JSON.parse(await fs.readFile(prefix + 'frozen.json', 'utf8'));
  const expected = Object.assign({}, ...Object.values(frozen).filter(value => typeof value === 'object'));
  const result = { at: new Date().toISOString(), frozenChanges: await changed(expected), protectedChanges: await changed(baseline.protected), newData: (await Promise.all(['workspace', 'config'].map(walk))).flat().filter(file => !Object.hasOwn(baseline.protected, file)) };
  result.pass = !result.frozenChanges.length && !result.protectedChanges.length && !result.newData.length;
  await fs.writeFile(prefix + 'integrity.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); if (!result.pass) process.exitCode = 1;
} else if (['run', 'red', 'targeted'].includes(mode)) {
  const frozen = mode === 'run' ? JSON.parse(await fs.readFile(prefix + 'frozen.json', 'utf8')) : { product: await hashes(Object.keys(prior.product)), tests: await hashes((await walk('tests')).filter(file => !file.startsWith('tests/acceptance/'))) };
  const expected = Object.assign({}, ...Object.values(frozen).filter(value => typeof value === 'object'));
  if ((await changed(expected)).length) throw Error('Source differs from frozen');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb02-sr01-r1-'));
  for (const dir of ['app', 'server', 'services', 'rules', 'scripts', 'tests']) await fs.cp(dir, path.join(root, dir), { recursive: true });
  for (const file of Object.keys(frozen.product).filter(file => !file.includes('/'))) await fs.copyFile(file, path.join(root, file));
  await fs.mkdir(path.join(root, 'docs/reports'), { recursive: true });
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const report = { at: new Date().toISOString(), root, runtime: process.version, copyChanges: await changed(expected, root), rows: [], realProviderCalls: 0 };
  if (report.copyChanges.length) throw Error('Copy differs from frozen');
  if (mode === 'red') await fs.copyFile(prefix + 'source/jobs.ts', path.join(root, 'services/llm/jobs.ts'));
  async function run(name, node, args) {
    const started = Date.now(); const child = spawn(node, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', bytes => { log += bytes; }); child.stderr.on('data', bytes => { log += bytes; });
    const result = await new Promise(resolve => { child.once('error', error => resolve({ error: error.message })); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
    await fs.writeFile(prefix + stamp + '-' + name + '.log', log);
    const row = { name, command: [node, ...args], ...result, durationMs: Date.now() - started, summary: log.split(/\r?\n/u).filter(line => /^ℹ (tests|pass|fail|skipped|cancelled|duration)/u.test(line)) };
    report.rows.push(row); await fs.writeFile(prefix + stamp + '-run.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(row));
  }
  console.log(JSON.stringify({ root, stamp }));
  const targeted = ['tests/kb02-sr01-r1.test.ts', 'tests/kb02-planning-budget.test.ts', 'tests/kb02-storage-recovery.test.ts', 'tests/kb02-storage-http.test.ts', 'tests/kb02-storage-ui.test.tsx'];
  if (mode !== 'run') {
    await run(mode, process.execPath, ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--import', './tests/acceptance/kb02-sr01-r1-20261021-observe.mjs', '--test', ...(mode === 'red' ? ['tests/kb02-sr01-r1.test.ts'] : targeted)]);
    report.pass = report.rows.every(row => row.exitCode === 0);
    await fs.writeFile(prefix + stamp + '-run.json', JSON.stringify(report, null, 2));
    await fs.writeFile(prefix + mode + '-latest.json', JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
    process.exit();
  }
  const files = (await fs.readdir(path.join(root, 'tests'))).filter(file => /\.test\.tsx?$/u.test(file)).map(file => 'tests/' + file);
  await run('fullsuite', process.execPath, ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--import', './tests/acceptance/kb02-sr01-r1-20261021-observe.mjs', '--test', ...files]);
  await run('tsc', process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
  await run('vite', process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
  const node24 = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
  try { await fs.access(node24); await run('node24-version', node24, ['--version']); await run('node24-targeted', node24, ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--test', ...targeted]); } catch (error) { report.node24Unavailable = error.code; }
  report.node24_20 = process.version === 'v24.20.0' ? 'RUN: fullsuite/build/targeted on system runtime' : 'NOT_RUN'; report.afterChanges = await changed(expected, root);
  report.pass = report.rows.every(row => row.exitCode === 0) && !report.afterChanges.length;
  await fs.writeFile(prefix + stamp + '-run.json', JSON.stringify(report, null, 2));
  await fs.writeFile(prefix + 'latest-run.json', JSON.stringify(report, null, 2)); if (!report.pass) process.exitCode = 1;
} else throw Error('Expected baseline/freeze/run/verify');
