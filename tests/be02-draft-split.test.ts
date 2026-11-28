import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  DraftError,
  DraftStore,
  derivedTakeaways,
  isQuestionDraft,
  type DraftPage,
  type DraftRecord,
  type KnowledgeDraftRecord,
} from '../services/wiki/drafts.ts';
import { omitKeys, type DraftRules } from '../services/wiki/draft-types.ts';
import { computeDraftOutcomeDigest, assertRoundtripSize } from '../services/wiki/draft-digest.ts';
import { applyDraftPagePatch, applyDraftMerge, applyDraftPatchRecord } from '../services/wiki/draft-patch.ts';
import {
  normalizedTemplateFields,
  validateDraftPage,
  validateTemplateReferences,
} from '../services/wiki/draft-digest.ts';
import { deriveReviewPages } from '../services/wiki/draft-migration.ts';

const WIKI_DIR = path.resolve(import.meta.dirname, '..', 'services', 'wiki');
const ALLOWED_EDGES: Record<string, readonly string[]> = {
  'drafts.ts': ['draft-types.ts', 'draft-store.ts'],
  'draft-store.ts': ['draft-types.ts', 'draft-digest.ts', 'draft-migration.ts', 'draft-patch.ts', 'draft-review.ts'],
  'draft-patch.ts': ['draft-types.ts', 'draft-digest.ts', 'draft-migration.ts'],
  'draft-review.ts': ['draft-types.ts', 'draft-digest.ts', 'draft-migration.ts'],
  'draft-digest.ts': ['draft-types.ts'],
  'draft-migration.ts': ['draft-types.ts'],
  'draft-types.ts': [],
};

function makeDraftPage(pageId: string, title: string): DraftPage {
  return {
    pageId,
    title,
    type: 'concept',
    category: 'channel',
    one_line_definition: `${title}定义`,
    source_facts: [{ text: `${title}事实`, evidenceIds: ['e1'] }],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [
      {
        id: 'e1',
        rawId: 'raw-1',
        quote: '原文摘录',
        start: 0,
        end: 4,
        chunkIndex: 0,
      },
    ],
    knowledge_status: 'source_supported',
    confidence: 'high',
    source_level: 'B',
    selected: true,
    provenance: [{ chunkIndex: 0, start: 0, end: 4 }],
  };
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  const p1 = makeDraftPage('p1', '核心渠道');
  const p2 = makeDraftPage('p2', '待选页面');
  return {
    id: 'draft-1',
    rawId: 'raw-1',
    rawSha256: 'sha-raw-1',
    rawTitle: '渠道月报',
    rawMeta: {
      rawId: 'raw-1',
      title: '渠道月报',
      sourceType: 'report',
      sourceName: '渠道部',
    },
    status: 'pending_confirmation',
    revision: 1,
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    rulesVersion: 'v1',
    provider: { name: 'mock', model: 'mock-1' },
    jobId: 'job-1',
    document: { title: '渠道月报', main_topic: '渠道', summary: '摘要' },
    pages: [p1, p2],
    source: {
      title: '来源：渠道月报',
      category: 'source',
      summary: '摘要',
      key_takeaways: ['要点'],
      body: '正文中提到了[[核心渠道]]、[[待选页面]]与[[既有条目]]。',
      knowledge_status: 'source_supported',
      confidence: 'high',
      source_level: 'B',
      bodyEditedByUser: true,
    },
    warnings: [],
    extraction: { callCount: 1, chunkCount: 1, pagesFound: 2 },
    ...overrides,
  };
}

test('BE02 facade exports exactly the five runtime symbols', async () => {
  const mod = await import('../services/wiki/drafts.ts');
  assert.deepEqual(Object.keys(mod).sort(), [
    'DRAFT_STATUSES',
    'DraftError',
    'DraftStore',
    'derivedTakeaways',
    'isQuestionDraft',
  ]);
});

test('BE02 seven modules have bounded size, pure LF and only permitted acyclic import/export edges', async () => {
  const files = Object.keys(ALLOWED_EDGES);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const fullPath = path.join(WIKI_DIR, file);
    const source = await readFile(fullPath, 'utf8');
    assert.equal(source.includes('\r'), false, file + ' must use LF');
    assert.ok((await stat(fullPath)).size < 40960, file + ' must be smaller than 40960 bytes');
    assert.ok(source.split('\n').length < 800, file + ' must have fewer than 800 lines');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const edges: string[] = [];
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const ref = statement.moduleSpecifier;
      if (!ref || !ts.isStringLiteral(ref) || !ref.text.startsWith('.')) continue;
      const resolved = path.resolve(WIKI_DIR, ref.text);
      const target = files.find((candidate) => path.join(WIKI_DIR, candidate) === resolved);
      if (!target) continue;
      assert.ok(ALLOWED_EDGES[file].includes(target), file + ' may not depend on ' + target);
      edges.push(target);
    }
    graph.set(file, edges);
  }
  const active = new Set<string>(),
    done = new Set<string>();
  const visit = (file: string) => {
    assert.equal(active.has(file), false, 'Cycle at ' + file);
    if (done.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target);
    active.delete(file);
    done.add(file);
  };
  for (const file of files) visit(file);
});

