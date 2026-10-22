// Run the complete default suite from an exact frozen copy on a writable temp volume.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const source = process.cwd();
const prefix = 'docs/reports/KB02-R2-ASTRA-20261016-main-';
const frozen = JSON.parse(await fs.readFile(prefix + 'main-frozen.json', 'utf8'));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fmcg-kb02-r2-astra-fullsuite-'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

for (const dir of ['app', 'server', 'services', 'rules', 'scripts', 'tests']) {
  await fs.cp(path.join(source, dir), path.join(root, dir), {recursive: true});
}
for (const file of ['package.json', 'package-lock.json', '.env.example', '.gitignore', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'index.html']) {
  try { await fs.copyFile(path.join(source, file), path.join(root, file)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await fs.mkdir(path.join(root, 'docs', 'reports'), {recursive: true});
await fs.symlink(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'junction');

const mismatches = [];
for (const [file, expected] of Object.entries({...frozen.product, ...frozen.tests})) {
  if (sha(await fs.readFile(path.join(root, file))) !== expected) mismatches.push(file);
}
if (mismatches.length) throw new Error('Frozen copy mismatch: ' + mismatches.join(', '));

const tests = (await fs.readdir(path.join(root, 'tests')))
  .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.tsx'))
  .map(file => 'tests/' + file);
const started = Date.now();
const child = spawn(process.execPath, ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--test', ...tests], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => output += chunk);
child.stderr.on('data', chunk => output += chunk);
const [exitCode, signal] = await once(child, 'exit');
await fs.writeFile(prefix + 'tests-writable-copy.log', output);
const evidence = {
  at: new Date().toISOString(),
  root,
  node: process.version,
  scope: 'byte-identical frozen product and complete default tests on writable temporary filesystem',
  frozenProductFiles: Object.keys(frozen.product).length,
  frozenTestFiles: Object.keys(frozen.tests).length,
  copyMismatches: mismatches,
  exitCode,
  signal,
  durationMs: Date.now() - started,
  testSummary: output.split(/\r?\n/).filter(line => /^ℹ (tests|pass|fail|cancelled|skipped|todo|duration)/u.test(line)),
  processClosed: true,
  originalWorkspaceNotUsedForTestWrites: true,
};
await fs.writeFile(prefix + 'tests-writable-copy.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
process.exitCode = exitCode ?? 1;
