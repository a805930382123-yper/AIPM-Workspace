import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {WorkItemStore} from '../services/work-items/store.ts';
import {WorkAnalysisRuns} from '../services/work-items/analysis-runs.ts';
import {registerWorkItemRoutes} from '../server/work-items-api.ts';
test('delete customer/product/legacy: revision and active guard, retain independent data, no resurrection',async()=>{
 const base=path.resolve('node_modules/.cache/work-delete');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));
 const raws={get:async()=>undefined};const store=new WorkItemStore(root,raws);const analysis=new WorkAnalysisRuns(root,id=>store.get(id),raws,async()=>undefined);
 const app=express();app.use(express.json());registerWorkItemRoutes(app,store,analysis);app.use((e:any,_q:any,r:any,_n:any)=>r.status(e.status||500).json({message:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 try {for(const kind of ['customer_issue','product_analysis','legacy']) {
 let item=await store.create(kind==='product_analysis'?{kind,title:'合成',goal:'测试'}:{title:'合成',feedback:'测试'});
 if(kind==='legacy'){const {kind:_,...old}=item;await writeFile(path.join(root,'work-items',item.id+'.json'),JSON.stringify(old));}
 const kept=path.join(root,'work-items','screenshots',item.id);await mkdir(kept,{recursive:true});await writeFile(path.join(kept,'keep.txt'),'retained');
 await assert.rejects(store.delete(item.id,item.revision,()=>true),/正在运行/);
 const del=async(rev:number)=>fetch('http://127.0.0.1:'+port+'/api/work-items/'+item.id,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:rev})});
 assert.equal((await del(999)).status,409);assert.equal((await del(item.revision)).status,200);
 await assert.rejects(store.get(item.id),/没有找到/);await assert.rejects(store.update(item.id,{baseRevision:item.revision,title:'复活'}),/没有找到/);
 assert.equal((await store.list()).length,0);assert.equal((await store.list(true)).length,0);assert.equal(await readFile(path.join(kept,'keep.txt'),'utf8'),'retained');
 }}finally{await new Promise<void>(r=>server.close(()=>r()));}
});
