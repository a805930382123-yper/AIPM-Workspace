import fs from 'node:fs/promises';
const original=globalThis.fetch,secret=process.env.FMCG_LLM_API_KEY,ledger=process.env.KB02_TRACE_LEDGER,trace=process.env.KB02_TRACE;
let count=0;try{count=(await fs.readFile(ledger,'utf8')).trim().split('\n').filter(Boolean).length;}catch(e){if(e.code!=='ENOENT')throw e;}
const safe=v=>JSON.parse(secret?JSON.stringify(v).split(secret).join('[redacted]'):JSON.stringify(v));let serial=Promise.resolve();
globalThis.fetch=async(input,init)=>{
 const url=String(input);if(!url.endsWith('/chat/completions'))return original(input,init);
 let sequence;await(serial=serial.then(async()=>{if(62+count>=200)throw Error('KB02 acceptance call cap reached');sequence=62+(++count);await fs.appendFile(ledger,JSON.stringify({sequence,at:new Date().toISOString(),host:new URL(url).host,historicalKB01:27,previousKB02:62})+'\n');}));
 const started=Date.now(),wire=JSON.parse(init.body),record={sequence,at:new Date().toISOString(),host:new URL(url).host,request:wire};
 try{const response=await original(input,init);record.status=response.status;try{const reader=response.clone().body.getReader(),parts=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2097152){record.responseOverTraceBudget=true;void reader.cancel();break;}parts.push(part.value);}if(!record.responseOverTraceBudget){const bytes=new Uint8Array(size);let offset=0;for(const b of parts){bytes.set(b,offset);offset+=b.length;}const data=JSON.parse(new TextDecoder().decode(bytes));record.response={finishReason:data.choices?.[0]?.finish_reason,content:data.choices?.[0]?.message?.content,usage:data.usage};}}catch{record.responseCaptureUnavailable=true;}record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(safe(record))+'\n');return response;}catch{record.networkError=true;record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(safe(record))+'\n');throw Error('External request failed; see sanitized trace');}
};


