import { useEffect, useRef, useState } from 'react';
import {
  currentInspection,
  getInspection,
  startInspection,
  decideInspection,
  draftInspection,
  inspectionEvidence,
  type KnowledgeInspection,
  type Wiki,
} from '../api';
import type { AnswerCitation } from '../../services/wiki/question-input';
import type { RawCitationTarget } from './WikiQuestionPanel';
import { useLlmDisabled } from '../hooks/llmAvailability';
const types = {
  duplicate: '重复主题候选',
  conflict: '冲突 / 口径待核',
  outdated: '可能过时（有更新依据）',
  source_impact: '来源变化影响',
};
export function inspectionSummary(record: KnowledgeInspection) {
  const read = record.scope.read.length;
  const dimensions = (Object.keys(types) as Array<keyof typeof types>).map((type) => {
    const count = record.findings.filter((finding) => finding.type === type).length;
    if (count) return { type, state: 'issues_found', label: '发现 ' + count + ' 项', reason: '' };
    if (type === 'source_impact' && !record.sourceComparisonCount)
      return {
        type,
        state: 'unavailable',
        label: '无法比对',
        reason:
          record.sourceComparisonCount === undefined ? '旧记录未提供快照比对次数。' : '本次没有完成旧来源快照比对。',
      };
    if (!read || (read < 2 && type !== 'source_impact'))
      return {
        type,
        state: 'skipped',
        label: '未触发',
        reason: !read
          ? '没有读到知识页。'
          : type === 'conflict'
            ? '仅核对了页内说法，未做跨页对照。'
            : '实读不足两页，未做跨页对照。',
      };
    return { type, state: 'passed', label: '已通过（未发现）', reason: '' };
  });
  const limited =
    record.status === 'partial' ||
    record.scope.skipped.length > 0 ||
    dimensions.some((item) => item.state === 'skipped' || item.state === 'unavailable');
  const pending = record.findings.filter((finding) => finding.status !== 'committed').length;
  return {
    dimensions,
    tone: record.findings.length ? 'review' : limited ? 'limited' : 'clean',
    headline: record.findings.length
      ? '检查发现 ' + record.findings.length + ' 项建议，' + (pending ? '待确认 ' + pending + ' 项' : '均已审核提交')
      : limited
        ? '已读范围未发现待处理建议，部分检查受限'
        : '检查完成：未发现待处理问题',
  };
}
const steps = { preserve_differences: '保留差异', add_note: '补充说明', change_topic: '修改主题', defer: '暂缓' };
const statuses = {
  queued: '排队中',
  checking: '正在检查',
  completed: '检查完成',
  partial: '部分完成，存在范围缺口',
  failed: '检查失败',
};
const stages: Record<string, string> = {
  queued: '等待读取',
  reading: '正在读取本次知识范围',
  partial: '本次结束，仍有缺口',
  retrieving: '读取有界知识范围',
  checking: '核对已读知识',
  analyzing: '分析已读依据',
  completed: '本次检查结束',
  failed: '本次操作失败',
  saving_draft: '生成维护草稿',
};
export function WikiInspectionPanel({
  items,
  currentWikiId,
  initialInspectionId,
  onOpenWiki,
  onOpenRaw,
  onOpenDraft,
}: {
  items: Wiki[];
  currentWikiId: string | null;
  initialInspectionId?: string;
  onOpenWiki: (id: string, citation?: AnswerCitation) => void;
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onOpenDraft: (id: string) => void;
}) {
  const checkDisabled = useLlmDisabled('light');
  const draftDisabled = useLlmDisabled();
  const [selected, setSelected] = useState<string[]>(currentWikiId ? [currentWikiId] : []),
    [related, setRelated] = useState(false),
    [result, setResult] = useState<KnowledgeInspection | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [chosen, setChosen] = useState<string[]>([]),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const [scopeQuery, setScopeQuery] = useState('');
  const generation = useRef(0),
    draftKey = useRef(crypto.randomUUID());
  const working = result?.status === 'queued' || result?.status === 'checking',
    locked = busy || working;
  const trimmedScopeQuery = scopeQuery.trim().toLocaleLowerCase();
  const filteredItems = trimmedScopeQuery
    ? items.filter((p) => p.title.toLocaleLowerCase().includes(trimmedScopeQuery))
    : items;
  useEffect(() => {
    const turn = generation.current;
    const read = initialInspectionId ? getInspection(initialInspectionId) : currentInspection();
    read
      .then((record) => {
        if (turn === generation.current) setResult(record);
      })
      .catch((error) => {
        if (turn === generation.current) setError(error.message);
      })
      .finally(() => {
        if (turn === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [initialInspectionId]);
  useEffect(() => {
    if (!working || !result) return;
    let active = true;
    const timer = window.setTimeout(() => {
      getInspection(result.id)
        .then((r) => {
          if (active) setResult(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [working, result]);
  const run = async (work: (turn: number) => Promise<void>) => {
    const turn = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work(turn);
    } catch (e) {
      if (turn === generation.current) setError(e instanceof Error ? e.message : '操作失败，当前选择已保留。');
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  };
  const check = (retry = false, withRelated = false) =>
    run(async (turn) => {
      const r = await startInspection({
        requestId: retry && result ? result.id : crypto.randomUUID(),
        wikiIds: (retry || withRelated) && result ? result.scope.selected : selected,
        includeRelated: withRelated || (retry && result ? result.includeRelated : related),
        retry,
      });
      if (turn !== generation.current) return;
      setResult(r);
      setChosen([]);
      draftKey.current = crypto.randomUUID();
    });
  const choose = (id: string) => {
    setChosen((old) => (old.includes(id) ? old.filter((v) => v !== id) : [...old, id]));
    draftKey.current = crypto.randomUUID();
  };
  const decide = (id: string, status: 'viewed' | 'deferred') =>
    run(async (turn) => {
      if (!result) return;
      const next = await decideInspection(result.id, id, {
        baseRevision: result.revision,
        status,
        reason: reasons[id] ?? '',
      });
      if (turn === generation.current) setResult(next);
    });
  const evidence = (findingId: string, id: string) =>
    run(async (turn) => {
      if (!result) return;
      const c = await inspectionEvidence(result.id, findingId, id);
      if (turn !== generation.current) return;
      if (c.kind === 'wiki') onOpenWiki(c.recordId, c);
      else
        onOpenRaw(c.recordId, {
          rawId: c.recordId,
          start: c.start,
          end: c.end,
          quote: c.quote,
          bodySha256: c.bodySha256,
        });
    });
  const draft = () =>
    run(async (turn) => {
      if (!result) return;
      const r = await draftInspection(result.id, {
        baseRevision: result.revision,
        selectedFindingIds: chosen,
        key: draftKey.current,
      });
      if (turn !== generation.current) return;
      setResult(r.inspection);
      setNotice(r.status === 'no_change' ? '没有实质变更：' + r.reason : '维护草稿已生成，正式知识尚未改变。');
      if (r.draftId) onOpenDraft(r.draftId);
    });
  const wikiTitle = (id: string) =>
    items.find((p) => p.id === id)?.title ?? result?.scope.read.find((p) => p.id === id)?.title ?? id;
  const summary = result && !working && result.status !== 'failed' ? inspectionSummary(result) : null;
  return (
    <section className="panel wiki-inspection" aria-label="主动知识检查" aria-busy={locked || loading}>
      <div className="panel-heading">
        <div>
          <h2>主动知识检查</h2>
          <p>由你选择范围并发起。AI建议待核，正式修改仍需逐项审核。</p>
        </div>
      </div>
      <div className="inspection-body">
        <fieldset disabled={locked || loading}>
          <legend>本次选择的知识页（最多 8 页）</legend>
          <div className="inspection-scope-toolbar">
            <input
              type="search"
              aria-label="搜索检查范围知识页"
              value={scopeQuery}
              onChange={(e) => setScopeQuery(e.target.value)}
              placeholder="搜索知识页标题…"
            />
            {selected.length > 0 && (
              <button type="button" className="text-button" onClick={() => setSelected([])}>
                清空已选（{selected.length}）
              </button>
            )}
          </div>
          <div className="inspection-scope-picker">
            {filteredItems.map((p) => (
              <label className="draft-select" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() =>
                    setSelected((old) => (old.includes(p.id) ? old.filter((id) => id !== p.id) : [...old, p.id]))
                  }
                />
                {p.title}
              </label>
            ))}
          </div>
          {items.length > 0 && filteredItems.length === 0 && (
            <p className="muted-copy" role="status">
              没有匹配该关键词的知识页。
            </p>
          )}
          <p>已选 {selected.length} 页 · 本次最多读取 8 页 / 48,000 字符</p>
          <label className="draft-select">
            <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} />
            包含有界相关知识（共用上述额度）
          </label>
          <button
            className="primary-button"
            disabled={!selected.length || selected.length > 8 || !!checkDisabled}
            onClick={() => void check()}
          >
            开始本次检查
          </button>
          {checkDisabled && (
            <p className="field-help" role="status">
              {checkDisabled}
            </p>
          )}
          {selected.length === 1 && !related && (
            <p className="muted-copy">当前仅选 1 页，将只做单页自检；勾选“包含有界相关知识”可排查跨页重复与冲突。</p>
          )}
          {selected.length > 8 && <p role="alert">请选择至多 8 页，已选页面不会被静默丢弃。</p>}
        </fieldset>
        {loading && <p role="status">正在读取上次检查…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice-success" role="status">
            {notice}
          </p>
        )}
        {result && (
          <>
            {summary ? (
              <>
                <header className={'inspection-summary ' + summary.tone} role="status">
                  <h3>{summary.headline}</h3>
                  <p>
                    本次共检查 {result.scope.read.length} 篇知识页，未对正式知识页做任何修改。
                    {result.scope.skipped.length > 0 && `有 ${result.scope.skipped.length} 页未读。`}
                  </p>
                </header>
                <dl className="inspection-dimensions">
                  {summary.dimensions.map((item) => (
                    <div key={item.type}>
                      <dt>{types[item.type]}</dt>
                      <dd>
                        {item.label}
                        {item.reason && <small>{item.reason}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="review-overview" role="status">
                {statuses[result.status]} · {stages[result.stage] ?? '核对本次检查状态'}
              </p>
            )}
            {result.error && (
              <p className="form-error" role="alert">
                {result.error.message}
              </p>
            )}
            {result.status === 'failed' && (
              <button
                className="secondary-button"
                disabled={locked || !!checkDisabled}
                title={checkDisabled}
                onClick={() => void check(true)}
              >
                明确重试本次检查
              </button>
            )}

            {result.findings.length > 0 && (
              <div className="inspection-findings">
                {result.findings.map((f) => (
                  <article className="inspection-finding" key={f.id} aria-label={types[f.type]}>
                    <div className="panel-heading">
                      <h3>{f.summary}</h3>
                      <span className="tag">
                        {types[f.type]} · {f.origin === 'snapshot' ? '快照确定性核对' : 'AI待核建议'} ·{' '}
                        {{ pending: '待核', viewed: '已查看', deferred: '已暂缓', committed: '已审核提交' }[f.status]}
                      </span>
                    </div>
                    <label className="draft-select">
                      <input
                        aria-label={'选择问题 ' + f.id}
                        type="checkbox"
                        disabled={locked || f.status === 'committed'}
                        checked={chosen.includes(f.id)}
                        onChange={() => choose(f.id)}
                      />
                      选择此建议
                    </label>
                    <p>涉及：{f.wikiIds.map(wikiTitle).join('、')}</p>
                    <p>理由：{f.reason}</p>
                    <p>年份 / 区域 / 口径差异：{f.differences}</p>
                    <p>建议：{steps[f.nextStep]}</p>
                    {f.basisChanged && <p className="notice-warn">依据已发生实质变化，本次重新提出。</p>}
                    {f.statusReason && <p>处理说明：{f.statusReason}</p>}
                    {f.evidence.map((c) => (
                      <blockquote key={c.id}>
                        <p>{c.quote}</p>
                        <button className="text-button" disabled={locked} onClick={() => void evidence(f.id, c.id)}>
                          查看依据：{c.title} · v{c.revision} · [{c.start}, {c.end})
                        </button>
                        <p>
                          底层 Raw {c.rawIds.length} 份 · 人工知识页 {c.manualWikiIds.length} 页
                        </p>
                      </blockquote>
                    ))}
                    <label className="field">
                      处理说明
                      <input
                        aria-label={'处理说明 ' + f.id}
                        value={reasons[f.id] ?? ''}
                        disabled={locked || f.status === 'committed'}
                        onChange={(e) => setReasons({ ...reasons, [f.id]: e.target.value })}
                      />
                    </label>
                    <div className="heading-actions">
                      <button
                        className="secondary-button"
                        disabled={locked || f.status === 'committed'}
                        onClick={() => void decide(f.id, 'viewed')}
                      >
                        标为已查看
                      </button>
                      <button
                        className="secondary-button"
                        disabled={locked || f.status === 'committed' || !reasons[f.id]?.trim()}
                        onClick={() => void decide(f.id, 'deferred')}
                      >
                        暂缓并保存说明
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {result.findings.length > 0 && (
              <div className="heading-actions">
                <span>已选 {chosen.length} 个问题</span>
                <button
                  className="primary-button"
                  disabled={locked || !chosen.length || result.status === 'failed' || !!draftDisabled}
                  title={draftDisabled}
                  onClick={() => void draft()}
                >
                  为所选问题生成维护草稿
                </button>
              </div>
            )}
            {result.drafts
              .filter((d) => d.draftId)
              .map((d) => (
                <button className="text-button" key={d.key} onClick={() => onOpenDraft(d.draftId!)}>
                  打开已有维护草稿
                </button>
              ))}
            {summary && result.scope.selected.length === 1 && !result.includeRelated && (
              <button
                className="secondary-button"
                disabled={locked}
                onClick={() => {
                  setSelected(result.scope.selected);
                  setRelated(true);
                  void check(false, true);
                }}
              >
                勾选“包含有界相关知识”重新检查
              </button>
            )}
            <details key={result.id}>
              <summary>
                查看本次检查范围与技术说明（实读 {result.scope.read.length} 页 · 模型调用 {result.attempts} 次）
              </summary>
              <section className="inspection-range" aria-label="实际检查范围">
                <h3>实际检查范围与缺口</h3>
                <p>
                  选定 {result.scope.selected.length} 页 · 候选 {result.scope.candidates.length} 页 · 实读{' '}
                  {result.scope.read.length} 页 · 跳过 {result.scope.skipped.length} 页
                </p>
                <p>选定：{result.scope.selected.map(wikiTitle).join('、')}</p>
                {result.scope.read.map((p) => (
                  <button key={p.id} className="text-button" onClick={() => onOpenWiki(p.id)}>
                    {p.title} · v{p.revision}
                  </button>
                ))}
                {result.scope.skipped.map((p, i) => (
                  <p className="notice-warn" key={i}>
                    未读 {wikiTitle(p.id)}：{p.reason}
                  </p>
                ))}
                {[...new Set(result.scope.gaps)]
                  .filter((gap) => !/Lint|结构检查/i.test(gap))
                  .map((gap, i) => (
                    <p className="notice-warn" key={i}>
                      {gap}
                    </p>
                  ))}
              </section>
              <h4>关联 Audit 历史 · {result.audits.length} 项</h4>
              {result.audits.map((a) => (
                <p key={a.id}>
                  <button className="text-button" onClick={() => onOpenWiki(a.wikiId)}>
                    {wikiTitle(a.wikiId)}
                  </button>{' '}
                  · {a.status} · {a.comment}
                </p>
              ))}
              <button className="text-button" onClick={() => window.dispatchEvent(new Event('wiki:lint'))}>
                需要检查断链或格式问题？前往结构检查（Lint）
              </button>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
