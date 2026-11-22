import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';

export type FaultMode =
  'failed-job' | 'done-checkpoint' | 'coverage-checkpoint' | 'cancelled-job' | 'start-state' | 'new-job';
/** Process-local seam, restricted to one disposable fixture root. Real atomic retry still runs. */
export function atomicFault(root: string, mode: FaultMode, refusals = Infinity, errno = 'EPERM') {
  const original = fs.rename;
  const events: Array<{ target: string; temp: string; before?: string }> = [];
  const prefix = root.replaceAll('\\', '/') + '/';
  let enabled = true;
  fs.rename = async (from, to) => {
    const target = String(to).replaceAll('\\', '/');
    if (enabled && target.startsWith(prefix) && events.length < refusals) {
      const record = await fs.readFile(from, 'utf8').then((text) => {
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      });
      if (
        (mode === 'new-job' && target.includes('/extraction-jobs/') && record?.status === 'running') ||
        (mode === 'failed-job' && target.includes('/extraction-jobs/') && record?.status === 'failed') ||
        (mode === 'cancelled-job' && target.includes('/extraction-jobs/') && record?.status === 'cancelled') ||
        (mode === 'done-checkpoint' && target.includes('/extraction-checkpoints/') && record?.stage === 'done') ||
        (mode === 'coverage-checkpoint' &&
          target.includes('/extraction-checkpoints/') &&
          record?.lastError?.diagnostic) ||
        (mode === 'start-state' && target.includes('/raw-processing/') && record?.status === 'processing')
      ) {
        const before = await fs.readFile(to).then(
          (b) => createHash('sha256').update(b).digest('hex'),
          () => undefined,
        );
        events.push({ target: String(to), temp: String(from), before });
        throw Object.assign(new Error('Synthetic isolated rename refusal'), {
          code: errno,
          syscall: 'rename',
          path: String(from),
          dest: String(to),
        });
      }
    }
    return original(from, to);
  };
  syncBuiltinESMExports();
  return {
    events,
    release: () => {
      enabled = false;
    },
    restore: () => {
      fs.rename = original;
      syncBuiltinESMExports();
    },
  };
}
