import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const prefix = 'docs/reports/KB02-SR01-IO-DIAG-20261021-';
const ownScript = 'tests/acceptance/kb02-sr01-io-diag-20261021-';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(dir) { const files = []; try { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const file = dir + '/' + entry.name; if (entry.isDirectory()) files.push(...await walk(file)); else if (entry.isFile()) files.push(file); } } catch (error) { if (error.code !== 'ENOENT') throw error; } return files; }
async function hashes(files) { const result = {}; for (const file of files) { try { result[file] = sha(await fs.readFile(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; } } return result; }
async function changes(expected, root = '.') { const result = []; for (const [file, hash] of Object.entries(expected)) { try { if (sha(await fs.readFile(path.join(root, file))) !== hash) result.push(file); } catch { result.push(file); } } return result; }
const frozen = JSON.parse(await fs.readFile('docs/reports/KB02-SR01-R1-20261021-frozen.json', 'utf8'));
const expected = { ...frozen.product, ...frozen.tests, ...frozen.fixtures, ...frozen.acceptanceScripts };
const mode = process.argv[2];
if (mode === 'baseline') {
  const protection = (await Promise.all(['docs/reports', 'tests/acceptance', 'workspace', 'config'].map(walk))).flat().concat(['.env', '.env.local', '.env.example']);
  const baseline = { at: new Date().toISOString(), expected, mismatch: await changes(expected), protected: await hashes(protection.filter(file => !file.startsWith(prefix) && !file.startsWith(ownScript))) };
  await fs.writeFile(prefix + 'baseline.json', JSON.stringify(baseline, null, 2)); console.log(JSON.stringify({ mismatch: baseline.mismatch, protected: Object.keys(baseline.protected).length }));
} else if (mode === 'verify') {
  const baseline = JSON.parse(await fs.readFile(prefix + 'baseline.json', 'utf8'));
  const result = { at: new Date().toISOString(), frozenChanges: await changes(baseline.expected), protectedChanges: await changes(baseline.protected), newData: (await Promise.all(['workspace', 'config'].map(walk))).flat().filter(file => !Object.hasOwn(baseline.protected, file)) };
  result.pass = !result.frozenChanges.length && !result.protectedChanges.length && !result.newData.length;
  await fs.writeFile(prefix + 'integrity.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); if (!result.pass) process.exitCode = 1;
} else if (['targeted', 'load-observe', 'full-observe', 'semantics', 'probe'].includes(mode)) {
  if ((await changes(expected)).length) throw Error('Frozen source differs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb02-io-diag-'));
  for (const dir of ['app', 'server', 'services', 'rules', 'scripts', 'tests']) await fs.cp(dir, path.join(root, dir), { recursive: true });
  for (const file of Object.keys(frozen.product).filter(file => !file.includes('/'))) await fs.copyFile(file, path.join(root, file));
  await fs.mkdir(path.join(root, 'docs/reports'), { recursive: true }); await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
  const stamp = new Date().toISOString().replaceAll(':', '-'); const out = path.resolve(prefix + stamp + '-events'); await fs.mkdir(out, { recursive: true });
  const report = { at: new Date().toISOString(), mode, root, runtime: process.version, eventsDirectory: out, copyChanges: await changes(expected, root), realProviderCalls: 0, rows: [] };
  if (report.copyChanges.length) throw Error('Copy differs');
  const hook = './tests/acceptance/kb02-sr01-io-diag-20261021-observe.mjs';
  async function run(name, node, args, extraEnv = {}) {
    const start = Date.now(); let log = '', result;
    try {
      const child = spawn(node, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KB02_IO_DIAG_OUTPUT: out, KB02_IO_DIAG_TAG: name, ...extraEnv } });
      child.stdout.on('data', bytes => { log += bytes; }); child.stderr.on('data', bytes => { log += bytes; });
      result = await new Promise(resolve => { child.once('error', error => resolve({ error: error.message })); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
    } catch (error) { result = { error: error.message, code: error.code }; }
    await fs.writeFile(prefix + stamp + '-' + name + '.log', log);
    const row = { name, command: [node, ...args], ...result, durationMs: Date.now() - start, summary: log.split(/\r?\n/u).filter(line => /^ℹ (tests|pass|fail|skipped|cancelled|duration)/u.test(line)) };
    report.rows.push(row); await fs.writeFile(prefix + stamp + '-run.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(row));
  }
  console.log(JSON.stringify({ root, stamp, out }));
  const imports = ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--import', hook];
  if (mode === 'targeted') {
    await run('budget-observe', process.execPath, [...imports, '--test', 'tests/kb02-planning-budget.test.ts']);
  } else if (mode === 'load-observe') {
    const other = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
    for (const [label, node] of [['system', process.execPath], ['bundle', other]]) await Promise.all(Array.from({ length: 4 }, (_, index) => run(`budget-${label}-${index + 1}`, node, [...imports, '--test', 'tests/kb02-planning-budget.test.ts'])));
  } else if (mode === 'full-observe') {
    const files = (await fs.readdir(path.join(root, 'tests'))).filter(file => /\.test\.tsx?$/u.test(file)).map(file => 'tests/' + file);
    await run('full-observe', process.execPath, [...imports, '--test', ...files]);
  } else if (mode === 'semantics') {
    await run('semantics', process.execPath, [...imports, 'tests/acceptance/kb02-sr01-io-diag-20261021-semantics.mjs']);
  } else {
    await run('probe-system', process.execPath, ['--import', 'tsx', 'tests/acceptance/kb02-sr01-io-diag-20261021-probe.mjs']);
    const other = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
    await run('probe-bundle', other, ['--import', 'tsx', 'tests/acceptance/kb02-sr01-io-diag-20261021-probe.mjs']);
  }
  report.afterCopyChanges = await changes(expected, root); report.sourceChanges = await changes(expected);
  await fs.writeFile(prefix + stamp + '-run.json', JSON.stringify(report, null, 2)); await fs.writeFile(prefix + mode + '-latest.json', JSON.stringify(report, null, 2));
  if (report.rows.some(row => row.exitCode !== 0) || report.sourceChanges.length || report.afterCopyChanges.length) process.exitCode = 1;
} else throw Error('baseline/verify/targeted/full-observe/semantics/probe');
