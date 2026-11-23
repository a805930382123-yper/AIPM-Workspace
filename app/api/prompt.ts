import type { FeedbackDto, FeedbackInput, FeedbackOutcome } from '../../services/prompt/feedback';
import { api } from './client';

export type { FeedbackDto, FeedbackInput, FeedbackOutcome };

export type PromptSource = 'manual' | 'ai_generated' | 'optimized';

export type Prompt = {
  id: string;
  name: string;
  category: string;
  scenario: string;
  body: string;
  variables: string[];
  inputRequirements: string;
  outputRequirements: string;
  relatedWikiIds: string[];
  examples: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  source: PromptSource;
  isDemo?: boolean;
};

export type PromptVersion = {
  version: number;
  savedAt: string;
  changeSource: 'manual' | 'ai_generated' | 'ai_optimized';
  snapshot: Prompt;
};

export type PromptCategory = { id: string; label: string; help?: string };
export type PromptSchema = { categories: PromptCategory[] };
export type PromptWikiLink = { id: string; title: string | null; status: 'resolved' | 'missing' };

export type PromptInput = Pick<
  Prompt,
  | 'name'
  | 'category'
  | 'scenario'
  | 'body'
  | 'inputRequirements'
  | 'outputRequirements'
  | 'relatedWikiIds'
  | 'examples'
  | 'tags'
  | 'favorite'
>;

export type PromptCreateResult = { prompt: Prompt; reused: boolean };
export type PromptRenderResult = { id: string; version: number; body: string; missingVariables: string[] };

export const promptSourceLabels: Record<PromptSource, string> = {
  manual: '手动创建',
  ai_generated: 'AI 生成',
  optimized: 'AI 优化',
};

export const promptChangeSourceLabels: Record<PromptVersion['changeSource'], string> = {
  manual: '人工保存',
  ai_generated: 'AI 生成',
  ai_optimized: 'AI 优化保存',
};

/** Same Unicode normalization the server uses for search, kept in one place for the UI hints. */
export const PROMPT_VARIABLE_HINT = '正文中用 {{变量名}} 表示需要每次填写的部分，例如 {{客户名称}}、{{行业术语}}。';

function promptQueryString(query: { q?: string; category?: string; tag?: string; favorite?: boolean }) {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.category) params.set('category', query.category);
  if (query.tag?.trim()) params.set('tag', query.tag.trim());
  if (query.favorite) params.set('favorite', 'true');
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const promptSchema = () => api<PromptSchema>('/api/prompts/schema');

export const promptList = (query: { q?: string; category?: string; tag?: string; favorite?: boolean } = {}) =>
  api<{ items: Prompt[]; categoryCounts: Record<string, number> }>(`/api/prompts${promptQueryString(query)}`);

export const promptDetail = (id: string) =>
  api<{ prompt: Prompt; wikiLinks: PromptWikiLink[] }>(`/api/prompts/${encodeURIComponent(id)}`);

export const promptVersions = (id: string) =>
  api<{ items: PromptVersion[] }>(`/api/prompts/${encodeURIComponent(id)}/versions`).then((value) => value.items);

export const promptVersion = (id: string, version: number) =>
  api<{ version: PromptVersion }>(`/api/prompts/${encodeURIComponent(id)}/versions/${version}`);

/** `requestId` is the stable id of one explicit "new prompt" session; retries reuse it. */
export const createPrompt = (requestId: string, input: PromptInput) =>
  api<PromptCreateResult>('/api/prompts', { method: 'POST', body: JSON.stringify({ requestId, ...input }) });

export const updatePrompt = (id: string, baseVersion: number, input: PromptInput) =>
  api<{ prompt: Prompt }>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, baseVersion }),
  }).then((value) => value.prompt);

export const deletePrompt = (id: string, baseVersion: number) =>
  api<{ id: string; deleted: true }>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ baseVersion }),
  });

export const renderPrompt = (id: string, baseVersion: number, values: Record<string, string>) =>
  api<PromptRenderResult>(`/api/prompts/${encodeURIComponent(id)}/render`, {
    method: 'POST',
    body: JSON.stringify({ baseVersion, values }),
  });

export const promptFeedback = (id: string, version: number) =>
  api<{ items: FeedbackDto[] }>(`/api/prompts/${encodeURIComponent(id)}/feedback?version=${version}`).then(
    (value) => value.items,
  );

export const createPromptFeedback = (id: string, input: FeedbackInput & { id: string; promptVersion: number }) =>
  api<{ feedback: FeedbackDto; reused: boolean }>(`/api/prompts/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updatePromptFeedback = (id: string, feedbackId: string, baseRevision: number, input: FeedbackInput) =>
  api<{ feedback: FeedbackDto }>(`/api/prompts/${encodeURIComponent(id)}/feedback/${encodeURIComponent(feedbackId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, baseRevision }),
  });

export const deletePromptFeedback = (id: string, feedbackId: string, baseRevision: number) =>
  api<{ id: string; deleted: true; reused: boolean }>(
    `/api/prompts/${encodeURIComponent(id)}/feedback/${encodeURIComponent(feedbackId)}`,
    { method: 'DELETE', body: JSON.stringify({ baseRevision }) },
  );

export const exportPromptFeedback = (id: string) =>
  api<{ schemaVersion: 1; promptId: string; items: FeedbackDto[] }>(
    `/api/prompts/${encodeURIComponent(id)}/feedback/export`,
  );

export const promptExportUrl = (id: string) => `/api/prompts/${encodeURIComponent(id)}/export`;
