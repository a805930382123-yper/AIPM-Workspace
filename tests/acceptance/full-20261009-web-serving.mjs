import fs from 'node:fs/promises';
const runtime=JSON.parse(await fs.readFile('docs/reports/FULL-20261009-browser-runtime.json','utf8'));
const checks=[];
for(const pathname of ['/','/api/health','/api/stats','/api/llm/config']){const response=await fetch(new URL(pathname,runtime.url));checks.push({path:pathname,status:response.status,contentType:response.headers.get('content-type'),body:await response.text()});}
await fs.writeFile('docs/reports/FULL-20261009-web-serving.json',JSON.stringify({scope:'HTTP serving only; browser engine unavailable; local fake config is not real provider',checks},null,2));
console.log(checks.map(c=>({path:c.path,status:c.status,contentType:c.contentType})));
await fs.writeFile(runtime.stopFile,'stop');
