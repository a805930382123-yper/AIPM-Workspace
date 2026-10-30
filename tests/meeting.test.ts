import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import express from 'express';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { MeetingError } from '../services/meeting/errors.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { registerMeetingRoutes, meetingErrorMiddleware } from '../server/meeting-api.ts';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';

async function fixture<T>(work: (root: string, store: MeetingStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), '.meeting-test-'));
  try { const store = new MeetingStore(root); await store.initialize(); return await work(root, store); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function input(catalog: Awaited<ReturnType<MeetingStore['getCatalog']>>, values: Record<string, unknown> = {}) {
  return { requestId: 'e38f960f-7abf-42dd-b383-1bc44db67bee', title: '例会', meeting_date: '2026-10-11', meeting_type: catalog.types[0].id, ...values };
}
async function errorCode(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof MeetingError && error.code === code);
}

test('Meeting defaults, single initialization and idempotent creation', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  assert.equal(catalog.types.length, 8);
  assert.deepEqual(catalog.tags, []);
  const concurrent = await Promise.all([store.create(input(catalog)), store.create(input(catalog))]);
  const first = concurrent[0]; const retry = concurrent[1];
  assert.deepEqual(concurrent.map(item => item.reused).sort(), [false, true]);
  assert.equal(first.meeting.meeting_id, retry.meeting.meeting_id);
  assert.equal(first.meeting.confidentiality, 'Sensitive');
  assert.equal(first.meeting.storage_mode, 'cloud_index');
  assert.deepEqual([first.meeting.local_storage_authorized, first.meeting.external_ai_authorized, first.meeting.raw_transfer_authorized], [false, false, false]);
  await errorCode(() => store.create(input(catalog, { title: '异载荷' })), 'IDEMPOTENCY_CONFLICT');
  await errorCode(() => store.get('../outside'), 'INVALID_ID');
  const reloaded = new MeetingStore(_root); await reloaded.initialize();
  assert.equal((await reloaded.get(first.meeting.meeting_id))?.meeting_id, first.meeting.meeting_id);
}));

test('policy confirmation and Restricted conversion clear only the allowlisted metadata', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  const created = await store.create(input(catalog, { confidentiality: 'Internal', customer: '客户甲', recording_url: 'https://example.com/meeting' }));
  const id = created.meeting.meeting_id;
  await errorCode(() => store.updatePolicy(id, { baseRevision: 1, storage_mode: 'local_archive' }), 'CONFIRMATION_REQUIRED');
  const local = await store.updatePolicy(id, { baseRevision: 1, storage_mode: 'local_archive', local_storage_authorized: true, confirm_local_storage: true, raw_transfer_authorized: true, confirm_raw_transfer: true });
  assert.equal(local.storage_mode, 'local_archive');
  assert.equal(local.raw_transfer_authorized, true);
  await errorCode(() => store.updatePolicy(id, { baseRevision: 2, confidentiality: 'Sensitive' }), 'CONFIRMATION_REQUIRED');
  const sensitive = await store.updatePolicy(id, { baseRevision: 2, confidentiality: 'Sensitive', local_storage_authorized: true, confirm_local_storage: true });
  assert.equal(sensitive.raw_transfer_authorized, false);
  await errorCode(() => store.updatePolicy(id, { baseRevision: 3, confidentiality: 'Restricted' }), 'CONFIRMATION_REQUIRED');
}));

test('policy grants and revocations are internally consistent', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  const restricted = await store.create(input(catalog, { confidentiality: 'Restricted' })).then(x => x.meeting);
  await errorCode(() => store.updatePolicy(restricted.meeting_id, { baseRevision: 1, storage_mode: 'local_archive' }), 'POLICY_FORBIDDEN');
  await errorCode(() => store.updatePolicy(restricted.meeting_id, { baseRevision: 1, local_storage_authorized: true }), 'POLICY_FORBIDDEN');
  await errorCode(() => store.updatePolicy(restricted.meeting_id, { baseRevision: 1, raw_transfer_authorized: true, confirm_raw_transfer: true }), 'POLICY_FORBIDDEN');

  const sensitive = await store.create(input(catalog, { requestId: '3014dd7a-1558-4c76-a6a3-a8e7e66e0e2e' })).then(x => x.meeting);
  await errorCode(() => store.updatePolicy(sensitive.meeting_id, { baseRevision: 1, local_storage_authorized: true }), 'CONFIRMATION_REQUIRED');
  const granted = await store.updatePolicy(sensitive.meeting_id, { baseRevision: 1, local_storage_authorized: true, confirm_local_storage: true });
  const local = await store.updatePolicy(sensitive.meeting_id, { baseRevision: granted.revision, storage_mode: 'local_archive', local_storage_authorized: true, confirm_local_storage: true });
  await errorCode(() => store.updatePolicy(sensitive.meeting_id, { baseRevision: local.revision, local_storage_authorized: false }), 'POLICY_FORBIDDEN');
  const cloud = await store.updatePolicy(sensitive.meeting_id, { baseRevision: local.revision, storage_mode: 'cloud_index', local_storage_authorized: false });
  assert.equal(cloud.storage_mode, 'cloud_index'); assert.equal(cloud.local_storage_authorized, false); assert.equal(cloud.raw_transfer_authorized, false);

  const publicMeeting = await store.create(input(catalog, { requestId: '0221b292-1544-4e7f-9c4b-6d5c2c6b8919', confidentiality: 'Public' })).then(x => x.meeting);
  const publicLocal = await store.updatePolicy(publicMeeting.meeting_id, { baseRevision: 1, storage_mode: 'local_archive', raw_transfer_authorized: true, confirm_raw_transfer: true });
  const publicCloud = await store.updatePolicy(publicMeeting.meeting_id, { baseRevision: publicLocal.revision, storage_mode: 'cloud_index' });
  assert.equal(publicCloud.raw_transfer_authorized, false);
}));

