import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LlmError, OpenAiCompatibleProvider, type LlmCompletion, type LlmProvider } from '../services/llm/provider.ts';
import { validateSchema } from '../services/llm/schema-validator.ts';
import { PdfCleanupService } from '../services/raw/pdf-cleanup.ts';
import {
  adjacentPdfTextLines,
  confirmedPdfPageLabels,
  longWritingBatches,
  pdfWritingLayout,
  readWriting,
  writtenBlocks,
  type WritingRequest,
  type WritingResult,
} from '../services/raw/pdf-topic-writing.ts';
import type { PdfPageService } from '../services/raw/pdf-pages.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { RawStore, type RawRecord } from '../services/raw/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import type { PdfTopicItem } from '../services/wiki/render.ts';
import { WikiStore } from '../services/wiki/store.ts';

const range = { startPage: 1, endPage: 1 };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function setup(provider: LlmProvider, content = 'Another topic figure', body = 'Research design\nLogo') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-cleanup-shape-'));
  const raws = new RawStore(root);
  const raw: RawRecord = {
    id: randomUUID(),
    title: 'Synthetic',
    sourceName: 'Fixture',
    sourceType: 'report',
    tags: [],
    body,
    bodySha256: sha(body),
    status: 'unprocessed',
    importedAt: '2026-11-10T00:00:00Z',
    assetId: randomUUID(),
    assetSha256: sha('synthetic-original'),
  };
  raws.get = async (id) => (id === raw.id ? raw : undefined);
  const pdfInput: Awaited<ReturnType<PdfPageService['cleanupInput']>> = {
    raw,
    binding: {
      ...range,
      pageCount: 1,
      assetId: raw.assetId!,
      assetSha256: raw.assetSha256!,
      basisDigest: sha('synthetic-r1'),
    },
    pages: [
      {
        page: 1,
        textStart: 0,
        textEnd: raw.body.length,
        resultSha256: sha('synthetic-page-result'),
        understanding: { blank: false, content, visuals: 'Region | Unit', inference: '', questions: [] },
      },
    ],
  };
  let nextRead: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  const pdf = {
    get: async () => ({
      pageCount: pdfInput.binding.pageCount,
      pages: pdfInput.pages.map(({ page }) => ({ page, status: 'completed' })),
    }),
    cleanupInput: async () => {
      const paused = nextRead;
      nextRead = undefined;
      if (paused) {
        paused.entered.resolve();
        await paused.release.promise;
      }
      return pdfInput;
    },
  } as unknown as PdfPageService;
  const deps = {
    root,
    pdf,
    raws,
    provider: async () => provider,
    drafts: new DraftStore(root),
    wiki: new WikiStore(root, raws),
    rawStates: new RawStateStore(root),
  };
  const cleanup = new PdfCleanupService(deps);
  const state = path.join(root, 'state', 'raw-pdf', raw.id, 'cleanup-1-1.json');
  return {
    cleanup,
    rawId: raw.id,
    state,
    drafts: deps.drafts,
    pdfInput,
    setProvider: (next: LlmProvider) => {
      provider = next;
    },
    restart: () => new PdfCleanupService(deps),
    pauseNextRead: () => (nextRead = { entered: deferred(), release: deferred() }),
  };
}

type Call = {
  stage: string;
  units?: Array<{
    id: string;
    text: string;
    page: number;
    origin: string;
    kind: string;
    topic?: string;
    unitId?: string;
    start?: number;
    end?: number;
  }>;
  topics?: string[];
  basis?: Array<{ topic: string; samples: NonNullable<Call['units']> }>;
  existingBasis?: Array<{ topic: string; samples: NonNullable<Call['units']> }>;
};
type Wire = {
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string; json_schema: { name: string; strict: boolean; schema: any } };
};
type Reply = (input: Call, strict: boolean) => unknown | Promise<unknown>;

function keyedFixture(value: unknown, strict: boolean) {
  if (!strict || !value || typeof value !== 'object') return value;
  const reply = value as {
    decisions?: Array<Record<string, unknown>>;
    assignments?: Array<{ topic: string; title: string }>;
  };
  if (Array.isArray(reply.decisions))
    return {
      decisions: Object.fromEntries(reply.decisions.map(({ id, ...decision }) => [id, decision])),
    };
  if (Array.isArray(reply.assignments))
    return { assignments: Object.fromEntries(reply.assignments.map((item) => [item.topic, item.title])) };
  return value;
}

async function withHttpProvider(
  run: (fixture: {
    calls: Wire[];
    provider: OpenAiCompatibleProvider;
    fallback: OpenAiCompatibleProvider;
    respond: (fn: Reply) => void;
    respondPresentation: (fn: Reply) => void;
    respondWriting: (fn: (input: WritingRequest) => unknown | Promise<unknown>) => void;
  }) => Promise<void>,
) {
  const calls: Wire[] = [];
  const errors: string[] = [];
  let reply: Reply = defaultReply;
  let presentationReply: Reply = defaultReply;
  let writingReply: (input: WritingRequest) => unknown | Promise<unknown> = defaultWriting;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const wire = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Wire;
      calls.push(wire);
      const input = JSON.parse(wire.messages[1].content) as Call;
      const respond = input.stage === 'pdf_presentation' ? presentationReply : reply;
      const answer =
        input.stage === 'pdf_topic_write'
          ? await writingReply(JSON.parse(wire.messages[1].content))
          : await respond(input, !!wire.response_format);
      const value = keyedFixture(answer, !!wire.response_format);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            { message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' },
          ],
        }),
      );
    } catch (error) {
      errors.push(String(error));
      res.writeHead(500).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    assert(url === 'https://api.openai.com/v1/chat/completions' || url === baseUrl + '/chat/completions');
    return fetch(baseUrl + '/chat/completions', { ...init, redirect: 'error' });
  };
  const config = { apiKey: 'synthetic-structured-pdf-secret', model: 'gpt-6.1-terra', source: 'local-file' as const };
  try {
    await run({
      calls,
      provider: new OpenAiCompatibleProvider({ ...config, baseUrl: 'https://api.openai.com/v1' }),
      fallback: new OpenAiCompatibleProvider({ ...config, baseUrl }),
      respond: (fn) => {
        reply = fn;
      },
      respondPresentation: (fn) => {
        presentationReply = fn;
      },
      respondWriting: (fn) => {
        writingReply = fn;
      },
    });
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = fetch;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function defaultWriting(input: WritingRequest): WritingResult {
  return {
    topics: Object.fromEntries(
      input.topics.map(({ id, items }) => [
        id,
        {
          blocks: items.map((item) => ({ kind: 'fact', text: item.text })),
          coverage: Object.fromEntries(
            items.map((item, blockIndex) => [item.id, { action: 'included', blockIndex, reason: null }]),
          ),
        },
      ]),
    ),
  };
}

function defaultReply(input: Call, strict: boolean) {
  if (input.stage === 'plain') return { result: true };
  if (input.stage === 'pdf_topic_index')
    return { assignments: input.topics!.map((topic) => ({ topic, title: topic })) };
  if (input.stage === 'pdf_presentation')
    return {
      presentation: Object.fromEntries(
        input.units!.map((unit) => [unit.id, { representativeId: null, reason: 'Independent source material' }]),
      ),
    };
  return {
    decisions: input.units!.map((unit) => {
      const skip = unit.text === 'Logo';
      const table = unit.text === 'Region | Unit' ? { title: 'Research table', role: 'header' } : null;
      const topic = unit.text === 'Another topic figure' ? 'Another topic' : 'Research design';
      return {
        id: unit.id,
        decision: skip ? 'skip' : 'keep',
        reason: skip ? 'decorative' : 'substantive',
        ...(strict
          ? { topic: skip ? null : topic, mergedInto: null, table }
          : { ...(!skip ? { topic } : {}), ...(table ? { table } : {}) }),
      };
    }),
  };
}

async function terminal(fixture: Awaited<ReturnType<typeof setup>>, status: string) {
  for (let i = 0; i < 400; i++) {
    const { job } = await fixture.cleanup.get(fixture.rawId);
    if (job?.status === status) return job;
    if (job?.status === 'failed' && status !== 'failed') assert.fail(JSON.stringify(job.error));
    await delay(10);
  }
  assert.fail('PDF cleanup did not reach ' + status);
}

async function resumeRevisionFour(fixture: Awaited<ReturnType<typeof setup>>) {
  await fixture.cleanup.start(fixture.rawId, range);
  await terminal(fixture, 'completed');
  const legacy = JSON.parse(await readFile(fixture.state, 'utf8'));
  legacy.promptRevision = 4;
  legacy.attempts -= legacy.writing.length;
  legacy.status = 'failed';
  legacy.stage = 'assembling';
  delete legacy.writing;
  await writeFile(fixture.state, JSON.stringify(legacy));
  const restored = { ...fixture, cleanup: fixture.restart() };
  await restored.cleanup.start(restored.rawId, range);
  return restored;
}

test('known-host adapter sends strict schemas on all PDF stages and decodes only optional nulls', async () => {
  await withHttpProvider(async ({ calls, provider }) => {
    const fixture = await setup(provider);
    await fixture.cleanup.start(fixture.rawId, range);
    const job = await terminal(fixture, 'completed');
    assert.deepEqual(job.counts, { kept: 3, merged: 0, skipped: 1 });
    const skipped = job.decisions.find((item) => item.decision === 'skip')!;
    for (const key of ['topic', 'mergedInto', 'table']) assert.equal(Object.hasOwn(skipped, key), false);
    assert.equal(job.decisions.find((item) => item.table)?.table?.role, 'header');
    assert.deepEqual(
      calls.map((item) => [
        item.response_format?.type,
        item.response_format?.json_schema.name,
        item.response_format?.json_schema.strict,
      ]),
      [
        ['json_schema', 'pdf_cleanup', true],
        ['json_schema', 'pdf_topic_index', true],
        ['json_schema', 'pdf_topic_write', true],
      ],
    );
    const request = JSON.parse(calls[0].messages[1].content) as Call;
    const decisions = calls[0].response_format!.json_schema.schema.properties.decisions;
    const keys = request.units!.map((item) => item.id);
    assert.deepEqual(decisions.required, keys);
    assert.equal(decisions.additionalProperties, false);
    const decision = decisions.properties[keys[0]];
    assert.deepEqual(decision.required, ['decision', 'reason', 'topic', 'mergedInto', 'table']);
    assert.deepEqual(decision.properties.table.type, ['object', 'null']);
    assert.deepEqual(decision.properties.topic.type, ['string', 'null']);
    assert.equal(decision.additionalProperties, false);
    const index = JSON.parse(calls[1].messages[1].content) as Call;
    const assignments = calls[1].response_format!.json_schema.schema.properties.assignments;
    assert.deepEqual(assignments.required, index.topics);
    assert.equal(assignments.additionalProperties, false);
    assert.deepEqual(assignments.properties[index.topics![0]], { type: 'string', minLength: 1, maxLength: 100 });
    await provider.complete({
      purpose: 'knowledge',
      system: 'Plain text fixture',
      user: '{"stage":"plain"}',
      timeoutMs: 1000,
      maxOutputBytes: 1000,
    });
    const write = JSON.parse(calls[2].messages[1].content) as WritingRequest;
    const topicShape = calls[2].response_format!.json_schema.schema.properties.topics;
    assert.deepEqual(
      topicShape.required,
      write.topics.map((topic) => topic.id),
    );
    for (const topic of write.topics)
      assert.deepEqual(
        topicShape.properties[topic.id].properties.coverage.required,
        topic.items.map((item) => item.id),
      );
    assert.equal(calls[3].response_format, undefined);
    assert.equal(calls[3].messages[1].content, '{"stage":"plain"}');
  });
});

test('strict and fallback shape failures report schema paths without copying provider values or property names', async () => {
  await withHttpProvider(async ({ calls, provider, fallback, respond }) => {
    const mutate = (input: Call, strict: boolean, patch: (item: Record<string, unknown>) => void) => {
      const answer = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      patch(answer.decisions[0]);
      return answer;
    };
    const cases = [
      {
        field: '.reason',
        reason: 'missing_field',
        patch: (item: Record<string, unknown>) => {
          delete item.reason;
        },
      },
      {
        field: '.decision',
        reason: 'invalid_enum',
        patch: (item: Record<string, unknown>) => {
          item.decision = 'private-value-marker';
        },
      },
      {
        field: '.table.role',
        reason: 'invalid_enum',
        patch: (item: Record<string, unknown>) => {
          item.table = { title: 'Table', role: 'private-value-marker' };
        },
      },
      {
        field: '',
        reason: 'unknown_field',
        patch: (item: Record<string, unknown>) => {
          item['private-attribute-marker'] = 'private-value-marker';
        },
      },
      {
        field: '',
        reason: 'unknown_field',
        patch: (item: Record<string, unknown>) => {
          Object.defineProperty(item, 'constructor', { value: 'private-value-marker', enumerable: true });
        },
      },
      {
        field: '.topic',
        reason: 'required_for_action',
        patch: (item: Record<string, unknown>) => {
          item.topic = null;
        },
      },
      {
        field: '.topic',
        reason: 'forbidden_for_action',
        patch: (item: Record<string, unknown>) => {
          item.decision = 'skip';
        },
      },
      {
        field: '.topic',
        reason: 'multiline_label',
        patch: (item: Record<string, unknown>) => {
          item.topic = 'private-value-marker\nOther';
        },
      },
      {
        field: '.topic',
        reason: 'blank_label',
        patch: (item: Record<string, unknown>) => {
          item.topic = '   ';
        },
      },
      {
        field: '.reason',
        reason: 'invalid_type',
        fallback: true,
        patch: (item: Record<string, unknown>) => {
          item.reason = null;
        },
      },
    ];
    for (const item of cases) {
      respond((input, strict) => mutate(input, strict, item.patch));
      const fixture = await setup(item.fallback ? fallback : provider);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, 'failed');
      assert.equal(job.error?.code, 'PDF_CLEANUP_SCHEMA');
      assert.deepEqual(job.error?.details, {
        stage: 'pdf_cleanup',
        path: '$.decisions[0]' + item.field,
        reason: item.reason,
      });
      assert.equal(job.completedBatches, 0);
      assert.doesNotMatch(await readFile(fixture.state, 'utf8'), /private-value-marker|private-attribute-marker/);
      assert.equal(Boolean(calls.at(-1)!.response_format), !item.fallback);
    }
  });
});

