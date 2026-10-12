// B04: request validation for the draft/confirm endpoints. Structural validation only —
// every business rule (evidence, enums, revisions, conflicts) is enforced again in the services.
import { InputError } from './validation.ts';
import type { DraftPagePatch, DraftPatch } from '../services/wiki/drafts.ts';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('INVALID_BODY', `${label}格式不正确。`, 400);
  return value as Record<string, unknown>;
}
function stringList(value: unknown, label: string, options: { required?: boolean } = {}): string[] {
  if (value === undefined) {
    if (options.required) throw new InputError('REQUIRED_FIELD', `${label}不能为空。`, 400);
    return [];
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new InputError('INVALID_FIELD', `${label}必须是文本列表。`, 400);
  return value as string[];
}
function revision(value: unknown, required = true): number {
  if (value === undefined && !required) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new InputError('INVALID_REVISION', '缺少有效的 baseRevision。', 400);
  return value;
}

export type DraftPatchBody = DraftPatch;

/** Structural validation only: the service validates every field again before writing. */
export function validateDraftPatch(value: unknown): DraftPatch {
  const body = object(value, '请求内容');
  const patch: DraftPatch = { baseRevision: revision(body.baseRevision) };
  if (body.document !== undefined) patch.document = object(body.document, 'document') as DraftPatch['document'];
  if (body.source !== undefined) patch.source = object(body.source, 'source') as DraftPatch['source'];
  if (body.pages !== undefined) {
    if (!Array.isArray(body.pages)) throw new InputError('INVALID_FIELD', 'pages 必须是数组。', 400);
    patch.pages = body.pages.map((item, index) => {
      const page = object(item, `pages[${index}]`);
      if (typeof page.pageId !== 'string' || !page.pageId) throw new InputError('INVALID_FIELD', 'pages 里每一项都需要 pageId。', 400);
      return page as unknown as DraftPagePatch;
    });
  }
  if (body.deletePageIds !== undefined) patch.deletePageIds = stringList(body.deletePageIds, 'deletePageIds');
  if (body.merge !== undefined) {
    const merge = object(body.merge, 'merge');
    patch.merge = { pageIds: stringList(merge.pageIds, 'merge.pageIds', { required: true }) };
    if (merge.title !== undefined) {
      if (typeof merge.title !== 'string' || !merge.title.trim()) throw new InputError('INVALID_FIELD', 'merge.title 必须是非空文本。', 400);
      patch.merge.title = merge.title;
    }
  }
  if (!patch.document && !patch.source && !patch.pages && !patch.deletePageIds && !patch.merge) {
    throw new InputError('EMPTY_PATCH', '这次修改没有任何内容。', 400);
  }
  return patch;
}

export function validateDiscard(value: unknown): { baseRevision?: number } {
  const body = object(value ?? {}, '请求内容');
  return body.baseRevision === undefined ? {} : { baseRevision: revision(body.baseRevision) };
}

export function validateConfirm(value: unknown): { baseRevision: number; selectedPageIds: string[]; idempotencyKey: string } {
  const body = object(value, '请求内容');
  const baseRevision = revision(body.baseRevision);
  const selectedPageIds = stringList(body.selectedPageIds, 'selectedPageIds', { required: true });
  if (!selectedPageIds.length) throw new InputError('NO_SELECTION', '至少选择一条知识建议才能确认写入。', 400);
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || !key.trim() || key.length > 128) throw new InputError('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 必须是 1–128 个字符的文本。', 400);
  return { baseRevision, selectedPageIds, idempotencyKey: key.trim() };
}
