import fs from 'node:fs/promises';
const file='tests/acceptance/m04-repair1-edges.mjs';
const text=await fs.readFile(file,'utf8'),needle="disk.raw_links[0].request_fingerprint=createHash('sha256')";
if(!text.includes(needle))throw Error('Fixture location missing');
await fs.writeFile(file,text.replace(needle,"delete disk.raw_links[0].request_fingerprint_version;"+needle));
console.log('Old-format receipt fixture now removes the new v2 discriminator as well as restoring the old hash; expectation is unchanged.');
