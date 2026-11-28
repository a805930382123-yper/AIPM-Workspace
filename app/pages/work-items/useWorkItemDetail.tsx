import { useEffect, useRef, useState } from 'react';
import { api, ApiError, updateWorkItem, workItem } from '../../api';
import type { Raw, WorkAnalysis, WorkItem, WorkItemUpdate } from '../../api';
import { errorText, inputTime } from './workItemShared';

export const contextOf = (item: WorkItem) => ({
  status: item.status,
  customer: item.customer ?? '',
  project: item.project ?? '',
  occurredAt: inputTime(item.occurredAt),
  waitingFor: item.waitingFor ?? '',
  nextStep: item.nextStep ?? '',
  followUpOn: item.followUpOn ?? '',
});
export const analysisOf = (analysis?: WorkAnalysis) => ({
  goal: analysis?.goal ?? '',
  dataScope: analysis?.dataScope ?? '',
  confirmedConclusions: analysis?.confirmedConclusions ?? '',
  openQuestions: analysis?.openQuestions ?? '',
});
type Section = 'suggestion' | 'current' | 'history' | 'report' | 'materials' | 'stage' | 'analysis';

export function useWorkItemDetail({
  item,
  focusMaterials,
  raws,
  onBack,
  onOpenRaw,
  onChanged,
}: {
  item: WorkItem;
  focusMaterials: boolean;
  raws: Raw[];
  onBack: () => void;
  onOpenRaw: (id: string) => void;
  onChanged: () => void;
}) {
  const [saved, setSaved] = useState(item);
  const [context, setContext] = useState(() => contextOf(item));
  const [analysis, setAnalysis] = useState(() => analysisOf(item.analysis));
  const [closureReason, setClosureReason] = useState('');
  const [report, setReport] = useState(item.reportDraft ?? '');
  const [sent, setSent] = useState<{ body: string; time: string } | null>(null);
  const [kind, setKind] = useState<'feedback' | 'reproduction' | 'technical_reply' | 'customer_reply' | 'retest'>(
    'feedback',
  );
  const [historyText, setHistoryText] = useState('');
  const [outcome, setOutcome] = useState<'' | 'passed' | 'failed'>('');
  const [selectedRaw, setSelectedRaw] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageNote, setImageNote] = useState('');
  const [brokenImages, setBrokenImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const remove = async () => {
    setBusy(true);
    setDeleteError('');
    try {
      await api('/api/work-items/' + encodeURIComponent(saved.id), {
        method: 'DELETE',
        body: JSON.stringify({ baseRevision: saved.revision }),
      });
      onChanged();
      onBack();
    } catch (error) {
      setDeleteError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const [suggestionPreview, setSuggestionPreview] = useState<{
    revision: number;
    waitingFor: string;
    nextStep: string;
    followUpOn: string;
  } | null>(null);
  const [suggestionStale, setSuggestionStale] = useState(false);
  const [notice, setNotice] = useState<{
    section: Section;
    message: string;
    error?: boolean;
    conflict?: boolean;
  } | null>(null);

  const save = async (
    section: Section,
    action: () => Promise<WorkItem>,
    message: string,
    onSaved?: (next: WorkItem) => void,
  ) => {
    setNotice(null);
    setBusy(true);
    try {
      const next = await action();
      setSaved(next);
      onSaved?.(next);
      setNotice({ section, message });
      onChanged();
    } catch (error) {
      if (section === 'suggestion' && error instanceof ApiError && error.status === 409) setSuggestionStale(true);
      setNotice({
        section,
        message: errorText(error),
        error: true,
        conflict: error instanceof ApiError && error.status === 409,
      });
    } finally {
      setBusy(false);
    }
  };
  const update = (
    section: Section,
    patch: Omit<WorkItemUpdate, 'baseRevision'>,
    message: string,
    onSaved?: (next: WorkItem) => void,
  ) => save(section, () => updateWorkItem(saved.id, { baseRevision: saved.revision, ...patch }), message, onSaved);
  const readLatest = (section: Section) => {
    return save(
      section,
      () => workItem(saved.id),
      section === 'analysis'
        ? '已读取最新版本。请重新选择本轮资料和阶段成果。'
        : '已读取最新版本。请核对你的输入后再保存。',
      (next) => {
        setSuggestionPreview(null);
        setSuggestionStale(false);
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
        const previousAnalysis = analysisOf(saved.analysis);
        const currentAnalysis = analysisOf(next.analysis);
        setAnalysis({
          goal: analysis.goal === previousAnalysis.goal ? currentAnalysis.goal : analysis.goal,
          dataScope: analysis.dataScope === previousAnalysis.dataScope ? currentAnalysis.dataScope : analysis.dataScope,
          confirmedConclusions:
            analysis.confirmedConclusions === previousAnalysis.confirmedConclusions
              ? currentAnalysis.confirmedConclusions
              : analysis.confirmedConclusions,
          openQuestions:
            analysis.openQuestions === previousAnalysis.openQuestions
              ? currentAnalysis.openQuestions
              : analysis.openQuestions,
        });
        if (report === (saved.reportDraft ?? '')) setReport(next.reportDraft ?? '');
      },
    );
  };
  const renderNotice = (section: Section) =>
    notice?.section === section && (
      <div className="work-notice">
        <p className={notice.error ? 'form-error' : 'work-note'} role={notice.error ? 'alert' : 'status'}>
          {notice.message}
        </p>
        {notice.conflict && (
          <button className="secondary-button" disabled={busy} onClick={() => void readLatest(section)}>
            重新读取最新版本
          </button>
        )}
      </div>
    );
  const changeContext = <K extends keyof typeof context>(key: K, value: (typeof context)[K]) =>
    setContext((previous) => ({ ...previous, [key]: value }));
  const product = saved.kind === 'product_analysis';
  const closureInput = useRef<HTMLTextAreaElement>(null);
  const [focusClosure, setFocusClosure] = useState(false);
  useEffect(() => {
    if (focusClosure) {
      closureInput.current?.focus();
      setFocusClosure(false);
    }
  }, [focusClosure]);
  const closing = context.status === 'closed' && saved.status !== 'closed';
  const rawById = new Map(raws.map((raw) => [raw.id, raw]));
  const availableRaws = raws.filter((raw) => !saved.rawIds.includes(raw.id));
  const latestProgress =
    saved.kind === 'customer_issue'
      ? [...saved.history]
          .reverse()
          .find((entry) =>
            ['sent', 'technical_reply', 'customer_reply', 'retest', 'closed', 'reopened'].includes(entry.kind),
          )
      : undefined;
  const suggestion =
    latestProgress?.kind === 'sent' && (saved.status === 'triage' || saved.status === 'in_progress')
      ? {
          title: '转为等待技术',
          reason: '已记录发送技术反馈。',
          status: 'waiting' as const,
          waitingFor: '技术',
          nextStep: '跟进技术回复',
        }
      : latestProgress?.kind === 'technical_reply' && (saved.status === 'waiting' || saved.status === 'in_progress')
        ? {
            title: '转为待复测',
            reason: '已记录技术回复。',
            status: 'retest' as const,
            waitingFor: '',
            nextStep: '安排复测',
          }
        : latestProgress?.kind === 'retest' && latestProgress.outcome === 'failed' && saved.status === 'retest'
          ? {
              title: '继续处理',
              reason: '最近一次复测未通过。',
              status: 'in_progress' as const,
              waitingFor: '',
              nextStep: '核对失败原因并继续处理',
            }
          : undefined;
  const savedContext = contextOf(saved);
  const savedAnalysis = analysisOf(saved.analysis);
  const analysisDirty = (Object.keys(savedAnalysis) as Array<keyof typeof savedAnalysis>).some(
    (field) => analysis[field] !== savedAnalysis[field],
  );
  const currentDirty =
    (Object.keys(savedContext) as Array<keyof typeof savedContext>).some(
      (field) => context[field] !== savedContext[field],
    ) ||
    (closing && Boolean(closureReason.trim())) ||
    (product && analysisDirty);
  const historyDirty = Boolean(historyText.trim());
  const reportDirty = report !== (saved.reportDraft ?? '') || sent !== null;
  const anyDirty = currentDirty || (!product && (historyDirty || reportDirty));
  useEffect(() => {
    if (!anyDirty) setLeaveConfirm(false);
  }, [anyDirty]);
  const suggestionFields = ['waitingFor', 'nextStep', 'followUpOn'] as const;

  return {
    saved,
    setSaved,
    context,
    setContext,
    analysis,
    setAnalysis,
    closureReason,
    setClosureReason,
    report,
    setReport,
    sent,
    setSent,
    kind,
    setKind,
    historyText,
    setHistoryText,
    outcome,
    setOutcome,
    selectedRaw,
    setSelectedRaw,
    imageFile,
    setImageFile,
    imageNote,
    setImageNote,
    brokenImages,
    setBrokenImages,
    busy,
    setBusy,
    deleteConfirm,
    setDeleteConfirm,
    deleteError,
    setDeleteError,
    leaveConfirm,
    setLeaveConfirm,
    remove,
    suggestionPreview,
    setSuggestionPreview,
    suggestionStale,
    setSuggestionStale,
    notice,
    setNotice,
    save,
    update,
    readLatest,
    renderNotice,
    changeContext,
    product,
    closureInput,
    focusClosure,
    setFocusClosure,
    closing,
    rawById,
    availableRaws,
    latestProgress,
    suggestion,
    savedContext,
    savedAnalysis,
    analysisDirty,
    currentDirty,
    historyDirty,
    reportDirty,
    anyDirty,
    suggestionFields,
    item,
    focusMaterials,
    raws,
    onBack,
    onOpenRaw,
    onChanged,
  };
}

export type WorkItemDetailState = ReturnType<typeof useWorkItemDetail>;
