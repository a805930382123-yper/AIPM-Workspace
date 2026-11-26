import type { DraftView } from '../../api';
import type { DraftReviewState } from './useDraftReviewState';

export function DraftAssignmentEditor({ state, view }: { state: DraftReviewState; view: DraftView }) {
  const { readOnly, dirty, busy, pages, startReview, moveUnit, markQuestion } = state;
  const outcomeMode = !!view.outcomeDigest;
  return (
    !readOnly && (
      <section className="panel draft-card-body" aria-label="主题与归属人工审查">
        <h2>{outcomeMode ? '来源事实与问题标注' : '逐页确认主题与完整归属'}</h2>
        {!outcomeMode && (
          <p>
            所有候选页（包括未选中及暂不处理的页面）都需逐页确认；没有明确关系的条目可保留未解决，并会阻止整份草稿正式写入。
          </p>
        )}
        {dirty && (
          <p className="notice-warn">
            {outcomeMode ? '请先保存当前修改。' : '当前有未保存编辑。保存后全部页需重新审查。'}
          </p>
        )}
        {!view.humanReview ? (
          <button className="secondary-button" disabled={busy !== '' || dirty} onClick={() => void startReview()}>
            开始主题与归属审查
          </button>
        ) : (
          <>
            {!outcomeMode && (
              <p>
                未解决 {Object.values(view.humanReview.assignments).filter((id) => id === null).length} 项 · 已审{' '}
                {view.humanReview.approvals.filter((a) => a.digest === view.reviewContentDigest).length}/{pages.length}{' '}
                页
              </p>
            )}
            {view.humanReview.units.map((unit) => (
              <div className="draft-evidence-row" key={unit.id}>
                <div>
                  <strong>
                    {unit.kind === 'fact' ? '来源事实' : unit.kind === 'question' ? '原文明示问题' : '整理提议'}
                  </strong>{' '}
                  <code>{unit.id}</code>
                  <p>{unit.text}</p>
                  <small>{unit.sourceLabel ?? `原记录：${unit.memberIds.join('、')}`}</small>
                  {unit.evidence.map((e, i) => (
                    <p key={`${e.id}-${i}`}>
                      原文 [{e.start}, {e.end})：“{e.quote}”
                    </p>
                  ))}
                  {!unit.evidence.length && <p>旧记录无原文定位</p>}
                </div>
                <label className="field">
                  完整 unit 归属
                  <select
                    aria-label={`归属 ${unit.id}`}
                    value={view.humanReview!.assignments[unit.id] ?? ''}
                    disabled={busy !== '' || dirty}
                    onChange={(e) => void moveUnit(unit.id, e.target.value || null)}
                  >
                    <option value="">未解决</option>
                    {pages.map((p) => (
                      <option key={p.pageId} value={p.pageId}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                {unit.kind === 'fact' && (
                  <label className="draft-select">
                    <input
                      type="checkbox"
                      aria-label={`同时列入待确认问题 ${unit.id}`}
                      checked={view.humanQuestionUnitIds?.includes(unit.id) ?? false}
                      disabled={busy !== '' || dirty}
                      onChange={(e) => void markQuestion(unit.id, e.target.checked)}
                    />
                    同时列入待确认问题（人工标记）
                  </label>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    )
  );
}
