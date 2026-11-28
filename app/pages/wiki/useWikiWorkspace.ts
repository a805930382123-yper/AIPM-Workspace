import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AnswerCitation } from '../../../services/wiki/question-input';
import type {
  ExtractionJob,
  KnowledgeWorkflowSummary,
  RawProcessingState,
  RawSummary,
  Wiki,
  WikiLintResult,
  WikiSchema,
  WikiType,
} from '../../api';
import { api, drafts, knowledgeWorkflows, startExtract } from '../../api';
import { useLlmDisabled } from '../../hooks/llmAvailability';
import { templateBody, type WikiCheckEntry, type WikiForm, type WikiSubView } from './wikiShared';

function hasSectionContent(body: string) {
  return body
    .split(/\r?\n/)
    .some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()) && !/^<!--.*-->$/.test(line.trim()));
}

export function useWikiWorkspace({
  onChanged,
  initialOpenId,
  initialCheck,
  onInitialAuditHandled,
  onInitialOpenHandled,
  processing = {},
  onJobStarted,
  navigationGeneration = 0,
  onOpenDraft,
}: {
  onChanged: () => void;
  initialOpenId?: string | null;
  initialCheck?: WikiCheckEntry | null;
  onInitialAuditHandled?: () => void;
  onInitialOpenHandled?: () => void;
  processing?: Record<string, RawProcessingState>;
  onJobStarted?: (job: ExtractionJob, pageGeneration?: number) => void;
  navigationGeneration?: number;
  onOpenDraft?: (id: string) => void;
}) {
  const modelDisabled = useLlmDisabled();
  const [activeSubView, setActiveSubView] = useState<WikiSubView>(initialCheck?.view ?? 'overview');
  const [hasOpenedAsk, setHasOpenedAsk] = useState(false);
  const [hasOpenedInspection, setHasOpenedInspection] = useState(initialCheck?.view === 'active-check');
  const [initialInspectionId] = useState(initialCheck?.view === 'active-check' ? initialCheck.inspectionId : undefined);
  const initialCheckTab = useRef<HTMLButtonElement>(null);
  const [inspectionCitation, setInspectionCitation] = useState<AnswerCitation | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; edit?: boolean } | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const detailPanel = useRef<HTMLElement>(null);
  const [schema, setSchema] = useState<WikiSchema | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewChange, setReviewChange] = useState(0);
  const [raws, setRaws] = useState<RawSummary[]>([]);
  const [items, setItems] = useState<Wiki[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Wiki | null>(null);
  const [form, setForm] = useState<WikiForm | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Wiki | null>(null);
  const [deleteReferences, setDeleteReferences] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [lintResult, setLintResult] = useState<WikiLintResult | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  const [lintError, setLintError] = useState('');
  const [extractingRawId, setExtractingRawId] = useState<string | null>(null);
  const [extractError, setExtractError] = useState('');
  const [pendingDrafts, setPendingDrafts] = useState<
    Array<{ id: string; rawId: string; rawTitle: string; title: string; updatedAt: string }>
  >([]);
  const [pendingWorkflows, setPendingWorkflows] = useState<KnowledgeWorkflowSummary[]>([]);
  const pendingCreate = useRef(false);
  const selectionVersion = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const explicitOpenIdRef = useRef<string | null>(null);
  const selectId = (id: string | null) => {
    selectionVersion.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id);
  };
  const updateQuery = (value: string) => {
    explicitOpenIdRef.current = null;
    setQuery(value);
  };
  const updateCategory = (value: string) => {
    explicitOpenIdRef.current = null;
    setCategory(value);
  };

  const refreshList = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    const data = await api<{ items: Wiki[]; categoryCounts: Record<string, number> }>(`/api/wiki?${params.toString()}`);
    setItems(data.items);
    setCategoryCounts(data.categoryCounts);
    return data.items;
  }, [query, category]);

  useEffect(() => {
    Promise.all([api<WikiSchema>('/api/wiki/schema'), api<{ items: RawSummary[] }>('/api/raw?summary=true')])
      .then(([wikiSchema, rawData]) => {
        setSchema(wikiSchema);
        setRaws(rawData.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '无法读取 Wiki 规则。'));
  }, []);

  useEffect(() => {
    if (schema && pendingCreate.current) {
      pendingCreate.current = false;
      setForm(createBase());
    }
  }, [schema]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await refreshList();
        if (!active) return;
        const requestedId = selectedIdRef.current;
        if (requestedId && next.some((item) => item.id === requestedId)) return;
        if (requestedId && explicitOpenIdRef.current === requestedId) return;
        const first = next[0];
        selectId(first?.id ?? null);
        if (!first) setSelected(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '无法读取 Wiki 列表。');
      } finally {
        if (active) setLoading(false);
      }
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let active = true;
    setSelected(null);
    api<Wiki>(`/api/wiki/${encodeURIComponent(selectedId)}`)
      .then((value) => {
        if (active) setSelected(value);
      })
      .catch((e) => {
        if (active) {
          setDetailTarget(null);
          setError(e instanceof Error ? e.message : '无法读取 Wiki 页面。');
        }
      });
    return () => {
      active = false;
    };
  }, [selectedId, detailReload]);

  useEffect(() => {
    let active = true;
    const refreshSelected = () => {
      if (selectedId) {
        const version = selectionVersion.current;
        void api<Wiki>(`/api/wiki/${selectedId}`)
          .then((value) => {
            if (active && version === selectionVersion.current) setSelected(value);
          })
          .catch(() => undefined);
      }
    };
    window.addEventListener('wiki:refresh', refreshSelected);
    return () => {
      active = false;
      window.removeEventListener('wiki:refresh', refreshSelected);
    };
  }, [selectedId]);

  useEffect(() => {
    const begin = () => startCreate();
    window.addEventListener('wiki:new', begin);
    return () => window.removeEventListener('wiki:new', begin);
  }, [schema]);

  useEffect(() => {
    const openGenerator = () => setActiveSubView('raw-to-wiki');
    window.addEventListener('wiki:generate', openGenerator);
    return () => window.removeEventListener('wiki:generate', openGenerator);
  }, []);

  const runLint = useCallback(async () => {
    setLintBusy(true);
    setLintError('');
    try {
      setLintResult(await api<WikiLintResult>('/api/wiki-lint'));
    } catch (e) {
      setLintError(e instanceof Error ? e.message : 'Lint 运行失败。');
    } finally {
      setLintBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!initialCheck) return;
    initialCheckTab.current?.focus();
    if (initialCheck.view === 'lint') void runLint();
  }, [initialCheck, runLint]);

  useEffect(() => {
    const lint = () => {
      setActiveSubView('lint');
      void runLint();
    };
    window.addEventListener('wiki:lint', lint);
    return () => {
      window.removeEventListener('wiki:lint', lint);
    };
  }, [runLint]);
  useEffect(() => {
    if (!initialOpenId) return;
    setActiveSubView('overview');
    setForm(null);
    setInspectionCitation(null);
    setError('');
    setNotice('');
    const id = initialOpenId;
    setDetailTarget({ id });
    explicitOpenIdRef.current = id;
    selectId(id);
    let active = true;
    api<Wiki>(`/api/wiki/${encodeURIComponent(id)}`)
      .then((value) => {
        if (active && selectedIdRef.current === id) setSelected(value);
      })
      .catch(() => {
        if (active && selectedIdRef.current === id)
          setError('这条最近知识记录对应的 Wiki 已不存在或无法读取，请从知识库列表选择有效页面。');
      })
      .finally(() => {
        if (active) onInitialOpenHandled?.();
      });
    return () => {
      active = false;
    };
  }, [initialOpenId, onInitialOpenHandled]);

  useEffect(() => {
    const panel = detailPanel.current;
    if (activeSubView !== 'overview' || !detailTarget || selected?.id !== detailTarget.id || !panel) return;
    if (detailTarget.edit && !form) {
      startEdit(selected);
      return;
    }
    if (!detailTarget.edit && form) return;
    panel.focus({ preventScroll: true });
    const evidence = panel.querySelector('[data-inspection-evidence]');
    if (evidence) evidence.scrollIntoView({ block: 'center' });
    else panel.scrollIntoView({ block: 'start' });
    setDetailTarget(null);
  }, [activeSubView, detailTarget, selected, form]);

  useEffect(() => {
    let active = true;
    drafts({ status: 'pending_confirmation' })
      .then((value) => {
        if (active) setPendingDrafts(value);
      })
      .catch(() => {
        if (active) setExtractError('无法读取待审核草稿，请重试或刷新。');
      });
    return () => {
      active = false;
    };
  }, []);
  const generateFromRaw = async (raw: RawSummary) => {
    if (raw.origin) {
      setExtractError('Meeting 来源仅限本机，不可发送给 AI。');
      return;
    }
    const requestedPageGeneration = navigationGeneration;
    setExtractError('');
    setExtractingRawId(raw.id);
    try {
      const state = processing[raw.id];
      if (state?.status === 'pending_confirmation' && state.draftId) {
        onOpenDraft?.(state.draftId);
        return;
      }
      if (modelDisabled && state?.status !== 'processing') return;
      const job = await startExtract(raw.id);
      onJobStarted?.(job, requestedPageGeneration);
    } catch (problem) {
      setExtractError(problem instanceof Error ? problem.message : '无法启动知识提取。');
    } finally {
      setExtractingRawId(null);
    }
  };
  useEffect(() => {
    let active = true;
    knowledgeWorkflows()
      .then((items) => {
        if (active)
          setPendingWorkflows(
            items.filter((item) => item.status === 'pending_confirmation' || item.status === 'conflict'),
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const activeTemplate = useMemo(() => (form ? schema?.pageTemplates[form.type] : undefined), [form, schema]);
  const createBase = (type: WikiType = 'concept'): WikiForm => ({
    title: '',
    type,
    category: 'industry_basics',
    sources: [],
    tags: [],
    aliases: [],
    knowledge_status: 'needs_verification',
    confidence: 'low',
    source_level: 'D',
    review_status: 'reviewed',
    body: templateBody(schema, type),
  });
  function startCreate() {
    setActiveSubView('overview');
    setDetailTarget(null);
    explicitOpenIdRef.current = null;
    selectionVersion.current += 1;
    setError('');
    setNotice('');
    setBaseRevision(null);
    if (!schema) {
      pendingCreate.current = true;
      setForm(null);
      return;
    }
    pendingCreate.current = false;
    setForm(createBase());
  }
  function startEdit(item: Wiki) {
    setError('');
    setNotice('');
    setBaseRevision(item.revision);
    const {
      id: _id,
      created: _created,
      updated: _updated,
      revision: _revision,
      domain: _domain,
      links: _links,
      ...fields
    } = item;
    delete fields.freshness;
    delete fields.backlinks;
    setForm(fields);
  }
  const chooseItem = (id: string) => {
    setDetailTarget(null);
    setInspectionCitation(null);
    onInitialAuditHandled?.();
    explicitOpenIdRef.current = null;
    setForm(null);
    if (selectedIdRef.current !== id) setSelected(null);
    setError('');
    setNotice('');
    selectId(id);
  };
  const openWiki = (id: string, citation?: AnswerCitation) => {
    chooseItem(id);
    explicitOpenIdRef.current = id;
    setInspectionCitation(citation ?? null);
    setDetailTarget({ id });
    setActiveSubView('overview');
  };
  const applyReview = (page: Wiki) => {
    setSelected((current) =>
      current?.id === page.id && current.revision <= page.revision
        ? { ...page, links: current.links, backlinks: current.backlinks }
        : current,
    );
    setReviewChange((previous) => previous + 1);
    if (activeSubView === 'lint') void runLint();
    else setLintResult(null);
  };
  const refreshReviewPage = async (id: string) => {
    const version = selectionVersion.current;
    const page = await api<Wiki>(`/api/wiki/${encodeURIComponent(id)}`).catch(() => null);
    if (version === selectionVersion.current && selectedIdRef.current === id) {
      setSelected(page);
      if (!page) setError('这条 Wiki 已不存在或当前无法访问。');
    }
  };
  const openLintEditor = (id: string) => {
    openWiki(id);
    setDetailTarget({ id, edit: true });
    setSelected(null);
    setDetailReload((previous) => previous + 1);
  };
  const switchSubView = (view: WikiSubView) => {
    setActiveSubView(view);
    if (view === 'ask') setHasOpenedAsk(true);
    if (view === 'active-check') setHasOpenedInspection(true);
    if (view === 'lint' && !lintResult && !lintBusy && !lintError) void runLint();
  };
  const setField = <K extends keyof WikiForm>(key: K, value: WikiForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setError('');
    setNotice('');
    if (!hasSectionContent(form.body)) {
      setError('请在页面模板至少填写一段内容后保存。');
      return;
    }
    if (form.type === 'source' && form.sources.length !== 1) {
      setError('来源摘要需要选择且只选择一条 Raw。');
      return;
    }
    if (form.type === 'synthesis' && form.sources.length < 2) {
      setError('综合整理至少需要选择两条 Raw 来源。');
      return;
    }
    if (
      (form.knowledge_status === 'verified' || form.knowledge_status === 'source_supported') &&
      form.sources.length === 0
    ) {
      setError('此状态需要关联有效的 Raw 来源。');
      return;
    }
    if (form.knowledge_status === 'verified' && form.review_status !== 'reviewed') {
      setError('已核实知识必须标记为已人工审核。');
      return;
    }
    const targetId = baseRevision === null ? null : selectedId;
    const selectionAtSave = selectionVersion.current;
    setBusy(true);
    try {
      const saved =
        baseRevision === null
          ? await api<Wiki>('/api/wiki', { method: 'POST', body: JSON.stringify(form) })
          : await api<Wiki>(`/api/wiki/${targetId}`, {
              method: 'PUT',
              body: JSON.stringify({ ...form, baseRevision }),
            });
      const fullDetail = await api<Wiki>(`/api/wiki/${saved.id}`);
      if (selectionVersion.current === selectionAtSave) {
        explicitOpenIdRef.current = null;
        setForm(null);
        selectId(saved.id);
        setSelected(fullDetail);
      }
      setNotice('Wiki 已保存。');
      await refreshList();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  };

  const deleteCheckInFlight = useRef(false);
  const requestDelete = async (item: Wiki) => {
    if (busy || deleteCheckInFlight.current) return;
    deleteCheckInFlight.current = true;
    const selectionAtRequest = selectionVersion.current;
    setError('');
    setNotice('');
    try {
      const result = await api<{ items: Array<{ id: string; title: string }> }>(`/api/wiki/${item.id}/references`);
      if (selectionVersion.current !== selectionAtRequest) return;
      setDeleteReferences(result.items);
      setDeleteTarget(item);
    } catch (e) {
      if (selectionVersion.current === selectionAtRequest)
        setError(e instanceof Error ? e.message : '读取关联页面失败。');
    } finally {
      deleteCheckInFlight.current = false;
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    setBusy(true);
    try {
      await api(`/api/wiki/${deleteTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ baseRevision: deleteTarget.revision }),
      });
      explicitOpenIdRef.current = null;
      setDeleteTarget(null);
      selectId(null);
      setSelected(null);
      setNotice('Wiki 已移到回收区。');
      const next = await refreshList();
      if (next[0]) selectId(next[0].id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  };
  return {
    activeSubView,
    hasOpenedAsk,
    hasOpenedInspection,
    initialInspectionId,
    initialCheckTab,
    schema,
    reviewOpen,
    setReviewOpen,
    reviewChange,
    items,
    selectedId,
    lintResult,
    lintBusy,
    lintError,
    busy,
    runLint,
    openLintEditor,
    openWiki,
    applyReview,
    switchSubView,
    startCreate,
    deleteTarget,
    deleteReferences,
    setDeleteTarget,
    confirmDelete,
    chooseItem,
    error,
    setError,
    notice,
    setNotice,
    pendingWorkflows,
    pendingDrafts,
    query,
    updateQuery,
    categoryCounts,
    category,
    updateCategory,
    loading,
    detailPanel,
    form,
    raws,
    baseRevision,
    activeTemplate,
    setField,
    setForm,
    save,
    detailTarget,
    selected,
    inspectionCitation,
    startEdit,
    requestDelete,
    refreshReviewPage,
    setActiveSubView,
    modelDisabled,
    extractError,
    processing,
    extractingRawId,
    generateFromRaw,
  };
}

export type WikiWorkspace = ReturnType<typeof useWikiWorkspace>;
