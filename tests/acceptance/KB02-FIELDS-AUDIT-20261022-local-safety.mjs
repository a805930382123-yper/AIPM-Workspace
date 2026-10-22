import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {loadLlmConfig} from '../../services/llm/config.ts';
const prefix='KB02-FIELDS-AUDIT-20261022-',dir='docs/reports',config=await loadLlmConfig({filePath:path.resolve('.env.local')});
const files=(await fs.readdir(dir)).filter(f=>f.startsWith(prefix)),leaks=[];
for(const f of files){const text=await fs.readFile(path.join(dir,f),'utf8');if(config.apiKey&&text.includes(config.apiKey))leaks.push(f);}
const attempts=(await fs.readFile(path.join(dir,prefix+'provider-attempts.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const traces=(await fs.readFile(path.join(dir,prefix+'provider-trace.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
assert(attempts.length<=24);assert(attempts.every((x,i)=>x.sequence===164+i));assert.equal(attempts.length,traces.length);
const report={at:new Date().toISOString(),checkedFiles:files.length,secretLeakFiles:leaks,budget:{prior:163,current:attempts.length,cumulative:163+attempts.length,totalCap:200,phaseCap:24,phaseRemaining:24-attempts.length,prompt:{used:15,cap:24}},serviceStarted:files.includes(prefix+'main-lab.json')};
await fs.writeFile(path.join(dir,prefix+'local-safety.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.equal(leaks.length,0);
