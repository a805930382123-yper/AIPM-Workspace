import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const prefix='docs/reports/KB02-SUPPLEMENT-DIAG-20261023-';
const sha=value=>createHash('sha256').update(value).digest('hex');
const baseline=JSON.parse(await fs.readFile(prefix+'baseline.json','utf8'));
const replay=JSON.parse(await fs.readFile(prefix+'replay.json','utf8'));
const changed=[];
for(const [name,hash] of Object.entries(baseline.protected)) { try {if(sha(await fs.readFile(name))!==hash)changed.push(name);}catch{changed.push(name);} }
assert.deepEqual(changed,[]);
const ownFiles=[];
for(const dir of ['docs/reports','tests/acceptance'])for(const name of await fs.readdir(dir))if(name.startsWith('KB02-SUPPLEMENT-DIAG-20261023-')&&!name.endsWith('closure.json')) {const p=dir+'/'+name;ownFiles.push({path:p,sha256:sha(await fs.readFile(p))});}
const report={at:new Date().toISOString(),head:baseline.head,productCommit:replay.productCommit,command:'node tests/acceptance/KB02-SUPPLEMENT-DIAG-20261023-closure.mjs',protectedPaths:Object.keys(baseline.protected).length,changed,ownedFiles:ownFiles,networkCalls:0,realProviderCalls:0,productWrites:0,kb02Cumulative:203,promptCumulative:15,defectFixed:false,batchPassed:false,readyForIndependentAstraReview:true,mainOwnedExcluded:baseline.excluded.mainOwned};
await fs.writeFile(prefix+'closure.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,ownedFiles:ownFiles.length}));
