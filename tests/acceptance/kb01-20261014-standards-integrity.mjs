// Independent product fingerprint only. Never reads user config or formal workspace data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const mode=process.argv[2],run=process.argv[3]??'r1',prefix='docs/reports/KB01-20261014-standards';
async function under(dir){const out=[];for(const x of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,x.name);if(x.isDirectory())out.push(...await under(p));else if(x.isFile())out.push(p);}return out;}
async function snapshot(){const names=[...(await Promise.all(['app','server','services','rules','scripts'].map(under))).flat(),'package.json','package-lock.json','vite.config.ts'];return Object.fromEntries(await Promise.all(names.sort().map(async p=>[p.replaceAll('\\','/'),createHash('sha256').update(await fs.readFile(p)).digest('hex')])));}
const dest=`${prefix}-frozen-${run}.json`;
if(mode==='freeze'){await fs.writeFile(dest,JSON.stringify({at:new Date().toISOString(),product:await snapshot()},null,2),{flag:'wx'});console.log('Frozen '+dest);}else if(mode==='verify'){const before=JSON.parse(await fs.readFile(dest,'utf8')),after=await snapshot(),changed=Object.keys(before.product).filter(p=>before.product[p]!==after[p]),added=Object.keys(after).filter(p=>!(p in before.product)),result={at:new Date().toISOString(),frozen:dest,count:Object.keys(after).length,changed,added,pass:!changed.length&&!added.length};await fs.writeFile(`${prefix}-integrity-${run}.json`,JSON.stringify(result,null,2),{flag:'wx'});console.log(result);if(!result.pass)process.exitCode=1;}else throw Error('Expected freeze|verify and new run ID');
