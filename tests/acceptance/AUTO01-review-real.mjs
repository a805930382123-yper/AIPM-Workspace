import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {approvedAuto01Provider} from './AUTO01-review-meter.mjs';
import {LEDGER,REPO,entries,durable,sha,freeze,json,open} from '../support/lw-real-runner.mjs';
import {generateMaintenance,reprepareMaintenance} from '../../services/llm/knowledge-maintenance.ts';

// Directed semantic test: split a previously extracted topic, not a full runner run.
const original=path.join(os.tmpdir(),'lw-real-Llj8LI');
const manifest=await json(path.join(original,'manifest.json'));
const oldRelease=await json(path.join(original,'release-approved.json'));
const correction=process.argv.includes('--correct-proxy');
const rows=await entries(LEDGER);assert.equal(rows.length,correction?9:8);
if(correction)assert(process.env.NODE_OPTIONS?.includes('--use-env-proxy'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'auto01-review-real-'));
await fs.cp(path.join(original,'data'),path.join(root,'data'),{recursive:true});
const {f}=await open(root);
const draft=await f.drafts.get('4c21ece6-9618-4afa-aced-890983ba0846');
const raw=await f.rawStore.get(manifest.rawIds.B);
assert.equal(sha(raw.body),manifest.inputShas.B);
const old=draft.maintenance.context.find(p=>p.id===manifest.targetWikiId);
assert(old);assert.equal(old.revision,1);
const topic=draft.pages[0];
const pages=[{...topic,pageId:randomUUID(),source_facts:topic.source_facts.slice(0,2)},
 {...topic,pageId:randomUUID(),source_facts:topic.source_facts.slice(2)}];
const next=await f.wiki.create({...old,title:'星桥区域直营网点年度观察',body:old.body+'\n人工补充：新目标独有备注必须保留。'});
const frozen=await freeze();
for(const file of ['tests/acceptance/AUTO01-review-meter.mjs','tests/acceptance/AUTO01-review-real.mjs'])frozen.files.push([file,sha(await fs.readFile(path.join(REPO,file)))]);
const release={approved:true,task:'AUTO01',ledger:LEDGER,limit:12,maxCalls:2,originalSession:manifest.session,originalFreeze:manifest.freeze,files:frozen.files,expectedModel:oldRelease.expectedModel,expectedEndpointSha:oldRelease.expectedEndpointSha,configFile:oldRelease.configFile,authorization:'2026-11-06 用户与主线程授权 AUTO01 第一阶段独验：原账本最多追加一次归并及一次必要目标重准备，失败即停，无自动重试。',sample:'既有合法提取主题人工拆分两个输入；定向构造，并非完整 runner。',root};
if(correction)Object.assign(release,{maxCalls:1,correctsAttempt:9,previousReleaseSha:rows[8].auto01ReleaseSha,authorization:'2026-11-06 主线程明确批准修复验收工具漏走既有代理入口后单次纠正请求attempt10；保留09失败，取消目标重准备，总计最多10/12，失败即停。'});
const releaseFile=path.join(root,'release.json');await durable(releaseFile,release);
await durable(path.join(root,'input.json'),{raw,pages,old,next});
console.log(JSON.stringify({root,ledgerBefore:rows.length,releaseSha:sha(await fs.readFile(releaseFile))}));
const provider=await approvedAuto01Provider(releaseFile,sha(await fs.readFile(releaseFile)));
let checkpoint={maintenance:{version:1,protocol:2,context:[old]}};
const controller=new AbortController();
const proposal=await generateMaintenance({raw,provider,signal:controller.signal,checkpoint,beforeCall:async()=>checkpoint,saveCheckpoint:async value=>{checkpoint=value;}},{document:draft.document,pages});
await durable(path.join(root,'grouped.json'),proposal);
assert.equal(proposal.changes.length,1);assert.deepEqual(proposal.changes[0].pageIndexes,[0,1]);
assert.equal(proposal.changes[0].targetWikiId,old.id);
assert.deepEqual(new Set(proposal.changes[0].candidate.sources),new Set([manifest.rawIds.A,manifest.rawIds.B]));
if(correction){await durable(path.join(root,'result.json'),{callsAfter:(await entries(LEDGER)).length,grouped:true,reprepared:false,fullRunner:false,formalCommit:false,correctedToolProxy:true});console.log(JSON.stringify({ok:true,root,callsAfter:(await entries(LEDGER)).length}));}else{
const prepared=await reprepareMaintenance(provider,controller.signal,raw,draft,pages,{action:'update',target:next});
await durable(path.join(root,'reprepared.json'),prepared);
assert.equal(prepared.targetWikiId,next.id);
assert(prepared.candidate.body.includes('新目标独有备注必须保留'));
assert.deepEqual(new Set(prepared.candidate.sources),new Set([manifest.rawIds.A,manifest.rawIds.B]));
await durable(path.join(root,'result.json'),{callsAfter:(await entries(LEDGER)).length,grouped:true,reprepared:true,fullRunner:false,formalCommit:false});
console.log(JSON.stringify({ok:true,root,callsAfter:(await entries(LEDGER)).length}));

}

