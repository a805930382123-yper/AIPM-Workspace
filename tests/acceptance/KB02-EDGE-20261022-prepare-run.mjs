import fs from 'node:fs/promises';
const name='KB02-EDGE-20261022';
let freeze=await fs.readFile('tests/acceptance/KB02-SOURCE-20261022-freeze.mjs','utf8');
freeze=freeze.replaceAll('KB02-SOURCE-20261022',name).replaceAll('KB02-SOURCE-AUDIT-20261022','KB02-EDGE-AUDIT-20261022').replace('docs/reports/KB02-PLAN-20261022-sol-frozen.json','docs/reports/KB02-SOURCE-20261022-frozen.json').replace('`${name}-seq121-fixture.json`','`${name}-short-fixture.json`');
// The literal includes the directory prefix in the template string.
freeze=freeze.replace('${name}-seq121-fixture.json','${name}-short-fixture.json');
await fs.writeFile(`tests/acceptance/${name}-freeze.mjs`,freeze,{flag:'wx'});
let run=await fs.readFile('tests/acceptance/KB02-SOURCE-20261022-run.mjs','utf8');
run=run.replaceAll('KB02-SOURCE-20261022',name).replaceAll('kb02-source-sol-','kb02-edge-sol-').replace("targeted=['tests/kb02-source-assignment.test.ts'","targeted=['tests/kb02-edge-extraction.test.ts','tests/wiki-selection.test.tsx','tests/kb02-source-assignment.test.ts'");
await fs.writeFile(`tests/acceptance/${name}-run.mjs`,run,{flag:'wx'});
