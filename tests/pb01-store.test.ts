import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProductBlueprintStore } from '../services/product-blueprints/store.ts';
import { exportBlueprint } from '../services/product-blueprints/export.ts';
import { StorageError } from '../services/storage/files.ts';
import type { RawRecord, RawStore } from '../services/raw/store.ts';
import type { WikiStore } from '../services/wiki/store.ts';
import type { WorkItemStore } from '../services/work-items/store.ts';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pb01-'));
  for (const key of Object.keys(process.env))
    if (key.startsWith('FMCG_LLM_') || key.startsWith('EMBEDDING_')) delete process.env[key];
  process.env.FMCG_DATA_DIR = root;
  process.env.FMCG_LLM_CONFIG_FILE = path.join(root, 'missing-config');
  const rawId = randomUUID();
  let restricted = false,
    removed = false;
  const raw = { id: rawId, title: '原文标题', body: '逐字引文和正文' } as RawRecord;
  const raws = {
    get: async (id: string) =>
      id === rawId && !removed
        ? ({
            ...raw,
            ...(restricted
              ? {
                  origin: {
                    kind: 'meeting',
                    meeting_id: randomUUID(),
                    import_id: randomUUID(),
                    original_sha256: 'a'.repeat(64),
                    registered_confidentiality: 'Internal',
                    processing_policy: 'meeting_local_only',
                  },
                }
              : {}),
          } as RawRecord)
        : undefined,
  } as Pick<RawStore, 'get' | 'list'>;
  const wiki = { get: async () => undefined } as unknown as Pick<WikiStore, 'get' | 'list'>;
  const work = {
    get: async () => {
      throw new StorageError('WORK_ITEM_NOT_FOUND', 'missing', 404);
    },
  } as unknown as Pick<WorkItemStore, 'get' | 'list'>;
  const store = new ProductBlueprintStore(root, raws, wiki, work);
  return {
    root,
    rawId,
    store,
    restrict: () => {
      restricted = true;
    },
    remove: () => {
      removed = true;
    },
  };
}
const persona = (id: string) => ({
  id,
  name: '角色',
  side: 'internal',
  relations: ['user'],
  profile: '',
  frequency: '',
});
const pain = (id: string, personaId: string, rawId: string) => ({
  id,
  personaId,
  text: '痛点',
  kind: 'fact',
  severity: 'high',
  evidence: { rawId, quote: '逐字引文' },
});
test('group saves resolve temporary IDs, checks, conflict and revision', async () => {
  const { store, rawId, root } = await setup();
  const created = await store.create({ title: ' 产品 ' });
  const id = created.blueprint.id;
  let result = await store.update(id, {
    baseRevision: 1,
    section: 'links',
    data: { rawIds: [rawId], wikiIds: [], workItemIds: [] },
  });
  result = await store.update(id, {
    baseRevision: result.blueprint.revision,
    section: 'users',
    data: { personas: [persona('new:p')], scenarios: [], pains: [pain('new:x', 'new:p', rawId)], alternatives: [] },
  });
  const p = result.idMap['new:p'],
    x = result.idMap['new:x'];
  assert.equal(result.blueprint.pains[0].personaId, p);
  assert.ok(result.checks.some((c) => c.code === 'C3' && c.id === x));
  result = await store.update(id, {
    baseRevision: result.blueprint.revision,
    section: 'values',
    data: [
      { id: 'new:v', personaIds: [p], painIds: [x], advantage: '优势', confidence: 'assumed', validation: '验证' },
    ],
  });
  const v = result.idMap['new:v'];
  result = await store.update(id, {
    baseRevision: result.blueprint.revision,
    section: 'features',
    data: [
      { id: 'new:f', title: '功能', description: '', valueIds: [v], priority: 'must', phase: 'mvp', wontReason: '' },
    ],
  });
  assert.deepEqual(
    result.checks.map((c) => c.code),
    ['C5', 'C7'],
  );
  await assert.rejects(
    store.update(id, { baseRevision: result.blueprint.revision, section: 'values', data: [] }),
    (e: unknown) =>
      e instanceof StorageError && e.status === 409 && (e.details as { references: unknown[] }).references.length === 1,
  );
  await assert.rejects(
    store.update(id, { baseRevision: 1, section: 'values', data: [] }),
    (e: unknown) => e instanceof StorageError && e.code === 'REVISION_CONFLICT',
  );
  await assert.rejects(
    store.update(id, {
      baseRevision: result.blueprint.revision,
      section: 'features',
      data: [{ ...result.blueprint.features[0], id: randomUUID() }],
    }),
    (e: unknown) => e instanceof StorageError && e.status === 400,
  );
  await store.delete(id, result.blueprint.revision);
  assert.equal((await store.list()).items.length, 0);
  assert.ok(await readFile(path.join(root, 'product-blueprints', 'recycle', `${id}.json`)));
});
test('evidence validates exact quote and redacts restricted source without destroying persisted quote', async () => {
  const { store, rawId, restrict, remove } = await setup();
  let result = await store.create({ title: '构想' });
  const id = result.blueprint.id;
  await store.update(id, {
    baseRevision: 1,
    section: 'links',
    data: { rawIds: [rawId], wikiIds: [], workItemIds: [] },
  });
  const users = {
    personas: [persona('new:p')],
    scenarios: [],
    pains: [pain('new:x', 'new:p', rawId)],
    alternatives: [],
  };
  await assert.rejects(
    store.update(id, {
      baseRevision: 2,
      section: 'users',
      data: { ...users, pains: [{ ...users.pains[0], evidence: { rawId, quote: '伪造' } }] },
    }),
  );
  await store.update(id, { baseRevision: 2, section: 'users', data: users });
  restrict();
  const hidden = await store.get(id);
  assert.equal(hidden.blueprint.pains[0].evidence?.quote, undefined);
  assert.equal(hidden.blueprint.pains[0].evidenceRedacted, true);
  assert.equal(hidden.sources.raw[0].title, undefined);
  assert.ok(hidden.checks.some((c) => c.code === 'C6'));
  assert.ok(!exportBlueprint(hidden).includes('逐字引文'));
  result = await store.update(id, {
    baseRevision: 3,
    section: 'users',
    data: { personas: hidden.blueprint.personas, scenarios: [], pains: hidden.blueprint.pains, alternatives: [] },
  });
  assert.equal(result.blueprint.pains[0].evidence?.quote, undefined);
  remove();
  assert.ok((await store.get(id)).checks.some((c) => c.code === 'C6'));
});
test('damaged files are reported without suppressing valid records', async () => {
  const { store, root } = await setup();
  const item = await store.create({ title: '有效' });
  const dir = path.join(root, 'product-blueprints');
  await mkdir(dir, { recursive: true });
  const bad = `${randomUUID()}.json`;
  await writeFile(path.join(dir, bad), '{bad');
  const listed = await store.list();
  assert.equal(listed.items[0].id, item.blueprint.id);
  assert.ok(listed.errors.some((e) => e.id === bad.slice(0, -5)));
  assert.equal(await readFile(path.join(dir, bad), 'utf8'), '{bad');
});

