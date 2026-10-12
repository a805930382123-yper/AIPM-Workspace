import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileSnapshot,delay} from './b08-harness.mjs';
const prefix='docs/reports/FULL2-20261010-browser-resumed';
for(const suffix of ['']){
 const name=prefix+suffix+'-runtime.json',r=JSON.parse(await fs.readFile(name,'utf8'));
 const snapshot=async()=>Object.fromEntries(await Promise.all(['knowledge','prompts','drafts','state'].map(async k=>[k,await fileSnapshot(path.join(r.dataRoot,k))])));
 const evidence=prefix+suffix+'-files.json';
 if(process.argv[2]==='restart'){
  const before=await snapshot(),count=r.restartCount??0;
  await fs.writeFile(path.join(r.dataRoot,'.restart-api'),'independent same-directory restart');
  let current;for(let n=0;n<150;n++){current=JSON.parse(await fs.readFile(name,'utf8'));if((current.restartCount??0)>count)break;await delay(100);}
  assert.ok((current.restartCount??0)>count,'restart did not finish');
  const after=await snapshot();assert.deepEqual(after,before);
  const stats=await fetch(current.api+'/api/stats').then(x=>x.json());
  const prompts=[];for(const entry of await fs.readdir(path.join(r.dataRoot,'prompts'),{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.json'))prompts.push(JSON.parse(await fs.readFile(path.join(r.dataRoot,'prompts',entry.name),'utf8')));
  await fs.writeFile(evidence,JSON.stringify({result:'PASS',sameDirectory:true,restartCount:current.restartCount,before,after,stats,prompts},null,2));
  console.log({suffix,result:'PASS',stats,promptFiles:prompts.length});
 }else if(process.argv[2]==='stop'){
  await fs.writeFile(r.stopFile,'stop only own acceptance services');console.log({suffix,stopRequested:true});
 }
}