test('Restricted conversion returns field names and clears restricted metadata after confirmation', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  const created = await store.create(input(catalog, { confidentiality: 'Public', customer: '不应出现在错误中', description: '备注保密' }));
  await assert.rejects(store.updatePolicy(created.meeting.meeting_id, { baseRevision: 1, confidentiality: 'Restricted' }), (error: unknown) => {
    assert.ok(error instanceof MeetingError); assert.equal(error.status, 409);
    assert.deepEqual((error.details as { metadata_to_clear: string[] }).metadata_to_clear, ['customer', 'description']);
    assert.deepEqual(Object.keys(error.details as Record<string, unknown>).sort(), ['localCopies','metadata_to_clear']);
    assert.equal(JSON.stringify(error.details).includes('不应出现在错误中'), false);
    return true;
  });
  const result = await store.updatePolicy(created.meeting.meeting_id, { baseRevision: 1, confidentiality: 'Restricted', confirm_restricted_metadata_clear: true });
  assert.equal(result.customer, null); assert.equal(result.description, null); assert.equal(result.storage_mode, 'cloud_index');
  assert.equal(result.local_storage_authorized, false); assert.equal(result.raw_transfer_authorized, false);
}));

test('revision, validation, stopped catalog choices, and corrupt records fail without overwrite', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog();
  const meeting = await store.create(input(catalog)).then(x => x.meeting);
  await errorCode(() => store.update(meeting.meeting_id, { baseRevision: 9, title: '新版' }), 'REVISION_CONFLICT');
  await errorCode(() => store.update(meeting.meeting_id, { baseRevision: 1, recording_url: 'http://example.com' }), 'INVALID_URL');
  const disabled = await store.mutateCatalog({ baseRevision: 1, active: false }, 'types', catalog.types[0].id);
  await errorCode(() => store.update(meeting.meeting_id, { baseRevision: 1, meeting_type: catalog.types[0].id }), 'INVALID_MEETING_TYPE');
  assert.equal(disabled.revision, 2);
  const recordFile = path.join(root, 'meetings', 'records', `${meeting.meeting_id}.json`);
  await writeFile(recordFile, '{broken', 'utf8');
  await errorCode(() => store.get(meeting.meeting_id), 'CORRUPT_MEETING');
  await errorCode(() => store.create({ ...input(catalog, { meeting_type: catalog.types[1].id }), requestId: 'c806b4e1-945a-474b-b7c0-dd3c7781b835' }), 'CORRUPT_MEETING');
  assert.equal(await readFile(recordFile, 'utf8'), '{broken');
}));

test('creation stores only a digest and retries survive later metadata clearing and type stop', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog();
  const payload = input(catalog, { confidentiality: 'Public', customer: 'M01_PRIVATE_CREATION_VALUE', description: '秘密备注' });
  const created = await store.create(payload);
  const recordFile = path.join(root, 'meetings', 'records', `${created.meeting.meeting_id}.json`);
  const stored = JSON.parse(await readFile(recordFile, 'utf8')) as { creation: Record<string, unknown> };
  assert.deepEqual(Object.keys(stored.creation).sort(), ['inputSha256','requestId']);
  assert.equal(JSON.stringify(stored.creation).includes('M01_PRIVATE_CREATION_VALUE'), false);
  await store.mutateCatalog({ baseRevision: 1, active: false }, 'types', payload.meeting_type as string);
  const replay = await store.create(payload); assert.equal(replay.reused, true); assert.equal(replay.meeting.meeting_id, created.meeting.meeting_id);
  await errorCode(() => store.create({ ...payload, requestId: '02f9d709-4b43-43e2-b01f-62f1c4dc3494' }), 'INVALID_MEETING_TYPE');
  await store.updatePolicy(created.meeting.meeting_id, { baseRevision: 1, confidentiality: 'Restricted', confirm_restricted_metadata_clear: true });
  const afterRestricted = await readFile(recordFile, 'utf8');
  assert.equal(afterRestricted.includes('M01_PRIVATE_CREATION_VALUE'), false); assert.equal(afterRestricted.includes('秘密备注'), false);
  assert.equal((await store.create(payload)).meeting.meeting_id, created.meeting.meeting_id);
}));

