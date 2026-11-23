import path from 'node:path';
import { stat } from 'node:fs/promises';
import { migrateRawMedia } from '../services/raw/media-migration.ts';
import { RawStore } from '../services/raw/store.ts';

const help = `Historical Raw image derivative migration (local OCR only)
Usage: node --import tsx scripts/migrate-raw-media.ts --data-dir <directory> (--raw-id <UUID> ... | --all) [--apply]
Without --apply this only previews; no files are created and no OCR or network requests run.
--raw-id may be repeated. --all explicitly selects every Raw. --data-dir is always required.
Existing derivatives of every state are preserved. Errors exit 1; invalid arguments exit 2.
`;
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(help);
} else {
  let dataDir: string | undefined;
  let all = false;
  let apply = false;
  const rawIds: string[] = [];
  let invalid = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply' && !apply) apply = true;
    else if (arg === '--all' && !all) all = true;
    else if ((arg === '--data-dir' || arg === '--raw-id') && args[index + 1] && !args[index + 1].startsWith('--')) {
      const value = args[++index];
      if (arg === '--data-dir' && !dataDir) dataDir = value;
      else if (arg === '--raw-id' && /^[0-9a-f-]{36}$/iu.test(value)) rawIds.push(value);
      else invalid = true;
    } else invalid = true;
  }
  if (invalid || !dataDir || (all ? rawIds.length > 0 : rawIds.length === 0)) {
    process.stderr.write(help);
    process.exitCode = 2;
  } else {
    const store = new RawStore(path.resolve(dataDir));
    try {
      if (!(await stat(path.join(store.root, 'knowledge', 'raw'))).isDirectory())
        throw new Error('Raw directory required');
      const result = await migrateRawMedia(store, {
        rawIds: all ? (await store.list({ strictScan: true })).map(({ id }) => id) : rawIds,
        apply,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.complete ? 0 : 1;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ mode: apply ? 'apply' : 'preview', complete: false, error: 'raw_scan_failed' })}\n`,
      );
      process.exitCode = 1;
    }
  }
}
