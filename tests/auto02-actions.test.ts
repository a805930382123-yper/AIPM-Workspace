import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { registerHomeRoutes } from '../server/home-api.ts';
import { registerB04Routes } from '../server/llm-api.ts';
import type { RawDraftView } from '../app/api.ts';
import type { HomeAction } from '../services/home/actions.ts';
import { LLMService } from '../services/llm/service.ts';
import { lwFixture } from './lw01-fixture.ts';

async function fixture(t: TestContext) {
  const f = await lwFixture();
  const raw = await f.rawStore.create({title:'AUTO02 合成渠道资料',body:'渠道覆盖20家。\n\n渠道回访30份。',sourceType:'report',sourceName:'测试合成',tags:[]});
  f.setTopics(['渠道覆盖','渠道回访']);
  const app = express();
  app.use(express.json());
  registerHomeRoutes(app,{root:f.root,raws:f.rawStore,wiki:f.wiki,runner:f.runner});
  registerB04Routes(app,{root:f.root,rulesDir:'rules',provider:()=>f.provider,llm:new LLMService('rules'),runner:f.runner,
    jobs:f.jobs,drafts:f.drafts,commits:f.commits,rawStates:f.rawStates,rawStore:f.rawStore,wikiStore:f.wiki});
  app.use(((error,_req,res,_next) => {
    res.status(error.status??500).json({error:{code:error.code,message:error.message,details:error.details}});
  }) as express.ErrorRequestHandler);
  const server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(base+route,body===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,json:await response.json()};
  };
  const list = async () => (await request('/api/home/actions')).json as {items: HomeAction[]; sources: Record<string,{status:string}>};
  const open = (item: HomeAction) => request(`/api/home/actions/${item.kind}/${item.id}?versionToken=${item.versionToken}`);
  const draftFile = (id: string) => path.join(f.root,'drafts',`${id}.json`);
  const view = async (id: string) => {
    const result = await request(`/api/drafts/${id}`);
    assert.equal(result.status,200,JSON.stringify(result.json));
    return result.json as RawDraftView;
  };
  const defer = (draft: RawDraftView, deferred: boolean) => request(`/api/drafts/${draft.id}/defer`,{baseRevision:draft.revision,deferred});
  return {...f,raw,request,list,open,draftFile,view,defer};
}

test('AUTO02 首页一项贯穿运行、恢复及待审，保留其他旧草稿并拒绝坏关联', async t => {
  const f = await fixture(t);
  const original = f.provider.complete;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release=resolve;});
  f.provider.complete = async input => {await gate;return original(input);};
  const {job} = await f.runner.start(f.raw.id,{newJobId:randomUUID(),now:new Date().toISOString()});
  let running: HomeAction;
  try {
    const list = await f.list();
    assert.equal(list.items.length,1);
    [running] = list.items;
    assert.equal(running.status,'running');
    assert.equal(running.target.jobId,job.id);
    assert.equal((await f.open(running)).status,200);
  } finally {release();}
  await f.runner.waitForSettlement(job.id);
  const completed = (await f.jobs.get(job.id))!;
  const draft = (await f.drafts.get(completed.draftId!))!;
  const old = {...draft,id:randomUUID(),jobId:randomUUID(),rawTitle:'另一个旧待审草稿'};
  await writeFile(f.draftFile(old.id),JSON.stringify(old));
  let list = await f.list();
  assert.deepEqual(new Set(list.items.map(item => item.target.draftId)),new Set([draft.id,old.id]));
  assert.equal((await f.open(running)).status,410);
  assert.equal((await f.open(list.items.find(item => item.id === old.id)!)).status,200);
  await f.jobs.update(job.id,{status:'running',draftId:undefined});
  list = await f.list();
  assert.equal(list.items.length,2);
  const recovery = list.items.find(item => item.status === 'recovery')!;
  assert.equal(recovery.target.jobId,job.id);
  assert.ok(!list.items.some(item => item.target.draftId === draft.id));
  assert.equal((await f.open(recovery)).status,200);
  await f.jobs.update(job.id,{status:'completed',draftId:draft.id});
  await f.rawStates.set(f.raw.id,{status:'pending_confirmation',reason:'模拟错配',draftId:old.id});
  list = await f.list();
  assert.equal(list.sources.draft.status,'error');
  assert.equal(list.sources.audit.status,'ok');
  assert.equal((await f.open({ ...running,kind:'draft',id:old.id })).status,503);
  await f.rawStates.set(f.raw.id,{status:'pending_confirmation',reason:'恢复合成状态',draftId:draft.id});
  await rm(f.draftFile(draft.id));
  assert.equal((await f.list()).sources.draft.status,'error');
});