test('topic index still fails duplicates and omissions on the legacy non-strict transport', async () => {
  await withHttpProvider(async ({ fallback, respond }) => {
    for (const duplicate of [true, false]) {
      respond((input, strict) =>
        input.stage !== 'pdf_topic_index'
          ? defaultReply(input, strict)
          : {
              assignments: duplicate ? [0, 1].map(() => ({ topic: input.topics![0], title: 'Topic' })) : [],
            },
      );
      const fixture = await setup(fallback);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, 'failed');
      assert.equal(job.error?.code, 'PDF_CLEANUP_INDEX');
      assert.deepEqual(job.error?.details, {
        stage: 'pdf_topic_index',
        path: duplicate ? '$.assignments[1].topic' : '$.assignments',
        reason: duplicate ? 'duplicate_topic' : 'missing_topic',
      });
      assert.equal(job.completedBatches, 1);
    }
  });
});

test('strict keyed cleanup requires every one of 48 input IDs and rejects the earlier one-item array shape', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const content = Array.from({ length: 45 }, (_, i) => 'Synthetic source item ' + (i + 1)).join('\n');
    for (const scenario of ['old-array', 'missing', 'extra', 'complete'] as const) {
      const firstCall = calls.length;
      respond((input, strict) => {
        if (input.stage === 'pdf_topic_index') return defaultReply(input, strict);
        assert.equal(input.units!.length, 48);
        const array = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
        if (scenario === 'old-array') return JSON.stringify({ decisions: [array.decisions[0]] });
        const output = keyedFixture(array, true) as { decisions: Record<string, unknown> };
        if (scenario === 'missing') delete output.decisions[input.units![1].id];
        if (scenario === 'extra') output.decisions['private-unknown-id-marker'] = output.decisions[input.units![0].id];
        return output;
      });
      const fixture = await setup(provider, content);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, scenario === 'complete' ? 'completed' : 'failed');
      const format = calls[firstCall].response_format!.json_schema.schema.properties.decisions;
      const input = JSON.parse(calls[firstCall].messages[1].content) as Call;
      assert.deepEqual(
        format.required,
        input.units!.map((unit) => unit.id),
      );
      assert.equal(format.required.length, 48);
      if (scenario === 'complete') {
        assert.equal(job.decisions.length, 48);
        assert.deepEqual(
          job.decisions.map((item) => item.id),
          input.units!.map((unit) => unit.id),
        );
      } else {
        assert.equal(job.error?.code, 'PDF_CLEANUP_SCHEMA');
        assert.deepEqual(job.error?.details, {
          stage: 'pdf_cleanup',
          path: scenario === 'missing' ? '$.decisions[1]' : '$.decisions',
          reason:
            scenario === 'old-array'
              ? 'invalid_type'
              : scenario === 'missing'
                ? 'missing_input_key'
                : 'unknown_input_key',
        });
        assert.equal(job.completedBatches, 0);
        assert.doesNotMatch(await readFile(fixture.state, 'utf8'), /private-unknown-id-marker/u);
      }
    }
  });
});

test('strict keyed index preserves frozen topic identity without exposing topic text in diagnostics', async () => {
  await withHttpProvider(async ({ provider, respond }) => {
    for (const scenario of ['missing', 'extra', 'bad-title'] as const) {
      respond((input, strict) => {
        if (input.stage === 'pdf_cleanup') {
          const output = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
          output.decisions[0].topic = 'private-topic-marker';
          output.decisions[2].topic = 'constructor';
          return output;
        }
        const assignments = Object.fromEntries(input.topics!.map((topic) => [topic, 'Formal safe title']));
        if (scenario === 'missing') Reflect.deleteProperty(assignments, 'constructor');
        if (scenario === 'extra') assignments['private-unknown-topic-marker'] = 'Formal safe title';
        if (scenario === 'bad-title') assignments['private-topic-marker'] = 23 as unknown as string;
        return { assignments };
      });
      const fixture = await setup(provider);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, 'failed');
      assert.equal(job.error?.code, 'PDF_CLEANUP_INDEX');
      assert.deepEqual(job.error?.details, {
        stage: 'pdf_topic_index',
        path:
          scenario === 'missing'
            ? '$.assignments[1]'
            : scenario === 'extra'
              ? '$.assignments'
              : '$.assignments[0].title',
        reason:
          scenario === 'missing' ? 'missing_input_key' : scenario === 'extra' ? 'unknown_input_key' : 'invalid_type',
      });
      assert.doesNotMatch(JSON.stringify(job.error), /private-(?:unknown-)?topic-marker|constructor/u);
    }
  });
});

test('strict cleanup keeps identical cross-origin evidence separately and explains the declined merge', async () => {
  await withHttpProvider(async ({ provider, respond }) => {
    respond((input, strict) => {
      if (input.stage !== 'pdf_cleanup') return defaultReply(input, strict);
      const answer = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      const image = answer.decisions.find((item) => item.id === 'p1-content-1')!;
      Object.assign(image, { decision: 'merge', mergedInto: 'p1-text-1' });
      return answer;
    });
    const fixture = await setup(provider, 'Research  design');
    await fixture.cleanup.start(fixture.rawId, range);
    const job = await terminal(fixture, 'completed');
    const raw = job.decisions.find((item) => item.id === 'p1-text-1')!;
    const image = job.decisions.find((item) => item.id === 'p1-content-1')!;
    assert.deepEqual(
      [raw.origin, raw.decision, raw.text, image.origin, image.decision, image.text],
      ['text', 'keep', 'Research design', 'image', 'keep', 'Research  design'],
    );
    assert.equal(image.topic, raw.topic);
    assert.equal(image.mergedInto, undefined);
    assert.equal(image.reason, '跨来源依据文字相同，保留两份来源，未执行归并。');
    const restored = await fixture.restart().get(fixture.rawId);
    assert.deepEqual(restored.job?.decisions, job.decisions);
  });
});

test('strict cleanup still rejects invalid targets, cross-kind matches and distinct evidence', async () => {
  await withHttpProvider(async ({ provider, respond }) => {
    for (const scenario of [
      'different-text',
      'different-kind',
      'unknown',
      'different-topic',
      'target-merge',
      'table',
    ] as const) {
      respond((input, strict) => {
        const answer = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
        const source = answer.decisions.find(
          (item) =>
            item.id === (scenario === 'different-kind' || scenario === 'table' ? 'p1-visuals-1' : 'p1-content-1'),
        )!;
        const textTarget = scenario === 'different-kind' || scenario === 'table' ? 'p1-text-2' : 'p1-text-1';
        Object.assign(source, {
          decision: 'merge',
          mergedInto: scenario === 'unknown' ? 'p1-content-999' : textTarget,
          topic: scenario === 'different-topic' ? 'Different topic' : 'Research design',
        });
        if (scenario === 'different-kind' || scenario === 'table') {
          const target = answer.decisions.find((item) => item.id === textTarget)!;
          Object.assign(target, { topic: 'Research design', table: null });
          if (scenario === 'different-kind') source.table = null;
        }
        if (scenario === 'target-merge') {
          const chained = answer.decisions.find((item) => item.id === 'p1-content-2')!;
          Object.assign(chained, { decision: 'merge', mergedInto: source.id, topic: source.topic });
        }
        return answer;
      });
      const content =
        scenario === 'target-merge'
          ? 'Research design\nResearch design'
          : scenario === 'different-text'
            ? 'Research design for 2027'
            : 'Research design';
      const body = scenario === 'different-kind' || scenario === 'table' ? 'Research design\nRegion | Unit' : undefined;
      const fixture = await setup(provider, content, body);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, 'failed');
      assert.equal(job.error?.code, 'PDF_CLEANUP_DUPLICATE', scenario);
      assert.equal(job.completedBatches, 0, scenario);
    }
  });
});

