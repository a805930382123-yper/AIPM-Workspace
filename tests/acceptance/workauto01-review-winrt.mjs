import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createReviewFixture, businessHashes } from './workauto01-review-fixture.mjs';

export async function freePort(){
  const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));assert(port!==4317);
  return port;
}
export async function startReviewServer(){
  const fixture=await createReviewFixture(),{run,data,config}=fixture;
  const apiPort=await freePort(),uiPort=await freePort();assert.notEqual(apiPort,uiPort);
  const api='http://127.0.0.1:'+apiPort,base='http://127.0.0.1:'+uiPort;
  const hook=path.join(run,'observe.mjs'),wire=path.join(run,'wire.log'),powershell=path.join(run,'powershell.log');
  await writeFile(wire,'');await writeFile(powershell,'');
  await writeFile(hook,`
import {appendFileSync} from 'node:fs';
import {ChildProcess} from 'node:child_process';
const native=ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn=function(options){
  if(/(?:^|[\\\\/])powershell(?:\\.exe)?$/i.test(options.file)){
    this.once('exit',(code,signal)=>appendFileSync(${JSON.stringify(powershell)},JSON.stringify({code,signal})+'\\n'));
  }
  return native.call(this,options);
};
globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(wire)},'blocked external fetch\\n');throw Error('Offline reminder test');};
`);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^FMCG_|^(NODE_OPTIONS|NODE_ENV|NODE_TEST_CONTEXT|CI)$/i.test(key)));
  Object.assign(env,{FMCG_DATA_DIR:data,FMCG_LLM_CONFIG_FILE:config,FMCG_PORT:String(apiPort),FMCG_UI_ORIGIN:base,FMCG_NEWS_AI_ENABLED:'false'});
  const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'--import','tsx','server/index.ts'],{env,windowsHide:true,stdio:'ignore'});
  const exit=once(child,'close');
  const stop=async()=>{child.kill();await exit;};
  try{
    for(let i=0;!await fetch(api+'/api/health').then(r=>r.ok,()=>false);i++){assert(i<180 && child.exitCode===null,'API startup');await delay(120);}
    const {writeToken}=await (await fetch(api+'/api/automation/status')).json();
    const req=async(route,method='GET',body,headers={})=>fetch(api+'/api/automation'+route,{method,headers:{'content-type':'application/json','x-fmcg-automation-token':writeToken,...headers},...(body?{body:JSON.stringify(body)}:{})});
    const json=async(...args)=>{const resp=await req(...args);assert(resp.ok,args[0]+' '+resp.status);return resp.json();};
    const schedules=(await json('/schedules')).items;
    const task=schedules.find(t=>t.type==='work.reminders');assert(task?.enabled);assert.equal(task.catchUp,false);assert.deepEqual(task.plan,{kind:'interval',minutes:60});assert.equal(task.mayCallModel,false);
    for(const other of schedules.filter(t=>t.type!=='work.reminders'))await json('/schedules/'+other.type,'PATCH',{revision:other.revision,enabled:false});
    const scan=async()=>{
      const run=await json('/tasks/work.reminders/run','POST',{});
      for(let i=0;i<150;i++){const state=await json('/runs/'+run.id);if(!['queued','running'].includes(state.status)){assert.equal(state.status,'succeeded');assert.equal(state.usage.requests,0);return state;}await delay(120);}
      assert.fail('scan timeout');
    };
    return {...fixture,base,api,uiPort,wire,powershell,req,json,scan,stop};
  }catch(error){await stop();throw error;}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const ctx=await startReviewServer();console.log('Evidence',ctx.run);
  const report={node:process.version,platform:process.platform};
  try{
    const before=await businessHashes(ctx.data);
    const settings=await ctx.json('/reminders?status=all');
    const patch={revision:settings.revision,quietHoursStart:'00:00',quietHoursEnd:'00:00',desktopNotificationsEnabled:true,maxToastsPerRun:1};
    await ctx.json('/reminders/settings','PATCH',patch);
    const denied=await ctx.req('/reminders/settings','PATCH',patch,{'x-fmcg-automation-token':'invalid'});
    assert.equal(denied.status,403);report.invalidToken=denied.status;
    const stale=await ctx.req('/reminders/settings','PATCH',patch);assert.equal(stale.status,409);report.staleRevision=stale.status;
    const foreign=await ctx.req('/reminders?status=all','GET',undefined,{Origin:'https://untrusted.invalid'});assert.equal(foreign.status,403);report.foreignOrigin=foreign.status;
    report.testNotification=await ctx.json('/reminders/test-notification','POST',{});
    report.scan=await ctx.scan();
    const reminders=await ctx.json('/reminders?status=all');
    report.items=reminders.items.map(({kind,status,deliveryStatus,deliveryError})=>({kind,status,deliveryStatus,deliveryError}));
    for(const sentinel of ctx.sentinels) assert(!JSON.stringify(reminders).includes(sentinel));
    assert.deepEqual(report.items.map(x=>x.kind).sort(),['due_follow_up','due_follow_up','new_raw_ready','stale_item']);
    const beforeRepeat=await readFile(ctx.powershell,'utf8');
    await ctx.scan();assert.equal(await readFile(ctx.powershell,'utf8'),beforeRepeat);
    const follow=await ctx.json('/reminders?status=all');
    assert.deepEqual(follow.items.map(x=>x.id).sort(),reminders.items.map(x=>x.id).sort());
    assert.deepEqual(await businessHashes(ctx.data),before);report.businessHashes=before;
    report.powershell=beforeRepeat.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(await readFile(ctx.wire,'utf8'),'');report.externalRequests=0;
    assert.equal(report.powershell.length,2,'explicit test and capped summary each invoke native adapter once');
    assert(report.powershell.every(x=>x.code===0),'WinRT command did not exit successfully');
  }finally{await writeFile(path.join(ctx.run,'winrt-result.json'),JSON.stringify(report,null,2));await ctx.stop();}
}
