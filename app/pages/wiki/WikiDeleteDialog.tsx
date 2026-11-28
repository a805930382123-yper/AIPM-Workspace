import type { Wiki } from '../../api';
import { useDialogFocus } from '../../components/useDialogFocus';

export function WikiDeleteDialog({
  item,
  references,
  busy,
  onClose,
  onConfirm,
  onOpenReference,
}: {
  item: Wiki;
  references: Array<{ id: string; title: string }>;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onOpenReference: (id: string) => void;
}) {
  const dialog = useDialogFocus<HTMLElement>();
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">移到回收区</p>
            <h2 id="delete-title">删除“{item.title}”</h2>
            <p>被关联的页面会保留原文；删除后这些链接可能变为未找到。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="delete-reference-list">
          <b>入链影响 · {references.length} 页</b>
          {references.length ? (
            references.map((reference) => (
              <div className="delete-reference" key={reference.id}>
                <span>[[{item.title}]]</span>
                <button className="text-button" onClick={() => onOpenReference(reference.id)}>
                  {reference.title}
                </button>
              </div>
            ))
          ) : (
            <p>没有其他 Wiki 页面链接到此页。</p>
          )}
        </div>
        <div className="dialog-footer">
          <span>Raw 与其他知识资产不会删除</span>
          <div>
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
