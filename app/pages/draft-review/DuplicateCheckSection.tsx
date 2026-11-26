import type { DraftView } from '../../api';
import { duplicateDimension, type PageDraft } from './draftReviewModel';
import type { DraftReviewState } from './useDraftReviewState';

export function DuplicateCheckSection({
  state,
  view,
  page,
}: {
  state: DraftReviewState;
  view: DraftView;
  page: PageDraft;
}) {
  const { readOnly, busy, duplicateErrors, duplicateViews, checkDuplicates, decide, makeUpdate } = state;
  return (
    <div className="duplicate-review">
      <button
        className="secondary-button"
        disabled={readOnly || busy !== ''}
        onClick={() => void checkDuplicates(page.pageId)}
      >
        刷新重复候选
      </button>
      {duplicateErrors[page.pageId] && (
        <div className="form-error" role="alert">
          候选查询失败：{duplicateErrors[page.pageId]}。为避免漏掉已有知识，确认写入会被阻止。
        </div>
      )}
      {duplicateViews[page.pageId] && (
        <div className="duplicate-results">
          <p>以下是启发式候选，供人工选择，不代表事实判定。</p>
          {duplicateViews[page.pageId].candidates.length === 0 ? (
            <span>未发现候选。</span>
          ) : (
            duplicateViews[page.pageId].candidates.map((candidate) => (
              <div className="duplicate-candidate" key={candidate.wiki.id}>
                <strong>{candidate.wiki.title}</strong>
                <small>
                  Wiki {candidate.wiki.id} · 来源 Raw：{candidate.wiki.sources.join('、') || '无'}
                </small>
                <span>建议相似度 {(candidate.score * 100).toFixed(0)}%</span>
                <p>
                  {candidate.matches
                    .map((match) => `${duplicateDimension[match.dimension] ?? match.dimension}：${match.reason}`)
                    .join('；')}
                </p>
                <button
                  className="text-button"
                  disabled={!!view.structuredNote || readOnly || busy !== ''}
                  onClick={() => {
                    if (!view.structuredNote) void decide(page.pageId, 'update', candidate.wiki.id);
                  }}
                >
                  选择更新
                </button>
                <button
                  className="text-button"
                  disabled={readOnly || busy !== ''}
                  onClick={() => void decide(page.pageId, 'create')}
                >
                  仍创建新页
                </button>
              </div>
            ))
          )}
          <button
            className="text-button"
            disabled={readOnly || busy !== ''}
            onClick={() => void decide(page.pageId, 'defer')}
          >
            暂不处理
          </button>
          {page.reviewDecision === 'update' && page.updateTargetWikiId && (
            <button
              className="text-button"
              disabled={!!view.structuredNote || busy !== ''}
              onClick={() => void makeUpdate(page.pageId, page.updateTargetWikiId!)}
            >
              生成旧 Wiki 更新预览
            </button>
          )}
        </div>
      )}
    </div>
  );
}
