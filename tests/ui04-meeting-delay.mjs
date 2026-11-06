import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
 const page=await browser.newPage({viewport:{width:1536,height:1000}});
 await page.route('**/api/meeting-catalog',async route=>{await new Promise(resolve=>setTimeout(resolve,1200));await route.continue()});
 await page.goto(process.argv[2]||'http://127.0.0.1:5174');
 await page.getByRole('button',{name:'新建会议'}).first().click();
 const dialog=page.getByRole('dialog'); await dialog.getByLabel('会议标题').fill('UI04 慢目录回归');
 const type=dialog.getByLabel('主类型'); await type.locator('option').nth(1).waitFor({state:'attached'});
 assert.equal(await type.inputValue(),''); assert.equal(await type.locator('option:checked').textContent(),'请选择会议类型');
 await dialog.getByRole('button',{name:'保存',exact:true}).click(); assert.equal(await type.evaluate(el=>el.validity.valueMissing),true);
 const selected=await type.locator('option').nth(1).getAttribute('value'); assert.match(selected,/^[0-9a-f-]{36}$/i); await type.selectOption(selected);
 await page.screenshot({path:'docs/reports/UI04-20261101-evidence/builder-meeting-create-after.png'});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/meetings')&&r.request().method()==='POST'); await dialog.getByRole('button',{name:'保存',exact:true}).click(); const result=await response;
 assert.equal(result.request().postDataJSON().meeting_type,selected); assert.equal(result.status(),201); await page.goto(process.argv[2]||'http://127.0.0.1:5174'); await page.getByRole('button',{name:'新建会议'}).first().click(); const uploadDialog=page.getByRole('dialog'); await uploadDialog.getByLabel('会议标题').fill('UI04 保存并上传'); const uploadType=uploadDialog.getByLabel('主类型'); await uploadType.locator('option').nth(1).waitFor({state:'attached'}); if(!(await uploadType.inputValue())) await uploadType.selectOption({index:1}); await uploadDialog.getByRole('button',{name:'保存并上传本地纪要'}).click(); await page.getByRole('heading',{name:'UI04 保存并上传'}).waitFor(); await page.waitForFunction(()=>document.querySelector('details.meeting-group')?.open===true); await page.screenshot({path:'docs/reports/UI04-20261101-evidence/builder-meeting-upload-after.png'}); console.log(JSON.stringify({status:result.status(),meeting_type:selected,uploadSectionOpen:true}));
} finally {await browser.close()}

