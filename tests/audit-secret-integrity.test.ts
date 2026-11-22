import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { AuditError, AuditService } from '../services/audit/service.ts';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import type { LlmProvider } from '../services/llm/provider.ts';

const snapshot = async (dir: string) =>
  Object.fromEntries(
    await Promise.all((await readdir(dir)).sort().map(async (name) => [name, await readFile(path.join(dir, name))])),
  );

test('Audit rejects parsed Provider secrets in every output field without changing pending state, then clean retry succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-audit-secret-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const raw = await raws.create({
      title: 'Evidence',
      sourceType: 'report',
      sourceName: 'fixture',
      tags: [],
      body: '原文证据句。',
    });
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const page = await wiki.create({
      title: 'Audit target',
      type: 'concept',
      category: 'industry_basics',
      sources: [raw.id],
      tags: [],
      aliases: [],
      knowledge_status: 'needs_verification',
      confidence: 'low',
      source_level: 'D',
      review_status: 'reviewed',
      body: '需要修订的目标文本。',
    });
    const audits = new AuditService(root, wiki, raws);
    await audits.initialize();
    const audit = await audits.create({
      wikiId: page.id,
      scope: 'page',
      severity: 'warning',
      comment: '检查 Provider 输出',
    });
    const auditBefore = await readFile(path.join(root, 'knowledge', 'audit', `${audit.id}.json`));
    const draftDir = path.join(root, 'drafts', 'audit');
    const originalPending = await audits.propose(audit.id, provider(raw.id, '干净修订内容', '原有草稿'));
    const beforeExisting = await readFile(path.join(draftDir, `${originalPending.draft.id}.json`));
    const beforeDrafts = await snapshot(draftDir);
    const beforeAudit = await readFile(path.join(root, 'knowledge', 'audit', `${audit.id}.json`));

    const secret = 's3cr3t-alpha-value';
    const placements = [
      { replacement: `被拒绝 ${secret}`, rationale: '普通理由', evidence: [] },
      { replacement: '普通替换', rationale: `被拒绝 ${secret}`, evidence: [] },
      { replacement: '普通替换', rationale: '普通理由', evidence: [{ rawId: raw.id, quote: `原文证据句 ${secret}` }] },
      { replacement: 'Unicode 解码值 s3cr3t-alpha-value', rationale: '普通理由', evidence: [] },
      { replacement: '普通替换', rationale: 'short', evidence: [] },
      { replacement: 'safe', rationale: 'safe', evidence: [] },
    ];
    for (const [index, output] of placements.entries()) {
      const text =
        index === 5
          ? JSON.stringify({ [secret]: 'safe' })
          : JSON.stringify(output).replace(
              index === 3 ? 's3cr3t-alpha-value' : '\u0000',
              index === 3 ? '\\u0073\\u0033cr3t-alpha-value' : '\u0000',
            );
      await assert.rejects(
        () => audits.propose(audit.id, provider(raw.id, text, 's3cr3t-alpha-value')),
        (error) =>
          error instanceof AuditError &&
          error.code === 'LLM_OUTPUT_CONTAINS_SECRET' &&
          error.status === 502 &&
          !error.message.includes(secret) &&
          error.details === undefined,
      );
      assert.deepEqual(await snapshot(draftDir), beforeDrafts, '拒绝不得新增/替换/丢弃 pending 草稿');
      assert.deepEqual(await readFile(path.join(root, 'knowledge', 'audit', `${audit.id}.json`)), beforeAudit);
    }
    assert.deepEqual(await readFile(path.join(draftDir, `${originalPending.draft.id}.json`)), beforeExisting);
    assert.deepEqual(await readFile(path.join(root, 'knowledge', 'audit', `${audit.id}.json`)), beforeAudit);
    assert.ok(auditBefore.length > 0);

    const clean = await audits.propose(audit.id, provider(raw.id, '无密钥的修订内容。'));
    assert.equal(clean.draft.status, 'pending');
    assert.equal(clean.draft.replacement, '无密钥的修订内容。');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function provider(rawId: string, replacementOrText: string, rationale = '有依据的修订'): LlmProvider {
  const text = replacementOrText.startsWith('{')
    ? replacementOrText
    : JSON.stringify({ replacement: replacementOrText, rationale, evidence: [{ rawId, quote: '原文证据句' }] });
  return {
    name: 'fake-audit',
    model: 'fixture',
    secrets: ['s3cr3t-alpha-value', 'short'],
    complete: async () => ({ text, finishReason: 'stop', bytes: Buffer.byteLength(text) }),
  };
}
