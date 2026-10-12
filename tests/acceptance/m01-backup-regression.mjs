import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createHarness,expect,fileSnapshot,rawInput,wikiInput} from './b08-harness.mjs';
import {reply,input,brief} from './b08-fixtures.mjs';
const prefix='docs/reports/M01-backup-regression';
const h=await createHarness(reply),base=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-b09-backup-')),checks=[];let s,archive,snapshot;
const run=async(id,fn)=>{try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',message:String(e),stack:e.stack});}await fs.writeFile(prefix+'.json',JSON.stringify({base,dataRoot:h.dataRoot,checks},null,2));};
const cli=(...args)=>new Promise(resolve=>{const p=spawn(process.execPath,['--import','tsx','scripts/backup_workspace.ts',...args],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('exit',code=>resolve({code,stdout,stderr}));});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const record=(p,b=Buffer.from('fixture'))=>({path:p,size:b.length,sha256:sha(b),base64:b.toString('base64')});
try{
 s=await h.start();await expect(s,'/api/demo/import','POST',{confirm:true});
 const r=await expect(s,'/api/raw','POST',rawInput('备份','备份原文 BIN_B09'),201);await expect(s,'/api/wiki','POST',wikiInput('备份知识',[r.id],'来源可靠性仍需核验'),201);
 const p=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('备份Prompt','原版 {{姓名}}')},201);await expect(s,`/api/prompts/${p.prompt.id}`,'PUT',{...input('备份Prompt','第二版 {{姓名}}'),baseVersion:1});await expect(s,`/api/prompts/${p.prompt.id}`,'DELETE',{baseVersion:2});await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[]},201);
 // Explicit opaque assets/state exercise byte-complete preservation, not parsability claims.
 for(const [f,b] of [['knowledge/raw/assets/binary-fixture.bin',Buffer.from([0,255,254,13,10,128,33])],['state/b09-backup-fixture.bin',Buffer.from('状态\0文件')],['drafts/b09-opaque.txt',Buffer.from('未确认草稿')]]){const a=path.join(h.dataRoot,f);await fs.mkdir(path.dirname(a),{recursive:true});await fs.writeFile(a,b);}
 await fs.writeFile(path.join(h.dataRoot,'.env.local'),'TEST_FIXTURE_SECRET_DO_NOT_BACKUP');await fs.writeFile(path.join(h.dataRoot,'source-code.ts'),'excluded');await h.stop(s);
 await run('E09-04-complete-byte-export-and-empty-root-restore',async()=>{
  const before=await fileSnapshot(h.dataRoot),output=path.join(base,'backup.json');const e=await cli('export','--data-root',h.dataRoot,'--output',output);assert.equal(e.code,0,e.stderr);assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  archive=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(archive.format,'fmcg-workspace-backup');assert.equal(archive.version,1);assert.ok(archive.files.length>10);assert.ok(archive.files.every(f=>/^(knowledge|prompts|drafts|state|meetings)\//.test(f.path)));
  snapshot=Object.fromEntries(Object.entries(before).filter(([p])=>/^(knowledge|prompts|drafts|state|meetings)[\\/]/.test(p)));
  assert.deepEqual(archive.files.map(f=>f.path.replaceAll('/',path.sep)).sort(),Object.keys(snapshot).sort());
  for(const f of archive.files){assert.equal(f.sha256,snapshot[f.path.replaceAll('/',path.sep)]);assert.equal(Buffer.from(f.base64,'base64').length,f.size);}
  const target=path.join(base,'restored');const v=await cli('restore','--input',output,'--data-root',target);assert.equal(v.code,0,v.stderr);assert.deepEqual(await fileSnapshot(target),snapshot);
  const restored=await h.start(target,false);const c=await expect(restored,'/api/stats');assert.equal(c.rawCount,2);assert.equal(c.wikiCount,6);assert.equal(c.promptCount,4);assert.equal((await expect(restored,`/api/raw/${r.id}`)).body,r.body);const recycled=JSON.parse(await fs.readFile(path.join(target,'prompts','recycle',p.prompt.id+'.json'),'utf8'));assert.equal(recycled.versions.length,2);assert.equal(recycled.versions[0].snapshot.body,'原版 {{姓名}}');assert.equal(recycled.current.body,'第二版 {{姓名}}');assert.equal((await expect(restored,'/api/demo')).imported,true);await h.stop(restored);
  return {export:e,restore:v,files:archive.files.length,target,counts:c};
 });
 await run('E09-05-malformed-archives-no-target-write',async()=>{
  assert.ok(archive);const cases=[['traversal',{...record('../escape')}],['absolute',record('/tmp/escape')],['drive',record('C:/escape')],['backslash',record('knowledge\\raw\\escape')],['duplicate',null],['case-alias',null],['ads',record('state/file:secret')],['reserved',record('state/CON.json')],['trailing-dot',record('state/file.')],['trailing-space',record('state/file ')],['hash',{...record('state/x'),sha256:'0'.repeat(64)}],['base64',{...record('state/x'),base64:'%%%'}],['size',{...record('state/x'),size:999}],['oversize',{...record('state/x'),size:64*1024*1024+1}],['outside',record('config/key')],['version',null],['format',null],['file-count',null]];const results=[];
  for(const [name,file] of cases){const a={...archive,files:file?[file]:[record('state/x')]};if(name==='duplicate')a.files.push({...a.files[0]});if(name==='case-alias')a.files.push({...a.files[0],path:'state/X'});if(name==='version')a.version=99;if(name==='format')a.format='unknown';if(name==='file-count')a.files=Array.from({length:20001},(_,i)=>record('state/'+i));const src=path.join(base,name+'.json'),target=path.join(base,'bad-'+name);await fs.writeFile(src,JSON.stringify(a));const v=await cli('restore','--input',src,'--data-root',target);assert.notEqual(v.code,0,name);assert.deepEqual(await fileSnapshot(target),{});assert.equal(await fs.stat(path.join(base,'escape')).then(()=>true,()=>false),false);results.push({name,...v});}
  return results;
 });
 await run('E09-05-nonempty-containment-and-symlink',async()=>{
  const target=path.join(base,'nonempty');await fs.mkdir(target);await fs.writeFile(path.join(target,'user.txt'),'preserve');const old=await fileSnapshot(target);assert.notEqual((await cli('restore','--input',path.join(base,'backup.json'),'--data-root',target)).code,0);assert.deepEqual(await fileSnapshot(target),old);
  const before=await fileSnapshot(h.dataRoot);assert.notEqual((await cli('export','--data-root',h.dataRoot,'--output',path.join(h.dataRoot,'state','self.json'))).code,0);assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  const missing=await cli('export','--data-root',path.join(base,'nonexistent-source'),'--output',path.join(base,'nonexistent-backup.json'));assert.notEqual(missing.code,0);assert.equal(await fs.access(path.join(base,'nonexistent-backup.json')).then(()=>true,()=>false),false);
  const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.txt'),'do not read');await fs.symlink(outside,path.join(h.dataRoot,'state','junction'),'junction');const output=path.join(base,'symlink.json');const e=await cli('export','--data-root',h.dataRoot,'--output',output);assert.notEqual(e.code,0);assert.equal(await fs.stat(output).then(()=>true,()=>false),false);await fs.rm(path.join(h.dataRoot,'state','junction'));assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  const junctionRoot=path.join(base,'junction-root');await fs.mkdir(junctionRoot);await fs.symlink(outside,path.join(junctionRoot,'knowledge'),'junction');const top=await cli('export','--data-root',junctionRoot,'--output',path.join(base,'top-junction.json'));assert.notEqual(top.code,0);return {nonemptyPreserved:true,containmentRejected:true,symlink:e,whitelistRootSymlink:top};
 });
}finally{await h.close();}
if(checks.some(c=>c.result==='FAIL'))process.exitCode=1;
