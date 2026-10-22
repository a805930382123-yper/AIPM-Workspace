import http from 'node:http';
import fs from 'node:fs/promises';
const seen=[];
const server=http.createServer((req,res)=>{seen.push(req.headers.host);res.end('{}');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
try {
 await fetch(url,{headers:{Host:'attacker.example'}});
 await new Promise((resolve,reject)=>{http.get(url,{headers:{Host:'attacker.example'}},res=>{res.resume();res.on('end',resolve);}).on('error',reject);});
 const out={node:process.version,scope:'isolated HTTP header transport calibration',fetchSentTargetHost:seen[0]==='attacker.example',nativeHttpSentTargetHost:seen[1]==='attacker.example',classification:seen[0]!=='attacker.example'?'INVALID_FETCH_HOST_FIXTURE':'VALID_FETCH_HOST_FIXTURE'};
 await fs.writeFile('docs/reports/CFG01-20261014-host-calibration.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
