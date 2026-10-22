import fs from 'node:fs/promises';
const source=await fs.readFile('tests/acceptance/kb01-r4-20261014-fullsuite-copy.mjs','utf8');
if(!source.includes("'--test',...tests"))throw Error('Expected complete suite command missing');
const serial=source.replace("'--test',...tests","'--test','--test-concurrency=1',...tests").replaceAll('tests-writable-copy','tests-writable-copy-serial').replace("scope:'exact byte-identical", "testConcurrency:1,scope:'complete serial run of exact byte-identical");
await fs.writeFile('tests/acceptance/kb01-r4-20261014-fullsuite-serial.mjs',serial);
