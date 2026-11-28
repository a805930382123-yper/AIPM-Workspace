import { useRef, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { useLlmDisabled } from '../../hooks/llmAvailability';
import type { Raw, RawImportResult, RawUrlImportResult, RawTranslation, SourceType } from '../../api';
import { ApiError, api, apiForm, bytesText, sourceLabels } from '../../api';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../../../services/raw/limits.ts';
import { isPdfRaw } from './rawPdf';
import { ResultPanel, PartialPanel } from './ImportResultPanels';
const ACCEPTED_FILES = '.md,.markdown,.txt,.docx,.pdf';
const MAX_UPLOAD_MIB = MAX_UPLOAD_BYTES / 1024 / 1024;
// F03-03: a single separator rule for the tag field, shared by the prefill text, the input
// hint and the parser, so an untouched tag list can never silently merge into one tag.
const TAG_SEPARATOR = /[，,、;；]+/u;
const parseTags = (value: string) =>
  value
    .split(TAG_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
const tagsText = (tags: string[]) => tags.join('、');
export type ImportFailure = {
  code: string;
  message: string;
  retained?: boolean;
  committed?: boolean;
  recoverable?: boolean;
  assetId?: string;
  rawId?: string;
  raw?: Raw;
  byteSize?: number;
  sha256?: string;
  fileName?: string;
  format?: string;
};
type Mode = 'paste' | 'file' | 'url';

export function ImportDialog({
  onClose,
  onCommitted,
  onOpen,
  onGenerate,
  prefill,
}: {
  onClose: () => void;
  onCommitted: (raw: Raw) => Promise<void>;
  onOpen: (raw: Raw, translation?: RawTranslation) => void;
  onGenerate: (raw: Raw) => Promise<void>;
  prefill?: Raw | null;
}) {
  const modelDisabled = useLlmDisabled();
  // The original tag array is kept verbatim; the text field is only a view of it until edited.
  const dialogRef = useDialogFocus<HTMLElement>();
  const initialTags = prefill?.tags ?? [];
  const [mode, setMode] = useState<Mode>(prefill?.assetId ? 'file' : 'paste');
  const [form, setForm] = useState({
    title: prefill?.title ?? '',
    sourceType: (prefill?.sourceType ?? 'article') as SourceType,
    sourceName: prefill?.sourceName ?? '',
    author: prefill?.author ?? '',
    publishedAt: prefill?.publishedAt ?? '',
    url: prefill?.url ?? '',
    tags: tagsText(initialTags),
    body: '',
  });
  const [tagsTouched, setTagsTouched] = useState(false);
  const [translateToChinese, setTranslateToChinese] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<RawImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [generationFailure, setGenerationFailure] = useState('');
  const [generationRaw, setGenerationRaw] = useState<Raw | null>(null);
  const material =
    mode === 'url'
      ? form.url.trim()
        ? 'url'
        : null
      : file
        ? 'file'
        : form.body.trim()
          ? 'paste'
          : form.url.trim()
            ? 'url'
            : null;
  const urlOnly = mode === 'url' || material === 'url';
  const pdfFile = !!file && /\.pdf$/iu.test(file.name);
  const update = (key: keyof typeof form, value: string) => {
    if (key === 'tags') setTagsTouched(true);
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const commitTags = () => (tagsTouched ? parseTags(form.tags) : initialTags);
  const metadata = () => ({
    title: form.title,
    sourceType: form.sourceType,
    sourceName: form.sourceName,
    author: form.author || undefined,
    publishedAt: form.publishedAt || undefined,
    url: form.url || undefined,
    tags: commitTags(),
  });
  const resetForNext = () => {
    setResult(null);
    setFailure(null);
    setFile(null);
    setTagsTouched(false);
    setTranslateToChinese(true);
    setForm((previous) => ({
      ...previous,
      title: prefill ? previous.title : '',
      sourceName: prefill ? previous.sourceName : '',
      url: '',
      tags: tagsText(initialTags),
      body: '',
    }));
  };
  const chooseFile = (next: File | null) => {
    setFile(next);
    setFailure(null);
    setResult(null);
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES)
      setFailure({
        code: 'FILE_TOO_LARGE',
        retained: false,
        fileName: next.name,
        byteSize: next.size,
        message: `文件为 ${bytesText(next.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限；工作台不会上传它，服务端也会在接收阶段拒绝。请改用粘贴文本。`,
      });
  };
  const removeFile = () => {
    if (fileInput.current) fileInput.current.value = '';
    chooseFile(null);
  };
  const switchToPaste = () => {
    setMode('paste');
    removeFile();
  };
  const submit = async (generateAfterSave = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setFailure(null);
    setGenerationFailure('');
    setSaving(true);
    try {
      if (mode !== 'url' && file) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setFailure({
            code: 'FILE_TOO_LARGE',
            retained: false,
            fileName: file.name,
            byteSize: file.size,
            message: `文件为 ${bytesText(file.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限，未上传。`,
          });
          return;
        }
        const payload = new FormData();
        payload.append('metadata', JSON.stringify(metadata()));
        payload.append('file', file, file.name);
        const outcome = await apiForm<RawImportResult>('/api/raw/import', payload);
        setResult(outcome);
        // F03-04: sync the committed Raw with the parent right away, so closing the result
        // panel (or continuing with another one) cannot leave the list and counters stale.
        await onCommitted(outcome.raw);
        if (generateAfterSave && !isPdfRaw(outcome.raw)) {
          setGenerationRaw(outcome.raw);
          try {
            await onGenerate(outcome.raw);
            setGenerationRaw(null);
          } catch (problem) {
            setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。');
          }
        }
      } else if (material === 'paste') {
        const raw = await api<Raw>('/api/raw', {
          method: 'POST',
          body: JSON.stringify({ ...metadata(), body: form.body }),
        });
        await onCommitted(raw);
        if (generateAfterSave) {
          setGenerationRaw(raw);
          try {
            await onGenerate(raw);
            setGenerationRaw(null);
            onOpen(raw);
          } catch (problem) {
            setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。');
          }
        } else onOpen(raw);
      } else if (material === 'url') {
        const { raw, translation } = await api<RawUrlImportResult>('/api/raw/import', {
          method: 'POST',
          body: JSON.stringify({ metadata: metadata(), translateToChinese: translateToChinese && !modelDisabled }),
        });
        await onCommitted(raw);
        onOpen(raw, translation);
      } else {
        setFailure({
          code: 'IMPORT_MATERIAL_REQUIRED',
          message: '请上传文件、粘贴正文或填写一个可读取的公开网页链接。',
        });
      }
    } catch (error) {
      const problem = toFailure(error);
      setFailure(problem);
      // F03-01: a partial commit did create a Raw — surface it in the list immediately instead
      // of waiting for the user to reopen or reload the page.
      if (problem.committed && problem.raw) {
        try {
          await onCommitted(problem.raw);
        } catch {
          /* 待恢复信息优先显示 */
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-busy={saving}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">{prefill ? '重新导入 Raw' : '新建 Raw'}</p>
            <h2 id="import-title">{prefill ? `重新导入「${prefill.title}」` : '导入原始资料'}</h2>
            <p>原文保存到本机；上传文件时原件按原始字节保留，正文由解析器提取后入库。</p>
          </div>
          <button className="icon-button" aria-label="关闭" disabled={saving} onClick={onClose}>
            ×
          </button>
        </div>
        {prefill && (
          <p className="reimport-hint">
            重新导入会创建新的 Raw ID，旧记录及其原件保持不变；工作台不会自动复制上一条的原文件或转移 Wiki 来源。
            {prefill.assetId ? ' 如需按文件导入，请重新选择原文件。' : ''}
          </p>
        )}
        {result && generationFailure && generationRaw && (
          <div className="form-error" role="alert">
            <b>Raw 已保存，Wiki 草稿未生成</b>
            <p>{generationFailure}</p>
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setGenerationFailure('');
                try {
                  await onGenerate(generationRaw);
                  setGenerationRaw(null);
                } catch (problem) {
                  setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。');
                } finally {
                  setSaving(false);
                }
              }}
            >
              用同一 Raw 重试
            </button>
            <small>
              Raw ID：<code>{generationRaw.id}</code>
            </small>
          </div>
        )}{' '}
        {result ? (
          <ResultPanel
            result={result}
            prefill={!!prefill}
            onClose={onClose}
            onOpen={() => onOpen(result.raw)}
            onAgain={resetForNext}
          />
        ) : failure?.committed && failure.raw ? (
          <PartialPanel
            failure={failure}
            raw={failure.raw}
            onClose={onClose}
            onOpen={() => onOpen(failure.raw as Raw)}
            onAgain={resetForNext}
          />
        ) : (
          <>
            <div className="dialog-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'paste'}
                disabled={saving}
                className={`dialog-tab ${mode === 'paste' ? 'active' : ''}`}
                onClick={() => setMode('paste')}
              >
                粘贴文本<small>从文章或笔记复制全文</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'file'}
                disabled={saving}
                className={`dialog-tab ${mode === 'file' ? 'active' : ''}`}
                onClick={() => setMode('file')}
              >
                上传文件<small>Markdown / TXT / DOCX / PDF</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'url'}
                disabled={saving}
                className={`dialog-tab ${mode === 'url' ? 'active' : ''}`}
                onClick={() => {
                  setMode('url');
                  removeFile();
                }}
              >
                网页链接<small>从公开网页读取原文</small>
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit(false);
              }}
            >
              {failure && !failure.committed && (
                <div className="form-error" role="alert">
                  <b className="error-code">{failure.code}</b>
                  <p>{failure.message}</p>
                  {urlOnly && !failure.message.includes('上传文件或粘贴正文') && (
                    <p>可以上传文件或粘贴可读取的原文。</p>
                  )}
                  {failure.retained && (
                    <p className="retained-note">
                      原件已保留：{failure.fileName || '上传的文件'} · {bytesText(failure.byteSize)} · SHA-256{' '}
                      <code>{failure.sha256}</code> · assetId <code>{failure.assetId}</code>
                    </p>
                  )}
                  {failure.retained && (
                    <div className="error-actions">
                      <button type="button" className="secondary-button" onClick={switchToPaste}>
                        改用粘贴文本补救
                      </button>
                    </div>
                  )}
                </div>
              )}
              <fieldset className="form-grid import-fields" disabled={saving}>
                <label className="field span-two">
                  <span>标题 {material === 'paste' && <em>*</em>}</span>
                  <input
                    value={form.title}
                    onChange={(event) => update('title', event.target.value)}
                    required={material === 'paste'}
                    maxLength={300}
                    placeholder="例如：经销商订货流程访谈纪要"
                    data-autofocus
                  />
                </label>
                <label className="field">
                  <span>
                    来源类型 <em>*</em>
                  </span>
                  <select
                    value={form.sourceType}
                    onChange={(event) => update('sourceType', event.target.value as SourceType)}
                  >
                    {Object.entries(sourceLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>来源名称 {material === 'paste' && <em>*</em>}</span>
                  <input
                    value={form.sourceName}
                    onChange={(event) => update('sourceName', event.target.value)}
                    required={material === 'paste'}
                    maxLength={300}
                    placeholder="例如：客户访谈 / 公众号名称"
                  />
                </label>
                <label className="field">
                  作者
                  <input
                    value={form.author}
                    onChange={(event) => update('author', event.target.value)}
                    maxLength={200}
                    placeholder="可选"
                  />
                </label>
                <label className="field">
                  原发布日期
                  <input
                    type="date"
                    value={form.publishedAt}
                    onChange={(event) => update('publishedAt', event.target.value)}
                  />
                </label>
                <label className="field span-two">
                  <span>原始链接 {mode === 'url' && <em>*</em>}</span>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(event) => update('url', event.target.value)}
                    required={mode === 'url'}
                    placeholder={mode === 'url' ? 'https://…' : 'https://…（可选）'}
                  />
                  <span className="field-hint">
                    没有文件或粘贴正文时，可从公开网页读取原文。标题和来源可从网页取得。
                  </span>
                </label>
                {urlOnly && (
                  <label className="raw-translate-choice span-two">
                    <input
                      type="checkbox"
                      checked={translateToChinese && !modelDisabled}
                      disabled={!!modelDisabled}
                      onChange={(event) => setTranslateToChinese(event.target.checked)}
                    />
                    翻译成中文（会调用已配置模型）
                    {modelDisabled && <small>{modelDisabled}</small>}
                  </label>
                )}
                <label className="field span-two">
                  标签
                  <input
                    value={form.tags}
                    onChange={(event) => update('tags', event.target.value)}
                    placeholder="用逗号或顿号分隔，例如：渠道、库存"
                  />
                  <span className="field-hint">
                    分隔符：中文/英文逗号、顿号、分号 · 当前 {commitTags().length} 项
                    {tagsTouched ? '' : '（未修改，按原标签保存）'}
                  </span>
                </label>
                {mode === 'paste' && (
                  <label className="field span-two body-field">
                    原始正文
                    <textarea
                      value={form.body}
                      onChange={(event) => update('body', event.target.value)}
                      maxLength={MAX_BODY_CHARS}
                      placeholder="粘贴文章、会议纪要或业务资料原文。前后空白和换行会原样保留。"
                    />
                    <span className="field-hint">
                      最多 {MAX_BODY_CHARS.toLocaleString()} 字符 · {form.body.length.toLocaleString()} 字符
                    </span>
                  </label>
                )}
                {mode === 'file' && (
                  <div className="field span-two file-picker">
                    <span>原文件（可选）</span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_FILES}
                      onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                    />
                    <span className="field-hint">
                      支持 Markdown（.md/.markdown）、TXT（.txt，严格 UTF-8）、DOCX、PDF；单个文件上限 {MAX_UPLOAD_MIB}{' '}
                      MiB，提取正文上限 {MAX_BODY_CHARS.toLocaleString()} 字符。扫描版 PDF 可以逐页阅读，加密 PDF
                      暂不支持。
                    </span>
                  </div>
                )}
                {file && (
                  <div className="file-picked span-two">
                    本次使用文件 <b>{file.name}</b>
                    <span>{bytesText(file.size)}</span>
                    <button type="button" className="text-button" onClick={removeFile}>
                      移除文件
                    </button>
                  </div>
                )}
                {!file && material === 'paste' && (
                  <p className="field-hint span-two">本次使用已粘贴的正文。链接只记作来源。</p>
                )}
              </fieldset>
              {generationFailure && generationRaw && (
                <div className="form-error" role="alert">
                  <b>Raw 已保存，Wiki 草稿未生成</b>
                  <p>{generationFailure}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      setGenerationFailure('');
                      try {
                        await onGenerate(generationRaw);
                        setGenerationRaw(null);
                        onOpen(generationRaw);
                      } catch (problem) {
                        setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    用同一 Raw 重试
                  </button>
                  <small>
                    Raw ID：<code>{generationRaw.id}</code>
                  </small>
                </div>
              )}
              <div className="dialog-footer">
                <span>
                  {urlOnly
                    ? '先从网页保存 Raw，之后可单独发起整理'
                    : pdfFile
                      ? '保存后可逐页阅读，并按需发起 AI 页理解'
                      : file
                        ? '原件、正文与来源关联都写入后才显示导入成功'
                        : '正文写入后不可由 AI 改写'}
                </span>
                <div>
                  <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
                    取消
                  </button>
                  {urlOnly ? (
                    <button type="submit" className="primary-button" disabled={saving}>
                      {saving ? '正在读取网页…' : '从网页导入 Raw'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={pdfFile ? 'primary-button' : 'secondary-button'}
                        disabled={saving}
                        onClick={(event) => {
                          const form = event.currentTarget.form;
                          if (form?.reportValidity()) void submit(false);
                        }}
                      >
                        {saving ? '正在保存…' : '仅保存 Raw'}
                      </button>
                      {!pdfFile && (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={saving || !!modelDisabled}
                          title={modelDisabled}
                          onClick={(event) => {
                            const form = event.currentTarget.form;
                            if (form?.reportValidity()) void submit(true);
                          }}
                        >
                          {saving ? '正在处理…' : '保存并生成 Wiki 草稿'}
                        </button>
                      )}
                      {!pdfFile && modelDisabled && <small className="field-help">{modelDisabled}</small>}
                    </>
                  )}
                </div>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function toFailure(error: unknown): ImportFailure {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as {
      retained?: boolean;
      committed?: boolean;
      recoverable?: boolean;
      assetId?: string;
      rawId?: string;
      raw?: Raw;
      byteSize?: number;
      sha256?: string;
      fileName?: string;
      format?: string;
    };
    return {
      code: error.code,
      message: error.message,
      retained: details.retained,
      committed: details.committed,
      recoverable: details.recoverable,
      assetId: details.assetId,
      rawId: details.rawId,
      raw: details.raw,
      byteSize: details.byteSize,
      sha256: details.sha256,
      fileName: details.fileName,
      format: details.format,
    };
  }
  return { code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : '导入失败，请重试。' };
}
