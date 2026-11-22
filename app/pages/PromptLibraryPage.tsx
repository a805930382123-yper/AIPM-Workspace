import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { Prompt, PromptCategory, PromptInput, PromptSchema, PromptVersion, PromptWikiLink, Wiki } from '../api';
import {
  ApiError,
  api,
  createPrompt,
  dateText,
  deletePrompt,
  promptChangeSourceLabels,
  promptDetail,
  promptExportUrl,
  promptList,
  promptSchema,
  promptSourceLabels,
  promptVersion,
  promptVersions,
  renderPrompt,
  updatePrompt,
} from '../api';
import { PROMPT_LIMITS } from '../../services/prompt/limits.ts';
import { extractVariables } from '../../services/prompt/variables.ts';
import '../prompt.css';
import { PromptAiWorkbench } from './PromptAiWorkbench.tsx';
import { PromptFeedback } from '../components/PromptFeedback';
import { useDialogFocus } from '../components/useDialogFocus';

const csv = (value: string) => [
  ...new Set(
    value
      .split(/[，,、;；]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const emptyInput = (category: string): PromptInput => ({
  name: '',
  category,
  scenario: '',
  body: '',
  inputRequirements: '',
  outputRequirements: '',
  relatedWikiIds: [],
  examples: '',
  tags: [],
  favorite: false,
});
const inputOf = (prompt: Prompt): PromptInput => ({
  name: prompt.name,
  category: prompt.category,
  scenario: prompt.scenario,
  body: prompt.body,
  inputRequirements: prompt.inputRequirements,
  outputRequirements: prompt.outputRequirements,
  relatedWikiIds: prompt.relatedWikiIds,
  examples: prompt.examples,
  tags: prompt.tags,
  favorite: prompt.favorite,
});
function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === 'function') return random.call(globalThis.crypto);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

type CopyState = { status: 'idle' | 'done' | 'failed'; text: string; message: string };
/**
 * B07 repair (F07-02): a rendered body belongs to one template version *and* one exact set of values.
 * Keeping both in the preview lets copy verify that the result on screen is still the result of the
 * current input, instead of handing the user an earlier answer after they changed a variable.
 */
type Preview = { body: string; version: number; promptId: string; signature: string };
/** Unambiguous signature of "these variables have these values" (JSON, so no separator can collide). */
const signatureOf = (names: string[], values: Record<string, string>) =>
  JSON.stringify(names.map((name) => [name, values[name] ?? '']));

export function PromptLibraryPage({
  onChanged,
  onOpenWiki,
}: {
  onChanged: () => void;
  onOpenWiki: (id: string) => void;
}) {
  const [workbench, setWorkbench] = useState<'library' | 'generator' | 'optimizer'>('library');
  const [taskSeed, setTaskSeed] = useState('');
  const [schema, setSchema] = useState<PromptSchema | null>(null);
  const [wikis, setWikis] = useState<Wiki[]>([]);
  const [items, setItems] = useState<Prompt[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ prompt: Prompt; wikiLinks: PromptWikiLink[] } | null>(null);
  const [form, setForm] = useState<PromptInput | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [viewVersion, setViewVersion] = useState<PromptVersion | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  const [copy, setCopy] = useState<CopyState>({ status: 'idle', text: '', message: '' });
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const selectionVersion = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const formActiveRef = useRef(!!form);
  formActiveRef.current = !!form;
  const listRequest = useRef(0);
  const historyRequest = useRef(0);
  const renderRequest = useRef(0);
  const busyToken = useRef(0);
  const requestId = useRef<string | null>(null);
  /**
   * B07 repair (F07-05 residual): every create request in flight, keyed by the id it claimed.
   * Several "new prompt" forms can overlap, so a finished request may only release the id it owns —
   * with a single shared slot, 丁's `finally` deleted 戊's claim and the next form reused 戊's
   * requestId, which the server answered with a real 409 `REQUEST_ID_CONFLICT`.
   */
  const inflightRequestIds = useRef(new Set<string>());
  const initialSelectionDone = useRef(false);
  const copyRef = useRef<HTMLTextAreaElement>(null);
  const conditionsRef = useRef({ q: '', category: '', tag: '', favorite: false });
  // Mirrors the four filters so a refresh triggered by a save/favourite/delete always queries the
  // newest conditions rather than the ones captured when the request was created.
  conditionsRef.current = { q: query, category, tag, favorite: favoriteOnly };

  useEffect(() => {
    const create = () => {
      setWorkbench('library');
      window.setTimeout(() => startCreate(), 0);
    };
    const generate = (event: Event) => {
      const task = (event as CustomEvent<{ task?: string }>).detail?.task ?? '';
      setTaskSeed(task);
      setWorkbench('generator');
    };
    window.addEventListener('prompt:new', create);
    window.addEventListener('prompt:generator', generate);
    return () => {
      window.removeEventListener('prompt:new', create);
      window.removeEventListener('prompt:generator', generate);
    };
  }, [schema]);

  /**
   * B07 repair (F07-04): the shared loading flag is owned by a token. A late response from an
   * abandoned operation can neither re-lock the UI nor unlock the operation that replaced it.
   */
  const beginBusy = useCallback(() => {
    busyToken.current += 1;
    setBusy(true);
    return busyToken.current;
  }, []);
  const endBusy = useCallback((token: number) => {
    if (busyToken.current === token) setBusy(false);
  }, []);
  /** Leaving a selection abandons whatever that selection was doing, so the next one starts clean. */
  const releaseBusy = useCallback(() => {
    busyToken.current += 1;
    setBusy(false);
  }, []);

  /**
   * Every selection change drops the previous record's variables, preview, form and messages.
   *
   * B07 repair (F07-07): dropping that state has to re-trigger the read that repopulates it. For a
   * *changed* id the effect below runs on `selectedId` alone, but re-selecting the record that is
   * already selected leaves `selectedId` untouched — React bails out, the effect never runs again,
   * and since this call had just emptied `versions` and deprecated the generation of any read still
   * in flight, the history stayed at "正在读取版本…" forever. Bumping `reloadToken` — the same
   * idiom the save/favourite/delete paths already use to re-read a record they did not reselect —
   * makes the clearing and the re-read happen together for the same id as well.
   */
  const selectId = useCallback(
    (id: string | null) => {
      selectionVersion.current += 1;
      historyRequest.current += 1;
      renderRequest.current += 1;
      releaseBusy();
      setSelectedId(id);
      setForm(null);
      setBaseVersion(null);
      setViewVersion(null);
      setVersions([]);
      setValues({});
      setPreview(null);
      setPreviewMissing([]);
      setCopy({ status: 'idle', text: '', message: '' });
      setError('');
      setNotice('');
      requestId.current = null;
      setReloadToken((current) => current + 1);
    },
    [releaseBusy],
  );

  /**
   * B07 repair (F07-06): a list response is written only while it is still the newest query. The
   * previous code wrote `items` unconditionally, so a delayed response for an older filter could
   * replace the list the user is actually looking at.
   */
  const refreshList = useCallback(async (): Promise<Prompt[] | null> => {
    listRequest.current += 1;
    const token = listRequest.current;
    const data = await promptList(conditionsRef.current);
    if (listRequest.current !== token) return null;
    setItems(data.items);
    setCategoryCounts(data.categoryCounts);
    return data.items;
  }, []);
  const refreshCommittedPrompt = useCallback(
    (promptId?: string) => {
      void refreshList();
      onChanged();
      // A committed version can change the selected detail and its history. Re-read only when the
      // latest Library selection still owns that Prompt and the user is not editing another form.
      if (promptId && selectedIdRef.current === promptId && !formActiveRef.current) {
        setReloadToken((current) => current + 1);
      }
    },
    [onChanged, refreshList],
  );

  useEffect(() => {
    let active = true;
    promptSchema()
      .then((next) => {
        if (active) setSchema(next);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '无法读取 Prompt 分类规则。');
      });
    // A failing Wiki read must not take the Library down: the relation column degrades to ids.
    api<{ items: Wiki[] }>('/api/wiki')
      .then((next) => {
        if (active) setWikis(next.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await refreshList();
        // `null` means a newer query already owns the list; touching the selection would be wrong.
        // `[]` is a real (empty) result and must be handled normally.
        if (!active || next === null) return;
        setSelectedId((current) => (current && next.some((item) => item.id === current) ? current : null));
        // Auto-select the first record only when the user has not interacted yet (creating a new
        // prompt or picking a record bumps the selection version).
        if (!initialSelectionDone.current && next.length && selectionVersion.current === 0) {
          initialSelectionDone.current = true;
          selectId(next[0].id);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '无法读取 Prompt 列表。');
      } finally {
        if (active) setLoading(false);
      }
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, category, tag, favoriteOnly, refreshList, selectId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    const version = selectionVersion.current;
    promptDetail(selectedId)
      .then((value) => {
        if (active && version === selectionVersion.current) setDetail(value);
      })
      .catch((e) => {
        if (active && version === selectionVersion.current)
          setError(e instanceof Error ? e.message : '无法读取 Prompt 详情。');
      });
    promptVersions(selectedId)
      .then((next) => {
        if (active && version === selectionVersion.current) setVersions(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedId, reloadToken]);

  const prompt = detail?.prompt ?? null;
  const categories = schema?.categories ?? [];
  const categoryLabel = (id: string) => categories.find((item) => item.id === id)?.label ?? id;
  const variables = useMemo(() => extractVariables(prompt?.body ?? ''), [prompt?.body]);
  const missingLive = variables.filter((name) => !(values[name] ?? '').trim());
  // The rendered body counts only while it still matches the displayed version and the exact values.
  const previewCurrent =
    !!preview &&
    !!prompt &&
    preview.promptId === prompt.id &&
    preview.version === prompt.version &&
    preview.signature === signatureOf(variables, values);
  const finalBody = prompt
    ? variables.length === 0
      ? prompt.body
      : previewCurrent
        ? preview.body
        : undefined
    : undefined;
  const activeCategory = categories.find((item) => item.id === (viewVersion?.snapshot.category ?? prompt?.category));
  const shownPrompt = viewVersion?.snapshot ?? prompt;

  const startCreate = () => {
    selectionVersion.current += 1;
    historyRequest.current += 1;
    renderRequest.current += 1;
    releaseBusy();
    setSelectedId(null);
    setDetail(null);
    setVersions([]);
    setViewVersion(null);
    setValues({});
    setPreview(null);
    setPreviewMissing([]);
    setCopy({ status: 'idle', text: '', message: '' });
    setError('');
    setNotice('');
    setBaseVersion(null);
    setForm(emptyInput(categories[0]?.id ?? 'office'));
    // A retry of the *same* new-prompt session keeps its requestId; an id already claimed by an
    // in-flight create belongs to a different form and must never be reused for this one.
    if (requestId.current && inflightRequestIds.current.has(requestId.current)) requestId.current = null;
    requestId.current = requestId.current ?? newRequestId();
  };

  const startEdit = (target: Prompt) => {
    if (viewVersion) return;
    // Entering the editor is a view switch as well: a render still in flight loses its context.
    renderRequest.current += 1;
    setError('');
    setNotice('');
    setValues({});
    setPreview(null);
    setPreviewMissing([]);
    setCopy({ status: 'idle', text: '', message: '' });
    setBaseVersion(target.version);
    setForm(inputOf(target));
  };

  const cancelEdit = () => {
    setForm(null);
    setBaseVersion(null);
    setError('');
    requestId.current = null;
  };
  const setField = <K extends keyof PromptInput>(key: K, value: PromptInput[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  /**
   * B07 repair (F07-05): the submitted id, baseVersion and payload are frozen at submit time, and the
   * response may only touch the form/selection that is still the active one. A delayed success can
   * still refresh the list (the record really was saved) but must never clear a form the user has
   * opened since — that is how typing into a fresh "new prompt" used to disappear.
   */
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setError('');
    setNotice('');
    if (!form.name.trim()) {
      setError('请填写 Prompt 名称。');
      return;
    }
    if (!form.body.trim()) {
      setError('请填写 Prompt 正文后再保存。');
      return;
    }
    if (form.body.length > PROMPT_LIMITS.body) {
      setError(`正文超过 ${PROMPT_LIMITS.body.toLocaleString('en-US')} 字符上限。`);
      return;
    }
    const formAtSave = form;
    const baseAtSave = baseVersion;
    const targetId = selectedId;
    const creating = baseAtSave === null;
    const selectionAtSave = selectionVersion.current;
    const requestIdAtSave = creating ? (requestId.current ?? newRequestId()) : null;
    // Claim the retry id now and release it only after a real success, so a failed create keeps the
    // frozen idempotency contract (`requestId` stays stable across retries of the same session).
    if (requestIdAtSave) {
      requestId.current = requestIdAtSave;
      inflightRequestIds.current.add(requestIdAtSave);
    }
    const token = beginBusy();
    try {
      if (creating) {
        const created = await createPrompt(requestIdAtSave as string, formAtSave);
        await refreshList();
        onChanged();
        if (selectionVersion.current !== selectionAtSave) return;
        requestId.current = null;
        setForm(null);
        setNotice(
          created.reused ? '这次新建请求之前已经保存过，已返回现有 Prompt（没有新增版本）。' : 'Prompt 已保存。',
        );
        selectId(created.prompt.id);
      } else {
        const saved = await updatePrompt(targetId as string, baseAtSave, formAtSave);
        await refreshList();
        onChanged();
        if (selectionVersion.current !== selectionAtSave) return;
        setForm(null);
        setBaseVersion(null);
        setNotice(saved.version === baseAtSave ? '内容没有变化，未产生新版本。' : `已保存为第 ${saved.version} 版。`);
        setSelectedId(saved.id);
        setReloadToken((current) => current + 1);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setReloadToken((current) => current + 1);
      // The user has moved on: reporting this outcome on the new form would cross two contexts.
      if (selectionVersion.current !== selectionAtSave) return;
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      // Only the id this request claimed is released; a newer overlapping form keeps its own claim.
      if (requestIdAtSave) inflightRequestIds.current.delete(requestIdAtSave);
      endBusy(token);
    }
  };

  const toggleFavorite = async (target: Prompt) => {
    setError('');
    setNotice('');
    const selectionAtSave = selectionVersion.current;
    const token = beginBusy();
    try {
      const saved = await updatePrompt(target.id, target.version, { ...inputOf(target), favorite: !target.favorite });
      await refreshList();
      onChanged();
      if (selectionVersion.current !== selectionAtSave) return;
      setSelectedId(saved.id);
      setReloadToken((current) => current + 1);
      setNotice(saved.favorite ? '已加入收藏。' : '已取消收藏。');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setReloadToken((current) => current + 1);
      if (selectionVersion.current !== selectionAtSave) return;
      setError(e instanceof Error ? e.message : '更新收藏失败。');
    } finally {
      endBusy(token);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    const target = deleteTarget;
    const selectionAtSave = selectionVersion.current;
    const token = beginBusy();
    try {
      await deletePrompt(target.id, target.version);
      await refreshList();
      onChanged();
      // The record is gone either way, so the confirmation dialog always closes on success.
      setDeleteTarget(null);
      if (selectionVersion.current !== selectionAtSave) return;
      selectId(null);
      setNotice('Prompt 已删除（移动到 prompts/recycle，不再出现在列表、搜索和统计中）。');
    } catch (e) {
      if (selectionVersion.current !== selectionAtSave) return;
      setError(e instanceof Error ? e.message : '删除失败。');
    } finally {
      endBusy(token);
    }
  };

  const doRender = async () => {
    if (!prompt || !detail) return;
    const targetId = prompt.id;
    const targetVersion = prompt.version;
    const valuesAtRequest = { ...values };
    const signatureAtRequest = signatureOf(variables, valuesAtRequest);
    const selectionAtRender = selectionVersion.current;
    renderRequest.current += 1;
    const renderToken = renderRequest.current;
    setError('');
    setNotice('');
    setPreview(null);
    setPreviewMissing([]);
    setCopy({ status: 'idle', text: '', message: '' });
    const token = beginBusy();
    try {
      const result = await renderPrompt(targetId, targetVersion, valuesAtRequest);
      // The result belongs to the values that were sent, so it is only stored when both the
      // selection and this render are still the current ones. If the user changed a value while the
      // request was in flight, the stored signature no longer matches and nothing becomes copyable.
      if (selectionVersion.current !== selectionAtRender || renderRequest.current !== renderToken) return;
      setPreview({ body: result.body, version: result.version, promptId: targetId, signature: signatureAtRequest });
    } catch (e) {
      if (selectionVersion.current !== selectionAtRender || renderRequest.current !== renderToken) return;
      const missing =
        e instanceof ApiError
          ? (e.details as { missingVariables?: string[] } | undefined)?.missingVariables
          : undefined;
      setPreviewMissing(
        Array.isArray(missing) ? missing : variables.filter((name) => !(valuesAtRequest[name] ?? '').trim()),
      );
      setError(e instanceof Error ? e.message : '生成最终正文失败。');
    } finally {
      endBusy(token);
    }
  };

  /**
   * B07 repair (F07-02): changing any variable invalidates the previous result. The old body was the
   * answer to the old input, so it is dropped immediately instead of staying copyable.
   */
  const updateValues = (next: Record<string, string>) => {
    renderRequest.current += 1;
    setValues(next);
    setPreview(null);
    setPreviewMissing([]);
    setCopy({ status: 'idle', text: '', message: '' });
    setError('');
  };

  const copyFinal = async () => {
    if (!prompt) return;
    setError('');
    setNotice('');
    if (finalBody === undefined) {
      setError('变量已经改变，请重新点击「生成最终正文」，确认没有未填写的变量后再复制。');
      return;
    }
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setCopy({
        status: 'failed',
        text: finalBody,
        message: '当前浏览器不允许脚本写入剪贴板，复制没有执行。请在下框中手动全选并复制。',
      });
      return;
    }
    try {
      await clipboard.writeText(finalBody);
      setCopy({ status: 'done', text: finalBody, message: '已复制本次最终正文到剪贴板（模板与版本未改变）。' });
    } catch (e) {
      setCopy({
        status: 'failed',
        text: finalBody,
        message: `复制失败：${e instanceof Error ? e.message : '浏览器拒绝了剪贴板写入'}。请在下框中手动全选并复制。`,
      });
    }
  };

  /**
   * B07 repair (F07-03): a version read is tagged with the record it belongs to and with the view
   * generation. Switching record, opening another version, going back to the current version or
   * starting a new prompt all invalidate the pending read, so its success *and* its failure are
   * dropped instead of being shown against whatever is on screen now.
   *
   * B07 repair (F07-04 residual): opening a version also leaves the *generate* context. Bumping
   * `renderRequest` here — not just `historyRequest` — is what drops a render that is still in
   * flight, because a same-template view switch never changes `selectionVersion`. Without it, a
   * delayed 422 raised its "还缺变量" error banner over the read-only history page and the missing
   * state survived going back to the current version.
   */
  const openVersion = async (version: number) => {
    if (!selectedId) return;
    const id = selectedId;
    const selectionAtOpen = selectionVersion.current;
    historyRequest.current += 1;
    renderRequest.current += 1;
    const token = historyRequest.current;
    releaseBusy();
    setError('');
    setNotice('');
    setValues({});
    setPreview(null);
    setPreviewMissing([]);
    setCopy({ status: 'idle', text: '', message: '' });
    setForm(null);
    setBaseVersion(null);
    const stale = () => historyRequest.current !== token || selectionVersion.current !== selectionAtOpen;
    try {
      const loaded = (await promptVersion(id, version)).version;
      if (stale()) return;
      setViewVersion(loaded);
    } catch (e) {
      if (stale()) return;
      setError(e instanceof Error ? e.message : '无法读取这一版。');
    }
  };

  /** Returning to the current version is another view switch, so it owns a fresh generate context too. */
  const backToCurrent = () => {
    historyRequest.current += 1;
    renderRequest.current += 1;
    setViewVersion(null);
  };

  useEffect(() => {
    if (copy.status === 'failed' && copyRef.current) copyRef.current.select();
  }, [copy]);

  const linkById = new Map((detail?.wikiLinks ?? []).map((link) => [link.id, link]));
  const wikiTitle = (id: string) => linkById.get(id)?.title ?? wikis.find((item) => item.id === id)?.title ?? null;

  return (
    <div className="page prompt-page">
      <div className="page-heading">
        <div>
          <h1>Prompt 工作台</h1>
          <p className="subheading">
            把常用的业务提问方式整理成可复用的模板：填写变量、复制最终正文，模板本身保持不变。
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="primary-button"
            onClick={() => {
              setWorkbench('library');
              startCreate();
            }}
            disabled={!schema}
          >
            <span>＋</span> 手动新建
          </button>
        </div>
      </div>
      <nav className="prompt-tabs" aria-label="Prompt 工作台功能">
        {(
          [
            ['library', '模板库'],
            ['generator', '生成'],
            ['optimizer', '优化'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`prompt-tab ${workbench === id ? 'active' : ''}`}
            aria-current={workbench === id ? 'page' : undefined}
            onClick={() => setWorkbench(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {workbench !== 'library' ? (
        <PromptAiWorkbench
          key={`${workbench}-${taskSeed}`}
          mode={workbench}
          initialTask={taskSeed}
          onLibrary={(promptId) => {
            setWorkbench('library');
            if (promptId) {
              setQuery('');
              setCategory('');
              setTag('');
              setFavoriteOnly(false);
              conditionsRef.current = { q: '', category: '', tag: '', favorite: false };
              selectId(promptId);
              void refreshList();
            }
          }}
          onSaved={refreshCommittedPrompt}
          categories={categories}
        />
      ) : (
        <>
          {error && (
            <div className="prompt-message error-message" role="alert">
              {error}
              <button onClick={() => setError('')}>关闭</button>
            </div>
          )}
          {notice && (
            <div className="prompt-message success-message" role="status">
              {notice}
              <button onClick={() => setNotice('')}>关闭</button>
            </div>
          )}
          <div className="prompt-workspace">
            <section className="panel prompt-list-panel">
              <div className="prompt-search">
                <label className="search-box">
                  <span>⌕</span>
                  <input
                    aria-label="搜索 Prompt"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索名称、标签或正文"
                  />
                  {query && (
                    <button aria-label="清空搜索" onClick={() => setQuery('')}>
                      ×
                    </button>
                  )}
                </label>
                <label className="field prompt-tag-filter">
                  标签
                  <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="按标签筛选" />
                </label>
                <label className="prompt-favorite-filter">
                  <input
                    type="checkbox"
                    checked={favoriteOnly}
                    onChange={(event) => setFavoriteOnly(event.target.checked)}
                  />
                  只看收藏
                </label>
                <span className="prompt-count">{items.length} 条</span>
              </div>
              <div className="prompt-map">
                <div className="map-title">
                  <div>
                    <h2>分类</h2>
                    <span>六个默认分类，点击筛选</span>
                  </div>
                  <span className="map-total">
                    {Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)} 条
                  </span>
                </div>
                <div className="category-grid">
                  <button
                    className={`category-chip ${category === '' ? 'chosen' : ''}`}
                    onClick={() => setCategory('')}
                  >
                    全部<span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
                  </button>
                  {categories.map((item) => (
                    <button
                      className={`category-chip ${category === item.id ? 'chosen' : ''}`}
                      key={item.id}
                      title={item.help}
                      onClick={() => setCategory(category === item.id ? '' : item.id)}
                    >
                      {item.label}
                      <span>{categoryCounts[item.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
                {category && <p className="category-help">{categories.find((item) => item.id === category)?.help}</p>}
              </div>
              <div className="prompt-list-content">
                {loading ? (
                  <div className="list-empty">正在读取 Prompt Library…</div>
                ) : items.length ? (
                  items.map((item) => (
                    <button
                      key={item.id}
                      className={`prompt-list-item ${selectedId === item.id ? 'selected' : ''}`}
                      onClick={() => selectId(item.id)}
                    >
                      <span className="prompt-list-mark">{item.favorite ? '★' : '✳'}</span>
                      <span className="prompt-list-copy">
                        <b>
                          {item.name}
                          {item.isDemo && <span className="demo-badge">演示数据</span>}
                        </b>
                        <small>
                          {categoryLabel(item.category)} · 第 {item.version} 版
                        </small>
                        <small>
                          {item.tags.length ? `标签：${item.tags.join('、')}` : promptSourceLabels[item.source]}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="list-empty">
                    <span className="empty-symbol">✳</span>
                    <b>{query || tag || category || favoriteOnly ? '没有匹配的 Prompt' : 'Library 还是空的'}</b>
                    <span>
                      {query || tag || category || favoriteOnly
                        ? '换个关键词，或清空筛选条件。'
                        : '创建第一条模板，把常用提问方式固定下来。'}
                    </span>
                    <button className="secondary-button" onClick={startCreate}>
                      新建 Prompt
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="panel prompt-detail-panel">
              {form ? (
                <PromptEditor
                  form={form}
                  schema={schema}
                  wikis={wikis}
                  busy={busy}
                  baseVersion={baseVersion}
                  onField={setField}
                  onCancel={cancelEdit}
                  onSave={save}
                />
              ) : viewVersion ? (
                <VersionDetail
                  version={viewVersion}
                  categoryLabel={categoryLabel(viewVersion.snapshot.category)}
                  wikiTitle={wikiTitle}
                  linkById={linkById}
                  onBack={backToCurrent}
                  onOpenWiki={onOpenWiki}
                />
              ) : shownPrompt ? (
                <PromptDetail
                  prompt={shownPrompt}
                  activeCategory={activeCategory}
                  links={detail?.wikiLinks ?? []}
                  wikiTitle={wikiTitle}
                  versions={versions}
                  busy={busy}
                  variables={variables}
                  values={values}
                  finalBody={finalBody}
                  missingLive={missingLive}
                  shownMissing={previewMissing}
                  copy={copy}
                  copyRef={copyRef}
                  onValues={updateValues}
                  onRender={doRender}
                  onCopy={copyFinal}
                  onFavorite={() => void toggleFavorite(shownPrompt)}
                  onEdit={() => startEdit(shownPrompt)}
                  onDelete={() => {
                    setError('');
                    setDeleteTarget(shownPrompt);
                  }}
                  onOpenVersion={openVersion}
                  onOpenWiki={onOpenWiki}
                />
              ) : (
                <div className="detail-empty">
                  <span className="empty-symbol">✳</span>
                  <b>选择或创建一条 Prompt</b>
                  <span>Library 与知识库分离：这里保存的是工作方法，不会写入 Wiki。</span>
                  <button className="secondary-button" onClick={startCreate}>
                    新建 Prompt
                  </button>
                </div>
              )}
            </section>
          </div>
          {deleteTarget && (
            <PromptDeleteDialog
              item={deleteTarget}
              busy={busy}
              onClose={() => setDeleteTarget(null)}
              onConfirm={() => void confirmDelete()}
            />
          )}
        </>
      )}
    </div>
  );
}

function PromptDeleteDialog({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: Prompt;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useDialogFocus<HTMLElement>();
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-delete-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">移到回收区</p>
            <h2 id="prompt-delete-title">删除“{item.name}”</h2>
            <p>
              删除后不再出现在列表、搜索、统计和版本接口中；使用反馈随Prompt进入回收区，备份会保留。关联的 Wiki
              与知识库不受影响。
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-footer">
          <span>
            第 {item.version} 版 · {item.variables.length} 个变量
          </span>
          <div>
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PromptEditor({
  form,
  schema,
  wikis,
  busy,
  baseVersion,
  onField,
  onCancel,
  onSave,
}: {
  form: PromptInput;
  schema: PromptSchema | null;
  wikis: Wiki[];
  busy: boolean;
  baseVersion: number | null;
  onField: <K extends keyof PromptInput>(key: K, value: PromptInput[K]) => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const detected = extractVariables(form.body);
  const missingOption = form.relatedWikiIds.filter((id) => !wikis.some((item) => item.id === id));
  return (
    <form className="prompt-editor" onSubmit={onSave}>
      <div className="editor-top">
        <div>
          <p className="eyebrow">{baseVersion === null ? '创建 Prompt' : `编辑 · 第 ${baseVersion} 版`}</p>
          <h2>{baseVersion === null ? '新建 Prompt' : form.name || '未命名'}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="取消编辑" onClick={onCancel}>
          ×
        </button>
      </div>
      <div className="prompt-form-grid">
        <label className="field span-two">
          名称 <em>*</em>
          <input
            value={form.name}
            onChange={(event) => onField('name', event.target.value)}
            required
            maxLength={PROMPT_LIMITS.name}
            placeholder="例如：经销商访谈提纲"
            autoFocus
          />
        </label>
        <label className="field">
          分类
          <select value={form.category} onChange={(event) => onField('category', event.target.value)}>
            {schema?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          收藏
          <select
            value={form.favorite ? 'yes' : 'no'}
            onChange={(event) => onField('favorite', event.target.value === 'yes')}
          >
            <option value="no">不收藏</option>
            <option value="yes">加入收藏</option>
          </select>
        </label>
        <label className="field span-two">
          场景
          <textarea
            value={form.scenario}
            onChange={(event) => onField('scenario', event.target.value)}
            maxLength={PROMPT_LIMITS.scenario}
            placeholder="什么时候用这条 Prompt，例如：走访经销商前准备访谈问题"
          />
        </label>
        <label className="field span-two prompt-body-field">
          正文 <em>*</em>
          <textarea
            value={form.body}
            onChange={(event) => onField('body', event.target.value)}
            required
            spellCheck
            placeholder={
              '用 {{变量名}} 标出每次需要替换的部分，例如：\n请把下面的行业术语解释给刚入职的同事：{{行业术语}}'
            }
          />
          <span className="field-hint">
            正文原样保存（含前后空白与换行）；识别到的变量：
            {detected.length ? detected.map((name) => `{{${name}}}`).join('　') : '暂无'}。上限{' '}
            {PROMPT_LIMITS.body.toLocaleString('en-US')} 字符。
          </span>
        </label>
        <label className="field">
          输入要求
          <textarea
            value={form.inputRequirements}
            onChange={(event) => onField('inputRequirements', event.target.value)}
            maxLength={PROMPT_LIMITS.inputRequirements}
            placeholder="需要用户提供什么"
          />
        </label>
        <label className="field">
          输出要求
          <textarea
            value={form.outputRequirements}
            onChange={(event) => onField('outputRequirements', event.target.value)}
            maxLength={PROMPT_LIMITS.outputRequirements}
            placeholder="希望得到什么结果、格式与边界"
          />
        </label>
        <label className="field span-two">
          相关 Wiki
          <select
            className="raw-source-select"
            multiple
            size={Math.min(Math.max(wikis.length, 3), 6)}
            value={form.relatedWikiIds}
            onChange={(event) =>
              onField(
                'relatedWikiIds',
                [...event.currentTarget.selectedOptions].map((option) => option.value),
              )
            }
          >
            {missingOption.map((id) => (
              <option key={id} value={id}>
                （关联已失效，可取消选择）{id}
              </option>
            ))}
            {wikis.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}｜{item.type}
              </option>
            ))}
          </select>
          <span className="field-hint">
            按住 Ctrl 可多选；只允许选择当前存在的 Wiki。关联不会把 Wiki 正文写入 Prompt。
          </span>
        </label>
        <label className="field span-two">
          示例
          <textarea
            value={form.examples}
            onChange={(event) => onField('examples', event.target.value)}
            maxLength={PROMPT_LIMITS.examples}
            placeholder="填写好的示例，方便以后照着改"
          />
        </label>
        <label className="field span-two">
          标签
          <input
            value={form.tags.join('，')}
            onChange={(event) => onField('tags', csv(event.target.value))}
            placeholder="用逗号分隔，例如：访谈，经销商"
          />
        </label>
      </div>
      <div className="editor-footer">
        <span>保存后形成正式 Prompt 记录与一个新版本</span>
        <div>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在保存…' : '保存 Prompt'}
          </button>
        </div>
      </div>
    </form>
  );
}

function VersionDetail({
  version,
  categoryLabel,
  wikiTitle,
  linkById,
  onBack,
  onOpenWiki,
}: {
  version: PromptVersion;
  categoryLabel: string;
  wikiTitle: (id: string) => string | null;
  linkById: Map<string, PromptWikiLink>;
  onBack: () => void;
  onOpenWiki: (id: string) => void;
}) {
  const snapshot = version.snapshot;
  return (
    <article className="prompt-detail prompt-history">
      <div className="history-banner" role="status">
        <div>
          <b>正在查看第 {version.version} 版（历史快照，只读）</b>
          <span>
            保存于 {dateText(version.savedAt)} · {promptChangeSourceLabels[version.changeSource]}
            。历史版本不能填写变量或复制，也不会被本次查看修改。
          </span>
        </div>
        <button className="secondary-button" onClick={onBack}>
          返回当前版本
        </button>
      </div>
      <h2>{snapshot.name}</h2>
      <div className="prompt-badges">
        <span className="tag">{categoryLabel}</span>
        <span className="tag">{promptSourceLabels[snapshot.source]}</span>
        {snapshot.favorite && <span className="tag">已收藏</span>}
      </div>
      <div className="prompt-meta-grid">
        <Meta label="版本" value={`第 ${snapshot.version} 版`} />
        <Meta label="修改来源" value={promptChangeSourceLabels[version.changeSource]} />
        <Meta label="保存时间" value={dateText(version.savedAt)} />
        <Meta
          label="变量"
          value={snapshot.variables.length ? snapshot.variables.map((name) => `{{${name}}}`).join('、') : '无'}
        />
      </div>
      {snapshot.scenario && (
        <section className="prompt-section">
          <h3>场景</h3>
          <p>{snapshot.scenario}</p>
        </section>
      )}
      {snapshot.inputRequirements && (
        <section className="prompt-section">
          <h3>输入要求</h3>
          <p>{snapshot.inputRequirements}</p>
        </section>
      )}
      {snapshot.outputRequirements && (
        <section className="prompt-section">
          <h3>输出要求</h3>
          <p>{snapshot.outputRequirements}</p>
        </section>
      )}
      {snapshot.tags.length > 0 && (
        <div className="tag-row">
          {snapshot.tags.map((value) => (
            <span key={value} className="tag">
              {value}
            </span>
          ))}
        </div>
      )}
      {snapshot.relatedWikiIds.length > 0 && (
        <section className="prompt-section">
          <h3>相关 Wiki</h3>
          <div className="link-status-list">
            {snapshot.relatedWikiIds.map((id) => (
              <div className="wiki-link-row" key={id}>
                <code>{id}</code>
                {linkById.get(id)?.status === 'missing' || !wikiTitle(id) ? (
                  <span className="link-missing">关联已失效（当前版本也不存在这个 Wiki）</span>
                ) : (
                  <button className="text-button" onClick={() => onOpenWiki(id)}>
                    {wikiTitle(id)} ›
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {snapshot.examples && (
        <section className="prompt-section">
          <h3>示例</h3>
          <pre className="prompt-body-view">{snapshot.examples}</pre>
        </section>
      )}
      <section className="prompt-section">
        <h3>正文（第 {snapshot.version} 版原样）</h3>
        <pre className="prompt-body-view">{snapshot.body}</pre>
      </section>
      <PromptFeedback
        key={`${snapshot.id}-${snapshot.version}`}
        promptId={snapshot.id}
        promptName={snapshot.name}
        promptVersion={snapshot.version}
      />
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="prompt-meta">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function PromptDetail({
  prompt,
  activeCategory,
  links,
  wikiTitle,
  versions,
  busy,
  variables,
  values,
  finalBody,
  missingLive,
  shownMissing,
  copy,
  copyRef,
  onValues,
  onRender,
  onCopy,
  onFavorite,
  onEdit,
  onDelete,
  onOpenVersion,
  onOpenWiki,
}: {
  prompt: Prompt;
  activeCategory?: PromptCategory;
  links: PromptWikiLink[];
  wikiTitle: (id: string) => string | null;
  versions: PromptVersion[];
  busy: boolean;
  variables: string[];
  values: Record<string, string>;
  /** The render result only when it still matches this version and these values; otherwise undefined. */
  finalBody: string | undefined;
  missingLive: string[];
  shownMissing: string[];
  copy: CopyState;
  copyRef: RefObject<HTMLTextAreaElement | null>;
  onValues: (next: Record<string, string>) => void;
  onRender: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenVersion: (version: number) => void;
  onOpenWiki: (id: string) => void;
}) {
  return (
    <article className="prompt-detail">
      <div className="prompt-detail-actions">
        <div className="prompt-badges">
          <span className="tag">{activeCategory?.label ?? prompt.category}</span>
          <span className="tag">{promptSourceLabels[prompt.source]}</span>
          {prompt.isDemo && <span className="demo-badge">演示数据</span>}
          {prompt.favorite && <span className="tag">已收藏</span>}
        </div>
        <div className="action-group">
          <a className="secondary-button" href={promptExportUrl(prompt.id)} download={`prompt-${prompt.id}.md`}>
            导出 Markdown
          </a>
          <button className="secondary-button" onClick={onFavorite} disabled={busy}>
            {prompt.favorite ? '取消收藏' : '收藏'}
          </button>
          <button className="secondary-button" onClick={onEdit} disabled={busy}>
            编辑
          </button>
          <button className="danger-quiet" onClick={onDelete} disabled={busy}>
            删除
          </button>
        </div>
      </div>
      <h2>{prompt.name}</h2>
      {prompt.isDemo && <p className="demo-notice">【演示数据】虚构教学模板，请按真实业务修改。</p>}
      <div className="prompt-meta-grid">
        <Meta label="分类" value={activeCategory?.label ?? prompt.category} />
        <Meta label="版本" value={`第 ${prompt.version} 版`} />
        <Meta label="创建时间" value={dateText(prompt.createdAt)} />
        <Meta label="最近修改" value={dateText(prompt.updatedAt)} />
      </div>
      {prompt.tags.length > 0 && (
        <div className="tag-row">
          {prompt.tags.map((value) => (
            <span key={value} className="tag">
              {value}
            </span>
          ))}
        </div>
      )}
      <section className="prompt-section">
        <div className="section-header">
          <h3>正文模板</h3>
          <span>原样保存 · 不会因为填写变量而改变</span>
        </div>
        <pre className="prompt-body-view">{prompt.body}</pre>
      </section>
      <section className="prompt-section prompt-fill">
        <div className="section-header">
          <h3>填写变量并复制</h3>
          <span>{variables.length ? `${variables.length} 个变量` : '正文没有变量，可直接复制'}</span>
        </div>
        {variables.length > 0 && (
          <div className="prompt-fields">
            {variables.map((name) => (
              <label className="field" key={name}>
                <span>{name}</span>
                <input
                  value={values[name] ?? ''}
                  onChange={(event) => onValues({ ...values, [name]: event.target.value })}
                  placeholder={`填写 ${name}`}
                />
                {!(values[name] ?? '').trim() && <em className="prompt-missing">未填写</em>}
              </label>
            ))}
          </div>
        )}
        {missingLive.length > 0 && (
          <p className="prompt-missing-note" role="status">
            还缺少：{missingLive.join('、')}（只填空格也算未填写）。
          </p>
        )}
        {shownMissing.length > 0 && (
          <p className="prompt-missing-note" role="alert">
            服务端校验未通过，缺少：{shownMissing.join('、')}。未生成的模板不会被复制。
          </p>
        )}
        <div className="prompt-actions">
          {variables.length > 0 && (
            <button className="secondary-button" onClick={onRender} disabled={busy}>
              {busy ? '正在生成…' : '生成最终正文'}
            </button>
          )}
          <button className="primary-button" onClick={onCopy} disabled={busy || finalBody === undefined}>
            复制最终正文
          </button>
        </div>
        {finalBody !== undefined && (
          <>
            <div className="section-header">
              <h3>本次最终正文</h3>
              <span>
                {variables.length === 0
                  ? '无变量，复制的是模板原文'
                  : `基于第 ${prompt.version} 版的这一次结果，不会保存`}
              </span>
            </div>
            <pre className="prompt-body-view prompt-final" data-testid="prompt-final">
              {finalBody}
            </pre>
          </>
        )}
        {copy.status === 'done' && (
          <p className="prompt-copy-ok" role="status">
            {copy.message}
          </p>
        )}
        {copy.status === 'failed' && (
          <div className="prompt-copy-failed" role="alert">
            <p>{copy.message}</p>
            <textarea ref={copyRef} readOnly value={copy.text} aria-label="可手动选取的最终正文" />
          </div>
        )}
      </section>
      <details className="prompt-secondary">
        <summary>
          场景、要求与相关 Wiki{links.some((link) => link.status === 'missing') ? ' · 存在失效关联' : ''}
        </summary>
        {prompt.scenario && (
          <section className="prompt-section">
            <h3>场景</h3>
            <p>{prompt.scenario}</p>
          </section>
        )}
        {prompt.inputRequirements && (
          <section className="prompt-section">
            <h3>输入要求</h3>
            <p>{prompt.inputRequirements}</p>
          </section>
        )}
        {prompt.outputRequirements && (
          <section className="prompt-section">
            <h3>输出要求</h3>
            <p>{prompt.outputRequirements}</p>
          </section>
        )}
        <section className="prompt-section">
          <h3>相关 Wiki · {prompt.relatedWikiIds.length}</h3>
          {(links.length
            ? links
            : prompt.relatedWikiIds.map((id) => ({ id, title: wikiTitle(id), status: 'missing' as const }))
          ).length ? (
            <div className="link-status-list">
              {(links.length
                ? links
                : prompt.relatedWikiIds.map((id) => ({ id, title: wikiTitle(id), status: 'missing' as const }))
              ).map((link) => (
                <div className="wiki-link-row" key={link.id}>
                  {link.status === 'resolved' && link.title ? (
                    <>
                      <code>{link.title}</code>
                      <button className="text-button" onClick={() => onOpenWiki(link.id)}>
                        打开 Wiki ›
                      </button>
                    </>
                  ) : (
                    <>
                      <code>{link.title ?? link.id}</code>
                      <span className="link-missing">
                        关联已失效：这个 Wiki 已经不存在，Prompt 正文和其他功能不受影响
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">未关联 Wiki。</p>
          )}
        </section>
        {prompt.examples && (
          <section className="prompt-section">
            <h3>示例</h3>
            <pre className="prompt-body-view">{prompt.examples}</pre>
          </section>
        )}
      </details>
      <PromptFeedback
        key={`${prompt.id}-${prompt.version}`}
        promptId={prompt.id}
        promptName={prompt.name}
        promptVersion={prompt.version}
      />
      <details className="prompt-secondary prompt-section">
        <summary>
          <h3>版本历史 · {versions.length}</h3>
        </summary>
        <p>每次有效保存都会追加完整快照。</p>
        <div className="prompt-version-list">
          {versions.length ? (
            [...versions].reverse().map((item) => (
              <button key={item.version} className="prompt-version-row" onClick={() => onOpenVersion(item.version)}>
                <b>第 {item.version} 版</b>
                <span>{dateText(item.savedAt)}</span>
                <small>
                  {promptChangeSourceLabels[item.changeSource]} · {item.snapshot.body.length} 字符
                </small>
              </button>
            ))
          ) : (
            <span className="muted-copy">正在读取版本…</span>
          )}
        </div>
      </details>
    </article>
  );
}