test('PDF cleanup alone allows 120 seconds and still stops on timeout or cancellation', async () => {
  await withHttpProvider(async ({ provider }) => {
    const complete = provider.complete.bind(provider);
    const requests: Array<{ stage: string; timeoutMs: number; signal?: AbortSignal }> = [];
    const entered = deferred();
    let outcome: 'normal' | 'timeout' | 'cancel' = 'normal';
    provider.complete = async (request) => {
      const { stage } = JSON.parse(request.user) as Call;
      requests.push({ stage, timeoutMs: request.timeoutMs, signal: request.signal });
      if (outcome === 'timeout') throw new LlmError('LLM_TIMEOUT', 'Synthetic timeout');
      if (outcome === 'cancel') {
        assert(request.signal);
        const signal = request.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new LlmError('LLM_CANCELLED', 'Synthetic cancellation')), {
            once: true,
          });
          entered.resolve();
        });
      }
      return complete(request);
    };

    const success = await setup(provider);
    await success.cleanup.start(success.rawId, range);
    await terminal(success, 'completed');
    assert.deepEqual(
      requests.map(({ stage, timeoutMs }) => [stage, timeoutMs]),
      [
        ['pdf_cleanup', 120_000],
        ['pdf_topic_index', 60_000],
        ['pdf_topic_write', 60_000],
      ],
    );
    assert(requests.every((request) => request.signal && request.signal === requests[0].signal));

    outcome = 'timeout';
    const timedOut = await setup(provider);
    await timedOut.cleanup.start(timedOut.rawId, range);
    const failed = await terminal(timedOut, 'failed');
    assert.equal(failed.error?.code, 'LLM_TIMEOUT');
    assert.equal(failed.attempts, 1);
    assert.equal(failed.completedBatches, 0);
    assert.equal((await timedOut.restart().get(timedOut.rawId)).job?.status, 'failed');
    assert.equal(requests.length, 4);

    outcome = 'cancel';
    const cancellable = await setup(provider);
    await cancellable.cleanup.start(cancellable.rawId, range);
    await entered.promise;
    const cancellation = await cancellable.cleanup.cancel(cancellable.rawId);
    assert.equal(cancellation.job?.status, 'cancelled');
    assert.equal(cancellation.job?.attempts, 1);
    assert.equal(cancellation.job?.completedBatches, 0);
    assert.equal(requests.at(-1)?.signal?.aborted, true);
    assert.equal(requests.at(-1)?.timeoutMs, 120_000);
    assert.equal(requests.length, 5);
  });
});

test('long PDF evidence packs keep original boundaries and cover several sourced paragraphs without losing the last fact', () => {
  const item = (
    id: string,
    page: number,
    origin: PdfTopicItem['origin'],
    kind: PdfTopicItem['kind'],
    text: string,
  ) => ({ id, page, origin, kind, text, topic: '渠道经营', decision: 'keep' as const });
  const items = [
    item('p1-text-1', 1, 'text', 'content', '2024年华北实际30家。'),
    item('p1-text-2', 1, 'text', 'content', '2025年华南预计45家。'),
    item('p1-text-3', 1, 'text', 'content', '使用访谈方法。'),
    item('p1-content-1', 1, 'image', 'content', '原报告有定性问卷说明。'),
    item('p1-visuals-1', 1, 'image', 'visuals', '图表标明线上销售。'),
    item('p2-text-1', 2, 'text', 'content', '新增875家。'),
  ];
  const labels = new Map(items.map((source) => [source.id, source.id === 'p1-text-3' ? '研究方法' : '渠道事实']));
  const { requests, members } = longWritingBatches(items, labels);
  assert.equal(requests.length, 1);
  const topic = requests[0].topics[0];
  assert.equal(topic.items.length, 5);
  assert.deepEqual(
    [...members.values()].map((group) => group.map((source) => source.id)),
    [['p1-text-1', 'p1-text-2'], ['p1-text-3'], ['p1-content-1'], ['p1-visuals-1'], ['p2-text-1']],
  );
  assert.equal(
    topic.items[0].text,
    items
      .slice(0, 2)
      .map((source) => source.text)
      .join('\n\n'),
  );
  const result: WritingResult = {
    topics: {
      [topic.id]: {
        blocks: items.map((source) => ({ kind: 'fact', text: source.text })),
        coverage: Object.fromEntries(
          topic.items.map((pack, i) => [
            pack.id,
            { action: 'included', blockIndexes: i === 0 ? [0, 1] : [i + 1], reason: null },
          ]),
        ),
      },
    },
  };
  assert.equal(readWriting(requests[0], result, JSON.stringify(result), undefined, undefined, members), result);
  const written = writtenBlocks(requests, [result], members).get(topic.title)!;
  assert.deepEqual(
    written.slice(0, 2).map((block) => block.sourceIds),
    [
      ['p1-text-1', 'p1-text-2'],
      ['p1-text-1', 'p1-text-2'],
    ],
  );
  assert.deepEqual(written.at(-1)?.sourceIds, ['p2-text-1']);
  const table = {
    ...item('p1-text-99', 1, 'text', 'content', '渠道 | 家数'),
    table: { title: '渠道表', role: 'header' as const },
  };
  assert.equal(longWritingBatches([items[0], table, items[1]], labels).members.size, 2);
  assert.throws(() => longWritingBatches([{ ...items[0], text: '字'.repeat(1400) }], labels), {
    reason: 'input_unit_too_large',
  });

  const missing = structuredClone(result);
  missing.topics[topic.id].blocks[1].text = '原报告说明需要跟踪。';
  assert.throws(() => readWriting(requests[0], missing, undefined, undefined, undefined, members), {
    reason: 'protected_facts_changed',
  });
  const invented = structuredClone(result);
  invented.topics[topic.id].blocks[0].text += '新增875家。';
  assert.throws(() => readWriting(requests[0], invented, undefined, undefined, undefined, members), {
    reason: 'protected_facts_changed',
  });
  const omitted = structuredClone(result);
  omitted.topics[topic.id].coverage[topic.items[0].id] = { action: 'metadata', blockIndexes: [], reason: '纯标题' };
  assert.throws(() => readWriting(requests[0], omitted, undefined, undefined, undefined, members), {
    reason: 'protected_omission',
  });
  const duplicated = structuredClone(result);
  duplicated.topics[topic.id].coverage[topic.items[0].id].blockIndexes = [0, 0];
  assert.throws(() => readWriting(requests[0], duplicated, undefined, undefined, undefined, members), {
    reason: 'invalid_coverage',
  });
  const unknown = structuredClone(result);
  unknown.topics[topic.id].coverage[topic.items[0].id].blockIndexes = [99];
  assert.throws(() => readWriting(requests[0], unknown, undefined, undefined, undefined, members), {
    reason: 'invalid_coverage',
  });
});

test('long PDF writing omits corroborated layout and preserves survey scope, quantities and units', () => {
  const title = '2028零售研究报告';
  const cover = '封面标题：' + title + '。副标题：把握消费时刻。';
  const sample =
    '定性研究于2028年8月执行，样本量N=24。受访者为18岁-45岁男女，其中4位为重度用户。线上、线下分别覆盖86、68个细分品类。';
  const item = (id: string, page: number, origin: PdfTopicItem['origin'], text: string) => ({
    id,
    page,
    origin,
    kind: 'content' as const,
    text,
    topic: '报告研究说明',
    decision: 'keep' as const,
  });
  const items = [
    item('p1-text-1', 1, 'text', title),
    item('p1-content-1', 1, 'image', cover),
    item('p2-content-1', 2, 'image', '03 研究方法：随机问卷。'),
    item('p3-content-1', 3, 'image', sample + '页码3。'),
    item('p3-text-1', 3, 'text', '18-24岁 12 50%'),
    item('p3-content-2', 3, 'image', '18至24岁12人（50%）。'),
    item('p4-text-1', 4, 'text', '即时零售是确定性的增长机会。'),
    item('p5-text-1', 5, 'text', '指标及释义 销售额/量增幅：同比额/量增幅 5'),
    item('p5-content-1', 5, 'image', '本页为研究说明。指标释义：销售额/量增幅为同比额/量增幅。'),
  ];
  const directory = item('p2-content-2', 2, 'image', '目录（第2页）：');
  const { requests, members } = longWritingBatches(items, new Map());
  const request = requests[0];
  const topic = request.topics[0];
  const blocks = [
    '采用随机问卷。',
    '定性研究于2028年8月执行，样本量为24人。受访者为18至45岁男女，其中4人为重度用户。线上覆盖86个细分品类，线下覆盖68个细分品类。18至24岁12人（50%）。',
    '报告认为即时零售有增长机会。',
    '销售额/量增幅指同比额/量增幅。',
  ];
  const result: WritingResult = {
    topics: {
      [topic.id]: {
        blocks: blocks.map((text) => ({ kind: 'fact', text })),
        coverage: Object.fromEntries(
          topic.items.map((pack) => [
            pack.id,
            pack.page === 1
              ? { action: 'metadata', blockIndexes: [], reason: '封面标题' }
              : { action: 'included', blockIndexes: [pack.page - 2], reason: null },
          ]),
        ),
      },
    },
  };
  const layout = pdfWritingLayout([...items, directory]);
  assert.equal(readWriting(request, result, undefined, undefined, undefined, members, layout), result);
  for (const replacement of [cover + '本研究样本为24人。', '封面标题：2028年覆盖24人的零售研究。']) {
    const changed = items.map((row) => (row.text === cover ? { ...row, text: replacement } : row));
    const original = members.get('g-p1-content-1')!;
    const mixed = new Map(members).set('g-p1-content-1', [{ ...original[0], text: replacement }]);
    assert.throws(
      () =>
        readWriting(request, result, undefined, undefined, undefined, mixed, pdfWritingLayout([...changed, directory])),
      { reason: 'protected_omission' },
    );
  }
  for (const [from, to] of [
    ['定性', '定量'],
    ['4人', '5人'],
    ['68个', '68元'],
    ['45岁', '46岁'],
    ['12人', '12件'],
  ]) {
    const changed = structuredClone(result);
    changed.topics[topic.id].blocks[1].text = blocks[1].replace(from, to);
    assert.throws(() => readWriting(request, changed, undefined, undefined, undefined, members, layout), {
      reason: 'protected_facts_changed',
    });
  }
  for (const text of ['18至24岁12件（50%）。', '25至29岁12人（50%）。']) {
    const withoutQuota = new Map(members).set(
      'g-p3-content-2',
      members.get('g-p3-content-2')!.map((row) => ({ ...row, text })),
    );
    assert.throws(() => readWriting(request, result, undefined, undefined, undefined, withoutQuota, layout), {
      reason: 'protected_facts_changed',
    });
  }
  const signed = new Map(members).set(
    'g-p4-text-1',
    members.get('g-p4-text-1')!.map((row) => ({ ...row, text: '线上销售变动-5%。' })),
  );
  const wrongSign = structuredClone(result);
  wrongSign.topics[topic.id].blocks[2].text = '线上销售变动5%。';
  assert.throws(() => readWriting(request, wrongSign, undefined, undefined, undefined, signed, layout), {
    reason: 'protected_facts_changed',
  });
});

