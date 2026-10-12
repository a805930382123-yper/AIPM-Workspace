// Independent acceptance-only builtin filesystem seam. No product module is imported.
// Disabled unless the isolated data directory contains .acceptance-fault.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const original = { rename: fs.rename, appendFile: fs.appendFile, readFile: fs.readFile, writeFile: fs.writeFile };
const root = process.env.FMCG_DATA_DIR;
const counters = new Map();
async function probe(method, target) {
  if (!root) return;
  let rule;
  try { rule = JSON.parse(await original.readFile(path.join(root, '.acceptance-fault.json'), 'utf8')); } catch { return; }
  const normalized = String(target).replaceAll('\\', '/');
  if (rule.method !== method || !normalized.includes(rule.match)) return;
  const key = rule.tag;
  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);
  if (count < (rule.nth ?? 1)) return;
  await original.writeFile(path.join(root, '.acceptance-fault-observed.json'), JSON.stringify({ method, target: normalized, count, action: rule.action }));
  if (rule.action === 'crash') process.exit(86);
  if (rule.once && count > (rule.nth ?? 1)) return;
  const error = new Error('Independent acceptance injected EIO at ' + method);
  error.code = 'EIO';
  throw error;
}
fs.rename = async (from, to) => { await probe('rename', to); return original.rename(from, to); };
fs.appendFile = async (target, ...args) => { await probe('appendFile', target); return original.appendFile(target, ...args); };
syncBuiltinESMExports();
