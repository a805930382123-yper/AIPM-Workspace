import fs from 'node:fs/promises';
const content=await fs.readFile('tests/acceptance/m03-legacy-http.mjs','utf8');
await fs.writeFile('tests/acceptance/m05-legacy-http.mjs',content.replaceAll('M03-legacy-http','M05-20261012-legacy-http'));
console.log('Old-chain independent script cloned to M05; original unchanged.');
