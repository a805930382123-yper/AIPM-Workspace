import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const prefix='docs/reports/KB02-R2-20261016-builder-';
const base=JSON.parse(await fs.readFile(prefix+'baseline.json','utf8'));
const frozen=JSON.parse(await fs.readFile(prefix+'main-frozen.json','utf8'));
async function changes(before,after){const result=[];for(const file of new Set([...Object.keys(before),...Object.keys(after)])){if(before[file]!==after[file])result.push({file,kind:!before[file]?'added':!after[file]?'deleted':'modified',beforeSha256:before[file]??null,sha256:after[file]??null});}return result;}
const out={at:new Date().toISOString(),baselineAt:base.at,frozenAt:frozen.at,changedProduct:await changes(base.product,frozen.product),changedTests:await changes(base.tests,frozen.tests),productCount:Object.keys(frozen.product).length,testCount:Object.keys(frozen.tests).length};
await fs.writeFile(prefix+'scope.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out));
