import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TEMP_DIR_PATTERN = /^(?:\.scratch-|\.test-|\.rn-|\.scratch$)/;

interface TempDirInfo {
  name: string;
  fileCount: number;
  bytes: number;
}

interface GitStatusSummary {
  total: number;
  untracked: number;
  modified: number;
  deleted: number;
  other: number;
  stderrWarnings: string[];
}

function parseArgs(argv: string[]): { archiveDir: string | null; rootDir: string; json: boolean } {
  let archiveDir: string | null = null;
  let rootDir = process.cwd();
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--archive') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Option --archive requires an explicit target directory path.');
      }
      archiveDir = path.resolve(next);
      i++;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Option --root requires a directory path.');
      }
      rootDir = path.resolve(next);
      i++;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run hygiene [-- --json] [-- --archive <dir>] [-- --root <repoDir>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { archiveDir, rootDir, json };
}

function readGitStatus(rootDir: string): GitStatusSummary {
  const res = spawnSync(
    'git',
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-uall', '-z'],
    { cwd: rootDir, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }
  );
  if (res.error) {
    throw res.error;
  }
  const stderrWarnings = res.stderr
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (res.status !== 0) {
    return { total: 0, untracked: 0, modified: 0, deleted: 0, other: 0, stderrWarnings };
  }

  const entries = res.stdout.toString('utf8').split('\0').filter((entry) => entry.length > 0);
  let untracked = 0;
  let modified = 0;
  let deleted = 0;
  let other = 0;

  for (const entry of entries) {
    const xy = entry.slice(0, 2);
    if (xy === '??') untracked++;
    else if (xy.includes('D')) deleted++;
    else if (xy.includes('M')) modified++;
    else other++;
  }

  return { total: entries.length, untracked, modified, deleted, other, stderrWarnings };
}

function measureDir(dirPath: string): { fileCount: number; bytes: number } {
  let fileCount = 0;
  let bytes = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          fileCount++;
          bytes += stat.size;
        } catch {
          // Ignore unreadable entries during read-only scan
        }
      }
    }
  }
  return { fileCount, bytes };
}

function listRootTempDirs(rootDir: string): TempDirInfo[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && TEMP_DIR_PATTERN.test(entry.name))
    .map((entry) => {
      const stats = measureDir(path.join(rootDir, entry.name));
      return { name: entry.name, ...stats };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sha256File(filePath: string): { sha256: string; bytes: number } {
  const buf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256, bytes: buf.length };
}

function copyDirVerified(srcDir: string, dstDir: string): void {
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirVerified(srcPath, dstPath);
    } else if (entry.isFile()) {
      const srcDigest = sha256File(srcPath);
      fs.copyFileSync(srcPath, dstPath);
      const dstDigest = sha256File(dstPath);
      if (dstDigest.sha256 !== srcDigest.sha256 || dstDigest.bytes !== srcDigest.bytes) {
        throw new Error(`SHA-256 verification failed while copying ${entry.name}`);
      }
    }
  }
}

function moveTempDirSafely(srcDir: string, dstDir: string): void {
  if (fs.existsSync(dstDir)) {
    throw new Error(`Archive target already exists: ${path.basename(dstDir)}`);
  }
  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  try {
    fs.renameSync(srcDir, dstDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      copyDirVerified(srcDir, dstDir);
      fs.rmSync(srcDir, { recursive: true, force: false });
    } else {
      throw err;
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${bytes} B`;
}

function main(): void {
  const { archiveDir, rootDir, json } = parseArgs(process.argv.slice(2));
  const git = readGitStatus(rootDir);
  const tempDirs = listRootTempDirs(rootDir);
  const totalTempBytes = tempDirs.reduce((sum, item) => sum + item.bytes, 0);
  const totalTempFiles = tempDirs.reduce((sum, item) => sum + item.fileCount, 0);

  if (archiveDir) {
    const resolvedRoot = path.resolve(rootDir);
    if (archiveDir === resolvedRoot || archiveDir.startsWith(resolvedRoot + path.sep)) {
      throw new Error('Archive target directory must be outside the repository root.');
    }
    fs.mkdirSync(archiveDir, { recursive: true });
    const archivedEntries: Array<TempDirInfo & { disposition: 'archived' }> = [];
    for (const dir of tempDirs) {
      const src = path.join(rootDir, dir.name);
      const dst = path.join(archiveDir, dir.name);
      moveTempDirSafely(src, dst);
      archivedEntries.push({ ...dir, disposition: 'archived' });
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      archivedDirs: archivedEntries.length,
      archivedFiles: totalTempFiles,
      archivedBytes: totalTempBytes,
      entries: archivedEntries,
    };
    fs.writeFileSync(path.join(archiveDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    if (json) {
      console.log(JSON.stringify({ mode: 'archive', ...manifest }, null, 2));
    } else {
      console.log(`Archived ${archivedEntries.length} temporary directories (${totalTempFiles} files, ${formatBytes(totalTempBytes)}).`);
    }
    return;
  }

  const report = {
    mode: 'report',
    git,
    tempDirs: {
      count: tempDirs.length,
      fileCount: totalTempFiles,
      totalBytes: totalTempBytes,
      items: tempDirs,
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== Workspace Hygiene Report ===');
  console.log(
    `Git status entries: ${git.total} (untracked: ${git.untracked}, modified: ${git.modified}, deleted: ${git.deleted}, other: ${git.other})`
  );
  if (git.stderrWarnings.length > 0) {
    console.log(`Git stderr warnings (${git.stderrWarnings.length}):`);
    for (const warning of git.stderrWarnings) console.log(`  - ${warning}`);
  }
  console.log(`Root temp directories (.scratch-*, .test-*, .rn-*, .scratch): ${tempDirs.length} (${totalTempFiles} files, ${formatBytes(totalTempBytes)})`);
  for (const dir of tempDirs) {
    console.log(`  - ${dir.name}: ${dir.fileCount} files, ${formatBytes(dir.bytes)}`);
  }
}

main();
