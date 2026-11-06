import { useEffect, useState, type FormEvent } from 'react';
import type { Raw, WorkHistory, WorkHistoryInput, WorkItem, WorkItemSummary, WorkItemUpdate, WorkStatus } from '../api';
import { ApiError, createWorkItem, updateWorkItem, uploadWorkScreenshot, workItem, workItems, workScreenshotUrl } from '../api';

export const workStatusLabels: Record<WorkStatus, string> = { triage: '待整理', in_progress: '处理中', waiting: '等待处理', retest: '待复测', closed: '已关闭' };
const historyLabels: Record<WorkHistory['kind'], string> = {
  feedback: '补充客户反馈', reproduction: '复现记录', technical_reply: '技术回复', sent: '已发送技术反馈', retest: '复测记录', closed: '关闭事项', reopened: '重开事项',
};
const eventTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
const formatTime = (value: string) => eventTime.format(new Date(value));
const inputTime = (value?: string) => value ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 19) : '';
const timestamp = (value: string) => value ? `${value.length === 16 ? `${value}:00` : value}+08:00` : '';
const errorText = (error: unknown) => error instanceof Error ? error.message : '本机记录操作失败，请重试。';

function Status({ value }: { value: WorkStatus }) {
  return <span className={`work-status ${value === 'waiting' ? 'action-warning' : value === 'closed' ? 'action-neutral' : 'action-review'}`}>{workStatusLabels[value]}</span>;
}

export function WorkItemsPage({ initialId, raws, onOpenRaw, onChanged }: {
  initialId: string | null;
  raws: Raw[];
  onOpenRaw: (id: string) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>(initialId ? 'detail' : 'list');
  const [id, setId] = useState(initialId);
  const [items, setItems] = useState<WorkItemSummary[] | null>(null);
  const [item, setItem] = useState<WorkItem | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [title, setTitle] = useState('');
  const [feedback, setFeedback] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (mode === 'create' || (mode === 'detail' && item?.id === id)) return;
    let active = true;
    setLoadError('');
    if (mode === 'list') {
      setItems(null);
      void workItems().then(result => { if (active) setItems(result); }).catch(error => { if (active) setLoadError(errorText(error)); });
    } else if (id) {
      void workItem(id).then(result => { if (active) setItem(result); }).catch(error => { if (active) setLoadError(errorText(error)); });
    }
    return () => { active = false; };
  }, [mode, id, item?.id, reload]);

  const back = () => { setItem(null); setId(null); setLoadError(''); setMode('list'); };
  const open = (nextId: string) => { setItem(null); setId(nextId); setMode('detail'); window.scrollTo(0, 0); };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const saved = await createWorkItem({ title, feedback });
      setItem(saved);
      setId(saved.id);
      setTitle('');
      setFeedback('');
      setMode('detail');
      onChanged();
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      setCreating(false);
    }
  };

  if (mode === 'detail' && item?.id === id && item) {
    return <WorkItemDetail key={item.id} item={item} raws={raws} onBack={back} onOpenRaw={onOpenRaw} onChanged={onChanged} />;
  }
  return <div className="page work-page">
    <div className="page-heading">
      <div>
        <h1>{mode === 'create' ? '新建客户问题' : '工作事项'}</h1>
        {mode === 'list' && <p className="subheading">记录客户问题、处理进展和下一次跟进。</p>}
      </div>
      {mode === 'list'
        ? <button className="primary-button" onClick={() => { setCreateError(''); setMode('create'); }}>新建客户问题</button>
        : <button className="secondary-button" disabled={creating} onClick={back}>返回工作事项</button>}
    </div>
    {mode === 'create' && <form className="panel work-section work-create" onSubmit={event => void create(event)}>
      <fieldset className="work-form" disabled={creating}>
        <label className="field">问题标题<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="field">客户反馈<textarea required maxLength={20_000} rows={6} value={feedback} onChange={event => setFeedback(event.target.value)} /></label>
        <p className="work-note">保存后，你可以补充客户、项目、复现过程及相关资料。</p>
        {createError && <p className="form-error" role="alert">{createError}</p>}
        <div className="work-buttons"><button className="primary-button" type="submit">{creating ? '正在创建…' : '创建事项'}</button></div>
      </fieldset>
    </form>}
    {mode !== 'create' && (loadError ? <div className="panel work-section">
      <p className="form-error" role="alert">{loadError}</p>
      <button className="secondary-button" onClick={() => setReload(value => value + 1)}>重新读取</button>
    </div> : mode === 'detail' || items === null ? <p role="status">正在读取工作事项…</p> : <section className="panel work-section" aria-labelledby="work-list-heading">
      <div className="work-section-heading"><h2 id="work-list-heading">客户问题</h2><span className="work-note">{items.length} 项</span></div>
      {items.length === 0 ? <p className="work-note">还没有客户问题。收到反馈时，可以先保存标题和原反馈。</p> : <ul className="work-list">
        {items.map(entry => <li key={entry.id}>
          <button className="work-list-row" onClick={() => open(entry.id)}>
            <span className="work-list-title">{entry.title}</span>
            {entry.followUpOn && <span className="work-note">跟进 <time dateTime={entry.followUpOn}>{entry.followUpOn}</time></span>}
            <Status value={entry.status} />
          </button>
        </li>)}
      </ul>}
    </section>)}
  </div>;
}