test('global PDF writing checks facts against the topic and rejects unknown evidence and cross-topic facts', () => {
  const items = [
    { id: 'p1-text-1', page: 1, origin: 'text' as const, text: '定量问卷的实际样本为24人。', topic: '市场研究' },
    { id: 'p2-content-1', page: 2, origin: 'image' as const, text: '线下门店实际覆盖30家。', topic: '市场研究' },
    { id: 'p3-text-1', page: 3, origin: 'text' as const, text: '定性访谈的预计样本为36人。', topic: '用户访谈' },
  ].map((item) => ({ ...item, kind: 'content' as const, decision: 'keep' as const }));
  const { requests, members } = longWritingBatches(items, new Map());
  const request = requests[0];
  const [market, interviews] = request.topics;
  const result: WritingResult = {
    topics: {
      [market.id]: {
        blocks: [
          { kind: 'fact', text: items[0].text },
          { kind: 'fact', text: items[1].text },
        ],
        coverage: {
          [market.items[0].id]: { action: 'metadata', blockIndexes: [], reason: '模型处置不影响主题原依据' },
          [market.items[1].id]: { action: 'included', blockIndexes: [0], reason: null },
        },
      },
      [interviews.id]: {
        blocks: [{ kind: 'fact', text: items[2].text }],
        coverage: { [interviews.items[0].id]: { action: 'included', blockIndexes: [0], reason: null } },
      },
    },
  };
  const check = (value: WritingResult) =>
    readWriting(request, value, JSON.stringify(value), undefined, undefined, members, undefined, true);
  assert.equal(check(result), result);
  assert.deepEqual(writtenBlocks(requests, [result], members, true).get(market.title), [
    { text: items[0].text, sourceIds: [] },
    { text: items[1].text, sourceIds: [] },
  ]);
  for (const text of [
    '定量问卷的实际样本为36人。',
    '定量问卷的实际样本为25人。',
    '定量问卷的预计样本为24人。',
    '定量问卷的实际样本为24户。',
    '线上门店实际覆盖30家。',
    '仅限定量问卷的实际样本为24人。',
  ]) {
    const changed = structuredClone(result);
    changed.topics[market.id].blocks[0].text = text;
    assert.throws(() => check(changed), { reason: 'protected_facts_changed' });
  }
  const foreign = structuredClone(result);
  foreign.topics[market.id].coverage[interviews.items[0].id] = { action: 'included', blockIndexes: [0], reason: null };
  assert.throws(() => check(foreign), { reason: 'invalid_shape' });
  const wrongBlock = structuredClone(result);
  wrongBlock.topics[market.id].coverage[market.items[1].id] = { action: 'included', blockIndexes: [2], reason: null };
  assert.throws(() => check(wrongBlock), { reason: 'invalid_coverage' });
});

test('global PDF writing accepts equivalent percentage ranges and keeps explicit units, direction and limits', () => {
  const text =
    '份额较上年+3%。另一项指标增长2个百分点。价格高出11%-20%以上，价格低5%-10%。变动范围-5%至-2%。柱状图数值为15。';
  const items = [
    {
      id: 'p1-content-1',
      page: 1,
      origin: 'image' as const,
      text,
      topic: '品类价格',
      kind: 'content' as const,
      decision: 'keep' as const,
    },
  ];
  const { requests, members } = longWritingBatches(items, new Map());
  const request = requests[0];
  const topic = request.topics[0];
  const same =
    '份额较上年增加3%。另一项指标上升2个百分点。价格高出11%—20%以上，价格低5%到10%。变动范围−5%—−2%。柱状图标为15，图中未标单位。';
  const check = (text: string) =>
    readWriting(
      request,
      {
        topics: {
          [topic.id]: {
            blocks: [{ kind: 'fact', text }],
            coverage: { [topic.items[0].id]: { action: 'included', blockIndexes: [0], reason: null } },
          },
        },
      },
      undefined,
      undefined,
      undefined,
      members,
      undefined,
      true,
    );
  assert.doesNotThrow(() => check(same));
  for (const [from, to] of [
    ['增加3%', '下降3%'],
    ['增加3%', '增加3个百分点'],
    ['2个百分点', '2个'],
    ['15，', '15%，'],
    ['15，', '15人，'],
    ['20%以上', '20%以下'],
    ['20%以上', '20%'],
    ['5%到10%', '5%到11%'],
    ['−5%—−2%', '5%—2%'],
    ['高出11%', '低于11%'],
  ])
    assert.throws(() => check(same.replace(from, to)), { reason: 'protected_facts_changed' });
});

test('long PDF explicit resume archives a revision-five cleaning prefix and sends only unfinished units and topic keys', async () => {
  await withHttpProvider(async ({ calls, provider, respond, respondWriting }) => {
    let cleaning = 0;
    let pause = true;
    respond((input, strict) => {
      if (input.stage === 'pdf_cleanup' && ++cleaning === 2 && pause) return { decisions: {} };
      if (input.stage === 'pdf_topic_index')
        return { assignments: input.topics!.map((topic) => ({ topic, title: '渠道研究方法' })) };
      return defaultReply(input, strict);
    });
    respondWriting((input) => ({
      topics: Object.fromEntries(
        input.topics.map((topic) => [
          topic.id,
          {
            blocks: [{ kind: 'fact', text: '原资料包含本次渠道研究设计。' }],
            coverage: Object.fromEntries(
              topic.items.map((pack) => [pack.id, { action: 'included', blockIndexes: [0], reason: null }]),
            ),
          },
        ]),
      ),
    }));
    const fixture = await setup(provider, '渠道样本', Array.from({ length: 1000 }, () => '渠道研究设计').join('\n'));
    await fixture.cleanup.start(fixture.rawId, range);
    const failed = await terminal(fixture, 'failed');
    assert.equal(failed.completedBatches, 1);
    const saved = JSON.parse(await readFile(fixture.state, 'utf8'));
    saved.promptRevision = 5;
    const priorBytes = JSON.stringify(saved);
    await writeFile(fixture.state, priorBytes);
    const requestsBefore = calls.length;
    const restarted = { ...fixture, cleanup: fixture.restart() };
    assert.equal((await restarted.cleanup.get(restarted.rawId)).job?.promptRevision, 5);
    assert.equal(calls.length, requestsBefore);
    pause = false;
    await restarted.cleanup.start(restarted.rawId, range);
    const result = await terminal(restarted, 'completed');
    assert.equal(result.promptRevision, 6);
    assert.equal(result.reusedCleanupBatches, 1);
    const newCalls = calls.slice(requestsBefore).map((wire) => JSON.parse(wire.messages[1].content) as Call);
    assert.equal(result.attempts, failed.attempts + newCalls.length);
    const refreshed = JSON.parse(await readFile(fixture.state, 'utf8'));
    assert.deepEqual(refreshed.batches[0], saved.batches[0]);
    assert.equal(await readFile(fixture.state.replace(/\.json$/u, '-prompt-v5.json'), 'utf8'), priorBytes);
    const cleanup = newCalls.filter((call) => call.stage === 'pdf_cleanup');
    assert.equal(cleanup.length, result.totalBatches - 1);
    const originalIds = new Set(saved.batches[0].map((row: { id: string }) => row.id));
    assert(cleanup.every((call) => call.units!.every((unit) => !originalIds.has(unit.id))));
    assert.deepEqual(
      newCalls.filter((call) => call.stage === 'pdf_topic_index').flatMap((call) => call.topics!),
      ['Research design'],
    );
    assert.equal(refreshed.fragments, undefined);
  });
});

