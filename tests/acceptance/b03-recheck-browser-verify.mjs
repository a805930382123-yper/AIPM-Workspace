import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=process.cwd(), base='http://127.0.0.1:4325';
const json=async file=>JSON.parse((await readFile(path.join(root,file),'utf8')).replace(/^\ufeff/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const get=async url=>{const r=await fetch(base+url);assert.equal(r.status,200);return r.json();};
const report={executedAt:new Date().toISOString(),checks:[]};
async function check(id,run){try{const evidence=await run();report.checks.push({id,status:'PASS',evidence});console.log('PASS '+id);}catch(e){report.checks.push({id,status:'FAIL',error:String(e.stack)});process.exitCode=1;console.log('FAIL '+id+' '+e.message);}}
const before=await json('docs/reports/B03-recheck-browser-before-recovery.json');
const after={raw:await get('/api/raw'),assets:await get('/api/raw/assets'),stats:await get('/api/stats')};
await check('persisted-reimport-tags-and-old-raw',async()=>{
 const [original,copy,edited]=['B03复验-原始双标签','B03复验-双标签重导入','B03复验-编辑多分隔标签'].map(title=>after.raw.items.find(x=>x.title===title));
 assert.deepEqual(original.tags,['渠道','库存']);assert.deepEqual(copy.tags,['渠道','库存']);assert.deepEqual(edited.tags,['渠道','库存','动销','SKU']);
 assert.notEqual(original.id,copy.id);assert.notEqual(copy.id,edited.id);
 assert.equal(original.body,'  原始标签复验正文\n保持原文。\n');assert.equal(original.bodySha256,sha(original.body));
 return {original,copy,edited};
});
await check('oversize-no-persisted-side-effects',async()=>{
 const a=await json('docs/reports/B03-recheck-browser-before-oversize.json'),b=await json('docs/reports/B03-recheck-browser-after-oversize.json');assert.deepEqual(a,b);assert.equal(a.stats.rawCount,6);return {rawCount:6,assets:a.assets.items.length,unchanged:true};
});
await check('browser-delete-persisted-and-original-retained',async()=>{
 const response=await fetch(base+'/api/raw/b94e5c23-77ad-4b71-b30e-6c6db6078a73');assert.equal(response.status,404);
 const asset=after.assets.items.find(x=>x.id==='cb5e5a08-3d4f-4b36-96a1-7b9f7db9e378');assert.equal(asset.status,'detached');
 const source=await readFile(path.join(root,'tests/fixtures/b03/zh-notes.txt'));
 const retained=await readFile(path.join(root,'docs/reports/fixtures/B03-recheck-browser-20261005/knowledge/raw/assets',asset.storedFile));assert.deepEqual(retained,source);return {status:response.status,asset};
});
await check('real-browser-partial-submit-recovered-no-duplicate',async()=>{
 const fault=await json('docs/reports/B03-recheck-browser-fault.json');assert.equal(fault.record.status,'stored');
 // PowerShell Invoke-RestMethod serializes ISO timestamps ending .380Z as .38Z.
 // Normalize that transport representation only; compare all other fields exactly.
 const normalizeDates=list=>({items:list.items.map(raw=>({...raw,importedAt:new Date(raw.importedAt).toISOString()}))});
 assert.deepEqual(normalizeDates(after.raw),normalizeDates(before.raw));assert.deepEqual(after.stats,before.stats);assert.equal(after.stats.rawCount,7);
 const raw=after.raw.items.find(x=>x.title==='B03复验-真实部分提交'),asset=after.assets.items.find(x=>x.id===raw.assetId);
 assert.equal(asset.status,'parsed');assert.equal(asset.rawId,raw.id);assert.equal(asset.parser,raw.extractionParser);assert.equal(asset.extractionNote,raw.extractionNote);assert.equal(asset.format,raw.assetFormat);
 const source=await readFile(path.join(root,'tests/fixtures/b03/zh-report.pdf'));
 const retained=await readFile(path.join(root,'docs/reports/fixtures/B03-recheck-browser-20261005/knowledge/raw/assets',asset.storedFile));assert.deepEqual(retained,source);assert.equal(asset.sha256,sha(source));return {raw,asset,rawUnchanged:true,count:7};
});
await check('product-frozen-through-browser-recheck',async()=>{
 const version=(await json('docs/reports/B03-recheck-http-2026-10-05T10-44-46.439Z.json')).version;
 for(const [file,hash]of Object.entries(version))assert.equal(sha(await readFile(path.join(root,file))),hash,file);return {files:Object.keys(version).length,unchanged:true};
});
report.after=after;
await writeFile(path.join(root,'docs/reports/B03-recheck-browser-persistence.json'),JSON.stringify(report,null,2));
