import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { validateSchema } from '../services/llm/schema-validator.ts';
import {
  CleanupError,
  cleanupFingerprint,
  completedBlocks,
  finalTitleIssue,
  titleOk,
  type Decision,
  type Job,
  type PresentationUnit,
  type WireUnit,
} from '../services/raw/pdf-cleanup-types.ts';
import {
  assertUniqueSlots,
  checkedSchemaError,
  decodeKeyed,
  keyedResponse,
  responseSchemas,
  unknownFieldPath,
  validJob,
} from '../services/raw/pdf-cleanup-schemas.ts';
import { batchesFor, checkedPresentation, protectedTerms, validateBatch } from '../services/raw/pdf-cleanup-planner.ts';
import type { PdfUnit } from '../services/wiki/pdf-input.ts';

const unit = (id: string, page = 1, text = '原文事实'): WireUnit => ({
  id,
  page,
  text,
  origin: 'text',
  kind: 'content',
});
const job = (): Job => ({
  version: 1,
  binding: {
    startPage: 1,
    endPage: 1,
    pageCount: 1,
    assetId: '12345678-1234-1234-1234-123456789abc',
    assetSha256: 'a'.repeat(64),
    basisDigest: 'b'.repeat(64),
  },
  provider: { name: 'fixture', model: 'offline' },
  identity: 'c'.repeat(64),
  status: 'queued',
  stage: 'cleaning',
  attempts: 0,
  totalBatches: 0,
  batches: [],
  index: [],
});
const shape = (reason: string, code: string, action: () => unknown) =>
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof CleanupError);
    assert.equal(error.code, code);
    assert.equal(error.details?.reason, reason);
    return true;
  });

test('BE05 title boundaries preserve labels and reject unsafe final titles', () => {
  for (const value of ['主题', '名称（样本）', 'A & B', '']) assert.equal(titleOk(value), true);
  for (const value of [' 主题', '主题 ', 'a\nb', 'a\rb', '[a', 'a]', '<a', 'a>']) {
    assert.equal(titleOk(value), false, value);
  }
  assert.equal(finalTitleIssue('  '), 'blank_label');
  assert.equal(finalTitleIssue('a\nb'), 'multiline_label');
  assert.equal(finalTitleIssue(' 主题'), 'surrounding_whitespace');
  for (const value of ['[a', 'a]', '<a', 'a>']) assert.equal(finalTitleIssue(value), 'unsafe_title_characters');
  assert.equal(finalTitleIssue('有效主题'), undefined);
});

for (const strict of [false, true]) {
  test(`BE05 keyed cleanup decode preserves strict=${strict} and rejects unknown/missing fields`, () => {
    const format = keyedResponse({ stage: 'pdf_cleanup', units: [unit('u1')] });
    const decision = { decision: 'keep', reason: '保留', topic: '主题' };
    const entry = strict ? { ...decision, mergedInto: null, table: null } : decision;
    assert.deepEqual(decodeKeyed('pdf_cleanup', { decisions: { u1: entry } }, format, strict), {
      decisions: [{ ...decision, id: 'u1' }],
    });
    shape('unknown_field', 'PDF_CLEANUP_SCHEMA', () =>
      decodeKeyed('pdf_cleanup', { decisions: { u1: entry }, extra: 1 }, format, strict),
    );
    shape('unknown_field', 'PDF_CLEANUP_SCHEMA', () =>
      decodeKeyed('pdf_cleanup', { decisions: { u1: { ...entry, extra: 1 } } }, format, strict),
    );
    shape('missing_field', 'PDF_CLEANUP_SCHEMA', () => decodeKeyed('pdf_cleanup', {}, format, strict));
    shape('missing_input_key', 'PDF_CLEANUP_SCHEMA', () =>
      decodeKeyed('pdf_cleanup', { decisions: {} }, format, strict),
    );
    shape('unknown_input_key', 'PDF_CLEANUP_SCHEMA', () =>
      decodeKeyed('pdf_cleanup', { decisions: { u1: entry, other: entry } }, format, strict),
    );
  });

  test(`BE05 keyed index/directory/presentation decode preserves strict=${strict}`, () => {
    const index = keyedResponse({
      stage: 'pdf_topic_index',
      topics: ['标签'],
      existing: [],
      basis: [],
      existingBasis: [],
    });
    assert.deepEqual(decodeKeyed('pdf_topic_index', { assignments: { 标签: '标题' } }, index, strict), {
      assignments: [{ topic: '标签', title: '标题' }],
    });
    const directory = keyedResponse({
      stage: 'pdf_topic_directory',
      topics: [
        {
          id: 't1',
          label: '标签',
          startPage: 1,
          endPage: 1,
          sample: { page: 1, origin: 'text', kind: 'content', excerpt: '原文' },
        },
      ],
    });
    assert.deepEqual(decodeKeyed('pdf_topic_directory', { assignments: { t1: '标题' } }, directory, strict), {
      assignments: [{ topic: 't1', title: '标题' }],
    });
    const presentation = keyedResponse({ stage: 'pdf_presentation', units: [{ ...unit('u1'), topic: '主题' }] });
    assert.deepEqual(
      decodeKeyed(
        'pdf_presentation',
        { presentation: { u1: { representativeId: null, reason: '并列' } } },
        presentation,
        strict,
      ),
      { presentation: [{ representativeId: null, reason: '并列', id: 'u1' }] },
    );
  });
}

