import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { useLlmDisabled } from '../../hooks/llmAvailability';
import type { Raw, Wiki } from '../../api';
import { startSynthesisWorkflow } from '../../api';

export function SynthesisDialog({
  items,
  sourcePages,
  onClose,
  onCreated,
}: {
  items: Raw[];
  sourcePages: Wiki[];
  onClose: () => void;
  onCreated: (workflowId: string) => void;
}) {
  const modelDisabled = useLlmDisabled();
  const dialog = useDialogFocus<HTMLElement>();
  const [synthesisIds, setSynthesisIds] = useState<string[]>([]);
  const [synthesisSourceIds, setSynthesisSourceIds] = useState<string[]>([]);
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [synthesisError, setSynthesisError] = useState('');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const selectedCount = new Set([
    ...synthesisIds,
    ...synthesisSourceIds
      .map((id) => sourcePages.find((source) => source.id === id)?.sources[0])
      .filter((id): id is string => Boolean(id)),
  ]).size;
  const submit = async () => {
    if (busyRef.current || selectedCount < 2) return;
    busyRef.current = true;
    setSynthesisBusy(true);
    setSynthesisError('');
    try {
      const workflow = await startSynthesisWorkflow({ rawIds: synthesisIds, sourceIds: synthesisSourceIds });
      onCreated(workflow.id);
    } catch (error) {
      if (mountedRef.current) setSynthesisError(error instanceof Error ? error.message : '综合草稿生成失败。');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSynthesisBusy(false);
    }
  };
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !synthesisBusy) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="panel import-dialog synthesis-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="synthesis-dialog-title"
        aria-busy={synthesisBusy}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !synthesisBusy) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <h2 id="synthesis-dialog-title">选择综合来源</h2>
            <p>Raw 与 Source 可混合选择，最终按其真实 Raw ID 去重，至少两条。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={synthesisBusy} onClick={onClose}>
            ×
          </button>
        </div>
        {synthesisError && (
          <p className="form-error" role="alert">
            {synthesisError}
          </p>
        )}
        <div className="raw-list">
          {items.map((item) => (
            <label className="raw-list-item" key={item.id}>
              <input
                type="checkbox"
                disabled={synthesisBusy}
                checked={synthesisIds.includes(item.id)}
                onChange={(event) =>
                  setSynthesisIds((current) =>
                    event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                  )
                }
              />
              <span className="recent-copy">
                <b>Raw · {item.title}</b>
                <small>
                  {item.sourceName} · {item.id}
                </small>
              </span>
            </label>
          ))}
          {sourcePages.map((item) => (
            <label className="raw-list-item" key={item.id}>
              <input
                type="checkbox"
                disabled={synthesisBusy}
                checked={synthesisSourceIds.includes(item.id)}
                onChange={(event) =>
                  setSynthesisSourceIds((current) =>
                    event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                  )
                }
              />
              <span className="recent-copy">
                <b>Source · {item.title}</b>
                <small>
                  {item.sources[0]} · {item.id}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="dialog-footer">
          <span className="footer-note">已选 {selectedCount} 条不同来源（至少 2 条）</span>
          <div>
            <button type="button" className="secondary-button" disabled={synthesisBusy} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={synthesisBusy || selectedCount < 2 || !!modelDisabled}
              title={modelDisabled}
              onClick={() => void submit()}
            >
              {synthesisBusy ? '正在生成…' : '生成 Synthesis 草稿'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
