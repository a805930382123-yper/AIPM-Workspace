import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerB04Routes } from '../../server/llm-api.ts';
import { LLMService } from '../../services/llm/service.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WikiCommitService } from '../../services/wiki/commits.ts';
import { storageFixture } from './kb02-storage-fixture.ts';

export async function storageHttp(f: Awaited<ReturnType<typeof storageFixture>>, runner = f.runner) {
  const wikiStore = new WikiStore(f.root, f.rawStore); await wikiStore.initialize();
  const commits = new WikiCommitService({ root: f.root, wikiStore, drafts: f.drafts, rawStates: f.rawStates, rawStore: f.rawStore }); await commits.initialize();
  const app = express(); app.use(express.json());
  registerB04Routes(app, { root: f.root, rulesDir: 'rules', provider: () => f.provider, llm: new LLMService('rules'), runner, jobs: f.jobs, drafts: f.drafts, commits, rawStates: f.rawStates, rawStore: f.rawStore, wikiStore });
  app.use(((error, _req, res, _next) => { const value = error as { status?: number; code?: string; message?: string; details?: unknown }; res.status(value.status ?? 500).json({ error: { code: value.code, message: value.message, details: value.details } }); }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), request: async (url: string, body?: unknown) => {
    const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() as any };
  } };
}