test('AUTO02 暂缓仅修订草稿状态，陈旧请求和未恢复确认被拒', async t => {
  const f = await fixture(t);
  const original = await f.generate(f.raw.id);
  const start = await f.view(original.id);
  const card = (await f.list()).items[0];
  const beforeCalls = f.requests.length;
  const beforeRawState = await f.rawStates.get(f.raw.id);
  const beforeJob = await f.jobs.get(original.jobId);
  const changes = await Promise.all([f.defer(start,true),f.defer(start,true)]);
  assert.deepEqual(changes.map(result => result.status).sort(),[200,409]);
  const paused = await f.view(original.id);
  assert.ok(paused.deferredAt);
  assert.equal(paused.revision,start.revision+1);
  assert.deepEqual(paused.maintenance,start.maintenance);
  const bytes = await readFile(f.draftFile(start.id));
  assert.equal((await f.defer(paused,true)).status,200);
  assert.deepEqual(await readFile(f.draftFile(start.id)),bytes);
  assert.equal((await f.open(card)).status,409);
  const deferredCard = (await f.list()).items[0];
  assert.equal(deferredCard.status,'deferred');
  assert.equal(deferredCard.target.draftId,start.id);
  assert.equal((await f.open(deferredCard)).status,200);
  assert.deepEqual(await readFile(f.draftFile(start.id)),bytes);
  const confirm = await f.request(`/api/drafts/${start.id}/confirm`,{baseRevision:paused.revision,selectedPageIds:[paused.pages[0].pageId],outcomeDigest:paused.outcomeDigest,idempotencyKey:randomUUID()});
  assert.equal(confirm.status,409);
  assert.equal(confirm.json.error.code,'DRAFT_DEFERRED');
  assert.equal((await f.commits.list()).length,0);
  assert.equal((await f.defer(paused,false)).status,200);
  const resumed = await f.view(start.id);
  assert.equal(resumed.deferredAt,undefined);
  assert.deepEqual(resumed.maintenance,start.maintenance);
  assert.deepEqual(await f.rawStates.get(f.raw.id),beforeRawState);
  assert.deepEqual(await f.jobs.get(original.jobId),beforeJob);
  assert.equal(f.requests.length,beforeCalls);
  assert.equal((await f.list()).items[0].status,'review');
  assert.equal((await f.request(`/api/drafts/${start.id}/finish`,{baseRevision:resumed.revision})).json.status,'discarded');
  assert.equal((await f.list()).items.length,0);
  assert.equal((await f.view(start.id)).deferredAt,undefined);
});

test('AUTO02 草稿已保存但 Raw 状态写入失败时只显示恢复入口', async t => {
  const f = await fixture(t);
  const writeState = f.rawStates.set.bind(f.rawStates);
  f.rawStates.set = (id,next) => next.status === 'pending_confirmation'
    ? Promise.reject(Object.assign(new Error('合成 Raw 状态写入故障'),{code:'EIO'})) : writeState(id,next);
  const {job} = await f.runner.start(f.raw.id,{newJobId:randomUUID(),now:new Date().toISOString()});
  await f.runner.waitForSettlement(job.id);
  f.rawStates.set = writeState;
  const [draft] = await f.drafts.list();
  assert.ok(draft);
  assert.equal((await f.jobs.get(job.id))?.draftId,undefined);
  assert.equal((await f.rawStates.get(f.raw.id)).draftId,undefined);
  const {items} = await f.list();
  assert.deepEqual(items.map(item => [item.status,item.target.jobId]),[['recovery',job.id]]);
  const reconciled = await f.request(`/api/extraction-jobs/${job.id}/reconcile-storage`,{});
  assert.equal(reconciled.status,200,JSON.stringify(reconciled.json));
  assert.deepEqual((await f.list()).items.map(item => [item.status,item.target.draftId]),[['review',draft.id]]);
});

test('AUTO02 未登记到草稿的冻结事务仍阻止暂缓，并从原提交继续', async t => {
  const f = await fixture(t);
  const draft = await f.generate(f.raw.id);
  const current = await f.view(draft.id);
  const payload = {baseRevision:current.revision,selectedPageIds:[current.pages[0].pageId],outcomeDigest:current.outcomeDigest,idempotencyKey:randomUUID()};
  const original = f.drafts.prepareReviewedCommit;
  f.drafts.prepareReviewedCommit = async (...args) => {
    await args[5]();
    throw Object.assign(new Error('合成草稿状态写入故障'),{code:'EIO'});
  };
  const failed = await f.request(`/api/drafts/${draft.id}/confirm`,payload);
  f.drafts.prepareReviewedCommit = original;
  assert.equal(failed.status,500);
  const operationId = failed.json.error.details.operationId;
  const snapshot = await f.view(draft.id);
  assert.equal(snapshot.commitOperationId,undefined);
  assert.equal(snapshot.pendingCommitOperationId,operationId);
  assert.equal((await f.list()).items[0].status,'commit-recovery');
  const pause = await f.defer(snapshot,true);
  assert.equal(pause.status,409);
  assert.equal(pause.json.error.code,'COMMIT_RECOVERY_REQUIRED');
  assert.equal((await f.request(`/api/drafts/${draft.id}/finish`,{baseRevision:snapshot.revision})).status,409);
  const retry = await f.request(`/api/drafts/${draft.id}/confirm`,payload);
  assert.equal(retry.status,201);
  assert.equal(retry.json.operationId,operationId);
  assert.equal(retry.json.reused,true);
  assert.equal((await f.list()).items[0].status,'partial');
  const partial = await f.view(draft.id);
  assert.equal((await f.defer(partial,true)).status,200);
  assert.equal((await f.view(draft.id)).commitOperationId,operationId);
  assert.equal((await f.request(`/api/drafts/${draft.id}/confirm`,payload)).json.operationId,operationId);
});