test('global PDF directory upgrades a full revision-six checkpoint atomically and resumes the long writer', async () => {
  await withHttpProvider(async ({ calls, provider, fallback, respond, respondWriting }) => {
    const range = { startPage: 1, endPage: 2 };
    type Topic = {
      id: string;
      label: string;
      startPage: number;
      endPage: number;
      sample: { page: number; kind: string; origin: string; excerpt: string };
    };
    const labels = Array.from({ length: 181 }, (_, i) => '原清理标签 ' + (i + 1));
    const longSource = '渠'.repeat(79) + '😀续';
    const tail = '页图补充2025年华南预计45家。';
    let scenario = 'missing';
    let failWriting = true;
    respond((input, strict) => {
      if (input.stage === 'pdf_cleanup')
        return {
          decisions: input.units!.map((unit) => {
            const n = Number(unit.id.split('-').at(-1));
            const topic = unit.origin === 'image' ? labels.at(-1) : labels[Math.min(n - 1, 180)];
            return { id: unit.id, decision: 'keep', reason: '来源保留', topic, table: null, mergedInto: null };
          }),
        };
      assert(strict);
      assert.equal(input.stage, 'pdf_topic_directory');
      const topics = input.topics as unknown as Topic[];
      assert.deepEqual(
        topics.map((topic) => topic.label),
        labels,
      );
      assert.deepEqual(
        topics.map((topic) => topic.id),
        labels.map((_, i) => 't' + (i + 1)),
      );
      assert.deepEqual(topics[0], {
        id: 't1',
        label: labels[0],
        startPage: 1,
        endPage: 1,
        sample: { page: 1, kind: 'content', origin: 'text', excerpt: '渠'.repeat(79) + '😀' },
      });
      assert.deepEqual(topics.at(-1), {
        id: 't181',
        label: labels.at(-1),
        startPage: 1,
        endPage: 2,
        sample: { page: 2, kind: 'content', origin: 'image', excerpt: tail },
      });
      const assignments = Object.fromEntries(
        topics.map(({ id }, i) => [id, scenario === 'overflow' ? '议题 ' + i : '渠道经营']),
      );
      if (scenario === 'missing') delete assignments.t181;
      if (scenario === 'unknown') assignments.t182 = '渠道经营';
      if (scenario === 'invalid') assignments.t1 = '渠道[经营]';
      if (scenario === 'duplicate')
        return '{"assignments":{"\\u00741":"渠道经营",' + JSON.stringify(assignments).slice(1) + '}';
      return { assignments };
    });
    respondWriting((input) => {
      if (failWriting) return {};
      return {
        topics: Object.fromEntries(
          input.topics.map((topic) => [
            topic.id,
            {
              blocks: topic.items.map((item) => ({ kind: 'fact', text: item.text.split('\n\n')[0] })),
              coverage: Object.fromEntries(
                topic.items.map((item, i) => [item.id, { action: 'included', blockIndexes: [i], reason: null }]),
              ),
            },
          ]),
        ),
      };
    });
    const base = await setup(
      provider,
      '',
      [longSource, ...Array.from({ length: 999 }, () => '报告说明渠道研究设计。')].join('\n'),
    );
    const fixture = { ...base, state: base.state.replace('cleanup-1-1.json', 'cleanup-1-2.json') };
    Object.assign(fixture.pdfInput.binding, { endPage: 2, pageCount: 2 });
    fixture.pdfInput.pages.push({
      page: 2,
      textStart: null,
      textEnd: null,
      resultSha256: sha('second-page'),
      understanding: { blank: false, content: tail, visuals: '', inference: '', questions: [] },
    });
    await fixture.cleanup.start(fixture.rawId, range);
    const firstFailure = await terminal(fixture, 'failed');
    assert.equal(firstFailure.promptRevision, 7);
    assert.equal(firstFailure.completedBatches, firstFailure.totalBatches);
    const prior = JSON.parse(await readFile(fixture.state, 'utf8'));
    prior.promptRevision = 6;
    prior.attempts += 9;
    prior.index = labels.slice(0, 128).map((topic) => ({ topic, title: '局部议题' }));
    const priorBytes = JSON.stringify(prior);
    const archive = fixture.state.replace(/\.json$/u, '-prompt-v6.json');
    await writeFile(fixture.state, priorBytes);
    const before = calls.length;
    let current = { ...fixture, cleanup: fixture.restart() };
    assert.equal((await current.cleanup.get(fixture.rawId)).job?.promptRevision, 6);
    fixture.setProvider(fallback);
    await assert.rejects(current.cleanup.start(fixture.rawId, range), { code: 'PDF_CLEANUP_PROVIDER_CHANGED' });
    fixture.setProvider(provider);
    const oldBasis = fixture.pdfInput.binding.basisDigest;
    fixture.pdfInput.binding.basisDigest = sha('changed-r1-or-raw');
    await assert.rejects(current.cleanup.start(fixture.rawId, range), { code: 'PDF_CLEANUP_BASIS_CHANGED' });
    fixture.pdfInput.binding.basisDigest = oldBasis;
    assert.equal(calls.length, before);
    assert.equal(await readFile(fixture.state, 'utf8'), priorBytes);

    for (const [mode, reason] of [
      ['missing', 'missing_input_key'],
      ['unknown', 'unknown_input_key'],
      ['duplicate', 'duplicate_input_key'],
      ['invalid', 'unsafe_title_characters'],
      ['overflow', undefined],
    ] as const) {
      scenario = mode;
      const count = calls.length;
      await current.cleanup.start(fixture.rawId, range);
      const failed = await terminal(current, 'failed');
      assert.equal(failed.promptRevision, 7);
      assert.equal(failed.reusedCleanupBatches, prior.totalBatches);
      assert.equal(failed.error?.code, reason ? 'PDF_CLEANUP_INDEX' : 'PDF_CLEANUP_TOPIC_LIMIT');
      assert.equal(failed.error?.details?.reason, reason);
      assert.equal(failed.error?.details?.stage, reason && 'pdf_topic_directory');
      const saved = JSON.parse(await readFile(fixture.state, 'utf8'));
      assert.deepEqual(saved.batches, prior.batches);
      assert.deepEqual(saved.index, []);
      assert.equal(saved.attempts, prior.attempts + calls.length - before);
      assert.equal(await readFile(archive, 'utf8'), priorBytes);
      assert.equal(calls.length, count + 1);
      current = { ...fixture, cleanup: fixture.restart() };
      assert.equal((await current.cleanup.get(fixture.rawId)).job?.status, 'failed');
      assert.equal(calls.length, count + 1);
    }

    scenario = 'success';
    const beforeSuccess = calls.length;
    await current.cleanup.start(fixture.rawId, range);
    assert.equal((await terminal(current, 'failed')).error?.details?.stage, 'pdf_topic_write');
    assert.deepEqual(
      calls.slice(beforeSuccess).map((wire) => wire.response_format?.json_schema.name),
      ['pdf_topic_directory', 'pdf_topic_write'],
    );
    assert.match(
      calls[beforeSuccess + 1].messages[0].content,
      /图表数字未标单位时保留原数字.*不补百分号.*不用自行计算/u,
    );
    const strict = calls[beforeSuccess].response_format!.json_schema;
    assert.equal(strict.strict, true);
    assert.deepEqual(
      strict.schema.properties.assignments.required,
      labels.map((_, i) => 't' + (i + 1)),
    );
    const saved = JSON.parse(await readFile(fixture.state, 'utf8'));
    assert.deepEqual(
      saved.index,
      labels.map((topic) => ({ topic, title: '渠道经营' })),
    );
    const restarted = { ...fixture, cleanup: fixture.restart() };
    const beforeWriting = calls.length;
    failWriting = false;
    await restarted.cleanup.start(fixture.rawId, range);
    await terminal(restarted, 'completed');
    assert(calls.slice(beforeWriting).every((wire) => wire.response_format?.json_schema.name === 'pdf_topic_write'));
    const { job } = await restarted.cleanup.draft(fixture.rawId, range);
    const draft = (await fixture.drafts.get(job!.draftId!))!;
    assert.equal(draft.status, 'pending_confirmation');
    assert.equal(draft.pages.length, 1);
    assert.equal(draft.pages[0].pdfEvidence?.length, 1002);
    const candidate = draft.maintenance!.changes[0].candidate.body;
    const [organized, evidence] = candidate.split('### 本主题依据');
    assert(organized.includes(tail));
    assert(!organized.includes('/pdf/original#page='));
    assert(evidence.includes('原文字层、PDF 页图 AI 解读'));
    for (const page of [1, 2]) assert(evidence.includes('/pdf/original#page=' + page));
    assert.equal(draft.pages[0].pdfEvidence?.find((item) => item.text === longSource)?.kind, 'text');
    assert.deepEqual(
      draft.pages[0].pdfEvidence?.find((item) => item.text === tail),
      {
        unitId: 'p2-content-1',
        page: 2,
        resultSha256: sha('second-page'),
        text: tail,
        kind: 'image',
      },
    );
    const after = calls.length;
    assert.equal((await restarted.cleanup.start(fixture.rawId, range)).job?.draftId, draft.id);
    assert.equal(calls.length, after);

    const oversized = structuredClone(prior);
    oversized.promptRevision = 7;
    oversized.index = [];
    for (const [i, decision] of oversized.batches.flat().entries()) {
      decision.topic = '目'.repeat(96) + (i + 1);
    }
    await writeFile(fixture.state, JSON.stringify(oversized));
    await restarted.cleanup.start(fixture.rawId, range);
    const limited = await terminal(restarted, 'failed');
    assert.equal(limited.error?.code, 'PDF_CLEANUP_DIRECTORY_LIMIT');
    assert.equal(limited.attempts, oversized.attempts);
    assert.equal(calls.length, after);
  });
});

test('strict keyed topic, table title and final title count Unicode code points without truncation', async () => {
  const label = 'A'.repeat(95) + String.fromCodePoint(0x1f600).repeat(5);
  const schema = { type: ['string', 'null'], minLength: 1, maxLength: 100 };
  assert.equal(label.length, 105);
  assert.deepEqual(validateSchema(label, schema), []);
  assert.deepEqual(validateSchema(String.fromCodePoint(0x1f600).repeat(100), schema), []);
  assert.deepEqual(validateSchema(null, schema), []);
  assert.equal(validateSchema('', schema).length, 1);
  assert.equal(validateSchema(label + 'X', schema).length, 1);
  assert.equal(validateSchema('X'.repeat(101), schema).length, 1);
  await withHttpProvider(async ({ provider, respond }) => {
    for (const overflow of [false, true]) {
      respond((input, strict) => {
        if (input.stage === 'pdf_topic_index')
          return { assignments: input.topics!.map((topic) => ({ topic, title: topic })) };
        const output = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
        output.decisions[0].topic = overflow ? label + 'X' : label;
        const table = output.decisions.find((item) => item.table)!.table as { title: string };
        table.title = label;
        return output;
      });
      const fixture = await setup(provider);
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, overflow ? 'failed' : 'completed');
      if (overflow) {
        assert.deepEqual(job.error?.details, {
          stage: 'pdf_cleanup',
          path: '$.decisions[0].topic',
          reason: 'invalid_length',
        });
      } else {
        assert.equal(job.decisions[0].topic, label);
        assert.equal(job.decisions.find((item) => item.table)?.table?.title, label);
        assert.equal((await fixture.restart().get(fixture.rawId)).job?.decisions[0].topic, label);
      }
    }
  });
});

test('intermediate labels preserve brackets through reload while formal titles stay single-line and link-safe', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const label = '[Growth] <Online>';
    const names = ['<private-title-marker>', ' private-title-marker ', 'private-title-marker\nOther'];
    let finalTitle = names[0];
    respond((input, strict) => {
      if (input.stage === 'pdf_topic_index') {
        assert(input.topics!.includes(label));
        return { assignments: input.topics!.map((topic) => ({ topic, title: topic === label ? finalTitle : topic })) };
      }
      const result = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      result.decisions[0].topic = ' ' + label + ' ';
      return result;
    });
    let fixture = await setup(provider);
    for (const [i, reason] of ['unsafe_title_characters', 'surrounding_whitespace', 'multiline_label'].entries()) {
      finalTitle = names[i];
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, 'failed');
      assert.equal(job.completedBatches, 1);
      assert.deepEqual(job.error?.details, { stage: 'pdf_topic_index', path: '$.assignments[0].title', reason });
      assert.doesNotMatch(await readFile(fixture.state, 'utf8'), /private-title-marker/u);
      fixture = { ...fixture, cleanup: fixture.restart() };
      const restored = (await fixture.cleanup.get(fixture.rawId)).job!;
      assert.equal(restored.decisions[0].topic, label);
      assert.equal(calls.length, 2 + i);
    }
    finalTitle = 'Online growth';
    await fixture.cleanup.start(fixture.rawId, range);
    await terminal(fixture, 'completed');
    const stored = JSON.parse(await readFile(fixture.state, 'utf8'));
    assert.equal(stored.batches[0][0].topic, label);
    assert.deepEqual(stored.index[0], { topic: label, title: 'Online growth' });
    assert.equal((await fixture.restart().get(fixture.rawId)).job?.status, 'completed');
    assert.deepEqual(
      calls.map((wire) => wire.response_format?.json_schema.name),
      ['pdf_cleanup', 'pdf_topic_index', 'pdf_topic_index', 'pdf_topic_index', 'pdf_topic_index', 'pdf_topic_write'],
    );
  });
});

test('explicit resume from a durable one-of-four old job never resends its saved first 48 decisions', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const content = Array.from({ length: 164 }, (_, i) => 'Independent original result ' + (i + 1)).join('\n');
    let fixture = await setup(provider, content);
    let sent = 0;
    respond((input, strict) => {
      const answer = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      sent++;
      if (sent !== 2) delete answer.decisions[0].reason;
      return answer;
    });
    await fixture.cleanup.start(fixture.rawId, range);
    assert.equal((await terminal(fixture, 'failed')).completedBatches, 0);
    fixture = { ...fixture, cleanup: fixture.restart() };
    await fixture.cleanup.start(fixture.rawId, range);
    const previous = await terminal(fixture, 'failed');
    assert.deepEqual(
      [previous.attempts, previous.completedBatches, previous.totalBatches, previous.decisions.length],
      [3, 1, 4, 48],
    );
    const before = JSON.parse(await readFile(fixture.state, 'utf8'));
    const savedIds = new Set<string>(before.batches[0].map((item: { id: string }) => item.id));
    fixture = { ...fixture, cleanup: fixture.restart() };
    assert.equal((await fixture.cleanup.get(fixture.rawId)).job?.attempts, 3);
    assert.equal(calls.length, 3);
    respond(defaultReply);
    await fixture.cleanup.start(fixture.rawId, range);
    const complete = await terminal(fixture, 'completed');
    assert.deepEqual([complete.attempts, complete.completedBatches, complete.decisions.length], [11, 4, 167]);
    const after = JSON.parse(await readFile(fixture.state, 'utf8'));
    assert.deepEqual(after.batches[0], before.batches[0]);
    const newWires = calls.slice(3).map((wire) => JSON.parse(wire.messages[1].content) as Call);
    assert.deepEqual(
      newWires.map((wire) => wire.stage),
      ['pdf_cleanup', 'pdf_cleanup', 'pdf_cleanup', 'pdf_topic_index', ...Array(4).fill('pdf_topic_write')],
    );
    assert(
      newWires
        .filter((wire) => wire.stage === 'pdf_cleanup')
        .flatMap((wire) => wire.units!)
        .every((unit) => !savedIds.has(unit.id)),
    );
  });
});

