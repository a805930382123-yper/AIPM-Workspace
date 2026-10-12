import fs from 'node:fs/promises';
import path from 'node:path';
const report='docs/reports/FULL2-20261010-acceptance.md';
const content=await fs.readFile(report,'utf8');const links=[...content.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]);const missing=[];
for(const link of links){if(!await fs.access(path.resolve(path.dirname(report),link)).then(()=>true,()=>false))missing.push(link);}
console.log({report,links:links.length,missing});if(missing.length)process.exitCode=1;