test('BE05 compatibility array schemas reject undeclared properties and missing keys', () => {
  const decisions = { decisions: [{ id: 'u1', decision: 'keep', reason: '保留', topic: '主题' }] };
  assert.deepEqual(validateSchema(decisions, responseSchemas.pdf_cleanup), []);
  assert.equal(
    unknownFieldPath({ decisions: [{ ...decisions.decisions[0], extra: true }] }, responseSchemas.pdf_cleanup),
    '$.decisions[0]',
  );
  const [message] = validateSchema({ decisions: [{ id: 'u1', decision: 'keep' }] }, responseSchemas.pdf_cleanup);
  assert.ok(message);
  shape('missing_field', 'PDF_CLEANUP_SCHEMA', () => {
    throw checkedSchemaError('pdf_cleanup', message);
  });
  assert.deepEqual(
    validateSchema({ assignments: [{ topic: '标签', title: '标题' }] }, responseSchemas.pdf_topic_index),
    [],
  );
  assert.equal(
    unknownFieldPath({ assignments: [{ topic: '标签', title: '标题', extra: true }] }, responseSchemas.pdf_topic_index),
    '$.assignments[0]',
  );
});

test('BE05 duplicate keyed slots are rejected in original presentation/directory scope', () => {
  assertUniqueSlots(
    'pdf_presentation',
    'presentation',
    '{"presentation":{"u1":{"reason":"a","representativeId":null},"u2":{"reason":"b","representativeId":null}}}',
  );
  for (const [stage, field] of [
    ['pdf_presentation', 'presentation'],
    ['pdf_topic_directory', 'assignments'],
  ] as const) {
    for (const text of [
      `{"${field}":{"u1":"a","u1":"b"}}`,
      `{"${field}":{},"${field}":{}}`,
      `{"${field}":{"u1":"a","\\u00751":"b"}}`,
    ]) {
      shape(
        'duplicate_input_key',
        stage === 'pdf_presentation' ? 'PDF_CLEANUP_PRESENTATION' : 'PDF_CLEANUP_INDEX',
        () => assertUniqueSlots(stage, field, text),
      );
    }
  }
});

test('BE05 batches split at 48 units independently of byte/page limits', () => {
  const units = Array.from({ length: 49 }, (_, index) => unit('u' + index));
  assert.deepEqual(
    batchesFor(units).map((batch) => batch.length),
    [48, 1],
  );
  assert.deepEqual(batchesFor(units.slice(0, 48)), [units.slice(0, 48)]);
  assert.deepEqual(batchesFor([]), []);
});

test('BE05 batches keep exactly 32 KiB and split one byte above', () => {
  const first = unit('u1', 1, '');
  const second = unit('u2', 1, '');
  const overhead = [first, second].reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)) + 1, 0);
  second.text = 'x'.repeat(32 * 1024 - overhead);
  assert.deepEqual(batchesFor([first, second]), [[first, second]]);
  second.text += 'x';
  assert.deepEqual(batchesFor([first, second]), [[first], [second]]);
  second.text = '中'.repeat(11000);
  assert.deepEqual(batchesFor([first, second]), [[first], [second]]);
});

test('BE05 page batching splits when distance reaches four', () => {
  const units = [unit('u1', 1), unit('u2', 4), unit('u3', 5), unit('u4', 8), unit('u5', 9)];
  assert.deepEqual(batchesFor(units), [units.slice(0, 2), units.slice(2, 4), units.slice(4)]);
});

