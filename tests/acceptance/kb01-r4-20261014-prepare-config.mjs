import fs from 'node:fs/promises';
let harness=await fs.readFile('tests/acceptance/cfg01-20261014-harness.mjs','utf8');harness=harness.replace("from './b05-fake-reply.mjs'","from './kb01-r4-20261014-legacy-fixture.mjs'");await fs.writeFile('tests/acceptance/kb01-r4-20261014-config-harness.mjs',harness);
let test=await fs.readFile('tests/acceptance/kb01-20261014-standards-config.mjs','utf8');test=test.replaceAll('docs/reports/KB01-20261014-','docs/reports/KB01-R4-20261014-').replace("from './cfg01-20261014-harness.mjs'","from './kb01-r4-20261014-config-harness.mjs'");await fs.writeFile('tests/acceptance/kb01-r4-20261014-standards-config.mjs',test);
// Preserve final suite's one unclassified nonreproducing failure before repeating unchanged sources.
for(const name of ['tests-writable-copy.json','tests-writable-copy.log'])await fs.copyFile('docs/reports/KB01-R4-20261014-'+name,'docs/reports/KB01-R4-20261014-final-suite-first-'+name);
