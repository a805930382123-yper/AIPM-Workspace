// Regression for the independently demonstrated redirect and second-options bypasses.
// Both destination servers are localhost fixtures; no remote address is contacted.
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {guardNetwork,offlineArgs,sha,P} from './KB02-K204-PREP-20261023-support.mjs';
offlineArgs();
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),report={node:process.version,startedAt:new Date().toISOString(),realProviderCalls:0,onlyLocalServers:true,rows:[],sinkHits:0,allowedHits:0,customTransportInvocations:0,pass:false};
let guard,base,sink,globalConnect;
const destination=http.createServer((_req,res)=>{report.sinkHits++;res.end('UNREGISTERED_SINK');});
const allowed=http.createServer((req,res)=>{report.allowedHits++;if(req.url==='/redirect'){res.writeHead(302,{Location:sink+'/redirect-target'});res.end();}else res.end('ALLOWED');});
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(`http://127.0.0.1:${server.address().port}`);});});
async function blocked(name,operation){await assert.rejects(async()=>operation(),/OFFLINE_NETWORK_DENIED/);report.rows.push({name,pass:true,sinkHits:report.sinkHits});assert.equal(report.sinkHits,0);}
function readNode(method,url){return new Promise((resolve,reject)=>{const req=http[method](url,res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);if(method==='request')req.end();});}
try{
  sink=await listen(destination);base=await listen(allowed);guard=guardNetwork();guard.allow(base);
  assert.equal(await (await fetch(base+'/ordinary')).text(),'ALLOWED');assert.equal(await (await fetch(base+'/post',{method:'POST',headers:{'content-type':'text/plain'},body:'local only',signal:AbortSignal.timeout(5000)})).text(),'ALLOWED');report.rows.push({name:'Standard fetch GET/POST remain usable',pass:true});
  await blocked('fetch redirect cannot reach unregistered sink',()=>fetch(base+'/redirect'));
  await blocked('fetch explicit redirect follow rejected before request',()=>fetch(base+'/redirect',{redirect:'follow'}));
  await blocked('fetch Request input rejected',()=>fetch(new Request(base+'/ordinary')));
  await blocked('fetch unregistered URL rejected',()=>fetch(sink+'/direct'));
  await blocked('fetch dispatcher rejected',()=>fetch(base+'/dispatcher',{dispatcher:{dispatch(){report.customTransportInvocations++;}}}));
  await blocked('fetch init URL/host override rejected',()=>fetch(base+'/init',{url:sink+'/init',host:'127.0.0.1'}));
  let getterCalls=0;await blocked('fetch init accessor rejected without invoking getter',()=>fetch(base+'/getter',{get method(){getterCalls++;return 'GET';}}));assert.equal(getterCalls,0);
  const destinationPort=new URL(sink).port;
  for(const [name,options]of Object.entries({portPath:{port:destinationPort,path:'/override-target'},host:{hostname:'127.0.0.1',port:destinationPort},protocol:{protocol:'https:'},socketPath:{socketPath:'not-a-socket'},customConnection:{createConnection(){report.customTransportInvocations++;}},customAgent:{agent:{addRequest(){report.customTransportInvocations++;}}},customLookup:{lookup(){report.customTransportInvocations++;}}}))await blocked('http.request second options '+name,()=>http.request(base+'/original',options,()=>{}));
  await blocked('http.get second options rejected',()=>http.get(base+'/original',{port:destinationPort,path:'/get-override'},()=>{}));
  await blocked('http.request options-only rejected',()=>http.request({hostname:'127.0.0.1',port:destinationPort,path:'/options'},()=>{}));
  await blocked('http.request direct unregistered URL rejected',()=>http.request(sink+'/direct',()=>{}));
  // Allowed standard requests use a private Agent, not the mutable global transport.
  globalConnect=http.globalAgent.createConnection;http.globalAgent.createConnection=()=>{report.customTransportInvocations++;throw Error('globalAgent override invoked');};
  assert.deepEqual(await readNode('request',base+'/standard'),{status:200,body:'ALLOWED'});assert.deepEqual(await readNode('get',new URL(base+'/standard-get')),{status:200,body:'ALLOWED'});http.globalAgent.createConnection=globalConnect;globalConnect=undefined;report.rows.push({name:'Standard HTTP URL[, callback] uses private Agent',pass:true});
  await blocked('https client rejected',()=>http.request('https://127.0.0.1/denied',()=>{}));
  await new Promise(r=>setImmediate(r));assert.equal(report.sinkHits,0);assert.equal(report.customTransportInvocations,0);assert.equal(report.allowedHits,5);assert.equal(guard.state.redirectsBlocked,1);assert.equal(Object.hasOwn(guard.state,'externalSent'),false);
  report.guardWrapperCounters=guard.state;report.counterLimit='Wrapper counters are not total network telemetry. Two actual local servers independently measured allowed=5, unregistered sink=0; all denied paths failed before reaching the sink.';report.pass=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  if(globalConnect)http.globalAgent.createConnection=globalConnect;if(guard)guard.restore();
  for(const server of [allowed,destination])if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  report.closed=true;report.finishedAt=new Date().toISOString();report.supportSha256=sha(await fs.readFile('tests/acceptance/KB02-K204-PREP-20261023-support.mjs'));const file=P+'repair1-network-'+stamp+'.json';await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file,pass:report.pass,checks:report.rows.length,sinkHits:report.sinkHits,allowedHits:report.allowedHits,error:report.error}));if(!report.pass)process.exitCode=1;
}
