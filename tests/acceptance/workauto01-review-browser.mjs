import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { build,preview } from 'vite';
import { startReviewServer } from './workauto01-review-winrt.mjs';
import { businessHashes } from './workauto01-review-fixture.mjs';

const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
try {
  for(const [width,height] of [[1440,900],[390,844]]){
    const ctx=await startReviewServer();console.log('Evidence',ctx.run);
    let ui,page;
    const report={node:process.version,browser:browser.version(),width,height,screens:[],errors:[],analysisPosts:[]};
    try {
      const before=await businessHashes(ctx.data);
      const initial=await ctx.json('/reminders?status=all');
      await ctx.json('/reminders/settings','PATCH',{revision:initial.revision,desktopNotificationsEnabled:false});
      await ctx.scan();
      const outDir=path.join(ctx.run,'dist');
      await build({configFile:false,envDir:ctx.envDir,plugins:[react()],build:{outDir}});
      ui=await preview({configFile:false,envDir:ctx.envDir,build:{outDir},preview:{host:'127.0.0.1',port:ctx.uiPort,strictPort:true,proxy:{'/api':ctx.api}}});
      page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce',isMobile:width===390});
      page.setDefaultTimeout(10000);
      page.on('pageerror',error=>report.errors.push(error.message));
      page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
      page.on('request',r=>{if(r.method()==='POST'&&/analysis|analy[sz]e/.test(new URL(r.url()).pathname))report.analysisPosts.push(new URL(r.url()).pathname);});
      const nav=async title=>page.locator('.nav-item').filter({hasText:title}).first().click();
      const shot=async name=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');const file=name+'-'+width+'.png';await page.screenshot({path:path.join(ctx.run,file)});report.screens.push(file);};
      const btn=(root,name)=>root.getByRole('button',{name});
      await page.goto(ctx.base);
      const home=page.locator('section').filter({has:page.getByRole('heading',{name:/到期跟进/})}).last();
      await home.getByText(/新资料待分析/).first().waitFor();
      await home.getByText(/久未推进/).first().waitFor();await shot('home');
      await nav('自动化');
      const panel=page.getByRole('region',{name:/事项提醒/});
      await panel.waitFor();
      const row=title=>panel.locator('article,li,tr').filter({hasText:title}).last();
      for(const name of ctx.names)await row(name).waitFor();
      await shot('reminders');
      await btn(row(ctx.names[0]),/已读/).click();
      await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/snooze')),btn(row(ctx.names[1]),/延后/).click()]);
      const state=await ctx.json('/reminders?status=all');
      assert.equal(state.items.find(x=>x.itemTitle===ctx.names[0]).status,'acknowledged');
      assert.equal(state.items.find(x=>x.itemTitle===ctx.names[1]).status,'snoozed');
      await panel.getByText('提醒与通知设置',{exact:true}).click();
      const times=panel.locator('input[type=time]');await times.nth(0).fill('23:00');await times.nth(1).fill('06:00');
      await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/reminders/settings')),btn(panel,/保存/).click()]);await shot('settings');
      const saved=await ctx.json('/reminders?status=all');assert.equal(saved.settings.quietHoursStart,'23:00');assert.equal(saved.settings.quietHoursEnd,'06:00');
      await btn(row(ctx.names[2]),/打开事项/).click();
      await page.getByRole('heading',{name:ctx.names[2]}).waitFor();await nav('自动化');
      await btn(row(ctx.names[3]),/前往分析/).click();
      const target=page.getByText('合成候选资料',{exact:true}).last();await target.waitFor();
      const checked=await page.locator('input[type=checkbox]:checked').count();assert.equal(checked,0);
      report.focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.trim().slice(0,100)}));
      assert.equal(report.focus.text,'本轮资料');
      await shot('analysis');
      assert.deepEqual(report.errors,[]);assert.deepEqual(report.analysisPosts,[]);assert.equal(await readFile(ctx.wire,'utf8'),'');
      assert.deepEqual(await businessHashes(ctx.data),before);report.businessUnchanged=true;
    } finally {
      await writeFile(path.join(ctx.run,'browser-result.json'),JSON.stringify(report,null,2));
      await page?.close();if(ui) await new Promise(r=>ui.httpServer.close(r));await ctx.stop();
    }
  }
} finally {await browser.close();}
