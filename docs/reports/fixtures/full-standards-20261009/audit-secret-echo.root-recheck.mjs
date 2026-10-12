import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../../../../services/raw/store.ts';
import { WikiStore } from '../../../../services/wiki/store.ts';
import { AuditService } from '../../../../services/audit/service.ts';
import { writeFile } from 'node:fs/promises';

const root = await mkdtemp(path.join(os.tmpdir(), 'fmcg-standards-audit-'));
const credential = 'fixture-secret-909';
try {
  const raws = new RawStore(root);
  await raws.initialize();
  const raw = await raws.create({ title: '隔离复现原文', sourceType: 'report', sourceName: 'fixture', tags: [], body: '门店实测原文证据。' });
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const page = await wiki.create({
    title: '隔离复现页面', type: 'concept', category: 'industry_basics', sources: [raw.id], tags: [], aliases: [],
    knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'reviewed', body: '待审阅的原始表述。',
  });
  const audits = new AuditService(root, wiki, raws);
  await audits.initialize();
  const audit = await audits.create({ wikiId: page.id, scope: 'paragraph', severity: 'warning', comment: 'fixture only', anchor: { before: '', text: '待审阅的原始表述。', after: '' } });
  const provider = {
    name: 'fixture-provider', model: 'fixture', secrets: [credential],
    async complete() {
      const text = JSON.stringify({ replacement: `修订建议 ${credential}`, rationale: 'fixture', evidence: [{ rawId: raw.id, quote: '门店实测原文证据。' }] });
      return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
    },
  };
  const { draft } = await audits.propose(audit.id, provider);
  const persisted = await readFile(path.join(root, 'drafts', 'audit', `${draft.id}.json`), 'utf8');
  const result = {
    providerSecretPresentInReplacement: draft.replacement.includes(credential),
    providerSecretPersistedInDraft: persisted.includes(credential),
    draftStatus: draft.status,
    fixtureCredential: credential,
  };
  assert.equal(result.providerSecretPresentInReplacement, true);
  assert.equal(result.providerSecretPersistedInDraft, true);
  await writeFile(new URL('./audit-secret-echo.root-recheck.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} finally {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('fmcg-standards-')) throw new Error('Unsafe cleanup path'); await rm(root, { recursive: true, force: true });
}