test('BE05 provider cross-source duplicate downgrades to keep; checkpoints reject it', () => {
  const units = [unit('u1'), { ...unit('u2'), origin: 'image' as const }];
  const decisions: Decision[] = [
    { id: 'u1', decision: 'keep', reason: '原件', topic: '主题' },
    { id: 'u2', decision: 'merge', mergedInto: 'u1', reason: '重复', topic: '主题' },
  ];
  const result = validateBatch(units, decisions, 'provider');
  assert.deepEqual(result[1], {
    id: 'u2',
    decision: 'keep',
    reason: '跨来源依据文字相同，保留两份来源，未执行归并。',
    topic: '主题',
  });
  assert.deepEqual(Object.keys(result[1]), ['id', 'decision', 'reason', 'topic']);
  assert.equal(Object.hasOwn(result[1], 'mergedInto'), false);
  assert.equal(decisions[1].decision, 'merge');
  assert.throws(() => validateBatch(units, decisions), { code: 'PDF_CLEANUP_DUPLICATE' });
  assert.throws(() => validateBatch(units, decisions, 'checkpoint'), { code: 'PDF_CLEANUP_DUPLICATE' });
  assert.deepEqual(validateBatch([units[0], { ...units[1], origin: 'text' }], decisions), decisions);
  assert.throws(() => validateBatch(units, decisions.slice(0, 1)), { code: 'PDF_CLEANUP_COVERAGE' });
  assert.throws(() => validateBatch(units, [decisions[0], decisions[0]]), { code: 'PDF_CLEANUP_COVERAGE' });
});

test('BE05 protected terms normalize quantities and retain conditions', () => {
  const terms = protectedTerms('1. 全国 1,000 人、2025年、3-5%、10年+，不 包括农村，仅限城市。');
  for (const quantity of ['1000人', '2025年', '3', '5%', '10年']) assert.ok(terms.quantities.has(quantity), quantity);
  for (const condition of ['全国', '农村', '城市', '以上', '不包括', '仅限城市'])
    assert.ok(terms.conditions.has(condition), condition);
});

test('BE05 presentation falls back to parallel when quantities or conditions disappear', () => {
  for (const text of ['全国 20% 实际', '农村 10% 实际', '全国 10% 预测']) {
    const units: PresentationUnit[] = [
      { ...unit('representative', 1, text), topic: '主题' },
      { ...unit('member', 1, '全国 10% 实际'), topic: '主题' },
    ];
    const result = checkedPresentation(
      units,
      [
        { id: 'representative', representativeId: null, reason: '保留' },
        { id: 'member', representativeId: 'representative', reason: '同义' },
      ],
      '',
      new Map(),
    );
    assert.equal(result.groups.length, 0);
    assert.equal(result.parallel.length, 1);
    assert.deepEqual(result.parallel[0].memberIds, ['member']);
  }
});

test('BE05 presentation permits explicit list and split negation continuation', () => {
  for (const parts of [
    ['仅限城市、', '农村'],
    ['不', '包括农村'],
  ] as const) {
    const body = parts.join('\n');
    const units: PresentationUnit[] = [
      { ...unit('representative', 2, parts.join('')), topic: '主题' },
      ...parts.map((text, index) => ({ ...unit('m' + index, 1, text), topic: '主题' })),
    ];
    const rawUnits = new Map<string, PdfUnit & { kind: 'text' }>(
      parts.map((text, index) => {
        const start = index ? parts[0].length + 1 : 0;
        return [
          'm' + index,
          {
            unitId: 'm' + index,
            kind: 'text',
            section: 'content',
            page: 1,
            resultSha256: 'a'.repeat(64),
            text,
            start,
            end: start + text.length,
          },
        ];
      }),
    );
    const mappings = units.map(({ id }) => ({
      id,
      representativeId: id === 'representative' ? null : 'representative',
      reason: '同一段落',
    }));
    assert.equal(checkedPresentation(units, mappings, body, rawUnits).groups.length, 1);
    assert.equal(checkedPresentation(units, mappings, body.replace('\n', '\n\n'), rawUnits).parallel.length, 1);
  }
});

