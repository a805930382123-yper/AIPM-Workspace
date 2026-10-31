/** Independent actual Chrome checks. Run only after L6 builder stop-write handoff. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const { chromium } = createRequire(import.meta.url)('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const relative = path.relative(os.tmpdir(), path.resolve(session.root));
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
for (const address of [session.url, session.api]) assert.equal(new URL(address).hostname, '127.0.0.1');
const output = path.join(session.root, 'lifeos-l6-browser-evidence');
await mkdir(output, { recursive: true });
const evidence = { success: false, checks: [], screenshots: [], external: [], pageErrors: [], mutations: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function businessSnapshot() {
  const files = {};
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else files[path.relative(session.root, filename)] = sha(await readFile(filename));
    }
  }
  for (const directory of ['knowledge', 'prompts', 'drafts', 'state', 'meetings']) await walk(path.join(session.root, directory));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
async function api(route, status = 200) {
  const response = await fetch(session.api + route);
  assert.equal(response.status, status, route);
  return response.json();
}
const isGet = (response, pathname) => response.request().method() === 'GET' && new URL(response.url()).pathname === pathname;
async function capture(page, label) {
  const filename = path.join(output, label + '.png');
  await page.screenshot({ path: filename, fullPage: true });
  evidence.screenshots.push({ file: filename, viewport: page.viewportSize(), sha256: sha(await readFile(filename)) });
}
async function layout(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, focusVisible: !!document.querySelector(':focus-visible') }));
  assert.ok(result.scrollWidth <= result.width + 1, label + ': horizontal overflow');
  assert.ok(result.focusVisible, label + ': keyboard focus visible');
  evidence.checks.push({ label, result });
}

const fixtures = session.fixtures;
const {start,end} = fixtures.period;
const reviewUrl = (a=start,b=end) => '/api/home/review?start='+a+'&end='+b;
const sorted = items => [...items].sort();
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1080},timezoneId:'America/Los_Angeles'});
const page = await context.newPage();
evidence.chrome = browser.version();
page.on('pageerror', error=>evidence.pageErrors.push(error.message));
let reviewRequests=0;
page.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/api/home/review')reviewRequests++;if(u.pathname.startsWith('/api/')&&request.method()!=='GET')evidence.mutations.push({method:request.method(),path:u.pathname});});
await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){evidence.external.push(u.origin);await route.abort();}else await route.continue();});
const review=page.locator('.period-review');
const regions=()=>review.locator(':scope > section');
async function load(a=start,b=end){
 await review.getByLabel('开始日期（含）',{exact:true}).fill(a);
 await review.getByLabel('结束日期（不含）',{exact:true}).fill(b);
 const response=page.waitForResponse(r=>isGet(r,'/api/home/review')&&new URL(r.url()).searchParams.get('start')===a&&new URL(r.url()).searchParams.get('end')===b);
 await review.getByRole('button',{name:'刷新回顾',exact:true}).click();
 const r=await response;assert.equal(r.status(),200);const body=await r.json();
 await review.getByText(`覆盖 ${a}（含）至 ${b}（不含），Asia/Shanghai；删除后的当前存量无法反推过去总量。`,{exact:true}).waitFor();
 return body;
}
async function open(){
 const response=page.waitForResponse(r=>isGet(r,'/api/home/review'));
 await page.getByRole('button',{name:'周期回顾',exact:true}).click();await response;await review.waitFor();return load();
}
async function home(){await page.locator('.nav-item').filter({hasText:'首页'}).click();await page.locator('#home-actions').waitFor();return open();}
async function temporarily(file,content,fn){const original=await readFile(file);await writeFile(file,content);try{return await fn();}finally{await writeFile(file,original);}}
if(process.argv.includes('--remaining')||process.argv.includes('--visual')){
 const mode=process.argv.includes('--visual')?'visual':'remaining';
 try{
  const before=await businessSnapshot(),counters=await api('/__control/counters');await page.goto(session.url);await page.locator('#home-actions').waitFor();const body=await open();
  const wikiItem=body.knowledge.items[0],wikiFile=path.join(session.root,'knowledge','wiki',wikiItem.id+'.md'),wikiBytes=await readFile(wikiFile,'utf8');
  const promptFile=path.join(session.root,'prompts',fixtures.mainPromptId+'.json'),prompt=JSON.parse(await readFile(promptFile,'utf8'));
  const historical=body.feedback.items.find(x=>x.promptVersion===1);
  const stateFile=path.join(session.root,'state','raw-processing',fixtures.pendingRawId+'.json');
  if(mode==='visual'){
   const changed=structuredClone(prompt),note=changed.feedback.items.find(x=>x.id===historical.id);note.observation='第一行观察\n第二行观察 '+('LONG'.repeat(180));note.nextImprovement='第一行建议\n第二行建议 '+('NEXT'.repeat(180));note.revision++;
   await temporarily(promptFile,JSON.stringify(changed),async()=>{await load();const baseline=await businessSnapshot();const detail=regions().nth(2).locator('details').filter({hasText:historical.id});await detail.locator('summary').click();
    for(const width of [1440,1024]){await page.setViewportSize({width,height:1080});await review.getByLabel('开始日期（含）',{exact:true}).focus();await page.keyboard.press('Tab');await layout(page,'repaired long feedback '+width);await capture(page,'04-repaired-long-feedback-'+width);const observed=await detail.locator('.review-feedback-text').evaluateAll(elements=>elements.map(x=>({text:x.innerText,whiteSpace:getComputedStyle(x).whiteSpace,overflowWrap:getComputedStyle(x).overflowWrap})));assert.equal(observed[0].text,'观察：'+note.observation);assert.equal(observed[1].text,'改进建议：'+note.nextImprovement);assert.ok(observed.every(x=>x.whiteSpace==='pre-wrap'&&x.overflowWrap==='anywhere'));evidence.checks.push({label:'full original long/multiline observation and improvement '+width,observed});}
    assert.deepEqual(await businessSnapshot(),baseline);
   });
  }else{
   for(const [name,file,invalid] of [['Wiki Frontmatter',wikiFile,'broken'],['Wiki identity',wikiFile,wikiBytes.replace(wikiItem.id,'00000000-0000-4000-8000-000000000000')],['Prompt JSON',promptFile,'{broken'],['feedback shape',promptFile,JSON.stringify({...prompt,feedback:{schemaVersion:1,items:'broken',deletedIds:[]}})],['pending raw-task',stateFile,'{broken']]){
    await temporarily(file,invalid,async()=>{const baseline=await businessSnapshot(),result=await load();if(name.startsWith('Wiki')){assert.equal(result.knowledge.status,'error');assert.equal(result.feedback.status,'ok');await regions().nth(0).getByRole('alert').waitFor();assert.ok(!(await regions().nth(0).innerText()).includes('正式记录 · 0'));}else if(name==='pending raw-task'){assert.equal(result.pending.sources['raw-task'].status,'error');assert.equal(result.knowledge.status,'ok');assert.equal(result.feedback.status,'ok');await regions().nth(1).getByRole('alert').waitFor();}else{assert.equal(result.feedback.status,'error');assert.equal(result.knowledge.status,'ok');await regions().nth(2).getByRole('alert').waitFor();}assert.deepEqual(await businessSnapshot(),baseline);evidence.checks.push({label:name+' explicit error/other sources readable/no repair write'});if(name==='feedback shape')await capture(page,'05-feedback-source-error-1440');});
   }
   const wikiDir=path.join(session.root,'knowledge','wiki'),hiddenDir=wikiDir+'.independent-hidden';await rename(wikiDir,hiddenDir);await writeFile(wikiDir,'directory fault');try{const baseline=await businessSnapshot(),result=await load();assert.equal(result.knowledge.status,'error');assert.equal(result.feedback.status,'ok');assert.deepEqual(await businessSnapshot(),baseline);evidence.checks.push({label:'Wiki directory ENOTDIR is source error, not false empty'});}finally{const {unlink}=await import('node:fs/promises');await unlink(wikiDir);await rename(hiddenDir,wikiDir);}
   await load();await page.setViewportSize({width:1024,height:1080});await capture(page,'06-source-recovered-1024');
   const changed=structuredClone(prompt),note=changed.feedback.items.find(x=>x.id===historical.id);note.observation='显式刷新后的修改';note.revision++;
   await temporarily(promptFile,JSON.stringify(changed),async()=>{const result=await load();assert.equal(result.feedback.items.find(x=>x.id===historical.id).observation,note.observation);const details=regions().nth(2).locator('details').filter({hasText:historical.id});await details.locator('summary').click();assert.ok((await details.innerText()).includes(note.observation));});
   changed.feedback.items=changed.feedback.items.filter(x=>x.id!==historical.id);changed.feedback.deletedIds.push(historical.id);await temporarily(promptFile,JSON.stringify(changed),async()=>{const result=await load();assert.equal(result.feedback.items.length,1);assert.ok(!result.feedback.items.some(x=>x.id===historical.id));});
   await load();const recycleFile=path.join(session.root,'prompts','recycle',fixtures.mainPromptId+'.json');const deletion=await fetch(session.api+'/api/prompts/'+fixtures.mainPromptId,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseVersion:prompt.current.version})});assert.equal(deletion.status,200);try{const baseline=await businessSnapshot(),result=await load();assert.equal(result.feedback.items.length,0);await regions().nth(2).getByText('本周期没有使用反馈。',{exact:true}).waitFor();assert.deepEqual(await businessSnapshot(),baseline);}finally{await rename(recycleFile,promptFile);}
   evidence.checks.push({label:'explicit refresh updates/omits changed/deleted feedback and real recycled Prompt feedback'});
   const moved=[];try{for(const name of ['knowledge','prompts','drafts','state']){const source=path.join(session.root,name),target=path.join(session.root,name+'.independent-hidden');await rename(source,target);moved.push([source,target]);}const baseline=await businessSnapshot(),result=await load();assert.equal(result.knowledge.count,0);assert.equal(result.feedback.items.length,0);assert.equal(result.pending.items.length,0);assert.ok(Object.values(result.pending.sources).every(x=>x.status==='ok'));await regions().nth(0).getByText('本周期无记录。',{exact:true}).waitFor();await regions().nth(2).getByText('本周期没有使用反馈。',{exact:true}).waitFor();assert.deepEqual(await businessSnapshot(),baseline);await capture(page,'07-real-empty-1024');evidence.checks.push({label:'genuinely empty source directories show honest empty; no seeded or migration writes'});}finally{for(const[source,target]of moved.reverse())await rename(target,source);}
  }
  await load();assert.deepEqual(await businessSnapshot(),before);assert.deepEqual(await api('/__control/counters'),counters);assert.equal(counters.provider,0);assert.deepEqual(evidence.mutations,[]);assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.pageErrors,[]);evidence.checks.push({label:'all temporary fixture bytes restored; Provider0/no browser mutations/no external/page errors',counters});evidence.success=true;console.log(JSON.stringify({success:true,mode,checks:evidence.checks.length,result:path.join(output,mode+'-result.json')}));
 }catch(error){evidence.failure={message:error.message,stack:error.stack};await capture(page,mode+'-failure');throw error;}finally{await writeFile(path.join(output,mode+'-result.json'),JSON.stringify(evidence,null,2));await browser.close();}
 process.exit(0);
}
try{
 const before=await businessSnapshot(),counters=await api('/__control/counters');assert.equal(counters.provider,0);
 await page.goto(session.url);await page.locator('#home-actions .home-action-row').waitFor();assert.equal(reviewRequests,0);
 const body=await open();
 assert.deepEqual(sorted(body.knowledge.items.map(x=>x.id)),sorted(fixtures.wiki.filter(x=>x.expected==='inside').map(x=>x.id)));
 assert.deepEqual(sorted(body.knowledge.undated.map(x=>x.id)),sorted(fixtures.wiki.filter(x=>x.expected==='undated').map(x=>x.id)));
 assert.equal(body.knowledge.count,3);
 assert.deepEqual(sorted(body.feedback.items.map(x=>x.id)),sorted(fixtures.feedback.filter(x=>x.expected==='inside').map(x=>x.id)));
 assert.equal(Object.values(body.feedback.counts).reduce((a,b)=>a+b,0),2);
 assert.deepEqual(body.pending,await api('/api/home/actions'));assert.equal(body.pending.items[0].target.rawId,fixtures.pendingRawId);
 evidence.checks.push({label:'explicit open; Shanghai Wiki boundaries/undated and usedOn historical feedback; same-source current pending',body});
 const historical=body.feedback.items.find(x=>x.promptVersion===1);
 let detail=regions().nth(2).locator('details').filter({has:page.locator('summary').filter({hasText:historical.usedOn})});
 await detail.locator('summary').click();for(const text of [historical.id,historical.promptId,historical.scenario,historical.observation,historical.nextImprovement,'使用版本：1'])assert.ok((await detail.innerText()).includes(text));
 await regions().nth(0).locator('summary').click();
 for(const width of [1440,1024]){await page.setViewportSize({width,height:1080});await review.getByLabel('开始日期（含）',{exact:true}).focus();await page.keyboard.press('Tab');await layout(page,'review layout '+width);await capture(page,'01-review-'+width);}
 await load('2026-09-01','2026-09-08');const other=await api(reviewUrl('2026-09-01','2026-09-08'));assert.deepEqual(other.pending,body.pending);await regions().nth(2).getByText('本周期没有使用反馈。',{exact:true}).waitFor();
 for(const [a,b] of [['2026-02-29','2026-03-01'],[start,start],[end,start]])await api(reviewUrl(a,b),400);
 // Hold a completed old response, then let a new range finish before releasing it.
 let release,held,delivered;const heldReady=new Promise(r=>held=r);const gate=new Promise(r=>release=r);const finished=new Promise(r=>delivered=r);let once=true;
 await page.route('**/api/home/review?**',async route=>{if(once){once=false;const response=await route.fetch();held();await gate;await route.fulfill({response});delivered();}else await route.continue();});
 await review.getByRole('button',{name:'刷新回顾',exact:true}).click();await heldReady;await load();release();await finished;await page.unroute('**/api/home/review?**');
 await review.getByText(`覆盖 ${start}（含）至 ${end}（不含），Asia/Shanghai；删除后的当前存量无法反推过去总量。`,{exact:true}).waitFor();
 evidence.checks.push({label:'date change retains current pending; empty feedback and invalid dates; stale old response cannot overwrite current range'});
 const wikiItem=body.knowledge.items[0];const wikiRow=()=>regions().nth(0).locator('.review-row').filter({hasText:wikiItem.id});
 const wikiResponse=page.waitForResponse(r=>isGet(r,'/api/wiki/'+wikiItem.id));await wikiRow().getByRole('button',{name:'查看 Wiki',exact:true}).click();assert.equal((await (await wikiResponse).json()).id,wikiItem.id);await page.locator('.wiki-detail-panel h2').filter({hasText:wikiItem.title}).waitFor();
 await home();const pendingItem=body.pending.items[0];const preflight=page.waitForResponse(r=>isGet(r,'/api/home/actions/'+pendingItem.kind+'/'+pendingItem.id));await regions().nth(1).getByRole('button',{name:pendingItem.action,exact:true}).click();assert.equal((await preflight).status(),200);await page.locator('.raw-detail h2').filter({hasText:pendingItem.title}).waitFor();await home();
 assert.deepEqual(await businessSnapshot(),before);assert.deepEqual(await api('/__control/counters'),counters);assert.deepEqual(evidence.mutations,[]);
 evidence.checks.push({label:'exact Wiki/Raw navigation and healthy read-only business file set+SHA unchanged',before,counters});
 const wikiFile=path.join(session.root,'knowledge','wiki',wikiItem.id+'.md');const wikiBytes=await readFile(wikiFile,'utf8');
 await temporarily(wikiFile,wikiBytes.replace(/revision: 1/, 'revision: 2'),async()=>{await wikiRow().getByRole('button',{name:'查看 Wiki',exact:true}).click();await review.getByRole('alert').filter({hasText:'Wiki 已删除或变化'}).waitFor();});
 const hiddenWiki=wikiFile+'.independent-hidden';await rename(wikiFile,hiddenWiki);try{await wikiRow().getByRole('button',{name:'查看 Wiki',exact:true}).click();await review.getByRole('alert').filter({hasText:'Wiki 已删除或变化'}).waitFor();}finally{await rename(hiddenWiki,wikiFile);}
 const stateFile=path.join(session.root,'state','raw-processing',fixtures.pendingRawId+'.json');const state=JSON.parse(await readFile(stateFile,'utf8'));
 await temporarily(stateFile,JSON.stringify({...state,updatedAt:'2026-09-02T00:00:00.000Z'}),async()=>{await regions().nth(1).getByRole('button',{name:pendingItem.action,exact:true}).click();await review.getByRole('alert').filter({hasText:'事项已变化'}).waitFor();});
 await temporarily(stateFile,JSON.stringify({...state,status:'unprocessed'}),async()=>{await regions().nth(1).getByRole('button',{name:pendingItem.action,exact:true}).click();await review.getByRole('alert').filter({hasText:'已处理或删除'}).waitFor();});
 evidence.checks.push({label:'Wiki changed/deleted and pending changed/removed reject stale navigation'});
 const promptFile=path.join(session.root,'prompts',fixtures.mainPromptId+'.json');const prompt=JSON.parse(await readFile(promptFile,'utf8'));
 const long=structuredClone(prompt);const note=long.feedback.items.find(x=>x.id===historical.id);note.observation='第一行观察\n第二行观察 '+('LONG'.repeat(180));note.nextImprovement='第一行建议\n第二行建议 '+('NEXT'.repeat(180));note.revision++;
 await temporarily(promptFile,JSON.stringify(long),async()=>{await load();const details=regions().nth(2).locator('details').filter({hasText:historical.id});await details.locator('summary').click();for(const width of [1440,1024]){await page.setViewportSize({width,height:1080});await capture(page,'02-long-feedback-'+width);const observed=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,whiteSpace:[...document.querySelectorAll('.period-review details p')].map(x=>getComputedStyle(x).whiteSpace)}));evidence.checks.push({label:'long feedback '+width,observed});}assert.ok((await details.innerText()).includes(note.observation));});
 // Continue source/error scenarios even if visual long-text evidence needs repair.
 for(const [name,file,invalid] of [['Wiki Frontmatter',wikiFile,'broken'],['Wiki identity',wikiFile,wikiBytes.replace(wikiItem.id,'00000000-0000-4000-8000-000000000000')],['Prompt JSON',promptFile,'{broken'],['feedback shape',promptFile,JSON.stringify({...prompt,feedback:{schemaVersion:1,items:'broken',deletedIds:[]}})],['pending raw-task',stateFile,'{broken']]){
  await temporarily(file,invalid,async()=>{const baseline=await businessSnapshot();const result=await load();if(name.startsWith('Wiki')){assert.equal(result.knowledge.status,'error');assert.equal(result.feedback.status,'ok');await regions().nth(0).getByRole('alert').waitFor();assert.ok(!(await regions().nth(0).innerText()).includes('正式记录 · 0'));}else if(name==='pending raw-task'){assert.equal(result.pending.sources['raw-task'].status,'error');assert.equal(result.knowledge.status,'ok');assert.equal(result.feedback.status,'ok');await regions().nth(1).getByRole('alert').waitFor();}else{assert.equal(result.feedback.status,'error');assert.equal(result.knowledge.status,'ok');await regions().nth(2).getByRole('alert').waitFor();}assert.deepEqual(await businessSnapshot(),baseline);evidence.checks.push({label:name+' error explicit/other sources readable/no repair write'});});
 }
 await load();await capture(page,'03-recovered-1024');
 const hidden=promptFile+'.independent-hidden';await rename(promptFile,hidden);try{const result=await load();assert.equal(result.feedback.items.length,0);await regions().nth(2).getByText('本周期没有使用反馈。',{exact:true}).waitFor();}finally{await rename(hidden,promptFile);}
 const changed=structuredClone(prompt);changed.feedback.items=changed.feedback.items.filter(x=>x.id!==historical.id);changed.feedback.deletedIds.push(historical.id);await temporarily(promptFile,JSON.stringify(changed),async()=>{const result=await load();assert.equal(result.feedback.items.length,1);assert.ok(!result.feedback.items.some(x=>x.id===historical.id));});
 await load();assert.deepEqual(await businessSnapshot(),before);assert.deepEqual(await api('/__control/counters'),counters);assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.mutations,[]);
 evidence.checks.push({label:'feedback refreshed deletion/Prompt removal; restored fixture bytes; Provider zero and no auto mutations'});
 evidence.success=true;console.log(JSON.stringify({success:true,checks:evidence.checks.length,result:path.join(output,'result.json')}));
}catch(error){evidence.failure={message:error.message,stack:error.stack};await capture(page,'failure-observation');throw error;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(evidence,null,2));await browser.close();}
