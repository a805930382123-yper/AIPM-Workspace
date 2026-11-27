import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { lw02Fixture } from './lw02-fixture.ts';
import { startFakeProvider, type FakeReply, type FakeRequest } from './support/fake-llm.ts';

test('formal entry carries provider context through answer and inspection operations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'provider01-'));
  const f = await lw02Fixture(dir);
  const raw = await f.rawStore.create({
    title: '虚构资料',
    body: '星桥2026直营网点目标100家。',
    sourceType: 'report',
    sourceName: '测试',
    tags: [],
  });
  const pages = await Promise.all([
    f.seed('重复主题', '星桥2026直营网点目标100家。', [raw.id]),
    f.seed('重复主题副本', '星桥2026直营网点目标100家。', [raw.id]),
  ]);
  const handle = (req: FakeRequest): FakeReply => {
    const p = JSON.parse(req.user);
    let result: any;
    if (p.stage === 'knowledge_inspection') {
      const [a, b] = p.wiki;
      result = {
        version: 1,
        findings: [
          {
            type: 'duplicate',
            wikiIds: [a.id, b.id],
            summary: '两主题可能重复',
            reason: '双页陈述并列待核。',
            differences: '保留各自口径。',
            nextStep: 'add_note',
            evidence: [a, b].map((w: any) => ({ wikiId: w.id, quote: w.body, start: 0, end: w.body.length })),
          },
        ],
      };
    } else if (p.stage === 'inspection_maintenance')
      result = {
        version: 1,
        changes: p.context
          .filter((w: any) => p.findings.some((x: any) => x.wikiIds.includes(w.id)))
          .map((w: any) => ({
            action: 'update',
            targetWikiId: w.id,
            baseRevision: w.revision,
            title: w.title,
            body: w.body + '\n\n## 待核\n保留双页口径。',
            reason: '补充口径说明。',
            summary: ['保留旧内容'],
            questions: ['仍待核对'],
            findingIds: p.findings.filter((x: any) => x.wikiIds.includes(w.id)).map((x: any) => x.id),
          })),
      };
    else {
      const data = p;
      if (data.stage === 'knowledge_answer') {
        const quotes = data.wiki.map(
          (w: any) => w.chunks?.[0] ?? { rawText: w.body, startOffset: 0, endOffset: w.body.length },
        );
        const citations = data.wiki.map((w: any, i: number) => ({
          id: 'wiki-' + i,
          kind: 'wiki',
          recordId: w.id,
          quote: quotes[i].rawText,
          start: quotes[i].startOffset,
          end: quotes[i].endOffset,
        }));
        result = {
          version: 1,
          needsRaw: [],
          citations,
          sections: [
            {
              kind: 'fact',
              text: quotes.map((quote: { rawText: string }) => quote.rawText).join('\n'),
              citationIds: citations.map((c: any) => c.id),
            },
          ],
        };
      } else {
        assert.equal(data.stage, 'answer_maintenance');
        assert(data.context.length > 0);
        assert(
          data.context.every((wiki: { chunks?: unknown[] }) => wiki.chunks?.length && !Object.hasOwn(wiki, 'body')),
        );
        result = {
          action: 'create',
          targetWikiId: null,
          baseRevision: null,
          title: data.preview.title,
          type: 'synthesis',
          category: 'channel',
          body: '## 问答整理\n' + data.preview.conclusion,
          tags: data.preview.tags,
          reason: '整理所选内容。',
          summary: ['保留依据'],
          questions: ['待核对'],
        };
      }
    }
    return { kind: 'content', content: JSON.stringify(result) };
  };
  const primary = await startFakeProvider((req) =>
    req.user === 'Reply with OK.' || JSON.parse(req.user).stage === 'knowledge_answer'
      ? { kind: 'status', status: 503 }
      : handle(req),
  );
  const backup = await startFakeProvider(handle);
  const socket = net.createServer();
  await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const cfg = path.join(dir, 'provider.env');
  await writeFile(cfg, '');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^FMCG_LLM_|proxy|^NODE_OPTIONS$|^SEARCH_ENGINE$/i.test(k)),
  );
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    windowsHide: true,
    env: withoutInheritedEmbeddings({
      ...env,
      FMCG_DATA_DIR: dir,
      FMCG_PORT: String(port),
      FMCG_LLM_CONFIG_FILE: cfg,
      FMCG_LLM_BASE_URL: primary.url,
      FMCG_LLM_MODEL: 'primary-heavy',
      FMCG_LLM_API_KEY: 'synthetic',
      FMCG_LLM_LIGHT_MODEL: 'primary-light',
      FMCG_LLM_BACKUP_ENABLED: 'true',
      FMCG_LLM_BACKUP_BASE_URL: backup.url,
      FMCG_LLM_BACKUP_API_KEY: 'synthetic-reserve',
      FMCG_LLM_BACKUP_MODEL: 'backup-heavy',
    }),
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const req = async (p: string, body?: unknown) => {
    const r = await fetch(url + p, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, routeId: r.headers.get('x-fmcg-llm-request-id'), json: (await r.json()) as any };
  };
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await req('/api/health')).status === 200) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const a = await req('/api/knowledge/answers', { requestId: randomUUID(), question: '有效门店统计的口径是什么？' });
    assert.equal(a.json.status, 'completed', JSON.stringify(a));
    assert.equal(a.json.wikiRetrieval.engine, 'sqlite_fts');
    assert.equal(a.json.wikiRetrieval.degraded, true);
    assert.equal(a.json.wikiRetrieval.degradeReason, 'embedding_unconfigured');
    assert(a.routeId);
    const answerRoute = await req('/api/llm/routing?requestId=' + a.routeId);
    assert.deepEqual(
      answerRoute.json.attempts.map((attempt: { model: string; outcome: string }) => [attempt.model, attempt.outcome]),
      [
        ['backup-heavy', 'success'],
        ['primary-heavy', 'failure'],
      ],
    );
    const save = await req(`/api/knowledge/answers/${a.json.id}/save`, {
      resultRevision: a.json.revision,
      key: randomUUID(),
      preview: f.preview(a.json),
    });
    assert.equal(save.status, 200, JSON.stringify(save));
    const start = await req('/api/knowledge/inspections', {
      requestId: randomUUID(),
      wikiIds: pages.map((p) => p.id),
      includeRelated: false,
    });
    assert.equal(start.status, 202);
    let check: any;
    for (let i = 0; i < 100; i++) {
      check = (await req(`/api/knowledge/inspections/${start.json.id}`)).json;
      if (!['checking', 'queued'].includes(check.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(check.status, 'completed', JSON.stringify(check));
    const inspectRoute = await req('/api/llm/routing?requestId=' + start.routeId);
    assert.equal(inspectRoute.json.attempts[0].model, 'primary-light');
    const draft = await req(`/api/knowledge/inspections/${check.id}/draft`, {
      baseRevision: check.revision,
      selectedFindingIds: [check.findings[0].id],
      key: randomUUID(),
    });
    assert.equal(draft.status, 200, JSON.stringify(draft));
    assert.deepEqual(
      primary.requests.map((r) => JSON.parse(r.user).stage),
      ['knowledge_answer', 'answer_maintenance', 'knowledge_inspection', 'inspection_maintenance'],
    );
    assert.deepEqual(
      backup.requests.map((r) => r.model),
      ['backup-heavy'],
    );
    const config = await req('/api/llm/config');
    const probe = await fetch(url + '/api/llm/config/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fmcg-config-token': config.json.writeToken },
      body: JSON.stringify({ revision: config.json.revision, confirm: true }),
    });
    assert.equal(probe.status, 502);
    assert.equal(primary.requests.at(-1)?.user, 'Reply with OK.');
    assert.equal(backup.requests.length, 1);
    const probeRoute = await req('/api/llm/routing?requestId=' + probe.headers.get('x-fmcg-llm-request-id'));
    assert.equal(probeRoute.json.attempts.length, 1);
    assert.equal(probeRoute.json.attempts[0].purpose, 'diagnostic');
    assert.equal(probeRoute.json.attempts[0].endpoint, 'primary');
    assert.equal(probeRoute.json.attempts[0].upstreamStatus, 503);
    assert.equal(
      (await fetch(url + '/api/llm/routing', { headers: { origin: 'https://untrusted.invalid' } })).status,
      403,
    );
    const current = () => req('/api/llm/availability');
    const attemptsBeforeReads = [primary.requests.length, backup.requests.length];
    const degraded = await current();
    assert.equal(degraded.json.primary.heavy.status, 'unavailable');
    assert.equal(degraded.json.primary.light.status, 'ready');
    assert.equal(degraded.json.backup.heavy.status, 'ready');
    assert.equal(degraded.json.heavy.available, true);
    assert.equal(degraded.json.light.available, true);
    assert.equal(answerRoute.json.switches[0].upstreamStatus, 503);
    assert.equal(answerRoute.json.switches[0].outcome, 'success');
    assert.deepEqual([primary.requests.length, backup.requests.length], attemptsBeforeReads);

    const diagnose = (endpoint: string, tier: string, token = config.json.writeToken) =>
      fetch(url + '/api/llm/config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fmcg-config-token': token },
        body: JSON.stringify({ revision: config.json.revision, confirm: true, endpoint, tier }),
      });
    backup.setHandler(() => ({ kind: 'status', status: 502 }));
    assert.equal((await diagnose('backup', 'heavy', 'incorrect-token')).status, 403);
    assert.equal(backup.requests.length, 1);
    assert.equal((await diagnose('backup', 'heavy')).status, 502);
    assert.deepEqual((await current()).json.heavy, { available: false, reason: 'unavailable' });
    assert.equal((await current()).json.light.available, true);

    primary.setHandler(() => ({ kind: 'status', status: 401 }));
    backup.setHandler(() => ({ kind: 'status', status: 403 }));
    assert.equal((await diagnose('primary', 'heavy')).status, 401);
    assert.equal((await diagnose('backup', 'heavy')).status, 403);
    const rejected = (await current()).json;
    assert.deepEqual(rejected.heavy, { available: false, reason: 'authentication' });
    assert.deepEqual(rejected.light, { available: false, reason: 'authentication' });
    assert.equal(rejected.primary.light.upstreamStatus, 401);
    assert.equal(rejected.backup.heavy.upstreamStatus, 403);

    primary.setHandler(() => ({ kind: 'content', content: 'OK' }));
    assert.equal((await diagnose('primary', 'light')).status, 200);
    assert.equal(primary.requests.at(-1)?.model, 'primary-light');
    assert.equal((await current()).json.light.available, true);
    assert.equal((await diagnose('primary', 'heavy')).status, 200);
    assert.equal((await current()).json.heavy.available, true);

    await Promise.all([primary.close(), backup.close()]);
    assert.equal((await diagnose('primary', 'heavy')).status, 502);
    assert.equal((await diagnose('backup', 'heavy')).status, 502);
    const disconnected = (await current()).json;
    assert.deepEqual(disconnected.heavy, { available: false, reason: 'unavailable' });
    assert.deepEqual(disconnected.light, { available: false, reason: 'unavailable' });
    assert.equal(disconnected.primary.light.errorCode, 'LLM_NETWORK_ERROR');
    assert.equal(disconnected.backup.heavy.errorCode, 'LLM_NETWORK_ERROR');
  } finally {
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
    await Promise.all([primary.close(), backup.close()]);
    await rm(dir, { recursive: true, force: true });
  }
});

