import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { registerHomeRoutes } from '../server/home-api.ts';
test('行动预检在版本变化、处理或来源损坏时拒绝跳转', async () => {
  const f = await storageFixture();
  const app = express();
  const wiki = { get: async () => undefined } as any;
  registerHomeRoutes(app, { root: f.root, raws: f.rawStore, wiki, runner: f.runner });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await f.rawStates.set(f.raw.id, { status: 'failed', reason: 'fixture' });
    const list = await (await fetch(base + '/api/home/actions')).json();
    const item = list.items.find((x: any) => x.kind === 'raw-task');
    const url = base + `/api/home/actions/raw-task/${item.id}?versionToken=${item.versionToken}`;
    assert.equal((await fetch(url)).status, 200);
    await f.rawStates.set(f.raw.id, { status: 'failed', reason: 'version' });
    assert.equal((await fetch(url)).status, 409);
    await f.rawStates.set(f.raw.id, { status: 'unprocessed', reason: 'done' });
    assert.equal((await fetch(url)).status, 410);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await f.clean();
  }
});
