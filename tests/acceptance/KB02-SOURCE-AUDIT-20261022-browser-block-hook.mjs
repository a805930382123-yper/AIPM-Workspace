import fs from 'node:fs/promises';
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url??String(input));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){await fs.appendFile(process.env.KB02_BROWSER_BLOCK_LOG,JSON.stringify({at:new Date().toISOString(),host:url.host,blocked:true})+'\n');throw Error('Browser-only audit forbids external requests');}return original(input,init);};
