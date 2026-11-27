import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { WikiModelStatus } from './WikiModelStatus';
import {
  getWikiReviewIndex,
  getWikiReviewQueue,
  reviewWiki,
  type Wiki,
  type WikiReviewAction,
  type WikiReviewFreshness,
  type WikiReviewIndex,
  type WikiReviewQueue,
} from '../api/wiki';

export const freshnessLabels: Record<WikiReviewFreshness['status'], string> = {
  due: '已到期',
  due_soon: '即将到期',
  unverified: '历史未核验',
  fresh: '有效期内',
  evergreen: '常青',
};

const triggerReasons = {
  source_changed: '已关联的 Raw 正文已更新，请复核受影响的结论。',
  new_source: '有新的相似 Raw 资料，请比对是否影响本页结论。',
  inference: '本页存在待人工核对的推断。',
};

export function WikiFreshnessBadge({ freshness }: { freshness: WikiReviewFreshness }) {
  if (freshness.snoozed) return <span className="tag">已暂缓</span>;
  const label = freshness.activeTriggers.length
    ? '有复核提醒'
    : freshness.status === 'fresh' || freshness.status === 'evergreen'
      ? undefined
      : freshnessLabels[freshness.status];
  return label ? (
    <span
      className="tag wiki-review-badge"
      data-urgent={freshness.status === 'due' || freshness.activeTriggers.length > 0}
    >
      {label}
    </span>
  ) : null;
}

export function WikiReviewReasons({
  freshness,
}: {
  freshness: Pick<WikiReviewFreshness, 'status' | 'dueOn' | 'activeTriggers' | 'reminders'>;
}) {
  const reasons = freshness.activeTriggers.map<{ kind: string; origin: string; text: string }>((kind) => {
    const reminder = freshness.reminders.filter((item) => item.kind === kind).at(-1);
    return {
      kind,
      origin: kind === 'source_changed' ? '系统提醒' : '系统推断',
      text: reminder?.reason ?? triggerReasons[kind],
    };
  });
  if (freshness.status === 'unverified')
    reasons.push({ kind: 'unverified', origin: '系统提醒', text: '尚无人工核验日期。' });
  if (freshness.status === 'due' || freshness.status === 'due_soon')
    reasons.push({
      kind: freshness.status,
      origin: '系统提醒',
      text: `${freshnessLabels[freshness.status]} · ${freshness.dueOn}`,
    });
  return reasons.length ? (
    <ul className="wiki-review-reasons">
      {reasons.map(({ kind, origin, text }) => (
        <li key={kind}>
          <strong>{origin}</strong> {text}
        </li>
      ))}
    </ul>
  ) : null;
}

