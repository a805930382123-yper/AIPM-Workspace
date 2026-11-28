import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { setEmbeddingLock } from '../services/search/sqlite-store.ts';
import {
  civilDate,
  effectiveReviewCycle,
  evaluateFreshness,
  rankReviewQueue,
  type ReviewPage,
} from '../services/wiki/freshness.ts';
import { parseWikiMarkdown, WikiStore } from '../services/wiki/store.ts';

const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';
const body = '## 来源事实\r\n渠道 🧾 原有引文。\r\n\r\n## 推断\r\n待核查内容。';
const page: ReviewPage = { pageId: first, title: '测试公司知识', type: 'entity', category: 'industry_basics' };

function markdown(id: string, extra: string) {
  return `---\nid: ${id}\nunknown_when: 2025-12-01\ntitle: 测试公司知识\nunknown_mapping: {a: 1, b: [x, y]}\ntype: entity\ncategory: company_business\ndomain: fmcg\nsources: []\ntags: []\naliases: []\nknowledge_status: needs_verification\nconfidence: low\nsource_level: D\nreview_status: reviewed\ncreated: '2026-11-25T00:00:00.000Z'\nupdated: '2026-11-26T00:00:00.000Z'\nrevision: 1\n${extra}---\n# 测试公司知识\n\n${body}`;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'aipm-wiki-freshness-'));
  const index = new WikiSearchIndexer(root);
  const dir = path.join(root, 'knowledge', 'wiki');
  await mkdir(dir, { recursive: true });
  t.after(async () => {
    await index.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, index, file: (id: string) => path.join(dir, `${id}.md`) };
}

test('freshness uses civil days, explicit verification and editable default tiers', () => {
  assert.equal(civilDate('2024-02-29'), '2024-02-29');
  for (const bad of ['2023-02-29', '2024-02-30', '2024-02-01T00:00:00Z', '2024-2-01'])
    assert.equal(civilDate(bad), undefined);
  assert.equal(effectiveReviewCycle(page), 180);
  assert.equal(effectiveReviewCycle({ ...page, category: 'ai_application' }), 90);
  assert.equal(effectiveReviewCycle({ ...page, type: 'metric' }), 365);
  assert.equal(effectiveReviewCycle({ ...page, type: 'concept', category: 'ai_application' }), null);
  assert.equal(effectiveReviewCycle({ ...page, type: 'concept', review_cycle_days: 42 }), 42);
  assert.equal(effectiveReviewCycle({ ...page, review_cycle_days: 0 }), null);
  assert.equal(effectiveReviewCycle({ ...page, review_cycle_days: null }), null);
  assert.equal(effectiveReviewCycle({ ...page, review_cycle_days: -1 }), 180);
  assert.equal(effectiveReviewCycle({ ...page, review_cycle_days: 1.5 }), 180);
  const dated = { ...page, last_verified_at: '2024-01-01', review_cycle_days: 90 };
  assert.equal(evaluateFreshness(dated, '2024-02-29').status, 'fresh');
  assert.equal(evaluateFreshness(dated, '2024-03-01').status, 'due_soon');
  assert.equal(evaluateFreshness(dated, '2024-03-30').status, 'due_soon');
  assert.equal(evaluateFreshness(dated, '2024-03-31').status, 'due');
  assert.equal(evaluateFreshness(dated, '2024-03-31').dueOn, '2024-03-31');
  assert.equal(evaluateFreshness(dated, '2024-04-01').status, 'due');
  assert.equal(evaluateFreshness(dated, '2023-12-31').status, 'unverified');
  assert.equal(
    evaluateFreshness({ ...dated, type: 'concept', review_cycle_days: 0 }, '2026-12-31').status,
    'evergreen',
  );
  const old = evaluateFreshness({ ...page, type: 'concept', source_published_at: '2024-01-01' }, '2026-12-31');
  assert.deepEqual(
    [old.status, old.dueOn, old.lastVerifiedAt, old.sourcePublishedAt],
    ['unverified', null, null, '2024-01-01'],
  );
});

test('queue priority adds active triggers, uses stable ties and reopens on the 30th civil day', () => {
  const pending = { ...page, last_verified_at: '2024-03-01' };
  const trigger = {
    triggers: { source_changed: ['2024-03-01'], inference: ['2024-03-15'], new_source: ['2024-02-29'] },
  };
  const assessed = evaluateFreshness(pending, '2024-03-02', trigger);
  assert.deepEqual(assessed.activeTriggers, ['source_changed']);
  assert.equal(assessed.priority, 50);
  assert.equal(evaluateFreshness(pending, '2024-03-15', trigger).priority, 70);
  const ids = ['01', '02', '03', '04', '05', '06'];
  const ties = [...ids].reverse().map((pageId) => ({ ...page, pageId }));
  assert.deepEqual(
    rankReviewQueue(ties, '2024-03-01', {}).map((row) => row.pageId),
    ids.slice(0, 5),
  );
  const state = { [first]: { ...trigger, snoozedOn: ['2024-02-29'] } };
  assert.equal(rankReviewQueue([pending], '2024-03-29', state).length, 0);
  assert.equal(rankReviewQueue([pending], '2024-03-30', state).length, 1);
});

