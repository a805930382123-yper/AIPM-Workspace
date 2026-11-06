import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerB04Routes } from '../../server/llm-api.ts';
import { LLMService } from '../../services/llm/service.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WikiCommitService } from '../../services/wiki/commits.ts';
import { storageFixture } from './kb02-storage-fixture.ts';
import {registerKnowledgeRoutes} from '../../server/knowledge-api.ts';

type StorageHttpFixture = Pick<Awaited<ReturnType<typeof storageFixture>>, 'root' | 'rawStore' | 'rawStates' | 'drafts' | 'jobs' | 'runner' | 'provider'>;

export async function storageHttp<F extends StorageHttpFixture>(f: F, runner = f.runner, options:{knowledge?:boolean}={}) {
  const wikiStore = new WikiStore(f.root, f.rawStore); await wikiStore.initialize();
  const commits = new WikiCommitService({ root: f.root, wikiStore, drafts: f.drafts, rawStates: f.rawStates, rawStore: f.rawStore }); await commits.initialize();
  const app = express(); app.use(express.json());
  registerB04Routes(app, { root: f.root, rulesDir: 'rules', provider: () => f.provider, llm: new LLMService('rules'), runner, jobs: f.jobs, drafts: f.drafts, commits, rawStates: f.rawStates, rawStore: f.rawStore, wikiStore });
  if(options.knowledge){
    app.get('/api/raw/:id',async(req,res,next)=>{try{res.json(await f.rawStore.get(req.params.id));}catch(e){next(e);}});
    app.get('/api/wiki/schema',async(_req,res,next)=>{try{res.json(await wikiStore.schema());}catch(e){next(e);}});
    registerKnowledgeRoutes(app,{root:f.root,raws:f.rawStore,drafts:f.drafts,wiki:wikiStore,provider:()=>f.provider});
  }
  app.use(((error, _req, res, _next) => { const value = error as { status?: number; code?: string; message?: string; details?: unknown }; res.status(value.status ?? 500).json({ error: { code: value.code, message: value.message, details: value.details } }); }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), request: async (url: string, body?: unknown) => {
    const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() as any };
  } };
}
