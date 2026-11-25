import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Meeting, type MeetingCatalog, type MeetingConfidentiality } from '../../api';
import { useDialogFocus } from '../../components/useDialogFocus';
import { formatMeetingError, MEETING_LEVELS, newMeetingRequestId, todayLocalDate } from './meetingFilters';

export type MeetingEditorProps = {
  mode: 'create' | 'edit';
  item: Meeting | null;
  catalog: MeetingCatalog | null;
  token: number;
  onClose: () => void;
  onReload: () => void;
  onSaved: (id: string, token: number, upload?: boolean) => void;
};

export function MeetingEditor({ mode, item, catalog, token, onClose, onReload, onSaved }: MeetingEditorProps) {
  const dialog = useDialogFocus<HTMLElement>();
  const requestId = useRef(newMeetingRequestId());
  const submitLock = useRef(false);
  const [values, setValues] = useState(() => ({
    title: item?.title || '',
    meeting_date: item?.meeting_date || todayLocalDate(),
    meeting_time: item?.meeting_time || '',
    meeting_type: item?.meeting_type || catalog?.types.find((x) => x.active)?.id || '',
    tags: item?.tags || ([] as string[]),
    customer: item?.customer || '',
    project: item?.project || '',
    description: item?.description || '',
    recording_url: item?.recording_url || '',
    minutes_url: item?.minutes_url || '',
    confidentiality: item?.confidentiality || ('Sensitive' as MeetingConfidentiality),
  }));
  const [uploadAfter, setUploadAfter] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [isConflict, setIsConflict] = useState(false);
  const isRestricted = values.confidentiality === 'Restricted';
  const set = (key: string, value: string) => {
    if (mode === 'create') requestId.current = newMeetingRequestId();
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === 'confidentiality' && value === 'Restricted'
        ? { tags: [], customer: '', project: '', description: '', recording_url: '', minutes_url: '' }
        : {}),
    }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setError('');
    setIsConflict(false);
    try {
      let result: Meeting;
      if (mode === 'create') {
        const body = {
          requestId: requestId.current,
          title: values.title,
          meeting_date: values.meeting_date,
          meeting_time: values.meeting_time || null,
          meeting_type: values.meeting_type,
          tags: isRestricted ? [] : values.tags,
          customer: isRestricted ? null : values.customer || null,
          project: isRestricted ? null : values.project || null,
          description: isRestricted ? null : values.description || null,
          recording_url: isRestricted ? null : values.recording_url || null,
          minutes_url: isRestricted ? null : values.minutes_url || null,
          confidentiality: values.confidentiality,
        };
        result = await api<Meeting>('/api/meetings', { method: 'POST', body: JSON.stringify(body) });
      } else {
        const body: Record<string, unknown> = { baseRevision: item!.revision };
        for (const key of [
          'title',
          'meeting_date',
          'meeting_time',
          'customer',
          'project',
          'description',
          'recording_url',
          'minutes_url',
        ] as const)
          body[key] = values[key] || null;
        if (values.meeting_type !== item!.meeting_type) body.meeting_type = values.meeting_type;
        if (values.tags.join(',') !== item!.tags.join(',')) body.tags = values.tags;
        result = await api<Meeting>(`/api/meetings/${encodeURIComponent(item!.meeting_id)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      onSaved(result.meeting_id, token, uploadAfter);
    } catch (e) {
      setError(`${formatMeetingError(e)} 输入仍保留。`);
      setIsConflict(e instanceof ApiError && e.status === 409);
      submitLock.current = false;
      setSaving(false);
    }
  };
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="import-dialog meeting-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-editor-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !saving) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="meeting-editor-title">{mode === 'create' ? '新建会议' : '编辑会议信息'}</h2>
            <p>{mode === 'create' ? '会议标题、日期和主类型为必填。' : '普通编辑只修改会议资料，不改变安全策略。'}</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={saving} onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field span-two">
              会议标题 <em>*</em>
              <input required maxLength={200} value={values.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="field">
              日期 <em>*</em>
              <input
                type="date"
                required
                value={values.meeting_date}
                onChange={(e) => set('meeting_date', e.target.value)}
              />
            </label>
            <label className="field">
              时间
              <input type="time" value={values.meeting_time} onChange={(e) => set('meeting_time', e.target.value)} />
            </label>
            <label className="field">
              主类型 <em>*</em>
              <select required value={values.meeting_type} onChange={(e) => set('meeting_type', e.target.value)}>
                {!values.meeting_type && <option value="">请选择会议类型</option>}
                {catalog?.types
                  .filter((x) => x.active || x.id === values.meeting_type)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {!x.active ? '（历史引用）' : ''}
                    </option>
                  ))}
              </select>
            </label>
            {mode === 'create' && (
              <label className="field">
                保密等级
                <select value={values.confidentiality} onChange={(e) => set('confidentiality', e.target.value)}>
                  {MEETING_LEVELS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            )}
            {isRestricted ? (
              <div className="meeting-restricted-note span-two">
                Restricted 仅登记代称、日期、时间与主类型。标签、客户、项目、备注和云端链接均不会发送。
              </div>
            ) : (
              <>
                <label className="field span-two">
                  标签（可多选）
                  <select
                    multiple
                    size={4}
                    value={values.tags}
                    onChange={(e) => {
                      if (mode === 'create') requestId.current = newMeetingRequestId();
                      setValues((v) => ({ ...v, tags: [...e.target.selectedOptions].map((o) => o.value) }));
                    }}
                  >
                    {catalog?.tags
                      .filter((x) => x.active || values.tags.includes(x.id))
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                          {!x.active ? '（历史引用）' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  客户
                  <input maxLength={200} value={values.customer} onChange={(e) => set('customer', e.target.value)} />
                </label>
                <label className="field">
                  项目
                  <input maxLength={200} value={values.project} onChange={(e) => set('project', e.target.value)} />
                </label>
                <label className="field span-two">
                  备注
                  <textarea
                    maxLength={2000}
                    value={values.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </label>
                <label className="field span-two">
                  录音链接（HTTPS）
                  <input
                    type="url"
                    placeholder="https://"
                    value={values.recording_url}
                    onChange={(e) => set('recording_url', e.target.value)}
                  />
                </label>
                <label className="field span-two">
                  纪要链接（HTTPS）
                  <input
                    type="url"
                    placeholder="https://"
                    value={values.minutes_url}
                    onChange={(e) => set('minutes_url', e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
              {isConflict && (
                <>
                  <p>当前编辑内容仍保留。先载入最新资料，再检查后提交。</p>
                  <button type="button" className="text-button" onClick={onReload}>
                    载入最新版
                  </button>
                </>
              )}
            </div>
          )}
          <footer className="dialog-footer">
            <span>
              档案保存在本机。{mode === 'create' && uploadAfter ? ' 保存后请在本地纪要区确认授权并上传。' : ''}
            </span>
            <div>
              <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
                取消
              </button>
              {mode === 'create' && (
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => setUploadAfter(true)}
                >
                  保存并上传本地纪要
                </button>
              )}
              <button className="primary-button" disabled={saving} onClick={() => setUploadAfter(false)}>
                {saving ? '正在保存…' : '保存会议档案'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
