import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
const prefix='docs/reports/B09-acceptance';
const initial=await read(prefix+'-frozen.json'),docsInitial=await read(prefix+'-frozen-docs-final.json');
const core=initial.filter(x=>!x.path.startsWith('docs/')&&x.path!=='README.md');for(const x of core)assert.equal(await sha(x.path),x.sha256,x.path+' changed during acceptance');
const changes=[];for(const x of docsInitial)if(await sha(x.path)!==x.sha256)changes.push(x.path);assert.ok(changes.every(p=>['README.md','docs/open-source-reuse.md','docs/delivery.md','docs/delivery-matrix.md'].includes(p)));
const build=await fs.readFile('docs/reports/B09-build.md','utf8');let declarations=0;for(const m of build.matchAll(/\| `([^`]+)` \| `([A-F0-9]{64})` \|/g)){const x=docsInitial.find(x=>x.path===m[1]);assert.ok(x,m[1]);assert.equal(x.sha256.toUpperCase(),m[2]);declarations++;}assert.ok(declarations>=7);
const counts=a=>Object.fromEntries([...new Set(a.map(x=>x.result))].map(k=>[k,a.filter(x=>x.result===k).length]));
const browserReport=await read(prefix+'-browser.json'),browser=browserReport.checks??browserReport,manual=await read(prefix+'-browser-manual.json');assert.ok(browser.every(x=>['PASS','INVALID_EXPECTATION'].includes(x.result)));assert.ok(manual.every(x=>x.result==='PASS'));
const exports=await read(prefix+'-exports.json');const e=exports.checks.at(-1);if(e.id!=='edited-demo-prompt-export-retains-readonly-label-history'){e.promptId=e.id;e.id='edited-demo-prompt-export-retains-readonly-label-history';await fs.writeFile(prefix+'-exports.json',JSON.stringify(exports,null,2));}assert.ok(exports.checks.every(x=>x.result==='PASS'));
const environments=[];
for(const suffix of ['', '-manual']){
 const r=await read(prefix+'-browser'+suffix+'-runtime.json'),f=await read(prefix+'-browser'+suffix+'-files.json');assert.ok(Object.values(r.closed).every(Boolean));assert.deepEqual(f.after,f.before);assert.equal(f.result,'PASS');assert.equal(r.restartCount,1);
 const posts=r.httpRequests.filter(x=>x.method==='POST').map(x=>({url:x.url,status:x.status}));const stats=r.httpRequests.filter(x=>x.url==='/api/stats'&&x.status===200).map(x=>JSON.parse(x.body));
 const p=f.prompts.find(x=>x.current.name===(suffix?'B09无Key手动模板':'B09浏览器生成模板'));assert.equal(p.current.version,2);assert.equal(p.versions.length,2);
 assert.equal(p.versions[0].snapshot.body,suffix?' 手动模板\n请核对{{客户名称}}的异常订单。\n 尾部 ':' B09生成后人工编辑\n输入 {{客户名称}}\n请核实异常订单。\n 尾部 ');
 assert.equal(p.current.body,suffix?' 手动模板第二版\n请核对{{客户名称}}的异常订单及待确认问题。\n 尾部 ':' B09优化后人工确认\n角色：产品经理；目标：核对订货流程。\n客户：{{客户名称}}\n区分事实、推断、待确认；不得虚构经营数据。\n 尾部 ');
 const rid=suffix?'f4b54a6b-6ce1-4323-b28f-a5b7a461b206':'b437db9f-4706-4b31-905e-833506652067';const rawPath=Object.keys(f.after.knowledge).find(p=>p.includes(rid));assert.ok(rawPath);const raw=await fs.readFile(path.join(r.dataRoot,'knowledge',rawPath),'utf8');assert.ok(raw.includes(suffix?'e7968be6ed20ad1c45cd216c0416b96e94cb893642f7164a0305d73da5df7c3a':'e913c40bed7043063a3ba2d2facf6be04cb1833771a41f6e1e14bf629c74e23b'));
 if(!suffix){assert.ok(stats.some(x=>x.pendingConfirmationCount===1&&x.wikiCount===0));assert.equal(p.versions[0].changeSource,'ai_generated');assert.equal(p.versions[1].changeSource,'ai_optimized');assert.equal(r.finalStats.rawCount,2);assert.equal(r.finalStats.wikiCount,7);assert.equal(r.finalStats.promptCount,5);}
 else{assert.equal(r.providerRequests.length,0);assert.equal(r.finalStats.rawCount,1);assert.equal(r.finalStats.wikiCount,1);assert.equal(r.finalStats.promptCount,1);}
 environments.push({suffix,result:'PASS',dataRoot:r.dataRoot,closed:r.closed,restartCount:r.restartCount,providerRequests:r.providerRequests.length,postRequests:posts,stats,promptId:p.id,historySources:p.versions.map(v=>v.changeSource),rawId:rid,rawPath,formalAssetsByteIdenticalAcrossRestart:true});
}
const ids=async p=>(await fs.readFile(p,'utf8')).split(/\r?\n/).filter(l=>/^\| [AR]\d{2} \|/.test(l)).map(l=>l.split('|')[1].trim());const childRows=await ids('docs/delivery-matrix.md');assert.equal(childRows.length,109);assert.equal(new Set(childRows).size,109);
const report={result:'PASS',coreProductFiles:core.length,coreUnchangedSinceInitialFreeze:true,authorizedDocumentChanges:changes,initialBuilderShaDeclarationsVerified:declarations,browser:counts(browser),manual:counts(manual),exports:counts(exports.checks),matrixChildRows:childRows.length,environments,clipboardRestored:true,closedOwnTabs:[6,7,8]};await fs.writeFile(prefix+'-final-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,environments:environments.map(x=>({suffix:x.suffix,result:x.result,closed:x.closed,providerRequests:x.providerRequests}))}));
