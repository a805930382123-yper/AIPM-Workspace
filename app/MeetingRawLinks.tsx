import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, type Meeting, type MeetingRawLink } from './api';

type Props = { meeting: Meeting; onRefresh: () => void; onRawChanged?: () => Promise<void>; onOpenRaw?: (id: string) => void };
type RegisterResult = Meeting & { raw_id: string; reused: boolean };
const newId = (): string => crypto.randomUUID();
const textError = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const statusLabels: Record<MeetingRawLink['status'], string> = {
  pending: '登记中', linked: '已关联', failed: '登记失败', unlinked: '已解除', raw_deleted: 'Raw已删除',
};

export function MeetingRawLinks({ meeting, onRefresh, onRawChanged, onOpenRaw }: Props) {
  const [revision, setRevision] = useState(meeting.revision);
  const [importId, setImportId] = useState('');
  const [requestId, setRequestId] = useState(newId());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [unlinkConfirmed, setUnlinkConfirmed] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const meetingIdRef = useRef(meeting.meeting_id);
  meetingIdRef.current = meeting.meeting_id;
  const ownsMeeting = (id: string) => alive.current && meetingIdRef.current === id;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    setRevision(meeting.revision);
    setImportId(current => meeting.imports.some(item => item.import_id === current) ? current : meeting.active_import_id ?? meeting.imports[0]?.import_id ?? '');
  }, [meeting.meeting_id, meeting.revision, meeting.imports, meeting.active_import_id]);
  useEffect(() => {
    setImportId(meeting.active_import_id ?? meeting.imports[0]?.import_id ?? '');
    setRequestId(newId()); setConfirmed(false); setBusy(false); setError(''); setConflict(false);
    setUnlinkId(null); setUnlinkConfirmed(false); lock.current = false;
  }, [meeting.meeting_id]);
  const activeLinks = useMemo(() => new Set(meeting.raw_links.filter(item => ['pending', 'linked'].includes(item.status)).map(item => item.import_id)), [meeting.raw_links]);
  const reload = async () => {
    const actionMeetingId = meeting.meeting_id;
    setError('');
    try {
      const latest = await api<Meeting>(`/api/meetings/${encodeURIComponent(actionMeetingId)}`);
      if (!ownsMeeting(actionMeetingId)) return;
      setRevision(latest.revision);
      setConflict(false);
      onRefresh();
    } catch (caught) {
      if (ownsMeeting(actionMeetingId)) setError(textError(caught));
    }
  };
  const register = async () => {
    const retrying = meeting.raw_links.some(link => link.request_id === requestId && link.import_id === importId && ['pending','failed'].includes(link.status));
    if (lock.current || !importId || (!confirmed && !retrying)) return;
    lock.current = true;
    const actionMeetingId = meeting.meeting_id;
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await api<RegisterResult>(`/api/meetings/${encodeURIComponent(actionMeetingId)}/raw-links`, {
        method: 'POST',
        body: JSON.stringify({ baseRevision: revision, requestId, import_id: importId, confirm: true }),
      });
      if (!ownsMeeting(actionMeetingId)) return;
      setRevision(result.revision);
      setRequestId(newId());
      setConfirmed(false);
      onRefresh();
      await onRawChanged?.();
    } catch (caught) {
      if (ownsMeeting(actionMeetingId)) {
        setError(`${textError(caught)} 登记输入仍保留。`);
        setConflict(caught instanceof ApiError && caught.status === 409);
      }
    } finally {
      lock.current = false;
      if (ownsMeeting(actionMeetingId)) setBusy(false);
    }
  };
  const retry = (link: MeetingRawLink) => {
    setImportId(link.import_id);
    setRequestId(link.request_id);
    setConfirmed(false);
    setError('');
    setConflict(false);
  };
  const unlink = async (link: MeetingRawLink) => {
    if (lock.current || !unlinkConfirmed) return;
    lock.current = true;
    const actionMeetingId = meeting.meeting_id;
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await api<Meeting>(`/api/meetings/${encodeURIComponent(actionMeetingId)}/raw-links/${encodeURIComponent(link.raw_id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ baseRevision: revision, confirm: true }),
      });
      if (!ownsMeeting(actionMeetingId)) return;
      setRevision(result.revision);
      setUnlinkId(null);
      setUnlinkConfirmed(false);
      onRefresh();
    } catch (caught) {
      if (ownsMeeting(actionMeetingId)) {
        setError(`${textError(caught)} 解除确认仍保留。`);
        setConflict(caught instanceof ApiError && caught.status === 409);
      }
    } finally {
      lock.current = false;
      if (ownsMeeting(actionMeetingId)) setBusy(false);
    }
  };
  const canRegister = meeting.capabilities?.canRegisterRaw === true;
  const retryingCurrent = meeting.raw_links.some(link => link.request_id === requestId && link.import_id === importId && ['pending','failed'].includes(link.status));
  return <section className="meeting-raw-links" aria-label="会议 Raw 登记">
    <header><div><h3>Raw 本机登记</h3><p>选定原件版本写入本机 Raw；来源固定为 meeting_local_only，禁止 AI、Wiki 和 Prompt。</p></div></header>
    {error && <div className="meeting-error" role="alert"><span>{error}{conflict && <p>检测到版本冲突。载入最新记录后重新检查。</p>}</span>{conflict && <button className="text-button" disabled={busy} onClick={() => void reload()}>重载最新版</button>}</div>}
    <div className="meeting-raw-register">
      <label className="field">登记版本<select aria-label="选择Raw登记纪要版本" value={importId} disabled={!canRegister || busy} onChange={event => { setImportId(event.target.value); setRequestId(newId()); setConfirmed(false); }}>
        {meeting.imports.map(item => <option key={item.import_id} value={item.import_id} disabled={activeLinks.has(item.import_id)}>{new Date(item.imported_at).toLocaleString('zh-CN')}{item.import_id === meeting.active_import_id ? '（当前）' : '（历史）'}{activeLinks.has(item.import_id) ? ' · 已有Raw' : ''}</option>)}
      </select></label>
      <label className="meeting-check"><input type="checkbox" checked={confirmed} disabled={!canRegister || busy || !importId} onChange={event => setConfirmed(event.target.checked)} />我确认把选定版本的 imported_minutes 原文登记为本机 Raw。</label>
      <button className="primary-button" disabled={!canRegister || busy || !importId || (!confirmed && !retryingCurrent) || (activeLinks.has(importId) && !retryingCurrent)} onClick={() => void register()}>{busy ? '登记中…' : retryingCurrent ? '使用同一请求恢复' : '登记 Raw'}</button>
      {!canRegister && <p className="meeting-raw-hint">{meeting.capabilities?.rawReason || '当前会议策略不允许登记Raw。'}</p>}
      {canRegister && <p className="meeting-raw-hint">重导入不会自动登记；每次登记都需要明确选择版本并确认。</p>}
    </div>
    <div className="meeting-raw-list">
      {meeting.raw_links.length === 0 ? <p className="meeting-raw-empty">暂无Raw登记记录。</p> : meeting.raw_links.map(link => {
        const version = meeting.imports.find(item => item.import_id === link.import_id);
        return <article key={link.request_id} className={`meeting-raw-link ${link.status}`}>
          <div><b>{statusLabels[link.status]}</b><span>{link.raw_title}</span></div>
          <dl>
            <div><dt>Raw ID</dt><dd><code>{link.raw_id}</code></dd></div>
            <div><dt>来源版本</dt><dd>{version ? new Date(version.imported_at).toLocaleString('zh-CN') : '纪要已删除'} · {link.import_id}</dd></div>
            <div><dt>原件 SHA-256</dt><dd><code>{link.original_sha256}</code></dd></div>
            {link.status === 'failed' && link.error && <div><dt>失败代码</dt><dd>{link.error.code}</dd></div>}
          </dl>
          <div className="meeting-raw-actions">
            {['failed', 'pending'].includes(link.status) && <button className="secondary-button" disabled={busy} onClick={() => retry(link)}>使用同一请求重试</button>}
            {link.status === 'linked' && unlinkId !== link.raw_id && <button className="secondary-button danger-button" disabled={busy} onClick={() => { setUnlinkId(link.raw_id); setUnlinkConfirmed(false); }}>解除展示关联</button>}
            {link.status === 'linked' && onOpenRaw && <button className="secondary-button" onClick={() => onOpenRaw(link.raw_id)}>查看 Raw</button>}
            {link.status === 'linked' && unlinkId === link.raw_id && <label className="meeting-check"><input type="checkbox" checked={unlinkConfirmed} onChange={event => setUnlinkConfirmed(event.target.checked)} />我确认仅解除展示关联，不删除Raw。</label>}
            {link.status === 'linked' && unlinkId === link.raw_id && <><button className="secondary-button" disabled={busy} onClick={() => { setUnlinkId(null); setUnlinkConfirmed(false); }}>取消</button><button className="primary-button danger-fill" disabled={busy || !unlinkConfirmed} onClick={() => void unlink(link)}>确认解除</button></>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
