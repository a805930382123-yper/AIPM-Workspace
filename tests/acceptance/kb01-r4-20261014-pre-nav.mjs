import fs from 'node:fs/promises';
const prefix='docs/reports/KB01-R4-20261014-';
for(const name of ['frozen.json','tests-writable-copy.json','tests-writable-copy.log','review-standards.md','review-standards.json','review-spec.md','review-spec.json'])await fs.copyFile(prefix+name,prefix+'pre-nav-'+name);
console.log('Prior reviewed freeze retained for backend/real evidence reuse.');
