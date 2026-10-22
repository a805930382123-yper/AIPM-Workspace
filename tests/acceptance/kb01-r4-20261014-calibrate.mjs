import fs from 'node:fs/promises';
const prefix='docs/reports/KB01-R4-20261014-';
for(const file of ['frozen.json','tests-writable-copy.json','tests-writable-copy.log','standards-http.json','locator-http.json'])await fs.copyFile(prefix+file,prefix+'initial-'+file);
let source=await fs.readFile('tests/acceptance/kb01-r4-20261014-locator-http.mjs','utf8');
source=source.replace('async function run(name,mutation,code){','async function run(name,mutation,code,includeKey=false){');
source=source.replace("+ '\\r\\n').repeat(3)","+ '\\r\\n').repeat(3)");
// Place a synthetic credential beside supported source text, so selected catalog text includes it.
source=source.replace("const body=('重复说明：虚构门店数铺货率20%。\\r\\n'", "const body=('重复说明：虚构门店数铺货率20%。'+(includeKey?key:'')+'\\r\\n'");
source=source.replace(" await test('V08-unknown-top-field'", " await test('V09-derived-Raw-secret-rejected',()=>run('R4原文派生凭证',undefined,'LLM_OUTPUT_CONTAINS_SECRET',true));\n await test('V08-unknown-top-field'");
await fs.writeFile('tests/acceptance/kb01-r4-20261014-locator-http.mjs',source);
for(const name of ['standards-http','standards-component','standards-security']){
 const file=`tests/acceptance/kb01-r4-20261014-${name}.mjs`;
 const text=await fs.readFile(file,'utf8');await fs.writeFile(file,text.replace("from './b05-fake-reply.mjs'","from './kb01-r4-20261014-legacy-fixture.mjs'"));
}
console.log('Initial R4 failures preserved; independent fixtures calibrated without removing assertions.');
