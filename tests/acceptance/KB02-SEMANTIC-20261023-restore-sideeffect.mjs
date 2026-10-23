import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex'),file='docs/reports/B04-http-evidence.json';
const baseline=JSON.parse(await fs.readFile('docs/reports/KB02-SEMANTIC-20261023-baseline.json','utf8')).files.find(f=>f.path===file);
const original=execFileSync('git',['show','HEAD:'+file],{encoding:'buffer'}),before=await fs.readFile(file);
if(sha(original)!==baseline.sha256)throw Error('HEAD differs from baseline; no write authorized');
await fs.writeFile('docs/reports/KB02-SEMANTIC-20261023-sideeffect-generated.json',before,{flag:'wx'});
await fs.writeFile(file,original);
await fs.writeFile('docs/reports/KB02-SEMANTIC-20261023-sideeffect-restoration.json',JSON.stringify({file,baseline:baseline.sha256,head:sha(original),generated:sha(before),restored:sha(await fs.readFile(file)),reason:'First full default test ran in source workspace before its report-writing side effect was identified. Exact pre-run bytes verified against HEAD before single-file restoration.'},null,2),{flag:'wx'});
console.log(file+' restored to verified baseline');
