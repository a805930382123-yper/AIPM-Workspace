// Independent test-only fault seam; only operates in the explicit isolated data root.
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const original = { rename: fs.rename, appendFile: fs.appendFile, readFile: fs.readFile, writeFile: fs.writeFile };
const dataRoot = process.env.FMCG_DATA_DIR;
const counts = new Map();
async function probe(method, target) {
  if (!dataRoot || !String(target).startsWith(dataRoot)) return;
  let fault;
  try { fault = JSON.parse(await original.readFile(path.join(dataRoot, '.b05-fault.json'), 'utf8')); } catch { return; }
  const normalized = String(target).replaceAll('\\', '/');
  if (method !== fault.method || !normalized.includes(fault.match)) return;
  const count = (counts.get(fault.tag) ?? 0) + 1;
  counts.set(fault.tag, count);
  if (count < (fault.nth ?? 1) || (fault.once && count > (fault.nth ?? 1))) return;
  await original.writeFile(path.join(dataRoot, '.b05-fault-observed.json'), JSON.stringify({ method, target: normalized, count, action: fault.action }));
  if (fault.action === 'crash') process.exit(86);
  const error = new Error('Independent B05 acceptance EIO'); error.code = 'EIO'; throw error;
}
fs.rename = async (from, to) => { await probe('rename', to); return original.rename(from, to); };
fs.appendFile = async (file, ...args) => { await probe('appendFile', file); return original.appendFile(file, ...args); };
syncBuiltinESMExports();
