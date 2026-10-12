// Independent browser-only fault fixture. Mutates only the named isolated test root.
import { watch } from 'node:fs';
import { readFile, readdir, rename, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const dir=path.resolve(root,'docs/reports/fixtures/B03-recheck-browser-20261005/knowledge/raw/assets');
const evidence=path.resolve(root,'docs/reports/B03-recheck-browser-fault.json');
const existing=new Set(await readdir(dir));
let claimed=false;
const watcher=watch(dir,async (_event,file)=>{
  const name=String(file||'');
  if(claimed||existing.has(name)||!/^[-a-f0-9]{36}\.json$/.test(name))return;
  claimed=true;
  const target=path.join(dir,name),backup=target+'.browser-recheck-backup';
  try{
    for(let n=0;;n++){
      try{await rename(target,backup);break;}
      catch(e){if(n>=200)throw e;await new Promise(r=>setTimeout(r,5));}
    }
    await mkdir(target);
    const record=JSON.parse(await readFile(backup,'utf8'));
    await writeFile(evidence,JSON.stringify({isolated:true,target,backup,record,blockedAt:new Date().toISOString()},null,2));
    console.log('BLOCKED '+name+' status='+record.status);
    clearTimeout(timer);watcher.close();
  }catch(e){console.error(e);clearTimeout(timer);watcher.close();process.exitCode=1;}
});
const timer=setTimeout(()=>{console.error('FAULT_WATCH_TIMEOUT');watcher.close();process.exitCode=1;},90000);
console.log('ARMED '+dir);
