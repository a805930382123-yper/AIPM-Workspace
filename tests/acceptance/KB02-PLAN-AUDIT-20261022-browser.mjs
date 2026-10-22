import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/David.chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/entry.cjs');
const {chromium}=require('playwright');
const prefix='docs/reports/KB02-PLAN-AUDIT-20261022-',meta=JSON.parse(await fs.readFile(prefix+'main-lab.json','utf8'));
const artifacts=JSON.parse(await fs.readFile(prefix+'real-http.json','utf8')).artifacts;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const control=path.join(meta.root,'browser-control.json');await fs.writeFile(control,JSON.stringify({id:0,action:'inspect'}));
let last=-1,flow;
async function snapshot(name){await page.screenshot({path:prefix+'browser-'+name+'.png'});const text=await page.locator('body').innerText();const fields=await page.locator('input,textarea,select').evaluateAll(es=>es.map(e=>({tag:e.tagName,value:e.value})));await fs.writeFile(prefix+'browser-'+name+'.json',JSON.stringify({url:page.url(),text,fields},null,2));return text;}
async function openRaw(title){await page.goto(meta.url);await page.locator('button.nav-item').filter({hasText:'Raw 原始资料'}).click();await page.locator('button.raw-list-item').filter({hasText:title}).click();await page.getByRole('button',{name:'继续审核',exact:true}).click();await page.locator('article.draft-card').first().waitFor();}
try{
 await page.goto(meta.url);console.log(JSON.stringify({browser:'Chrome headless real browser',control}));
 while(true){const cmd=JSON.parse(await fs.readFile(control,'utf8'));if(cmd.id===last){await new Promise(r=>setTimeout(r,300));continue;}last=cmd.id;let result={id:cmd.id,action:cmd.action};
  try{
   if(cmd.action==='close')break;
   if(cmd.action==='long'){await openRaw('KB02十四区域中文长文虚构验收');result.cards=await page.locator('article.draft-card').count();await snapshot('long-draft');await page.locator('article.draft-card').last().scrollIntoViewIfNeeded();await snapshot('long-last-page');}
   else if(cmd.action==='preview'){
    await openRaw('KB02虚构铺货率复核');const index=artifacts.updateDraft.pages.findIndex(p=>p.type==='metric');const card=page.locator('article.draft-card').nth(index);await card.getByRole('button',{name:'刷新重复候选'}).click();
    const candidate=card.locator('.duplicate-candidate').filter({hasText:artifacts.shortMetricWiki.id});await candidate.getByRole('button',{name:'选择更新',exact:true}).click();
    const before=await(await fetch(meta.api+'/api/wiki/'+artifacts.shortMetricWiki.id)).json();await fs.writeFile(prefix+'before-browser-confirm.json',JSON.stringify(before,null,2));
    const response=page.waitForResponse(r=>r.url().endsWith('/api/knowledge/updates')&&r.request().method()==='POST',{timeout:90000});await card.getByRole('button',{name:'生成旧 Wiki 更新预览'}).click();const r=await response;flow=await r.json();result.status=r.status();result.workflowId=flow.id;await fs.writeFile(prefix+'browser-workflow.json',JSON.stringify(flow,null,2));
    await page.getByRole('heading',{name:'审阅更新建议'}).waitFor();await snapshot('update-preview');
   }else if(cmd.action==='confirm'){
    const response=page.waitForResponse(r=>r.url().includes('/api/knowledge/workflows/')&&r.url().endsWith('/confirm')&&r.request().method()==='POST');await page.getByRole('button',{name:'确认写入',exact:true}).click();const r=await response;result.status=r.status();result.confirm=await r.json();result.confirmBody=r.request().postDataJSON();result.workflowId=flow.id;await fs.writeFile(prefix+'browser-confirm.json',JSON.stringify(result,null,2));await page.reload();await page.getByRole('button',{name:/知识库/}).first().click();await snapshot('wiki-list');
   }else if(cmd.action==='open-wiki'){
    await page.getByText(artifacts.shortMetricWiki.title,{exact:true}).first().click();await snapshot('updated-wiki-readback');
   }else if(cmd.action==='inspect'){await snapshot('inspect');}
   result.ok=true;
  }catch(e){result.ok=false;result.error=e.message;await snapshot('error-'+cmd.id);}
  await fs.writeFile(prefix+'browser-last.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }
}finally{await browser.close();console.log('Owned browser closed');await fs.writeFile(prefix+'browser-closed.json',JSON.stringify({at:new Date().toISOString(),closed:true}));}
