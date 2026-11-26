import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Prompt, PromptInput, PromptSchema, PromptVersion, PromptWikiLink, Wiki } from '../../api';
import {
  ApiError,
  api,
  createPrompt,
  deletePrompt,
  promptDetail,
  promptList,
  promptSchema,
  promptVersion,
  promptVersions,
  renderPrompt,
  updatePrompt,
} from '../../api';
import { PROMPT_LIMITS } from '../../../services/prompt/limits.ts';
import { extractVariables } from '../../../services/prompt/variables.ts';
import { emptyInput, inputOf, newRequestId, signatureOf, type CopyState, type Preview } from './promptState';

export function usePromptLibrary(onChanged: () => void) {
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
  const formActiveRef = useRef(!!form);
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

  // Mirrors the selection, active-form and filter state so async refreshes always read the newest
  // conditions after commit without touching refs during render.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    formActiveRef.current = !!form;
    conditionsRef.current = { q: query, category, tag, favorite: favoriteOnly };
  }, [selectedId, form, query, category, tag, favoriteOnly]);

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

  const defaultCategoryId = schema?.categories[0]?.id ?? 'office';
  const startCreate = useCallback(() => {
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
    setForm(emptyInput(defaultCategoryId));
    // A retry of the *same* new-prompt session keeps its requestId; an id already claimed by an
    // in-flight create belongs to a different form and must never be reused for this one.
    if (requestId.current && inflightRequestIds.current.has(requestId.current)) requestId.current = null;
    requestId.current = requestId.current ?? newRequestId();
  }, [defaultCategoryId, releaseBusy]);

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
  }, [startCreate]);

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
    if (!selectedId) return;
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

  const activeDetail = selectedId && detail?.prompt.id === selectedId ? detail : null;
  const prompt = activeDetail?.prompt ?? null;
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
    if (!prompt || !activeDetail) return;
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

  const linkById = new Map((activeDetail?.wikiLinks ?? []).map((link) => [link.id, link]));
  const wikiTitle = (id: string) => linkById.get(id)?.title ?? wikis.find((item) => item.id === id)?.title ?? null;

  const openLibrary = (promptId?: string) => {
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
  };

  return {
    workbench,
    setWorkbench,
    taskSeed,
    schema,
    wikis,
    items,
    categoryCounts,
    query,
    setQuery,
    category,
    setCategory,
    tag,
    setTag,
    favoriteOnly,
    setFavoriteOnly,
    selectedId,
    activeDetail,
    form,
    baseVersion,
    versions,
    viewVersion,
    values,
    previewMissing,
    copy,
    deleteTarget,
    setDeleteTarget,
    busy,
    error,
    setError,
    notice,
    setNotice,
    loading,
    copyRef,
    startCreate,
    selectId,
    refreshCommittedPrompt,
    categories,
    categoryLabel,
    variables,
    missingLive,
    finalBody,
    activeCategory,
    shownPrompt,
    startEdit,
    cancelEdit,
    setField,
    save,
    toggleFavorite,
    confirmDelete,
    doRender,
    updateValues,
    copyFinal,
    openVersion,
    backToCurrent,
    linkById,
    wikiTitle,
    openLibrary,
  };
}
