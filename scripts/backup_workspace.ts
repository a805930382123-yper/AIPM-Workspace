import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'fmcg-workspace-backup';
const VERSION = 1;
const ROOTS = ['knowledge', 'prompts', 'drafts', 'state', 'meetings', 'work-items'];
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_FILES = 20000;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function inside(parent: string, candidate: string) { const rel = path.relative(parent, candidate); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
function checkSeparated(a: string, b: string, description: string) {
  const left = path.resolve(a), right = path.resolve(b);
  if (inside(left, right) || inside(right, left)) throw new Error(`${description}：路径不能互相包含。`);
}
type ArchiveFile = { path: string; size: number; sha256: string; base64: string };
type Archive = { format: string; version: number; createdAt: string; files: ArchiveFile[] };

async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  async function descend(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`拒绝符号链接：${full}`);
      if (info.isDirectory()) await descend(full);
      else if (info.isFile()) found.push(full);
      else throw new Error(`拒绝特殊文件：${full}`);
    }
  }
  const rootInfo = await lstat(root).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error));
  if (rootInfo?.isSymbolicLink() || (rootInfo && !rootInfo.isDirectory())) throw new Error('数据根目录必须是真实目录，不能是符号链接。');
  for (const name of ROOTS) {
    const dir = path.join(root, name);
    const info = await lstat(dir).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error));
    if (info?.isSymbolicLink()) throw new Error(`拒绝白名单目录符号链接：${dir}`);
    if (info && !info.isDirectory()) throw new Error(`白名单路径必须是目录：${dir}`);
    await descend(dir);
  }
  return found.sort((a, b) => a.localeCompare(b));
}
async function snapshot(root: string): Promise<ArchiveFile[]> {
  const files = await walk(root);
  if (files.length > MAX_FILES) throw new Error(`文件数超过上限 ${MAX_FILES}。`);
  let total = 0;
  const archive: ArchiveFile[] = [];
  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes.length > MAX_FILE) throw new Error(`单文件超过 64 MiB：${path.relative(root, file)}`);
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error('归档总大小超过 256 MiB。');
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!ROOTS.some(dir => relative.startsWith(`${dir}/`))) throw new Error(`文件超出备份白名单：${relative}`);
    archive.push({ path: relative, size: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') });
  }
  return archive;
}
function fingerprint(files: ArchiveFile[]) { return JSON.stringify(files.map(({ path, size, sha256 }) => [path, size, sha256])); }

/** Checks RFC 4648 base64 in linear time, with its size already bounded by MAX_FILE. */
function validBase64(value: string, byteSize: number): boolean {
  const padding = byteSize % 3 === 0 ? 0 : byteSize % 3 === 1 ? 2 : 1;
  const expectedLength = 4 * Math.ceil(byteSize / 3);
  if (value.length !== expectedLength) return false;
  const dataLength = value.length - padding;
  for (let i = 0; i < dataLength; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f)) return false;
  }
  for (let i = dataLength; i < value.length; i++) if (value.charCodeAt(i) !== 0x3d) return false;
  return true;
}

export async function exportWorkspace(dataRootArg: string, outputArg: string) {
  const root = path.resolve(dataRootArg), output = path.resolve(outputArg);
  checkSeparated(root, output, '归档输出');
  const rootInfo = await lstat(root).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error));
  if (!rootInfo) throw new Error('数据根目录不存在；请检查 --data-root 路径。');
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('数据根目录必须是真实目录，不能是符号链接。');
  const before = await snapshot(root);
  const after = await snapshot(root);
  if (fingerprint(before) !== fingerprint(after)) throw new Error('数据在导出读取期间发生变化；请停止写入服务后重试。');
  const archive: Archive = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), files: before };
  await mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(archive)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temp, output); }
  catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
  return { path: output, files: before.length, bytes: before.reduce((sum, item) => sum + item.size, 0) };
}

