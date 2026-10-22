import fs from 'node:fs/promises';
const old='KB02-EDGE-AUDIT-20261022',now='KB02-FIELDS-AUDIT-20261022',base='tests/acceptance/';
const retarget=s=>s.replaceAll(old,now).replaceAll('146','163').replaceAll('147+i','164+i').replaceAll('54-attempts','37-attempts').replaceAll('173+','190+').replaceAll('KB02-EDGE-20261022-frozen.json','KB02-FIELDS-20261022-frozen.json');
for(const name of ['run','trace-hook','lab','real-http','browser-prepare','quality','update-check','final-evidence','local-safety','browser']){
 let s=retarget(await fs.readFile(base+old+'-'+name+'.mjs','utf8'));
 if(name==='run'){
  s=s.replace("targeted=['tests/kb02-edge-extraction.test.ts'","targeted=['tests/kb02-planning-fields.test.ts','tests/kb02-edge-extraction.test.ts'");
  s=s.replace('kb02-edge-audit-','kb02-fields-audit-');
  // Retargeting must not rewrite paths to the historical independent EDGE probe.
  s=s.replace("'tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs'","'tests/acceptance/KB02-EDGE-AUDIT-20261022-boundary.test.mjs'");
  s=s.replace("await run('node24-version'","await run('independent-fields-boundary',process.execPath,[...args,'tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs']);await run('node24-version'");
  s=s.replace('...frozen.acceptanceScripts};',"...frozen.acceptanceScripts,'tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs':sha(await fs.readFile('tests/acceptance/KB02-FIELDS-AUDIT-20261022-boundary.test.mjs'))};");
 }
 if(name==='lab')s=s.replace('fmcg-kb02-final-audit-real-','fmcg-kb02-fields-audit-real-');
 if(name==='real-http'){
  s="const permit=JSON.parse(await (await import('node:fs/promises')).readFile('docs/reports/"+now+"-authorization.json','utf8'));if(permit.realCallsApproved!==true)throw Error('Real phase not released');\n"+s;
  s=s.replace("checks=[],artifacts=", "checks=[],artifacts=");
  s=s.replace("const snapshot=dir=>", "if(process.argv[2]==='LONG'){assert(artifacts.shortMetricWiki?.body.includes('KB02_HUMAN'),'Browser-created target and human note required before LONG');}\nawait fs.writeFile(prefix+'phase-'+process.argv[2]+'.started.json',JSON.stringify({at:new Date().toISOString(),phase:process.argv[2]}),{flag:'wx'});\nconst snapshot=dir=>");
 }
 if(name==='browser-prepare'){
  s="const permit=JSON.parse(await (await import('node:fs/promises')).readFile('docs/reports/"+now+"-authorization.json','utf8'));if(permit.realCallsApproved!==true)throw Error('Supplement phase not released');\n"+s;
  s=s.replace("const snapshot=dir=>", "assert(artifacts.shortMetricWiki?.body.includes('KB02_HUMAN'),'Existing target and human note required');\nawait fs.writeFile(prefix+'phase-SUPPLEMENT.started.json',JSON.stringify({at:new Date().toISOString()}),{flag:'wx'});\nconst snapshot=dir=>");
 }
 if(name==='browser'){
  s="import {createHash} from 'node:crypto';\n"+s;
  s=s.replace("assert.equal((await read('authorization')).engineeringApproved,true);", "assert.equal((await read('authorization')).engineeringApproved,true);assert.equal((await read('authorization')).realCallsApproved,true);");
  s=s.replace('edge-browser-control.json','fields-browser-control.json');
  s=s.replace("const control=path.join", "await page.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return ['127.0.0.1','localhost'].includes(host)?route.continue():route.abort();});\nconst control=path.join");
  s=s.replace("assert.equal((await read('authorization')).realCallsApproved,true);await draft", "assert.equal((await read('authorization')).realCallsApproved,true);await fs.writeFile(p+'preview.started.json',JSON.stringify({at:new Date().toISOString()}),{flag:'wx'});await draft");
  s=s.replace("const flow=await read('browser-workflow');const pending=responseFor", "const flow=await read('browser-workflow'),review=await read('semantic-review');assert.equal(review.approved,true);assert.equal(review.workflowId,flow.id);assert.equal(review.sectionsSha256,createHash('sha256').update(JSON.stringify((await get('/api/knowledge/workflows/'+flow.id)).sections)).digest('hex'));const pending=responseFor");
  s=s.replace("await snap('short-created-readback');", "await snap('short-created-readback');const stable=await page.locator('.wiki-detail').innerText();await page.locator('button.wiki-list-item').filter({hasText:a.shortMetricWiki.title}).click();assert.equal(await page.locator('.wiki-detail').innerText(),stable);await snap('short-created-reclicked');");
 }
 if(name==='final-evidence'){
  s+=`\nconst updateTraces=traces.filter(t=>{try{return Boolean(JSON.parse(t.request.messages.find(m=>m.role==='user').content).existing);}catch{return false;}});assert.equal(updateTraces.length,1);const updateTrace=updateTraces[0],updateInput=JSON.parse(updateTrace.request.messages.find(m=>m.role==='user').content),updateOutput=JSON.parse(updateTrace.response.content);await fs.writeFile(prefix+'update-meaning-evidence.json',JSON.stringify({sequence:updateTrace.sequence,input:updateInput,output:updateOutput},null,2));\n`;
 }
 await fs.writeFile(base+now+'-'+name+'.mjs',s,{flag:'wx'});
}
console.log('Prepared gated engineering, budgeted real phases and real Chrome controls. No tests, services, browser or Provider executed.');
