import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-scan-independent-'));
try {
await mkdir(path.join(root, 'knowledge/raw'), { recursive: true });
const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-raw-media.ts', '--data-dir', root, '--all'], { encoding: 'utf8' });
const empty = run();
assert.equal(empty.status, 0);
assert.equal(JSON.parse(empty.stdout).complete, true);
await writeFile(path.join(root, 'knowledge/raw/articles'), 'directory replaced by file');
const broken = run();
assert.equal(broken.status, 1);
assert.equal(JSON.parse(broken.stdout).error, 'raw_scan_failed');
console.log(JSON.stringify({ result: 'PASS', emptyExit: empty.status, brokenExit: broken.status, broken: JSON.parse(broken.stdout) }));

} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('aipm-rawocr04-'));
  await rm(root, { recursive: true, force: true });
}