test('BE05 fingerprint binds revision, basis, count and version but permits model changes', () => {
  const original = job();
  const fingerprint = cleanupFingerprint(original);
  assert.match(fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(cleanupFingerprint({ ...original, promptRevision: 1 }), fingerprint);
  assert.equal(
    cleanupFingerprint({ ...original, provider: { name: 'other', model: 'next' }, identity: 'd'.repeat(64) }),
    fingerprint,
  );
  for (const altered of [
    { ...original, version: 2 },
    { ...original, promptRevision: 5 },
    { ...original, totalBatches: 1 },
    { ...original, binding: { ...original.binding, basisDigest: 'd'.repeat(64) } },
  ])
    assert.notEqual(cleanupFingerprint(altered), fingerprint);
  assert.deepEqual(completedBlocks(original), []);
  assert.deepEqual(
    completedBlocks({
      ...original,
      batches: [[], []],
      index: [{ topic: 't', title: '题' }],
      writing: [{ topics: {} }],
      presentation: { completedBatches: 2, groups: [], parallel: [] },
    }),
    ['cleanup-0', 'cleanup-1', 'index-0', 'writing-0', 'presentation-0', 'presentation-1'],
  );
});

test('BE05 checkpoint revisions and completed-stage requirements remain compatible', () => {
  for (const revision of [undefined, 2, 3, 4, 5, 6, 7]) {
    const value = { ...job(), ...(revision === undefined ? {} : { promptRevision: revision }) };
    assert.equal(validJob(value), true, String(revision));
    const completed: Job = {
      ...value,
      status: 'completed',
      stage: 'done',
      ...(revision !== undefined && revision >= 3 && revision < 5
        ? { presentation: { completedBatches: 0, groups: [], parallel: [] } }
        : {}),
      ...(revision === 4 || revision === 5 ? { fragments: [] } : {}),
      ...(revision !== undefined && revision >= 5 ? { writing: [] } : {}),
    };
    assert.equal(validJob(completed), true, String(revision));
    assert.equal(validJob({ ...completed, stage: 'assembling' }), false);
    const stamped = { ...value, taskFingerprint: cleanupFingerprint(value) };
    assert.equal(validJob(stamped), true);
    assert.equal(validJob({ ...stamped, totalBatches: 1 }), false);
    assert.equal(validJob({ ...value, completedModels: { 'cleanup-0': [] } }), false);
  }
  for (const revision of [1, 8, -1]) assert.equal(validJob({ ...job(), promptRevision: revision }), false);
  assert.equal(validJob({ ...job(), status: 'completed', stage: 'done', promptRevision: 5, writing: [] }), false);
  assert.equal(validJob({ ...job(), totalBatches: -1 }), false);
  assert.equal(validJob({ ...job(), binding: { ...job().binding, endPage: 2 } }), false);
  assert.equal(validJob(null), false);
});

// Split-only contracts are deliberately separate from the behavior suite used before extraction.
test('BE05 public facade exports exactly PdfCleanupService', async () => {
  assert.deepEqual(Object.keys(await import('../services/raw/pdf-cleanup.ts')), ['PdfCleanupService']);
});

test('BE05 seven LF modules stay below limits and all import/export-from edges form a DAG', async () => {
  const names = [
    'pdf-cleanup',
    'pdf-cleanup-types',
    'pdf-cleanup-prompts',
    'pdf-cleanup-schemas',
    'pdf-cleanup-planner',
    'pdf-cleanup-runner',
    'pdf-cleanup-draft',
  ];
  const root = path.resolve(import.meta.dirname, '../services/raw');
  const allowed = new Map<string, string[]>([
    [
      'pdf-cleanup',
      ['pdf-cleanup-types', 'pdf-cleanup-schemas', 'pdf-cleanup-planner', 'pdf-cleanup-runner', 'pdf-cleanup-draft'],
    ],
    ['pdf-cleanup-types', []],
    ['pdf-cleanup-prompts', []],
    ['pdf-cleanup-schemas', ['pdf-cleanup-types']],
    ['pdf-cleanup-planner', ['pdf-cleanup-types', 'pdf-cleanup-schemas']],
    ['pdf-cleanup-runner', ['pdf-cleanup-types', 'pdf-cleanup-prompts', 'pdf-cleanup-schemas', 'pdf-cleanup-planner']],
    ['pdf-cleanup-draft', ['pdf-cleanup-types', 'pdf-cleanup-schemas', 'pdf-cleanup-planner']],
  ]);
  const edges = new Map<string, string[]>();
  for (const name of names) {
    const file = path.join(root, name + '.ts');
    const buffer = await readFile(file);
    const text = buffer.toString('utf8');
    assert.equal(text.includes('\r'), false, name);
    assert.ok(buffer.byteLength < 40960, name);
    assert.ok(text.split('\n').length - 1 < 800, name);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const dependencies = source.statements.flatMap((statement) => {
      const module =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
      if (!module || !ts.isStringLiteral(module) || !module.text.startsWith('.')) return [];
      const target = path.basename(path.resolve(root, module.text), '.ts');
      return names.includes(target) ? [target] : [];
    });
    edges.set(name, dependencies);
    assert.ok(
      dependencies.every((dependency) => allowed.get(name)!.includes(dependency)),
      name + ' dependency boundary',
    );
    if (name === 'pdf-cleanup-prompts') assert.equal(source.statements.some(ts.isImportDeclaration), false);
    if (name === 'pdf-cleanup') {
      const exports = source.statements.filter(
        (node) =>
          ts.isExportDeclaration(node) ||
          ts.isExportAssignment(node) ||
          (ts.canHaveModifiers(node) &&
            ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)),
      );
      assert.equal(exports.length, 1);
      assert.ok(ts.isClassDeclaration(exports[0]));
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    assert.equal(visiting.has(name), false, 'cycle at ' + name);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of edges.get(name)!) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of names) visit(name);
  assert.equal(visited.size, 7);
});
