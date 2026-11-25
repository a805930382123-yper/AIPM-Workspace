import { useRef, useState } from 'react';
import { api, ApiError, type MeetingCatalog, type MeetingCatalogEntry } from '../../api';
import { useDialogFocus } from '../../components/useDialogFocus';
import { formatMeetingError } from './meetingFilters';

export type CatalogDialogProps = {
  kind: 'types' | 'tags';
  catalog: MeetingCatalog;
  token: number;
  onClose: () => void;
  onReload: () => void;
  onSaved: (c: MeetingCatalog, token: number) => void;
};

export function CatalogDialog({ kind, catalog, token, onClose, onReload, onSaved }: CatalogDialogProps) {
  const dialog = useDialogFocus<HTMLElement>();
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [isConflict, setIsConflict] = useState(false);
  const list = catalog[kind];
  const mutateLock = useRef(false);
  const mutate = async (entry?: MeetingCatalogEntry, patch: Record<string, unknown> = {}) => {
    if (mutateLock.current) return false;
    mutateLock.current = true;
    setBusy(true);
    setError('');
    setIsConflict(false);
    try {
      const c = await api<MeetingCatalog>(
        entry ? `/api/meeting-catalog/${kind}/${entry.id}` : `/api/meeting-catalog/${kind}`,
        {
          method: entry ? 'PATCH' : 'POST',
          body: JSON.stringify({ baseRevision: catalog.revision, ...(entry ? patch : { name: name.trim() }) }),
        },
      );
      onSaved(c, token);
      if (!entry) setName('');
      setBusy(false);
      mutateLock.current = false;
      return true;
    } catch (e) {
      setError(`${formatMeetingError(e)} 当前目录编辑仍保留。`);
      setIsConflict(e instanceof ApiError && e.status === 409);
      setBusy(false);
      mutateLock.current = false;
      return false;
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
        aria-labelledby="catalog-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="catalog-title">管理{kind === 'types' ? '会议类型' : '业务标签'}</h2>
            <p>改名和停用沿用稳定 ID；历史会议会显示最新名称并可筛选。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="catalog-content">
          <form
            className="catalog-add"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate();
            }}
          >
            <label className="field">
              新增名称
              <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="primary-button" disabled={busy || !name.trim()}>
              新增
            </button>
          </form>
          <div className="catalog-items">
            {list.map((item) => (
              <CatalogItem
                key={item.id}
                entry={item}
                busy={busy}
                onRename={(next) => mutate(item, { name: next })}
                onActive={(active) => void mutate(item, { active })}
              />
            ))}
          </div>
          {error && (
            <div className="meeting-error" role="alert">
              {error}
              {isConflict && (
                <button className="text-button" onClick={onReload}>
                  载入最新目录
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <span>目录版本 rev {catalog.revision}</span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}

function CatalogItem({
  entry,
  busy,
  onRename,
  onActive,
}: {
  entry: MeetingCatalogEntry;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onActive: (active: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(entry.name);
  return (
    <div className="catalog-item">
      {editing ? (
        <input
          aria-label={`重命名 ${entry.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      ) : (
        <>
          <b>{entry.name}</b>
          <small>{entry.active ? '启用' : '已停用'}</small>
        </>
      )}
      <div>
        {editing ? (
          <>
            <button
              className="text-button"
              disabled={busy || !name.trim()}
              onClick={async () => {
                if (await onRename(name)) setEditing(false);
              }}
            >
              保存名称
            </button>
            <button
              className="text-button"
              onClick={() => {
                setName(entry.name);
                setEditing(false);
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button className="text-button" disabled={busy} onClick={() => setEditing(true)}>
              改名
            </button>
            <button className="text-button" disabled={busy} onClick={() => onActive(!entry.active)}>
              {entry.active ? '停用' : '恢复'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
