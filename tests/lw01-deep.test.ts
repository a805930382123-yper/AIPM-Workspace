import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lwFixture } from './lw01-fixture.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { preserveDeepBoundaries, checkDeepNote, deepLeaves, type DeepOutline } from '../services/llm/knowledge-deep.ts';
import type { StructuredNote } from '../services/wiki/structured-note.ts';

test('LW01 located same source/position/category merges varied reasons across paragraphs, lists, table and diagram; repeated assembly is stable without Provider', async () => {
  const f = await lwFixture(),
    raw = await f.rawStore.create({
      title: '深度原句合成',
      sourceType: 'report',
      sourceName: '合成',
      tags: [],
      body: '渠道覆盖口径存在疑点。',
    }),
    draft = await f.generate(raw.id, 'deep'),
    cp = (await new ExtractionCheckpointStore(f.root).get(draft.jobId))!,
    fact = cp.completedChunks[0].facts[0];
  const attr = { role: 'needs_verification' as const, factIds: [fact.id] },
    outline: DeepOutline = {
      version: 1,
      sections: [{ id: 'core', title: '渠道', question: '什么口径？', factIds: [fact.id], questionIds: [] }],
      excluded: [],
    };
  const note: StructuredNote = {
    version: 1,
    orientation: '保留原句和疑点',
    sections: [
      {
        id: 'core',
        title: '渠道',
        question: '什么口径？',
        blocks: [
          { type: 'paragraph', ...attr, text: fact.text, reason: '缺统计定义。' },
          { type: 'list', items: [{ ...attr, text: fact.text, reason: '需确认样本。' }] },
          {
            type: 'table',
            title: '待核',
            headings: ['原句'],
            rows: [{ ...attr, cells: [fact.text], reason: '原始表缺失。' }],
          },
          {
            type: 'path_diagram',
            title: '核对路径',
            nodes: [{ ...attr, id: 'n', text: fact.text, reason: '需要原作者确认。' }],
            edges: [],
          },
        ],
      },
    ],
  };
  const used = f.requests.length,
    normalized = preserveDeepBoundaries(note, outline, cp);
  assert.deepEqual(preserveDeepBoundaries(normalized, outline, cp), normalized);
  checkDeepNote(normalized, outline, cp);
  assert.equal(f.requests.length, used);
  const originals = deepLeaves(normalized).filter((l) => l.prose === fact.text);
  assert.equal(originals.length, 1);
  for (const reason of ['缺统计定义', '需确认样本', '原始表缺失', '需要原作者确认'])
    assert(originals[0].reason?.includes(reason));
  assert(normalized.sections[0].blocks.some((b) => b.type === 'path_diagram' && b.nodes[0].id === 'n'));
});

test('LW01 different/unknown source positions and issue categories are retained; old completed draft remains readable', async () => {
  const f = await lwFixture(),
    raw = await f.rawStore.create({
      title: '深度定位合成',
      sourceType: 'report',
      sourceName: '合成',
      tags: [],
      body: '渠道覆盖口径存在疑点。',
    }),
    draft = await f.generate(raw.id, 'deep'),
    cp = (await new ExtractionCheckpointStore(f.root).get(draft.jobId))!,
    fact = cp.completedChunks[0].facts[0],
    e = cp.completedChunks[0].evidence[0];
  const outline: DeepOutline = {
    version: 1,
    sections: [{ id: 'core', title: '渠道', question: '什么口径？', factIds: [fact.id], questionIds: [] }],
    excluded: [],
  };
  const boundary = { rawId: cp.rawId, start: e.start, end: e.end, category: 'ambiguous' as const };
  const note: StructuredNote = {
    version: 1,
    orientation: '保留不同来源',
    sections: [
      {
        id: 'core',
        title: '渠道',
        question: '什么口径？',
        blocks: [
          { type: 'paragraph', role: 'source_supported', factIds: [fact.id], text: fact.text },
          {
            type: 'list',
            items: [
              { role: 'needs_verification', factIds: [], text: fact.text, reason: '没有位置A' },
              { role: 'needs_verification', factIds: [], text: fact.text, reason: '没有位置B' },
              {
                role: 'needs_verification',
                factIds: [],
                text: fact.text,
                reason: '不同Raw',
                sourceBoundary: { ...boundary, rawId: randomUUID() },
              },
              {
                role: 'needs_verification',
                factIds: [],
                text: fact.text,
                reason: '不同位置',
                sourceBoundary: { ...boundary, start: e.start + 1 },
              },
              {
                role: 'needs_verification',
                factIds: [],
                text: fact.text,
                reason: '不同类别',
                sourceBoundary: { ...boundary, category: 'question' },
              },
            ],
          },
        ],
      },
    ],
  };
  const result = preserveDeepBoundaries(note, outline, cp);
  for (const reason of ['没有位置A', '没有位置B', '不同Raw', '不同位置', '不同类别'])
    assert(deepLeaves(result).some((l) => l.reason === reason));
  assert.deepEqual(preserveDeepBoundaries(result, outline, cp), result);
  checkDeepNote(result, outline, cp);
  assert((await f.drafts.get(draft.id))!.structuredNote);
});

test('LW01 fact f-c1-1 and f-c1-10 prefix collision cannot confuse source positions in long multi-chunk assembly', async () => {
  const f = await lwFixture(),
    raw = await f.rawStore.create({
      title: '长文精确定位合成',
      sourceType: 'report',
      sourceName: '合成',
      tags: [],
      body: '背景'.repeat(4200) + '目标100家，在售20家。',
    }),
    draft = await f.generate(raw.id, 'deep'),
    cp = (await new ExtractionCheckpointStore(f.root).get(draft.jobId))!;
  assert(cp.completedChunks[0].facts.some((f) => f.id === 'f-c1-1'));
  assert(cp.completedChunks[0].facts.some((f) => f.id === 'f-c1-10'));
  const note = cp.deep!.note!,
    outline = cp.deep!.outline!;
  assert.deepEqual(preserveDeepBoundaries(note, outline, cp), note);
  checkDeepNote(note, outline, cp);
});
