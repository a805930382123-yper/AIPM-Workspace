import type { BlueprintDetail } from './types.ts';
export function exportBlueprint({ blueprint: b, checks, sources }: BlueprintDetail): string {
  const text = (value: string | undefined) =>
    (value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&')
      .replace(/\r?\n/g, '  \n');
  const names: Record<string, string> = {
    internal: '内部',
    external: '外部',
    decision_maker: '决策者',
    user: '使用者',
    affected: '受影响者',
    payer: '付费方',
    high: '高',
    medium: '中',
    low: '低',
    verified: '已验证',
    assumed: '假设',
    must: '必须',
    should: '应该',
    could: '可以',
    wont: '不做',
    mvp: 'MVP',
    v1: 'V1',
    later: '后续',
    exploring: '探索中',
    defining: '定义中',
    planning: '规划中',
    executing: '执行中',
    paused: '暂停',
    archived: '已归档',
  };
  const namesFor = (
    ids: string[],
    items: { id: string; name?: string; title?: string; text?: string; advantage?: string }[],
  ) =>
    ids
      .map((id) =>
        text(
          items.find((x) => x.id === id)?.name ??
            items.find((x) => x.id === id)?.title ??
            items.find((x) => x.id === id)?.text ??
            items.find((x) => x.id === id)?.advantage ??
            id,
        ),
      )
      .join('、') || '无';
  const link = (list: typeof sources.raw) => list.map((x) => text(x.title ?? `${x.id}（不可用）`)).join('、') || '无';
  const lines = [
    `# ${text(b.title)}`,
    `状态：${names[b.status]}`,
    '',
    '## 背景',
    `一句话定义：${text(b.oneLiner)}`,
    `业务背景：${text(b.context.background)}`,
    `业务目标：${text(b.context.businessGoal)}`,
    `约束条件：${text(b.context.constraints)}`,
    `关联 Raw：${link(sources.raw)}`,
    `关联 Wiki：${link(sources.wiki.filter((x) => b.links.wikiIds.includes(x.id)))}`,
    `关联工作事项：${link(sources.workItems)}`,
    '',
    '## 使用者',
  ];
  for (const p of b.personas)
    lines.push(
      `- 角色：${text(p.name)}（${names[p.side]}；${p.relations.map((r) => names[r]).join('、')}）；画像：${text(p.profile)}；频率：${text(p.frequency)}${p.wikiId ? `；Wiki：${link(sources.wiki.filter((x) => x.id === p.wikiId))}` : ''}`,
    );
  for (const s of b.scenarios)
    lines.push(
      `- 场景：角色 ${namesFor(s.personaId ? [s.personaId] : [], b.personas)}；情境 ${text(s.when)}；任务 ${text(s.task)}；结果 ${text(s.outcome)}`,
    );
  for (const [kind, label] of [
    ['fact', '事实'],
    ['inference', '推断'],
    ['question', '待验证'],
  ] as const) {
    lines.push(`### ${label}`);
    for (const p of b.pains.filter((x) => x.kind === kind)) {
      lines.push(
        `- ${text(p.text)}（严重程度：${names[p.severity]}；角色：${namesFor(p.personaId ? [p.personaId] : [], b.personas)}；场景：${p.scenarioId ? text(b.scenarios.find((s) => s.id === p.scenarioId)?.task ?? p.scenarioId) : '无'}）`,
      );
      if (p.kind === 'fact' && p.evidence) {
        const invalid = checks.some((c) => c.code === 'C6' && c.id === p.id);
        if (p.evidenceRedacted) lines.push('  - 依据失效或不可用。');
        else
          lines.push(
            `  - 来源：${text(sources.raw.find((x) => x.id === p.evidence!.rawId)?.title ?? p.evidence.rawId)}；引文：${text(p.evidence.quote)}${invalid ? '；依据失效' : ''}`,
          );
      }
    }
  }
  for (const a of b.alternatives)
    lines.push(
      `- 替代方案：${text(a.currentApproach)}；代价：${text(a.cost)}；角色：${namesFor(a.personaId ? [a.personaId] : [], b.personas)}`,
    );
  lines.push('', '## 价值');
  for (const v of b.values)
    lines.push(
      `- ${text(v.advantage)}（${names[v.confidence]}）；验证：${text(v.validation)}；角色：${namesFor(v.personaIds, b.personas)}；痛点：${namesFor(v.painIds, b.pains)}`,
    );
  lines.push('', '## 功能');
  for (const f of b.features)
    lines.push(
      `- ${text(f.title)}：${text(f.description)}（${names[f.priority]} / ${names[f.phase]}）；理由：${text(f.wontReason)}；来源价值：${namesFor(f.valueIds, b.values)}`,
    );
  lines.push(
    '',
    '## 构想',
    `北极星：${text(b.vision.northStar)}`,
    `目标用户范围：${text(b.vision.targetScope)}`,
    `不做范围：${text(b.vision.outOfScope)}`,
  );
  for (const m of b.vision.metrics)
    lines.push(`- 指标：${text(m.name)}；口径：${text(m.definition)}；目标：${text(m.target)}`);
  for (const r of b.vision.risks) lines.push(`- 风险：${text(r.text)}`);
  for (const m of b.milestones)
    lines.push(
      `- 里程碑：${text(m.title)}；目标周：${text(m.targetWeek)}；交付物：${text(m.deliverable)}；功能：${namesFor(m.featureIds, b.features)}`,
    );
  lines.push(
    '',
    '## 追溯检查',
    ...(checks.length ? checks.map((c) => `- ${c.code}：${text(c.message)}（${text(c.id)}）`) : ['- 暂无提示。']),
    '',
  );
  return lines.join('\n');
}
