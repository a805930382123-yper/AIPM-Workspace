import path from 'node:path';
import { acquireInstanceLock } from '../services/automation/instance-lock.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';

const root = path.resolve(
  process.argv[2] || process.env.FMCG_DATA_DIR || path.join(import.meta.dirname, '..', 'workspace'),
);
const lock = await acquireInstanceLock(root, 0, 'production');
const indexer = new WikiSearchIndexer(root);
try {
  console.log(JSON.stringify(await indexer.rebuildAll()));
} finally {
  try {
    await indexer.close();
  } finally {
    lock.close();
  }
}
