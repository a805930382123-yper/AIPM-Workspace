import { useEffect, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import type { Raw, RawReference } from '../../api';
import { ApiError, deleteRaw, rawReferences } from '../../api';

export function DeleteDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: Raw;
  onClose: () => void;
  onDeleted: (id: string) => Promise<void>;
}) {
  const dialog = useDialogFocus<HTMLElement>();
  const [references, setReferences] = useState<RawReference[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    rawReferences(item.id)
      .then((items) => {
        if (active) setReferences(items);
      })
      .catch((problem) => {
        if (active) setLoadError(problem instanceof Error ? problem.message : '无法确认引用关系。');
      });
    return () => {
      active = false;
    };
  }, [item.id]);
  const confirm = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteRaw(item.id);
      await onDeleted(item.id);
    } catch (problem) {
      setDeleting(false);
      if (problem instanceof ApiError && problem.code === 'RAW_REFERENCED') {
        const details = problem.details as { references?: RawReference[] } | undefined;
        setReferences(details?.references ?? references ?? []);
      }
      setError(problem instanceof Error ? problem.message : '删除失败，请重试。');
    }
  };
  const blocked = references !== null && references.length > 0;
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !deleting) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">删除 Raw</p>
            <h2 id="delete-title">删除「{item.title}」</h2>
            <p>删除前会重新检查这条资料是否被正式 Wiki 引用。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={deleting} onClick={onClose}>
            ×
          </button>
        </div>
        {references === null && !loadError && <div className="delete-copy">正在检查引用关系…</div>}
        {loadError && (
          <div className="form-error" role="alert">
            <p>{loadError}</p>
          </div>
        )}
        {blocked && (
          <>
            <div className="delete-panel">
              <b>这条资料已被 {references.length} 条正式 Wiki 引用，本批禁止删除。</b>
              <div>
                请先在知识库中解除这些页面的来源引用，再回到这里删除。工作台不会自动改写 Wiki、清除来源或留下坏来源。
              </div>
            </div>
            <ul className="reference-list">
              {references.map((reference) => (
                <li key={reference.id}>
                  <span>{reference.title}</span>
                  <code>{reference.id}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        {references !== null && references.length === 0 && (
          <div className="delete-copy">
            <strong>删除后正文不可恢复。</strong>这条资料会从列表与统计中移除，AI 也不会再引用它。
            {item.assetId
              ? ' 导入时的原件仍保留在 knowledge/raw/assets/（本批不提供原件清理）。'
              : ' 这条资料来自粘贴导入，没有保留原件。'}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        <div className="dialog-footer delete-footer">
          <span className="footer-note">{blocked ? '解除引用后才能删除' : '删除只由你的显式确认触发'}</span>
          <div>
            <button type="button" className="secondary-button" onClick={onClose} disabled={deleting}>
              取消
            </button>
            <button
              type="button"
              className="primary-button danger-button"
              onClick={confirm}
              disabled={deleting || references === null || blocked}
            >
              {deleting ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
