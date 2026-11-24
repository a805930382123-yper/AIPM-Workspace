import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireInstanceLock } from '../services/automation/instance-lock.ts';

test('ENG05 acquireInstanceLock rejects corrupt instance.lock with RUNTIME_LOCK_UNREADABLE and preserves SyntaxError cause', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aipm-eng05-lock-'));
  const lockFile = path.join(dir, 'state', 'runtime', 'instance.lock');
  try {
    await mkdir(path.dirname(lockFile), { recursive: true });
    await writeFile(lockFile, '{corrupt-json', 'utf8');
    await assert.rejects(
      () => acquireInstanceLock(dir, 0, 'production'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /RUNTIME_LOCK_UNREADABLE/);
        assert.ok(error.cause instanceof SyntaxError);
        assert.ok(error.cause instanceof Error);
        return true;
      },
    );
    assert.equal(await readFile(lockFile, 'utf8'), '{corrupt-json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
