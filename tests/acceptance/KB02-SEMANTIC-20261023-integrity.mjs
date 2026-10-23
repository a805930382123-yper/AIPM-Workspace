import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(), prefix='KB02-SEMANTIC-20261023';
const out=path.join(root,'docs/reports',prefix+'-baseline.json');
const files=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name),r=path.relative(root,p).replaceAll('\\','/');if(e.isDirectory()){if(!['.git','node_modules','dist','.test'].includes(e.name)&&!e.name.startsWith('.test-'))await walk(p);}else if(!r.includes(prefix)&&!['docs/status.md','docs/agent-control.md','tsconfig.tsbuildinfo'].includes(r))files.push({path:r,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')});}}
if(process.argv.includes('--baseline')){await walk(root);await fs.writeFile(out,JSON.stringify({node:process.version,files},null,2),{flag:'wx'});console.log('baseline',files.length);}else{const b=JSON.parse(await fs.readFile(out,'utf8'));const changed=[];for(const f of b.files){try{if(createHash('sha256').update(await fs.readFile(path.join(root,f.path))).digest('hex')!==f.sha256)changed.push(f.path);}catch{changed.push(f.path);}}console.log(JSON.stringify({checked:b.files.length,changed},null,2));}
