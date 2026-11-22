import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deepFixture } from './support/kb03-deep-fixture.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { deepLeaves, preserveDeepBoundaries, checkDeepNote } from '../services/llm/knowledge-deep.ts';
import { validStructuredNote } from '../services/wiki/structured-note.ts';
import { KB02_PROMPT_REVISION, FROZEN_BUDGETS } from '../services/llm/rules.ts';

const variants = [
  {
    notes: ['材料为多处摘录，未核对完整出处。', '叙述依赖的示意图未随资料提供。'],
    doubt: '交接对象记为“灯塔层”，所指未能辨清。',
  },
  {
    notes: ['此段系转载节选，原作者暂缺。', '文中引用附件表格，但本次只有文字。'],
    doubt: '补货记录的“树冠格”疑为转录，含义不能确认。',
  },
];
async function fixture(index = 0) {
  const data = variants[index],
    f = await deepFixture(['虚构甲渠道门店20家。', ...data.notes, data.doubt].join('\n'));
  const raw = await f.rawStore.create({
    title: '虚构边界资料',
    sourceType: 'report',
    sourceName: '隔离摘录',
    tags: ['虚构'],
    publishedAt: '2021-03-04',
    url: 'https://example.test/registered',
    body: f.raw.body,
  });
  let customize: ((stage: string, value: any, payload: any) => unknown) | undefined;
  f.mutate((stage, value, payload) => {
    if (stage === 'extracting') {
      const notes = payload.filter((a: any) => data.notes.some((text) => a.text.includes(text)));
      value.sourceNotes = notes.map((a: any) => ({ atomId: a.id }));
      value.facts = payload
        .filter((a: any) => !notes.some((n: any) => n.id === a.id))
        .map((a: any) => ({ atomId: a.id, kind: a.fragment || a.text.includes(data.doubt) ? 'ambiguous' : 'fact' }));
    }
    return customize ? customize(stage, value, payload) : value;
  });
  return {
    ...f,
    raw,
    data,
    start: () => f.http.request(`/api/raw/${raw.id}/extract`, { mode: 'deep' }),
    customize: (fn: typeof customize) => {
      customize = fn;
    },
  };
}

