// Read-only diagnostics: report native rename errors, preserving original retry policy.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.rename;
fs.rename = async (from, to) => {
  try { return await rename(from, to); }
  catch (error) {
    const target = String(to).replaceAll('\\', '/');
    if (target.includes('/kb02-budget-')) console.error(JSON.stringify({ nativeRenameFailure: true, pid: process.pid, at: new Date().toISOString(), code: error.code, syscall: error.syscall, target: target.split('/').slice(-2).join('/') }));
    throw error;
  }
};
syncBuiltinESMExports();
