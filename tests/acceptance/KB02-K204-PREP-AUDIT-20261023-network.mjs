import fs from 'node:fs/promises';
import http from 'node:http';
import {guardNetwork} from './KB02-K204-PREP-20261023-support.mjs';
let redirectHits=0,overrideHits=0;
const destination=http.createServer((req,res)=>{if(req.url==='/redirect-target')redirectHits++;else overrideHits++;res.end('unregistered loopback reached');});
await new Promise(r=>destination.listen(0,'127.0.0.1',r));
const destinationPort=destination.address().port;
const allowed=http.createServer((req,res)=>{if(req.url==='/normal'){res.end('allowed normal response');return;}res.writeHead(302,{Location:`http://127.0.0.1:${destinationPort}/redirect-target`});res.end();});
await new Promise(r=>allowed.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${allowed.address().port}`,guard=guardNetwork();guard.allow(base);
const report={realProviderCalls:0,externalHostsContacted:0,onlyLocalServers:true};
try {
 report.normalResponse=await (await fetch(base+'/normal')).text();
 report.normalHttpResponse=await new Promise((resolve,reject)=>{const request=http.get(base+'/normal',res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve(text));});request.on('error',reject);});
 try {const response=await fetch(base+'/redirect');report.redirectResponse={status:response.status,text:await response.text()};}catch(e){report.redirectError=e.message;}
 try {report.overrideResponse=await new Promise((resolve,reject)=>{const request=http.request(base+'/original',{port:destinationPort,path:'/override-target'},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});request.on('error',reject);request.end();});}catch(e){report.overrideError=e.message;}
 report.redirectHits=redirectHits;report.overrideHits=overrideHits;report.guardCounter=guard.state;
 report.pass=report.normalResponse==='allowed normal response'&&report.normalHttpResponse==='allowed normal response'&&redirectHits===0&&overrideHits===0&&report.redirectError?.includes('OFFLINE_NETWORK_DENIED')&&report.overrideError?.includes('OFFLINE_NETWORK_DENIED');
}finally{guard.restore();await Promise.all([new Promise(r=>allowed.close(r)),new Promise(r=>destination.close(r))]);}
await fs.writeFile('docs/reports/KB02-K204-PREP-AUDIT-20261023-network'+(process.argv[2]?'-'+process.argv[2]:'')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