test('cleanup prompts distinguish synthetic institutional disclosures, mixed claims, chart axes and actual series', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const fixtureItems = [
      { text: 'A brighter world for everyone', decision: 'skip', reason: 'Slogan with no substantive claim' },
      {
        text: 'West Sound Institute reports 37 million active users in 2023',
        decision: 'keep',
        reason: 'Institutional self-report',
        topic: 'West Sound institutional disclosures',
      },
      {
        text: 'A market leader, West Sound reports activity in 23 regions since 2021',
        decision: 'keep',
        reason: 'Mixed language includes a specific self-reported fact',
        topic: 'West Sound institutional disclosures',
      },
      {
        text: 'May 2024 stratified survey, sample N=63 independent stores',
        decision: 'keep',
        reason: 'Dated method and sample',
        topic: 'Retail sample design',
      },
      { text: '800', decision: 'skip', reason: 'Isolated axis marker covered by complete figure description' },
      {
        text: '2022: 870 units; 2023: 920 units in the chart series',
        decision: 'keep',
        reason: 'Traceable chart data with unit and date',
        topic: 'Chart series',
      },
    ];
    respond((input, strict) => {
      if (input.stage === 'pdf_topic_index') return defaultReply(input, strict);
      assert(strict);
      return {
        decisions: input.units!.map((unit) => {
          const expected = fixtureItems.find((item) => item.text === unit.text);
          return {
            id: unit.id,
            decision: expected?.decision ?? 'skip',
            reason: expected?.reason ?? 'Synthetic fixture background',
            topic: expected?.topic ?? null,
            mergedInto: null,
            table: null,
          };
        }),
      };
    });
    const fixture = await setup(provider, fixtureItems.map((item) => item.text).join('\n'));
    await fixture.cleanup.start(fixture.rawId, range);
    const result = await terminal(fixture, 'completed');
    assert.equal(result.promptRevision, 5);
    for (const item of fixtureItems) {
      const record = result.decisions.find((decision) => decision.text === item.text);
      assert.deepEqual([record?.decision, record?.reason], [item.decision, item.reason]);
    }
    const system = calls[0].messages[0].content;
    assert.match(system, /不要按“关于”.*整页删除/u);
    assert.match(system, /机构自述.*具体规模.*自述边界.*同一单元兼有修辞和具体事实时保留/u);
    assert.match(system, /完整 R1 图解.*孤立轴刻度.*不要拼接散数字.*不按是否含数字/u);
    assert.match(system, /文字层和图解归同一主题.*仅完全相同才 merge/u);
    assert.match(
      calls[1].messages[0].content,
      /归组导航.*完整单元或精确子段.*文字层和页图重述可以共用标题.*不同主体或指标/u,
    );
  });
});

test('a completed revision-four checkpoint stays readable and explicit revision-five reuses its cleanup and index', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const fixture = await setup(provider);
    await fixture.cleanup.start(fixture.rawId, range);
    await terminal(fixture, 'completed');
    const legacy = JSON.parse(await readFile(fixture.state, 'utf8'));
    legacy.promptRevision = 4;
    legacy.attempts -= legacy.writing.length;
    delete legacy.writing;
    legacy.presentation = { completedBatches: 0, groups: [], parallel: [] };
    legacy.batches[0][0].reason = 'Saved earlier prompt result';
    const original = JSON.stringify(legacy, null, 2) + '\n';
    await writeFile(fixture.state, original);
    const restarted = fixture.restart();
    const old = (await restarted.get(fixture.rawId)).job!;
    assert.equal(old.promptRevision, 4);
    assert.equal(old.decisions[0].reason, 'Saved earlier prompt result');
    assert.equal(calls.length, 3);
    const findActive = fixture.drafts.findActiveForRaw.bind(fixture.drafts);
    fixture.drafts.findActiveForRaw = async () =>
      ({ id: randomUUID(), pdfInput: {} }) as Awaited<ReturnType<typeof findActive>>;
    await assert.rejects(restarted.start(fixture.rawId, range), { code: 'PDF_DRAFT_ACTIVE' });
    assert.equal(await readFile(fixture.state, 'utf8'), original);
    assert.equal(calls.length, 3);
    fixture.drafts.findActiveForRaw = findActive;
    respond(defaultReply);
    await restarted.start(fixture.rawId, range);
    const updated = await terminal({ ...fixture, cleanup: restarted }, 'completed');
    assert.equal(updated.promptRevision, 5);
    assert.equal(updated.reusedCleanupBatches, 1);
    assert.equal(updated.reusedIndexEntries, legacy.index.length);
    assert.equal(updated.attempts, 1);
    assert.equal(updated.decisions[0].reason, 'Saved earlier prompt result');
    assert.equal(await readFile(fixture.state.replace(/\.json$/u, '-prompt-v4.json'), 'utf8'), original);
    assert.deepEqual(
      calls.map((item) => item.response_format?.json_schema.name),
      ['pdf_cleanup', 'pdf_topic_index', 'pdf_topic_write', 'pdf_topic_write'],
    );
  });
});

test('saved fragment spans must cover the exact UTF-16 source and reject overlap, gaps and out-of-bounds spans', async () => {
  await withHttpProvider(async ({ provider, calls }) => {
    const text = '🧭 Pilot reached 82 stores; merchants reached 17. More source detail.';
    const fixture = await setup(provider, text);
    await fixture.cleanup.start(fixture.rawId, range);
    const job = await terminal(fixture, 'completed');
    const parts = job.fragments!.filter((fragment) => fragment.unitId === 'p1-content-1');
    assert.equal(parts.length, 3);
    assert.equal(parts.map((fragment) => fragment.text).join(''), text);
    for (const part of parts) assert.equal(part.text, text.slice(part.start, part.end));
    assert.equal(parts[0].end, text.indexOf(';') + 1);
    const original = await readFile(fixture.state, 'utf8');
    const requests = calls.length;
    for (const change of ['gap', 'overlap', 'outside', 'omission'] as const) {
      const altered = JSON.parse(original);
      if (change === 'omission') altered.fragments.pop();
      else if (change === 'outside') altered.fragments.at(-1).end = text.length + 1;
      else altered.fragments[1].start += change === 'gap' ? 1 : -1;
      await writeFile(fixture.state, JSON.stringify(altered));
      const restarted = fixture.restart();
      await assert.rejects(restarted.get(fixture.rawId), { code: 'PDF_CLEANUP_BASIS_CHANGED' });
      await assert.rejects(restarted.draft(fixture.rawId, range), { code: 'PDF_CLEANUP_BASIS_CHANGED' });
      assert.equal(calls.length, requests);
    }
    await writeFile(fixture.state, original);
    assert.equal((await fixture.restart().get(fixture.rawId)).job?.status, 'completed');
  });
});

test('strict topic writing rejects missing, cross-topic and unsupported claims and permits equivalent quantity notation', async () => {
  await withHttpProvider(async ({ provider, respondWriting }) => {
    const source = '预计华东下降12.5%，覆盖2.5万户。';
    const original = await setup(provider, 'Another topic figure', source);
    let fixture = original;
    for (const [scenario, reason] of [
      ['missing', 'invalid_shape'],
      ['cross-topic', 'invalid_shape'],
      ['no-source', 'missing_block_evidence'],
      ['wrong-value', 'protected_facts_changed'],
      ['wrong-sign', 'protected_facts_changed'],
      ['wrong-unit', 'protected_facts_changed'],
      ['wrong-scope', 'protected_facts_changed'],
      ['promotion', 'protected_omission'],
      ['equivalent', undefined],
    ] as const) {
      respondWriting((input) => {
        const response = defaultWriting(input);
        const topic = input.topics.find((item) => item.items.some((item) => item.text === source))!;
        const foreign = input.topics.find((item) => item.id !== topic.id)!.items[0];
        const [id] = Object.keys(response.topics[topic.id].coverage);
        const result = response.topics[topic.id];
        if (scenario === 'missing') delete result.coverage[id];
        if (scenario === 'cross-topic')
          result.coverage[foreign.id] = { action: 'included', blockIndex: 0, reason: null };
        if (scenario === 'no-source')
          result.coverage[id] = { action: 'duplicate', blockIndex: 0, reason: 'No included evidence' };
        if (scenario === 'wrong-value') result.blocks[0].text = source.replace('12.5', '12.6');
        if (scenario === 'wrong-sign') result.blocks[0].text = source.replace('下降', '增长');
        if (scenario === 'wrong-unit') result.blocks[0].text = source.replace('%', '个百分点');
        if (scenario === 'wrong-scope') result.blocks[0].text = source.replace('预计', '实际').replace('华东', '华南');
        if (scenario === 'promotion')
          result.coverage[id] = { action: 'promotion', blockIndex: null, reason: 'Fixture misclassification' };
        if (scenario === 'equivalent') result.blocks[0].text = '预测华东下降12.5%，覆盖25,000户。';
        return response;
      });
      await fixture.cleanup.start(fixture.rawId, range);
      const job = await terminal(fixture, reason ? 'failed' : 'completed');
      assert.equal(job.error?.details?.reason, reason);
      assert.equal(job.writing?.length, reason ? 0 : 1);
      if (reason)
        await assert.rejects(fixture.cleanup.draft(fixture.rawId, range), { code: 'PDF_CLEANUP_NOT_COMPLETE' });
      fixture = { ...fixture, cleanup: fixture.restart() };
    }
  });
});

test('topic writing removes a numbered heading only with its matching chapter reference, preserving a decimal measurement', () => {
  const request: WritingRequest = {
    stage: 'pdf_topic_write',
    topics: [
      {
        id: 't1',
        title: 'Regional distribution',
        items: [
          {
            id: 'p1-text-1',
            unitId: 'p1-text-1',
            page: 1,
            origin: 'text',
            kind: 'content',
            text: '3.2 地区分布趋于均衡',
          },
          {
            id: 'p1-content-1',
            unitId: 'p1-content-1',
            page: 1,
            origin: 'image',
            kind: 'content',
            text: '第二章「渠道数据」，3.2「地区分布趋于均衡」。',
          },
          {
            id: 'p1-text-2',
            unitId: 'p1-text-2',
            page: 1,
            origin: 'text',
            kind: 'content',
            text: '3.2 亿元为东区收入。',
          },
        ],
      },
    ],
  };
  const result: WritingResult = {
    topics: {
      t1: {
        blocks: [{ kind: 'fact', text: '渠道数据表明地区分布趋于均衡，东区收入为3.2亿元。' }],
        coverage: {
          'p1-text-1': { action: 'included', blockIndex: 0, reason: null },
          'p1-content-1': { action: 'duplicate', blockIndex: 0, reason: '同一章节标题' },
          'p1-text-2': { action: 'included', blockIndex: 0, reason: null },
        },
      },
    },
  };
  assert.deepEqual(readWriting(request, result, JSON.stringify(result)), result);
  const wrongValue = structuredClone(result);
  wrongValue.topics.t1.blocks[0].text = wrongValue.topics.t1.blocks[0].text.replace('3.2亿元', '3.1亿元');
  assert.throws(() => readWriting(request, wrongValue), { reason: 'protected_facts_changed' });
  const differentHeading = structuredClone(request);
  differentHeading.topics[0].items[1].text = '第二章「渠道数据」，3.2「另一节标题」。';
  assert.throws(() => readWriting(differentHeading, result), { reason: 'protected_facts_changed' });
});

