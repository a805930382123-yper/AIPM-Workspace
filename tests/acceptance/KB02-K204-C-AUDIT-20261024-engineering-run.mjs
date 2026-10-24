import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const P='docs/reports/KB02-K204-C-AUDIT-20261024-',stamp=new Date().toISOString().replace(/[:.]/g,'-'),sha=b=>createHash('sha256').update(b).digest('hex');
const freezeBytes=await fs.readFile('docs/reports/KB02-K204-C-20261024-freeze.json'),freeze=JSON.parse(freezeBytes);assert.equal(sha(freezeBytes),'1cc61bd3c7278f785e82b811d27e86e15dc01aae1058885fb5b0f10921e8a745');
for(const f of freeze.files)assert.equal(sha(await fs.readFile(f.path)),f.sha256,f.path);
// Redirect generated test manifests/exports/reports into auditor ownership only.
// The business root, frozen source, production methods and requests remain unchanged.
const open=fs.open,readFile=fs.readFile,redirects=new Map();
fs.open=(file,flags,...args)=>{const p=path.resolve(String(file));if(String(flags).startsWith('w')&&/^KB02-K204-C-20261024-(?:selftest-session-|selftest-|export-)/.test(path.basename(p))){const target=path.resolve(P+'independent-'+path.basename(p).slice('KB02-K204-C-20261024-'.length));redirects.set(p,target);return open(target,flags,...args);}return open(redirects.get(p)??file,flags,...args);};
fs.readFile=(file,...args)=>readFile(redirects.get(path.resolve(String(file)))??file,...args);
const report={stage:'engineering-run',pass:false,startedAt:new Date().toISOString(),node:process.version,freezeSha256:sha(freezeBytes),frozenPaths:freeze.files.length,newRealCalls:0};
try{
 const {selftest}=await import('./KB02-K204-C-20261024-selftest.mjs');const test=await selftest();assert.equal(test.pass,true);assert.equal(test.rows.length,15);assert.equal(test.normal.requests.length,15);assert.equal(test.normal.actualMaxConcurrency,1);assert.deepEqual(test.normal.checkpoint,{chunks:14,attempts:15});
 const root=test.normal.state.root,draft=JSON.parse(await readFile(path.join(root,'candidate-C.json'),'utf8')),body=test.normal.state.samples.C.body,units=draft.humanReview.units;
 const regions=[];for(const m of body.matchAll(/虚构区域\d{2}2026年9月/g)){const start=m.index,end=body.indexOf('\n',start),subject=m[0].slice(0,6);const relevant=units.filter(u=>{const match=/^[fq]u-(\d+)-(\d+)/.exec(u.id);assert(match,u.id);return +match[1]<end&&+match[2]>start;});assert(relevant.length);for(let pos=start;pos<end;pos++)assert(relevant.some(u=>{const [,a,b]=/^[fq]u-(\d+)-(\d+)/.exec(u.id);return +a<=pos&&+b>pos;}),subject+' uncovered Raw character '+pos);const text=relevant.flatMap(u=>u.records).map(r=>r.text).join('\n');for(const token of ['独立','不能混用','未知','未来'])assert(text.includes(token),subject+token);assert(!text.includes('排版'));assert.equal(new Set(relevant.map(u=>draft.humanReview.assignments[u.id])).size,1);regions.push({subject,start,end,coveredCharacters:end-start,unitIds:relevant.map(u=>u.id)});}
 assert.equal(regions.length,14);report.rawCoverage=regions;report.testRows=test.rows;report.fakeCalls=test.rows.reduce((n,r)=>n+(r.fakeCalls??0),0);assert.equal(report.fakeCalls,23);report.normalRoot=root;report.pass=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}finally{fs.open=open;fs.readFile=readFile;report.generatedEvidence=[...redirects].map(([original,actual])=>({original,actual}));report.postMismatches=[];for(const f of freeze.files)if(sha(await readFile(f.path))!==f.sha256)report.postMismatches.push(f.path);report.pass=report.pass&&!report.postMismatches.length;report.finishedAt=new Date().toISOString();await fs.writeFile(P+'execution-'+stamp+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pass:report.pass,groups:report.testRows?.length,regions:report.rawCoverage?.length,error:report.error,evidence:P+'execution-'+stamp+'.json'}));}
