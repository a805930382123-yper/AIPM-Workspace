import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { MeetingStore } from '../services/meeting/store.ts';
import { MeetingError } from '../services/meeting/errors.ts';
import { MeetingRawBridge } from '../services/meeting/raw-bridge.ts';
import { assertRawNotMeeting, SourcePolicyError } from '../services/meeting/source-policy.ts';
import { RawIntegrityError, RawStore, type MeetingRawRegistration } from '../services/raw/store.ts';
import { meetingErrorMiddleware, registerMeetingRoutes } from '../server/meeting-api.ts';
import { InputError, validateRaw } from '../server/validation.ts';
import { WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { ExtractionRunner } from '../services/llm/jobs.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import { AuditService } from '../services/audit/service.ts';

type Stores = {
  meetings: MeetingStore; bridge: MeetingRawBridge; raws: RawStore; wiki: WikiStore;
  workflows: KnowledgeWorkflowStore; prompts: PromptStore; promptAi: PromptAiService; audits: AuditService;
};

async function fixture<T>(work: (root: string, stores: Stores) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), '.m04-raw-test-'));
  const meetings = new MeetingStore(root);
  const raws = new RawStore(root);
  const wiki = new WikiStore(root, raws);
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  const prompts = new PromptStore(root, wiki);
  const promptAi = new PromptAiService(root, wiki, prompts, () => { throw new Error('provider must not be created'); });
  const audits = new AuditService(root, wiki, raws);
  const bridge = new MeetingRawBridge(meetings, raws);
  const stores: Stores = { meetings, bridge, raws, wiki, workflows, prompts, promptAi, audits };
  try {
    await Promise.all([
      meetings.initialize(), raws.initialize(), wiki.initialize(), workflows.initialize(),
      prompts.initialize(), promptAi.initialize(), audits.initialize(),
    ]);
    return await work(root, stores);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function prepareMeeting(stores: Stores, level: 'Public' | 'Internal' | 'Sensitive', text = '# M04 原件\n\n授权正文 保留换行。') {
  const catalog = await stores.meetings.getCatalog();
  const requestId = randomUUID();
  const created = await stores.meetings.create({
    requestId, title: 'M04 会议', meeting_date: '2026-10-12',
    meeting_type: catalog.types[0].id, confidentiality: level,
  });
  const id = created.meeting.meeting_id;
  const policy = level === 'Public'
    ? { baseRevision: 1, storage_mode: 'local_archive' as const, raw_transfer_authorized: true, confirm_raw_transfer: true }
    : level === 'Internal'
      ? { baseRevision: 1, storage_mode: 'local_archive' as const, local_storage_authorized: true, confirm_local_storage: true, raw_transfer_authorized: true, confirm_raw_transfer: true }
      : { baseRevision: 1, storage_mode: 'local_archive' as const, local_storage_authorized: true, confirm_local_storage: true };
  const meeting = await stores.meetings.updatePolicy(id, policy);
  if (!['Public', 'Internal'].includes(level)) return meeting;
  const imported = await stores.meetings.importMinutes(id, {
    baseRevision: meeting.revision, requestId: randomUUID(), text,
  });
  return imported.meeting;
}

const wikiInput = (type: WikiInput['type'], title: string, sources: string[] = []): WikiInput => ({
  title, type, category: 'industry_basics', sources, tags: [], aliases: [],
  knowledge_status: sources.length ? 'source_supported' : 'needs_verification',
  confidence: 'low', source_level: 'D', review_status: 'reviewed',
  body: '## 定义\n\n正式知识正文。',
});

const promptInput = (category: string, relatedWikiIds: string[] = []) => ({
  name: 'M04 Prompt', category, scenario: 'M04场景', body: '请基于授权资料执行。',
  inputRequirements: '', outputRequirements: '', relatedWikiIds, examples: '', tags: [], favorite: false,
});

test('M04 registers the selected original as immutable local-only Raw and retries idempotently', async () => fixture(async (root, stores) => {
  const original = '# M04 原件\n\n中文正文\r\n末行';
  const meeting = await prepareMeeting(stores, 'Public', original);
  const requestId = randomUUID();
  const result = await stores.bridge.register(meeting.meeting_id, {
    baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true,
  });
  assert.equal(result.reused, false);
  assert.equal(result.link.status, 'linked');
  assert.equal(result.link.import_id, meeting.active_import_id);
  const raw = await stores.raws.get(result.rawId);
  assert.ok(raw);
  assert.equal(raw.body, original);
  assert.equal(raw.bodySha256, createHash('sha256').update(original, 'utf8').digest('hex'));
  assert.equal(raw.sourceType, 'meeting');
  assert.deepEqual(raw.origin, {
    kind: 'meeting', meeting_id: meeting.meeting_id, import_id: meeting.active_import_id,
    original_sha256: result.link.original_sha256, registered_confidentiality: 'Public',
    processing_policy: 'meeting_local_only',
  });
  assert.equal(result.meeting.raw_source_id, result.rawId);

  const persisted = await new RawStore(root).get(result.rawId);
  assert.ok(persisted);
  assert.equal(persisted.body, original);
  assert.deepEqual(persisted.origin, raw.origin);
  const retry = await stores.bridge.register(meeting.meeting_id, {
    baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true,
  });
  assert.equal(retry.reused, true);
  assert.equal(retry.rawId, result.rawId);
  assert.equal(retry.link.status, 'linked');

  const conflict: MeetingRawRegistration = {
    id: result.rawId, title: raw.title, sourceName: raw.sourceName, tags: [...raw.tags],
    body: 'different-body', importedAt: raw.importedAt, origin: raw.origin!,
  };
  await assert.rejects(stores.raws.createMeetingRegistration(conflict), RawIntegrityError);
}));

test('linked replay verifies the persisted Raw and refuses missing or mismatched origins without recreating it', async () => fixture(async (_root, stores) => {
  const meeting = await prepareMeeting(stores, 'Public');
  const requestId = randomUUID();
  const result = await stores.bridge.register(meeting.meeting_id, { baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true });
  const originalGet = stores.raws.get.bind(stores.raws);
  stores.raws.get = async id => {
    const record = await originalGet(id);
    return record ? { ...record, origin: { ...record.origin!, meeting_id: randomUUID() } } : undefined;
  };
  await assert.rejects(stores.bridge.register(meeting.meeting_id, { baseRevision: result.meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'RAW_LINK_INTEGRITY_ERROR');
  stores.raws.get = async () => undefined;
  await assert.rejects(stores.bridge.register(meeting.meeting_id, { baseRevision: result.meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'RAW_LINK_INTEGRITY_ERROR');
  assert.equal((await stores.raws.list()).length, 1, 'linked replay must not recreate a missing Raw');
}));

test('deleting a Raw after pending or failed partial registration leaves readable raw_deleted history without fake registered time', async () => fixture(async (root, stores) => {
  const meeting = await prepareMeeting(stores, 'Public', 'pending source');
  const requestId = randomUUID();
  const originalSave = (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save.bind(stores.meetings);
  (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save = async value => {
    if (value.raw_links.some((link: { status: string }) => link.status === 'linked')) throw Object.assign(new Error('rename EIO'), { code: 'EIO' });
    await originalSave(value);
  };
  await assert.rejects(stores.bridge.register(meeting.meeting_id, { baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true }));
  (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save = originalSave;
  const pending = await stores.meetings.get(meeting.meeting_id);
  assert.equal(pending?.raw_links[0]?.status, 'pending');
  const pendingRawId = pending!.raw_links[0]!.raw_id;
  assert.ok(await stores.raws.get(pendingRawId));
  await stores.raws.delete(pendingRawId);
  await stores.bridge.deleteRaw(pendingRawId);
  const afterDelete = await stores.meetings.get(meeting.meeting_id);
  assert.equal(afterDelete?.raw_links[0]?.status, 'raw_deleted');
  assert.equal(afterDelete?.raw_links[0]?.registered_at, undefined);
  const restarted = new MeetingStore(root); await restarted.initialize();
  assert.equal((await restarted.get(meeting.meeting_id))?.raw_links[0]?.status, 'raw_deleted');
  assert.equal((await restarted.list()).length, 1);
  assert.equal(await stores.raws.get(pendingRawId), undefined);

  const failedMeeting = await prepareMeeting(stores, 'Public', 'failed source');
  const failedRequest = randomUUID();
  const originalCreate = stores.raws.createMeetingRegistration.bind(stores.raws);
  let wroteThenFailed = false;
  stores.raws.createMeetingRegistration = async input => {
    const created = await originalCreate(input);
    if (!wroteThenFailed) { wroteThenFailed = true; throw Object.assign(new Error('post-write EIO'), { code: 'EIO' }); }
    return created;
  };
  await assert.rejects(stores.bridge.register(failedMeeting.meeting_id, { baseRevision: failedMeeting.revision, requestId: failedRequest, import_id: failedMeeting.active_import_id!, confirm: true }));
  const failed = await stores.meetings.get(failedMeeting.meeting_id);
  assert.equal(failed?.raw_links[0]?.status, 'failed');
  const failedRawId = failed!.raw_links[0]!.raw_id;
  assert.ok(await stores.raws.get(failedRawId));
  await stores.raws.delete(failedRawId);
  await stores.bridge.deleteRaw(failedRawId);
  const failedDeleted = await stores.meetings.get(failedMeeting.meeting_id);
  assert.equal(failedDeleted?.raw_links[0]?.status, 'raw_deleted');
  assert.equal(failedDeleted?.raw_links[0]?.registered_at, undefined);
  assert.equal(await stores.raws.get(failedRawId), undefined);
}));

test('interrupted pending registration resumes without creating a duplicate Raw', async () => fixture(async (_root, stores) => {
  const meeting = await prepareMeeting(stores, 'Internal', 'Internal original');
  const requestId = randomUUID();
  const input = { baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true };
  const begun = await stores.meetings.beginRawRegistration(meeting.meeting_id, input);
  assert.equal(begun.link.status, 'pending');
  const recovery = await stores.bridge.reconcile();
  assert.deepEqual(recovery.resumed, [begun.link.raw_id]);
  const after = await stores.meetings.get(meeting.meeting_id);
  assert.equal(after?.raw_links[0]?.status, 'linked');
  assert.equal((await stores.raws.list()).length, 1);
}));

test('Sensitive and Restricted are denied, forged fields fail, and ordinary Raw API cannot create Meeting Raw', async () => fixture(async (_root, stores) => {
  const sensitive = await prepareMeeting(stores, 'Sensitive');
  await assert.rejects(stores.bridge.register(sensitive.meeting_id, {
    baseRevision: sensitive.revision, requestId: randomUUID(), import_id: sensitive.active_import_id ?? randomUUID(), confirm: true,
  }), (error: unknown) => error instanceof MeetingError && error.code === 'RAW_NOT_AUTHORIZED');

  const catalog = await stores.meetings.getCatalog();
  const restricted = await stores.meetings.create({
    requestId: randomUUID(), title: '受限会议', meeting_date: '2026-10-12',
    meeting_type: catalog.types[0].id, confidentiality: 'Restricted',
  });
  await assert.rejects(stores.bridge.register(restricted.meeting.meeting_id, {
    baseRevision: 1, requestId: randomUUID(), import_id: randomUUID(), confirm: true,
  }), (error: unknown) => error instanceof MeetingError && error.code === 'RAW_NOT_AUTHORIZED');

  assert.throws(() => validateRaw({
    title: 'ordinary', sourceType: 'other', sourceName: 'source', tags: [], body: 'body',
    origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '0'.repeat(64), registered_confidentiality: 'Public', processing_policy: 'meeting_local_only' },
  }), (error: unknown) => error instanceof InputError && error.code === 'MEETING_ORIGIN_FORBIDDEN');
  assert.equal(validateRaw({ title: 'ordinary', sourceType: 'meeting', sourceName: 'source', tags: [], body: 'body' }).sourceType, 'meeting');
  assert.throws(() => validateRaw({ title: 'ordinary', sourceType: 'meeting', sourceName: 'source', tags: [], body: 'body', id: randomUUID() }),
    (error: unknown) => error instanceof InputError && error.code === 'SYSTEM_FIELD_FORBIDDEN');
}));

test('active Raw projection follows the active imported version and clear preserves every Raw link', async () => fixture(async (root, stores) => {
  const first = await prepareMeeting(stores, 'Public', 'first original');
  const registered = await stores.bridge.register(first.meeting_id, { baseRevision: first.revision, requestId: randomUUID(), import_id: first.active_import_id!, confirm: true });
  assert.equal(registered.meeting.raw_source_id, registered.rawId);
  const second = await stores.meetings.importMinutes(first.meeting_id, { baseRevision: registered.meeting.revision, requestId: randomUUID(), text: 'second original', confirmReimport: true });
  assert.equal(second.meeting.raw_source_id, null);
  assert.equal(second.meeting.raw_links[0]?.raw_id, registered.rawId);
  assert.equal((await stores.raws.get(registered.rawId))?.body, 'first original');
  const cleared = await stores.meetings.clearMinutes(first.meeting_id, { baseRevision: second.meeting.revision, confirm: true });
  assert.equal(cleared.imports.length, 0);
  assert.equal(cleared.active_import_id, null);
  assert.equal(cleared.raw_source_id, null);
  assert.equal(cleared.raw_links[0]?.status, 'linked');
  const restarted = new MeetingStore(root); await restarted.initialize();
  assert.equal((await restarted.get(first.meeting_id))?.raw_links[0]?.raw_id, registered.rawId);
  assert.equal((await stores.raws.get(registered.rawId))?.origin?.processing_policy, 'meeting_local_only');
}));

test('derived Raw metadata stays within schema for legal 195, 196, and 200 character titles', async () => fixture(async (_root, stores) => {
  for (const length of [195, 196, 200]) {
    const catalog = await stores.meetings.getCatalog();
    const created = await stores.meetings.create({ requestId: randomUUID(), title: '会'.repeat(length), meeting_date: '2026-10-12', meeting_type: catalog.types[0].id, confidentiality: 'Public' });
    const policy = await stores.meetings.updatePolicy(created.meeting.meeting_id, { baseRevision: 1, storage_mode: 'local_archive', raw_transfer_authorized: true, confirm_raw_transfer: true });
    const imported = await stores.meetings.importMinutes(created.meeting.meeting_id, { baseRevision: policy.revision, requestId: randomUUID(), text: 'original' });
    const result = await stores.bridge.register(created.meeting.meeting_id, { baseRevision: imported.meeting.revision, requestId: randomUUID(), import_id: imported.meeting.active_import_id!, confirm: true });
    assert.ok((await stores.meetings.get(created.meeting.meeting_id)));
    assert.equal((await stores.raws.get(result.rawId))?.title.length, 200);
  }
}));

test('same registration retry tolerates a newer revision while retaining the fixed ID', async () => fixture(async (_root, stores) => {
  const meeting = await prepareMeeting(stores, 'Public');
  const requestId = randomUUID();
  const result = await stores.bridge.register(meeting.meeting_id, { baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true });
  assert.equal(result.link.request_fingerprint_version, 2);
  const save = (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save.bind(stores.meetings);
  await save({ ...result.meeting, raw_links: result.meeting.raw_links.map(link => ({ ...link, request_fingerprint: '0'.repeat(64) })) });
  await assert.rejects(stores.bridge.register(meeting.meeting_id, { baseRevision: result.meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'IDEMPOTENCY_CONFLICT');
  const tampered = await stores.meetings.get(meeting.meeting_id);
  await save({ ...tampered!, raw_links: tampered!.raw_links.map(link => ({ ...link, request_fingerprint: result.link.request_fingerprint })) });
  const retry = await stores.bridge.register(meeting.meeting_id, { baseRevision: result.meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true });
  assert.equal(retry.rawId, result.rawId);
  assert.equal(retry.reused, true);
}));

test('legacy high-revision receipt retries by durable business identity, while inputs, authorization, source digest, and Raw are rechecked', async () => fixture(async (_root, stores) => {
  const prepared = await prepareMeeting(stores, 'Public', 'legacy high revision source');
  const requestId = randomUUID();
  const highRevision = { ...prepared, revision: 10001 };
  await (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save(highRevision);
  const originalCreate = stores.raws.createMeetingRegistration.bind(stores.raws);
  let wroteThenFailed = false;
  stores.raws.createMeetingRegistration = async input => {
    const result = await originalCreate(input);
    if (!wroteThenFailed) { wroteThenFailed = true; throw Object.assign(new Error('EIO'), { code: 'EIO' }); }
    return result;
  };
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10001, requestId, import_id: prepared.active_import_id!, confirm: true }));
  let current = await stores.meetings.get(prepared.meeting_id);
  assert.equal(current?.revision, 10002);
  assert.equal(current?.raw_links[0]?.status, 'failed');

  const legacyFingerprint = createHash('sha256').update(JSON.stringify({ baseRevision: 10001, confirm: true, import_id: prepared.active_import_id })).digest('hex');
  const legacy = { ...current!, raw_links: current!.raw_links.map(link => { const copy = { ...link, request_fingerprint: legacyFingerprint }; delete copy.request_fingerprint_version; return copy; }) };
  await (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save(legacy);
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: randomUUID(), confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: prepared.active_import_id!, confirm: false }),
    (error: unknown) => error instanceof MeetingError && error.code === 'CONFIRMATION_REQUIRED');

  current = await stores.meetings.get(prepared.meeting_id);
  await (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save({ ...current!, raw_transfer_authorized: false });
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: prepared.active_import_id!, confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'RAW_NOT_AUTHORIZED');
  current = await stores.meetings.get(prepared.meeting_id);
  await (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save({ ...current!, raw_transfer_authorized: true, raw_links: current!.raw_links.map(link => ({ ...link, original_sha256: '0'.repeat(64) })) });
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: prepared.active_import_id!, confirm: true }),
    (error: unknown) => error instanceof MeetingError && error.code === 'CORRUPT_MEETING');

  current = await stores.meetings.get(prepared.meeting_id);
  const originalSha = createHash('sha256').update('legacy high revision source', 'utf8').digest('hex');
  await (stores.meetings as unknown as { save: (value: any) => Promise<void> }).save({ ...current!, raw_links: current!.raw_links.map(link => ({ ...link, original_sha256: originalSha })) });
  const originalGet = stores.raws.get.bind(stores.raws);
  stores.raws.get = async id => { const raw = await originalGet(id); return raw ? { ...raw, origin: { ...raw.origin!, import_id: randomUUID() } } : undefined; };
  await assert.rejects(stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: prepared.active_import_id!, confirm: true }), RawIntegrityError);
  stores.raws.get = originalGet;
  const result = await stores.bridge.register(prepared.meeting_id, { baseRevision: 10002, requestId, import_id: prepared.active_import_id!, confirm: true });
  assert.equal(result.reused, true);
  assert.equal(result.link.status, 'linked');
  assert.equal((await stores.raws.list()).length, 1);
}));

test('failed bridge retry uses the same fixed Raw ID after meeting metadata changes', async () => fixture(async (_root, stores) => {
  const meeting = await prepareMeeting(stores, 'Public');
  const requestId = randomUUID();
  const originalWrite = stores.raws.createMeetingRegistration.bind(stores.raws);
  let injected = false;
  stores.raws.createMeetingRegistration = async input => {
    if (!injected) { injected = true; throw Object.assign(new Error('injected EIO'), { code: 'EIO' }); }
    return originalWrite(input);
  };
  await assert.rejects(stores.bridge.register(meeting.meeting_id, { baseRevision: meeting.revision, requestId, import_id: meeting.active_import_id!, confirm: true }));
  const failedMeeting = await stores.meetings.get(meeting.meeting_id);
  assert.equal(failedMeeting?.raw_links[0]?.status, 'failed');
  const changed = await stores.meetings.update(meeting.meeting_id, { baseRevision: failedMeeting!.revision, description: '补充说明' });
  const result = await stores.bridge.register(meeting.meeting_id, { baseRevision: changed.revision, requestId, import_id: meeting.active_import_id!, confirm: true });
  assert.equal(result.rawId, failedMeeting?.raw_links[0]?.raw_id);
  assert.equal(result.link.status, 'linked');
  assert.equal((await stores.raws.list()).length, 1);
}));

test('missing source records fail closed for explicit Wiki source links and shared policy checks', async () => fixture(async (_root, stores) => {
  assert.throws(() => assertRawNotMeeting(undefined), SourcePolicyError);
  const raw = await stores.raws.create(validateRaw({ title: 'legacy', sourceType: 'meeting', sourceName: 'old meeting', tags: [], body: 'old body' }));
  const page = await stores.wiki.create(wikiInput('source', 'legacy source', [raw.id]));
  await stores.raws.delete(raw.id);
  await assert.rejects(stores.wiki.update(page.id, page.revision, wikiInput('source', 'washed source', [])), SourcePolicyError);
}));

test('meeting registration HTTP contract enforces exact fields and stable errors', async () => fixture(async (_root, stores) => {
  const app = express();
  app.use(express.json());
  registerMeetingRoutes(app, stores.meetings, stores.bridge);
  app.use(meetingErrorMiddleware);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof InputError) res.status(error.status).json({ error: { code: error.code, message: error.message } });
    else res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  });
  const server = await new Promise<import('node:http').Server>(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    let meeting = await prepareMeeting(stores, 'Public');
    const bytes = Buffer.from('上传的原件');
    meeting = (await stores.meetings.importMinutes(meeting.meeting_id, {
      baseRevision: meeting.revision, requestId: randomUUID(), text: bytes.toString(), confirmReimport: true,
      original_filename: 'minutes.txt', file_sha256: createHash('sha256').update(bytes).digest('hex'),
      file_base64: bytes.toString('base64'), file_format: 'txt',
    })).meeting;
    const forged = await fetch(`${base}/api/meetings/${meeting.meeting_id}/raw-links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: meeting.revision, requestId: randomUUID(), import_id: meeting.active_import_id, confirm: true, origin: { kind: 'meeting' } }),
    });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json() as { error: { code: string } }).error.code, 'INVALID_BODY');
    const response = await fetch(`${base}/api/meetings/${meeting.meeting_id}/raw-links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: meeting.revision, requestId: randomUUID(), import_id: meeting.active_import_id, confirm: true }),
    });
    assert.equal(response.status, 201);
    const detail = await response.json() as { revision: number; raw_id: string; reused: boolean; imports: Array<{file_base64?: string}>; raw_links: Array<{ status: string }> };
    assert.equal(detail.reused, false);
    assert.equal(detail.raw_links[0]?.status, 'linked');
    assert.ok(await stores.raws.get(detail.raw_id));
    assert.ok(detail.imports.every(item => !('file_base64' in item)));
    const unlink = await fetch(`${base}/api/meetings/${meeting.meeting_id}/raw-links/${detail.raw_id}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: detail.revision, confirm: true }),
    });
    assert.equal(unlink.status, 200);
    const unlinked = await unlink.json() as { imports: Array<{file_base64?: string}> };
    assert.ok(unlinked.imports.every(item => !('file_base64' in item)));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}));

test('all old AI/Wiki/Prompt/Audit entrypoints deny Meeting Raw before providers or writes', async () => fixture(async (_root, stores) => {
  const normal = await stores.raws.create(validateRaw({
    title: '原有资料', sourceType: 'other', sourceName: '来源', tags: [], body: '普通原始正文。',
  }));
  const page = await stores.wiki.create(wikiInput('source', '原有来源', [normal.id]));
  const category = (await stores.prompts.schema()).categories[0].id;
  const prompt = await stores.prompts.create(randomUUID(), promptInput(category, [page.id]));
  const audit = await stores.audits.create({ wikiId: page.id, scope: 'page', severity: 'suggestion', comment: '改善事实边界' });

  await stores.raws.delete(normal.id);
  const meetingRaw: MeetingRawRegistration = {
    id: normal.id, title: normal.title, sourceName: normal.sourceName, tags: [...normal.tags],
    body: normal.body, importedAt: normal.importedAt,
    origin: {
      kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(),
      original_sha256: createHash('sha256').update(normal.body, 'utf8').digest('hex'),
      registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only',
    },
  };
  await stores.raws.createMeetingRegistration(meetingRaw);
  const other = await stores.raws.create(validateRaw({
    title: '另一条', sourceType: 'other', sourceName: '来源乙', tags: [], body: '另一条普通正文。',
  }));

  let providerCalls = 0;
  const provider = {
    name: 'sentinel', model: 'sentinel', secrets: [] as string[],
    complete: async () => { providerCalls++; throw new Error('provider must not be called'); },
  };
  await assert.rejects(stores.wiki.update(page.id, page.revision, wikiInput('source', '改写受限来源', [normal.id])), SourcePolicyError);
  await assert.rejects(stores.prompts.create(randomUUID(), promptInput(category, [page.id])), SourcePolicyError);
  await assert.rejects(stores.prompts.update(prompt.prompt.id, prompt.prompt.version, promptInput(category, [])), SourcePolicyError);
  await assert.rejects(stores.promptAi.generate({
    taskName: 'M04', taskType: 'custom', role: 'PM', goal: 'goal', context: 'context',
    input: 'input', tasks: 'tasks', constraints: 'constraints', output: 'output',
  }, [page.id]), SourcePolicyError);
  await assert.rejects(stores.workflows.createSynthesis({ rawIds: [normal.id, other.id], provider: provider as never }), SourcePolicyError);
  const runner = new ExtractionRunner({
    root: _root, llm: {} as never, jobs: {} as never, drafts: {} as never, rawStates: {} as never,
    rawStore: stores.raws, provider: () => provider as never,
    draftRules: async () => ({ types: [], categories: [], knowledge_status: [], confidence: [], source_level: [], review_status: [] }),
    rulesDir: path.join('rules'),
  });
  await assert.rejects(runner.start(normal.id, { newJobId: randomUUID(), now: new Date().toISOString() }), SourcePolicyError);
  await assert.rejects(stores.audits.propose(audit.id, provider as never), SourcePolicyError);
  assert.equal(providerCalls, 0);
  const retained = await stores.prompts.get(prompt.prompt.id);
  assert.equal(retained?.relatedWikiIds.length, 1);
}));