test('Wiki reads strict date scalars and explicit edits preserve unknown values, order and freshness', async (t) => {
  const { root, index, file } = await fixture(t);
  const store = new WikiStore(root, new RawStore(root), undefined, index);
  await store.initialize();
  const valid = 'last_verified_at: 2024-02-29\nsource_published_at: "2024-01-31"\nreview_cycle_days: null\n';
  const input = markdown(first, valid);
  const parsed = parseWikiMarkdown(input) as unknown as Record<string, unknown>;
  assert.equal(parsed.last_verified_at, '2024-02-29');
  assert.equal(parsed.source_published_at, '2024-01-31');
  assert.equal(parsed.review_cycle_days, null);
  assert.deepEqual(parsed.unknown_when, new Date('2025-12-01'));
  for (const date of ['2024-02-30', '2024-02-29T00:00:00Z', "'2024-02-30'"]) {
    const invalid = parseWikiMarkdown(markdown(first, `last_verified_at: ${date}\nreview_cycle_days: -1\n`));
    assert.equal(invalid.last_verified_at, undefined);
    assert.equal(invalid.review_cycle_days, undefined);
  }
  await writeFile(file(first), input);
  assert.equal(await index.reconcileOnStartup(), true);
  const saved = await store.update(first, 1, {
    type: 'entity',
    category: 'company_business',
    title: '人工修改标题',
    sources: [],
    tags: [],
    aliases: [],
    knowledge_status: 'needs_verification',
    confidence: 'low',
    source_level: 'D',
    review_status: 'reviewed',
    body,
  });
  const changed = parseWikiMarkdown(await readFile(file(first), 'utf8')) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(changed), Object.keys(parsed));
  for (const field of [
    'unknown_mapping',
    'unknown_when',
    'last_verified_at',
    'source_published_at',
    'review_cycle_days',
    'body',
  ])
    assert.deepEqual(changed[field], parsed[field]);
  const after = { ...saved, revision: 3 };
  await store.withLock(() => store.writePageLocked(after));
  assert.deepEqual(parseWikiMarkdown(await readFile(file(first), 'utf8')), after);
  assert.deepEqual(await index.reviewQueue('2026-11-26'), []);
});