test('BE02 derivedTakeaways slices before filtering, and isQuestionDraft recognizes only evidence inputs', () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ one_line_definition: i === 1 ? '' : String(i) }));
  assert.deepEqual(derivedTakeaways(pages), ['0', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(derivedTakeaways([]), []);
  assert.equal(isQuestionDraft(makeDraft()), false);
  for (const kind of ['question_answer', 'inspection', 'other']) {
    const candidate = { ...makeDraft(), input: { kind } } as unknown as KnowledgeDraftRecord;
    assert.equal(isQuestionDraft(candidate), kind !== 'other');
  }
});

test('BE02 omitKeys preserves retained key order and leaves its input unchanged', () => {
  const input = { z: 1, approval: { digest: 'a' }, a: 2, committedOperationId: 'op', m: 3 };
  const before = JSON.stringify(input);
  const result = omitKeys(input, ['approval', 'committedOperationId']);
  assert.deepEqual(Object.keys(result), ['z', 'a', 'm']);
  assert.equal(JSON.stringify(result), '{"z":1,"a":2,"m":3}');
  assert.equal(JSON.stringify(input), before);
});

test('BE02 outcome digest ignores persisted approvals and operation ids without mutating either draft', () => {
  const draft = makeDraft({
    maintenance: {
      version: 1,
      context: [],
      changes: [
        {
          changeId: 'c1',
          pageIndex: 0,
          action: 'create',
          reason: 'r',
          summary: ['s'],
          questions: [],
          dependsOn: [],
          decision: 'accept',
          approval: { digest: 'old', at: 'before' },
          committedOperationId: 'old-op',
          candidate: {
            title: 'candidate',
            type: 'concept',
            category: 'channel',
            body: 'body',
            sources: [],
            aliases: [],
            tags: [],
            knowledge_status: 'source_supported',
            confidence: 'high',
            source_level: 'B',
          },
        },
      ],
    },
  });
  const changed = structuredClone(draft);
  changed.maintenance!.changes[0].approval = { digest: 'new', at: 'after' };
  changed.maintenance!.changes[0].committedOperationId = 'new-op';
  const before = JSON.stringify([draft, changed]);
  assert.equal(computeDraftOutcomeDigest(draft), computeDraftOutcomeDigest(changed));
  assert.equal(JSON.stringify([draft, changed]), before);
  changed.pages[0].title += ' changed';
  assert.notEqual(computeDraftOutcomeDigest(draft), computeDraftOutcomeDigest(changed));
});

test('BE02 roundtrip payload accepts exactly 3 MiB, rejects one byte over, and ignores non-whitelisted fields', () => {
  const draft = makeDraft();
  draft.source.body = '';
  draft.pages[0].mergedTemplateFields = [
    {
      version: 1,
      pageId: 'merged',
      pageType: 'concept',
      rawId: draft.rawId,
      fields: {},
      facts: [],
      evidence: [],
      title: 'merged',
    },
  ];
  // Independently construct the browser snapshot, retaining the original field whitelist and order.
  const payload = {
    baseRevision: draft.revision,
    document: { title: draft.document.title, main_topic: draft.document.main_topic, summary: draft.document.summary },
    source: Object.fromEntries(
      ['title', 'summary', 'body', 'category', 'knowledge_status', 'confidence', 'source_level', 'key_takeaways'].map(
        (key) => [key, draft.source[key as keyof DraftRecord['source']]],
      ),
    ),
    pages: draft.pages.map((page) => ({
      ...Object.fromEntries(
        [
          'pageId',
          'selected',
          'title',
          'type',
          'category',
          'one_line_definition',
          'source_facts',
          'ai_organized',
          'ai_inferences',
          'related_pages',
          'open_questions',
          'templateFields',
          'mergedTemplateFields',
          'knowledge_status',
          'confidence',
          'source_level',
        ].map((key) => [key, page[key as keyof DraftPage]]),
      ),
      source_evidence: page.source_evidence.map(({ id, rawId, quote, start, end }) => ({
        id,
        rawId,
        quote,
        start,
        end,
      })),
    })),
  };
  draft.source.body = 'x'.repeat(3 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(payload), 'utf8'));
  payload.source.body = draft.source.body;
  assert.equal(Buffer.byteLength(JSON.stringify(payload), 'utf8'), 3 * 1024 * 1024);
  draft.pages[0].notes = ['x'.repeat(3 * 1024 * 1024)];
  assert.doesNotThrow(() => assertRoundtripSize(draft));
  draft.source.body += 'x';
  assert.throws(
    () => assertRoundtripSize(draft),
    (error: unknown) => error instanceof DraftError && error.status === 413 && error.code === 'DRAFT_PATCH_TOO_LARGE',
  );
  delete draft.pages[0].mergedTemplateFields;
  assert.doesNotThrow(() => assertRoundtripSize(draft));
});

