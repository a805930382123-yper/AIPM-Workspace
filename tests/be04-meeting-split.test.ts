import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { MeetingError } from '../services/meeting/errors.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { saveMeetingRecord, type MeetingStorePaths } from '../services/meeting/meeting-catalog.ts';
import {
  canonical,
  digest,
  hasControlChar,
  hasDisallowedDescriptionControlChar,
  MAX_MEETING_JSON_BYTES,
  minuteDigest,
  toMeetingSummary,
  validMeeting,
  validMinute,
} from '../services/meeting/meeting-validators.ts';
import type { RawRecord } from '../services/raw/store.ts';

async function fixture(work: (root: string, store: MeetingStore) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-be04-'));
  try {
    const store = new MeetingStore(root);
    await store.initialize();
    await work(root, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function createMeeting(store: MeetingStore) {
  return (
    await store.create({
      requestId: randomUUID(),
      title: 'BE04 合成会议',
      meeting_date: '2026-11-28',
      meeting_type: (await store.getCatalog()).types[0].id,
      confidentiality: 'Public',
    })
  ).meeting;
}
const rejectsCode = (work: () => Promise<unknown>, code: string, status?: number) =>
  assert.rejects(
    work,
    (error: unknown) =>
      error instanceof MeetingError && error.code === code && (status === undefined || error.status === status),
  );

test('BE04 facade exports only MeetingStore and retains the exact public method surface', async () => {
  assert.deepEqual(Object.keys(await import('../services/meeting/store.ts')), ['MeetingStore']);
  const source = await readFile(path.join(import.meta.dirname, '../services/meeting/store.ts'), 'utf8');
  const ast = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(ts.isClassDeclaration)!;
  const publicMethods = cls.members
    .filter(ts.isMethodDeclaration)
    .filter((node) => !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword));
  assert.deepEqual(
    publicMethods.map((node) => node.name.getText(ast)).sort(),
    [
      'initialize',
      'getCatalog',
      'get',
      'allDetailed',
      'list',
      'create',
      'update',
      'updatePolicy',
      'importMinutes',
      'updateEditableMinutes',
      'clearMinutes',
      'beginRawRegistration',
      'settleRawRegistration',
      'unlinkRaw',
      'markRawDeleted',
      'delete',
      'mutateCatalog',
    ].sort(),
  );
  assert(
    !ast.statements.some(
      (node) =>
        ts.isExportDeclaration(node) ||
        (ts.isTypeAliasDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
    ),
  );
  const root = cls.members.find(ts.isConstructorDeclaration)!.parameters[0];
  assert.equal(root.name.getText(ast), 'root');
  assert(root.modifiers?.some((m) => m.kind === ts.SyntaxKind.PublicKeyword));
  assert(root.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword));
});

test('BE04 LF bounded modules obey every allowed DAG edge and external dependency including type edges', async () => {
  const domain = ['meeting-policy.ts', 'meeting-minutes.ts', 'meeting-raw-links.ts'];
  const files = ['store.ts', 'meeting-validators.ts', 'meeting-catalog.ts', ...domain];
  const allowed: Record<string, string[]> = {
    'store.ts': files.filter((name) => name !== 'store.ts'),
    'meeting-validators.ts': [],
    'meeting-catalog.ts': ['meeting-validators.ts'],
    ...Object.fromEntries(domain.map((name) => [name, ['meeting-validators.ts', 'meeting-catalog.ts']])),
  };
  const external: Record<string, string[]> = {
    'store.ts': [
      'node:crypto',
      'node:fs/promises',
      'node:path',
      '../storage/files.ts',
      './errors.ts',
      './policy.ts',
      './types.ts',
      '../raw/store.ts',
    ],
    'meeting-validators.ts': ['node:crypto', './errors.ts', './policy.ts', './types.ts'],
    'meeting-catalog.ts': [
      'node:crypto',
      'node:fs/promises',
      'node:path',
      '../storage/files.ts',
      './errors.ts',
      './policy.ts',
      './types.ts',
    ],
    'meeting-policy.ts': ['./errors.ts', './policy.ts', './types.ts'],
    'meeting-minutes.ts': ['node:crypto', './errors.ts', './policy.ts', './types.ts'],
    'meeting-raw-links.ts': ['node:crypto', './errors.ts', './policy.ts', './types.ts', '../raw/store.ts'],
  };
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await readFile(path.join(import.meta.dirname, '../services/meeting', file), 'utf8');
    assert(!source.includes('\r'), `${file}: LF`);
    assert(Buffer.byteLength(source) < 40_960, `${file}: bytes`);
    assert(source.split('\n').length < 800, `${file}: lines`);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const edges: string[] = [];
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const dependency = specifier.text;
      const internal = dependency.startsWith('./') && files.includes(dependency.slice(2));
      assert(
        (internal ? allowed[file] : external[file]).includes(internal ? dependency.slice(2) : dependency),
        `${file} -> ${dependency}`,
      );
      if (internal) edges.push(dependency.slice(2));
      if (dependency === '../raw/store.ts') {
        assert(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly, 'RawRecord must be a pure type edge');
        assert.equal(node.importClause.namedBindings?.getText(ast), '{ RawRecord }');
      }
    }
    graph.set(file, edges);
  }
  const visited = new Set<string>();
  const visit = (file: string, ancestors: string[]) => {
    assert(!ancestors.includes(file), `cycle: ${[...ancestors, file].join(' -> ')}`);
    if (visited.has(file)) return;
    for (const edge of graph.get(file)!) visit(edge, [...ancestors, file]);
    visited.add(file);
  };
  visit('store.ts', []);
  assert.equal(visited.size, 6);
});

