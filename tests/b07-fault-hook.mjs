// B07 construction self-test fault seam (test-only, never imported by product code).
//
// Patches the fs functions the atomic writer uses, but *only* for paths inside the explicitly
// isolated FMCG_DATA_DIR. Any path outside that root is passed through untouched, so a mistake in
// this file cannot damage the formal workspace. The fault to inject is read from
// `<FMCG_DATA_DIR>/.b07-fault.json` so a test can arm/diarm it while the product keeps running.
//
// Fault file: { method: 'writeFile'|'rename', match: '<substring of the target path>',
//               nth?: number, once?: boolean, action?: 'error'|'crash', tag?: string }
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const original = { readFile: fs.readFile, writeFile: fs.writeFile, rename: fs.rename };
const dataRoot = process.env.FMCG_DATA_DIR;
const counts = new Map();

function insideRoot(target) {
  if (!dataRoot) return false;
  const resolved = path.resolve(String(target));
  const root = path.resolve(dataRoot);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function armed() {
  try { return JSON.parse(await original.readFile(path.join(dataRoot, '.b07-fault.json'), 'utf8')); }
  catch { return undefined; }
}

async function probe(method, target) {
  if (!insideRoot(target)) return;
  const fault = await armed();
  if (!fault || fault.method !== method) return;
  const normalized = String(target).replaceAll('\\', '/');
  if (!normalized.includes(fault.match)) return;
  const tag = fault.tag ?? `${method}:${fault.match}`;
  const count = (counts.get(tag) ?? 0) + 1;
  counts.set(tag, count);
  if (count < (fault.nth ?? 1)) return;
  if (fault.once && count > (fault.nth ?? 1)) return;
  // The observation file is written with the *original* writeFile, so it can never recurse.
  await original.writeFile(path.join(dataRoot, '.b07-fault-observed.json'), JSON.stringify({ method, target: normalized, count, action: fault.action ?? 'error', at: new Date().toISOString() })).catch(() => undefined);
  if (fault.action === 'crash') process.exit(87);
  const error = new Error(`B07 construction fault injection: ${method} ${normalized}`);
  error.code = 'EIO';
  throw error;
}

fs.writeFile = async (file, ...rest) => { await probe('writeFile', file); return original.writeFile(file, ...rest); };
fs.rename = async (from, to) => { await probe('rename', to); return original.rename(from, to); };
syncBuiltinESMExports();