test('manual and read routes work with absent, disabled and malformed optional configuration', async () => {
  for (const [config, reason] of [
    ['', 'unconfigured'],
    ['FMCG_LLM_BASE_URL=not-a-url\n', 'unconfigured'],
    ['FMCG_LLM_ENABLED=false\nFMCG_LLM_BACKUP_ENABLED=false\n', 'disabled'],
  ]) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'provider01-manual-'));
    const cfg = path.join(dir, 'config.env');
    if (config) await writeFile(cfg, config);
    if (!config) await mkdir(path.join(dir, 'state', 'search-index.sqlite'), { recursive: true });
    const sock = net.createServer();
    await new Promise<void>((r) => sock.listen(0, '127.0.0.1', r));
    const port = (sock.address() as net.AddressInfo).port;
    await new Promise<void>((r) => sock.close(() => r()));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^FMCG_LLM_|proxy|^NODE_OPTIONS$|^SEARCH_ENGINE$/i.test(k)),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      windowsHide: true,
      env: withoutInheritedEmbeddings({
        ...env,
        FMCG_DATA_DIR: dir,
        FMCG_PORT: String(port),
        FMCG_LLM_CONFIG_FILE: cfg,
      }),
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + '/api/health')).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(ready);
      const availability = await fetch(base + '/api/llm/availability');
      assert.equal(availability.status, 200);
      const state = await availability.json();
      assert.deepEqual(state.heavy, { available: false, reason });
      assert.deepEqual(state.light, { available: false, reason });
      assert.equal((await fetch(base + '/api/knowledge/answers/current')).status, 200);
      assert.equal((await fetch(base + '/api/raw')).status, 200);
      const raw = await fetch(base + '/api/raw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '隔离手工原文',
          body: '虚构内容。',
          sourceType: 'report',
          sourceName: '测试',
          tags: [],
        }),
      });
      assert.equal(raw.status, 201, await raw.text());
    } finally {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
      await rm(dir, { recursive: true, force: true });
    }
  }
});
