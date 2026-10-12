import fs from 'node:fs/promises';
const previous='docs/reports/M04-repair1-20261012';
let integrity=await fs.readFile('tests/acceptance/m04-repair1-integrity.mjs','utf8');
integrity=integrity.replaceAll(previous,'docs/reports/M05-20261012').replace("!path.basename(p).startsWith('M04-review-')","!path.basename(p).startsWith('M05-')").replaceAll("'m04-repair1-'","'m05-'").replaceAll('M04-review-20261012-baseline.json','M04-repair1-20261012-frozen.json');
await fs.writeFile('tests/acceptance/m05-integrity.mjs',integrity);
for(const name of ['quality','http','deep','edges','api-regression','backup','b05-regression','b06-regression','component','harness','phase-hook','lab','browser-setup']){
 const content=await fs.readFile('tests/acceptance/m04-repair1-'+name+'.mjs','utf8');
 await fs.writeFile('tests/acceptance/m05-'+name+'.mjs',content.replaceAll('M04-repair1-20261012','M05-20261012').replaceAll('m04-repair1-','m05-'));
}
console.log('M05 independent scripts cloned; historical originals untouched.');