test('catalog damage is never treated as absent or overwritten', async () => fixture(async (root, store) => {
  const catalogFile = path.join(root, 'meetings', 'catalog.json');
  await writeFile(catalogFile, '[]', 'utf8');
  await errorCode(() => store.getCatalog(), 'CORRUPT_MEETING_CATALOG');
  assert.equal(await readFile(catalogFile, 'utf8'), '[]');
}));

test('missing catalog with records is not silently reseeded', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog(); await store.create(input(catalog));
  const catalogFile = path.join(root, 'meetings', 'catalog.json'); const original = await readFile(catalogFile, 'utf8');
  await unlink(catalogFile);
  await errorCode(() => store.initialize(), 'CORRUPT_MEETING_CATALOG');
  await errorCode(() => store.list(), 'CORRUPT_MEETING_CATALOG');
  await assert.rejects(readFile(catalogFile, 'utf8'));
  assert.ok(original.length > 0);
}));

test('catalog persistence rejects unknown keys, malformed names, duplicates and missing references', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog(); const catalogFile = path.join(root, 'meetings', 'catalog.json');
  const variants: Array<(value: Record<string, unknown>) => void> = [
    value => { value.unexpected = 'x'; },
    value => { (value.types as Array<Record<string, unknown>>)[0].extra = true; },
    value => { (value.types as Array<Record<string, unknown>>)[0].name = 'bad\nname'; },
    value => { (value.types as Array<Record<string, unknown>>)[1].name = (value.types as Array<Record<string, unknown>>)[0].name; },
  ];
  for (const corrupt of variants) {
    const candidate = structuredClone(catalog) as unknown as Record<string, unknown>; corrupt(candidate);
    await writeFile(catalogFile, JSON.stringify(candidate)); await errorCode(() => store.getCatalog(), 'CORRUPT_MEETING_CATALOG');
  }
  await writeFile(catalogFile, JSON.stringify(catalog));
  const meeting = await store.create(input(catalog)).then(x => x.meeting);
  const recordFile = path.join(root, 'meetings', 'records', `${meeting.meeting_id}.json`);
  const record = JSON.parse(await readFile(recordFile, 'utf8')) as Record<string, unknown>;
  record.meeting_type = '11111111-1111-4111-8111-111111111111'; await writeFile(recordFile, JSON.stringify(record));
  await errorCode(() => store.get(meeting.meeting_id), 'CORRUPT_MEETING');
}));

test('default catalog type names remain editable while stable IDs keep historical references valid', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  const meeting = await store.create(input(catalog)).then(x => x.meeting);
  const renamed = await store.mutateCatalog({ baseRevision: 1, name: '新名称' }, 'types', catalog.types[0].id);
  assert.equal(renamed.types[0].id, catalog.types[0].id);
  assert.equal(renamed.types[0].name, '新名称');
  assert.equal((await store.get(meeting.meeting_id))?.meeting_type, catalog.types[0].id);
}));

test('unknown input keys and corrupted stored shapes are rejected without echo or overwrite', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog();
  const created = await store.create(input(catalog));
  const id = created.meeting.meeting_id; const file = path.join(root, 'meetings', 'records', `${id}.json`);
  const secretKey = 'https://private.example/M01_KEY_SENTINEL';
  await assert.rejects(store.update(id, { baseRevision: 1, [secretKey]: 'x' }), (error: unknown) => {
    assert.ok(error instanceof MeetingError); assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(secretKey), false); return true;
  });
  const good = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const corruptions: Array<(record: Record<string, unknown>) => void> = [
    record => { record.imported_minutes = 'PRIVATE'; },
    record => { record.minutes_url = 'javascript:alert(1)'; },
    record => { record.title = ''; },
    record => { record.meeting_date = '2026-02-30'; },
    record => { record.meeting_time = '27:90'; },
    record => { record.updated_at = 'not-a-time'; },
    record => { record.meeting_type = '11111111-1111-4111-8111-111111111111'; },
    record => { record.tags = [catalog.types[0].id, catalog.types[0].id]; },
    record => { (record.creation as Record<string, unknown>).inputSha256 = 'broken'; },
    record => { record.raw_transfer_authorized = true; },
    record => { record.local_storage_authorized = false; record.storage_mode = 'local_archive'; },
    record => { record.confidentiality = 'Restricted'; record.customer = 'private'; },
  ];
  for (const corrupt of corruptions) {
    const candidate = structuredClone(good); corrupt(candidate); await writeFile(file, JSON.stringify(candidate));
    for (const action of [() => store.get(id), () => store.list(), () => store.update(id, { baseRevision: 1, title: '改写' }), () => store.delete(id, { baseRevision: 1, confirm: true })]) await errorCode(action, 'CORRUPT_MEETING');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), candidate);
  }
}));

