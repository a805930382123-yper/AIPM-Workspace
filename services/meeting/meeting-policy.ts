import { cleanClone } from './meeting-validators.ts';
import { saveMeetingRecord, type MeetingStorePaths } from './meeting-catalog.ts';
import { MeetingError } from './errors.ts';
import type { PolicyInput } from './policy.ts';
import { CONFIDENTIALITY, type Meeting } from './types.ts';

export async function changeMeetingPolicy(
  paths: MeetingStorePaths,
  current: Meeting,
  input: PolicyInput,
): Promise<Meeting> {
  const nextConf = input.confidentiality ?? current.confidentiality;
  const nextMode = input.storage_mode ?? current.storage_mode;
  if (CONFIDENTIALITY.indexOf(nextConf) < CONFIDENTIALITY.indexOf(current.confidentiality))
    throw new MeetingError('CONFIDENTIALITY_DOWNGRADE_FORBIDDEN', '本版不支持降低会议保密等级。', 403);
  const raisesRestricted = nextConf === 'Restricted' && current.confidentiality !== 'Restricted';
  const localAuth = input.local_storage_authorized ?? current.local_storage_authorized;
  const rawAuth = input.raw_transfer_authorized ?? current.raw_transfer_authorized;
  const hasLocalCopy = current.imports.length > 0 || current.active_import_id !== null;
  const materialLinks = current.raw_links.filter((item) => item.status !== 'raw_deleted');
  const hasRawLink = materialLinks.length > 0 || current.raw_source_id !== null;
  if (
    hasLocalCopy &&
    (raisesRestricted ||
      (nextMode === 'cloud_index' && current.storage_mode !== 'cloud_index') ||
      (!localAuth && current.local_storage_authorized))
  ) {
    throw new MeetingError(
      'LOCAL_COPIES_PENDING',
      '存在本地纪要副本，需先明确删除后才能调整存储模式或撤销本地授权。',
      409,
      { localCopies: current.imports.length },
    );
  }
  if (raisesRestricted && hasRawLink)
    throw new MeetingError('LOCAL_COPIES_PENDING', '存在 Raw 来源，需先处理后才能升级为 Restricted。', 409, {
      localCopies: current.imports.length,
      rawLinks: materialLinks.length,
    });
  if (
    current.confidentiality === 'Restricted' &&
    (nextMode === 'local_archive' || input.local_storage_authorized === true || input.raw_transfer_authorized === true)
  )
    throw new MeetingError('POLICY_FORBIDDEN', 'Restricted 会议不能启用本地正文或 Raw 授权。', 403);
  const raiseWhileLocal =
    current.confidentiality !== nextConf &&
    (nextConf === 'Internal' || nextConf === 'Sensitive') &&
    nextMode === 'local_archive';
  if (raiseWhileLocal && (input.confirm_local_storage !== true || input.local_storage_authorized !== true))
    throw new MeetingError(
      'CONFIRMATION_REQUIRED',
      '提高到 Internal 或 Sensitive 且保留本地归档时，必须本次独立确认并授权本地保存。',
      403,
      { required: ['confirm_local_storage', 'local_storage_authorized'] },
    );
  if (nextConf === 'Restricted' && current.confidentiality !== 'Restricted') {
    const hasData = !!(
      current.tags.length ||
      current.customer ||
      current.project ||
      current.description ||
      current.recording_url ||
      current.minutes_url
    );
    if (hasData && input.confirm_restricted_metadata_clear !== true)
      throw new MeetingError('CONFIRMATION_REQUIRED', '转换为 Restricted 前必须确认清空不允许的元数据。', 409, {
        metadata_to_clear: ['tags', 'customer', 'project', 'description', 'recording_url', 'minutes_url'].filter(
          (k) => {
            const v = current[k as keyof Meeting];
            return Array.isArray(v) ? v.length > 0 : !!v;
          },
        ),
        localCopies: current.imports.length,
      });
  }
  if (
    input.local_storage_authorized === true &&
    !current.local_storage_authorized &&
    (nextConf === 'Internal' || nextConf === 'Sensitive') &&
    input.confirm_local_storage !== true
  )
    throw new MeetingError('CONFIRMATION_REQUIRED', 'Internal 或 Sensitive 会议授予本地保存权限前必须独立确认。', 403, {
      required: 'confirm_local_storage',
    });
  if (
    input.storage_mode === 'local_archive' &&
    current.storage_mode !== 'local_archive' &&
    (nextConf === 'Internal' || nextConf === 'Sensitive') &&
    (input.confirm_local_storage !== true || input.local_storage_authorized !== true)
  )
    throw new MeetingError(
      'CONFIRMATION_REQUIRED',
      'Internal 或 Sensitive 会议启用本地保存前必须本次独立确认并授权。',
      403,
      { required: ['confirm_local_storage', 'local_storage_authorized'] },
    );
  if (nextMode === 'local_archive' && (nextConf === 'Internal' || nextConf === 'Sensitive') && !localAuth)
    throw new MeetingError(
      'POLICY_FORBIDDEN',
      'Internal 或 Sensitive 会议必须先获本地保存授权才能使用 local_archive。',
      403,
    );
  if (
    current.storage_mode === 'local_archive' &&
    current.local_storage_authorized &&
    input.local_storage_authorized === false &&
    input.storage_mode !== 'cloud_index'
  )
    throw new MeetingError('POLICY_FORBIDDEN', '撤销本地保存授权必须在同一请求显式切换至 cloud_index。', 403);
  if (input.raw_transfer_authorized === true && (nextConf === 'Sensitive' || nextConf === 'Restricted'))
    throw new MeetingError('POLICY_FORBIDDEN', '仅 Public 或 Internal 会议允许登记 Raw 授权。', 403);
  if (input.raw_transfer_authorized === true && nextMode !== 'local_archive')
    throw new MeetingError('POLICY_FORBIDDEN', 'Raw 授权只允许用于 local_archive 模式。', 403);
  if (input.raw_transfer_authorized === true && input.confirm_raw_transfer !== true)
    throw new MeetingError('CONFIRMATION_REQUIRED', 'Raw 授权需要独立确认。', 403, {
      required: 'confirm_raw_transfer',
    });
  if ((nextConf === 'Restricted' || !rawAuth || nextMode === 'cloud_index') && hasRawLink)
    throw new MeetingError('RAW_LINKS_PENDING', '存在 Raw 关联，需先处理后才能升级或撤销授权。', 409, {
      rawLinks: materialLinks.length,
    });
  const clearRestricted = raisesRestricted;
  const now = new Date().toISOString();
  const next: Meeting = {
    ...current,
    confidentiality: nextConf,
    storage_mode: raisesRestricted ? 'cloud_index' : nextMode,
    local_storage_authorized: raisesRestricted ? false : localAuth,
    raw_transfer_authorized:
      current.confidentiality !== nextConf || raisesRestricted || nextMode === 'cloud_index' ? false : rawAuth,
    ...(clearRestricted
      ? { tags: [], customer: null, project: null, description: null, recording_url: null, minutes_url: null }
      : {}),
    revision: current.revision + 1,
    updated_at: now,
    policy_updated_at: now,
  };
  await saveMeetingRecord(paths, next);
  return cleanClone(next);
}
