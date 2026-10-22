import fs from 'node:fs/promises';
const original=globalThis.fetch,ledger=process.env.PA01_LEDGER,trace=process.env.PA01_TRACE;
let count=0;try{count=(await fs.readFile(ledger,'utf8')).split('\n').filter(Boolean).length;}catch(e){if(e.code!=='ENOENT')throw e;}
let serial=Promise.resolve();
globalThis.fetch=async(input,init)=>{
 const url=String(input);if(!url.endsWith('/chat/completions'))return original(input,init);
 const wire=JSON.parse(init.body),user=JSON.parse(wire.messages.find(x=>x.role==='user').content),stage='task' in user?'brief':'brief' in user?'generate':'dimensions' in user?'check':'rewrite';
 let sequence;await(serial=serial.then(async()=>{if(count>=24)throw Error('PA01 real acceptance 24-call cap reached');sequence=++count;await fs.appendFile(ledger,JSON.stringify({at:new Date().toISOString(),sequence,host:new URL(url).host,model:wire.model,stage,requestCharacters:JSON.stringify(wire.messages).length,reasoningEffort:wire.reasoning_effort,responseFormat:wire.response_format})+'\n');}));
 const started=Date.now(),record={sequence,stage,at:new Date().toISOString()};
 try{const r=await original(input,init);record.status=r.status;record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(record)+'\n');return r;}
 catch(e){record.networkError=true;record.aborted=init?.signal?.aborted??false;record.elapsedMs=Date.now()-started;await fs.appendFile(trace,JSON.stringify(record)+'\n');throw e;}
};