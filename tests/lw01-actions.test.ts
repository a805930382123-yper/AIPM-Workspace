import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lwFixture } from './lw01-fixture.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { maintenanceDigest } from '../services/wiki/maintenance.ts';

test('LW01 explicit link adds source only; candidate title/alias collision cannot bypass old Wiki conflict gate', async () => {
  const f = await lwFixture(),
    a = await f.rawStore.create({
      title: 'A',
      sourceType: 'report',
      sourceName: '合成A',
      tags: [],
      body: '渠道指标定义为有效渠道数量。',
    });
  f.setTopics(['渠道指标定义']);
  const da = await f.accept(await f.generate(a.id)),
    first = await f.confirm(da),
    target = first.manifest.snapshot.pageRecords[0];
  const b = await f.rawStore.create({
    title: 'B',
    sourceType: 'report',
    sourceName: '合成B',
    tags: ['渠道指标定义'],
    body: '渠道指标定义为有效渠道数量。',
  });
  let db = await f.accept(await f.generate(b.id));
  assert.equal(db.maintenance!.changes[0].action, 'link');
  await f.confirm(db);
  const linked = (await f.wiki.get(target.id))!;
  assert.equal(linked.body, target.body);
  assert.equal(linked.revision, 2);
  assert.deepEqual(linked.sources, [a.id, b.id]);
  const collision = await f.wiki.create({
    ...linked,
    title: '另一个真实主题',
    aliases: ['真实主题别名'],
    sources: [a.id],
    body: '独立主题原文。',
  });
  const c = await f.rawStore.create({
    title: 'C',
    sourceType: 'report',
    sourceName: '合成C',
    tags: [],
    body: '新主题数据为20。',
  });
  f.setTopics(['独立新主题']);
  let d = await f.generate(c.id);
  d = await f.drafts.reviewChange(d.id, {
    baseRevision: d.revision,
    changeId: 'change-0',
    title: collision.aliases[0],
  });
  d = await f.accept(d);
  await assert.rejects(f.confirm(d), { code: 'WIKI_TITLE_CONFLICT' });
  assert.equal((await f.wiki.get(collision.id))!.body, collision.body);
});

for (const change of ['revision', 'privacy'] as const)
  test(`LW01 noop target ${change} still gates restart recovery even with no page write`, async () => {
    const f = await lwFixture(),
      a = await f.rawStore.create({
        title: 'A',
        sourceType: 'report',
        sourceName: '合成A',
        tags: ['渠道覆盖'],
        body: '渠道覆盖10家。',
      });
    await f.confirm(await f.accept(await f.generate(a.id)));
    const d = await f.accept(await f.generate(a.id, 'standard', true));
    assert.equal(d.maintenance!.changes[0].action, 'noop');
    const index = f.wiki.rebuildIndexLocked.bind(f.wiki);
    f.wiki.rebuildIndexLocked = async () => {
      throw Error('controlled index failure');
    };
    await assert.rejects(f.confirm(d));
    f.wiki.rebuildIndexLocked = index;
    const target = (await f.wiki.get(d.maintenance!.changes[0].targetWikiId!))!;
    const get = f.rawStore.get.bind(f.rawStore);
    if (change === 'revision')
      await f.wiki.update(target.id, target.revision, { ...target, body: target.body + '\n人工另改' });
    else
      f.rawStore.get = async (id) => {
        const r = await get(id);
        return id === a.id ? ({ ...r!, origin: { invalid: true } } as any) : r;
      };
    const service = new WikiCommitService({
        root: f.root,
        wikiStore: f.wiki,
        drafts: f.drafts,
        rawStates: f.rawStates,
        rawStore: f.rawStore,
      }),
      result = await service.reconcile();
    assert.equal(result.resumed.length, 0);
    assert.equal(
      result.conflicts[0].code,
      change === 'revision' ? 'WIKI_REVISION_CONFLICT' : 'MEETING_SOURCE_RESTRICTED',
    );
  });

test('LW01 maintenance failure resumes same ledger/context and restored source privacy is checked before resend', async () => {
  const f = await lwFixture(),
    a = await f.rawStore.create({
      title: 'A',
      sourceType: 'report',
      sourceName: '合成A',
      tags: ['渠道覆盖'],
      body: '渠道覆盖10家。',
    });
  await f.confirm(await f.accept(await f.generate(a.id)));
  const b = await f.rawStore.create({
    title: 'B',
    sourceType: 'report',
    sourceName: '合成B',
    tags: ['渠道覆盖'],
    body: '渠道覆盖20家。',
  });
  f.failOnce('maintenance');
  const start = await f.runner.start(b.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  await f.runner.waitForSettlement(start.job.id);
  assert.equal((await f.jobs.get(start.job.id))!.status, 'failed');
  const used = f.requests.length;
  const get = f.rawStore.get.bind(f.rawStore);
  f.rawStore.get = async (id) => {
    const r = await get(id);
    return id === a.id ? ({ ...r!, origin: { invalid: true } } as any) : r;
  };
  const retry = await f.runner.start(b.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  assert.equal(retry.job.id, start.job.id);
  await f.runner.waitForSettlement(start.job.id);
  assert.equal(f.requests.length, used);
  assert.equal((await f.jobs.get(start.job.id))!.error!.code, 'MEETING_SOURCE_RESTRICTED');
  f.rawStore.get = get;
  const draft = await f.generate(b.id);
  assert.equal(draft.jobId, start.job.id);
  assert(draft.maintenance!.context.some((p) => p.sources.includes(a.id)));
  assert.equal(f.requests.length, used + 1);
  assert(maintenanceDigest(draft));
});
