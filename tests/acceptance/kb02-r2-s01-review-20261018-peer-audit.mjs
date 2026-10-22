import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const scope=JSON.parse(await fs.readFile('docs/reports/KB02-R2-S01-20261018-builder-scope.json'));
const files=[];
for(const row of [...scope.changedProduct,...scope.changedTests]){
 const actual=sha(await fs.readFile(row.file));files.push({file:row.file,actual,expected:row.sha256,match:actual===row.sha256});
}
const copies=[];
for(const kind of ['standards-probes','http','security']){
 const original=await fs.readFile(`tests/acceptance/kb02-r2-s01-20261018-builder-${kind}.mjs`,'utf8');
 const copied=await fs.readFile(`tests/acceptance/kb02-r2-s01-review-20261018-peer-${kind}.mjs`,'utf8');
 copies.push({kind,onlyOutputPrefixChanged:copied.replaceAll('KB02-R2-S01-REVIEW-20261018-peer-','KB02-R2-S01-20261018-builder-')===original,sourceSha256:sha(original),copySha256:sha(copied)});
}
const result={at:new Date().toISOString(),files,copies,pass:files.every(x=>x.match)&&copies.every(x=>x.onlyOutputPrefixChanged)};
await fs.writeFile('docs/reports/KB02-R2-S01-REVIEW-20261018-peer-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