test('schema 1 upgrades cached records, embedding vectors and UTF-16 coordinates together', async (t) => {
  const { index, file } = await fixture(t);
  await writeFile(file(first), markdown(first, 'last_verified_at: 2024-02-29\nreview_cycle_days: 90\n'));
  await index.rebuildAll();
  const vector = Buffer.from(new Float32Array([0.25, 0.75]).buffer);
  index.read((db) => {
    setEmbeddingLock(db, {
      provider: 'test',
      model: 'test',
      identity: 'test',
      configuredDimensions: 2,
      dimensions: 2,
      version: 'test-v1',
    });
    db.prepare('UPDATE chunks SET embedding = ?, embedding_ver = ?').run(vector, 'test-v1');
    db.exec(`DROP TABLE wiki_catalog;
      DROP TABLE relations;
      DROP TABLE wiki_link_mentions;
      DROP INDEX idx_pages_link_title;
      ALTER TABLE pages DROP COLUMN link_title;
      DROP VIEW review_queue;
      ALTER TABLE pages DROP COLUMN last_verified_at;
      ALTER TABLE pages DROP COLUMN source_published_at;
      ALTER TABLE pages DROP COLUMN review_cycle_days;
      ALTER TABLE pages DROP COLUMN review_trigger_checkpoint;
      UPDATE meta SET value = '1' WHERE key = 'schema_version'`);
  });
  const indexedContent = () =>
    index.read((db) => ({
      chunks: db.prepare('SELECT * FROM chunks ORDER BY chunk_id').all(),
      fts: db.prepare('SELECT * FROM chunks_fts ORDER BY chunk_id').all(),
    }));
  const before = indexedContent();
  const bytes = await readFile(file(first));
  await index.close();
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(
    index.read((db) => db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").pluck().get()),
    '5',
  );
  assert.deepEqual(indexedContent(), before);
  assert.deepEqual(await readFile(file(first)), bytes);
  const [row] = await index.reviewQueue('2024-05-29');
  assert.deepEqual([row.pageId, row.lastVerifiedAt, row.dueOn, row.status], [first, '2024-02-29', '2024-05-29', 'due']);
});

test('review projection follows incremental changes and restores from Markdown plus atomic state after database loss', async (t) => {
  const { root, index, file } = await fixture(t);
  await writeFile(file(first), markdown(first, 'source_published_at: 2026-11-20\n'));
  await utimes(file(first), new Date('2026-11-26'), new Date('2026-11-26'));
  const oldBytes = await readFile(file(first));
  assert.equal(await index.reconcileOnStartup(), true);
  const asOf = '2026-11-26';
  assert.equal((await index.reviewQueue(asOf))[0].status, 'unverified');
  await writeFile(file(second), markdown(second, 'last_verified_at: 2026-11-23\nreview_cycle_days: 0\n'));
  assert.equal(await index.syncPage(file(second)), true);
  assert.equal((await index.reviewQueue(asOf)).length, 1);
  await Promise.all([
    index.reviewTriggers.recordTrigger(first, 'inference', asOf),
    index.reviewTriggers.snooze(first, asOf),
    index.reviewTriggers.recordTrigger(second, 'source_changed', asOf),
  ]);
  const snapshot = await index.reviewQueue(asOf);
  assert.deepEqual(
    snapshot.map(({ pageId, priority }) => [pageId, priority]),
    [[second, 50]],
  );
  assert.deepEqual(await index.reviewQueue(asOf, new Set([first])), []);
  const afterSnooze = await index.reviewQueue('2026-12-26');
  assert.deepEqual(
    afterSnooze.map(({ pageId, priority }) => [pageId, priority]),
    [
      [first, 80],
      [second, 50],
    ],
  );
  assert.deepEqual(await readFile(file(first)), oldBytes);
  await index.close();
  await rm(index.databaseFile);
  const restored = new WikiSearchIndexer(root);
  t.after(() => restored.close());
  assert.equal(await restored.reconcileOnStartup(), true);
  assert.deepEqual(await restored.reviewQueue(asOf), snapshot);
  assert.deepEqual(await restored.reviewQueue('2026-12-26'), afterSnooze);
  await rm(file(second));
  assert.equal(await restored.removePage(second), true);
  assert.deepEqual(await restored.reviewQueue(asOf), []);
  assert.deepEqual(
    (await restored.reviewQueue('2026-12-26')).map((row) => row.pageId),
    [first],
  );
  const stateFile = path.join(root, 'state', 'review-triggers.json');
  await writeFile(stateFile, '{broken');
  await assert.rejects(restored.reviewQueue(asOf), SyntaxError);
  await assert.rejects(restored.reviewTriggers.snooze(first, asOf), SyntaxError);
  assert.equal(await readFile(stateFile, 'utf8'), '{broken');
  await restored.close();
});

test('later dates preserve historical triggers and snoozes after reading legacy state and rebuilding SQLite', async (t) => {
  const { root, index, file } = await fixture(t);
  const verified = { ...page, last_verified_at: '2026-01-01', review_cycle_days: 0 };
  await writeFile(file(first), markdown(first, 'last_verified_at: 2026-01-01\nreview_cycle_days: 0\n'));
  assert.equal(await index.reconcileOnStartup(), true);
  const stateFile = path.join(root, 'state', 'review-triggers.json');
  const legacy = JSON.stringify({
    version: 1,
    pages: { [first]: { triggers: { new_source: '2026-03-01' }, snoozedOn: '2026-03-03' } },
  });
  await writeFile(stateFile, legacy);

  const evaluate = async (day: string) => {
    const state = await index.reviewTriggers.read();
    const { priority, snoozed } = evaluateFreshness(verified, day, state[first]);
    return [priority, snoozed, (await index.reviewQueue(day)).map(({ pageId }) => pageId)];
  };
  const march = ['2026-03-02', '2026-03-15', '2026-04-02'];
  const original = await Promise.all(march.map(evaluate));
  assert.deepEqual(original, [
    [50, false, [first]],
    [50, true, []],
    [50, false, [first]],
  ]);
  assert.equal(await readFile(stateFile, 'utf8'), legacy);

  await Promise.all([
    index.reviewTriggers.recordTrigger(first, 'new_source', '2026-04-01'),
    index.reviewTriggers.snooze(first, '2026-04-03'),
    index.reviewTriggers.recordTrigger(first, 'new_source', '2026-03-01'),
    index.reviewTriggers.snooze(first, '2026-03-03'),
  ]);
  assert.deepEqual(await Promise.all(march.map(evaluate)), original);
  assert.deepEqual(await evaluate('2026-05-02'), [50, true, []]);
  assert.deepEqual(await evaluate('2026-05-03'), [50, false, [first]]);
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), {
    version: 2,
    pages: {
      [first]: {
        triggers: { new_source: ['2026-03-01', '2026-04-01'] },
        snoozedOn: ['2026-03-03', '2026-04-03'],
      },
    },
  });
  await index.close();
  await rm(index.databaseFile);
  assert.equal(await index.reconcileOnStartup(), true);
  assert.deepEqual(await Promise.all(march.map(evaluate)), original);
  assert.deepEqual(await evaluate('2026-05-03'), [50, false, [first]]);
});
