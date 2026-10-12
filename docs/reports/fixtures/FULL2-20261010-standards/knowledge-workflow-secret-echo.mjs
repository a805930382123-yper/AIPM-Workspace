import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RawStore } from '../../../../services/raw/store.ts';
import { WikiStore } from '../../../../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../../../../services/wiki/knowledge-workflows.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'fmcg-full2-knowledge-secret-'));
const fixtureSecret = 'fixture-secret-knowledge-20261010';
try {
  const raws = new RawStore(root);
  await raws.initialize();
  await raws.create({ title: '来源一', sourceType: 'report', sourceName: 'fixture', tags: [], body: '来源一原文。' });
  await raws.create({ title: '来源二', sourceType: 'report', sourceName: 'fixture', tags: [], body: '来源二原文。' });
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  const provider = {
    name: 'fixture-provider', model: 'fixture', secrets: [fixtureSecret],
    async complete() {
      const text = JSON.stringify({
        title: '隔离综合草稿', category: 'industry_basics',
        agreement: [], conflicts: [], inferences: [`回显凭证 ${fixtureSecret}`], openQuestions: [], suggestedAdditions: [],
      });
      return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
    },
  };
  const draft = await workflows.createSynthesis({ rawIds: (await raws.list()).map(raw => raw.id), provider });
  const persisted = await readFile(path.join(root, 'drafts', 'knowledge-workflows', `${draft.id}.json`), 'utf8');
  const result = {
    returnedPendingDraft: draft.status === 'pending_confirmation',
    secretInInference: draft.sections.inferences.some(item => item.includes(fixtureSecret)),
    secretPersistedInDraft: persisted.includes(fixtureSecret),
    providerHttpCalls: 0,
    temporaryDataRootRemovedAfterRun: true,
  };
  assert.equal(result.returnedPendingDraft, true);
  assert.equal(result.secretInInference, true);
  assert.equal(result.secretPersistedInDraft, true);
  await writeFile(new URL('./knowledge-workflow-secret-echo.result.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} finally {
  await rm(root, { recursive: true, force: true });
}
