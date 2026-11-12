import {appendFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createHash, X509Certificate} from 'node:crypto';
import {spawn} from 'node:child_process';
import {connect} from 'node:tls';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

const base=path.resolve('node_modules/.cache/news09-fix-diagnosis');
await mkdir(base,{recursive:true});
const [mode,target]=process.argv.slice(2);
if(!['pwc','pwc-replay','ccfa-tls','ccfa-strict'].includes(mode))throw Error('Expected pwc, pwc-replay, ccfa-tls, or ccfa-strict');
const run=await mkdtemp(path.join(base,mode+'-'));
const log=path.join(run,'events.jsonl');
const event=(kind,data={})=>{
  const row={kind,utc:new Date().toISOString(),...data};
  appendFileSync(log,JSON.stringify(row)+'\n');
  console.log(JSON.stringify(row));
};
const elapsed=start=>Math.round(performance.now()-start);
const errorInfo=error=>({name:error?.name,code:error?.code,causeCode:error?.cause?.code,message:error?.message});
const proxyFlags=Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR']
  .map(key=>[key,Boolean(process.env[key])]));
event('start',{mode,run,node:process.version,proxyFlags,useEnvProxy:process.env.NODE_USE_ENV_PROXY==='1'||process.execArgv.includes('--use-env-proxy')});
const start=performance.now();
try {
  if(mode==='pwc'){
    const productTimeout=target==='--product-timeout';
    const url=new URL(!target||productTimeout?'https://www.pwccn.com/zh/retail-and-consumer/voice-of-consumers-china-report-dec2025.pdf':target);
    if(url.origin!=='https://www.pwccn.com'||url.username||url.password||!/^\/zh\/retail-and-consumer\/[\w-]+\.pdf$/i.test(url.pathname))throw Error('Expected original public PwC PDF URL');
    const timeoutMs=productTimeout?12000:60000;
    const timeout=AbortSignal.timeout(timeoutMs),limit=10*1024*1024;
    let bytes=0,firstByteMs=null,phase='response_headers',lastProgress=0;
    try{
      event('request',{url:url.href,timeoutMs,limit});
      const response=await fetch(url,{redirect:'manual',signal:timeout,headers:{Accept:'application/pdf'}});
      const selected=['content-type','content-length','content-encoding','transfer-encoding','date','location','accept-ranges','cache-control'];
      const headers=Object.fromEntries(selected.flatMap(key=>response.headers.has(key)?[[key,response.headers.get(key)]]:[]));
      if(headers.location){const redirect=new URL(headers.location,url);headers.location=redirect.origin+redirect.pathname;}
      event('headers',{status:response.status,durationMs:elapsed(start),headers});
      if(response.status!==200||!/^application\/pdf/i.test(headers['content-type']??'')){
        await response.body?.cancel();
        throw Error('Expected HTTP 200 application/pdf');
      }
      if(Number(headers['content-length'])>limit){await response.body?.cancel();throw Error('PDF exceeds size cap');}
      if(!response.body)throw Error('Response body is missing');
      phase='response_body';
      const reader=response.body.getReader(), chunks=[],hash=createHash('sha256');
      for(;;){
        const next=await reader.read();
        if(next.done)break;
        if(!next.value.length)continue;
        if(firstByteMs===null){firstByteMs=elapsed(start);event('first_body_byte',{durationMs:firstByteMs,chunkBytes:next.value.length});}
        bytes+=next.value.length;
        if(bytes>limit){await reader.cancel();throw Error('PDF exceeds size cap');}
        chunks.push(next.value);
        hash.update(next.value);
        if(bytes-lastProgress>=256*1024){lastProgress=bytes;event('progress',{bytes,durationMs:elapsed(start)});}
      }
      phase='complete_pdf_validation';
      const pdf=Buffer.concat(chunks,bytes);
      if(pdf.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('PDF signature missing');
      if(!pdf.subarray(-1024).includes(Buffer.from('%%EOF')))throw Error('PDF end marker missing');
      const file=path.join(run,'report.pdf');
      await writeFile(file,pdf);
      event('complete',{bytes,firstByteMs,durationMs:elapsed(start),sha256:hash.digest('hex'),file});
    }catch(error){
      event('request_failed',{phase,bytes,firstByteMs,durationMs:elapsed(start),error:errorInfo(error)});
      process.exitCode=1;
    }
  }else if(mode==='pwc-replay'){
    const pdfPath=path.resolve(target??'');
    if(!pdfPath.startsWith(base+path.sep)||path.basename(pdfPath)!=='report.pdf')throw Error('Expected a diagnosis PDF in the isolated cache');
    const snapshots=path.resolve('node_modules/.cache/news09-live-2');
    const listUrl='https://www.pwccn.com/zh/industries/retail-and-consumer.html';
    const detailUrl='https://www.pwccn.com/zh/industries/retail-and-consumer/publications/voice-of-consumers-china-report-dec2025.html';
    const pdfUrl='https://www.pwccn.com/zh/retail-and-consumer/voice-of-consumers-china-report-dec2025.pdf';
    const [list,detail,pdf]=await Promise.all([readFile(path.join(snapshots,'2.bin')),readFile(path.join(snapshots,'8.bin')),readFile(pdfPath)]);
    const captures=new Map([[listUrl,[list,'text/html']],[detailUrl,[detail,'text/html']],[pdfUrl,[pdf,'application/pdf']]]);
    const original=globalThis.fetch,requests=[];
    const {readAdditionalResearch}=await import('../../services/news/additional-research.ts');
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    let result;
    try{
      globalThis.fetch=async input=>{
        const url=String(input);
        requests.push(url);
        const source=captures.get(url);
        if(source)return new Response(source[0],{headers:{'content-type':source[1]}});
        if(url==='https://www.stats.gov.cn/sj/zxfbhjd/')return new Response(null,{status:503});
        throw Error('Unrecorded URL in offline replay');
      };
      result=await readAdditionalResearch(new Date(),undefined,true);
    }finally{globalThis.fetch=original;}
    const item=result.items.find(item=>item.sourceId==='pwc');
    if(!item){event('offline_replay_no_item',{requests,sources:result.sources});throw Error('The product did not select the recorded PwC PDF');}
    const pageNumber=Number(item.research?.pageRange?.match(/\d+/)?.[0]);
    const document=getDocument({data:new Uint8Array(pdf),useSystemFonts:true});
    try{
      const opened=await document.promise;
      const page=await opened.getPage(pageNumber);
      const text=(await page.getTextContent()).items.map(row=>row.str??'').join(' ').replace(/\s+/gu,' ').trim();
      if(!text.includes(item.excerpt)||!/中国/u.test(item.excerpt)||!/(消费者|受访)/u.test(item.excerpt)||!/\d+(?:\.\d+)?\s*[%％]/u.test(item.excerpt))throw Error('Selected excerpt did not match Chinese consumer data on its PDF page');
      event('offline_replay',{requests,externalRequests:0,pdfPages:opened.numPages,pageNumber,item:{
        title:item.title,url:item.url,publishedAt:item.publishedAt,sourceName:item.sourceName,research:item.research,
        excerptLength:item.excerpt.length,excerptSha256:createHash('sha256').update(item.excerpt).digest('hex'),
      }});
    }finally{await document.destroy();}
  }else{
    const host=target??'www.ccfa.org.cn';
    if(!['www.ccfa.org.cn','ccfa.org.cn'].includes(host))throw Error('Expected official CCFA hostname');
    if(mode==='ccfa-strict'){
      await new Promise(resolve=>{
        const socket=connect({host,port:443,servername:host,rejectUnauthorized:true});
        socket.setTimeout(12000,()=>socket.destroy(Error('TLS connection timeout')));
        socket.on('secureConnect',()=>{
          event('strict_tls',{host,authorized:socket.authorized,durationMs:elapsed(start),protocol:socket.getProtocol()});
          socket.end();
        });
        socket.on('error',error=>event('strict_tls_failed',{host,durationMs:elapsed(start),error:errorInfo(error)}));
        socket.on('close',resolve);
      });
    }else{
      const executable='C:/Program Files/Git/usr/bin/openssl.exe';
      const child=spawn(executable,['s_client','-connect',host+':443','-servername',host,'-verify_hostname',host,'-showcerts'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='';
      child.stdout.setEncoding('utf8').on('data',data=>{stdout+=data;});
      child.stderr.setEncoding('utf8').on('data',data=>{stderr+=data;});
      child.stdin.end();
      const timer=setTimeout(()=>child.kill(),15000);
      const {code,signal}=await new Promise((resolve,reject)=>{
        child.once('error',reject);
        child.once('close',(code,signal)=>resolve({code,signal}));
      }).finally(()=>clearTimeout(timer));
      const chain=[...stdout.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(([pem])=>{
        const cert=new X509Certificate(pem);
        return {subject:cert.subject,issuer:cert.issuer,notBefore:cert.validFrom,notAfter:cert.validTo,san:cert.subjectAltName,fingerprint256:cert.fingerprint256};
      });
      const verdict=(stdout+'\n'+stderr).split(/\r?\n/).filter(line=>/verify error|verify return code|Verification error|^notAfter=|^notBefore=/i.test(line));
      event('tls_certificate',{host,durationMs:elapsed(start),code,signal,chain,verdict});
      if(!chain.length)process.exitCode=1;
    }
  }
}catch(error){
  event('diagnostic_failed',{durationMs:elapsed(start),error:errorInfo(error)});
  process.exitCode=1;
}