test('inactive directory entries remain readable but reject new selection', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  const added = await store.mutateCatalog({ baseRevision: 1, name: '客户会议' }, 'tags');
  const tagId = added.tags[0].id;
  const created = await store.create(input(added, { tags: [tagId] }));
  const disabled = await store.mutateCatalog({ baseRevision: 2, active: false }, 'tags', tagId);
  assert.equal(disabled.revision, 3);
  assert.deepEqual((await store.get(created.meeting.meeting_id))?.tags, [tagId]);
  await store.update(created.meeting.meeting_id, { baseRevision: 1, title: '标题更新' });
  await errorCode(() => store.update(created.meeting.meeting_id, { baseRevision: 2, tags: [tagId] }), 'INVALID_MEETING_TAG');
  await errorCode(() => store.updatePolicy(created.meeting.meeting_id, { baseRevision: 2, external_ai_authorized: true }), 'AI_NOT_SUPPORTED');
  assert.equal(catalog.tags.length, 0);
}));

test('Restricted creation rejects disallowed metadata instead of silently dropping it', async () => fixture(async (_root, store) => {
  const catalog = await store.getCatalog();
  await errorCode(() => store.create(input(catalog, { confidentiality: 'Restricted', description: 'secret' })), 'RESTRICTED_FIELDS');
  assert.equal((await store.list()).length, 0);
}));

test('record directory junctions are rejected before reads', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog();
  const meeting = await store.create(input(catalog)).then(x => x.meeting);
  const records = path.join(root, 'meetings', 'records'); const realRecords = path.join(root, 'meetings', 'real-records');
  await rename(records, realRecords);
  await symlink(realRecords, records, 'junction');
  await errorCode(() => store.get(meeting.meeting_id), 'MEETING_PATH_INVALID');
}));

test('HTTP contract returns detail capabilities, summary list, and stable error envelopes', async () => fixture(async (_root, store) => {
  const app = express(); app.use(express.json()); registerMeetingRoutes(app, store); app.use(meetingErrorMiddleware);
  const server = await new Promise<import('node:http').Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const catalog = await fetch(`${base}/api/meeting-catalog`).then(r => r.json()) as Awaited<ReturnType<MeetingStore['getCatalog']>>;
    const response = await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input(catalog)) });
    assert.equal(response.status, 201);
    const created = await response.json() as Record<string, unknown>;
    assert.equal(created.reused, false); assert.equal((created.capabilities as Record<string, unknown>).canImportMinutes, false);
    assert.equal('creation' in created, false);
    const list = await fetch(`${base}/api/meetings`).then(r => r.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(list.items.length, 1); assert.equal('imports' in list.items[0], false);
    const conflict = await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input(catalog, { title: 'different' })) });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json() as { error: { code: string } }).error.code, 'IDEMPOTENCY_CONFLICT');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));

test('backup includes meetings and accepts legacy archives without meetings', async () => fixture(async (root, store) => {
  const catalog = await store.getCatalog(); await store.create(input(catalog));
  const archive = `${root}.backup.json`; const restored = `${root}.restored`;
  const oldArchive = `${root}.legacy-backup.json`; const legacyRestore = `${root}.legacy-restored`;
  try {
    await exportWorkspace(root, archive);
    const result = await restoreWorkspace(archive, restored);
    assert.ok(result.files >= 2);
    const restoredStore = new MeetingStore(restored); await restoredStore.initialize();
    assert.equal((await restoredStore.list()).length, 1);

    const bytes = Buffer.from('{"legacy":true}\n');
    await writeFile(oldArchive, JSON.stringify({ format: 'fmcg-workspace-backup', version: 1, createdAt: '2026-10-11T00:00:00.000Z', files: [{ path: 'state/old.json', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }] }));
    const legacyResult = await restoreWorkspace(oldArchive, legacyRestore);
    assert.equal(legacyResult.files, 1);
    assert.equal(await readFile(path.join(legacyRestore, 'state', 'old.json'), 'utf8'), bytes.toString('utf8'));
  } finally {
    await Promise.all([archive, restored, oldArchive, legacyRestore].map(item => rm(item, { recursive: true, force: true })));
  }
}));

