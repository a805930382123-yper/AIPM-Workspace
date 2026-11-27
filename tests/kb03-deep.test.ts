import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { deepFixture } from './support/kb03-deep-fixture.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

for (const body of [undefined, '背景'.repeat(4200) + '目标100家，在售20家。'])
  test(`KB03 HTTP full deep chain ${body ? 'multi' : 'single'} N+5 (maintenance included) persists unreviewed five-block note`, async (t) => {
    const f = await deepFixture(body);
    try {
      const response = await f.start();
      assert.equal(response.status, 202, JSON.stringify(response.json));
      const id = response.json.jobId;
      const runtime = await f.wait(id);
      assert.equal(runtime.job?.status, 'completed', JSON.stringify(runtime));
      const cp = (await new ExtractionCheckpointStore(f.root).get(id))!;
      assert.equal(f.requests.length, cp.chunks.length + 5);
      assert.equal(cp.attempts, f.requests.length);
      assert.equal(cp.mode, 'deep');
      t.diagnostic(
        JSON.stringify({
          chunks: cp.chunks.length,
          requests: f.requests.length,
          attempts: cp.attempts,
          formula: 'N+5 (maintenance included)',
        }),
      );
      assert.equal(runtime.job?.checkpoint?.deepStage, 'ready');
      const d = await f.http.request(`/api/drafts/${runtime.job!.draftId}`);
      assert.equal(d.status, 200);
      assert(d.json.structuredNote);
      assert.equal(d.json.qualityReport.model, 'passed');
      assert.equal(d.json.extractionMode, 'deep');
      assert(d.json.pages.every((p: any) => !p.selected));
      assert.equal(d.json.humanReview.approvals.length, 0);
      assert.equal((await f.rawStore.get(f.raw.id))!.body, f.raw.body);
      const commit = await f.http.request(`/api/drafts/${d.json.id}/confirm`, {
        baseRevision: d.json.revision,
        selectedPageIds: [d.json.pages[0].pageId],
        idempotencyKey: 'blocked',
      });
      assert.equal(commit.status, 409);
      assert.equal(commit.json.error.code, 'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE');
      const patch = await fetch(f.http.base + `/api/drafts/${d.json.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: d.json.revision, qualityReport: { model: 'passed' } }),
      });
      assert.equal(patch.status, 400);
    } finally {
      await f.clean();
    }
  });
const cases: [string, string, (stage: string, v: any, p: any) => any][] = [
  [
    'outline omission',
    'LLM_DEEP_OUTLINE_INVALID',
    (s, v) => {
      if (s === 'outline') v.sections[0].factIds.pop();
      return v;
    },
  ],
  [
    'outline duplicate',
    'LLM_DEEP_OUTLINE_INVALID',
    (s, v) => {
      if (s === 'outline') v.sections[0].factIds.push(v.sections[0].factIds[0]);
      return v;
    },
  ],
  [
    'outline unknown',
    'LLM_DEEP_OUTLINE_INVALID',
    (s, v) => {
      if (s === 'outline') v.sections[0].factIds.push('fake');
      return v;
    },
  ],
  ['invalid JSON', 'LLM_INVALID_JSON', (s, v) => (s === 'outline' ? '{bad' : v)],
  [
    'writing unknown ref',
    'LLM_DEEP_WRITING_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks[0].factIds = ['fake'];
      return v;
    },
  ],
  [
    'writing omitted included',
    'LLM_DEEP_WRITING_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks.pop();
      if (s === 'writing')
        v.sections[0].blocks = v.sections[0].blocks
          .filter((b: any) => b.type !== 'paragraph')
          .map((b: any) => {
            if (b.type === 'list') b.items[0].factIds = [v.sections[0].blocks[0].factIds[0]];
            return b;
          });
      return v;
    },
  ],
  [
    '100 to 120',
    'LLM_DEEP_NUMERIC_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks[0].text = '目标120家。';
      return v;
    },
  ],
  [
    '20% to 30%',
    'LLM_DEEP_NUMERIC_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks[0].text = '铺货率30%。';
      return v;
    },
  ],
  [
    'unit change',
    'LLM_DEEP_NUMERIC_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks[0].text = '目标100元。';
      return v;
    },
  ],
  [
    'supplement data',
    'LLM_DEEP_SUPPLEMENT_INVALID',
    (s, v) => {
      if (s === 'writing') v.sections[0].blocks.find((b: any) => b.type === 'list').items[1].text = '增长30%。';
      return v;
    },
  ],
  [
    'supplement ratio',
    'LLM_DEEP_SUPPLEMENT_INVALID',
    (s, v) => {
      if (s === 'writing')
        v.sections[0].blocks.push(
          ...Array(10).fill({ type: 'paragraph', role: 'supplementary', factIds: [], text: '补充概念。' }),
        );
      return v;
    },
  ],
  [
    'quality invalid',
    'LLM_DEEP_QUALITY_INVALID',
    (s, v) => (s === 'quality' ? { version: 1, findings: [{ approved: true }] } : v),
  ],
];
for (const [name, code, mutate] of cases)
  test(`KB03 deep rejects ${name} without successful draft`, async () => {
    const f = await deepFixture();
    f.mutate(mutate);
    try {
      const r = await f.start(),
        runtime = await f.wait(r.json.jobId);
      assert.equal(runtime.job?.status, 'failed', JSON.stringify(runtime));
      assert.equal(runtime.job?.error?.code, code);
      assert.equal((await f.drafts.list()).length, 0);
    } finally {
      await f.clean();
    }
  });
test('KB03 model warning remains read-only report; body unchanged', async () => {
  const f = await deepFixture();
  let body = '';
  f.mutate((s, v, p) => {
    if (s === 'quality') {
      body = JSON.stringify(p.note);
      v.findings = [
        { severity: 'error', category: 'semantic', sectionId: 'core', blockIndex: 0, reason: '仍需人工核对主体条件。' },
      ];
    }
    return v;
  });
  try {
    const r = await f.start(),
      runtime = await f.wait(r.json.jobId),
      d = (await f.drafts.get(runtime.job!.draftId!))!;
    assert.equal(d.qualityReport?.model, 'warning');
    assert.equal(JSON.stringify(d.structuredNote), body);
  } finally {
    await f.clean();
  }
});
for (const stage of ['extracting', 'planning', 'outline', 'writing', 'quality'])
  test(`KB03 explicit recovery retries failed ${stage} only, preserving attempt ledger`, async () => {
    const f = await deepFixture();
    let failed = false;
    f.hook(async (s) => {
      if (s === stage && !failed) {
        failed = true;
        throw Error('isolated provider failure');
      }
    });
    try {
      const r = await f.start(),
        first = await f.wait(r.json.jobId);
      assert.equal(first.job?.status, 'failed', JSON.stringify(first));
      const used = f.requests.length;
      const r2 = await f.start();
      assert.equal(r2.json.jobId, r.json.jobId);
      const final = await f.wait(r.json.jobId);
      assert.equal(final.job?.status, 'completed', JSON.stringify(final));
      assert.equal(f.requests.length, 7);
      assert.equal(final.job.callCount, 7);
      assert(f.requests.length > used);
    } finally {
      await f.clean();
    }
  });
test('KB03 double click/cross-mode occupancy, cancellation late response produces no draft', async () => {
  const f = await deepFixture();
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => (entered = r)),
    hold = new Promise<void>((r) => (release = r));
  f.hook(async () => {
    entered();
    await hold;
  });
  try {
    const first = await f.start();
    await barrier;
    const second = await f.start();
    assert.equal(second.json.jobId, first.json.jobId);
    assert(second.json.reused);
    const other = await f.start('standard');
    assert.equal(other.status, 200);
    assert.equal(other.json.jobId, first.json.jobId);
    assert.equal(other.json.mode, 'deep');
    assert(other.json.reused);
    await f.http.request(`/api/extraction-jobs/${first.json.jobId}/cancel`, {});
    release();
    const final = await f.wait(first.json.jobId);
    assert.equal(final.job?.status, 'cancelled');
    assert.equal(f.requests.length, 1);
    assert.equal((await f.drafts.list()).length, 0);
  } finally {
    release?.();
    await f.clean();
  }
});
test('KB03 30001 rejected before outbound; 30000 accepted; no provider/invalid modes fail', async () => {
  const f = await deepFixture('中'.repeat(30001));
  try {
    assert.equal((await f.start()).status, 413);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.start('unknown')).status, 400);
    assert.equal((await f.start('deep', { planningRetry: true })).status, 400);
  } finally {
    await f.clean();
  }
  const exact = await deepFixture('中'.repeat(30000));
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  exact.hook(async () => hold);
  try {
    const r = await exact.start();
    assert.equal(r.status, 202);
    await exact.http.request(`/api/extraction-jobs/${r.json.jobId}/cancel`, {});
    release();
    await exact.wait(r.json.jobId);
  } finally {
    release?.();
    await exact.clean();
  }
  const absent = await deepFixture();
  absent.setConfigured(false);
  try {
    assert.equal((await absent.start()).status, 400);
    assert.equal(absent.requests.length, 0);
  } finally {
    await absent.clean();
  }
});
test('KB03 regressed attempt count and mode/input/rule mismatches reject without outbound; corrupt checkpoint retained', async () => {
  const f = await deepFixture();
  f.hook(async () => {
    throw Error('stop');
  });
  try {
    const r = await f.start();
    await f.wait(r.json.jobId);
    const store = new ExtractionCheckpointStore(f.root),
      cp = (await store.get(r.json.jobId))!,
      used = f.requests.length;
    for (const patch of [
      { taskFingerprint: 'b'.repeat(64) },
      { rawSha256: 'a'.repeat(64) },
      { rulesVersion: 'changed' },
      { attempts: 0 },
    ]) {
      await store.save({
        ...cp,
        ...patch,
        ...('rawSha256' in patch
          ? { deep: { ...cp.deep!, scan: { ...cp.deep!.scan, rawSha256: patch.rawSha256! } } }
          : {}),
      });
      const result = await f.start();
      assert.equal(result.status, 409, JSON.stringify(result));
      assert.equal(f.requests.length, used);
    }
    await store.save(cp);
    assert.equal((await f.start('standard')).status, 409);
    const file = path.join(f.root, 'state/extraction-checkpoints', r.json.jobId + '.json');
    await writeFile(file, '{bad');
    assert.equal((await f.start()).status, 409);
    assert.equal(await readFile(file, 'utf8'), '{bad');
  } finally {
    await f.clean();
  }
});

for (const [mode, legacy] of [
  ['standard', false],
  ['deep', false],
  ['deep', true],
] as const)
  test(`3-2 ${mode} resumes from ${legacy ? 'legacy' : 'attributed'} checkpoints and records actual completed models`, async () => {
    const f = await deepFixture();
    const store = new ExtractionCheckpointStore(f.root);
    const stopAt = mode === 'deep' ? 'writing' : 'planning';
    f.hook(async (stage) => {
      if (stage === stopAt) throw Error('fixture interruption');
    });
    try {
      const first = await f.start(mode);
      const { jobId } = first.json;
      assert.equal((await f.wait(jobId)).job?.status, 'failed');
      const previous = (await store.get(jobId))!;
      assert.match(previous.taskFingerprint!, /^[a-f0-9]{64}$/u);
      assert.equal(previous.completedModels?.[stopAt], undefined);
      if (legacy) await store.save({ ...previous, taskFingerprint: undefined, completedModels: undefined });

      f.hook(undefined);
      const complete = f.provider.complete;
      const attempt = {
        provider: 'fake',
        startedAt: new Date().toISOString(),
        latencyMs: 1,
      };
      Object.assign(f.provider, {
        model: 'failed-primary',
        complete: async (...args: Parameters<typeof complete>) => {
          const first =
            args[0].system.startsWith('KB03 writing') || args[0].user.includes('请对下列全部已验证事实规划知识页');
          return {
            ...(await complete(...args)),
            route: {
              callId: randomUUID(),
              tier: 'heavy',
              fallback: true,
              attempts: [
                { ...attempt, endpoint: 'primary', label: '主端', model: 'failed-primary', outcome: 'failure' },
                {
                  ...attempt,
                  endpoint: 'backup',
                  label: '备用',
                  model: first ? 'actual-backup' : 'budget-model',
                  outcome: 'success',
                },
              ],
            },
          };
        },
      });
      const requestCount = f.requests.length;
      const resumed = await f.start(mode);
      assert.equal(resumed.json.jobId, jobId);
      const { job, recovery } = await f.wait(jobId);
      assert.equal(job?.status, 'completed', JSON.stringify(recovery));
      assert.equal(job?.checkpoint?.reusedChunks, previous.completedChunks.length);
      assert(f.requests.slice(requestCount).every(({ system }) => system.includes('结构衔接')));
      const checkpoint = (await store.get(jobId))!;
      assert.equal(checkpoint.taskFingerprint, previous.taskFingerprint);
      assert.deepEqual(checkpoint.completedChunks, previous.completedChunks);
      const { json: draft } = await f.http.request(`/api/drafts/${job?.draftId}`);
      assert.equal(draft.status, 'pending_confirmation');
      assert.equal(draft.modelProvenance.crossModel, true);
      assert.equal(draft.modelProvenance.untrackedBlocks, legacy ? Object.keys(previous.completedModels!).length : 0);
      assert.deepEqual(
        draft.modelProvenance.models.map((entry: any) => entry.model),
        legacy ? ['actual-backup', 'budget-model'] : ['budget-model', 'actual-backup'],
      );
      assert.deepEqual(
        draft.modelProvenance.model_switches.map(({ block, from, to }: any) => [block, from.model, to.model]),
        [
          ...(legacy ? [] : [[mode === 'deep' ? 'writing' : 'plan', 'budget-model', 'actual-backup']]),
          [mode === 'deep' ? 'quality' : 'maintenance', 'actual-backup', 'budget-model'],
        ],
      );
      assert.deepEqual(draft.humanReview.approvals, []);
      assert.equal((await f.rawStore.get(f.raw.id))?.body, f.raw.body);
    } finally {
      await f.clean();
    }
  });

test('KB03 runner reconstruction reconciles without outbound and explicit resume keeps original job', async () => {
  const f = await deepFixture();
  let once = true;
  f.hook(async (s) => {
    if (s === 'writing' && once) {
      once = false;
      throw Error('stop');
    }
  });
  let h: Awaited<ReturnType<typeof storageHttp>> | undefined;
  try {
    const r = await f.start();
    await f.wait(r.json.jobId);
    const used = f.requests.length,
      runner = f.newRunner();
    await runner.reconcile();
    assert.equal(f.requests.length, used);
    h = await storageHttp(f as any, runner);
    const resumed = await h.request(`/api/raw/${f.raw.id}/extract`, { mode: 'deep' });
    assert.equal(resumed.json.jobId, r.json.jobId);
    await runner.waitForSettlement(r.json.jobId);
    assert.equal((await runner.readJob(r.json.jobId)).job?.status, 'completed');
    assert.equal(f.requests.length, 7);
  } finally {
    await h?.close();
    await f.clean();
  }
});
test('KB03 done checkpoint missing actual draft cannot recreate or send', async () => {
  const f = await deepFixture();
  try {
    const r = await f.start(),
      runtime = await f.wait(r.json.jobId);
    await rm(path.join(f.root, 'drafts', runtime.job!.draftId! + '.json'));
    const used = f.requests.length;
    const result = await f.start();
    assert.equal(result.status, 409);
    assert.equal(f.requests.length, used);
  } finally {
    await f.clean();
  }
});
test('KB03 real draft atomic write failure reconciles by saving only, no Provider repeat', async () => {
  const f = await deepFixture(),
    rename = fs.rename;
  let blocked = true;
  fs.rename = (async (from, to) => {
    if (blocked && String(to).startsWith(path.join(f.root, 'drafts') + path.sep)) {
      const e = Object.assign(Error('isolated disk lock'), { code: 'EACCES' });
      throw e;
    }
    return rename(from, to);
  }) as typeof fs.rename;
  syncBuiltinESMExports();
  try {
    const r = await f.start(),
      runtime = await f.wait(r.json.jobId);
    assert(runtime.recovery, JSON.stringify(runtime));
    assert.equal(f.requests.length, 6);
    assert.equal((await f.drafts.list()).length, 0);
    blocked = false;
    const recovered = await f.http.request(`/api/extraction-jobs/${r.json.jobId}/reconcile-storage`, {});
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
    assert.equal(recovered.json.status, 'completed');
    assert.equal(f.requests.length, 6);
    assert((await f.drafts.get(recovered.json.draftId))!.structuredNote);
  } finally {
    fs.rename = rename;
    syncBuiltinESMExports();
    await f.clean();
  }
});
for (const [name, body, changed] of [
  ['other fact numbers', 'A区域100家，铺货率20%。B区域120家，铺货率30%。', 'B区域120家，铺货率30%。'],
  ['same number wrong unit', '投入100万元。目标100家。', '投入100家。'],
] as const)
  test(`KB03 per-leaf provenance rejects ${name} even when values exist elsewhere`, async () => {
    const f = await deepFixture(body);
    f.mutate((s, v, p) => {
      if (s === 'writing') {
        assert(p.facts.length >= 2);
        v.sections[0].blocks[0].text = changed;
        v.sections[0].blocks[0].factIds = [p.facts[0].id];
      }
      return v;
    });
    try {
      const r = await f.start(),
        view = await f.wait(r.json.jobId);
      assert.equal(view.job?.error?.code, 'LLM_DEEP_NUMERIC_INVALID');
      assert.equal((await f.drafts.list()).length, 0);
    } finally {
      await f.clean();
    }
  });
test('KB03 excluded facts cannot reappear as supported writing; source_facts cannot be injected', async () => {
  for (const inject of [false, true]) {
    const f = await deepFixture();
    f.mutate((s, v, p) => {
      if (s === 'outline') {
        const id = v.sections[0].factIds.pop();
        v.excluded.push({ kind: 'fact', id, reason: '独立旁支留原文查看。' });
      }
      if (s === 'writing') {
        if (inject) v.source_facts = [{ text: '补充当事实', factIds: [] }];
        else v.sections[0].blocks[0].factIds = [p.outline.excluded[0].id];
      }
      return v;
    });
    try {
      const r = await f.start(),
        view = await f.wait(r.json.jobId);
      assert.equal(view.job?.error?.code, 'LLM_DEEP_WRITING_INVALID');
      assert.equal((await f.drafts.list()).length, 0);
    } finally {
      await f.clean();
    }
  }
});
test('KB03 real process restart retains sent attempt, sends nothing on initialize, explicit continuation acknowledges uncertainty', async (t) => {
  const f = await deepFixture();
  let entered!: () => void, release!: () => void;
  const sent = new Promise<void>((r) => (entered = r)),
    hold = new Promise<void>((r) => (release = r));
  f.hook(async () => {
    entered();
    await hold;
  });
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.post('/', async (req, res) => {
    try {
      res.json(await f.provider.complete(req.body));
    } catch {
      res.status(500).json({ error: 'fake' });
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  let child: ChildProcess | undefined;
  const launch = async () => {
    child = fork('tests/support/kb03-deep-child.ts', [f.root, endpoint], {
      execArgv: ['--import', 'tsx', '--import', './tests/support/css-stub.mjs'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const message = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => {
        throw Error('child exited ' + code);
      }),
    ]);
    return (message[0] as { base: string }).base;
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    child = undefined;
  };
  try {
    const base = await launch();
    const start = await fetch(base + `/api/raw/${f.raw.id}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'deep' }),
    });
    const started = (await start.json()) as any;
    assert.equal(start.status, 202);
    await sent;
    const cp = (await new ExtractionCheckpointStore(f.root).get(started.jobId))!;
    assert.equal(cp.attempts, 1);
    assert.equal(cp.completedChunks.length, 0);
    await stop();
    release();
    f.hook(undefined);
    const restarted = await launch();
    assert.equal(f.requests.length, 1);
    const view = (await (await fetch(restarted + `/api/extraction-jobs/${started.jobId}`)).json()) as any;
    assert.equal(view.status, 'failed');
    assert.match(view.error.message, /不确定.*重复请求/);
    assert.equal(view.callCount, 1);
    const resumed = (await (
      await fetch(restarted + `/api/raw/${f.raw.id}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'deep' }),
      })
    ).json()) as any;
    assert.equal(resumed.jobId, started.jobId);
    let final: any;
    for (let i = 0; i < 500; i++) {
      final = await (await fetch(restarted + `/api/extraction-jobs/${started.jobId}`)).json();
      if (final.execution === 'settled') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(final.status, 'completed', JSON.stringify(final));
    assert.equal(final.callCount, 7);
    assert.equal(f.requests.length, 7);
    t.diagnostic(
      JSON.stringify({
        realSubprocess: true,
        attemptsBeforeKill: cp.attempts,
        completedChunksBeforeKill: cp.completedChunks.length,
        requestsOnRestart: 1,
        automaticNewRequests: 0,
        explicitResumeSameJob: resumed.jobId === started.jobId,
        finalAttempts: final.callCount,
        parentFakeRequests: f.requests.length,
        uncertainty: view.error.message,
      }),
    );
  } finally {
    release?.();
    await stop();
    await new Promise<void>((r) => server.close(() => r()));
    await f.clean();
  }
});