test('unreadable source is redacted, preserved when saved, and does not disclose title or quote', async () => {
  const { store, rawId, root } = await setup();
  const created = await store.create({ title: '构想' });
  const id = created.blueprint.id;
  await store.update(id, {
    baseRevision: 1,
    section: 'links',
    data: { rawIds: [rawId], wikiIds: [], workItemIds: [] },
  });
  await store.update(id, {
    baseRevision: 2,
    section: 'users',
    data: {
      personas: [],
      scenarios: [],
      pains: [{ ...pain('new:x', '', rawId), personaId: undefined }],
      alternatives: [],
    },
  });
  const disk = path.join(root, 'product-blueprints', `${id}.json`);
  const saved = JSON.parse(await readFile(disk, 'utf8'));
  const unavailable = new ProductBlueprintStore(
    root,
    {
      get: async () => {
        throw Error('unreadable source');
      },
    } as unknown as Pick<RawStore, 'get' | 'list'>,
    { get: async () => undefined } as unknown as Pick<WikiStore, 'get' | 'list'>,
    {
      get: async () => {
        throw Error('unexpected');
      },
    } as unknown as Pick<WorkItemStore, 'get' | 'list'>,
  );
  const hidden = await unavailable.get(id);
  assert.equal(hidden.blueprint.pains[0].evidenceRedacted, true);
  assert.equal(hidden.sources.raw[0].available, false);
  assert.ok(hidden.checks.some((c) => c.code === 'C6'));
  assert.ok(!exportBlueprint(hidden).includes('逐字引文'));
  await unavailable.update(id, {
    baseRevision: 3,
    section: 'users',
    data: { personas: [], scenarios: [], pains: hidden.blueprint.pains, alternatives: [] },
  });
  const after = JSON.parse(await readFile(disk, 'utf8'));
  assert.equal(after.pains[0].evidence.quote, saved.pains[0].evidence.quote);
});
