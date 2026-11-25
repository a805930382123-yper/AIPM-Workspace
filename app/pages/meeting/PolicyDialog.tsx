import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Meeting, type MeetingConfidentiality } from '../../api';
import { useDialogFocus } from '../../components/useDialogFocus';
import { formatMeetingError, MEETING_LEVELS } from './meetingFilters';

export type PolicyDialogProps = {
  meeting: Meeting;
  token: number;
  onClose: () => void;
  onReload: () => void;
  onSaved: (id: string, token: number) => void;
};

export function PolicyDialog({ meeting, token, onClose, onReload, onSaved }: PolicyDialogProps) {
  const dialog = useDialogFocus<HTMLElement>();
  const submitLock = useRef(false);
  const [conf, setConf] = useState(meeting.confidentiality),
    [mode, setMode] = useState(meeting.storage_mode),
    [local, setLocal] = useState(meeting.local_storage_authorized),
    [raw, setRaw] = useState(meeting.raw_transfer_authorized),
    [confirmLocal, setConfirmLocal] = useState(false),
    [confirmRaw, setConfirmRaw] = useState(false),
    [confirmClear, setConfirmClear] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [isConflict, setIsConflict] = useState(false);
  const restrictedFields = [
    ['tags', meeting.tags.length > 0],
    ['customer', !!meeting.customer],
    ['project', !!meeting.project],
    ['description', !!meeting.description],
    ['recording_url', !!meeting.recording_url],
    ['minutes_url', !!meeting.minutes_url],
  ]
    .filter((x) => x[1])
    .map((x) => String(x[0]));
  const index = MEETING_LEVELS.indexOf(meeting.confidentiality);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError('');
    setIsConflict(false);
    const effectiveRaw =
      conf !== meeting.confidentiality || mode === 'cloud_index' || conf === 'Restricted' ? false : raw;
    const body = {
      baseRevision: meeting.revision,
      confidentiality: conf,
      storage_mode: mode,
      local_storage_authorized: local,
      raw_transfer_authorized: effectiveRaw,
      external_ai_authorized: false,
      ...(confirmLocal ? { confirm_local_storage: true } : {}),
      ...(confirmRaw ? { confirm_raw_transfer: true } : {}),
      ...(confirmClear ? { confirm_restricted_metadata_clear: true } : {}),
    };
    try {
      const updated = await api<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}/policy`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved(updated.meeting_id, token);
    } catch (e) {
      const details =
        e instanceof ApiError && e.details && typeof e.details === 'object'
          ? (e.details as { localCopies?: unknown })
          : undefined;
      const localCopies = details?.localCopies;
      const message =
        e instanceof ApiError &&
        e.code === 'LOCAL_COPIES_PENDING' &&
        Number.isSafeInteger(localCopies) &&
        Number(localCopies) >= 0 &&
        Number(localCopies) <= 1000000
          ? `${e.message}（本地纪要副本：${localCopies} 份）`
          : formatMeetingError(e);
      setError(`${message} 策略表单仍保留。`);
      setIsConflict(e instanceof ApiError && e.status === 409);
      submitLock.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="import-dialog meeting-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="policy-title">会议安全策略</h2>
            <p>保存时会检查最新版本，避免覆盖已有修改。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field">
              保密等级
              <select
                value={conf}
                onChange={(e) => {
                  setConf(e.target.value as MeetingConfidentiality);
                  if (e.target.value === 'Restricted') {
                    setMode('cloud_index');
                    setLocal(false);
                    setRaw(false);
                  }
                }}
              >
                {MEETING_LEVELS.slice(index).map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              存储模式
              <select
                value={mode}
                disabled={conf === 'Restricted'}
                onChange={(e) => setMode(e.target.value as 'cloud_index' | 'local_archive')}
              >
                <option value="cloud_index">云端索引</option>
                <option value="local_archive">本地归档</option>
              </select>
            </label>
            <label className="meeting-check span-two">
              <input
                type="checkbox"
                checked={local}
                disabled={conf === 'Restricted'}
                onChange={(e) => setLocal(e.target.checked)}
              />
              授权本地保存（开启 Internal/Sensitive 本地模式时需本次独立确认）
            </label>
            {(mode === 'local_archive' ||
              local ||
              (conf === 'Internal' && meeting.storage_mode === 'local_archive')) && (
              <label className="meeting-check span-two">
                <input type="checkbox" checked={confirmLocal} onChange={(e) => setConfirmLocal(e.target.checked)} />
                我确认本地保存授权适用于此会议
              </label>
            )}
            <label className="meeting-check span-two">
              <input
                type="checkbox"
                checked={raw}
                disabled={!['Public', 'Internal'].includes(conf) || mode !== 'local_archive'}
                onChange={(e) => setRaw(e.target.checked)}
              />
              授权本地 Raw 登记（仅 Public/Internal，且需逐次显式确认）
            </label>
            {raw && (
              <label className="meeting-check span-two">
                <input type="checkbox" checked={confirmRaw} onChange={(e) => setConfirmRaw(e.target.checked)} />
                我单独确认 Raw 登记授权
              </label>
            )}
            <div className="meeting-restricted-note span-two">
              外部 AI 处理始终禁用。升级到 Restricted 会将不允许的标签、客户、项目、备注及云链接清空。
            </div>
            {conf === 'Restricted' && restrictedFields.length > 0 && (
              <div className="meeting-clear-preview span-two">
                <b>升级预览：将清空以下字段</b>
                <p>{restrictedFields.join('、')}</p>
                <label className="meeting-check">
                  <input type="checkbox" checked={confirmClear} onChange={(e) => setConfirmClear(e.target.checked)} />
                  我已查看并确认清空以上字段
                </label>
              </div>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
              {isConflict && (
                <>
                  <p>策略输入仍保留。载入最新版后，确认当前状态再提交。</p>
                  <button type="button" className="text-button" onClick={onReload}>
                    载入最新版
                  </button>
                </>
              )}
            </div>
          )}
          <footer className="dialog-footer">
            <span>纪要导入与授权 Raw 登记已支持；外部 AI 处理始终禁用。</span>
            <div>
              <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? '提交中…' : '保存策略'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
