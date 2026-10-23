import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),stem='docs/reports/KB02-PROTOCOL-AUDIT-20261023-';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const files={};
function walk(rel){
 if(['docs/status.md','docs/agent-control.md'].includes(rel)||rel.startsWith('docs/reports/KB02-PROTOCOL-')||rel.startsWith('tests/acceptance/KB02-PROTOCOL-'))return;
 const full=path.join(root,rel);if(!fs.existsSync(full))return;
 const st=fs.lstatSync(full);
 if(st.isSymbolicLink())files[rel]='SYMLINK:'+fs.readlinkSync(full);
 else if(st.isDirectory())for(const n of fs.readdirSync(full))walk(rel+'/'+n);
 else if(st.isFile())files[rel]=hash(fs.readFileSync(full));
}
for(const dir of ['app','docs','rules','scripts','server','services','tests','.githooks','workspace'])walk(dir);
for(const n of fs.readdirSync(root))if(fs.lstatSync(path.join(root,n)).isFile())walk(n);
if(process.argv[2]==='baseline'){
 assert(!fs.existsSync(stem+'protection-baseline.json'));
 fs.writeFileSync(stem+'protection-baseline.json',JSON.stringify({files,exclusions:'parent status/control and current PROTOCOL/AUDIT assets; these are not claimed protected'},null,2)+'\n');
 console.log(JSON.stringify({protected:Object.keys(files).length}));
}else if(process.argv[2]==='closure'){
 const before=JSON.parse(fs.readFileSync(stem+'protection-baseline.json','utf8')).files;
 const changed=[...new Set([...Object.keys(before),...Object.keys(files)])].filter(p=>before[p]!==files[p]);
 fs.writeFileSync(stem+'protection-closure.json',JSON.stringify({pass:changed.length===0,protected:Object.keys(before).length,changed},null,2)+'\n');
 console.log(JSON.stringify({pass:changed.length===0,changed}));
}else throw Error('baseline or closure required');
