import type { Prompt } from '../../api';
import { useDialogFocus } from '../../components/useDialogFocus';

export function PromptDeleteDialog({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: Prompt;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
        aria-labelledby="prompt-delete-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">移到回收区</p>
            <h2 id="prompt-delete-title">删除“{item.name}”</h2>
            <p>
              删除后不再出现在列表、搜索、统计和版本接口中；使用反馈随Prompt进入回收区，备份会保留。关联的 Wiki
              与知识库不受影响。
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-footer">
          <span>
            第 {item.version} 版 · {item.variables.length} 个变量
          </span>
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
