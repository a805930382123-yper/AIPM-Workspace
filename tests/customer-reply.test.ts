import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {WorkItemStore} from '../services/work-items/store.ts';
import {exportWorkspace,restoreWorkspace} from '../scripts/backup_workspace.ts';
test('customer reply persists through backup; resolved requires reason and can reopen',async()=>{
const base=path.resolve('node_modules/.cache/customer-reply');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));const raws={get:async()=>undefined};const store=new WorkItemStore(root,raws);let item=await store.create({title:'合成客户问题',feedback:'需回复'});
item=await store.update(item.id,{baseRevision:item.revision,history:{kind:'customer_reply',body:'已告知解决方法，等待确认。'}});assert.equal(item.status,'triage');assert.equal((await store.get(item.id)).history[0].kind,'customer_reply');
await assert.rejects(store.update(item.id,{baseRevision:item.revision,status:'closed'}),/解决说明/);
item=await store.update(item.id,{baseRevision:item.revision,status:'closed',closureReason:'客户确认已恢复。'});assert.equal((await store.list(true)).length,0);assert.equal(item.history.at(-1)?.kind,'closed');
const archive=path.join(base,'reply-'+Date.now()+'.zip');await exportWorkspace(root,archive);const restored=await mkdtemp(path.join(base,'restored-'));await restoreWorkspace(archive,restored);assert.deepEqual(await new WorkItemStore(restored,raws).get(item.id),item);
item=await store.update(item.id,{baseRevision:item.revision,reopen:true});assert.equal(item.status,'triage');const product=await store.create({kind:'product_analysis',title:'产品',goal:'目标'});await assert.rejects(store.update(product.id,{baseRevision:product.revision,history:{kind:'customer_reply',body:'不应接受'}}),/阶段成果/);
});
