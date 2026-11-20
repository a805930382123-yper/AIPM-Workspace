import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';

const f=JSON.parse(readFileSync(process.env.REVIEW01_GUARD,'utf8'));
const target=name=>path.join(f.run,name);
const native=globalThis.fetch;
let attempts=0;
function canonical(value) {
  if(typeof value==='string') return value.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/g,s=>s.slice(0,10)+' [time]');
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
globalThis.fetch=async(input,options)=>{
  const url=new URL(input);
  assert.equal(options?.method,'POST');assert(url.pathname.endsWith('/chat/completions'));
  assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');
  assert(f.mode==='real'||f.mode==='fake');
  if(f.mode==='real'){assert.equal(url.origin,'https://api.openai.com');}
  else assert.equal(url.origin,'http://127.0.0.1:1');
  const request=JSON.parse(options.body);
  assert.deepEqual(request.messages.map(m=>m.role),['system','user']);
  const [{content:system},{content:user}]=request.messages;
  assert.equal(typeof system,'string');assert.equal(typeof user,'string');
  assert(/周报|工作回顾|weekly.review/i.test(system));
  const inputData=JSON.parse(user);
  for(const s of f.forbidden)assert(!options.body.includes(s),'outbound contained a protected fixture value');
  assert(user.includes(f.weekKey));
  assert(f.safeTitles.some(t=>user.includes(t)));
  const keys=Object.keys(request);
  assert(keys.every(k=>['model','messages','stream','temperature','reasoning_effort','response_format'].includes(k)));
  const digest=createHash('sha256').update(JSON.stringify(canonical({system,inputData}))).digest('hex');
  if(f.mode==='real'){
    const allowed=readFileSync(target('approved-envelope.sha256'),'utf8').trim();
    assert.equal(digest,allowed,'real request differs from inspected synthetic envelope');
    assert.equal(++attempts,1,'one real completion per acceptance run');
    writeFileSync(target('real-attempt.json'),JSON.stringify({attempts,digest}),{flag:'wx'});
    try{
      const response=await native(input,{...options,redirect:'error'});
      writeFileSync(target('transport.json'),JSON.stringify({httpStatus:response.status,category:Math.floor(response.status/100)+'xx'}));
      return response;
    }catch(e){
      const code=e?.cause?.code;
      const safeCode=typeof code==='string'&&/^(?:E[A-Z]+|UND_ERR_[A-Z_]+|ERR_(?:TLS|SSL)_[A-Z_]+)$/.test(code)?code:'unknown';
      writeFileSync(target('transport.json'),JSON.stringify({httpStatus:null,causeCode:safeCode}));throw e;
    }
  }
  writeFileSync(target('synthetic-envelope.json'),JSON.stringify({digest,system,inputData},null,2));
  const ref=user.match(/wiki:[0-9a-f-]{36}/)?.[0];
  assert(ref,'expected synthetic Wiki reference');
  const draft={executiveSummary:'本周形成合成门店陈列指引。',highlights:[{text:'新增合成门店陈列指引。',refs:[ref]}],risksAndBlockers:[],nextWeekFocus:[],openQuestions:[]};
  return Response.json({choices:[{message:{content:JSON.stringify(draft)},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:14}});
};
