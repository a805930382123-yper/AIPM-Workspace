import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const p='docs/reports/KB02-SEMANTIC-AUDIT-20261023-',base=JSON.parse(await fs.readFile(p+'baseline.json','utf8')),sha=b=>createHash('sha256').update(b).digest('hex'),changed=[];
for(const[f,h]of Object.entries(base.protected)){try{if(sha(await fs.readFile(f))!==h)changed.push(f);}catch{changed.push(f);}}
if(sha(await fs.readFile(p+'fixtures.json'))!==base.fixtureSha256)changed.push(p+'fixtures.json');
const result={at:new Date().toISOString(),protectedPaths:Object.keys(base.protected).length,changed,pass:!changed.length};
await fs.writeFile(p+new Date().toISOString().replaceAll(':','-')+'-integrity.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(changed.length)process.exitCode=1;