export function WikiReviewActions({
  id,
  revision,
  cycleDays,
  options = false,
  onConfirm,
  onUpdated,
  onOutdated,
}: {
  id: string;
  revision: number;
  cycleDays: number | null;
  options?: boolean;
  onConfirm?: (revision: number) => Promise<Wiki>;
  onUpdated: (wiki: Wiki, message: string) => void;
  onOutdated: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const daysId = useId();
  const cycleTrigger = useRef<HTMLButtonElement>(null);
  const run = async (action: WikiReviewAction) => {
    if (pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      const wiki = await (action.kind === 'confirm' && onConfirm
        ? onConfirm(revision)
        : reviewWiki(id, revision, action));
      const message =
        action.kind === 'confirm' ? '已确认仍有效。' : action.kind === 'snooze' ? '已暂缓 30 天。' : '已更新复核周期。';
      setFeedback({ message });
      if (action.kind === 'cycle') {
        setEditing(false);
        cycleTrigger.current?.focus();
      }
      onUpdated(wiki, message);
    } catch (error) {
      const outdated = error instanceof ApiError && [403, 404, 409].includes(error.status);
      const message = error instanceof Error ? error.message : '复核操作失败，请重试。';
      if (outdated) {
        setEditing(false);
        await onOutdated();
        if (action.kind === 'cycle') cycleTrigger.current?.focus();
      }
      setFeedback({
        message:
          outdated && error instanceof ApiError && error.code === 'REVISION_CONFLICT'
            ? '页面已更新，请核对当前版本后再操作。'
            : message,
        error: true,
      });
    } finally {
      setPending(false);
    }
  };
  const saveCycle = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(days);
    if (!days.trim() || !Number.isSafeInteger(value) || value < 0) {
      setFeedback({ message: '请输入大于或等于 0 的整数天数。', error: true });
      return;
    }
    void run({ kind: 'cycle', days: value });
  };

  return (
    <div className="wiki-review-controls" aria-busy={pending}>
      <div className="action-group">
        <button
          type="button"
          className="secondary-button"
          aria-disabled={pending}
          onClick={() => void run({ kind: 'confirm' })}
        >
          确认仍有效
        </button>
        {options && (
          <>
            <button
              type="button"
              className="text-button"
              aria-disabled={pending}
              onClick={() => void run({ kind: 'snooze' })}
            >
              暂缓 30 天
            </button>
            <button
              type="button"
              className="text-button"
              ref={cycleTrigger}
              aria-disabled={pending}
              aria-expanded={editing}
              onClick={() => {
                if (pending) return;
                setDays(String(cycleDays ?? 0));
                setEditing(!editing);
              }}
            >
              调整周期
            </button>
          </>
        )}
      </div>
      {editing && (
        <form className="wiki-review-cycle" onSubmit={saveCycle}>
          <label htmlFor={daysId}>复核周期（天，0 为常青）</label>
          <div className="action-group">
            <input
              id={daysId}
              type="number"
              min={0}
              step={1}
              required
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            <button type="submit" className="secondary-button" aria-disabled={pending}>
              保存周期
            </button>
          </div>
        </form>
      )}
      {feedback && (
        <p className="wiki-review-feedback" role={feedback.error ? 'alert' : 'status'}>
          {feedback.message}
        </p>
      )}
    </div>
  );
}

const tabs = [
  { key: 'pending', label: '待复核', empty: '当前没有待复核页面。' },
  { key: 'due_soon', label: '30天内到期', empty: '当前没有 30 天内到期的页面待处理。' },
  { key: 'unverified', label: '历史未核验', empty: '当前没有历史未核验页面待处理。' },
  { key: 'index', label: '索引与系统状态', empty: '' },
] as const;

const indexLabels = {
  legacy_scan: 'Markdown 扫描',
  sqlite_fts: 'SQLite 全文检索',
  hybrid: '混合检索',
  disabled: '未启用',
  stale: '需要重建',
  unavailable: '不可用',
  ready: '可用',
  error: '补算失败',
  building: '正在补算',
  empty: '暂无可用向量',
};

