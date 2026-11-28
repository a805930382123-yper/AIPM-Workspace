import type { RawCitationTarget } from '../../components/WikiQuestionPanel';
import { useEffect, useRef, useState } from 'react';
import { useLlmDisabled } from '../../hooks/llmAvailability';
import type { ExtractionJob, Raw, RawTranslation, RawProcessingState, Wiki } from '../../api';
import {
  api,
  changeRawTranslation,
  jobStageLabels,
  rawStatusLabels,
  rawTranslation,
  extractionJob,
  draftView,
  reconcileExtractionStorage,
} from '../../api';
import { isPdfRaw, isScannedPdf } from './rawPdf';
export type RawDetailProps = {
  initialOriginal?: boolean;
  initialCitation?: RawCitationTarget | null;
  initialTranslation: RawTranslation | null;
  item: Raw;
  state?: RawProcessingState;
  job: ExtractionJob | null;
  busy: boolean;
  error: string;
  onStorageReconciled: (job: ExtractionJob) => void;
  onStartAi: (restart?: boolean, planningRetry?: boolean, mode?: 'standard' | 'deep') => void;
  onReimport: () => void;
  onDelete: () => void;
  onOpenDraft: (draftId: string) => void;
  onBodySaved: (raw: Raw) => void;
};
export function useRawDetail({
  initialOriginal = false,
  initialCitation,
  initialTranslation,
  item,
  state,
  job,
  onStorageReconciled,
}: RawDetailProps) {
  const modelDisabled = useLlmDisabled();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedBodyNotice, setSavedBodyNotice] = useState('');
  const citationMark = useRef<HTMLElement>(null),
    citation = initialCitation?.rawId === item.id ? initialCitation : null;
  const citationMatches =
    !!citation &&
    item.bodySha256 === citation.bodySha256 &&
    item.body.slice(citation.start, citation.end) === citation.quote;
  useEffect(() => {
    if (citationMatches) citationMark.current?.scrollIntoView({ block: 'center' });
  }, [citationMatches, citation?.start, citation?.end, item.id]);
  const [translation, setTranslation] = useState<RawTranslation | null>(initialTranslation);
  const [translationError, setTranslationError] = useState('');
  const [translationActionError, setTranslationActionError] = useState('');
  const [translationAction, setTranslationAction] = useState<'retry' | 'cancel' | null>(null);
  const [translationRead, setTranslationRead] = useState(0);
  const [readingOriginal, setReadingOriginal] = useState(initialOriginal);
  useEffect(() => {
    setReadingOriginal(initialOriginal);
  }, [initialOriginal]);
  const canReadTranslation = !!item.urlImport && !item.origin;
  useEffect(() => {
    if (!canReadTranslation || translationAction) return;
    let active = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const result = await rawTranslation(item.id);
        if (!active) return;
        setTranslation(result.translation ?? (initialTranslation?.status === 'failed' ? initialTranslation : null));
        setTranslationError('');
        if (result.translation?.status === 'queued' || result.translation?.status === 'running')
          timer = window.setTimeout(() => void read(), 500);
      } catch (problem) {
        if (active) setTranslationError(problem instanceof Error ? problem.message : '无法读取翻译状态。');
      }
    };
    void read();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canReadTranslation, item.id, item.bodySha256, initialTranslation, translationRead, translationAction]);
  const updateTranslation = async (action: 'retry' | 'cancel') => {
    setTranslationAction(action);
    setTranslationActionError('');
    try {
      const result = await changeRawTranslation(item.id, action);
      setTranslation(result.translation);
    } catch (problem) {
      setTranslationActionError(problem instanceof Error ? problem.message : '无法更新翻译任务。');
    } finally {
      setTranslationAction(null);
    }
  };
  const status = state?.status ?? 'unprocessed';
  const [topicSummary, setTopicSummary] = useState<{
      draft: string[];
      written: string[];
      draftId?: string;
      history?: string;
      deferred?: boolean;
      commitRecovery?: boolean;
      sourceChanged?: boolean;
    } | null>(null),
    [topicError, setTopicError] = useState('');
  useEffect(() => {
    let active = true;
    setTopicSummary(null);
    setTopicError('');
    const load = async () => {
      const response = state?.draftId ? await draftView(state.draftId) : null;
      if (
        response &&
        (response.input ||
          response.id !== state?.draftId ||
          response.rawId !== item.id ||
          (status === 'pending_confirmation' && state?.jobId && response.jobId !== state.jobId))
      ) {
        throw new Error('整理草稿与当前资料或任务不匹配，请刷新后核对。');
      }
      const proposed = response && !response.input ? response : null;
      const formal = await Promise.all(
        (state?.generatedWikiIds ?? []).map((id) => api<Wiki>('/api/wiki/' + encodeURIComponent(id))),
      ).catch((error) => {
        if (active) setTopicError(error instanceof Error ? error.message : '无法读取正式主题。');
        return [];
      });
      const commitRecovery = proposed?.status === 'committing' || !!proposed?.pendingCommitOperationId;
      const history =
        !commitRecovery &&
        status !== 'processing' &&
        status !== 'failed' &&
        proposed?.maintenance &&
        (proposed.status === 'confirmed' || proposed.status === 'discarded')
          ? proposed.discardedAt
            ? proposed.status === 'discarded'
              ? '全部不采纳'
              : '选择已结束'
            : proposed.maintenance.changes.every((c) => c.action === 'noop' && c.committedOperationId)
              ? '已检查，无需变更'
              : '已确认入库'
          : undefined;
      const sourceChanged = proposed?.preview?.rawSha256Matches === false;
      if (active)
        setTopicSummary({
          draft:
            history || sourceChanged
              ? []
              : proposed?.maintenance
                ? proposed.maintenance.changes
                    .filter((c) => !c.committedOperationId)
                    .map(
                      (c) =>
                        ({ create: '新建', update: '更新', link: '补来源', noop: '无变化' })[c.action] +
                        '：' +
                        c.candidate.title,
                    )
                : (proposed?.pages.filter((p) => p.selected).map((p) => p.title) ?? []),
          written: formal.filter((p) => p.type !== 'source').map((p) => p.title),
          draftId: proposed?.id,
          history,
          deferred: proposed?.status === 'pending_confirmation' && !!proposed.deferredAt,
          commitRecovery,
          sourceChanged,
        });
    };
    if (state?.draftId || state?.generatedWikiIds?.length)
      void load().catch((e) => {
        if (active) setTopicError(e instanceof Error ? e.message : '无法读取受影响主题，请刷新重试。');
      });
    return () => {
      active = false;
    };
  }, [
    item.id,
    item.bodySha256,
    item.bodyRevision,
    status,
    state?.draftId,
    state?.jobId,
    state?.updatedAt,
    state?.generatedWikiIds?.join(','),
  ]);
  const [mode, setMode] = useState<'standard' | 'deep'>(() => (item.body.length <= 30000 ? 'deep' : 'standard'));
  const [savingState, setSavingState] = useState(false);
  const [savingError, setSavingError] = useState('');
  const recoveryGeneration = useRef(0);
  useEffect(() => {
    recoveryGeneration.current++;
    setSavingState(false);
    setSavingError('');
    return () => {
      recoveryGeneration.current++;
    };
  }, [item.id]);
  const [storedJob, setStoredJob] = useState<ExtractionJob | null>(null);
  const storedJobId = state?.recoveryJobId ?? state?.jobId;
  useEffect(() => {
    if (!storedJobId) {
      setStoredJob(null);
      return;
    }
    let active = true;
    extractionJob(storedJobId)
      .then((value) => {
        if (active) setStoredJob(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [storedJobId]);
  const meetingOnly = item.origin !== undefined;
  const acquiredRevision = item.newsMaterial?.revision ?? 0;
  const editedPdf = isPdfRaw(item) && (item.bodyRevision ?? 0) !== acquiredRevision;
  const pdf = !meetingOnly && isPdfRaw(item) && !editedPdf;
  const scannedPdf = isScannedPdf(item);
  const activeJob =
    job && job.rawId === item.id && (!storedJobId || job.jobId === storedJobId)
      ? job
      : storedJob && storedJob.rawId === item.id && storedJob.jobId === storedJobId
        ? storedJob
        : null;
  const storageBlocked = !!activeJob?.recovery;
  const retryStorage = async () => {
    if (!activeJob) return;
    const generation = recoveryGeneration.current;
    setSavingState(true);
    setSavingError('');
    try {
      const saved = await reconcileExtractionStorage(activeJob.jobId);
      if (generation !== recoveryGeneration.current) return;
      setStoredJob(saved);
      onStorageReconciled(saved);
    } catch (error) {
      if (generation === recoveryGeneration.current)
        setSavingError(error instanceof Error ? error.message : '保存状态失败。');
    } finally {
      if (generation === recoveryGeneration.current) setSavingState(false);
    }
  };
  const stage = activeJob
    ? activeJob.mode === 'deep'
      ? ((
          {
            extracting: '提取',
            planning: '知识页规划',
            outline: '大纲',
            writing: '写作',
            quality: '质量检查',
            ready: '草稿阶段完成',
          } as Record<string, string>
        )[activeJob.checkpoint?.deepStage ?? activeJob.stage] ?? jobStageLabels[activeJob.stage])
      : jobStageLabels[activeJob.stage]
    : rawStatusLabels[status];
  const recoveryStatus = storageBlocked
    ? activeJob?.execution === 'running'
      ? '正在停止，状态保存失败'
      : '已停止，状态保存失败'
    : null;
  const draftStatus = topicSummary?.commitRecovery
    ? '上次确认待完成'
    : topicSummary?.sourceChanged
      ? '旧整理成果'
      : topicSummary?.deferred
        ? '稍后处理'
        : topicSummary?.history;
  const draftId = topicSummary?.draftId === state?.draftId ? topicSummary?.draftId : undefined;
  const legacyPdfTask =
    pdf &&
    !scannedPdf &&
    (storageBlocked ||
      ((status === 'processing' || status === 'failed') && (!!storedJobId || !!activeJob || !!state?.lastError)));
  const pdfPrimary = pdf && !legacyPdfTask;

  return {
    modelDisabled,
    editing,
    setEditing,
    historyOpen,
    setHistoryOpen,
    savedBodyNotice,
    setSavedBodyNotice,
    citationMark,
    citation,
    citationMatches,
    translation,
    translationError,
    translationActionError,
    translationAction,
    setTranslationRead,
    setReadingOriginal,
    canReadTranslation,
    readingOriginal,
    updateTranslation,
    status,
    topicSummary,
    topicError,
    mode,
    setMode,
    savingState,
    savingError,
    meetingOnly,
    acquiredRevision,
    editedPdf,
    pdf,
    scannedPdf,
    activeJob,
    storageBlocked,
    retryStorage,
    stage,
    recoveryStatus,
    draftStatus,
    draftId,
    legacyPdfTask,
    pdfPrimary,
  };
}
