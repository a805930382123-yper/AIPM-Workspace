import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const name = 'KB02-FIELDS-20261022', prefix = `docs/reports/${name}-`, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(await fs.readFile(prefix + 'frozen.json', 'utf8'));
const stamp = new Date().toISOString().replaceAll(':', '-');
const runPrefix = prefix + stamp + '-';
const expected = { ...frozen.product, ...frozen.tests, ...frozen.fixtures, ...frozen.acceptanceScripts };
async function changes() { const result = []; for (const [file, hash] of Object.entries(expected)) { try { if (sha(await fs.readFile(file)) !== hash) result.push(file); } catch { result.push(file); } } return result; }
if ((await changes()).length) throw new Error('Source changed after candidate freeze');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb02-fields-luna-'));
for (const directory of ['app', 'server', 'services', 'rules', 'scripts', 'tests']) await fs.cp(directory, path.join(root, directory), { recursive: true });
await fs.cp('docs', path.join(root, 'docs'), { recursive: true, filter: source => !source.split(path.sep).includes('workspace') });
for (const file of ['index.html', 'package.json', 'tsconfig.json', 'vite.config.ts', '.gitattributes']) {
  try { await fs.copyFile(file, path.join(root, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
const copyMismatch = [];
for (const [file, hash] of Object.entries(expected)) { try { if (sha(await fs.readFile(path.join(root, file))) !== hash) copyMismatch.push(file); } catch { copyMismatch.push(file); } }
if (copyMismatch.length) throw new Error(`Isolated copy differs from freeze: ${copyMismatch.join(', ')}`);

const report = { at: new Date().toISOString(), sourceHead: frozen.sourceHead, codeFreezeSHA256: sha(Buffer.from(JSON.stringify(frozen))), isolatedRoot: root, copyMismatch, runtime: process.version, rows: [], realProviderCalls: 0, firstFailureRetained: true };
const defaults = (await fs.readdir(path.join(root, 'tests'))).filter(file => /\.test\.tsx?$/u.test(file)).map(file => `tests/${file}`);
const args = ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--test'];
const targeted = ['tests/kb02-edge-extraction.test.ts', 'tests/kb02-extraction-contract.test.ts', 'tests/kb02-classification-priority.test.ts', 'tests/kb02-final-classification.test.ts', 'tests/kb02-planning-context.test.ts', 'tests/kb02-planning-fields.test.ts', 'tests/llm.test.ts'];
const sr01 = ['tests/kb02-job-file-access.test.ts', 'tests/pa01-r01-r02.test.ts', 'tests/pa01-sol-recovery.test.ts', 'tests/kb02-sr01-r1.test.ts', 'tests/kb02-planning-budget.test.ts', 'tests/kb02-storage-recovery.test.ts', 'tests/kb02-storage-http.test.ts', 'tests/kb02-storage-ui.test.tsx'];
const oldNode = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
async function run(name, command, commandArgs) {
  const started = Date.now(), child = spawn(command, commandArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', value => log += value); child.stderr.on('data', value => log += value);
  const result = await new Promise(resolve => { child.once('error', error => resolve({ error: error.message })); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
  await fs.writeFile(runPrefix + name + '.log', log, { flag: 'wx' });
  const row = { name, command: [command, ...commandArgs], ...result, durationMs: Date.now() - started, summary: log.split(/\r?\n/u).filter(line => /^ℹ (tests|pass|fail|skipped|cancelled|duration)/u.test(line)) };
  report.rows.push(row); await fs.writeFile(runPrefix + 'run.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(row));
}
await run('targeted', process.execPath, [...args, ...targeted]);
await run('fullsuite', process.execPath, [...args, ...defaults]);
await run('tsc', process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
await run('vite', process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
await run('historical-boundary', process.execPath, [...args, 'tests/acceptance/KB02-FINAL-REPAIR-AUDIT-20261022-boundary.test.ts', 'tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs']);
await run('node24-version', oldNode, ['--version']);
await run('node24-sr01', oldNode, [...args, ...sr01]);
await run('node24-related', oldNode, [...args, ...targeted, 'tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs']);
report.copyChangedFrozenFiles = [];
for (const [file, hash] of Object.entries(expected)) { try { if (sha(await fs.readFile(path.join(root, file))) !== hash) report.copyChangedFrozenFiles.push(file); } catch { report.copyChangedFrozenFiles.push(file); } }
report.afterFreezeChanges = await changes(); report.pass = report.rows.every(row => row.exitCode === 0) && report.copyMismatch.length === 0 && report.copyChangedFrozenFiles.length === 0 && report.afterFreezeChanges.length === 0;
await fs.writeFile(runPrefix + 'run.json', JSON.stringify(report, null, 2));
await fs.writeFile(prefix + 'latest-run.json', JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