const contextOf = (item: WorkItem) => ({ status: item.status, customer: item.customer ?? '', project: item.project ?? '', occurredAt: inputTime(item.occurredAt),
  waitingFor: item.waitingFor ?? '', nextStep: item.nextStep ?? '', followUpOn: item.followUpOn ?? '' });
type Section = 'current' | 'history' | 'materials';

function WorkItemDetail({ item, raws, onBack, onOpenRaw, onChanged }: {
  item: WorkItem;
  raws: Raw[];
  onBack: () => void;
  onOpenRaw: (id: string) => void;
  onChanged: () => void;
}) {
  const [saved, setSaved] = useState(item);
  const [context, setContext] = useState(() => contextOf(item));
  const [closureReason, setClosureReason] = useState('');
  const [report, setReport] = useState(item.reportDraft ?? '');
  const [sent, setSent] = useState<{ body: string; time: string } | null>(null);
  const [kind, setKind] = useState<'feedback' | 'reproduction' | 'technical_reply' | 'retest'>('feedback');
  const [historyText, setHistoryText] = useState('');
  const [outcome, setOutcome] = useState<'' | 'passed' | 'failed'>('');
  const [selectedRaw, setSelectedRaw] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageNote, setImageNote] = useState('');
  const [brokenImages, setBrokenImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ section: Section; message: string; error?: boolean; conflict?: boolean } | null>(null);

  const save = async (section: Section, action: () => Promise<WorkItem>, message: string, onSaved?: (next: WorkItem) => void) => {
    setNotice(null);
    setBusy(true);
    try {
      const next = await action();
      setSaved(next);
      onSaved?.(next);
      setNotice({ section, message });
      onChanged();
    } catch (error) {
      setNotice({ section, message: errorText(error), error: true, conflict: error instanceof ApiError && error.status === 409 });
    } finally {
      setBusy(false);
    }
  };
  const update = (section: Section, patch: Omit<WorkItemUpdate, 'baseRevision'>, message: string, onSaved?: (next: WorkItem) => void) =>
    save(section, () => updateWorkItem(saved.id, { baseRevision: saved.revision, ...patch }), message, onSaved);
  const readLatest = (section: Section) => save(section, () => workItem(saved.id), '已读取最新版本。请核对你的输入后再保存。', next => {
    const previous = contextOf(saved);
    const current = contextOf(next);
    setContext({
      status: context.status === previous.status ? current.status : context.status,
      customer: context.customer === previous.customer ? current.customer : context.customer,
      project: context.project === previous.project ? current.project : context.project,
      occurredAt: context.occurredAt === previous.occurredAt ? current.occurredAt : context.occurredAt,
      waitingFor: context.waitingFor === previous.waitingFor ? current.waitingFor : context.waitingFor,
      nextStep: context.nextStep === previous.nextStep ? current.nextStep : context.nextStep,
      followUpOn: context.followUpOn === previous.followUpOn ? current.followUpOn : context.followUpOn,
    });
    if (report === (saved.reportDraft ?? '')) setReport(next.reportDraft ?? '');
  });
  const renderNotice = (section: Section) => notice?.section === section && <div className="work-notice">
    <p className={notice.error ? 'form-error' : 'work-note'} role={notice.error ? 'alert' : 'status'}>{notice.message}</p>
    {notice.conflict && <button className="secondary-button" disabled={busy} onClick={() => void readLatest(section)}>重新读取最新版本</button>}
  </div>;
  const changeContext = <K extends keyof typeof context>(key: K, value: (typeof context)[K]) => setContext(previous => ({ ...previous, [key]: value }));
  const closing = context.status === 'closed' && saved.status !== 'closed';
  const rawById = new Map(raws.map(raw => [raw.id, raw]));
  const availableRaws = raws.filter(raw => !saved.rawIds.includes(raw.id));

  return <div className="page work-page work-detail">
    <div className="page-heading">
      <div><button className="text-button work-back" onClick={onBack}>返回工作事项</button><h1>{saved.title}</h1><div className="work-detail-meta"><Status value={saved.status} /><span>最近保存 {formatTime(saved.updatedAt)}</span></div></div>
    </div>
    <section className="panel work-section" aria-labelledby="work-current">
      <div className="work-section-heading"><h2 id="work-current">当前情况</h2>
        {saved.status === 'closed' && <button className="secondary-button" disabled={busy} onClick={() => void update('current', { reopen: true }, '事项已重开。', next => changeContext('status', next.status))}>重开事项</button>}
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        void update('current', { ...context, occurredAt: timestamp(context.occurredAt), ...(closing ? { closureReason } : {}) }, closing ? '事项已关闭。' : '当前情况已保存。', next => {
          setContext(contextOf(next));
          setClosureReason('');
        });
      }}>
        <fieldset className="work-form" disabled={busy}>
          <div className="work-form-grid">
            <div className="field"><label htmlFor="work-status">状态</label><select id="work-status" value={context.status} disabled={saved.status === 'closed'} onChange={event => changeContext('status', event.target.value as WorkStatus)}>
              {Object.entries(workStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
            <label className="field">跟进日期（选填）<input type="date" aria-describedby={context.status === 'waiting' ? 'work-follow-up-hint' : undefined} value={context.followUpOn} onChange={event => changeContext('followUpOn', event.target.value)} /></label>
            {context.status === 'waiting' && <p className="work-note work-span" id="work-follow-up-hint">可以设置跟进日期，到期会显示在首页。也可以暂时留空。</p>}
            <label className="field">等谁／等什么（选填）<input maxLength={300} value={context.waitingFor} onChange={event => changeContext('waitingFor', event.target.value)} /></label>
            <label className="field">下一步（选填）<input maxLength={1000} value={context.nextStep} onChange={event => changeContext('nextStep', event.target.value)} /></label>
            <label className="field">客户（选填）<input maxLength={200} value={context.customer} onChange={event => changeContext('customer', event.target.value)} /></label>
            <label className="field">项目（选填）<input maxLength={200} value={context.project} onChange={event => changeContext('project', event.target.value)} /></label>
            <label className="field">发生时间（选填，上海时间）<input type="datetime-local" step="1" value={context.occurredAt} onChange={event => changeContext('occurredAt', event.target.value)} /></label>
            {closing && <label className="field work-span">关闭原因<textarea required maxLength={20_000} rows={2} value={closureReason} onChange={event => setClosureReason(event.target.value)} /></label>}
          </div>
          <div className="work-buttons"><button className="primary-button" type="submit">{closing ? '关闭事项' : '保存当前情况'}</button></div>
        </fieldset>
      </form>
      {renderNotice('current')}
    </section>

    <section className="panel work-section" aria-labelledby="work-history">
      <div className="work-section-heading"><h2 id="work-history">处理记录</h2></div>
      <ol className="work-history-list">
        <li><div><h3>原客户反馈</h3><time dateTime={saved.createdAt}>{formatTime(saved.createdAt)}</time></div><p className="work-prose">{saved.feedback}</p></li>
        {saved.history.map((entry, index) => <li key={`${entry.at}:${index}`}>
          <div><h3>{historyLabels[entry.kind]}{entry.kind === 'retest' && <span className={`work-status ${entry.outcome === 'passed' ? 'work-passed' : 'action-warning'}`}>{entry.outcome === 'passed' ? '通过' : '未通过'}</span>}</h3><time dateTime={entry.at}>{formatTime(entry.at)}</time></div>
          {entry.kind === 'sent' && <p className="work-note">实际发送 <time dateTime={entry.sentAt}>{formatTime(entry.sentAt)}</time></p>}
          <p className="work-prose">{entry.body}</p>
        </li>)}
      </ol>
      <form className="work-subsection" onSubmit={event => {
        event.preventDefault();
        if (kind === 'retest' && !outcome) return;
        const history: WorkHistoryInput = kind === 'retest' ? { kind, body: historyText, outcome: outcome as 'passed' | 'failed' } : { kind, body: historyText };
        void update('history', { history }, '处理记录已添加。', () => { setHistoryText(''); setOutcome(''); });
      }}>
        <h3>添加处理记录</h3>
        <fieldset className="work-form" disabled={busy}>
          <div className="work-form-grid">
            <div className="field"><label htmlFor="work-history-kind">记录类型</label><select id="work-history-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
              {(['feedback', 'reproduction', 'technical_reply', 'retest'] as const).map(value => <option key={value} value={value}>{historyLabels[value]}</option>)}
            </select></div>
            {kind === 'retest' && <div className="field"><label htmlFor="work-retest-outcome">复测结果</label><select id="work-retest-outcome" required value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)}><option value="">选择结果</option><option value="passed">通过</option><option value="failed">未通过</option></select></div>}
          </div>
          <label className="field">记录内容<textarea rows={3} required maxLength={20_000} value={historyText} onChange={event => setHistoryText(event.target.value)} /></label>
          <div className="work-buttons"><button className="secondary-button" type="submit">添加记录</button></div>
        </fieldset>
      </form>
      <form className="work-subsection" onSubmit={event => {
        event.preventDefault();
        void update('history', { reportDraft: report }, '技术反馈正文已保存。', next => setReport(next.reportDraft ?? ''));
      }}>
        <h3>手工技术反馈</h3>
        <fieldset className="work-form" disabled={busy}>
          <label className="field">技术反馈正文<textarea rows={4} maxLength={20_000} value={report} onChange={event => setReport(event.target.value)} /></label>
          <div className="work-buttons">
            <button className="secondary-button" type="submit">保存正文</button>
            <button className="secondary-button" type="button" disabled={!report.trim()} onClick={async () => {
              try {
                await navigator.clipboard.writeText(report);
                setNotice({ section: 'history', message: '正文已复制。' });
              } catch {
                setNotice({ section: 'history', message: '复制失败，请手动选择正文复制。', error: true });
              }
            }}>复制正文</button>
            <button className="secondary-button" type="button" disabled={!!sent} onClick={() => setSent({ body: report, time: '' })}>记录已发送</button>
          </div>
        </fieldset>
      </form>
      {sent && <form className="work-subsection" onSubmit={event => {
        event.preventDefault();
        void update('history', { history: { kind: 'sent', body: sent.body, sentAt: timestamp(sent.time) } }, '发送记录已添加。', () => setSent(null));
      }}>
        <h3>登记实际发送</h3>
        <fieldset className="work-form" disabled={busy}>
          <label className="field">实际发送时间（上海时间）<input type="datetime-local" step="1" required value={sent.time} onChange={event => setSent({ ...sent, time: event.target.value })} /></label>
          <label className="field">已发送正文<textarea rows={4} required maxLength={20_000} value={sent.body} onChange={event => setSent({ ...sent, body: event.target.value })} /></label>
          <div className="work-buttons"><button className="primary-button" type="submit">确认记录已发送</button><button className="secondary-button" type="button" onClick={() => setSent(null)}>取消</button></div>
        </fieldset>
      </form>}
      {renderNotice('history')}
    </section>

    <section className="panel work-section" aria-labelledby="work-materials">
      <div className="work-section-heading"><h2 id="work-materials">资料与成果</h2></div>
      <div className="work-materials-grid">
        <div>
          <h3>关联 Raw</h3>
          {saved.rawIds.length === 0 && <p className="work-note">暂无关联资料。</p>}
          <ul className="work-links">
            {saved.rawIds.map(rawId => <li key={rawId}>
              {rawById.has(rawId) ? <button className="text-button" onClick={() => onOpenRaw(rawId)}>{rawById.get(rawId)?.title} · 查看原文</button>
                : <span className="work-note">Raw 来源不可用 <small>{rawId}</small></span>}
              <button className="text-button" disabled={busy} onClick={() => void update('materials', { rawIds: saved.rawIds.filter(id => id !== rawId) }, '已移除关联。')}>移除关联</button>
            </li>)}
          </ul>
          <form onSubmit={event => {
            event.preventDefault();
            if (selectedRaw) void update('materials', { rawIds: [...saved.rawIds, selectedRaw] }, '已关联 Raw。', () => setSelectedRaw(''));
          }}>
            <fieldset className="work-form" disabled={busy}>
              <div className="field"><label htmlFor="work-raw-choice">选择已有 Raw</label><select id="work-raw-choice" value={selectedRaw} onChange={event => setSelectedRaw(event.target.value)}>
                <option value="">{availableRaws.length ? '选择一条资料' : '暂无可选资料'}</option>
                {availableRaws.map(raw => <option key={raw.id} value={raw.id}>{raw.title}</option>)}
              </select></div>
              <div className="work-buttons"><button className="secondary-button" type="submit" disabled={!selectedRaw}>添加关联</button></div>
            </fieldset>
          </form>
        </div>
        <div>
          <h3>截图</h3>
          <ul className="work-images">
            {saved.screenshots.map(image => {
              const url = workScreenshotUrl(saved.id, image.id);
              return <li key={image.id}>
                {brokenImages.includes(image.id) ? <p className="form-error" role="alert">截图无法预览。</p> : <a href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt={image.note ? `截图：${image.note}` : '已保存的事项截图'} onError={() => setBrokenImages(ids => [...ids, image.id])} />
                  <span>打开截图</span>
                </a>}
                {image.note && <p className="work-prose">{image.note}</p>}
              </li>;
            })}
          </ul>
          <form onSubmit={event => {
            event.preventDefault();
            if (!imageFile) return;
            const formElement = event.currentTarget;
            const form = new FormData();
            form.set('file', imageFile);
            form.set('note', imageNote);
            form.set('baseRevision', String(saved.revision));
            void save('materials', () => uploadWorkScreenshot(saved.id, form), '截图已保存。', () => {
              formElement.reset();
              setImageFile(null);
              setImageNote('');
            });
          }}>
            <fieldset className="work-form" disabled={busy}>
              <label className="field">截图文件<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-describedby="work-image-hint" onChange={event => setImageFile(event.target.files?.[0] ?? null)} /></label>
              <p className="work-note" id="work-image-hint">PNG 或 JPEG，最多 5 MiB。</p>
              <label className="field">截图说明（选填）<textarea rows={2} maxLength={1000} value={imageNote} onChange={event => setImageNote(event.target.value)} /></label>
              <div className="work-buttons"><button className="secondary-button" type="submit" disabled={!imageFile}>上传截图</button></div>
            </fieldset>
          </form>
        </div>
      </div>
      {renderNotice('materials')}
    </section>
  </div>;
}
