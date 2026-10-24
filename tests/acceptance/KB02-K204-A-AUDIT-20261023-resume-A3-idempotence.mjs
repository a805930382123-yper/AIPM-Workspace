import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
const root='.scratch-KB02-K204-A-20261023-9hponb',sha=b=>createHash('sha256').update(b).digest('hex');
async function snapshot(dir){const result={};async function walk(p){for(const ent of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,ent.name);if(ent.isDirectory())await walk(f);else if(ent.isFile())result[path.relative(dir,f)]=sha(await fs.readFile(f));}}await walk(dir);return result;}
const before=await snapshot(root),raws=new RawStore(root),wiki=new WikiStore(root,raws),workflows=new KnowledgeWorkflowStore(root,wiki,raws);
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('NO_NETWORK_IN_IDEMPOTENCE');};
const result=await wiki.withLock(()=>workflows.confirm('37207020-a863-44bf-a07f-150cd55fab76',2,'b092f634-f69f-4650-ace9-d6eb1ddb2605'));
assert.equal(result.reused,true);assert.equal(result.wikiId,'c6590bed-1325-4456-899b-84804136ce1d');const after=await snapshot(root);assert.deepEqual(after,before);assert.equal(networkCalls,0);
const report={stage:'A3-idempotence',pass:true,at:new Date().toISOString(),method:'Production public KnowledgeWorkflowStore.confirm under WikiStore.withLock; original workflow/revision/idempotencyKey',reused:true,wikiId:result.wikiId,allSessionFilesByteIdentical:true,filesCompared:Object.keys(before).length,networkCalls,providerConstructed:false,realCallsAdded:0};await fs.writeFile('docs/reports/KB02-K204-A-AUDIT-20261023-resume-A3-idempotence.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
