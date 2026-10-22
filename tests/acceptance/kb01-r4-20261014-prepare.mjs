// Preserve all historical evidence; new R4 fixtures write only their own evidence.
import fs from 'node:fs/promises';
const names=['fullsuite-copy','standards-http','standards-component','standards-security','standards-adapter-budget'];
for(const name of names){
 let source=await fs.readFile(`tests/acceptance/kb01-20261014-${name}.mjs`,'utf8');
 source=source.replaceAll('docs/reports/KB01-20261014-','docs/reports/KB01-R4-20261014-');
 if(name==='fullsuite-copy')source=source.replaceAll('fmcg-kb01-fullsuite-','fmcg-kb01-r4-fullsuite-');
 if(name==='standards-http'){
  source=source.replace('async function updateFixture(){','let updateCase=0;\nasync function updateFixture(){');
  source=source.replace("old=await wiki('铺货率',[a.id]","old=await wiki('R4更新目标'+(++updateCase),[a.id]");
 }
 await fs.writeFile(`tests/acceptance/kb01-r4-20261014-${name}.mjs`,source);
}
console.log('R4 isolated fixtures prepared; original evidence untouched.');
