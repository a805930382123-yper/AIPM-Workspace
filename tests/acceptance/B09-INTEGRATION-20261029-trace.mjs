// Test-only preload for the complete backend. Never changes provider results.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { OpenAiCompatibleProvider, LlmError, assertNoKnownSecret } from '../../services/llm/provider.ts';

const root=process.env.B09_INTEGRATION_ROOT,mode=process.env.B09_TRACE_MODE;
if(!root||!['manual','real','smoke'].includes(mode))throw Error('INTEGRATION_TRACE_CONTEXT_REQUIRED');
const control=path.join(root,'integration'),calls=path.join(control,'calls');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const put=(file,value,flag='wx')=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag,mode:0o600});
const fail=code=>{throw new LlmError(code,code==='LLM_NOT_CONFIGURED'?'此隔离实例已禁用Provider；手工知识和Prompt仍可使用。':'本阶段未放行、已使用或因首失败停止。',409);};
const original=OpenAiCompatibleProvider.prototype.complete;
OpenAiCompatibleProvider.prototype.complete=async function(request){
  if(mode==='manual')fail('LLM_NOT_CONFIGURED');
  if(fs.existsSync(path.join(control,'halt.json')))fail('INTEGRATION_FIRST_FAILURE_STOP');
  const grant=read(path.join(control,'active-grant.json'));
  const session=read(path.join(control,'session.json')),continuation=session.profile==='prompt-context-continuation';
  if(continuation&&!['generate','check','rewrite'].includes(grant.stage))fail('INTEGRATION_STAGE_NOT_ALLOWED');
  const purpose=request.purpose??(grant.stage==='audit'?'knowledge':undefined);
  if(purpose!==grant.purpose)fail('INTEGRATION_PURPOSE_MISMATCH');
  const previous=fs.readdirSync(calls).filter(name=>name.endsWith('.json')).map(name=>read(path.join(calls,name)));
  const count=previous.filter(call=>call.purpose===purpose).length;
  if(count>=(purpose==='prompt'?session.promptCap:session.knowledgeCap))fail('INTEGRATION_PURPOSE_LIMIT');
  if(continuation&&grant.stage!==['generate','check','rewrite'][count])fail('INTEGRATION_STAGE_ORDER');
  const file=path.join(calls,grant.stage+'.json');if(fs.existsSync(file))fail('INTEGRATION_STAGE_ALREADY_USED');
  const sequence=(purpose==='prompt'?session.promptBefore:session.knowledgeBefore)+1+count,secrets=this.secrets;
  const input={system:request.system,user:request.user,purpose:request.purpose,structuredOutput:request.structuredOutput,timeoutMs:request.timeoutMs,maxOutputBytes:request.maxOutputBytes};
  assertNoKnownSecret(input,secrets);
  const attempt={stage:grant.stage,purpose,sequence,mode,requestSha256:sha(input),startedAt:new Date().toISOString(),status:'pending-counts-if-unknown',httpSent:0};
  put(file,attempt);put(path.join(control,`request-${purpose}-${sequence}.json`),input);
  const fetchBefore=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(attempt.httpSent)fail('INTEGRATION_HTTP_LIMIT');
    const body=JSON.parse(String(init.body));assertNoKnownSecret(body,secrets);
    put(path.join(control,`wire-request-${purpose}-${sequence}.json`),{url:String(url),method:init.method,body});
    attempt.httpSent++;put(file,attempt,'w');
    const response=await fetchBefore(url,init),wire={status:response.status,body:await response.clone().text()};
    put(path.join(control,`wire-response-${purpose}-${sequence}.private.json`),wire);assertNoKnownSecret(wire,secrets);put(path.join(control,`wire-response-${purpose}-${sequence}.json`),wire);return response;
  };
  try{
    const response=await original.call(this,request);put(path.join(control,`response-${purpose}-${sequence}.private.json`),response);assertNoKnownSecret(response,secrets);put(path.join(control,`response-${purpose}-${sequence}.json`),response);
    attempt.status='provider-returned';attempt.finishedAt=new Date().toISOString();put(file,attempt,'w');return response;
  }catch(error){
    attempt.status='failed-no-retry';attempt.code=error.code??'PROVIDER_FAILURE';attempt.finishedAt=new Date().toISOString();put(file,attempt,'w');
    if(!fs.existsSync(path.join(control,'halt.json')))put(path.join(control,'halt.json'),{stage:grant.stage,purpose,sequence,code:attempt.code});throw error;
  }finally{globalThis.fetch=fetchBefore;}
};
