import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CommitError,
  commitSha256,
  normalizeCommitTitle,
  pendingRawCommit,
  reviewProjection,
  type CommitManifest,
  type CommitPhase,
  type KnowledgeCommitManifest,
} from '../services/wiki/commit-types.ts';
import { sourceBodyFor } from '../services/wiki/commit-freeze.ts';
import type { DraftPage, DraftRecord } from '../services/wiki/drafts.ts';

const WIKI_DIR = path.resolve(import.meta.dirname, '..', 'services', 'wiki');
const COMMIT_FILES = [
  'commits.ts',
  'commit-types.ts',
  'commit-freeze.ts',
  'commit-executor.ts',
  'commit-service.ts',
] as const;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

function extractRelativeModuleRefs(source: string): string[] {
  const cleaned = stripComments(source);
  const refs: string[] = [];
  const stmtRe = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu;
  for (const match of cleaned.matchAll(stmtRe)) {
    const spec = match[1];
    if (spec.startsWith('.')) refs.push(spec);
  }
  return refs;
}

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

function makePhases(): CommitPhase[] {
  return [
    { name: 'source', status: 'pending' },
    { name: 'pages', status: 'pending' },
    { name: 'index', status: 'pending' },
    { name: 'log', status: 'pending' },
    { name: 'state', status: 'pending' },
  ];
}

function makeManifest(overrides: Partial<CommitManifest> = {}): CommitManifest {
  return {
    operationId: '00000000-0000-4000-8000-000000000001',
    draftId: 'draft-1',
    idempotencyKey: 'idem-1',
    rawId: 'raw-1',
    rawSha256: 'sha-raw-1',
    rawTitle: '渠道月报',
    status: 'prepared',
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    provider: { name: 'mock', model: 'mock-1' },
    snapshot: {
      capturedRevision: 1,
      document: { title: '渠道月报', main_topic: '渠道', summary: '摘要' },
      selectedPageIds: ['p1'],
      pageRecords: [],
      digests: {},
      warnings: [],
    },
    phases: makePhases(),
    writtenWikiIds: [],
    ...overrides,
  };
}

test('BE01-02 facade commits.ts exports exact 4 runtime symbols with zero internal helper leakage', async () => {
  const mod = await import('../services/wiki/commits.ts');
  assert.deepEqual(Object.keys(mod).sort(), [
    'CommitError',
    'WikiCommitService',
    'pendingRawCommit',
    'scanWikiCommits',
  ]);
});

test('BE01-01 all 5 commit modules are pure LF, < 40960 B, < 800 lines, and form a strict DAG', async () => {
  const commitSet = new Set<string>(COMMIT_FILES);
  const adjacency = new Map<string, string[]>();

  for (const file of COMMIT_FILES) {
    const fullPath = path.join(WIKI_DIR, file);
    const info = await stat(fullPath);
    const raw = await readFile(fullPath, 'utf8');
    const lines = raw.split('\n');
    assert.equal(raw.includes('\r'), false, `${file} must use pure LF`);
    assert.ok(info.size < 40_960, `${file} size ${info.size} must be < 40960 B`);
    assert.ok(lines.length < 800, `${file} lines ${lines.length} must be < 800`);

    const refs = extractRelativeModuleRefs(raw);
    const localEdges: string[] = [];
    for (const spec of refs) {
      const resolved = path.resolve(WIKI_DIR, spec);
      const rel = path.relative(WIKI_DIR, resolved);
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && commitSet.has(rel)) {
        localEdges.push(rel);
      }
      if (file === 'commit-freeze.ts') {
        assert.notEqual(spec, '../search/duplicates.ts', 'commit-freeze.ts must not import duplicates.ts');
        assert.notEqual(rel, 'commit-executor.ts', 'commit-freeze.ts must not import commit-executor.ts');
        assert.notEqual(rel, 'commit-service.ts', 'commit-freeze.ts must not import commit-service.ts');
      }
      if (file === 'commit-executor.ts') {
        assert.notEqual(rel, 'commit-freeze.ts', 'commit-executor.ts must not import commit-freeze.ts');
        assert.notEqual(rel, 'commit-service.ts', 'commit-executor.ts must not import commit-service.ts');
      }
    }
    adjacency.set(file, localEdges);
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (node: string, trail: string[]) => {
    const current = state.get(node);
    if (current === 'visited') return;
    assert.notEqual(current, 'visiting', `Cycle detected: ${[...trail, node].join(' -> ')}`);
    state.set(node, 'visiting');
    for (const next of adjacency.get(node) ?? []) {
      visit(next, [...trail, node]);
    }
    state.set(node, 'visited');
  };
  for (const file of COMMIT_FILES) visit(file, []);
});

