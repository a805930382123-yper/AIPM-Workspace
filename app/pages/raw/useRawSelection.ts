import type { RawCitationTarget } from '../../components/WikiQuestionPanel';
import { useEffect, useRef, useState } from 'react';
import { useLlmDisabled } from '../../hooks/llmAvailability';
import type {
  ExtractionJob,
  Raw,
  RawTranslation,
  RawProcessingState,
  RawStatus,
  Wiki,
  KnowledgeWorkflowSummary,
} from '../../api';
import { ApiError, api, knowledgeWorkflows, sourceLabels, extractionJob, startExtract } from '../../api';

export type RawPageProps = {
  initialOriginal?: boolean;
  initialCitation?: RawCitationTarget | null;
  items: Raw[];
  selectedId: string | null;
  onSelected: (id: string) => void;
  onOpenImport: () => void;
  onCommitted: (raw: Raw) => Promise<void>;
  openImport: boolean;
  onCloseImport: () => void;
  onDeleted: (id: string) => Promise<void>;
  onBodySaved?: (raw: Raw) => void;
  processing: Record<string, RawProcessingState>;
  job: ExtractionJob | null;
  onJobStarted: (job: ExtractionJob, pageGeneration?: number, selectionGeneration?: number) => void;
  navigationGeneration?: number;
  selectionGeneration?: number;
  onOpenDraft: (draftId: string) => void;
  onOpenWorkflow?: (id: string) => void;
  onRefresh: () => Promise<void>;
};
export function useRawSelection({
  items,
  selectedId,
  processing,
  openImport,
  onCloseImport,
  onSelected,
  onDeleted,
  onJobStarted,
  onRefresh,
  navigationGeneration = 0,
  selectionGeneration = 0,
}: RawPageProps) {
  const modelDisabled = useLlmDisabled();
  const selected = items.find((item) => item.id === selectedId) ?? (selectedId ? null : (items[0] ?? null));
  const [rawQuery, setRawQuery] = useState('');
  const [rawStatusFilter, setRawStatusFilter] = useState<'all' | RawStatus>('all');
  const normalizedRawQuery = rawQuery.trim().toLowerCase();
  const hasRawFilter = Boolean(normalizedRawQuery) || rawStatusFilter !== 'all';
  const filteredItems = items.filter((item) => {
    const itemStatus = processing[item.id]?.status ?? 'unprocessed';
    if (rawStatusFilter !== 'all' && itemStatus !== rawStatusFilter) return false;
    if (!normalizedRawQuery) return true;
    return [item.title, item.sourceName, sourceLabels[item.sourceType] ?? item.sourceType, ...item.tags].some((value) =>
      value.toLowerCase().includes(normalizedRawQuery),
    );
  });
  const [reimport, setReimport] = useState<Raw | null>(null);
  const [deletingItem, setDeletingItem] = useState<Raw | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [importTranslation, setImportTranslation] = useState<RawTranslation | null>(null);
  const startGeneration = useRef(0);
  useEffect(() => {
    startGeneration.current++;
    setAiBusy(false);
    setAiError('');
  }, [selected?.id]);
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [sourcePages, setSourcePages] = useState<Wiki[]>([]);
  const [pendingWorkflows, setPendingWorkflows] = useState<KnowledgeWorkflowSummary[]>([]);
  const synthesisOpening = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
  const dialogOpen = openImport || !!reimport;
  const closeDialogs = () => {
    setReimport(null);
    onCloseImport();
  };
  // F03-04: navigation only. Committing data to the parent happens in ImportDialog as soon as
  // the server confirms it, so every exit path (关闭 / 右上角关闭 / 继续导入) stays in sync.
  const openCommitted = (raw: Raw, translation?: RawTranslation) => {
    setImportTranslation(translation ?? null);
    onSelected(raw.id);
    closeDialogs();
  };
  const handleDeleted = async (id: string) => {
    setDeletingItem(null);
    await onDeleted(id);
  };
  const startAi = async (
    rawId: string,
    restart = false,
    planningRetry = false,
    mode: 'standard' | 'deep' = 'standard',
  ) => {
    const generation = startGeneration.current;
    const requestedPageGeneration = navigationGeneration;
    const requestedSelectionGeneration = selectionGeneration;
    setAiError('');
    setAiBusy(true);
    try {
      const started = await startExtract(
        rawId,
        restart ? { restart: true, mode } : planningRetry ? { planningRetry: true, mode } : { mode },
      );
      onJobStarted(started, requestedPageGeneration, requestedSelectionGeneration);
      await onRefresh();
    } catch (error) {
      if (generation === startGeneration.current)
        setAiError(error instanceof Error ? error.message : '无法启动 AI 整理。');
      const jobId = error instanceof ApiError ? (error.details as { jobId?: string } | undefined)?.jobId : undefined;
      if (jobId) {
        try {
          onJobStarted(await extractionJob(jobId), requestedPageGeneration, requestedSelectionGeneration);
          await onRefresh();
        } catch {
          /* The original safe error remains visible. */
        }
      }
    } finally {
      if (generation === startGeneration.current) setAiBusy(false);
    }
  };
  const selectedState = selected ? processing[selected.id] : undefined;
  const generateImported = async (raw: Raw) => {
    const requestedPageGeneration = navigationGeneration;
    const requestedSelectionGeneration = selectionGeneration;
    const started = await startExtract(raw.id, { mode: raw.body.length <= 30000 ? 'deep' : 'standard' });
    onJobStarted(started, requestedPageGeneration, requestedSelectionGeneration);
    await onRefresh();
  };
  const openSynthesis = async () => {
    if (synthesisOpening.current) return;
    synthesisOpening.current = true;
    try {
      const result = await api<{ items: Wiki[] }>('/api/wiki');
      if (mountedRef.current) setSourcePages(result.items.filter((item) => item.type === 'source'));
    } catch {
      if (mountedRef.current) setSourcePages([]);
    } finally {
      synthesisOpening.current = false;
    }
    if (mountedRef.current) setSynthesisOpen(true);
  };

  return {
    modelDisabled,
    selected,
    rawQuery,
    setRawQuery,
    rawStatusFilter,
    setRawStatusFilter,
    hasRawFilter,
    filteredItems,
    reimport,
    setReimport,
    deletingItem,
    setDeletingItem,
    aiError,
    aiBusy,
    importTranslation,
    synthesisOpen,
    setSynthesisOpen,
    sourcePages,
    pendingWorkflows,
    openSynthesis,
    dialogOpen,
    closeDialogs,
    openCommitted,
    handleDeleted,
    startAi,
    selectedState,
    generateImported,
  };
}
