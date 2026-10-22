import fs from 'node:fs/promises';
const before=await fs.readFile('docs/reports/KB02-PLAN-20261022-sol-before-tsconfig.json','utf8'),current=JSON.parse(await fs.readFile('tsconfig.json','utf8'));
const narrow=before.replace('"exclude": ["tests/acceptance/kb02-storage-poc-20261020-case.mts"]','"exclude": ["tests/acceptance/kb02-storage-poc-20261020-case.mts", "tests/acceptance/KB02-FINAL-REPAIR-AUDIT-20261022-boundary.test.ts"]');
if(JSON.stringify(JSON.parse(narrow))!==JSON.stringify(current))throw Error('Config semantic difference');await fs.writeFile('tsconfig.json',narrow);console.log('Preserved original tsconfig formatting; only exact exclude element added.');
