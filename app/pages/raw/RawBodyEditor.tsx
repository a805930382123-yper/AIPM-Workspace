import { useEffect, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import type { Raw } from '../../api';
import { ApiError, getRaw, getRawBodyHistory, saveRawBody } from '../../api';
import { MAX_BODY_CHARS } from '../../../services/raw/limits.ts';
import { isPdfRaw } from './rawPdf';
export function RawBodyEditor({
  item,
  onClose,
  onSaved,
}: {
  item: Raw;
  onClose: () => void;
  onSaved: (raw: Raw) => void;
}) {
  const dialog = useDialogFocus<HTMLElement>();
  const [base, setBase] = useState(item);
  const [body, setBody] = useState(item.body);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Raw | null>(null);
  const save = async () => {
    setWorking(true);
    setError('');
    try {
      onSaved(await saveRawBody(base, body));
    } catch (problem) {
      setConflict(problem instanceof ApiError && problem.code === 'RAW_BODY_CONFLICT');
      setLatest(null);
      setError(problem instanceof Error ? problem.message : '保存原文失败。');
    } finally {
      setWorking(false);
    }
  };
  const readLatest = async () => {
    setWorking(true);
    setError('');
    try {
      setLatest(await getRaw(base.id));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '无法读取最新原文。');
    } finally {
      setWorking(false);
    }
  };
  const canSave = !working && !conflict && !!body.trim() && body.length <= MAX_BODY_CHARS;
  return (
    <div className="modal-scrim">
      <section
        ref={dialog}
        tabIndex={-1}
        className="panel import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="raw-body-edit-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !working) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <h2 id="raw-body-edit-title">编辑原文</h2>
            <p>{item.title}</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭原文编辑" disabled={working} onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          <p className="extract-note">
            {isPdfRaw(item)
              ? '编辑的是提取文字，PDF 原件未改。保存后，旧页码定位与按页整理成果不适用于新正文。'
              : '保存会保留修改前的原文。旧整理成果需要按当前原文重新核对。'}
          </p>
          <label className="field">
            原文正文
            <textarea
              data-autofocus
              rows={14}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              readOnly={working}
            />
          </label>
          <p className="field-hint">
            {body.length.toLocaleString()} / {MAX_BODY_CHARS.toLocaleString()} 字符
          </p>
          {body.length > MAX_BODY_CHARS && (
            <p className="form-error" role="alert">
              正文超过字符上限，请缩短后保存。
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {conflict && !latest && (
            <button type="button" className="secondary-button" disabled={working} onClick={() => void readLatest()}>
              读取最新原文
            </button>
          )}
          {conflict && latest && (
            <section aria-label="最新原文">
              <p className="extract-note">请核对最新原文（第 {latest.bodyRevision ?? 0} 版）。上方保留了你的编辑。</p>
              <label className="field">
                最新原文正文
                <textarea rows={8} value={latest.body} readOnly />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setBase(latest);
                  setLatest(null);
                  setConflict(false);
                }}
              >
                已核对，保留我的编辑
              </button>
            </section>
          )}
          <div className="dialog-footer">
            <span>{!conflict && base !== item ? '将基于已核对的第 ' + (base.bodyRevision ?? 0) + ' 版保存' : ''}</span>
            <div>
              <button type="button" className="secondary-button" disabled={working} onClick={onClose}>
                取消
              </button>
              <button className="primary-button" disabled={!canSave}>
                {working ? '处理中…' : '保存原文'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export function RawBodyHistory({ item, onClose }: { item: Raw; onClose: () => void }) {
  const dialog = useDialogFocus<HTMLElement>();
  const [revision, setRevision] = useState((item.bodyRevision ?? 1) - 1);
  const [snapshot, setSnapshot] = useState<Raw | null>(null);
  const [error, setError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError('');
    getRawBodyHistory(item.id, revision)
      .then((raw) => {
        if (active) setSnapshot(raw);
      })
      .catch((problem) => {
        if (active) setError(problem instanceof Error ? problem.message : '无法读取旧版原文。');
      });
    return () => {
      active = false;
    };
  }, [item.id, revision, readAttempt]);
  const visible = snapshot && (snapshot.bodyRevision ?? 0) === revision ? snapshot : null;
  return (
    <div className="modal-scrim">
      <section
        ref={dialog}
        tabIndex={-1}
        className="panel import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="raw-body-history-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <h2 id="raw-body-history-title">原文修改历史</h2>
            <p>{item.title}</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭修改历史" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="raw-detail">
          <div className="action-group">
            <button className="secondary-button" disabled={revision === 0} onClick={() => setRevision(revision - 1)}>
              更早一版
            </button>
            <button
              className="secondary-button"
              disabled={revision >= (item.bodyRevision ?? 1) - 1}
              onClick={() => setRevision(revision + 1)}
            >
              更新一版
            </button>
          </div>
          <h3>{revision === 0 ? '导入时的原文' : '人工修改第 ' + revision + ' 版'}</h3>
          {error ? (
            <p className="form-error" role="alert">
              {error}{' '}
              <button className="text-button" onClick={() => setReadAttempt((attempt) => attempt + 1)}>
                重读此版本
              </button>
            </p>
          ) : visible ? (
            <>
              <pre className="raw-body">{visible.body || '此版本没有提取文字。'}</pre>
              <div className="hash-line">
                正文校验值 <code>{visible.bodySha256}</code>
              </div>
            </>
          ) : (
            <p role="status">正在读取历史版本…</p>
          )}
        </div>
      </section>
    </div>
  );
}