test(
  'BE02 cross-instance stores resolve the same root and serialize review locks in call order',
  { timeout: 5000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-be02-queue-'));
    try {
      const first = new DraftStore(root),
        second = new DraftStore(root + path.sep + 'child' + path.sep + '..');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const order: string[] = [];
      const a = first.withReviewLock(async () => {
        order.push('first-start');
        await gate;
        order.push('first-end');
      });
      const b = second.withReviewLock(async () => {
        order.push('second');
      });
      const review = second
        .reviewStructuredNote(
          'missing',
          {
            baseRevision: 1,
            reviewContentDigest: 'digest',
            warningsAcknowledged: true,
            historicalReportAcknowledged: true,
          },
          '',
        )
        .catch((error: unknown) => {
          assert.ok(error instanceof DraftError && error.code === 'NOTE_NOT_FOUND');
          order.push('review');
        });
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(order, ['first-start']);
      release();
      await Promise.all([a, b, review]);
      assert.deepEqual(order, ['first-start', 'first-end', 'second', 'review']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('BE02 invalid structured-note review fields fail before storage lookup without nesting a queue lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-be02-review-'));
  try {
    const store = new DraftStore(root);
    const validShape = {
      baseRevision: 1,
      reviewContentDigest: 'digest',
      warningsAcknowledged: true,
      historicalReportAcknowledged: true,
    };
    for (const input of [
      { ...validShape, approval: {} },
      { ...validShape, warningsAcknowledged: false },
      { ...validShape, historicalReportAcknowledged: false },
    ]) {
      await assert.rejects(
        store.reviewStructuredNote('missing', input, ''),
        (error: unknown) => error instanceof DraftError && error.code === 'INVALID_NOTE_REVIEW',
      );
    }
    await assert.rejects(
      store.reviewStructuredNote('missing', validShape, ''),
      (error: unknown) => error instanceof DraftError && error.code === 'NOTE_NOT_FOUND',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('BE02 pure no-op patch returns the exact current record and never changes its revision', () => {
  const current = makeDraft();
  const rules: DraftRules = {
    types: ['concept'],
    categories: ['channel'],
    knowledge_status: ['source_supported'],
    confidence: ['high'],
    source_level: ['B'],
    review_status: [],
  };
  current.source.key_takeaways = derivedTakeaways(current.pages.filter((page) => page.selected));
  const before = JSON.stringify(current);
  const next = applyDraftPatchRecord(
    {
      applyPagePatch: (page, item, context, rawId) =>
        applyDraftPagePatch(normalizedTemplateFields, page, item, context, rawId),
      applyMerge: applyDraftMerge,
      deriveReviewPages,
      validatePage: validateDraftPage,
      validateTemplateReferences,
      assertRoundtripSize,
    },
    current,
    { baseRevision: 1 },
    { body: '原文摘录', rules },
  );
  assert.equal(next, current);
  assert.equal(next.revision, 1);
  assert.equal(JSON.stringify(current), before);
});

test('BE02 ordinary patch validates forbidden input before looking up a missing draft', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-be02-input-'));
  try {
    const store = new DraftStore(root);
    const patch = { ...{ baseRevision: 1 }, noteApproval: {} };
    const rules: DraftRules = {
      types: [],
      categories: [],
      knowledge_status: [],
      confidence: [],
      source_level: [],
      review_status: [],
    };
    await assert.rejects(
      store.patch('missing', patch, { body: '', rules }),
      (error: unknown) => error instanceof DraftError && error.code === 'STRUCTURED_NOTE_INPUT_UNAVAILABLE',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