test('topic writing inherits an era only for its cited dimension within a continuous source passage', () => {
  const topicTitle = '物流从1.0迈向2.0时代';
  const items: WritingRequest['topics'][number]['items'] = [
    {
      id: 'p1-text-1',
      unitId: 'p1-text-1',
      page: 1,
      origin: 'text',
      kind: 'content',
      text: '3.4 物流从 1.0 迈向 2.0 时代',
    },
    {
      id: 'p1-content-1',
      unitId: 'p1-content-1',
      page: 1,
      origin: 'image',
      kind: 'content',
      text: '3.4 物流从1.0迈向2.0时代。',
    },
    ...[
      '1.0时代的“采购”集中审批；',
      '“仓间调拨”通过中心仓。',
      '2.0时代对应的“采购”分区审批；',
      '“门店调拨”通过区域仓。',
    ].map((text, index) => ({
      id: 'p1-visuals-1-s' + (index + 1),
      unitId: 'p1-visuals-1',
      page: 1,
      origin: 'image' as const,
      kind: 'visuals' as const,
      text,
    })),
  ];
  const request: WritingRequest = { stage: 'pdf_topic_write', topics: [{ id: 't1', title: topicTitle, items }] };
  const result: WritingResult = {
    topics: {
      t1: {
        blocks: [
          topicTitle,
          items[2].text,
          items[4].text,
          '1.0时代的“仓间调拨”通过中心仓，2.0时代的“门店调拨”通过区域仓。',
        ].map((text) => ({ kind: 'fact', text })),
        coverage: {
          'p1-text-1': { action: 'included', blockIndex: 0, reason: null },
          'p1-content-1': { action: 'duplicate', blockIndex: 0, reason: '同页同标题' },
          'p1-visuals-1-s1': { action: 'included', blockIndex: 1, reason: null },
          'p1-visuals-1-s2': { action: 'included', blockIndex: 3, reason: null },
          'p1-visuals-1-s3': { action: 'included', blockIndex: 2, reason: null },
          'p1-visuals-1-s4': { action: 'included', blockIndex: 3, reason: null },
        },
      },
    },
  };
  assert.deepEqual(readWriting(request, result), result);
  const swapped = structuredClone(result);
  swapped.topics.t1.blocks[3].text = '2.0时代的“仓间调拨”通过中心仓，1.0时代的“门店调拨”通过区域仓。';
  assert.throws(() => readWriting(request, swapped), { reason: 'era_scope_changed' });
  const otherParent = structuredClone(request);
  otherParent.topics[0].items[3].unitId = 'p1-visuals-2';
  assert.throws(() => readWriting(otherParent, result), { reason: 'era_scope_changed' });
  const notSamePage = structuredClone(request);
  notSamePage.topics[0].items[1].page = 2;
  assert.throws(() => readWriting(notSamePage, result), { reason: 'protected_facts_changed' });
});

test('topic writing can omit structural headings and field labels but keeps attached facts', () => {
  const items: WritingRequest['topics'][number]['items'] = [
    '星河配送业务规模',
    '关于星河配送',
    '品类范围',
    '星河配送覆盖93家门店。',
  ].map((text, index) => ({
    id: 'p1-text-' + index,
    unitId: 'p1-text-' + index,
    page: 1,
    origin: 'text',
    kind: 'content',
    text,
  }));
  const request: WritingRequest = {
    stage: 'pdf_topic_write',
    topics: [
      { id: 't1', title: '星河配送业务规模', items },
      {
        id: 't2',
        title: '区域概况',
        items: [
          { id: 'p2-text-1', unitId: 'p2-text-1', page: 2, origin: 'text', kind: 'content', text: '第七章 区域概况。' },
        ],
      },
    ],
  };
  const result: WritingResult = {
    topics: {
      t1: {
        blocks: [{ kind: 'fact', text: '星河配送覆盖93家门店。' }],
        coverage: Object.fromEntries(
          items.map((item, i) => [
            item.id,
            i === 3
              ? { action: 'included', blockIndex: 0, reason: null }
              : { action: 'metadata', blockIndex: null, reason: '独立题头' },
          ]),
        ),
      },
      t2: { blocks: [], coverage: { 'p2-text-1': { action: 'metadata', blockIndex: null, reason: '章节标题' } } },
    },
  };
  assert.deepEqual(readWriting(request, result), result);
  for (const text of ['关于星河配送，覆盖94家门店。', '品类范围包括生鲜与药品。', '关于另一个品牌']) {
    const changed = structuredClone(request);
    changed.topics[0].items[1].text = text;
    assert.throws(() => readWriting(changed, result), { code: 'PDF_TOPIC_WRITE_INVALID' });
  }
});

test('topic writing omits a trailing footer number only with a same-page label and matching definition', () => {
  const request: WritingRequest = {
    stage: 'pdf_topic_write',
    topics: [
      {
        id: 't1',
        title: '指标释义',
        items: [
          {
            id: 'p2-text-1',
            unitId: 'p2-text-1',
            page: 2,
            origin: 'text',
            kind: 'content',
            text: '指标及释义 客单价：每笔订单平均金额 73',
          },
          {
            id: 'p2-content-1',
            unitId: 'p2-content-1',
            page: 2,
            origin: 'image',
            kind: 'content',
            text: '指标释义：客单价为每笔订单平均金额。',
          },
        ],
      },
    ],
  };
  const response: WritingResult = {
    topics: {
      t1: {
        blocks: [{ kind: 'fact', text: '客单价指每笔订单平均金额。' }],
        coverage: {
          'p2-text-1': { action: 'included', blockIndex: 0, reason: null },
          'p2-content-1': { action: 'duplicate', blockIndex: 0, reason: '同页释义' },
        },
      },
    },
  };
  const labels = confirmedPdfPageLabels([{ page: 2, origin: 'image', text: '页面页码为73。' }]);
  assert.deepEqual(readWriting(request, response, undefined, labels), response);
  assert.throws(() => readWriting(request, response), { reason: 'protected_facts_changed' });
  for (const change of ['cross-page', 'different-definition', 'real-value'] as const) {
    const altered = structuredClone(request);
    const [source, corroboration] = altered.topics[0].items;
    if (change === 'cross-page') corroboration.page = 3;
    if (change === 'different-definition') corroboration.text = '指标释义：件单价为每件商品平均金额。';
    if (change === 'real-value') source.text += '元';
    assert.throws(() => readWriting(altered, response, undefined, labels), { reason: 'protected_facts_changed' });
  }
});

test('topic writing accepts table labels, equivalent city tiers and human counts, and a corroborated split currency', () => {
  const makeItem = (text: string, i: number) => ({
    id: 'p1-text-' + i,
    unitId: 'p1-text-' + i,
    page: 1,
    origin: 'text' as const,
    kind: 'content' as const,
    text,
  });
  const study = [
    '执行时间 样本条件 样本量',
    '页面以三列表格呈现执行时间、样本条件和样本量；',
    '样本量N=12，年龄30至48岁。',
    '全国2—4线城市。',
  ].map(makeItem);
  const currency = ['覆盖超过1.2亿美', '元的消费支出。'].map((text, i) => makeItem(text, i + 4));
  const raw = currency.map((item) => item.text).join('\n');
  const next = adjacentPdfTextLines(
    currency.map((item, i) => ({
      ...item,
      kind: 'text',
      section: 'content',
      resultSha256: sha('fixture'),
      start: i ? currency[0].text.length + 1 : 0,
      end: i ? raw.length : currency[0].text.length,
    })),
    raw,
  );
  const request: WritingRequest = {
    stage: 'pdf_topic_write',
    topics: [
      { id: 't1', title: '样本条件', items: study },
      { id: 't2', title: '支出覆盖', items: currency },
    ],
  };
  const response: WritingResult = {
    topics: {
      t1: {
        blocks: [{ kind: 'fact', text: '样本量为12人，年龄30至48岁，来自全国二至四线城市。' }],
        coverage: Object.fromEntries(
          study.map((item, i) => [
            item.id,
            i < 2
              ? { action: 'metadata', blockIndex: null, reason: '表格版面' }
              : { action: 'included', blockIndex: 0, reason: null },
          ]),
        ),
      },
      t2: {
        blocks: [{ kind: 'fact', text: '覆盖超过1.2亿美元的消费支出。' }],
        coverage: Object.fromEntries(
          currency.map((item) => [item.id, { action: 'included', blockIndex: 0, reason: null }]),
        ),
      },
    },
  };
  assert.deepEqual(readWriting(request, response, undefined, undefined, next), response);
  assert.throws(() => readWriting(request, response), { reason: 'protected_facts_changed' });
  for (const replacement of ['样本量为12户', '全国二至五线']) {
    const changed = structuredClone(response);
    changed.topics.t1.blocks[0].text = changed.topics.t1.blocks[0].text.replace(
      replacement.includes('样本量') ? '样本量为12人' : '全国二至四线',
      replacement,
    );
    assert.throws(() => readWriting(request, changed, undefined, undefined, next), {
      reason: 'protected_facts_changed',
    });
  }
  const dataInLayout = structuredClone(request);
  dataInLayout.topics[0].items[0].text += '12人';
  assert.throws(() => readWriting(dataInLayout, response, undefined, undefined, next), {
    reason: 'protected_omission',
  });
});

test('strict presentation refuses narrower scope in both directions and preserves differing values, units and conditions', async () => {
  await withHttpProvider(async ({ calls, provider, respond, respondPresentation }) => {
    const pairs = [
      ['Retail study recorded 63 stores in total.', 'The retail study covered 63 stores overall.'],
      ['Sample A counted 76 stores, urban only.', 'Sample A counted 76 stores.'],
      ['Sample B counted 81 stores.', 'Sample B counted 81 stores, urban only.'],
      ['In 2025, 63 stores responded.', 'In 2026, 63 stores responded.'],
      ['华南地区共63家。', '华北地区共63家。'],
      ['Group C reported 63 stores.', 'Group C reported 63 households.'],
      ['Group D reported 64 stores.', 'Group D reported 63 stores.'],
      ['The qualitative survey involved 32 stores.', 'The quantitative survey involved 32 stores.'],
    ];
    respond((input, strict) => {
      if (input.stage !== 'pdf_cleanup') return defaultReply(input, strict);
      const normal = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      for (const [index, unit] of input.units!.entries()) {
        const topic = pairs.findIndex((pair) => pair.includes(unit.text));
        if (topic >= 0) normal.decisions[index].topic = 'Fixture topic ' + topic;
      }
      return normal;
    });
    respondPresentation((input) => ({
      presentation: Object.fromEntries(
        input.units!.map((unit) => {
          const pair = pairs.find((candidate) => candidate[0] === unit.text);
          return [
            unit.id,
            {
              representativeId: pair ? input.units!.find((candidate) => candidate.text === pair[1])!.id : null,
              reason: 'Proposed equivalent',
            },
          ];
        }),
      ),
    }));
    const fixture = await resumeRevisionFour(await setup(provider, pairs.flat().join('\n')));
    const job = await terminal(fixture, 'completed');
    assert.deepEqual(
      [job.presentation?.completedBatches, job.presentation?.groups.length, job.presentation?.parallel.length],
      [1, 1, 7],
    );
    const stored = new Map(job.decisions.map((item) => [item.id, item.text]));
    assert.deepEqual(
      job.presentation!.parallel.map((group) => [stored.get(group.memberIds[0]), stored.get(group.representativeId)]),
      pairs.slice(1),
    );
    assert(job.presentation!.parallel.every((group) => /完整保留.*并列展示/u.test(group.reason)));
    const presentation = calls.find((wire) => wire.response_format?.json_schema.name === 'pdf_presentation')!;
    const request = JSON.parse(presentation.messages[1].content) as Call;
    assert.equal(new Set(request.units!.map((unit) => unit.topic)).size, pairs.length);
    const keys = presentation.response_format!.json_schema.schema.properties.presentation;
    assert.deepEqual(
      keys.required,
      request.units!.map((unit) => unit.id),
    );
    assert.equal(keys.additionalProperties, false);
    assert.equal(
      job.decisions.filter((item) => pairs.flat().includes(item.text) && item.decision === 'keep').length,
      16,
    );
  });
});