for (let index = 0; index < variants.length; index++)
  test(`R9 fake wire and visible note preserve source boundaries and ambiguous original ${index + 1} even when model omits them`, async () => {
    const f = await fixture(index);
    try {
      const started = await f.start(),
        runtime = await f.wait(started.json.jobId);
      assert.equal(runtime.job?.status, 'completed', JSON.stringify(runtime));
      assert.equal(f.requests.length, 6);
      const cp = (await new ExtractionCheckpointStore(f.root).get(started.json.jobId))!,
        draft = (await f.drafts.get(runtime.job!.draftId!))!,
        note = draft.structuredNote!;
      const sourceNotes = cp.completedChunks.flatMap((c) => c.sourceNotes ?? []),
        facts = cp.completedChunks.flatMap((c) => c.facts),
        leaves = deepLeaves(note);
      assert.equal(sourceNotes.length, 2);
      assert(!facts.some((fact) => sourceNotes.some((n) => n.atomId === fact.atomId)));
      assert.equal(facts.filter((fact) => fact.kind === 'ambiguous').length, 1);
      assert.notEqual(sourceNotes[0].text, sourceNotes[1].text);
      assert.deepEqual(
        sourceNotes[0].locatorIds,
        sourceNotes[1].locatorIds,
        'two distinct original sentences share one coarse locator',
      );
      for (const request of f.requests.filter((r) => r.system.startsWith('KB03 '))) {
        const p = JSON.parse(request.user);
        assert.deepEqual(p.sourceNotes, sourceNotes);
        assert.deepEqual(p.source, {
          id: f.raw.id,
          title: f.raw.title,
          sourceType: f.raw.sourceType,
          sourceName: f.raw.sourceName,
          publishedAt: f.raw.publishedAt,
          url: f.raw.url,
          tags: f.raw.tags,
        });
        assert.deepEqual(
          p.evidence,
          cp.completedChunks.flatMap((c) => c.evidence),
        );
        assert(request.system.includes('登记线索'));
        assert(request.system.includes('转录'));
      }
      const planning = JSON.parse(f.requests[1].user.split('\n').at(-1)!);
      assert(!('sourceNotes' in planning));
      assert.equal(planning.factUnits.length, facts.length);
      for (const item of [...sourceNotes, ...facts.filter((fact) => fact.kind === 'ambiguous')]) {
        const visible = leaves.filter(
          (leaf) =>
            leaf.role === 'needs_verification' && leaf.prose === item.text && leaf.reason?.includes(item.atomId!),
        );
        assert.equal(
          visible.length,
          1,
          JSON.stringify({ item, boundaries: leaves.filter((leaf) => leaf.role === 'needs_verification') }),
        );
        for (const locator of item.locatorIds) assert(visible[0].reason!.includes(locator));
        const evidence = cp.completedChunks[item.chunkIndex].evidence.filter((ref) => item.locatorIds.includes(ref.id));
        assert.deepEqual(visible[0].sourceBoundary, {
          rawId: f.raw.id,
          start: Math.min(...evidence.map((ref) => ref.start)),
          end: Math.max(...evidence.map((ref) => ref.end)),
          category: 'kind' in item ? 'ambiguous' : 'source_note',
        });
      }
      assert.deepEqual(preserveDeepBoundaries(note, cp.deep!.outline!, cp), note);
      checkDeepNote(note, cp.deep!.outline!, cp);
      assert(validStructuredNote(note, new Set(facts.map((f) => f.id))));
      const missing = structuredClone(note);
      missing.sections[0].blocks.pop();
      assert.throws(() => checkDeepNote(missing, cp.deep!.outline!, cp), { code: 'LLM_DEEP_BOUNDARY_MISSING' });
      const qualityRequest = f.requests.find((request) => request.system.startsWith('KB03 quality'));
      assert(qualityRequest);
      const quality = JSON.parse(qualityRequest.user);
      assert.deepEqual(quality.note, note);
      assert(qualityRequest.system.includes('不能只因引用/evidence含原句'));
      assert.match(draft.source.body, /登记日期：2021-03-04/);
      assert.match(draft.source.body, /登记链接：https:\/\/example\.test\/registered/);
      assert.match(draft.source.body, /作者：未提供（作者）/);
      assert.match(draft.source.body, /登记线索，未经外部核验/);
      assert(!draft.source.body.includes('原发布日期'));
      assert.equal((await f.rawStore.get(f.raw.id))!.body, f.raw.body);
      const replay = await f.start();
      assert.equal(replay.json.jobId, started.json.jobId);
      assert.equal(f.requests.length, 6);
      assert.equal(KB02_PROMPT_REVISION, 'kb02-atoms-planning-19');
      assert.equal(FROZEN_BUDGETS.totalDeadlineMs, 600000);
      assert.deepEqual(
        f.requests.map((r) => r.timeoutMs),
        [60000, 60000, 120000, 120000, 120000, 120000],
      );
      assert(f.requests[0].user.includes('疑似错字'));
      assert.equal(JSON.parse(f.requests.at(-1)!.user).stage, 'maintenance');
    } finally {
      await f.clean();
    }
  });

test('R9 excluded ambiguous fact still has visible exact pending-verification text without forging an included fact reference', async () => {
  const f = await fixture();
  f.customize((stage, value, payload) => {
    if (stage === 'outline') {
      const ambiguous = payload.facts.find((x: any) => x.kind === 'ambiguous');
      value.sections[0].factIds = value.sections[0].factIds.filter((id: string) => id !== ambiguous.id);
      value.excluded.push({ kind: 'fact', id: ambiguous.id, reason: '正文不采用未辨清的表述。' });
    }
    return value;
  });
  try {
    const started = await f.start(),
      runtime = await f.wait(started.json.jobId);
    assert.equal(runtime.job?.status, 'completed', JSON.stringify(runtime));
    const cp = (await new ExtractionCheckpointStore(f.root).get(started.json.jobId))!,
      doubt = cp.completedChunks.flatMap((c) => c.facts).find((f) => f.kind === 'ambiguous')!;
    const leaves = deepLeaves((await f.drafts.get(runtime.job!.draftId!))!.structuredNote!);
    const visible = leaves.find((l) => l.role === 'needs_verification' && l.prose === doubt.text)!;
    assert(visible);
    assert.deepEqual(visible.factIds, []);
    assert(visible.reason!.includes(doubt.id));
    assert.match(visible.reason!, /虽未纳入大纲正文/);
    assert.equal(f.requests.length, 6);
  } finally {
    await f.clean();
  }
});

