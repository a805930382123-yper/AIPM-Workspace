import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const prefix='docs/reports/KB01-R4-20261014-',meta=JSON.parse(await fs.readFile(prefix+'lab.json','utf8')),root=path.resolve(meta.root),control=path.resolve(meta.controlFile);
if(!root.startsWith(path.join(os.tmpdir(),'fmcg-kb01-r4-real-'))||control!==path.join(root,'control.json'))throw Error('Owned final lab boundary mismatch');
await fs.writeFile(control,JSON.stringify({shutdown:true}));console.log('Owned final lab shutdown requested; synthetic fixture root retained.');
