import fs from 'node:fs/promises';
const source=await fs.readFile('tests/acceptance/m05-app-component.mjs','utf8');
const scaffold=source.slice(0,source.indexOf("try{\n await test('AC01"));
if(!scaffold)throw Error('App scaffold missing');
const scenario=`try{
 await test('AJ01-ordinary-job-settle-refresh-preserves-current-Raw-selection',async a=>{
  let release,seen=false;const waiting=new Promise(r=>release=r);
  h.setReply(async()=>{seen=true;await waiting;return{httpStatus:500,message:'Controlled ordinary fake failure'};});
  const raw=title=>req('/api/raw','POST',{title,sourceType:'other',sourceName:'isolated ordinary source',tags:[],body:'# '+title},201);
  const older=await raw('AJ01用户选中的旧Raw');await delay(15);const newer=await raw('AJ01初始较新Raw');
  const job=await req('/api/raw/'+newer.id+'/extract','POST',{},202);
  try{
   await tick(()=>seen,'ordinary fake request held');
   w.history.replaceState({},'','/');root=createRoot(doc.getElementById('root'));await act(async()=>root.render(createElement(App)));
   await tick(()=>doc.querySelector('.stat-card strong')?.textContent==='2'&&!doc.querySelector('.loading-note'),'App loaded ordinary running job');
   await nav('Raw 原始资料');await tick(()=>doc.querySelector('.raw-detail')?.textContent.includes(newer.id),'initial newest selection');
   await act(async()=>{await delay(80);});
   await click([...doc.querySelectorAll('button.raw-list-item')].find(e=>e.textContent.includes(older.title)));
   await tick(()=>doc.querySelector('.raw-detail')?.textContent.includes(older.id),'user selected older Raw');
   const count=requests.filter(e=>e.path==='/api/raw'&&e.method==='GET').length;release();
   await tick(()=>requests.filter(e=>e.path==='/api/raw'&&e.method==='GET').length>count,'actual job poll completed and background Raw refresh started');
   await act(async()=>{await delay(180);});
   a.userSelected=older.id;a.initialRaw=newer.id;a.jobId=job.jobId;a.actualJob=(await req('/api/extraction-jobs/'+job.jobId)).status;a.shownDetail=doc.querySelector('.raw-detail')?.textContent??null;
   assert.equal(a.actualJob,'failed');assert(doc.querySelector('.raw-detail')?.textContent.includes(older.id),'Job settle refresh must not restore stale selectedRawId from its old closure');
  }finally{release();}
 });
}finally{await unmount();globalThis.fetch=originalFetch;w.close();await h.close();const result={at:new Date().toISOString(),kind:'Actual App + real isolated HTTP + ordinary fake Provider job/poll',dataRoot:h.dataRoot,durationMs:Date.now()-started,checks,summary:{pass:checks.filter(c=>c.result==='PASS').length,fail:checks.filter(c=>c.result==='FAIL').length},requests,providerCalls:h.requests.length,providerMeaning:'One explicit ordinary Raw fake job only; no Meeting input or external Provider',servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)};await fs.writeFile('docs/reports/M05-20261012-app-job-component.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));if(result.summary.fail)process.exitCode=1;}
`;
await fs.writeFile('tests/acceptance/m05-app-job-component.mjs',scaffold+scenario);
console.log('Prepared focused actual ordinary-job App regression.');
