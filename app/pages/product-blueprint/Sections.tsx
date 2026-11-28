import type { Blueprint, BlueprintDetail } from '../../../services/product-blueprints/types';
import { Card, Field, Multi, Select, key } from './Fields';

type Props = {
  draft: Blueprint;
  saved: Blueprint;
  detail: BlueprintDetail;
  change: (next: Blueprint) => void;
  onOpenRaw: (id: string) => void;
  choices?: { raw: [string, string][]; wiki: [string, string][]; workItems: [string, string][] };
};
const empty = [['', '未选择']] as [string, string][];
const statuses: [string, string][] = [
  ['exploring', '探索中'],
  ['defining', '定义中'],
  ['planning', '规划中'],
  ['executing', '执行中'],
  ['paused', '暂停'],
  ['archived', '已归档'],
];
const relations: [string, string][] = [
  ['decision_maker', '决策者'],
  ['user', '使用者'],
  ['affected', '受影响者'],
  ['payer', '付费方'],
];

export function Background({ draft: d, detail, change, onOpenRaw, choices }: Props) {
  const update = (field: keyof Blueprint['context'], value: string) =>
    change({ ...d, context: { ...d.context, [field]: value } });
  return (
    <>
      <Field label="构想名称" value={d.title} onChange={(title) => change({ ...d, title })} />
      <Field label="一句话定义" value={d.oneLiner} onChange={(oneLiner) => change({ ...d, oneLiner })} />
      <Select
        label="状态"
        value={d.status}
        options={statuses}
        onChange={(status) => change({ ...d, status: status as Blueprint['status'] })}
      />
      <Field label="业务背景" value={d.context.background} onChange={(v) => update('background', v)} multiline />
      <Field label="业务目标" value={d.context.businessGoal} onChange={(v) => update('businessGoal', v)} multiline />
      <Field label="约束条件" value={d.context.constraints} onChange={(v) => update('constraints', v)} multiline />
      {(['rawIds', 'wikiIds', 'workItemIds'] as const).map((field, i) => (
        <div key={field} className="pb-card">
          <strong>{['关联 Raw', '关联 Wiki', '关联工作事项'][i]}</strong>
          <Multi
            label="选择已有资料"
            values={d.links[field]}
            options={(() => {
              const sources = i === 0 ? detail.sources.raw : i === 1 ? detail.sources.wiki : detail.sources.workItems;
              const available = (
                i === 0 ? choices?.raw || [] : i === 1 ? choices?.wiki || [] : choices?.workItems || []
              ).filter(([id]) => !sources.some((source) => source.id === id && !source.available));
              return [
                ...available,
                ...d.links[field]
                  .filter((id) => !available.some(([candidate]) => candidate === id))
                  .map((id) => [id, id + '（不可用）'] as [string, string]),
              ];
            })()}
            onChange={(ids) => change({ ...d, links: { ...d.links, [field]: ids } })}
          />
          {(i === 0 ? detail.sources.raw : i === 1 ? detail.sources.wiki : detail.sources.workItems).map((s) => (
            <div key={s.id}>
              {s.available ? s.title || s.id : s.id} {s.available ? '可用' : '不可用（可能已删除或受限）'}{' '}
              {i === 0 && s.available && (
                <button type="button" className="text-button" onClick={() => onOpenRaw(s.id)}>
                  打开原文
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function Users({ draft: d, saved, detail, choices, change, onOpenRaw }: Props) {
  const personas = d.personas.map((p) => [p.id, p.name || '未命名角色'] as [string, string]);
  const scenarios = d.scenarios.map((s) => [s.id, s.task || '未命名场景'] as [string, string]);
  const patch = <K extends 'personas' | 'scenarios' | 'pains' | 'alternatives'>(
    collection: K,
    id: string,
    values: Partial<Blueprint[K][number]>,
  ) => change({ ...d, [collection]: d[collection].map((item) => (item.id === id ? { ...item, ...values } : item)) });
  const remove = (collection: 'personas' | 'scenarios' | 'pains' | 'alternatives', id: string) =>
    change({ ...d, [collection]: d[collection].filter((item) => item.id !== id) });
  const addPersona = (name = '', side: 'internal' | 'external' = 'internal') =>
    change({
      ...d,
      personas: [...d.personas, { id: key(), name, side, relations: ['user'], profile: '', frequency: '' }],
    });
  return (
    <>
      <h3>角色</h3>
      <button type="button" onClick={() => addPersona()}>
        添加角色
      </button>
      <details>
        <summary>从预设角色填充</summary>
        {(['internal', 'external'] as const).map((side) => (
          <div key={side}>
            <strong>{side === 'internal' ? '内部' : '外部'}</strong>
            <div className="pb-presets">
              {(side === 'internal'
                ? ['业务员', '区域经理', '渠道/KA运营', '市场部', '财务', 'IT']
                : ['经销商老板', '经销商业务员', '门店店主/店员', '导购/促销员', 'KA采购', '消费者']
              ).map((name) => (
                <button type="button" key={name} onClick={() => addPersona(name, side)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>
      {d.personas.map((p) => (
        <Card key={p.id} id={p.id} title={p.name || '新角色'} onRemove={() => remove('personas', p.id)}>
          <Field label="角色名称" value={p.name} onChange={(name) => patch('personas', p.id, { name })} />
          <Select
            label="内外部"
            value={p.side}
            options={[
              ['internal', '内部'],
              ['external', '外部'],
            ]}
            onChange={(side) => patch('personas', p.id, { side: side as typeof p.side })}
          />
          <Multi
            label="与产品的关系"
            values={p.relations}
            options={relations}
            onChange={(v) => patch('personas', p.id, { relations: v as typeof p.relations })}
          />
          <Field
            label="画像"
            value={p.profile}
            multiline
            onChange={(profile) => patch('personas', p.id, { profile })}
          />
          <Field
            label="使用频率"
            value={p.frequency}
            onChange={(frequency) => patch('personas', p.id, { frequency })}
          />
          <Select
            label="关联 Wiki（可选）"
            value={p.wikiId || ''}
            options={[
              ...empty,
              ...(choices?.wiki || []).filter(([id]) => !detail.sources.wiki.some((s) => s.id === id && !s.available)),
              ...(p.wikiId &&
              (!choices?.wiki.some(([id]) => id === p.wikiId) ||
                detail.sources.wiki.some((s) => s.id === p.wikiId && !s.available))
                ? [[p.wikiId, p.wikiId + '（不可用）'] as [string, string]]
                : []),
            ]}
            onChange={(wikiId) => patch('personas', p.id, { wikiId: wikiId || undefined })}
          />
        </Card>
      ))}
      <h3>使用场景与任务</h3>
      <button
        type="button"
        onClick={() => change({ ...d, scenarios: [...d.scenarios, { id: key(), when: '', task: '', outcome: '' }] })}
      >
        添加场景
      </button>
      {d.scenarios.map((s) => (
        <Card key={s.id} id={s.id} title="场景" onRemove={() => remove('scenarios', s.id)}>
          <Select
            label="角色"
            value={s.personaId || ''}
            options={[...empty, ...personas]}
            onChange={(v) => patch('scenarios', s.id, { personaId: v || undefined })}
          />
          <Field label="当……时" value={s.when} onChange={(when) => patch('scenarios', s.id, { when })} />
          <Field label="想要完成的任务" value={s.task} onChange={(task) => patch('scenarios', s.id, { task })} />
          <Field
            label="以便达到的结果"
            value={s.outcome}
            onChange={(outcome) => patch('scenarios', s.id, { outcome })}
          />
        </Card>
      ))}
      <h3>痛点</h3>
      <button
        type="button"
        onClick={() =>
          change({ ...d, pains: [...d.pains, { id: key(), text: '', kind: 'inference', severity: 'medium' }] })
        }
      >
        添加痛点
      </button>
      {d.pains.map((p) => (
        <Card key={p.id} id={p.id} title="痛点" onRemove={() => remove('pains', p.id)}>
          <Select
            label="角色"
            value={p.personaId || ''}
            options={[...empty, ...personas]}
            onChange={(v) => patch('pains', p.id, { personaId: v || undefined })}
          />
          <Select
            label="场景"
            value={p.scenarioId || ''}
            options={[...empty, ...scenarios]}
            onChange={(v) => patch('pains', p.id, { scenarioId: v || undefined })}
          />
          <Field label="痛点内容" value={p.text} multiline onChange={(text) => patch('pains', p.id, { text })} />
          <Select
            label="类型"
            value={p.kind}
            options={[
              ['fact', '事实'],
              ['inference', '推断'],
              ['question', '待验证'],
            ]}
            onChange={(kind) => patch('pains', p.id, { kind: kind as typeof p.kind })}
          />
          <Select
            label="严重程度"
            value={p.severity}
            options={[
              ['high', '高'],
              ['medium', '中'],
              ['low', '低'],
            ]}
            onChange={(severity) => patch('pains', p.id, { severity: severity as typeof p.severity })}
          />
          {p.kind === 'fact' && (
            <>
              <Select
                label="事实来源 Raw"
                value={p.evidence?.rawId || ''}
                options={[
                  ...empty,
                  ...saved.links.rawIds.map((id) => {
                    const source = detail.sources.raw.find((s) => s.id === id);
                    return [id, source?.available ? source.title || id : id + '（不可用）'] as [string, string];
                  }),
                ]}
                onChange={(rawId) => patch('pains', p.id, { evidence: { rawId, quote: '' }, evidenceRedacted: false })}
              />
              {p.evidenceRedacted ? (
                <p>来源不可用（可能已删除或受限），引文不可显示。</p>
              ) : (
                <Field
                  label="逐字引文（最多 500 字）"
                  value={p.evidence?.quote || ''}
                  multiline
                  onChange={(quote) => patch('pains', p.id, { evidence: { rawId: p.evidence?.rawId || '', quote } })}
                />
              )}
              {p.evidence?.rawId &&
                !detail.sources.raw.find((s) => s.id === p.evidence?.rawId)?.available &&
                !p.evidenceRedacted && <p>来源不可用（可能已删除或受限），依据失效。</p>}
              {p.evidence?.rawId &&
                !p.evidenceRedacted &&
                detail.sources.raw.some((s) => s.id === p.evidence?.rawId && s.available) && (
                  <button type="button" onClick={() => onOpenRaw(p.evidence!.rawId)}>
                    打开原文
                  </button>
                )}
            </>
          )}
        </Card>
      ))}
      <h3>现有替代方案</h3>
      <button
        type="button"
        onClick={() =>
          change({ ...d, alternatives: [...d.alternatives, { id: key(), currentApproach: '', cost: '' }] })
        }
      >
        添加替代方案
      </button>
      {d.alternatives.map((a) => (
        <Card key={a.id} id={a.id} title="替代方案" onRemove={() => remove('alternatives', a.id)}>
          <Select
            label="角色"
            value={a.personaId || ''}
            options={[...empty, ...personas]}
            onChange={(v) => patch('alternatives', a.id, { personaId: v || undefined })}
          />
          <Field
            label="目前怎么做"
            value={a.currentApproach}
            multiline
            onChange={(currentApproach) => patch('alternatives', a.id, { currentApproach })}
          />
          <Field label="代价" value={a.cost} multiline onChange={(cost) => patch('alternatives', a.id, { cost })} />
        </Card>
      ))}
    </>
  );
}

export function Values({ draft: d, saved, change }: Props) {
  const patch = (id: string, v: Partial<Blueprint['values'][number]>) =>
    change({ ...d, values: d.values.map((item) => (item.id === id ? { ...item, ...v } : item)) });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          change({
            ...d,
            values: [
              ...d.values,
              { id: key(), personaIds: [], painIds: [], advantage: '', confidence: 'assumed', validation: '' },
            ],
          })
        }
      >
        添加价值
      </button>
      {d.values.map((v) => (
        <Card
          key={v.id}
          id={v.id}
          title="价值主张"
          onRemove={() => change({ ...d, values: d.values.filter((x) => x.id !== v.id) })}
        >
          <Multi
            label="面向角色"
            values={v.personaIds}
            options={saved.personas.map((p) => [p.id, p.name])}
            onChange={(personaIds) => patch(v.id, { personaIds })}
          />
          <Multi
            label="覆盖痛点"
            values={v.painIds}
            options={saved.pains.map((p) => [p.id, p.text || '未命名痛点'])}
            onChange={(painIds) => patch(v.id, { painIds })}
          />
          <Field label="优势" value={v.advantage} multiline onChange={(advantage) => patch(v.id, { advantage })} />
          <Select
            label="置信度"
            value={v.confidence}
            options={[
              ['verified', '已验证'],
              ['assumed', '假设'],
            ]}
            onChange={(confidence) => patch(v.id, { confidence: confidence as typeof v.confidence })}
          />
          <Field
            label="验证方式"
            value={v.validation}
            multiline
            onChange={(validation) => patch(v.id, { validation })}
          />
        </Card>
      ))}
    </>
  );
}
export function Features({ draft: d, saved, change }: Props) {
  const patch = (id: string, v: Partial<Blueprint['features'][number]>) =>
    change({ ...d, features: d.features.map((item) => (item.id === id ? { ...item, ...v } : item)) });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          change({
            ...d,
            features: [
              ...d.features,
              { id: key(), title: '', description: '', valueIds: [], priority: 'must', phase: 'mvp', wontReason: '' },
            ],
          })
        }
      >
        添加功能
      </button>
      {d.features.map((f) => (
        <Card
          key={f.id}
          id={f.id}
          title={f.title || '功能'}
          onRemove={() => change({ ...d, features: d.features.filter((x) => x.id !== f.id) })}
        >
          <Field label="功能名称" value={f.title} onChange={(title) => patch(f.id, { title })} />
          <Field
            label="功能描述"
            value={f.description}
            multiline
            onChange={(description) => patch(f.id, { description })}
          />
          <Multi
            label="来源价值"
            values={f.valueIds}
            options={saved.values.map((v) => [v.id, v.advantage || '未命名价值'])}
            onChange={(valueIds) => patch(f.id, { valueIds })}
          />
          <Select
            label="优先级"
            value={f.priority}
            options={[
              ['must', '必须'],
              ['should', '应该'],
              ['could', '可以'],
              ['wont', '不做'],
            ]}
            onChange={(priority) => patch(f.id, { priority: priority as typeof f.priority })}
          />
          <Select
            label="阶段"
            value={f.phase}
            options={[
              ['mvp', 'MVP'],
              ['v1', 'V1'],
              ['later', '后续'],
            ]}
            onChange={(phase) => patch(f.id, { phase: phase as typeof f.phase })}
          />
          {f.priority === 'wont' && (
            <Field
              label="不做理由"
              value={f.wontReason}
              multiline
              onChange={(wontReason) => patch(f.id, { wontReason })}
            />
          )}
        </Card>
      ))}
    </>
  );
}
export function Concept({ draft: d, saved, change }: Props) {
  const vision = (v: Partial<Blueprint['vision']>) => change({ ...d, vision: { ...d.vision, ...v } });
  return (
    <>
      <Field label="北极星" value={d.vision.northStar} multiline onChange={(northStar) => vision({ northStar })} />
      <Field
        label="目标用户范围"
        value={d.vision.targetScope}
        multiline
        onChange={(targetScope) => vision({ targetScope })}
      />
      <Field label="不做范围" value={d.vision.outOfScope} multiline onChange={(outOfScope) => vision({ outOfScope })} />
      <h3>成功指标</h3>
      <button
        type="button"
        onClick={() => vision({ metrics: [...d.vision.metrics, { id: key(), name: '', definition: '', target: '' }] })}
      >
        添加指标
      </button>
      {d.vision.metrics.map((m) => (
        <Card
          key={m.id}
          id={m.id}
          title={m.name || '指标'}
          onRemove={() => vision({ metrics: d.vision.metrics.filter((x) => x.id !== m.id) })}
        >
          {(['name', 'definition', 'target'] as const).map((f, i) => (
            <Field
              key={f}
              label={['名称', '口径', '目标'][i]}
              value={m[f]}
              onChange={(v) => vision({ metrics: d.vision.metrics.map((x) => (x.id === m.id ? { ...x, [f]: v } : x)) })}
            />
          ))}
        </Card>
      ))}
      <h3>风险</h3>
      <button type="button" onClick={() => vision({ risks: [...d.vision.risks, { id: key(), text: '' }] })}>
        添加风险
      </button>
      {d.vision.risks.map((r) => (
        <Card
          key={r.id}
          id={r.id}
          title="风险"
          onRemove={() => vision({ risks: d.vision.risks.filter((x) => x.id !== r.id) })}
        >
          <Field
            label="风险内容"
            value={r.text}
            multiline
            onChange={(text) => vision({ risks: d.vision.risks.map((x) => (x.id === r.id ? { ...x, text } : x)) })}
          />
        </Card>
      ))}
      <h3>里程碑</h3>
      <button
        type="button"
        onClick={() =>
          change({
            ...d,
            milestones: [...d.milestones, { id: key(), title: '', targetWeek: '', featureIds: [], deliverable: '' }],
          })
        }
      >
        添加里程碑
      </button>
      {d.milestones.map((m) => (
        <Card
          key={m.id}
          id={m.id}
          title={m.title || '里程碑'}
          onRemove={() => change({ ...d, milestones: d.milestones.filter((x) => x.id !== m.id) })}
        >
          <Field
            label="名称"
            value={m.title}
            onChange={(title) =>
              change({ ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, title } : x)) })
            }
          />
          <Field
            label="目标周（YYYY-Www）"
            value={m.targetWeek}
            onChange={(targetWeek) =>
              change({ ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, targetWeek } : x)) })
            }
          />
          <Multi
            label="包含功能"
            values={m.featureIds}
            options={saved.features.map((f) => [f.id, f.title || '未命名功能'])}
            onChange={(featureIds) =>
              change({ ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, featureIds } : x)) })
            }
          />
          <Field
            label="交付物"
            value={m.deliverable}
            multiline
            onChange={(deliverable) =>
              change({ ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, deliverable } : x)) })
            }
          />
        </Card>
      ))}
    </>
  );
}
