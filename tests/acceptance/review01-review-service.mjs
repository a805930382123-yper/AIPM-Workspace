import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile,writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function startWeeklyService(f,mode,guardPath) {
  const freePort=async()=>{
    const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');
    const port=socket.address().port;await new Promise(r=>socket.close(r));assert(port!==4317);return port;
  };
  const apiPort=await freePort(),uiPort=await freePort();assert.notEqual(apiPort,uiPort);
  const api='http://127.0.0.1:'+apiPort,ui='http://127.0.0.1:'+uiPort;
  if(mode==='fake') await writeFile(f.config,'FMCG_LLM_BASE_URL=http://127.0.0.1:1/v1\nFMCG_LLM_MODEL=fixture\nFMCG_LLM_API_KEY=review01-test-only\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^NODE_OPTIONS$/i.test(key)));
  const config=mode==='real'?path.resolve('.env.local'):f.config;
  const manifest=path.join(f.run,'guard-input.json');
  await writeFile(manifest,JSON.stringify({run:f.run,data:f.data,weekKey:f.weekKey,mode,knownIds:f.knownIds,forbidden:f.forbidden,safeTitles:f.safeTitles}));
  Object.assign(env,{FMCG_DATA_DIR:f.data,FMCG_LLM_CONFIG_FILE:config,FMCG_PORT:String(apiPort),FMCG_UI_ORIGIN:ui,FMCG_NEWS_AI_ENABLED:'false',REVIEW01_GUARD:manifest,CI:'true'});
  const child=spawn(process.execPath,['--import',pathToFileURL(guardPath).href,'--import','tsx','server/index.ts'],{env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:'ignore'});
  const closed=once(child,'close');const stop=async()=>{child.kill();await closed;};
  try{
    for(let n=0;!await fetch(api+'/api/health').then(r=>r.ok,()=>false);n++){assert(n<200&&child.exitCode===null,'isolated server startup');await delay(100);}
    const {writeToken}=await(await fetch(api+'/api/automation/status')).json();
    const req=async(route,method='GET',body,more={})=>fetch(api+route,{method,headers:{'content-type':'application/json','x-fmcg-automation-token':writeToken,...more},...(body?{body:JSON.stringify(body)}:{})});
    const json=async(...args)=>{const answer=await req(...args);assert(answer.ok,args[0]+' '+answer.status);return answer.json();};
    const reg=await json('/api/automation/schedules');
    const weekly=reg.items.find(t=>t.type==='review.weekly');
    assert(weekly?.enabled&&weekly.catchUp&&weekly.mayCallModel);
    assert.deepEqual(weekly.plan,{kind:'weekly',weekday:1,time:'09:00',timezone:'Asia/Shanghai'});
    for(const task of reg.items) await json('/api/automation/schedules/'+task.type,'PATCH',{revision:task.revision,enabled:false});
    const run=async()=>{const initiated=await json('/api/automation/tasks/review.weekly/run','POST',{});
      for(let i=0;i<1200;i++){const current=await json('/api/automation/runs/'+initiated.id);if(!['running','queued'].includes(current.status))return current;await delay(150);}
      assert.fail('weekly run did not quit');
    };
    return {api,ui,uiPort,run,req,json,stop};
  }catch(error){await stop();throw error;}
}
