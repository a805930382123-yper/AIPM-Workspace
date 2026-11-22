import { StorageError } from '../storage/files.ts';

const ERRNOS = new Set([
  'EPERM',
  'EACCES',
  'EBUSY',
  'ENOSPC',
  'EIO',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOTDIR',
  'EEXIST',
]);
/** Keep OS messages, paths and payloads out of the extraction recovery contract. */
export function storageFailure(error: unknown): StorageError | undefined {
  if (error instanceof StorageError) return error;
  if (!error || typeof error !== 'object') return undefined;
  const value = error as NodeJS.ErrnoException;
  const fileOperation = ['mkdir', 'open', 'write', 'rename', 'unlink', 'read', 'scandir'].includes(value.syscall ?? '');
  if (!ERRNOS.has(value.code ?? '') && !fileOperation) return undefined;
  const operation = fileOperation ? value.syscall : 'write';
  return new StorageError('STORAGE_WRITE_FAILED', '本机状态保存失败；请解除存储故障后重试保存状态。', 503, {
    operation,
    errno: ERRNOS.has(value.code ?? '') ? value.code : 'OTHER',
  });
}
