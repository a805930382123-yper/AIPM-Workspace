import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {createHarness,expect,request,fileSnapshot} from './b09-harness.mjs';
const out={checks:[]};const manual=JSON.parse(await fs.readFile('docs/reports/B09-acceptance-browser-manual-runtime.json','utf8'));
const ms={base:manual.api},mw=await expect(ms,'/api/wiki'),mp=await expect(ms,'/api/prompts');
for(const [kind,id] of [['wiki',mw.items[0].id],['prompts',mp.items[0].id]]){
 const before=await fileSnapshot(manual.dataRoot),r=await request(ms,`/api/${kind}/${id}/export`);assert.equal(r.status,200);assert.ok(r.text.includes(kind==='wiki'?'B09无Key手动异常订单':'B09无Key手动模板'));assert.ok(r.text.includes(kind==='wiki'?'客户先核对库存':'手动模板第二版'));assert.deepEqual(await fileSnapshot(manual.dataRoot),before);
 await fs.writeFile(`docs/reports/B09-acceptance-manual-${kind}-export.md`,r.text);out.checks.push({id:'no-key-public-export-'+kind,result:'PASS',idValue:id,readOnly:true});
}
const h=await createHarness(()=>{throw Error('No Provider request allowed');});let s;
try{
 s=await h.start(h.dataRoot,false);await expect(s,'/api/demo/import','POST',{confirm:true});const d=await expect(s,'/api/demo');const id=d.items.find(i=>i.type==='prompt').id;const p=(await expect(s,`/api/prompts/${id}`)).prompt;
 const input=Object.fromEntries(['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'].map(k=>[k,p[k]]));
 const edited=(await expect(s,`/api/prompts/${id}`,'PUT',{...input,body:'用户完全改写模板 {{客户名称}}',baseVersion:1})).prompt;assert.equal(edited.isDemo,true);assert.equal(edited.body,'用户完全改写模板 {{客户名称}}');
 const before=await fileSnapshot(h.dataRoot),r=await request(s,`/api/prompts/${id}/export`);assert.equal(r.status,200);assert.ok(r.text.includes('演示数据'));assert.ok(r.text.includes(edited.body));assert.deepEqual(await fileSnapshot(h.dataRoot),before);const versions=await expect(s,`/api/prompts/${id}/versions`);assert.equal(versions.items.length,2);assert.ok(versions.items.every(v=>v.snapshot.isDemo===true));
 await fs.writeFile('docs/reports/B09-acceptance-edited-demo-prompt-export.md',r.text);out.checks.push({id:'edited-demo-prompt-export-retains-readonly-label-history',result:'PASS',dataRoot:h.dataRoot,promptId:id,version:2});
}finally{await h.close();out.closed=true;await fs.writeFile('docs/reports/B09-acceptance-exports.json',JSON.stringify(out,null,2));}
console.log(out);