test('BE04 control helpers preserve the entire ASCII truth table and description whitespace', () => {
  for (let code = 0; code < 128; code++) {
    const text = `before${String.fromCharCode(code)}after`;
    assert.equal(hasControlChar(text), code <= 31 || code === 127, `text ASCII ${code}`);
    assert.equal(
      hasDisallowedDescriptionControlChar(text),
      (code <= 31 && ![9, 10, 13].includes(code)) || code === 127,
      `description ASCII ${code}`,
    );
  }
  assert.equal(hasControlChar('中文😀'), false);
  assert.equal(hasDisallowedDescriptionControlChar('中文\t\n\r😀'), false);
});

test('BE04 canonical digests, minute fingerprint, summaries and legacy schema remain equivalent', async () =>
  fixture(async (root, store) => {
    assert.equal(canonical({ z: [3, { b: 2, a: 1 }], a: null }), '{"a":null,"z":[3,{"a":1,"b":2}]}');
    assert.equal(digest({ b: 2, a: 1 }), createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
    const meeting = await createMeeting(store);
    const omitted = ['imports', 'active_import_id', 'minute_requests', 'raw_links', 'raw_source_id', 'creation'];
    assert.deepEqual(
      Object.keys(toMeetingSummary(meeting)).sort(),
      Object.keys(meeting)
        .filter((key) => !omitted.includes(key))
        .sort(),
    );
    assert.deepEqual((await store.list())[0], toMeetingSummary(meeting));
    assert(validMeeting(meeting, meeting.meeting_id));
    const legacy: Partial<typeof meeting> = structuredClone(meeting);
    delete legacy.minute_requests;
    assert(validMeeting(legacy, meeting.meeting_id));
    await writeFile(path.join(root, 'meetings', 'records', `${meeting.meeting_id}.json`), JSON.stringify(legacy));
    assert.deepEqual((await store.get(meeting.meeting_id))!.minute_requests, []);
    const detached = (await store.get(meeting.meeting_id))!;
    detached.title = '外部修改';
    assert.equal((await store.get(meeting.meeting_id))!.title, meeting.title);
    const local = await store.updatePolicy(meeting.meeting_id, { baseRevision: 1, storage_mode: 'local_archive' });
    const imported = await store.importMinutes(meeting.meeting_id, {
      baseRevision: local.revision,
      requestId: randomUUID(),
      text: '原始纪要',
    });
    assert.equal(
      minuteDigest(imported.imported),
      digest({ text: '原始纪要', original_filename: null, file_sha256: null }),
    );
    const legacyWithImports: Partial<typeof meeting> = structuredClone(imported.meeting);
    delete legacyWithImports.minute_requests;
    assert.equal(validMeeting(legacyWithImports, meeting.meeting_id), false);
    const cleared = await store.clearMinutes(meeting.meeting_id, {
      baseRevision: imported.meeting.revision,
      confirm: true,
    });
    assert.equal(cleared.minute_requests[0].deleted, true);
    assert(validMeeting(cleared, meeting.meeting_id));
  }));

test('BE04 filenames reject both separators and control characters at import and stored validation', async () =>
  fixture(async (_root, store) => {
    const initial = await createMeeting(store);
    const local = await store.updatePolicy(initial.meeting_id, { baseRevision: 1, storage_mode: 'local_archive' });
    const imported = await store.importMinutes(initial.meeting_id, {
      baseRevision: local.revision,
      requestId: randomUUID(),
      text: '纪要',
      original_filename: 'minutes.txt',
    });
    assert(validMinute(imported.imported));
    for (const filename of ['path/minutes.txt', 'path\\minutes.txt', 'bad\x00.txt', 'bad\x7f.txt']) {
      assert.equal(validMinute({ ...imported.imported, original_filename: filename }), false, filename);
      await rejectsCode(
        () =>
          store.importMinutes(initial.meeting_id, {
            baseRevision: imported.meeting.revision,
            requestId: randomUUID(),
            text: '纪要',
            original_filename: filename,
          }),
        'INVALID_FILENAME',
        415,
      );
    }
  }));

test('BE04 one instance serializes concurrent create/update/policy calls and continues after conflict', async () =>
  fixture(async (_root, store) => {
    const input = {
      requestId: randomUUID(),
      title: '并发会议',
      meeting_date: '2026-11-28',
      meeting_type: (await store.getCatalog()).types[0].id,
      confidentiality: 'Public',
    };
    const created = await Promise.all([store.create(input), store.create(input)]);
    assert.deepEqual(
      created.map((item) => item.reused),
      [false, true],
    );
    const id = created[0].meeting.meeting_id;
    const results = await Promise.allSettled(['甲', '乙'].map((title) => store.update(id, { baseRevision: 1, title })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = results.find((item) => item.status === 'rejected')!;
    assert(rejected.reason instanceof MeetingError);
    assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
    assert.equal(rejected.reason.status, 409);
    const policies = await Promise.allSettled([
      store.updatePolicy(id, { baseRevision: 2, storage_mode: 'local_archive' }),
      store.updatePolicy(id, { baseRevision: 2, storage_mode: 'local_archive' }),
    ]);
    assert.equal(policies.filter((item) => item.status === 'fulfilled').length, 1);
    const policyRejected = policies.find((item) => item.status === 'rejected')!;
    assert(policyRejected.reason instanceof MeetingError && policyRejected.reason.code === 'REVISION_CONFLICT');
    assert.equal((await store.update(id, { baseRevision: 3, title: '队列续跑' })).revision, 4);
  }));

test('BE04 directory junctions cannot escape the isolated root and missing catalog cannot overwrite records', async () =>
  fixture(async (root, store) => {
    const target = path.join(root, 'outside');
    await mkdir(target);
    const nestedRoot = path.join(root, 'linked');
    await mkdir(nestedRoot);
    await symlink(target, path.join(nestedRoot, 'meetings'), 'junction');
    await rejectsCode(() => new MeetingStore(nestedRoot).initialize(), 'MEETING_PATH_INVALID', 409);
    assert.deepEqual(await import('node:fs/promises').then((fs) => fs.readdir(target)), []);
    const meeting = await createMeeting(store);
    await unlink(path.join(root, 'meetings', 'catalog.json'));
    await rejectsCode(() => store.getCatalog(), 'CORRUPT_MEETING_CATALOG', 409);
    const record = JSON.parse(
      await readFile(path.join(root, 'meetings', 'records', `${meeting.meeting_id}.json`), 'utf8'),
    );
    assert.equal(record.meeting_id, meeting.meeting_id);
  }));

test('BE04 formatted 32 MiB save limit runs before path inspection', async () =>
  fixture(async (root, store) => {
    const meeting = await createMeeting(store);
    const missing = path.join(root, 'missing');
    const paths: MeetingStorePaths = {
      root: missing,
      base: missing,
      records: missing,
      catalogFile: path.join(missing, 'catalog.json'),
    };
    const oversized = { ...meeting, title: 'x'.repeat(MAX_MEETING_JSON_BYTES) };
    assert(Buffer.byteLength(`${JSON.stringify(oversized, null, 2)}\n`, 'utf8') > MAX_MEETING_JSON_BYTES);
    await rejectsCode(() => saveMeetingRecord(paths, oversized), 'MEETING_JSON_TOO_LARGE', 413);
  }));

test('BE04 Raw settlement keeps failure revision, all four integrity guards and linked replay behavior', async () =>
  fixture(async (root, store) => {
    const initial = await createMeeting(store);
    const local = await store.updatePolicy(initial.meeting_id, {
      baseRevision: 1,
      storage_mode: 'local_archive',
      raw_transfer_authorized: true,
      confirm_raw_transfer: true,
    });
    const minutes = await store.importMinutes(initial.meeting_id, {
      baseRevision: local.revision,
      requestId: randomUUID(),
      text: '不可改写的原件',
    });
    const requestId = randomUUID();
    const started = await store.beginRawRegistration(initial.meeting_id, {
      baseRevision: minutes.meeting.revision,
      requestId,
      import_id: minutes.imported.import_id,
      confirm: true,
    });
    assert.equal(started.link.request_fingerprint_version, 2);
    assert.equal(
      (
        await store.beginRawRegistration(initial.meeting_id, {
          baseRevision: 1,
          requestId,
          import_id: minutes.imported.import_id,
          confirm: true,
        })
      ).reused,
      true,
    );
    const failure = new MeetingError('SYNTHETIC_FAILURE', '合成故障', 500);
    await assert.rejects(
      () =>
        store.settleRawRegistration(initial.meeting_id, requestId, async () => {
          throw failure;
        }),
      (error: unknown) => error === failure,
    );
    const failed = (await store.get(initial.meeting_id))!;
    assert.equal(failed.revision, started.meeting.revision);
    assert.equal(failed.raw_links[0].error?.code, 'SYNTHETIC_FAILURE');
    assert.equal(failed.raw_links[0].status, 'failed');
    const raw: RawRecord = {
      id: started.link.raw_id,
      title: '合成 Raw',
      sourceType: 'meeting',
      sourceName: '合成测试',
      tags: [],
      body: minutes.imported.imported_minutes,
      bodySha256: minutes.imported.original_sha256,
      importedAt: new Date().toISOString(),
      status: 'unprocessed',
      origin: {
        kind: 'meeting',
        meeting_id: initial.meeting_id,
        import_id: minutes.imported.import_id,
        original_sha256: minutes.imported.original_sha256,
        registered_confidentiality: 'Public',
        processing_policy: 'meeting_local_only',
      },
    };
    const invalid = [
      { ...raw, origin: { ...raw.origin!, meeting_id: randomUUID() } },
      { ...raw, origin: { ...raw.origin!, import_id: randomUUID() } },
      { ...raw, body: '改写' },
      { ...raw, bodySha256: '0'.repeat(64) },
    ];
    for (const record of invalid)
      await rejectsCode(
        () => store.settleRawRegistration(initial.meeting_id, requestId, async () => ({ record, created: true })),
        'RAW_INTEGRITY_ERROR',
        409,
      );
    const linked = await store.settleRawRegistration(initial.meeting_id, requestId, async () => ({
      record: raw,
      created: true,
    }));
    assert.equal(linked.meeting.raw_source_id, raw.id);
    const replay = await store.settleRawRegistration(initial.meeting_id, requestId, async () => ({
      record: invalid[2],
      created: false,
    }));
    assert.deepEqual(replay.meeting, await store.get(initial.meeting_id));
    assert.equal(replay.meeting.revision, linked.meeting.revision);
    assert.equal(replay.raw.body, '改写');
    const before = await readFile(path.join(root, 'meetings', 'records', `${initial.meeting_id}.json`), 'utf8');
    await assert.rejects(
      () =>
        store.settleRawRegistration(initial.meeting_id, requestId, async () => {
          throw failure;
        }),
      (error: unknown) => error === failure,
    );
    assert.equal(await readFile(path.join(root, 'meetings', 'records', `${initial.meeting_id}.json`), 'utf8'), before);
    const legacy = structuredClone(linked.meeting);
    delete legacy.raw_links[0].request_fingerprint_version;
    legacy.raw_links[0].request_fingerprint = digest({
      baseRevision: 400,
      import_id: minutes.imported.import_id,
      confirm: true,
    });
    await writeFile(path.join(root, 'meetings', 'records', `${initial.meeting_id}.json`), JSON.stringify(legacy));
    assert.equal(
      (
        await store.beginRawRegistration(initial.meeting_id, {
          baseRevision: 1,
          requestId,
          import_id: minutes.imported.import_id,
          confirm: true,
        })
      ).reused,
      true,
    );
  }));

test('BE04 serialization retains the entire awaited Raw callback before the next update reads revision', async () =>
  fixture(async (_root, store) => {
    const initial = await createMeeting(store);
    const local = await store.updatePolicy(initial.meeting_id, {
      baseRevision: 1,
      storage_mode: 'local_archive',
      raw_transfer_authorized: true,
      confirm_raw_transfer: true,
    });
    const minutes = await store.importMinutes(initial.meeting_id, {
      baseRevision: local.revision,
      requestId: randomUUID(),
      text: '队列原件',
    });
    const requestId = randomUUID();
    const started = await store.beginRawRegistration(initial.meeting_id, {
      baseRevision: minutes.meeting.revision,
      requestId,
      import_id: minutes.imported.import_id,
      confirm: true,
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentinel = new Error('合成写入失败');
    let callbackFinished = false;
    const settle = store.settleRawRegistration(initial.meeting_id, requestId, async () => {
      enter();
      await waiting;
      callbackFinished = true;
      throw sentinel;
    });
    const rejected = assert.rejects(
      () => settle,
      (error: unknown) => error === sentinel,
    );
    await entered;
    const update = store
      .update(initial.meeting_id, { baseRevision: started.meeting.revision, title: '后续更新' })
      .then((value) => {
        assert(callbackFinished);
        return value;
      });
    release();
    await rejected;
    assert.equal((await update).revision, started.meeting.revision + 1);
    assert.equal((await store.get(initial.meeting_id))!.raw_links[0].status, 'failed');
  }));
