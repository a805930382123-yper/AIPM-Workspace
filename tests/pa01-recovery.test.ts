import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RecoveryRegistry } from '../services/storage/recovery.ts';
import { scanJsonRecords } from '../services/storage/files.ts';

test('PA01 damaged JSON remains byte-identical, healthy neighbors list, API scan emits safe recovery issue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-pa01-recovery-'));
  try {
    const dir = path.join(root, 'drafts', 'prompts');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'healthy.json'), JSON.stringify({ id: 'healthy', kind: 'optimizer' }));
    const corrupt = Buffer.from('{"id":"sensitive-name","body":"private text"');
    await writeFile(path.join(dir, 'private-sensitive-name.json'), corrupt);
    const scan = await scanJsonRecords(dir);
    assert.equal(scan.records.length, 1);
    assert.equal(scan.issues.length, 1);
    assert.deepEqual(await readFile(path.join(dir, 'private-sensitive-name.json')), corrupt);
    const result = await new RecoveryRegistry(root).scan();
    assert.ok(result.items.some((x) => x.kind === 'prompt-drafts' && x.reason === 'parse'));
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /sensitive-name|private text|test-pa01-recovery/);
    assert.equal(result.overflow, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
