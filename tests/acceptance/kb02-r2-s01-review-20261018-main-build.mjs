import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const prefix = 'docs/reports/KB02-R2-S01-REVIEW-20261018-main-';
const run = JSON.parse(await fs.readFile(prefix + 'tests-writable-copy.json', 'utf8'));
const frozen = JSON.parse(await fs.readFile(prefix + 'main-frozen.json', 'utf8'));
const mismatches = [];
for (const [file, expected] of Object.entries({...frozen.product, ...frozen.tests})) {
  const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(run.root, file))).digest('hex');
  if (hash !== expected) mismatches.push(file);
}
if (mismatches.length) throw new Error('Build source snapshot mismatch: ' + mismatches.join(', '));

const steps = [];
for (const [name, args] of [['tsc', ['node_modules/typescript/bin/tsc', '-b']], ['vite', ['node_modules/vite/bin/vite.js', 'build']]]) {
  const started = Date.now();
  const child = spawn(process.execPath, args, {cwd: run.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const [exitCode, signal] = await once(child, 'exit');
  await fs.writeFile(prefix + name + '.log', output);
  steps.push({name, args, exitCode, signal, durationMs: Date.now() - started});
  if (exitCode !== 0) break;
}
const evidence = {
  at: new Date().toISOString(),
  root: run.root,
  copyMismatches: mismatches,
  steps,
  pass: steps.length === 2 && steps.every(step => step.exitCode === 0),
  processesClosed: true,
};
await fs.writeFile(prefix + 'build.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
if (!evidence.pass) process.exitCode = 1;
