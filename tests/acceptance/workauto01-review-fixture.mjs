import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RawStore } from '../../services/raw/store.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';

export async function businessHashes(data) {
  const hashes={};
  for(const folder of ['work-items','knowledge/raw']) {
    const files=await readdir(path.join(data,folder),{recursive:true,withFileTypes:true}).catch(error=>{
      if(error.code!=='ENOENT')throw error;
      return [];
    });
    for(const f of files) if(f.isFile()) {
      const file=path.join(f.parentPath,f.name);
      hashes[path.relative(data,file)]=createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  return hashes;
}

export async function createReviewFixture() {
  const run=await mkdtemp(path.join(os.tmpdir(),'workauto01-review-'));
  const data=path.join(run,'data'),envDir=path.join(run,'vite-env'),config=path.join(run,'empty-provider.env');
  await mkdir(envDir);await writeFile(config,'');
  const raws=new RawStore(data),store=new WorkItemStore(data,raws);
  await raws.initialize();
  const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
  const names=['合成今日到期','合成已逾期','合成久未推进','合成产品事项'];
  const sentinels=['反馈正文 PRIVATE_FEEDBACK','历史记录 PRIVATE_HISTORY','底源正文 PRIVATE_RAW','产品内部目标 PRIVATE_GOAL'];
  for(let i=0;i<3;i++) {
    const item=await store.create({title:names[i],feedback:sentinels[0]});
    const updated=await store.update(item.id,{baseRevision:item.revision,status:'in_progress',history:{kind:'technical_reply',body:sentinels[1]},...(i<2?{followUpOn:i===0?today:'2024-01-01'}:{})});
    if(i===2) await writeFile(path.join(data,'work-items',item.id+'.json'),JSON.stringify({...updated,createdAt:'2023-01-01T00:00:00.000Z',updatedAt:'2024-01-01T00:00:00.000Z'}));
  }
  const raw=await raws.create({title:'合成候选资料',body:sentinels[2],sourceType:'report',sourceName:'合成',tags:[]});
  const product=await store.create({kind:'product_analysis',title:names[3],goal:sentinels[3]});
  await store.update(product.id,{baseRevision:product.revision,rawIds:[raw.id]});
  const cached={status:'source_only',attempt:1,startedAt:now.toISOString(),finishedAt:now.toISOString(),items:[],sources:[]};
  await mkdir(path.join(data,'state/news'),{recursive:true});
  await writeFile(path.join(data,'state/news',today+'.json'),JSON.stringify({schemaVersion:1,date:today,updatedAt:now.toISOString(),sections:{ai:cached,fmcg:{...cached,contentVersion:'research-v1'}}}));
  return {run,data,envDir,config,names,sentinels,productId:product.id,rawId:raw.id};
}
