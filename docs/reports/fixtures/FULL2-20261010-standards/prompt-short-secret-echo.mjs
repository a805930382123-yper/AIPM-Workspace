import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PromptAiService } from '../../../../services/prompt-ai/service.ts';
import { findSecretHits } from '../../../../services/llm/jobs.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'fmcg-full2-prompt-secret-'));
const shortCredential = 'a9Zq!';
try {
  const provider = {
    name: 'fixture-provider', model: 'fixture', secrets: [shortCredential],
    async complete() {
      const text = JSON.stringify({ taskName: `任务 ${shortCredential}`, taskType: 'business analysis', role: 'analyst', goal: '整理任务', context: 'fixture', input: 'fixture', tasks: 'review', constraints: 'do not invent facts', output: 'structured JSON' });
      return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
    },
  };
  const service = new PromptAiService(root, { allRecords: async () => [] }, {}, () => provider);
  await service.initialize();
  const result = await service.brief('普通业务整理任务', 'business_process');
  const persisted = await readFile(path.join(root, 'drafts', 'prompts', `${result.draftId}.json`), 'utf8');
  const finding = {
    credentialLength: shortCredential.length,
    draftCreated: true,
    credentialReturnedInBrief: JSON.stringify(result.brief).includes(shortCredential),
    credentialPersistedInDraft: persisted.includes(shortCredential),
    extractionDetectorHits: findSecretHits({ text: shortCredential }, [shortCredential]).length,
    providerHttpCalls: 0,
  };
  assert.equal(finding.credentialReturnedInBrief, true);
  assert.equal(finding.credentialPersistedInDraft, true);
  assert.equal(finding.extractionDetectorHits, 0);
  await writeFile(new URL('./prompt-short-secret-echo.result.json', import.meta.url), `${JSON.stringify(finding, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(finding));
} finally {
  await rm(root, { recursive: true, force: true });
}