function validateArchive(value: unknown): ArchiveFile[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('归档必须是 JSON 对象。');
  const archive = value as Partial<Archive>;
  if (archive.format !== FORMAT || archive.version !== VERSION || !Array.isArray(archive.files)) throw new Error('归档格式或版本不受支持。');
  if (archive.files.length > MAX_FILES) throw new Error(`文件数超过上限 ${MAX_FILES}。`);
  const paths = new Set<string>(); const foldedPaths = new Set<string>(); let total = 0;
  for (const item of archive.files) {
    if (!item || typeof item.path !== 'string' || item.path.includes('\\') || item.path.startsWith('/') || /^[A-Za-z]:/.test(item.path)
      || item.path.split('/').some(part => !part || part === '.' || part === '..')
      || !ROOTS.some(dir => item.path.startsWith(`${dir}/`))) throw new Error(`归档包含非法路径：${String(item?.path)}`);
    if (paths.has(item.path)) throw new Error(`归档包含重复路径：${item.path}`);
    const segments = item.path.split('/');
    for (const segment of segments) {
      const stem = segment.split('.')[0].toUpperCase();
      if (/[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) throw new Error(`归档包含 Windows 不安全路径段：${segment}`);
    }
    const folded = item.path.toLocaleLowerCase('en-US');
    if (foldedPaths.has(folded)) throw new Error(`归档包含大小写重复路径：${item.path}`);
    paths.add(item.path);
    foldedPaths.add(folded);
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_FILE) throw new Error(`文件大小无效：${item.path}`);
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256) || typeof item.base64 !== 'string' || !validBase64(item.base64, item.size)) throw new Error(`校验字段无效：${item.path}`);
    const bytes = Buffer.from(item.base64, 'base64');
    if (bytes.toString('base64') !== item.base64 || bytes.length !== item.size || sha(bytes) !== item.sha256) throw new Error(`文件长度或 SHA-256 校验失败：${item.path}`);
    total += item.size; if (total > MAX_TOTAL) throw new Error('归档总大小超过 256 MiB。');
  }
  return archive.files;
}

export async function restoreWorkspace(inputArg: string, dataRootArg: string) {
  const input = path.resolve(inputArg), target = path.resolve(dataRootArg);
  if (inside(target, input)) throw new Error('恢复目标不能包含归档输入文件。');
  const raw = JSON.parse(await readFile(input, 'utf8')) as unknown;
  const files = validateArchive(raw);
  const targetStat = await lstat(target).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error));
  if (targetStat?.isSymbolicLink()) throw new Error('恢复目标不能是符号链接。');
  if (targetStat && (!targetStat.isDirectory() || (await readdir(target)).length > 0)) throw new Error('恢复目标必须不存在或为空目录；已有数据不会被覆盖。');
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-${process.pid}-${Date.now()}`;
  await mkdir(temp, { recursive: false });
  try {
    for (const file of files) {
      const destination = path.join(temp, ...file.path.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
    }
    if (targetStat) {
      const empty = `${target}.empty-${process.pid}`;
      await rename(target, empty);
      try {
        if ((await readdir(empty)).length !== 0) throw new Error('恢复提交时目标目录已出现新文件；未恢复，原有文件已保留。');
        await rmdir(empty);
        await rename(temp, target);
      } catch (error) {
        const hasOriginal = await lstat(empty).then(() => true, () => false);
        const hasTarget = await lstat(target).then(() => true, () => false);
        if (hasOriginal && !hasTarget) await rename(empty, target).catch(() => undefined);
        else if (!hasOriginal && !hasTarget) await mkdir(target, { recursive: false }).catch(() => undefined);
        await rm(temp, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } else await rename(temp, target);
  } catch (error) { await rm(temp, { recursive: true, force: true }).catch(() => undefined); throw error; }
  return { path: target, files: files.length, bytes: files.reduce((sum, item) => sum + item.size, 0) };
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`缺少参数 ${name}。`);
  return args[index + 1];
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'export') console.log(JSON.stringify(await exportWorkspace(argument(args, '--data-root'), argument(args, '--output'))));
  else if (mode === 'restore') console.log(JSON.stringify(await restoreWorkspace(argument(args, '--input'), argument(args, '--data-root'))));
  else throw new Error('用法：node --import tsx scripts/backup_workspace.ts export --data-root <root> --output <file>；restore --input <file> --data-root <new-root>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error ? error.message : '归档失败。' })); process.exitCode = 1; });
}
