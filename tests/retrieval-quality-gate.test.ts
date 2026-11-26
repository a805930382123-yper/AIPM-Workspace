import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { judgeRetrievalQuality } from '../scripts/retrieval-quality-gate.ts';

const report = await readFile(new URL('../evals/reports/batch-1a-baseline.md', import.meta.url), 'utf8');
const grades = new Map(
  [...report.matchAll(/^\| ([A-E]\d) \| sqlite_fts \| (是|否|—) \| (是|否|—) \| (是|否|—) \|/gmu)].map(
    ([, id, hit, heading, falseRecall]) => [
      id,
      { hit: hit === '是', heading: heading === '是', falseRecall: falseRecall === '是' },
    ],
  ),
);
assert.equal(grades.size, 25);

function scores() {
  const sqlite = { grades: new Map(grades), longAnchors: 9 };
  const hybrid = { grades: new Map(grades), longAnchors: 9, vectorChecks: 1 };
  hybrid.grades.set('B1', { ...grades.get('B1')!, hit: true, heading: true });
  return { sqlite, hybrid };
}

test('frozen SQLite passes offline while Hybrid remains unverified and missing live configuration exits 2', () => {
  const { sqlite, hybrid } = scores();
  assert.deepEqual(judgeRetrievalQuality(sqlite, undefined, false), {
    sqliteProblems: [],
    hybridProblems: undefined,
    exitCode: 0,
  });
  assert.equal(judgeRetrievalQuality(sqlite, undefined, true).exitCode, 2);
  assert.deepEqual(judgeRetrievalQuality(sqlite, hybrid, true), {
    sqliteProblems: [],
    hybridProblems: [],
    exitCode: 0,
  });
});

test('an exact gold hit in the wrong A/C/D heading causes the live quality gate to fail', () => {
  for (const id of ['A1', 'C1', 'D1']) {
    const { sqlite, hybrid } = scores();
    hybrid.grades.set(id, { ...grades.get(id)!, heading: false });
    const result = judgeRetrievalQuality(sqlite, hybrid, true);
    assert.deepEqual(result.sqliteProblems, []);
    assert.equal(result.hybridProblems?.length, 1);
    assert.match(result.hybridProblems![0], new RegExp('^' + id));
    assert.equal(result.exitCode, 1);
  }
});

test('matching degraded reruns of SQLite and Hybrid do not move the frozen comparison', () => {
  const { sqlite, hybrid } = scores();
  for (const run of [sqlite, hybrid]) run.grades.set('D2', { ...grades.get('D2')!, hit: false, heading: false });
  const result = judgeRetrievalQuality(sqlite, hybrid, true);
  assert.match(result.sqliteProblems[0], /^D2/u);
  assert.match(result.hybridProblems![0], /^D2/u);
  assert.equal(result.exitCode, 1);
  assert.equal(judgeRetrievalQuality(sqlite, undefined, false).exitCode, 1);
});

test('four B hits must preserve the three original cases and a drifting E rerun cannot raise the limit', () => {
  const { sqlite, hybrid } = scores();
  sqlite.grades.set('E2', { ...grades.get('E2')!, falseRecall: true });
  hybrid.grades.set('E2', { ...grades.get('E2')!, falseRecall: true });
  hybrid.grades.set('B2', { ...grades.get('B2')!, hit: false, heading: false });
  hybrid.grades.set('B4', { ...grades.get('B4')!, hit: true, heading: true });
  const result = judgeRetrievalQuality(sqlite, hybrid, true);
  assert.match(result.sqliteProblems[0], /^E2/u);
  assert.deepEqual(result.hybridProblems, ['B2 原有 B 类命中未保留', 'E 类误召回超过 4/5']);
  assert.equal(result.exitCode, 1);
});

test('improving B by one, all nine long-page anchors and verified vector citations are independently required', () => {
  const { sqlite, hybrid } = scores();
  hybrid.grades.set('B1', grades.get('B1')!);
  hybrid.longAnchors = 8;
  hybrid.vectorChecks = 0;
  const result = judgeRetrievalQuality(sqlite, hybrid, true);
  assert.deepEqual(result.hybridProblems, ['B 类命中低于 4/5', '长页定位未达 9/9', '缺少已核验的纯向量引文']);
  assert.equal(result.exitCode, 1);
});

test('the explicit FTS repair reference expects B1 to improve and keeps the historical and Hybrid checks intact', () => {
  const { sqlite, hybrid } = scores();
  assert.equal(judgeRetrievalQuality(sqlite, undefined, false, 'fts-repair').exitCode, 1);
  sqlite.grades.set('B1', { ...grades.get('B1')!, hit: true, heading: true });
  assert.equal(judgeRetrievalQuality(sqlite, undefined, false).exitCode, 1);
  assert.equal(judgeRetrievalQuality(sqlite, undefined, false, 'fts-repair').exitCode, 0);
  assert.equal(judgeRetrievalQuality(sqlite, undefined, true, 'fts-repair').exitCode, 2);
  assert.equal(judgeRetrievalQuality(sqlite, hybrid, true, 'fts-repair').exitCode, 0);
  hybrid.grades.set('E2', { ...grades.get('E2')!, falseRecall: true });
  assert.deepEqual(judgeRetrievalQuality(sqlite, hybrid, true, 'fts-repair').hybridProblems, ['E 类误召回超过 4/5']);
  sqlite.grades.set('B1', { ...grades.get('B1')!, hit: true, heading: false });
  sqlite.grades.set('E2', { ...grades.get('E2')!, falseRecall: true });
  assert.deepEqual(judgeRetrievalQuality(sqlite, undefined, false, 'fts-repair').sqliteProblems, [
    'B1 与FTS 修复预期不同',
    'E2 与FTS 修复预期不同',
  ]);
});
