import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),prefix='KB02-HUMAN-20261023',file=path.join(root,'docs/reports',prefix+'-baseline.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name),r=path.relative(root,p).replaceAll('\\','/');if(e.isDirectory()){if(!['.git','node_modules','dist','.test'].includes(e.name)&&!e.name.startsWith('.scratch-')&&!e.name.startsWith('.test-'))out.push(...await walk(p));}else if(!r.includes(prefix)&&!r.includes('KB02-HUMAN-AUDIT-20261023')&&!['docs/status.md','docs/agent-control.md','docs/product-spec.md','docs/architecture.md','docs/acceptance.md','docs/batches/KB02.md','docs/handoffs/KB02-HUMAN-20261023-task.md','tsconfig.tsbuildinfo'].includes(r))out.push({path:r,sha256:sha(await fs.readFile(p))});}return out;}
if(process.argv[2]==='baseline'){const files=await walk(root);await fs.writeFile(file,JSON.stringify({files},null,2),{flag:'wx'});console.log(JSON.stringify({files:files.length}));}
else{const b=JSON.parse(await fs.readFile(file,'utf8')),changed=[];for(const f of b.files){try{if(sha(await fs.readFile(path.join(root,f.path)))!==f.sha256)changed.push(f.path);}catch{changed.push(f.path);}}console.log(JSON.stringify({checked:b.files.length,changed},null,2));}
