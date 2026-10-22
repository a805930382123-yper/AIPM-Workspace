import path from 'node:path';

// Only extraction job records participate. Other storage paths retain their
// existing concurrency and error contracts. Queues disappear once idle.
const access = new Map<string, Promise<void>>();
const mutations = new Map<string, Promise<void>>();
function jobKey(file: string): string | undefined {
  const resolved = path.resolve(file);
  const absolute = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const directory = path.dirname(absolute);
  if (path.basename(directory) !== 'extraction-jobs' || path.basename(path.dirname(directory)) !== 'state' || path.extname(absolute) !== '.json') return undefined;
  return absolute;
}
function coordinate<T>(queues: Map<string, Promise<void>>, file: string, work: () => Promise<T>): Promise<T> {
  const key = jobKey(file);
  if (!key) return work();
  const result = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

/** Covers the entire lifetime of a job-file read handle or atomic replacement. */
export function withJobFileAccess<T>(file: string, work: () => Promise<T>): Promise<T> {
  return coordinate(access, file, work);
}

/** Serializes compound read/modify/write across store instances. Its inner I/O
 * acquires the separate file-access queue, so no recursive lock is needed. */
export function withJobMutation<T>(file: string, work: () => Promise<T>): Promise<T> {
  return coordinate(mutations, file, work);
}
