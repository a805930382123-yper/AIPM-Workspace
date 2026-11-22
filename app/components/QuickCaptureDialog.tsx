import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_BODY_CHARS } from '../../services/raw/limits';
import { api, sourceLabels, type Raw, type RawTranslation, type RawUrlImportResult, type SourceType } from '../api';
import { useDialogFocus } from './useDialogFocus';

export type QuickCaptureDialogProps = {
  onClose: () => void;
  onCaptured: (raw: Raw) => Promise<void>;
  onOpenRaw: (rawId: string, translation?: RawTranslation) => void;
};

type CaptureMode = 'note' | 'url';
type CaptureResult = { raw: Raw; translation?: RawTranslation };
const modes = [
  { id: 'note', label: '速记笔记' },
  { id: 'url', label: '网页链接' },
] as const;
const initialForm = {
  body: '',
  url: '',
  title: '',
  tags: '',
  sourceType: 'note' as SourceType,
  sourceName: '个人速记',
  translateToChinese: false,
};

export function deriveQuickCaptureTitle(body: string): string {
  const firstLine = body.split(/\r\n?|\n/u).find((line) => line.trim()) ?? '';
  return [...firstLine.trim().replace(/\s+/gu, ' ')].slice(0, 60).join('');
}

export function QuickCaptureDialog({ onClose, onCaptured, onOpenRaw }: QuickCaptureDialogProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const savingRef = useRef(false);
  const [mode, setMode] = useState<CaptureMode>('note');
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CaptureResult | null>(null);
  const link = form.body.trim();
  const hasLink = /^https?:\/\/\S+$/iu.test(link);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !saving && (result || !dialog.contains(dialog.ownerDocument.activeElement))) {
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
  }, [dialogRef, mode, result, saving]);

  const close = () => {
    if (!savingRef.current) onClose();
  };
  const update = <K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const changeMode = (next: CaptureMode) => {
    setError('');
    setMode(next);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || (mode === 'note' ? !form.body.trim() : !form.url.trim())) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const title = form.title.trim() ? form.title : undefined;
    const tags = form.tags
      .split(/[，,、;；]+/u)
      .map((tag) => tag.trim())
      .filter(Boolean);
    let captured: CaptureResult | undefined;
    try {
      if (mode === 'note') {
        const body = {
          title: title ?? deriveQuickCaptureTitle(form.body),
          sourceType: form.sourceType,
          sourceName: form.sourceName.trim() ? form.sourceName : initialForm.sourceName,
          tags,
          body: form.body,
        };
        captured = { raw: await api<Raw>('/api/raw', { method: 'POST', body: JSON.stringify(body) }) };
      } else {
        const metadata = { url: form.url.trim(), sourceType: 'article', title, tags };
        captured = await api<RawUrlImportResult>('/api/raw/import', {
          method: 'POST',
          body: JSON.stringify({ metadata, translateToChinese: form.translateToChinese }),
        });
      }
      await onCaptured(captured.raw);
    } catch (problem) {
      setError(
        captured ? 'Raw 已保存，列表未能刷新。' : problem instanceof Error ? problem.message : '保存失败，请重试。',
      );
    } finally {
      if (captured) setResult(captured);
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Keep the browser from taking focus back after the dialog restores it.
        event.preventDefault();
        close();
      }}
    >
      <section
        ref={dialogRef}
        className="import-dialog quick-capture-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
        aria-busy={saving}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="quick-capture-title">快速记一条</h2>
          <button type="button" className="icon-button" aria-label="关闭" disabled={saving} onClick={close}>
            ×
          </button>
        </header>
        {result ? (
          <div className="quick-capture-result">
            <h3 tabIndex={-1} data-autofocus>
              已保存到 Raw
            </h3>
            <p>
              <strong>{result.raw.title}</strong>
            </p>
            <p>
              {sourceLabels[result.raw.sourceType]} · {result.raw.sourceName}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="quick-capture-result-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setResult(null);
                  setForm(initialForm);
                  changeMode('note');
                }}
              >
                继续记一条
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  onOpenRaw(result.raw.id, result.translation);
                  onClose();
                }}
              >
                打开这条 Raw
              </button>
              <button type="button" className="text-button" onClick={close}>
                关闭
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div
              className="quick-capture-tabs"
              role="tablist"
              aria-label="捕获方式"
              onKeyDown={(event) => {
                if (saving || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                const next =
                  event.key === 'Home' ? 'note' : event.key === 'End' ? 'url' : mode === 'note' ? 'url' : 'note';
                event.preventDefault();
                changeMode(next);
                event.currentTarget.querySelector<HTMLButtonElement>(`#quick-capture-tab-${next}`)?.focus();
              }}
            >
              {modes.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  id={`quick-capture-tab-${id}`}
                  role="tab"
                  aria-controls="quick-capture-fields"
                  aria-selected={id === mode}
                  tabIndex={id === mode ? 0 : -1}
                  disabled={saving}
                  onClick={() => changeMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div id="quick-capture-fields" role="tabpanel" aria-labelledby={`quick-capture-tab-${mode}`}>
              <fieldset className="quick-capture-fields" disabled={saving}>
                {mode === 'note' ? (
                  <>
                    <label className="field">
                      速记内容
                      <textarea
                        aria-label="速记内容"
                        data-autofocus
                        required
                        maxLength={MAX_BODY_CHARS}
                        value={form.body}
                        placeholder="记一条快消业务灵感、客户原话、指标口径或会议碎片…（Ctrl+Enter 快速保存）"
                        onChange={(event) => update('body', event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key === 'Enter' &&
                            !event.nativeEvent.isComposing &&
                            !saving
                          ) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                    </label>
                    {hasLink && (
                      <div className="quick-capture-link-hint">
                        <span>检测到公开网页链接，是否直接抓取网页原文？</span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            update('url', link);
                            changeMode('url');
                          }}
                        >
                          切到网页链接模式
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <label className="field">
                    公开网页链接
                    <input
                      type="url"
                      aria-label="公开网页链接"
                      data-autofocus
                      placeholder="https://…"
                      required
                      value={form.url}
                      onChange={(event) => update('url', event.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  标题（可选）
                  <input
                    aria-label="标题（可选）"
                    maxLength={300}
                    value={form.title}
                    placeholder={mode === 'note' ? '留空自动取第一行作为标题' : '留空使用网页标题'}
                    onChange={(event) => update('title', event.target.value)}
                  />
                </label>
                <label className="field">
                  标签（可选）
                  <input
                    aria-label="标签（可选）"
                    placeholder="用逗号或顿号分隔，例如：渠道、动销、客户反馈"
                    value={form.tags}
                    onChange={(event) => update('tags', event.target.value)}
                  />
                </label>
                {mode === 'note' ? (
                  <details className="quick-capture-source">
                    <summary tabIndex={saving ? -1 : 0}>来源设置</summary>
                    <div className="form-grid">
                      <label className="field">
                        来源类型
                        <select
                          value={form.sourceType}
                          onChange={(event) => update('sourceType', event.target.value as SourceType)}
                        >
                          {Object.entries(sourceLabels).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        来源名称
                        <input
                          maxLength={300}
                          placeholder={initialForm.sourceName}
                          value={form.sourceName}
                          onChange={(event) => update('sourceName', event.target.value)}
                        />
                      </label>
                    </div>
                  </details>
                ) : (
                  <label className="quick-capture-translation">
                    <input
                      type="checkbox"
                      checked={form.translateToChinese}
                      onChange={(event) => update('translateToChinese', event.target.checked)}
                    />
                    翻译成中文（会调用已配置模型）
                  </label>
                )}
              </fieldset>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer className="dialog-footer">
              {mode === 'note' && <span>保存为 Raw 原文，不自动调用 AI，也不写入正式 Wiki。</span>}
              <button
                type="submit"
                className="primary-button"
                disabled={saving || (mode === 'note' ? !form.body.trim() : !form.url.trim())}
              >
                {saving ? '正在保存…' : mode === 'note' ? '保存速记' : '抓取并保存'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
