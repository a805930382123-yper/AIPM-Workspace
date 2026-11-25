// Accepted Batch 1A SQLite results from evals/reports/batch-1a-baseline.md.
export const FROZEN_FTS = {
  a: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
  b: ['B2', 'B3', 'B5'],
  bMisses: ['B1', 'B4'],
  c: ['C1', 'C2', 'C3', 'C4', 'C5'],
  d: ['D1', 'D2', 'D3'],
  falseRecalls: ['E1', 'E3', 'E4', 'E5'],
  negativeCases: ['E1', 'E2', 'E3', 'E4', 'E5'],
  longAnchors: 9,
} as const;

type Grade = { hit: boolean; heading: boolean; falseRecall: boolean };
type Scorecard = { grades: ReadonlyMap<string, Grade>; longAnchors: number };

export function judgeRetrievalQuality(
  sqlite: Scorecard,
  hybrid: (Scorecard & { vectorChecks: number }) | undefined,
  requestedLive: boolean,
) {
  const requiredLocations = [...FROZEN_FTS.a, ...FROZEN_FTS.c, ...FROZEN_FTS.d];
  const frozenHits = [...requiredLocations, ...FROZEN_FTS.b];
  const sqliteProblems: string[] = [];
  for (const id of [...frozenHits, ...FROZEN_FTS.bMisses, ...FROZEN_FTS.negativeCases]) {
    const grade = sqlite.grades.get(id);
    const positive = frozenHits.some((expected) => expected === id);
    const falseRecall = FROZEN_FTS.falseRecalls.some((expected) => expected === id);
    if (!grade || grade.hit !== positive || grade.heading !== positive || grade.falseRecall !== falseRecall)
      sqliteProblems.push(`${id} 与冻结结果不同`);
  }
  if (sqlite.longAnchors !== FROZEN_FTS.longAnchors) sqliteProblems.push('长页定位未达 9/9');

  let hybridProblems: string[] | undefined;
  if (hybrid) {
    hybridProblems = [];
    for (const id of requiredLocations) {
      const grade = hybrid.grades.get(id);
      if (!grade?.hit || !grade.heading) hybridProblems.push(`${id} 命中或章节定位未达冻结结果`);
    }
    for (const id of FROZEN_FTS.b) {
      if (!hybrid.grades.get(id)?.hit) hybridProblems.push(`${id} 原有 B 类命中未保留`);
    }
    const bHits = [...FROZEN_FTS.b, ...FROZEN_FTS.bMisses].filter((id) => hybrid.grades.get(id)?.hit).length;
    if (bHits < 4) hybridProblems.push('B 类命中低于 4/5');
    const negatives = FROZEN_FTS.negativeCases.map((id) => hybrid.grades.get(id));
    if (negatives.some((grade) => !grade)) hybridProblems.push('E 类缺少逐题结果');
    if (negatives.filter((grade) => grade?.falseRecall).length > FROZEN_FTS.falseRecalls.length)
      hybridProblems.push('E 类误召回超过 4/5');
    if (hybrid.longAnchors !== FROZEN_FTS.longAnchors) hybridProblems.push('长页定位未达 9/9');
    if (hybrid.vectorChecks < 1) hybridProblems.push('缺少已核验的纯向量引文');
  }

  const exitCode = sqliteProblems.length || hybridProblems?.length ? 1 : requestedLive && !hybrid ? 2 : 0;
  return { sqliteProblems, hybridProblems, exitCode };
}