test('BE01 pure helpers: commitSha256, normalizeCommitTitle, and non-mutating reviewProjection', () => {
  const input = '渠道-BE01-摘要';
  assert.equal(commitSha256(input), createHash('sha256').update(input, 'utf8').digest('hex'));
  assert.equal(normalizeCommitTitle('  ＡＢＣ\u3000渠道  Store \t Name  '), 'abc 渠道 store name');

  const draft = makeDraft({
    maintenance: {
      version: 1,
      context: [],
      changes: [
        {
          changeId: 'c1',
          pageIndex: 0,
          action: 'create',
          reason: 'r1',
          summary: ['s1'],
          questions: [],
          dependsOn: [],
          decision: 'defer',
          committedOperationId: 'op-old',
          candidate: {
            title: '核心渠道',
            type: 'concept',
            category: 'channel',
            body: 'body1',
            sources: ['raw-1'],
            aliases: [],
            tags: [],
            knowledge_status: 'source_supported',
            confidence: 'high',
            source_level: 'B',
          },
        },
        {
          changeId: 'c2',
          pageIndex: 1,
          action: 'create',
          reason: 'r2',
          summary: ['s2'],
          questions: [],
          dependsOn: [],
          decision: 'defer',
          candidate: {
            title: '待选页面',
            type: 'concept',
            category: 'channel',
            body: 'body2',
            sources: ['raw-1'],
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

  const projected = reviewProjection(draft, ['p1']);
  assert.equal(projected.maintenance!.changes[0].decision, 'accept');
  assert.equal('committedOperationId' in projected.maintenance!.changes[0], false);
  assert.equal(projected.maintenance!.changes[1].decision, 'defer');
  assert.equal(draft.maintenance!.changes[0].committedOperationId, 'op-old');
  assert.equal(draft.maintenance!.changes[0].decision, 'defer');
});

test('BE01 pendingRawCommit checks 409 mismatches, missing committing manifest, and picks latest pending', () => {
  const draft = makeDraft({ commitOperationId: '00000000-0000-4000-8000-000000000002' });

  assert.throws(
    () => pendingRawCommit(draft, [makeManifest({ rawSha256: 'wrong-sha' })]),
    (err: unknown) => err instanceof CommitError && err.status === 409 && err.code === 'COMMIT_DRAFT_MISMATCH',
  );

  assert.throws(
    () => pendingRawCommit(draft, [makeManifest({ operationId: '00000000-0000-4000-8000-000000000099' })]),
    (err: unknown) => err instanceof CommitError && err.status === 409 && err.code === 'COMMIT_DRAFT_MISMATCH',
  );

  const committingDraft = makeDraft({ status: 'committing' });
  const completedOnly: KnowledgeCommitManifest[] = [
    makeManifest({ status: 'completed', createdAt: '2026-11-28T01:00:00.000Z' }),
    makeManifest({
      operationId: '00000000-0000-4000-8000-000000000002',
      status: 'failed',
      supersededBy: '00000000-0000-4000-8000-000000000003',
    }),
  ];
  assert.throws(
    () => pendingRawCommit(committingDraft, completedOnly),
    (err: unknown) => err instanceof CommitError && err.status === 409 && err.code === 'COMMIT_DRAFT_MISMATCH',
  );

  const older = makeManifest({
    operationId: '00000000-0000-4000-8000-000000000010',
    status: 'failed',
    createdAt: '2026-11-28T01:00:00.000Z',
  });
  const newest = makeManifest({
    operationId: '00000000-0000-4000-8000-000000000011',
    status: 'prepared',
    createdAt: '2026-11-28T02:00:00.000Z',
  });
  const superseded = makeManifest({
    operationId: '00000000-0000-4000-8000-000000000012',
    status: 'prepared',
    createdAt: '2026-11-28T03:00:00.000Z',
    supersededBy: newest.operationId,
  });
  const chosen = pendingRawCommit(makeDraft(), [older, superseded, newest]);
  assert.equal(chosen?.operationId, newest.operationId);
});

test('BE01 sourceBodyFor enforces SOURCE_NOTE_SECTION_CONFLICT and escapes unselected links under outcomeReviewed', () => {
  const noteDraft = makeDraft({
    structuredNote: {
      version: 1,
      orientation: '深度导读',
      sections: [
        {
          id: 's1',
          title: '章节一',
          question: '问题一',
          blocks: [{ type: 'paragraph', text: '条目', role: 'source_supported', factIds: ['f1'] }],
        },
      ],
    },
    source: {
      title: '来源：渠道月报',
      category: 'source',
      summary: '摘要',
      key_takeaways: ['要点'],
      body: '摘要正文\n\n## 深度整理笔记\n重复内容',
      knowledge_status: 'source_supported',
      confidence: 'high',
      source_level: 'B',
      bodyEditedByUser: true,
    },
  });

  assert.throws(
    () => sourceBodyFor(noteDraft, [noteDraft.pages[0]]),
    (err: unknown) => err instanceof CommitError && err.status === 409 && err.code === 'SOURCE_NOTE_SECTION_CONFLICT',
  );

  const editedDraft = makeDraft();
  const known = new Set([normalizeCommitTitle('既有条目')]);
  const body = sourceBodyFor(editedDraft, [editedDraft.pages[0]], true, known);
  assert.ok(body.includes('[[核心渠道]]'));
  assert.ok(body.includes('[[既有条目]]'));
  assert.equal(body.includes('[[待选页面]]'), false);
  assert.ok(body.includes('\\[\\[待选页面\\]\\]'));
});