test('only adjacent fragments of the same original passage can share conditions during presentation comparison', async () => {
  await withHttpProvider(async ({ provider, respond, respondPresentation }) => {
    const representative = 'The 2027 urban survey covered 63 stores and 28 households.';
    respond((input, strict) =>
      input.stage === 'pdf_topic_index'
        ? { assignments: input.topics!.map((topic) => ({ topic, title: 'Survey scope' })) }
        : defaultReply(input, strict),
    );
    respondPresentation((input) => {
      const target = input.units!.find((unit) => unit.text === representative)!;
      return {
        presentation: Object.fromEntries(
          input.units!.map((unit) => [
            unit.id,
            {
              representativeId: unit.origin === 'text' ? target.id : null,
              reason: 'Proposed evidence display',
            },
          ]),
        ),
      };
    });
    for (const samePassage of [true, false]) {
      const body =
        '1. The 2027 urban survey covered 63 stores;' + (samePassage ? ' ' : '\n') + '28 households also enrolled.';
      const fixture = await resumeRevisionFour(await setup(provider, representative, body));
      const job = await terminal(fixture, 'completed');
      assert.equal(job.presentation?.groups.length, samePassage ? 1 : 0);
      assert.equal(job.presentation?.parallel.length, samePassage ? 0 : 1);
      if (samePassage) assert.equal(job.fragments!.map((part) => part.text).join(''), body);
    }
  });
});

test('an explicit negation split over a single raw line break retains its scope', async () => {
  await withHttpProvider(async ({ provider, respond, respondPresentation }) => {
    const representative = '覆盖华东与华南，不包括华北。';
    respond((input, strict) =>
      input.stage === 'pdf_topic_index'
        ? { assignments: input.topics!.map((topic) => ({ topic, title: 'Coverage scope' })) }
        : defaultReply(input, strict),
    );
    respondPresentation((input) => {
      const target = input.units!.find((unit) => unit.text === representative)!;
      return {
        presentation: Object.fromEntries(
          input.units!.map((unit) => [
            unit.id,
            {
              representativeId: unit.origin === 'text' ? target.id : null,
              reason: 'Proposed scope',
            },
          ]),
        ),
      };
    });
    for (const [gap, accepted] of [
      ['\n', 1],
      ['\n\n', 0],
    ] as const) {
      const body = '覆盖华东与华南，不' + gap + '包括华北。';
      const fixture = await resumeRevisionFour(await setup(provider, representative, body));
      const job = await terminal(fixture, 'completed');
      assert.equal(job.presentation?.groups.length, accepted);
      assert.equal(job.presentation?.parallel.length, 1 - accepted);
      assert.equal(
        job.decisions
          .filter((item) => item.origin === 'text')
          .map((item) => item.text)
          .join(gap),
        body,
      );
    }
  });
});

test('presentation rejects missing or extra slots and invalid representative graphs before completing', async () => {
  await withHttpProvider(async ({ provider, respond, respondPresentation }) => {
    const content = ['Alpha one', 'Alpha two', 'Alpha three', 'Beta one', 'Beta two'];
    respond((input, strict) => {
      if (input.stage !== 'pdf_cleanup') return defaultReply(input, strict);
      const result = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      for (const [index, unit] of input.units!.entries()) {
        if (content.includes(unit.text)) result.decisions[index].topic = unit.text.split(' ')[0];
      }
      return result;
    });
    for (const scenario of [
      'missing',
      'extra',
      'duplicate',
      'self',
      'unknown',
      'cross-topic',
      'chain',
      'cycle',
    ] as const) {
      respondPresentation((input) => {
        const [a, b, c, d] = input.units!.map((unit) => unit.id);
        const result = defaultReply(input, true) as {
          presentation: Record<string, { representativeId: string | null; reason: string }>;
        };
        const entries = result.presentation;
        if (scenario === 'missing') delete entries[b];
        else if (scenario === 'extra') entries['private-id-marker'] = entries[a];
        else if (scenario === 'duplicate') {
          const escapedKey = '"\\u' + a.charCodeAt(0).toString(16).padStart(4, '0') + a.slice(1) + '"';
          return (
            '{"presentation":{' +
            escapedKey +
            ':' +
            JSON.stringify(entries[a]) +
            ',' +
            JSON.stringify(entries).slice(1) +
            '}'
          );
        } else {
          entries[a].representativeId =
            scenario === 'self' ? a : scenario === 'unknown' ? 'private-id-marker' : scenario === 'cross-topic' ? d : b;
          if (scenario === 'chain' || scenario === 'cycle') entries[b].representativeId = scenario === 'chain' ? c : a;
        }
        return result;
      });
      const fixture = await resumeRevisionFour(await setup(provider, content.join('\n')));
      const job = await terminal(fixture, 'failed');
      assert.equal(job.error?.code, 'PDF_CLEANUP_PRESENTATION');
      assert.equal(
        job.error?.details?.reason,
        scenario === 'missing'
          ? 'missing_input_key'
          : scenario === 'extra'
            ? 'unknown_input_key'
            : scenario === 'duplicate'
              ? 'duplicate_input_key'
              : 'invalid_representative',
      );
      assert.doesNotMatch(JSON.stringify(job.error), /private-id-marker/u);
      assert.equal(job.presentation?.completedBatches, 0);
      await assert.rejects(fixture.cleanup.draft(fixture.rawId, range), { code: 'PDF_CLEANUP_NOT_COMPLETE' });
    }
  });
});

test('topic index reduces batch size to fit full samples and resumes at the saved label boundary', async () => {
  await withHttpProvider(async ({ calls, provider, respond }) => {
    const samples = Array.from({ length: 22 }, (_, i) => 'Sample ' + i + ' ' + '门店研究'.repeat(224));
    let indexes = 0;
    respond((input, strict) => {
      if (input.stage === 'pdf_topic_index') {
        if (++indexes === 2) return { assignments: {} };
        return defaultReply(input, strict);
      }
      const result = defaultReply(input, strict) as { decisions: Array<Record<string, unknown>> };
      for (const [index, unit] of input.units!.entries()) {
        const sample = samples.indexOf(unit.text);
        if (sample >= 0) result.decisions[index].topic = '门店研究 ' + sample;
      }
      return result;
    });
    let fixture = await setup(provider, samples.join('\n'));
    await fixture.cleanup.start(fixture.rawId, range);
    await terminal(fixture, 'failed');
    const before = calls.length;
    fixture = { ...fixture, cleanup: fixture.restart() };
    await fixture.cleanup.get(fixture.rawId);
    assert.equal(calls.length, before);
    await fixture.cleanup.start(fixture.rawId, range);
    await terminal(fixture, 'completed');
    const wires = calls.filter((wire) => wire.response_format?.json_schema.name === 'pdf_topic_index');
    const inputs = wires.map((wire) => JSON.parse(wire.messages[1].content) as Call);
    assert(inputs[0].topics!.length < 16);
    assert.deepEqual(inputs[1], inputs[2]);
    assert(inputs.at(-1)!.existingBasis!.length > 0);
    const accepted = [inputs[0], ...inputs.slice(2)];
    assert.deepEqual(
      accepted
        .flatMap((input) => input.basis!.flatMap((item) => item.samples.map((unit) => unit.text)))
        .filter((text) => samples.includes(text)),
      samples,
    );
    assert(wires.every((wire) => Buffer.byteLength(wire.messages[1].content) <= 32 * 1024));
  });
});

test('cancelled writing ignores a late response and restart reuses only the completed writing batch', async () => {
  await withHttpProvider(async ({ calls, provider, respondWriting }) => {
    const dispatched = deferred();
    const release = deferred();
    let count = 0;
    respondWriting(async (input) => {
      if (++count === 2) {
        dispatched.resolve();
        await release.promise;
      }
      return defaultWriting(input);
    });
    let fixture = await setup(provider, Array.from({ length: 55 }, (_, i) => 'Fixture source ' + i).join('\n'));
    await fixture.cleanup.start(fixture.rawId, range);
    await dispatched.promise;
    const old = await fixture.cleanup.cancel(fixture.rawId);
    try {
      assert.equal(old.job?.status, 'cancelled');
      assert.equal(old.job?.writing?.length, 1);
      const durable = await readFile(fixture.state, 'utf8');
      release.resolve();
      const active = (fixture.cleanup as unknown as { active: Map<string, AbortController> }).active;
      for (let i = 0; i < 100 && active.has(fixture.rawId); i++) await delay(5);
      assert(!active.has(fixture.rawId));
      assert.equal(await readFile(fixture.state, 'utf8'), durable);
    } finally {
      release.resolve();
    }
    fixture = { ...fixture, cleanup: fixture.restart() };
    const before = calls.length;
    assert.equal((await fixture.cleanup.get(fixture.rawId)).job?.status, 'cancelled');
    assert.equal(calls.length, before);
    await fixture.cleanup.start(fixture.rawId, range);
    const done = await terminal(fixture, 'completed');
    assert.equal(done.writing?.length, 2);
    const wires = calls.filter((wire) => wire.response_format?.json_schema.name === 'pdf_topic_write');
    assert.equal(wires.length, 3);
    assert.notEqual(wires[0].messages[1].content, wires[2].messages[1].content);
    assert.equal(wires[1].messages[1].content, wires[2].messages[1].content);
  });
});

test('GET rechecks durable terminal state after asynchronous source reading, with no automatic request', async () => {
  for (const expected of ['failed', 'completed', 'cancelled'] as const) {
    const dispatched = deferred();
    const releaseResponse = deferred();
    let calls = 0;
    const provider: LlmProvider = {
      name: 'fixture',
      model: 'delayed',
      async complete(request): Promise<LlmCompletion> {
        calls++;
        dispatched.resolve();
        await releaseResponse.promise;
        const input = JSON.parse(request.user) as Call;
        const text = JSON.stringify(
          expected === 'failed'
            ? { decisions: null }
            : {
                decisions: input.units!.map((unit) => ({ id: unit.id, decision: 'skip', reason: 'fixture only' })),
              },
        );
        return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
      },
    };
    const fixture = await setup(provider);
    await fixture.cleanup.start(fixture.rawId, range);
    await dispatched.promise;
    const interrupted = (await fixture.restart().get(fixture.rawId)).job!;
    assert.equal(interrupted.error?.code, 'PDF_CLEANUP_INTERRUPTED');
    assert.equal(calls, 1);
    const paused = fixture.pauseNextRead();
    const pending = fixture.cleanup.get(fixture.rawId);
    await paused.entered.promise;
    try {
      if (expected === 'cancelled') await fixture.cleanup.cancel(fixture.rawId);
      releaseResponse.resolve();
      await terminal(fixture, expected);
      const active = (fixture.cleanup as unknown as { active: Map<string, AbortController> }).active;
      for (let i = 0; i < 100 && active.has(fixture.rawId); i++) await delay(5);
      assert(!active.has(fixture.rawId));
    } finally {
      releaseResponse.resolve();
      paused.release.resolve();
    }
    const view = (await pending).job!;
    assert.equal(view.status, expected);
    assert.equal(
      view.error?.code,
      expected === 'failed' ? 'PDF_CLEANUP_SCHEMA' : expected === 'cancelled' ? 'PDF_CLEANUP_CANCELLED' : undefined,
    );
    assert.equal(calls, 1);
  }
});
