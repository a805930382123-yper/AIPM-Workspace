import { storageFixture } from './kb02-storage-fixture.ts';
import { storageHttp } from './kb02-storage-http.ts';
import type { LlmCompletionRequest } from '../../services/llm/provider.ts';

export function deepReply(request: LlmCompletionRequest): unknown {
  const p=JSON.parse(request.user);
  if(p.stage==='outline')return {version:1,sections:[{id:'core',title:'虚构经营口径',question:'原文说明什么？',factIds:p.facts.map((f:any)=>f.id),questionIds:p.questions.map((q:any)=>q.id)}],excluded:[]};
  if(p.stage==='writing'){
    const first=p.facts[0],source={role:'source_supported',factIds:[first.id]},organized={role:'reorganized',factIds:[first.id]};
    return {version:1,orientation:'虚构资料阅读主线',sections:p.outline.sections.map((s:any)=>({id:s.id,title:s.title,question:s.question,blocks:[
      ...s.factIds.map((id:string)=>({type:'paragraph',role:'source_supported',factIds:[id],text:p.facts.find((f:any)=>f.id===id).text})),
      {type:'list',items:[{...organized,text:first.text},{role:'supplementary',factIds:[],text:'渠道层级是理解商品流通的补充概念。'}]},
      {type:'table',title:'业务口径',headings:['原文','阅读说明'],rows:[{...source,cells:[first.text,'保持原口径']}]},
      {type:'path_diagram',title:'阅读路径',nodes:[{...source,id:'a',text:first.text},{...organized,id:'b',text:'核对范围'}],edges:[{...organized,from:'a',to:'b',text:'依据原文核对'}]},
      {type:'callout',title:'保留未知',role:'needs_verification',factIds:[],text:'负责人仍需确认。',reason:'原文没有负责人身份。'}
    ]}))};
  }
  if(p.stage==='quality')return {version:1,findings:[]};
  throw Error('Unknown stage');
}
export async function deepFixture(body?:string) {
  const f=await storageFixture();f.succeed();
  const raw=body===undefined?f.raw:await f.rawStore.create({title:'虚构深度资料',sourceType:'report',sourceName:'隔离fake',tags:[],body});
  const requests: LlmCompletionRequest[]=[], original=f.provider.complete;
  let mutate: ((stage:string,value:any,payload:any)=>unknown)|undefined;
  let hook: ((stage:string,request:LlmCompletionRequest)=>Promise<void>)|undefined;
  f.provider.complete=async request=>{
    requests.push(request);const deep=request.system.startsWith('KB03 '),stage=deep?JSON.parse(request.user).stage:request.user.includes('请对下列全部已验证事实规划知识页')?'planning':'extracting';
    await hook?.(stage,request);
    if(!deep){
      const response=await original(request);
      if(!mutate)return response;
      const value=JSON.parse(response.text),changed=mutate(stage,value,JSON.parse(request.user.split('\n').at(-1)!));
      return {...response,text:typeof changed==='string'?changed:JSON.stringify(changed)};
    }
    const value=deepReply(request),changed=mutate?mutate(stage,value,JSON.parse(request.user)):value;
    return {text:typeof changed==='string'?changed:JSON.stringify(changed),bytes:1,finishReason:'stop'};
  };
  const http=await storageHttp(f);
  const start=(mode='deep',extra={})=>http.request(`/api/raw/${raw.id}/extract`,{mode,...extra});
  const wait=async(id:string,runner=f.runner)=>{await runner.waitForSettlement(id);return (await runner.readJob(id));};
  return {...f,raw,http,requests,start,wait,mutate:(fn:typeof mutate)=>{mutate=fn;},hook:(fn:typeof hook)=>{hook=fn;},clean:async()=>{await http.close();for(const job of await f.jobs.list()){if((await f.runner.readJob(job.id)).execution==='running')await f.runner.cancel(job.id);await f.runner.waitForSettlement(job.id);}await f.clean();}};
}
