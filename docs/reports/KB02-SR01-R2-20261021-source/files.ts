// B04: shared atomic file helpers and a small serial queue for the new state directories.
import { randomUUID } from 'node:crypto';
import { mkdir, open, opendir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class StorageError extends Error {
  constructor(public code: string, message: string, public status = 500, public details?: unknown) { super(message); }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Windows reports a transient EPERM/EBUSY when a virus scanner or indexer briefly holds the
 * target file. Retrying the same atomic rename keeps that transient lock from failing a real
 * operation, while a genuine permission error still surfaces after the last attempt.
 */
async function renameAtomic(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

export async function writeFileAtomic(target: string, value: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, value, { encoding: 'utf8', flag: 'wx' });
    await renameAtomic(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export type StorageScanIssue={file:string;reason:'read'|'parse'|'directory'|'shape'};
type Observer={issues:Map<string,StorageScanIssue>;overflow:boolean};const observers=new Map<string,Observer>();
function observer(root:string){const key=path.resolve(root);let value=observers.get(key);if(!value){value={issues:new Map(),overflow:false};observers.set(key,value);}return value;}
export function takeStorageScanIssues(root:string){return [...observer(root).issues.values()];}
export function clearStorageScanIssue(root:string,file:string){const o=observer(root);for(const [k,x] of o.issues)if(path.resolve(x.file)===path.resolve(file))o.issues.delete(k);}
export function storageObserverOverflow(root:string){return observer(root).overflow;}
export function clearStorageObserverOverflow(root:string){observer(root).overflow=false;}
export function reportStorageIssue(root:string,file:string,reason:StorageScanIssue['reason']){const o=observer(root),key=path.resolve(file)+'\0'+reason;if(o.issues.has(key))return;if(o.issues.size>=10_000){o.overflow=true;return;}o.issues.set(key,{file,reason});}
export const JSON_SCAN_BUDGET={files:10_000,fileBytes:2*1024*1024,totalBytes:64*1024*1024} as const;
export async function readJsonRecord<T>(root:string,file:string,validate:(value:unknown)=>value is T):Promise<T|undefined>{let raw:string;try{raw=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;reportStorageIssue(root,file,'read');throw new StorageError('STORAGE_READ_FAILED','本机记录不可读，原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore'});}let value:unknown;try{value=JSON.parse(raw);}catch{reportStorageIssue(root,file,'parse');throw new StorageError('STORAGE_CORRUPT','本机记录JSON损坏，原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore'});}if(!validate(value)){reportStorageIssue(root,file,'shape');throw new StorageError('STORAGE_CORRUPT','本机记录结构无效，原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore'});}return value;}/** Stream directory entries and read only within explicit per-file and total byte budgets. */
export async function scanJsonRecords<T>(dir:string,validate?:(value:unknown,file:string)=>value is T,root=dir):Promise<{records:Array<{file:string;value:T}>;issues:StorageScanIssue[];partial:boolean;overflow:boolean;scannedFiles:number;scannedBytes:number}>{
 const records:Array<{file:string;value:T}>=[],issues:StorageScanIssue[]=[];let handle;try{handle=await opendir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {records,issues,partial:false,overflow:false,scannedFiles:0,scannedBytes:0};const issue={file:dir,reason:'directory' as const};issues.push(issue);reportStorageIssue(root,dir,'directory');return {records,issues,partial:false,overflow:false,scannedFiles:0,scannedBytes:0};}
 let partial=false,overflow=false,scannedFiles=0,scannedBytes=0;
 try{for await(const entry of handle){if(!entry.name.endsWith('.json'))continue;if(scannedFiles>=JSON_SCAN_BUDGET.files){partial=true;overflow=true;break;}scannedFiles++;const file=path.join(dir,entry.name);let fh;try{fh=await open(file,'r');const before=await fh.stat();const remaining=JSON_SCAN_BUDGET.totalBytes-scannedBytes;if(before.size>JSON_SCAN_BUDGET.fileBytes||before.size>remaining){issues.push({file,reason:'read'});reportStorageIssue(root,file,'read');partial=true;overflow=true;continue;}const buffer=Buffer.alloc(before.size);let position=0;while(position<buffer.length){const read=await fh.read(buffer,position,buffer.length-position,position);if(!read.bytesRead)break;position+=read.bytesRead;}const after=await fh.stat();if(after.size!==before.size||position!==before.size){issues.push({file,reason:'read'});reportStorageIssue(root,file,'read');partial=true;overflow=true;continue;}scannedBytes+=position;const parsed:unknown=JSON.parse(buffer.toString('utf8'));if(validate&&!validate(parsed,file)){issues.push({file,reason:'shape'});reportStorageIssue(root,file,'shape');continue;}records.push({file,value:parsed as T});}catch(error){const reason=error instanceof SyntaxError?'parse' as const:'read' as const;issues.push({file,reason});reportStorageIssue(root,file,reason);}finally{await fh?.close().catch(()=>undefined);}}
 }finally{await handle.close().catch(()=>undefined);}
 if(overflow||partial){issues.push({file:dir,reason:'directory'});reportStorageIssue(root,dir,'directory');}return {records,issues,partial:partial||overflow,overflow,scannedFiles,scannedBytes};
}
export async function listJsonRecords<T>(dir:string,validate?:(value:unknown,file:string)=>value is T,root=dir):Promise<Array<{file:string;value:T}>>{const result=await scanJsonRecords<T>(dir,validate,root);if(result.issues.length)throw new StorageError('STORAGE_CORRUPT','一个或多个本机记录损坏、不可读或超出扫描预算；原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore',issueCount:result.issues.length,partial:result.partial});return result.records;}
/** Serializes mutations that touch the same state directory. */
export class SerialQueue {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
