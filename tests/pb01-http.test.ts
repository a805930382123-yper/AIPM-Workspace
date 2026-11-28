import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';
import type { BlueprintDetail } from '../services/product-blueprints/types.ts';

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(FMCG_|EMBEDDING_|NODE_OPTIONS$)|proxy/i.test(key)),
);

test('PB01 actual HTTP revisions, references, export and backup restore', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pb01-http-'));
  const data = path.join(root, 'data');
  await mkdir(data);
  const start = async (dataRoot: string) => {
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as AddressInfo).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...cleanEnv,
        FMCG_DATA_DIR: dataRoot,
        FMCG_PORT: String(port),
        FMCG_LLM_CONFIG_FILE: path.join(root, 'absent.env'),
      },
    });
    let error = '';
    child.stderr.on('data', (chunk) => (error += String(chunk)));
    const stopped = once(child, 'exit');
    const base = 'http://127.0.0.1:' + port;
    for (let i = 0; i < 150; i++) {
      if (
        await fetch(base + '/api/health').then(
          (r) => r.ok,
          () => false,
        )
      )
        return {
          base,
          stop: async () => {
            child.kill();
            await stopped;
          },
        };
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill();
    await stopped;
    throw new Error('server did not start: ' + error);
  };
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start(data);
    const request = async (route: string, method = 'GET', body?: unknown, status = 200) => {
      const response = await fetch(server!.base + route, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      assert.equal(response.status, status, method + ' ' + route + ': ' + text);
      return {
        response,
        text,
        json: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined,
      };
    };
    const oldArchive = path.join(root, 'old.json');
    await exportWorkspace(data, oldArchive);
    const raw = (
      await request(
        '/api/raw',
        'POST',
        { title: '合成材料', sourceType: 'note', sourceName: 'PB01', body: '门店缺货导致重复询问。', tags: [] },
        201,
      )
    ).json;
    const rawPath = path.join(data, 'knowledge', 'raw', 'notes', raw.id + '.md');
    const rawBytes = await readFile(rawPath);
    await request('/api/product-blueprints', 'POST', { title: ' ' }, 400);
    let detail: BlueprintDetail = (await request('/api/product-blueprints', 'POST', { title: '合成构想' }, 201)).json;
    const id = detail.blueprint.id;
    const route = '/api/product-blueprints/' + id;
    assert.equal(detail.blueprint.status, 'exploring');
    const update = async (section: string, value: unknown) => {
      const result = (await request(route, 'PUT', { baseRevision: detail.blueprint.revision, section, data: value }))
        .json;
      detail = result;
      return result;
    };
    await update('links', { rawIds: [raw.id], wikiIds: [], workItemIds: [] });
    const users = {
      personas: [{ id: 'new:person', name: '门店', side: 'external', relations: ['user'], profile: '', frequency: '' }],
      scenarios: [
        { id: 'new:scenario', personaId: 'new:person', when: '补货时', task: '确认库存', outcome: '及时回复' },
      ],
      pains: [
        {
          id: 'new:pain',
          personaId: 'new:person',
          scenarioId: 'new:scenario',
          text: '重复询问',
          kind: 'fact',
          severity: 'high',
          evidence: { rawId: raw.id, quote: '缺货导致重复询问' },
        },
      ],
      alternatives: [],
    };
    const saved = await update('users', users);
    assert.ok(saved.idMap['new:person']);
    assert.equal(detail.blueprint.pains[0].evidence?.quote, '缺货导致重复询问');
    await request(route, 'PUT', { baseRevision: 1, section: 'context', data: detail.blueprint.context }, 409);
    await request(
      route,
      'PUT',
      {
        baseRevision: detail.blueprint.revision,
        section: 'users',
        data: { ...users, pains: [{ ...users.pains[0], evidence: { rawId: raw.id, quote: '伪造引文' } }] },
      },
      400,
    );
    const value = (
      await update('values', [
        {
          id: 'new:value',
          personaIds: [detail.blueprint.personas[0].id],
          painIds: [detail.blueprint.pains[0].id],
          advantage: '减少询问',
          confidence: 'assumed',
          validation: '访谈',
        },
      ])
    ).idMap['new:value'];
    await update('features', [
      {
        id: 'new:feature',
        title: '库存查询',
        description: '',
        valueIds: [value],
        priority: 'must',
        phase: 'mvp',
        wontReason: '',
      },
    ]);
    assert.ok(detail.checks.some((check) => check.code === 'C5'));
    const conflict = await request(
      route,
      'PUT',
      { baseRevision: detail.blueprint.revision, section: 'values', data: [] },
      409,
    );
    assert.equal(conflict.json.error.code, 'REFERENCE_CONFLICT');
    assert.ok(conflict.json.error.details.references.length);
    const exported = await request(route + '/export');
    assert.match(exported.response.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(exported.text, /缺货导致重复询问/);
    assert.deepEqual(await readFile(rawPath), rawBytes);
    const before = await readFile(path.join(data, 'product-blueprints', id + '.json'));
    await server.stop();
    server = undefined;
    const archive = path.join(root, 'backup.json');
    await exportWorkspace(data, archive);
    const restored = path.join(root, 'restored');
    await restoreWorkspace(archive, restored);
    assert.deepEqual(await readFile(path.join(restored, 'product-blueprints', id + '.json')), before);
    const legacy = path.join(root, 'legacy');
    await restoreWorkspace(oldArchive, legacy);
    server = await start(legacy);
    assert.deepEqual((await request('/api/product-blueprints')).json.items, []);
    await server.stop();
    server = await start(restored);
    assert.equal((await request(route)).json.blueprint.id, id);
    await request(route, 'DELETE', { baseRevision: detail.blueprint.revision });
    assert.deepEqual(await readFile(path.join(restored, 'product-blueprints', 'recycle', id + '.json')), before);
    assert.deepEqual((await request('/api/product-blueprints')).json.items, []);
  } finally {
    if (server) await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
