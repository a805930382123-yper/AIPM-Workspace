import type { RawDraftView } from '../../api';
import { duplicateDimension, type PageDraft } from './draftReviewModel';
import type { DraftReviewState } from './useDraftReviewState';

export function DuplicateCheckSection({
  state,
  view,
  page,
  advisory = false,
  disabled = false,
  onOpenWiki,
}: {
  state: DraftReviewState;
  view: RawDraftView;
  page: PageDraft;
  advisory?: boolean;
  disabled?: boolean;
  onOpenWiki?: (id: string) => void;
}) {
  const { readOnly, dirty, busy, duplicateErrors, duplicateViews, checkDuplicates, decide, makeUpdate } = state;
  const semantic = state.semanticDuplicates[page.pageId];
  const currentSemantic = !dirty && semantic?.revision === view.revision ? semantic : undefined;
  const duplicate = currentSemantic?.result ?? duplicateViews[page.pageId];
  const unavailable = currentSemantic?.failed || currentSemantic?.result?.semanticStatus === 'unavailable';
  return (
    <div className="duplicate-review">
      <button
        className="secondary-button"
        disabled={disabled || readOnly || busy !== '' || semantic?.pending}
        onClick={() => void checkDuplicates(page.pageId)}
      >
        刷新重复候选
      </button>
      {!readOnly && !view.pdfInput && (
        <>
          <button
            className="secondary-button"
            disabled={disabled || dirty || busy !== '' || semantic?.pending}
            onClick={() => void state.checkSemanticDuplicates(page.pageId)}
          >
            {semantic?.pending ? '正在进行语义查重…' : '发送本页内容进行语义查重'}
          </button>
          <small>发送已保存的标题、定义、来源事实和 AI 整理至已配置的向量服务。{dirty && '请先保存编辑。'}</small>
        </>
      )}
      {unavailable && <p role="status">本次语义查重不可用，仍可查看词法候选。</p>}
      {!advisory && duplicateErrors[page.pageId] && (
        <div className="form-error" role="alert">
          候选查询失败：{duplicateErrors[page.pageId]}。为避免漏掉已有知识，确认写入会被阻止。
        </div>
      )}
      {duplicate && (
        <div className="duplicate-results">
          <p>以下是启发式候选，供人工选择，不代表事实判定。</p>
          {duplicate.candidates.length === 0 ? (
            <span>未发现候选。</span>
          ) : (
            duplicate.candidates.map((candidate) => (
              <div className="duplicate-candidate" key={candidate.wiki.id}>
                <strong>{candidate.wiki.title}</strong>
                <small>
                  Wiki {candidate.wiki.id} · 来源 Raw：{candidate.wiki.sources.join('、') || '无'}
                </small>
                {candidate.matches.some(({ dimension }) => dimension !== 'semantic') && (
                  <span>词法建议相似度 {(candidate.score * 100).toFixed(0)}%</span>
                )}
                <p>
                  {candidate.matches
                    .map((match) => `${duplicateDimension[match.dimension] ?? match.dimension}：${match.reason}`)
                    .join('；')}
                </p>
                {advisory && onOpenWiki && (
                  <button className="text-button" disabled={disabled} onClick={() => onOpenWiki(candidate.wiki.id)}>
                    打开 Wiki
                  </button>
                )}
                {!advisory && (
                  <button
                    className="text-button"
                    disabled={!!view.structuredNote || readOnly || busy !== ''}
                    onClick={() => {
                      if (!view.structuredNote) void decide(page.pageId, 'update', candidate.wiki.id);
                    }}
                  >
                    选择更新
                  </button>
                )}
                {!advisory && (
                  <button
                    className="text-button"
                    disabled={readOnly || busy !== ''}
                    onClick={() => void decide(page.pageId, 'create')}
                  >
                    仍创建新页
                  </button>
                )}
              </div>
            ))
          )}
          {!advisory && (
            <button
              className="text-button"
              disabled={readOnly || busy !== ''}
              onClick={() => void decide(page.pageId, 'defer')}
            >
              暂不处理
            </button>
          )}
          {!advisory && page.reviewDecision === 'update' && page.updateTargetWikiId && (
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
