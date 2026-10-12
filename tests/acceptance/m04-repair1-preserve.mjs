import fs from 'node:fs/promises';
const prefix='docs/reports/M04-repair1-20261012';
for(const suffix of ['http.json','component.json','deep.json','edges.json','api-regression.json','quality.json','tests.log','build.log','frozen.json','integrity.json'])await fs.copyFile(prefix+'-'+suffix,prefix+'-pre-extra-'+suffix);
let api=await fs.readFile('tests/acceptance/m04-repair1-api-regression.mjs','utf8');
api=api.replace("for(const route of ['raw-links'])assert.equal((await request(s,'/api/meetings/'+first.meeting_id+'/'+route,'POST',{text:'M01_PRIVATE_SENTINEL'})).status,404)","for(const route of ['raw-links']){const r=await request(s,'/api/meetings/'+first.meeting_id+'/'+route,'POST',{text:'M01_PRIVATE_SENTINEL'});assert.ok([400,403].includes(r.status));assert.ok(r.json?.error?.code);assert.ok(!r.text.includes('M01_PRIVATE_SENTINEL'));}");
api=api.replace('futureRoutesNotMounted:true','malformedRawRegistrationRefusedWithoutWrite:true');await fs.writeFile('tests/acceptance/m04-repair1-api-regression.mjs',api);
console.log('Pre-supplemental frozen evidence preserved; intentional M04 route availability reflected in root regression');
