// Explicit diagnostic preload only. No product imports this file; writes are untouched
// unless a named synthetic fault mode is selected for kb02-budget-* temp fixtures.
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { ExtractionJobStore, ExtractionRunner } from '../../services/llm/jobs.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { RawStateStore } from '../../services/raw/state.ts';

const mode = process.env.KB02_DIAG_MODE ?? 'observe';
const outputDir = process.env.KB02_DIAG_OUTPUT;
const tag = process.env.KB02_DIAG_TAG ?? 'manual';
const events = [], roots = new Set(), reads = new Map();
const originalRename = fs.rename, originalReadFile = fs.readFile;
const inside = file => /[\\/]kb02-budget-[^\\/]+(?:[\\/]|$)/u.test(String(file));
const errorInfo = e => ({ name:e?.name, code:e?.code, message:e?.message, syscall:e?.syscall, path:e?.path, dest:e?.dest });
const emit = event => { if (events.length < 15000) events.push({ms:performance.now(), ...event}); };
const jobInfo = j => j && ({id:j.id,status:j.status,stage:j.stage,callCount:j.callCount,error:j.error,checkpoint:j.checkpoint});
const cpInfo = c => c && ({jobId:c.jobId,stage:c.stage,attempts:c.attempts,chunksDone:c.completedChunks?.length,hasPlan:!!c.plan,lastError:c.lastError});
function wrap(klass, method, summarize, shouldLog = () => true) {
  const original = klass.prototype[method];
  klass.prototype[method] = async function(...args) {
    const root = this.root ?? this.deps?.root;
    if (!root || !inside(root)) return original.apply(this,args);
    roots.add(root);
    const info = {kind:klass.name,method,root,id:typeof args[0]==='string'?args[0]:args[0]?.jobId};
    try {
      const result = await original.apply(this,args);
      if (shouldLog(result, info)) emit({...info,ok:true,value:summarize(result)});
      return result;
    } catch(e) { emit({...info,ok:false,error:errorInfo(e)}); throw e; }
  };
}
wrap(ExtractionJobStore,'update',jobInfo);
wrap(ExtractionJobStore,'insert',jobInfo);
wrap(ExtractionJobStore,'get',jobInfo,(j,i)=>{
  const key=i.root+'|'+i.id, value=JSON.stringify(jobInfo(j));
  if(reads.get(key)===value)return false;
  reads.set(key,value); return true;
});
wrap(ExtractionCheckpointStore,'save',cpInfo);
wrap(ExtractionCheckpointStore,'get',cpInfo);
wrap(RawStateStore,'set',s=>({rawId:s.rawId,status:s.status,jobId:s.jobId,lastError:s.lastError}));
wrap(ExtractionRunner,'start',r=>({job:jobInfo(r.job),reused:r.reused}));

fs.rename = async (from,to) => {
  if (!inside(to)) return originalRename(from,to);
  if (mode !== 'observe') {
    const target=String(to).replaceAll('\\','/');
    if(!target.includes('/extraction-jobs/')&&!target.includes('/extraction-checkpoints/'))return originalRename(from,to);
    const record = await originalReadFile(from,'utf8').then(text=>{try{return JSON.parse(text);}catch{return undefined;}},()=>undefined);
    const inject = (mode==='failed-job-rename' && target.includes('/extraction-jobs/') && record?.status==='failed')
      || (mode==='done-checkpoint-rename' && target.includes('/extraction-checkpoints/') && record?.stage==='done')
      || (mode==='coverage-checkpoint-rename' && target.includes('/extraction-checkpoints/') && record?.lastError?.code==='LLM_PLAN_COVERAGE_INVALID');
    if(inject){const e=Object.assign(new Error('Synthetic diagnostic EPERM at '+target),{code:'EPERM',syscall:'rename',path:String(from),dest:String(to)});emit({kind:'rename',synthetic:true,ok:false,error:errorInfo(e)});throw e;}
  }
  try { return await originalRename(from,to); }
  catch(e){ emit({kind:'rename',synthetic:false,ok:false,error:errorInfo(e)}); throw e; }
};
syncBuiltinESMExports();
// Monitor rather than intercept uncaught failures; retain Node's normal exit behavior.
process.on('uncaughtExceptionMonitor',e=>emit({kind:'uncaughtExceptionMonitor',error:errorInfo(e)}));
process.on('exit',()=>{
  if(!outputDir || !events.length)return;
  syncFs.writeFileSync(path.join(outputDir,`${tag}-${process.pid}.json`),JSON.stringify({node:process.version,mode,pid:process.pid,roots:[...roots],events},null,2));
});