export function WikiReviewDrawer({
  onClose,
  onOpenWiki,
  onReviewed,
}: {
  onClose: () => void;
  onOpenWiki: (id: string) => void;
  onReviewed: (wiki: Wiki) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const request = useRef(0);
  const activeTab = useRef(0);
  const [tab, setTab] = useState(0);
  const [state, setState] = useState<{ tab: number; result?: WikiReviewQueue | WikiReviewIndex; error?: string }>();
  const [notice, setNotice] = useState('');
  const current = tabs[tab]!;
  const load = async (index: number) => {
    const key = tabs[index]!.key;
    const token = ++request.current;
    try {
      const result = await (key === 'index' ? getWikiReviewIndex() : getWikiReviewQueue(key));
      if (dialog.current?.open && token === request.current) setState({ tab: index, result });
    } catch (error) {
      if (dialog.current?.open && token === request.current)
        setState({ tab: index, error: error instanceof Error ? error.message : '无法读取复核工作台。' });
    }
  };
  useEffect(() => {
    const node = dialog.current!;
    trigger.current = node.ownerDocument.activeElement as HTMLElement | null;
    node.showModal();
    const initial = window.setTimeout(() => void load(0), 0);
    return () => {
      window.clearTimeout(initial);
      node.close();
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
    onClose();
  };
  const selectTab = (index: number) => {
    if (index === tab) return;
    activeTab.current = index;
    setTab(index);
    setNotice('');
    setState(undefined);
    void load(index);
  };
  useEffect(() => {
    const node = dialog.current;
    if (node?.open && !node.contains(node.ownerDocument.activeElement)) panel.current?.focus();
  }, [state]);
  const result = state?.tab === tab ? state.result : undefined;
  const error = state?.tab === tab ? state.error : undefined;
  return (
    <dialog
      ref={dialog}
      className="panel wiki-review-drawer"
      role="dialog"
      aria-labelledby="wiki-review-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) close();
      }}
    >
      <div className="panel-heading">
        <h2 id="wiki-review-heading">Wiki 复核工作台</h2>
        <button type="button" className="secondary-button" onClick={close}>
          关闭
        </button>
      </div>
      <div
        role="tablist"
        aria-label="复核工作台视图"
        className="wiki-view-tabs"
        onKeyDown={(event) => {
          const keys: Record<string, number> = {
            ArrowLeft: (tab + tabs.length - 1) % tabs.length,
            ArrowRight: (tab + 1) % tabs.length,
            Home: 0,
            End: tabs.length - 1,
          };
          const index = keys[event.key];
          if (index === undefined) return;
          event.preventDefault();
          selectTab(index);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
        }}
      >
        {tabs.map(({ key, label }, index) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`wiki-review-tab-${key}`}
            aria-controls="wiki-review-panel"
            aria-selected={tab === index}
            tabIndex={tab === index ? 0 : -1}
            onClick={() => selectTab(index)}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        ref={panel}
        id="wiki-review-panel"
        role="tabpanel"
        aria-labelledby={`wiki-review-tab-${current.key}`}
        tabIndex={0}
      >
        {notice && <p role="status">{notice}</p>}
        {error ? (
          <p role="alert">
            {error}{' '}
            <button type="button" className="text-button" onClick={() => void load(tab)}>
              重试
            </button>
          </p>
        ) : !result ? (
          <p role="status">正在读取…</p>
        ) : 'items' in result ? (
          result.items.length ? (
            <ol className="wiki-review-list">
              {result.items.map((item) => (
                <li key={item.pageId}>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      close();
                      onOpenWiki(item.pageId);
                    }}
                  >
                    {item.title}
                  </button>
                  <WikiReviewReasons freshness={item} />
                  <WikiReviewActions
                    id={item.pageId}
                    revision={item.revision}
                    cycleDays={item.cycleDays}
                    options
                    onUpdated={(page, message) => {
                      onReviewed(page);
                      if (dialog.current?.open && activeTab.current === tab) {
                        setNotice(`${item.title} · ${message}`);
                        void load(tab);
                      }
                    }}
                    onOutdated={async () => {
                      if (dialog.current?.open && activeTab.current === tab) await load(tab);
                    }}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p>{current.empty}</p>
          )
        ) : (
          <dl className="wiki-review-index">
            <div>
              <dt>配置的检索模式</dt>
              <dd>{indexLabels[result.engine]}</dd>
            </div>
            <div>
              <dt>SQLite 全文索引</dt>
              <dd>{indexLabels[result.sqlite]}</dd>
            </div>
            {result.vectorState && (
              <div>
                <dt>向量索引</dt>
                <dd>{indexLabels[result.vectorState]}</dd>
              </div>
            )}
            {result.engine !== 'legacy_scan' && result.sqlite !== 'ready' && (
              <div>
                <dt>当前回退</dt>
                <dd>Markdown 扫描</dd>
              </div>
            )}
            {result.vectorState && ['disabled', 'empty'].includes(result.vectorState) && result.sqlite === 'ready' && (
              <div>
                <dt>可用检索</dt>
                <dd>SQLite 全文检索</dd>
              </div>
            )}
          </dl>
        )}
        {current.key === 'index' && <WikiModelStatus />}
      </section>
    </dialog>
  );
}
