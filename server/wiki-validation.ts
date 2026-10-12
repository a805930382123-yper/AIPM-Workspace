import type { WikiInput, WikiType, KnowledgeStatus, Confidence, SourceLevel, ReviewStatus } from '../services/wiki/store.ts';
import { WikiError } from '../services/wiki/store.ts';

function text(value: unknown, field: string, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim())) throw new WikiError('INVALID_FIELD', `${field}不能为空或格式不正确。`);
  return value;
}
function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new WikiError('INVALID_FIELD', `${field}必须是文本列表。`);
  return value as string[];
}

export function validateWikiInput(value: unknown): WikiInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WikiError('INVALID_BODY', '请求内容格式不正确。');
  const x = value as Record<string, unknown>;
  const type = text(x.type, '类型') as WikiType;
  const status = (x.knowledge_status ?? 'needs_verification') as KnowledgeStatus;
  const confidence = (x.confidence ?? 'low') as Confidence;
  const sourceLevel = (x.source_level ?? 'D') as SourceLevel;
  const reviewStatus = (x.review_status ?? 'reviewed') as ReviewStatus;
  const category = text(x.category, '分类');
  const title = text(x.title, '标题');
  const body = text(x.body, '正文');
  return {
    title, type, category,
    sources: stringList(x.sources ?? [], '来源'),
    tags: stringList(x.tags ?? [], '标签'),
    aliases: stringList(x.aliases ?? [], '别名'),
    knowledge_status: status, confidence, source_level: sourceLevel, review_status: reviewStatus,
    body,
  };
}

export function validateBaseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new WikiError('INVALID_REVISION', '缺少有效的 baseRevision。');
  return value;
}
