import { api, apiForm } from './client';
import type {
  WorkAnalysisRun,
  WorkAnalysisRunInput,
  WorkAnalysisRunWithReview,
  WorkBasisReview,
  WorkItem,
  WorkItemCreate,
  WorkItemSummary,
  WorkItemUpdate,
} from '../../services/work-items/types';

export type {
  WorkAnalysis,
  WorkAnalysisOutputV2,
  WorkAnalysisRun,
  WorkAnalysisRunWithReview,
  WorkHistory,
  WorkHistoryInput,
  WorkItem,
  WorkItemKind,
  WorkItemSummary,
  WorkItemUpdate,
  WorkStatus,
} from '../../services/work-items/types';

const workItemUrl = (id: string) => `/api/work-items/${encodeURIComponent(id)}`;

export const workItems = (due = false) =>
  api<{ items: WorkItemSummary[] }>(`/api/work-items${due ? '?due=1' : ''}`).then((result) => result.items);

export const workItem = (id: string) => api<WorkItem>(workItemUrl(id));

export const createWorkItem = (input: WorkItemCreate) =>
  api<WorkItem>('/api/work-items', { method: 'POST', body: JSON.stringify(input) });

export const updateWorkItem = (id: string, input: WorkItemUpdate) =>
  api<WorkItem>(workItemUrl(id), { method: 'PUT', body: JSON.stringify(input) });

export const uploadWorkScreenshot = (id: string, form: FormData) =>
  apiForm<WorkItem>(`${workItemUrl(id)}/screenshots`, form);

export const workScreenshotUrl = (id: string, imageId: string) =>
  `${workItemUrl(id)}/screenshots/${encodeURIComponent(imageId)}`;

const workAnalysisUrl = (id: string) => `${workItemUrl(id)}/analysis-runs`;

export const workAnalysisRuns = (id: string) =>
  api<{ items: WorkAnalysisRunWithReview[] }>(workAnalysisUrl(id)).then((result) => result.items);

export const startWorkAnalysis = (id: string, input: WorkAnalysisRunInput) =>
  api<WorkAnalysisRun>(workAnalysisUrl(id), { method: 'POST', body: JSON.stringify(input) });

export const startWorkBasisReview = (id: string, runId: string, retryFromReviewId?: string) =>
  api<WorkBasisReview>(`${workAnalysisUrl(id)}/${encodeURIComponent(runId)}/basis-review`, {
    method: 'POST',
    body: JSON.stringify({ retryFromReviewId }),
  });
