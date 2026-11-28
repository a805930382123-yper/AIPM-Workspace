import type { Blueprint, BlueprintCheck } from './types.ts';
export function checksFor(b: Blueprint, invalidEvidence: Set<string>): BlueprintCheck[] {
  const result: BlueprintCheck[] = [];
  const add = (code: BlueprintCheck['code'], collection: string, id: string, message: string) =>
    result.push({ code, collection, id, message });
  for (const f of b.features)
    if (f.priority !== 'wont' && !f.valueIds.length) add('C1', 'features', f.id, '功能没有来源价值。');
  for (const v of b.values)
    if (!b.features.some((f) => f.priority !== 'wont' && f.valueIds.includes(v.id)))
      add('C2', 'values', v.id, '价值没有功能承接。');
  for (const p of b.pains)
    if (!b.values.some((v) => v.painIds.includes(p.id))) add('C3', 'pains', p.id, '痛点没有被价值覆盖。');
  for (const p of b.personas)
    if (
      p.relations.some((r) => r === 'user' || r === 'decision_maker') &&
      !b.values.some((v) => v.personaIds.includes(p.id))
    )
      add('C4', 'personas', p.id, '角色没有价值覆盖。');
  for (const f of b.features)
    if (
      f.priority === 'must' &&
      f.phase === 'mvp' &&
      f.valueIds.length &&
      f.valueIds.every((id) => b.values.find((v) => v.id === id)?.confidence === 'assumed')
    )
      add('C5', 'features', f.id, '必须功能的来源价值均为假设。');
  for (const p of b.pains)
    if (p.kind === 'fact' && invalidEvidence.has(p.id)) add('C6', 'pains', p.id, '事实依据失效。');
  for (const m of b.milestones) if (!m.featureIds.length) add('C7', 'milestones', m.id, '里程碑没有包含功能。');
  for (const f of b.features)
    if (f.priority === 'must' && f.phase === 'mvp' && !b.milestones.some((m) => m.featureIds.includes(f.id)))
      add('C7', 'features', f.id, '必须功能没有进入里程碑。');
  return result;
}
