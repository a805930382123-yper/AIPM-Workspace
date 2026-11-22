import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoKnownSecret,
  describeUnparsable,
  LlmError,
  sanitizeDeep,
  sanitizeProviderText,
} from '../services/llm/provider.ts';
import { LLMService } from '../services/llm/service.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';

test('SEC output gate checks nonempty short and long credentials in nested JSON keys and values', () => {
  const secrets = ['q2!', 'long-known-provider-credential'];
  const escaped = JSON.parse('{"nested":{"q2!":"prefix long-known-provider-credential suffix"}}');
  assert.throws(
    () => assertNoKnownSecret(escaped, secrets),
    (error: unknown) => {
      assert.equal((error as LlmError).code, 'LLM_OUTPUT_CONTAINS_SECRET');
      assert.equal((error as Error).message.includes('q2!'), false);
      assert.equal((error as Error).message.includes(secrets[1]), false);
      return true;
    },
  );
  assert.doesNotThrow(() => assertNoKnownSecret({ text: 'ordinary output' }, ['', '']));
  assert.equal(sanitizeProviderText('q2! long-known-provider-credential', secrets).includes('q2!'), false);
  const clean = sanitizeDeep({ 'q2!': 'q2! details' }, secrets);
  assert.equal(JSON.stringify(clean).includes('q2!'), false);
  const malformed = describeUnparsable('xxlong-known-provider-credential', secrets);
  assert.equal(JSON.stringify(malformed).includes('long-known-provider-credential'), false);
});

test('SEC Brief, Prompt generation, and optimization reject tainted output before saving drafts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-security-output-sec-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const prompts = new PromptStore(root, wiki);
    await prompts.initialize();
    let response: unknown = {};
    const provider: LlmProvider = {
      name: 'sec-test',
      model: 'fake',
      secrets: ['q2!'],
      async complete() {
        const text = JSON.stringify(response);
        return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
      },
    };
    const ai = new PromptAiService(root, wiki, prompts, () => provider);
    await ai.initialize();
    const brief = {
      taskName: '任务',
      taskType: '访谈',
      role: 'PM',
      goal: '目标',
      context: '背景',
      input: '输入',
      tasks: '步骤',
      constraints: '约束',
      output: '输出',
    };
    response = { ...brief, input: '输入 q2!' };
    await assert.rejects(
      () => ai.brief('任务描述', 'customer_interview'),
      (error: unknown) => (error as LlmError).code === 'LLM_OUTPUT_CONTAINS_SECRET',
    );
    response = {
      preview: {
        name: 'Prompt',
        category: 'customer',
        scenario: '访谈',
        body: '正文',
        inputRequirements: '输入',
        outputRequirements: '输出',
        relatedWikiIds: [],
        examples: '',
        tags: [],
        favorite: false,
        'q2!': 'key',
      },
    };
    await assert.rejects(
      () => ai.generate(brief, []),
      (error: unknown) => (error as LlmError).code === 'LLM_OUTPUT_CONTAINS_SECRET',
    );
    response = {
      checks: [],
      improvements: [],
      preview: {
        name: 'Prompt',
        category: 'customer',
        scenario: '访谈',
        body: '正文',
        inputRequirements: '输入',
        outputRequirements: '输出',
        relatedWikiIds: [],
        examples: '',
        tags: [],
        favorite: false,
      },
    };
    response = { ...(response as object), checks: [{ evidence: 'q2!' }] };
    await assert.rejects(
      () => ai.optimize('现有 Prompt', '', undefined, undefined),
      (error: unknown) => (error as LlmError).code === 'LLM_OUTPUT_CONTAINS_SECRET',
    );
    assert.equal(await prompts.count(), 0);
    assert.equal((await readdir(path.join(root, 'drafts', 'prompts'))).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SEC Raw extraction rejects a tainted chunk before a later chunk or merge request', async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: 'sec-test',
    model: 'fake',
    secrets: ['q2!'],
    async complete() {
      calls += 1;
      return { text: JSON.stringify({ 'q2!': 'untrusted' }), finishReason: 'stop', bytes: 30 };
    },
  };
  const service = new LLMService('rules');
  await assert.rejects(
    () =>
      service.wikiExtract({
        raw: {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'SEC probe',
          sourceType: 'report',
          sourceName: 'test',
          tags: [],
        },
        body: `唯一开头片段。${'正文内容'.repeat(7000)}`,
        provider,
      }),
    (error: unknown) => (error as LlmError).code === 'LLM_OUTPUT_CONTAINS_SECRET',
  );
  assert.ok(calls <= 2, `the tainted wave must stop before subsequent waves (calls=${calls})`);
});
