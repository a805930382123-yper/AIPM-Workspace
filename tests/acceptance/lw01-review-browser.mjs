import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=createRequire(import.meta.url)('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const session=JSON.parse(await readFile(process.argv[2],'utf8'));
const out='docs/reports/LW01-20261101-evidence';await mkdir(out,{recursive:true});
const log={session,checks:[],errors:[],success:false};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1536,height:1080}});page.setDefaultTimeout(20000);page.on('pageerror',e=>log.errors.push(e.message));
async function api(p,method='GET',body){const r=await fetch(session.api+p,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function shot(name){await page.screenshot({path:`${out}/review-${name}.png`,fullPage:true});}
async function sha(){const files={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else files[path.relative(session.root,p)]=createHash('sha256').update(await readFile(p)).digest('hex');}}await walk(path.join(session.root,'knowledge'));return files;}
async function reviewAction(action){const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/changes/review'));await action();const r=await response;assert(r.ok(),await r.text());await page.waitForFunction(()=>document.querySelector('.draft-page')?.getAttribute('aria-busy')==='false');}
async function approve(id){const card=page.locator('#'+id);await reviewAction(()=>card.getByRole('button',{name:'接受此项',exact:true}).click());await reviewAction(()=>card.getByRole('checkbox').click());await page.waitForFunction(id=>document.querySelector('#'+id+' input')?.checked,id);}
async function generate(rawId,mode,topics){await api('/__control/topics','POST',{topics});await page.locator('.nav-item').filter({hasText:'Raw'}).click();const raw=await api('/api/raw/'+rawId);await page.locator('.raw-list-item').filter({hasText:raw.title}).click();await page.getByLabel('整理模式',{exact:true}).selectOption(mode);await page.getByRole('button',{name:'AI 整理知识',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.draft-page h1')?.textContent==='审核知识变更'||[...document.querySelectorAll('button')].some(b=>b.textContent==='继续审核'));if(await page.getByRole('button',{name:'继续审核',exact:true}).count())await page.getByRole('button',{name:'继续审核',exact:true}).click();await page.getByRole('heading',{name:'审核知识变更',exact:true}).waitFor();}
async function confirm(){const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/confirm'));await page.getByRole('button',{name:/确认写入 Wiki/}).click();const r=await pending;assert(r.ok(),await r.text());return r.json();}
try{
 await page.goto(session.url);await page.locator('.home-entry-grid').waitFor();
 for(const mode of ['standard','deep']){
  const f=session.fixtures[mode];await generate(f.a,mode,[f.theme]);await approve('change-0');await confirm();
  let target=(await api('/api/wiki')).items.find(p=>p.title===f.theme);target=await api('/api/wiki/'+target.id);
  await api('/api/wiki/'+target.id,'PUT',{...target,baseRevision:target.revision,body:target.body+'\n\n人工保留说明：覆盖数据由渠道负责人复核。'});
  const before=await sha();await generate(f.b,mode,[f.theme,mode+'门店回访']);assert.deepEqual(await sha(),before);
  const card=page.locator('#change-0');await approve('change-0');await card.getByRole('button',{name:'编辑候选正文'}).click();
  const area=card.locator('textarea'),original=await area.inputValue();assert(original.includes('120'));assert(original.includes('90'));
  await area.fill(original.replace('人工保留说明：覆盖数据由渠道负责人复核。','')+'\n独验编辑：待确认口径。');
  await reviewAction(()=>card.getByRole('button',{name:'保存编辑并重新审核'}).click());await page.waitForFunction(()=>!document.querySelector('#change-0 input[type=checkbox]')?.checked);
  assert(await page.getByRole('button',{name:/确认写入 Wiki/}).isDisabled());
  const diff=card.locator('details').filter({hasText:'新旧正文差异'});assert((await diff.innerText()).includes('人工保留说明'));await shot(mode+'-removed-line-visible');
  await card.getByRole('button',{name:'编辑候选正文'}).click();await card.locator('textarea').fill(original+'\n独验编辑：待确认口径。');await reviewAction(()=>card.getByRole('button',{name:'保存编辑并重新审核'}).click());await reviewAction(()=>card.getByRole('checkbox').click());
  await approve('change-1');await reviewAction(()=>page.locator('#change-1').getByRole('button',{name:'暂缓此项'}).click());assert.deepEqual(await sha(),before);await shot(mode+'-approved-deferred');
  const committed=await confirm(),updated=await api('/api/wiki/'+target.id);
  assert.equal(updated.revision,3);assert.deepEqual(updated.sources,[f.a,f.b]);for(const word of ['100','120','90','2025','2026','有效门店','签约门店','人工保留说明'])assert(updated.body.includes(word),word);
  assert(!(await api('/api/wiki')).items.some(p=>p.title===mode+'门店回访'));
  await page.locator('.nav-item').filter({hasText:'知识库'}).click();await page.locator('.wiki-list-item').filter({hasText:f.theme}).first().click();await page.getByText('人工保留说明：覆盖数据由渠道负责人复核。',{exact:true}).waitFor();await shot(mode+'-formal');
  const files=await sha();assert(Object.keys(files).some(p=>p.includes(target.id)));log.checks.push({mode,committed,target:updated,before,after:files});
 }
 assert.deepEqual(log.errors,[]);log.success=true;
}catch(e){log.failure={message:e.message,stack:e.stack};await shot('failure');throw e;}finally{await writeFile(`${out}/review-browser.json`,JSON.stringify(log,null,2));await browser.close();}
