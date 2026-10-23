import fs from 'node:fs/promises';
const p='docs/reports/KB02-SEMANTIC-AUDIT-20261023-',original=globalThis.fetch,secret=process.env.FMCG_LLM_API_KEY,ledger=process.env.KB02_TRACE_LEDGER,trace=process.env.KB02_TRACE;
const safe=v=>JSON.parse(secret?JSON.stringify(v).split(secret).join('[redacted]'):JSON.stringify(v));
let serial=Promise.resolve();
globalThis.fetch=async(input,init)=>{
 const url=String(input);if(!url.endsWith('/chat/completions'))return original(input,init);
 let sequence,stage;
 const entry=serial.then(async()=>{
  const permit=JSON.parse(await fs.readFile(p+'authorization.json','utf8'));stage=String(permit.activeStage);
  if(!permit.engineeringApproved||!permit.realCallsApproved||!permit.approvedStages.includes(Number(stage))||!Object.hasOwn(permit.stageCaps,stage))throw Error('Real stage not released');
  let rows=[];try{rows=(await fs.readFile(ledger,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(rows.length>=30||203+rows.length>=500||rows.filter(r=>String(r.stage)===stage).length>=permit.stageCaps[stage])throw Error('Stage/round cap reached');
  sequence=204+rows.length;
  await fs.appendFile(ledger,JSON.stringify({sequence,stage:Number(stage),at:new Date().toISOString(),host:new URL(url).host,previousKB02:203})+'\n');
 });serial=entry.catch(()=>{});await entry;
 const started=Date.now(),record={sequence,stage:Number(stage),at:new Date().toISOString(),host:new URL(url).host,request:JSON.parse(init.body)};
 try{const response=await original(input,init);record.status=response.status;
  try{const reader=response.clone().body.getReader(),parts=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2097152){record.responseOverTraceBudget=true;void reader.cancel();break;}parts.push(part.value);}if(!record.responseOverTraceBudget){const bytes=new Uint8Array(size);let offset=0;for(const b of parts){bytes.set(b,offset);offset+=b.length;}const data=JSON.parse(new TextDecoder().decode(bytes));record.response={finishReason:data.choices?.[0]?.finish_reason,content:data.choices?.[0]?.message?.content,usage:data.usage};}}catch{record.responseCaptureUnavailable=true;}
  record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(safe(record))+'\n');await fs.appendFile(p+'stage-'+stage+'-trace.jsonl',JSON.stringify(safe(record))+'\n');return response;
 }catch{record.networkError=true;record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(safe(record))+'\n');await fs.appendFile(p+'stage-'+stage+'-trace.jsonl',JSON.stringify(safe(record))+'\n');throw Error('External request failed; sanitized trace retained');}
};
