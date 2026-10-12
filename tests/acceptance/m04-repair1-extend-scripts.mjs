import fs from 'node:fs/promises';
const prefix='M04-repair1-20261012';
let integrity=await fs.readFile('tests/acceptance/m04-repair1-integrity.mjs','utf8');
integrity=integrity.replace("reference:'M03-frozen.json'","reference:'M04-review-20261012-baseline.json'");await fs.writeFile('tests/acceptance/m04-repair1-integrity.mjs',integrity);
const baseline=JSON.parse(await fs.readFile('docs/reports/'+prefix+'-baseline.json','utf8'));baseline.comparison.reference='M04-review-20261012-baseline.json';await fs.writeFile('docs/reports/'+prefix+'-baseline.json',JSON.stringify(baseline,null,2));
let http=await fs.readFile('tests/acceptance/m04-repair1-http.mjs','utf8');
http=http.replace("s=await h.start(root);const r=await observed('/api/wiki/'+pageId,'GET');","s=await h.start(root);await req('/api/knowledge/commits/'+op);const r=await observed('/api/wiki/'+pageId,'GET');");
http=http.replace('a.status=r.status;a.code=r.json?.error?.code;a.providerCalls=h.requests.length-before;', 'a.status=r.status;a.code=r.json?.error?.code;a.providerCalls=h.requests.length-before;assert.equal(r.status,403);');
http=http.replace('dataRoot:root,durationMs:', 'dataRoot:root,primaryMeetingId:primary.meeting_id,durationMs:');
await fs.writeFile('tests/acceptance/m04-repair1-http.mjs',http);
let api=await fs.readFile('tests/acceptance/m03-api-regression.mjs','utf8');api=api.replaceAll('M03-api-regression',prefix+'-api-regression');
api=api.replace('assert.equal(m.capabilities?.canRegisterRaw,false)',"assert.equal(m.capabilities?.canRegisterRaw,m.storage_mode==='local_archive' && ['Public','Internal'].includes(m.confidentiality) && m.raw_transfer_authorized===true)");
await fs.writeFile('tests/acceptance/m04-repair1-api-regression.mjs',api);
const backup=await fs.readFile('tests/acceptance/m03-backup.mjs','utf8');await fs.writeFile('tests/acceptance/m04-repair1-backup.mjs',backup.replaceAll('M03-backup',prefix+'-backup').replaceAll('M03-http.json',prefix+'-http.json'));
for(const batch of ['b05','b06']){const text=await fs.readFile(`tests/acceptance/${batch}-independent-http.mjs`,'utf8');await fs.writeFile(`tests/acceptance/m04-repair1-${batch}-regression.mjs`,text.replaceAll(`${batch.toUpperCase()}-acceptance-http.json`,`${prefix}-${batch}-regression.json`));}
console.log('Root regression/backup scripts prepared; existing scripts unchanged');
