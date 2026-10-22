import fs from 'node:fs/promises';import path from 'node:path';
const prefix='docs/reports/KB01-R4-20261014-';
for(const file of ['frozen.json','tests-writable-copy.json','tests-writable-copy.log','standards-http.json','locator-http.json','standards-component.json','standards-security-final.json','real-http.json','lab.json','review-standards.md','review-standards.json','review-spec.md','review-spec.json']){
 try{await fs.copyFile(prefix+file,prefix+'pre-json-'+file);}catch(e){if(e.code!=='ENOENT')throw e;}
}
if(process.argv[2]==='stop'){
 const meta=JSON.parse(await fs.readFile(prefix+'lab.json','utf8')),resolved=path.resolve(meta.controlFile),root=path.resolve(meta.root);
 if(!root.startsWith(path.resolve(process.env.TEMP,'fmcg-kb01-r4-real-'))||resolved!==path.join(root,'control.json'))throw Error('Owned lab target mismatch');
 await fs.writeFile(resolved,JSON.stringify({shutdown:true}));console.log('Owned first lab shutdown requested; failures retained.');
}
