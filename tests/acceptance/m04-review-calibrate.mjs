import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const script='tests/acceptance/m04-review-http.mjs';
await fs.copyFile('docs/reports/M04-review-20261012-http.json','docs/reports/M04-review-20261012-http-initial.json');
let source=await fs.readFile(script,'utf8');
for(const [from,to] of [
 ["['/api/extraction-jobs',{rawId:primary.raw_id}]","['/api/raw/'+primary.raw_id+'/extract',{}]"],
 ["observed('/api/extraction-jobs','POST',{rawId:raw.id})","observed('/api/raw/'+raw.id+'/extract','POST',{})"],
 ["const r=await observed('/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[cleanPage.id]});a.status","const r=await observed('/api/prompt-ai/generate','POST',{brief:{...brief,goal:'M04_RESTORED_PRIVATE_CONTEXT'},relatedWikiIds:[cleanPage.id]});a.status"],
 [",raw=await import('../../services/raw/store.ts').then(()=>undefined).catch(()=>undefined)",""]
]){assert(source.includes(from));source=source.replace(from,to);}
await fs.writeFile(script,source);
console.log('Old extraction endpoint corrected; source context probe made explicit. Initial evidence retained.');