test('R9 boundary capacity exhaustion fails explicitly without truncating or saving a partial note', async () => {
  const f = await fixture();
  f.customize((stage, value) => {
    if (stage === 'writing')
      while (value.sections[0].blocks.length < 128)
        value.sections[0].blocks.push(structuredClone(value.sections[0].blocks[0]));
    return value;
  });
  try {
    const start = await f.start(),
      runtime = await f.wait(start.json.jobId);
    assert.equal(runtime.job?.error?.code, 'LLM_DEEP_BOUNDARY_CAPACITY');
    assert.equal(f.requests.length, 4);
    assert.equal((await f.drafts.list()).length, 0);
    const cp = (await new ExtractionCheckpointStore(f.root).get(start.json.jobId))!;
    assert.equal(cp.deep!.note, undefined);
    assert.equal(cp.completedChunks[0].sourceNotes!.length, 2);
  } finally {
    await f.clean();
  }
});

test('R9 failed quality resumes the same persisted boundary note in a real new process without duplicate additions', async () => {
  const f = await fixture();
  f.customize((stage, value) => (stage === 'quality' ? '{bad-json' : value));
  try {
    const started = await f.start(),
      failed = await f.wait(started.json.jobId);
    assert.equal(failed.job?.status, 'failed');
    assert.equal(f.requests.length, 5);
    const before = (await new ExtractionCheckpointStore(f.root).get(started.json.jobId))!.deep!.note!;
    const support = pathToFileURL(path.resolve('tests/support/kb03-quality-runner.mjs')).href,
      reply = pathToFileURL(path.resolve('tests/support/kb03-deep-fixture.ts')).href;
    const maintenance = pathToFileURL(path.resolve('tests/support/compat01-maintenance-reply.ts')).href;
    const script = `import {stores,runnerFor} from ${JSON.stringify(support)};import {deepReply} from ${JSON.stringify(reply)};import {maintenanceReply} from ${JSON.stringify(maintenance)};const stages=[];const state=await stores(${JSON.stringify(f.root)});const provider={name:'fake',model:'budget-model',complete:async request=>{const stage=JSON.parse(request.user).stage;stages.push(stage);return {text:JSON.stringify(stage==='maintenance'?maintenanceReply(request.user):deepReply(request)),bytes:1,finishReason:'stop'};}};const runner=runnerFor(${JSON.stringify(f.root)},state,provider);await runner.reconcile();if(stages.length)throw Error('automatic call');const started=await runner.start(${JSON.stringify(f.raw.id)},{mode:'deep',newJobId:'d14bd9bf-19a0-4c46-b162-049033766179',now:new Date().toISOString()});await runner.waitForSettlement(started.job.id);const view=await runner.readJob(started.job.id);const draft=view.job?.draftId?await state.drafts.get(view.job.draftId):undefined;console.log(JSON.stringify({stages,job:view.job,note:draft?.structuredNote}));`;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--import', './tests/support/css-stub.mjs', '--input-type=module', '-e', script],
      { windowsHide: true, encoding: 'utf8' },
    );
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result.stages, ['quality', 'maintenance']);
    assert.equal(result.job.id, started.json.jobId);
    assert.equal(result.job.status, 'completed');
    assert.equal(result.job.callCount, 7);
    assert.deepEqual(result.note, before);
  } finally {
    await f.clean();
  }
});

test('R9 revision18 unfinished checkpoint rejects without outbound or checkpoint modification', async () => {
  const f = await fixture();
  f.customize((stage, value) => (stage === 'writing' ? '{bad-json' : value));
  try {
    const started = await f.start();
    await f.wait(started.json.jobId);
    const store = new ExtractionCheckpointStore(f.root),
      cp = (await store.get(started.json.jobId))!;
    await store.save({ ...cp, rulesVersion: cp.rulesVersion.replace(KB02_PROMPT_REVISION, 'kb02-atoms-planning-18') });
    const file = path.join(f.root, 'state/extraction-checkpoints', started.json.jobId + '.json'),
      bytes = await fs.readFile(file),
      used = f.requests.length;
    const rejected = await f.start();
    assert.equal(rejected.status, 409);
    assert.equal(rejected.json.error.code, 'LLM_CHECKPOINT_INCOMPATIBLE');
    assert.equal(f.requests.length, used);
    assert.deepEqual(await fs.readFile(file), bytes);
  } finally {
    await f.clean();
  }
});
