import type { Raw, WorkItem } from '../../api';
import { WorkAnalysisPanel } from '../WorkAnalysisPanel';
import { WorkItemCurrent } from './WorkItemCurrent';
import { WorkItemHistory } from './WorkItemHistory';
import { WorkItemMaterials } from './WorkItemMaterials';
import { useWorkItemDetail } from './useWorkItemDetail';
import { formatTime, Status, workKindLabel } from './workItemShared';

export function WorkItemDetail(props: {
  item: WorkItem;
  focusMaterials: boolean;
  raws: Raw[];
  onBack: () => void;
  onOpenRaw: (id: string) => void;
  onChanged: () => void;
}) {
  const state = useWorkItemDetail(props);
  const {
    saved,
    busy,
    deleteConfirm,
    setDeleteConfirm,
    deleteError,
    setDeleteError,
    leaveConfirm,
    setLeaveConfirm,
    remove,
    update,
    readLatest,
    renderNotice,
    rawById,
    analysisDirty,
    anyDirty,
    focusMaterials,
    onBack,
  } = state;
  return (
    <div className="page work-page work-detail">
      <div className="page-heading">
        <div>
          <button
            type="button"
            className="text-button work-back"
            onClick={() => {
              if (!anyDirty) onBack();
              else setLeaveConfirm(true);
            }}
          >
            返回工作事项
          </button>
          <h1>{saved.title}</h1>
          <div className="work-detail-meta">
            <span>{workKindLabel(saved.kind)}</span>
            <Status kind={saved.kind} value={saved.status} />
            <span>最近保存 {formatTime(saved.updatedAt)}</span>
          </div>
          <p className="work-note work-save-hint">各区独立保存。修改后，请使用该区的保存按钮。</p>
        </div>
        <div className="work-buttons">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setDeleteConfirm(true)}>
            删除事项
          </button>
        </div>
      </div>
      {leaveConfirm && anyDirty && (
        <section className="panel work-section work-leave-confirm" role="alert" aria-label="未保存修改确认">
          <p>当前事项有未保存的修改，确定放弃修改并返回工作事项列表？</p>
          <div className="work-buttons">
            <button type="button" className="secondary-button" onClick={() => setLeaveConfirm(false)}>
              继续编辑
            </button>
            <button type="button" className="primary-button" onClick={onBack}>
              放弃修改并返回
            </button>
          </div>
        </section>
      )}
      {(deleteConfirm || deleteError) && (
        <section className="panel work-section" aria-label="删除工作事项">
          {deleteConfirm && (
            <>
              <p>确定删除“{saved.title}”及其处理记录？删除无法撤销，未保存的修改也将丢失。关联 Raw 原文保留。</p>
              <p className="work-note">已有截图、分析及复核文件保留在本机，但不再从事项入口访问。</p>
              <div className="work-buttons">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setDeleteConfirm(false);
                    setDeleteError('');
                  }}
                >
                  取消删除
                </button>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void remove()}>
                  {busy ? '正在删除…' : '确认删除事项'}
                </button>
              </div>
            </>
          )}
          {deleteError && (
            <p className="form-error" role="alert">
              {deleteError} 请重新打开事项后核对并重试。
            </p>
          )}
        </section>
      )}
      <WorkItemCurrent state={state} />
      <WorkItemHistory state={state} />
      <WorkItemMaterials state={state} />
      {saved.kind === 'product_analysis' && (
        <WorkAnalysisPanel
          item={saved}
          focusMaterials={focusMaterials}
          rawById={rawById}
          busy={busy}
          analysisDirty={analysisDirty}
          reloadItem={() => readLatest('analysis')}
          analysisNotice={renderNotice('analysis')}
          saveStage={(body, analysisRunId, onSaved) =>
            void update(
              'stage',
              { history: { kind: 'stage_result', body, analysisRunId } },
              '阶段成果已保存。',
              onSaved,
            )
          }
          stageNotice={renderNotice('stage')}
        />
      )}
    </div>
  );
}
