import {createHash} from 'node:crypto';
// Independent, staged real Chrome UI validation. Never starts extraction or retries.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/entry.cjs');
const {chromium}=require('playwright');
const p='docs/reports/KB02-FIELDS-AUDIT-20261022-';
const read=async name=>JSON.parse(await fs.readFile(p+name+'.json','utf8'));
const save=(name,value)=>fs.writeFile(p+name+'.json',JSON.stringify(value,null,2));
const meta=await read('main-lab');
assert.equal((await read('authorization')).engineeringApproved,true);assert.equal((await read('authorization')).realCallsApproved,true);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
await page.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return ['127.0.0.1','localhost'].includes(host)?route.continue():route.abort();});
const control=path.join(meta.root,'fields-browser-control.json');await fs.writeFile(control,JSON.stringify({id:0,action:'inspect'}));
let last=-1;const requests=[];
page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))requests.push({method:r.method(),url:r.url(),body:r.postData()});});
const get=async url=>{const r=await fetch(meta.api+url);assert(r.ok);return r.json();};
async function snap(name){await page.screenshot({path:p+'browser-'+name+'.png'});const text=await page.locator('body').innerText();await save('browser-'+name,{at:new Date().toISOString(),url:page.url(),text,fields:await page.locator('input,textarea,select').evaluateAll(es=>es.map(e=>({tag:e.tagName,value:e.value,checked:e.checked})))});return text;}
async function draft(title){await page.goto(meta.url);await page.locator('button.nav-item').filter({hasText:'Raw 原始资料'}).click();await page.locator('button.raw-list-item').filter({hasText:title}).click();await page.getByRole('button',{name:'继续审核',exact:true}).click();await page.locator('article.draft-card').first().waitFor();}
async function wiki(item){await page.goto(meta.url);await page.locator('button.nav-item').filter({hasText:'知识库'}).click();await page.locator('button.wiki-list-item').filter({hasText:item.title}).click();await page.locator('.wiki-detail h2').filter({hasText:item.title}).waitFor();}
const responseFor=(ending,method='POST')=>page.waitForResponse(r=>r.url().endsWith(ending)&&r.request().method()===method,{timeout:150000});
try{await page.goto(meta.url);console.log(JSON.stringify({control,browser:'installed real Chrome',staged:true}));while(true){const cmd=JSON.parse(await fs.readFile(control,'utf8'));if(cmd.id===last){await new Promise(r=>setTimeout(r,250));continue;}last=cmd.id;const result={id:cmd.id,action:cmd.action,at:new Date().toISOString()};if(cmd.action==='close')break;
try{const record=await read('real-http'),a=record.artifacts;
if(cmd.action==='inspect')await snap('initial');
else if(cmd.action==='short-failure'){
 for(const suffix of ['initial','refreshed']){await page.goto(meta.url);await page.locator('button.nav-item').filter({hasText:'Raw 原始资料'}).click();await page.locator('button.raw-list-item').filter({hasText:'KB02虚构短文'}).click();await page.getByText('LLM_SCHEMA_INVALID',{exact:false}).first().waitFor();const text=await snap('short-failure-'+suffix);assert(text.includes('整篇主题规划未通过严格结构校验'));assert(!text.includes('确认写入 Wiki'));}result.noRetry=true;
}
else if(cmd.action==='short-review'){await draft('KB02虚构短文');await snap('short-review');}
else if(cmd.action==='short-confirm'){
 const index=a.shortDraft.pages.findIndex(x=>x.type==='metric');assert(index>=0);const card=page.locator('article.draft-card').nth(index);await card.locator('label.draft-select').filter({hasText:'写入'}).locator('input').check();await snap('short-selected');
 const pending=responseFor('/api/drafts/'+a.shortDraft.id+'/confirm');await page.getByRole('button',{name:'确认写入 Wiki（1）',exact:true}).click();const r=await pending;result.status=r.status();result.confirm=await r.json();assert.equal(result.status,201);assert.equal(result.confirm.wikiIds.length,1);a.shortMetricWiki=await get('/api/wiki/'+result.confirm.wikiIds[0]);await save('real-http',record);await save('browser-short-confirm',result);await wiki(a.shortMetricWiki);await snap('short-created-readback');const stable=await page.locator('.wiki-detail').innerText();await page.locator('button.wiki-list-item').filter({hasText:a.shortMetricWiki.title}).click();assert.equal(await page.locator('.wiki-detail').innerText(),stable);await snap('short-created-reclicked');
}else if(cmd.action==='human-note'){
 await wiki(a.shortMetricWiki);await page.getByRole('button',{name:'编辑',exact:true}).click();const field=page.locator('.wiki-body-field textarea'),body=await field.inputValue();assert(!body.includes('KB02_HUMAN'));await field.fill(body+'\n\n## 人工备注\nKB02_HUMAN 异常审批负责人需访谈确认，保留原口径。');const pending=responseFor('/api/wiki/'+a.shortMetricWiki.id,'PUT');await page.getByRole('button',{name:'保存 Wiki',exact:true}).click();assert.equal((await pending).status(),200);a.shortMetricWiki=await get('/api/wiki/'+a.shortMetricWiki.id);await save('real-http',record);await wiki(a.shortMetricWiki);await snap('short-human-note');
}else if(cmd.action==='long'){
 await draft('KB02十四区域中文长文虚构验收');const cards=page.locator('article.draft-card');assert.equal(await cards.count(),14);const all=[];for(let i=0;i<14;i++){const card=cards.nth(i);all.push({index:i,text:await card.innerText(),fields:await card.locator('input,textarea').evaluateAll(es=>es.map(e=>e.value))});if([5,6,13].includes(i)){await card.scrollIntoViewIfNeeded();await snap('long-region-'+(i+1));}}await save('browser-long-all-cards',all);await page.reload();await draft('KB02十四区域中文长文虚构验收');assert.equal(await cards.count(),14);await snap('long-refreshed');
}else if(cmd.action==='supplement-review'){await draft('KB02虚构铺货率复核');await snap('supplement-review');}
else if(cmd.action==='preview'){
 assert.equal((await read('authorization')).realCallsApproved,true);await fs.writeFile(p+'preview.started.json',JSON.stringify({at:new Date().toISOString()}),{flag:'wx'});await draft('KB02虚构铺货率复核');const card=page.locator('article.draft-card').nth(a.updateDraft.pages.findIndex(x=>x.type==='metric'));await card.getByRole('button',{name:'刷新重复候选',exact:true}).click();await card.locator('.duplicate-candidate').filter({hasText:a.shortMetricWiki.id}).getByRole('button',{name:'选择更新',exact:true}).click();await snap('update-target-selected');await save('before-browser-confirm',await get('/api/wiki/'+a.shortMetricWiki.id));const pending=responseFor('/api/knowledge/updates');await card.getByRole('button',{name:'生成旧 Wiki 更新预览',exact:true}).click();const r=await pending;result.status=r.status();assert.equal(r.status(),201);await save('browser-workflow',await r.json());await page.getByRole('heading',{name:'审阅更新建议'}).waitFor();await snap('update-preview');
}else if(cmd.action==='confirm'){
 const flow=await read('browser-workflow'),review=await read('semantic-review');assert.equal(review.approved,true);assert.equal(review.workflowId,flow.id);assert.equal(review.sectionsSha256,createHash('sha256').update(JSON.stringify((await get('/api/knowledge/workflows/'+flow.id)).sections)).digest('hex'));const pending=responseFor('/api/knowledge/workflows/'+flow.id+'/confirm');await page.getByRole('button',{name:'确认写入',exact:true}).click();const r=await pending;result.status=r.status();result.confirm=await r.json();result.confirmBody=r.request().postDataJSON();await save('browser-confirm',result);assert.equal(r.status(),201);await snap('update-confirmed');
}else if(cmd.action==='readback-reclick'){
 await page.reload();await wiki(a.shortMetricWiki);const panel=page.locator('.wiki-detail');for(const s of ['20%','30%','KB02_HUMAN'])assert((await panel.innerText()).includes(s));const before=await panel.innerText();await snap('update-refreshed');await page.locator('button.wiki-list-item').filter({hasText:a.shortMetricWiki.title}).click();assert.equal(await panel.innerText(),before);await snap('same-item-reclicked');result.sameItemPreserved=true;result.wiki=await get('/api/wiki/'+a.shortMetricWiki.id);
}else throw Error('Unknown command');result.ok=true;
}catch(e){result.ok=false;result.error=e.message;await snap('error-'+cmd.id);}await save('browser-result-'+cmd.id,result);await save('browser-last',result);console.log(JSON.stringify(result));}}
finally{await browser.close();await save('browser-closed',{at:new Date().toISOString(),closed:true,requests});console.log('Owned browser closed');}
