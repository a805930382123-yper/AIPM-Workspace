import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rmdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { WritingRequest, WritingResult } from '../services/raw/pdf-topic-writing.ts';
import { pdfFixture } from './support/pdf01-fixture.ts';

type Unit = {
  id: string;
  page: number;
  text: string;
  origin: string;
  kind: string;
  unitId?: string;
  start?: number;
  end?: number;
};
type Call =
  | { stage: 'pdf_page_understanding'; page: number }
  | { stage: 'pdf_cleanup'; units: Unit[] }
  | { stage: 'pdf_presentation'; units: Array<Unit & { topic: string }> }
  | WritingRequest
  | {
      stage: 'pdf_topic_index';
      topics: string[];
      existing: string[];
      basis: Array<{ topic: string; samples: Unit[]; suggestedTopic?: string }>;
    };
type Tracked = Call & { bytes: number };
const key = 'synthetic-pdf02-test-key';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const range = (startPage: number, endPage: number) => ({ startPage, endPage });
const classify = (units: Unit[]) => ({
  decisions: units.map((unit) =>
    /纯宣传|Logo/u.test(unit.text)
      ? { id: unit.id, decision: 'skip', reason: '纯宣传，不含研究内容' }
      : {
          id: unit.id,
          decision: 'keep',
          reason: '保留研究数据、方法和说明',
          topic: /新主题/u.test(unit.text) ? '陌生渠道' : unit.page > 4 ? '区域数据' : '地区样本',
        },
  ),
});
function writerReply(call: WritingRequest, combine?: (text: string) => boolean): WritingResult {
  return {
    topics: Object.fromEntries(
      call.topics.map((topic) => {
        const groups = new Map<string, typeof topic.items>();
        const ids = new Set(topic.items.map((item) => item.id));
        for (const item of topic.items) {
          const key = combine?.(item.text)
            ? 'same-fact'
            : item.mergedInto && ids.has(item.mergedInto)
              ? item.mergedInto
              : item.id;
          const group = groups.get(key) ?? [];
          group.push(item);
          groups.set(key, group);
        }
        const arranged = [...groups.values()];
        return [
          topic.id,
          {
            blocks: arranged.map((group) => ({
              kind: 'fact',
              text: (group.find((item) => item.origin === 'image') ?? group[0]).text,
            })),
            coverage: Object.fromEntries(
              arranged.flatMap((group, blockIndex) =>
                group.map((item, index) => [
                  item.id,
                  {
                    action: index ? 'duplicate' : 'included',
                    blockIndex,
                    reason: index ? 'Same fixture fact' : null,
                  },
                ]),
              ),
            ),
          },
        ];
      }),
    ),
  };
}
function defaultReply(call: Call): unknown {
  if (call.stage === 'pdf_page_understanding') {
    return {
      blank: false,
      content: Array.from(
        { length: 5 },
        (_, i) => '第 ' + call.page + ' 页指标 ' + (i + 1) + ' 为 ' + (call.page * 5 + i) + ' 家门店。',
      ).join('\n'),
      visuals: '',
      inference: '',
      questions: [],
    };
  }
  if (call.stage === 'pdf_cleanup') return classify(call.units);
  if (call.stage === 'pdf_presentation')
    return {
      presentation: Object.fromEntries(
        call.units.map((unit) => [unit.id, { representativeId: null, reason: '不同依据，分别保留' }]),
      ),
    };
  if (call.stage === 'pdf_topic_write') return writerReply(call);
  return { assignments: call.topics.map((topic) => ({ topic, title: topic === '区域数据' ? '地区样本' : topic })) };
}

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf02-http-'));
  const calls: Tracked[] = [];
  let reply: (call: Call) => unknown | Promise<unknown> = defaultReply;
  const fakeErrors: string[] = [];
  const fake = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const { messages } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const user = messages[1].content;
      const wire: string = Array.isArray(user) ? user[0].text : user;
      const call = JSON.parse(wire) as Call;
      assert(
        ['pdf_page_understanding', 'pdf_cleanup', 'pdf_topic_index', 'pdf_presentation', 'pdf_topic_write'].includes(
          call.stage,
        ),
      );
      if (call.stage === 'pdf_page_understanding') {
        assert.match(user[1].image_url.url, /^data:image\/png;base64,/u);
        calls.push({ stage: call.stage, page: call.page, bytes: Buffer.byteLength(wire) });
      } else {
        assert.equal(typeof user, 'string');
        calls.push({ ...call, bytes: Buffer.byteLength(wire) });
      }
      const result = await reply(call);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              message: { content: typeof result === 'string' ? result : JSON.stringify(result) },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    } catch (error) {
      fakeErrors.push(String(error));
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end('{"error":{"message":"fixture rejected request"}}');
    }
  });
  const fakePort = await listen(fake);
  const config = path.join(root, 'provider.fixture');
  const configure = (model: string) =>
    writeFile(
      config,
      'FMCG_LLM_BASE_URL=http://127.0.0.1:' +
        fakePort +
        '/v1\nFMCG_LLM_MODEL=' +
        model +
        '\nFMCG_LLM_API_KEY=' +
        key +
        '\n',
    );
  await configure('fixture-pdf02');
  let child: ChildProcess | undefined;
  let base = '';
  let log = '';
  const request = async (url: string, input?: unknown, method = input === undefined ? 'GET' : 'POST') => {
    const response = await fetch(
      base + url,
      input === undefined
        ? { method }
        : input instanceof FormData
          ? { method, body: input }
          : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    );
    return (response.headers.get('content-type') ?? '').includes('application/json')
      ? { status: response.status, json: (await response.json()) as any }
      : { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  };
  const start = async () => {
    const reservation = http.createServer();
    const port = await listen(reservation);
    await close(reservation);
    base = 'http://127.0.0.1:' + port;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !/^(FMCG_|OPENAI_|ANTHROPIC_|GEMINI_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(
            name,
          ),
      ),
    );
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withoutInheritedEmbeddings({
        ...env,
        FMCG_DATA_DIR: root,
        FMCG_PORT: String(port),
        FMCG_LLM_CONFIG_FILE: config,
      }),
    });
    child.stdout?.on('data', (data) => {
      log += data;
    });
    child.stderr?.on('data', (data) => {
      log += data;
    });
    for (let i = 0; i < 600; i++) {
      if (child.exitCode !== null) break;
      if (
        await fetch(base + '/api/health').then(
          (res) => res.ok,
          () => false,
        )
      )
        return;
      await delay(25);
    }
    assert.fail('真实隔离服务未启动：' + log);
  };
  const upload = async (bytes: Buffer, title: string) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)]), 'fixture.pdf');
    form.set('metadata', JSON.stringify({ title, sourceType: 'report' }));
    const result = await request('/api/raw/import', form);
    assert.equal(result.status, 201, JSON.stringify(result));
    return result.json.raw;
  };
  const wait = async (route: string, status: string, predicate = (_job: any) => true) => {
    for (let i = 0; i < 600; i++) {
      const result = await request(route);
      assert.equal(result.status, 200, JSON.stringify(result));
      const job = result.json.job;
      if (job?.status === status && predicate(job)) return result.json;
      if (job?.status === 'failed' && status === 'completed') assert.fail(JSON.stringify(job));
      await delay(15);
    }
    assert.fail(route + ' did not reach ' + status);
  };
  try {
    await start();
  } catch (error) {
    await stop();
    await close(fake);
    throw error;
  }
  return {
    root,
    calls,
    request,
    upload,
    wait,
    start,
    stop,
    configure,
    setReply: (fn: typeof reply) => {
      reply = fn;
    },
    close: async () => {
      await stop();
      await close(fake);
      assert.deepEqual(fakeErrors, []);
    },
  };
}

function confirm(draft: any, selectedPageIds: string[]) {
  return {
    baseRevision: draft.revision,
    selectedPageIds,
    outcomeDigest: draft.outcomeDigest,
    idempotencyKey: randomUUID(),
  };
}

test('public PDF cleanup preserves text/image provenance, keeps substantive preface and table continuation, edits and selectively commits', async () => {
  const api = await fixture();
  try {
    api.setReply((call) => {
      if (call.stage === 'pdf_topic_write')
        return writerReply(call, (text) => /Research method.*300 stores/u.test(text));
      if (call.stage !== 'pdf_page_understanding') return defaultReply(call);
      const items = [
        '主办方 Logo 与纯宣传\n序言研究结论：2025 年华南 120 家门店。\n方法为三阶段抽样。\n共同结论：渠道偏好存在差异。',
        '续表新增华东 2026 年 155 家。\n脚注：单位为门店，基数是有效样本。\n新主题：乡村合作渠道。\nResearch method included 300 stores.',
        '共同结论：渠道偏好存在差异。\n不同口径：2026 年华南 128 家门店。',
      ];
      return { blank: false, content: items[call.page - 1], visuals: '', inference: '', questions: [] };
    });
    const bytes = pdfFixture(['text', 'scan', 'vector'], () => 'Research method: 300 stores');
    const raw = await api.upload(bytes, '合成区域研究');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    const cleanup = pdf + '/cleanup';
    const original = await api.request(pdf + '/original');
    assert.deepEqual(original.bytes, bytes);
    assert.equal((await api.request(cleanup)).json.job, null);
    assert.equal((await api.request(cleanup, range(3, 1))).json.error.code, 'PDF_RANGE_INVALID');
    const missing = await api.request(cleanup, range(1, 3));
    assert.equal(missing.status, 409);
    assert.deepEqual(missing.json.error.details.missingPages, [1, 2, 3]);
    assert.equal(api.calls.length, 0);
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    assert.equal((await api.request(cleanup, range(1, 3))).status, 202);
    const cleaned = (await api.wait(cleanup, 'completed')).job;
    assert.deepEqual(cleaned.counts, { kept: 9, merged: 1, skipped: 1 });
    assert.equal(cleaned.writing.length, 1);
    assert.equal(cleaned.decisions.find((item: any) => item.decision === 'skip').reason, '纯宣传，不含研究内容');
    assert.equal(cleaned.decisions.find((item: any) => item.decision === 'merge').page, 3);
    const before = (await api.request('/api/wiki')).json;
    const created = await api.request(cleanup + '/draft', range(1, 3));
    assert.equal(created.status, 200, JSON.stringify(created));
    const draftId = created.json.job.draftId;
    assert.equal((await api.request(cleanup + '/draft', range(1, 3))).json.job.draftId, draftId);
    const draftRoute = '/api/drafts/' + draftId;
    const initial = (await api.request(draftRoute)).json;
    assert.equal(initial.raw.bodySha256, raw.bodySha256);
    assert.equal(initial.pdfInput.assetSha256, sha(bytes));
    assert.equal(initial.humanReview, undefined);
    const page = initial.pages.find((item: any) => item.title === '地区样本');
    const text = page.pdfEvidence.find((item: any) => item.kind === 'text');
    assert.equal(raw.body.slice(text.start, text.end), text.text);
    assert(
      page.pdfEvidence.some((item: any) => item.kind === 'image' && item.page === 2 && !Object.hasOwn(item, 'start')),
    );
    const change = initial.maintenance.changes.find((item: any) => item.candidate.title === page.title);
    assert.match(change.candidate.body, /序言研究结论[\s\S]*120 家[\s\S]*155 家[\s\S]*基数是有效样本[\s\S]*128 家/u);
    assert.match(change.candidate.body, /PDF 页图 AI 解读/u);
    assert.match(
      change.candidate.body,
      /### AI 整理[\s\S]*Research method included 300 stores.*PDF 页图 AI 解读.*#page=1.*#page=2/u,
    );
    assert.doesNotMatch(change.candidate.body, /Research method: 300 stores/u);
    assert(page.pdfEvidence.some((item: any) => item.kind === 'text' && item.text === 'Research method: 300 stores'));
    assert(
      page.pdfEvidence.some(
        (item: any) => item.kind === 'image' && item.text === 'Research method included 300 stores.',
      ),
    );
    assert.equal((change.candidate.body.match(/共同结论/gu) ?? []).length, 1);
    assert.match(change.candidate.body, /共同结论.*#page=1.*#page=3/u);
    assert.doesNotMatch(change.candidate.body, /Logo|新主题/u);
    const unreviewed = confirm(initial, [page.pageId]);
    const { outcomeDigest: _digest, ...strictOld } = unreviewed;
    assert.equal((await api.request(draftRoute + '/confirm', strictOld)).json.error.code, 'PDF_OUTCOME_REQUIRED');
    const editedBody =
      change.candidate.body.replace(/\[第 \d+ 页\]\(\/api\/raw\/[^)]+\)/gu, '原页依据') + '\n人工补充：仅限本样本。\n';
    const edit = await api.request('/api/knowledge/drafts/' + draftId + '/changes/review', {
      baseRevision: initial.revision,
      changeId: change.changeId,
      body: editedBody,
    });
    assert.equal(edit.status, 200, JSON.stringify(edit));
    assert.notEqual(edit.json.outcomeDigest, initial.outcomeDigest);
    const outdated = await api.request(draftRoute + '/confirm', { ...unreviewed, baseRevision: edit.json.revision });
    assert.equal(outdated.json.error.code, 'REVIEW_CONTENT_CHANGED');
    assert.deepEqual((await api.request('/api/wiki')).json, before);
    const intent = confirm(edit.json, [page.pageId]);
    const written = await api.request(draftRoute + '/confirm', intent);
    assert.equal(written.status, 201, JSON.stringify(written));
    const replay = await api.request(draftRoute + '/confirm', intent);
    assert.equal(replay.json.operationId, written.json.operationId);
    assert.equal(replay.json.reused, true);
    const topic = (await api.request('/api/wiki/' + written.json.wikiIds[0])).json;
    const source = (await api.request('/api/wiki/' + written.json.sourceId)).json;
    assert.deepEqual(topic.sources, [raw.id]);
    assert.match(topic.body, /人工补充：仅限本样本/u);
    assert(topic.body.startsWith(editedBody));
    assert.match(topic.body, /PDF 页级依据[\s\S]*#page=1[\s\S]*#page=2[\s\S]*#page=3/u);
    assert.match(source.body, /页图内容为 AI 解读/u);
    for (const record of [topic, source]) {
      assert.equal(record.pdfDerivations[0].assetSha256, sha(bytes));
      assert.equal(record.pdfDerivations[0].evidence.length, page.pdfEvidence.length);
      assert(record.pdfDerivations[0].evidence.some((item: any) => item.page === 3 && item.resultSha256.length === 64));
    }
    assert.equal((await api.request(draftRoute)).json.status, 'pending_confirmation');
    assert(!(await api.request('/api/wiki')).json.items.some((item: any) => item.title === '陌生渠道'));
    assert.deepEqual((await api.request(pdf + '/original')).bytes, bytes);
    assert.deepEqual(
      api.calls.map((call) => call.stage),
      [...Array(3).fill('pdf_page_understanding'), 'pdf_cleanup', 'pdf_topic_index', 'pdf_topic_write'],
    );
  } finally {
    await api.close();
  }
});

test('cross-batch PDF continuation retains new columns, units, conflicting rows, unresolved shape and page citations', async () => {
  const api = await fixture();
  try {
    api.setReply((call) => {
      if (call.stage === 'pdf_topic_index' || call.stage === 'pdf_presentation' || call.stage === 'pdf_topic_write')
        return defaultReply(call);
      if (call.stage === 'pdf_cleanup') {
        const proposed = classify(call.units);
        return {
          decisions: proposed.decisions.map((item, i) => {
            const text = call.units[i].text;
            const role = text.startsWith('| 区域')
              ? 'header'
              : text.startsWith('|')
                ? 'row'
                : text.startsWith('表注')
                  ? 'note'
                  : undefined;
            return role ? { ...item, table: { title: '样本续表', role } } : item;
          }),
        };
      }
      const cells = [
        '| 区域 | 样本（家） |\n| 华南 | 120 |\n表注：2025 年，仅统计有效样本。',
        '序言：方法为抽样调查。',
        '另见研究说明。',
        '其他研究口径另列。',
        '| 华东 | 155 |\n| 区域 | 样本（家） | 回收率 |\n| 华北 | 160 | 80% |\n表注：新增回收率口径是 2026 年。',
        '| 区域 | 样本（万人） |\n| 西南 | 3 |\n| 西北 | 44 | 75% | 17 |',
      ];
      return {
        blank: false,
        content: cells[call.page - 1],
        visuals: '',
        inference: call.page === 1 ? '可能存在地域差异。' : '',
        questions: call.page === 1 ? ['核对样本是否互斥。'] : [],
      };
    });
    const raw = await api.upload(pdfFixture(Array.from({ length: 6 }, () => 'scan')), '合成续表');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    const cleanup = pdf + '/cleanup';
    await api.request(cleanup, range(1, 6));
    const cleaned = await api.wait(cleanup, 'completed');
    assert.equal(cleaned.job.completedBatches, 2);
    const generated = await api.request(cleanup + '/draft', range(1, 6));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const draft = (await api.request('/api/drafts/' + generated.json.job.draftId)).json;
    assert.equal(draft.pages.length, 1);
    const body: string = draft.maintenance.changes[0].candidate.body;
    assert.equal((body.match(/样本续表/gu) ?? []).length, 1);
    assert.match(body, /表头依据：.*#page=1.*#page=5/u);
    assert.match(body, /\| 区域 \| 样本（家） \| 回收率 \| 原页依据 \|/u);
    assert.match(body, /\| 华南 \| 120 \| 该页未列 \|.*#page=1/u);
    assert.match(body, /\| 华东 \| 155 \| 该页未列 \|.*#page=5/u);
    assert.match(body, /\| 华北 \| 160 \| 80% \|.*#page=5/u);
    assert.match(body, /不同列口径，单独列示。/u);
    assert.match(body, /\| 区域 \| 样本（万人） \| 原页依据 \|/u);
    assert.match(body, /\| 西南 \| 3 \|.*#page=6/u);
    assert.match(body, /表注：.*2026 年.*#page=5/u);
    assert.doesNotMatch(body, /表注：表注/u);
    assert.match(body, /列关系待核：.*西北.*44.*75%.*17.*#page=6/u);
    assert.match(body, /### AI 推断[\s\S]*可能存在地域差异[\s\S]*### 待核问题[\s\S]*核对样本是否互斥/u);
    assert(
      api.calls
        .filter((call) => call.stage === 'pdf_topic_write')
        .every((call) =>
          call.topics
            .flatMap((topic) => topic.items)
            .every((unit) => !['inference', 'question'].includes(unit.kind) && !/^\||^表注/u.test(unit.text)),
        ),
    );
    assert(draft.pages[0].pdfEvidence.some((item: any) => item.page === 6 && item.kind === 'image'));
  } finally {
    await api.close();
  }
});

test('one PDF unit contributes exact fragments to different topics while cross-page coverage consolidates', async () => {
  const api = await fixture();
  const original = 'Pilot reached 173 stores in North in 2027; merchants reached 61.';
  const image =
    '🧭 Pilot covered 173 stores in North in 2027; new users totalled 875. Method used qualitative interviews.';
  try {
    api.setReply((call) => {
      if (call.stage === 'pdf_page_understanding')
        return {
          blank: false,
          content:
            call.page === 1
              ? 'Additional explanatory source.\n页面标注“研究说明”，页码59。\nWe are uniquely wonderful.'
              : image,
          visuals: '',
          inference: '',
          questions: [
            'Should the very long research note or an independent verification be reviewed before presentation?',
          ],
        };
      if (call.stage === 'pdf_cleanup') {
        const result = classify(call.units);
        result.decisions.forEach((item, i) => {
          if (/页码|uniquely wonderful/u.test(call.units[i].text)) item.topic = 'Page furniture';
        });
        return result;
      }
      if (call.stage === 'pdf_topic_index') {
        const ordinary = call.basis.find((item) => item.topic === '地区样本');
        assert.equal(ordinary?.samples[0].kind, 'content');
        return {
          assignments: Object.fromEntries(
            call.basis.map(({ topic, samples: [item] }) => [
              topic,
              topic === 'Page furniture'
                ? topic
                : /173/u.test(item.text)
                  ? 'Pilot coverage'
                  : /merchants/u.test(item.text)
                    ? 'Merchant count'
                    : /users/u.test(item.text)
                      ? 'New users'
                      : /qualitative/u.test(item.text)
                        ? 'Sample method'
                        : 'Other sources',
            ]),
          ),
        };
      }
      if (call.stage === 'pdf_topic_write') {
        const result = writerReply(call, (text) => /173 stores/u.test(text));
        const noise = call.topics.find((topic) => topic.title === 'Page furniture');
        if (noise)
          result.topics[noise.id] = {
            blocks: [],
            coverage: Object.fromEntries(
              noise.items.map((item) => [
                item.id,
                {
                  action: /页码/u.test(item.text) ? 'metadata' : 'promotion',
                  blockIndex: null,
                  reason: 'No business fact',
                },
              ]),
            ),
          };
        return result;
      }
      return defaultReply(call);
    });
    const bytes = Buffer.from(
      pdfFixture(['text', 'scan'], () => original)
        .toString('latin1')
        .replaceAll('/MediaBox [0 0 200 200]', '/MediaBox [0 0 900 200]'),
      'latin1',
    );
    const raw = await api.upload(bytes, 'Exact fragment scope');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    const cleanup = pdf + '/cleanup';
    assert.equal((await api.request(cleanup, range(1, 2))).status, 202);
    const done = (await api.wait(cleanup, 'completed')).job;
    assert.equal(done.promptRevision, 5);
    assert.equal(done.writing.length, 2);
    const dispositions = done.writing.flatMap((result: WritingResult) =>
      Object.values(result.topics).flatMap((topic) => Object.values(topic.coverage)),
    );
    assert(dispositions.some((item: { action: string }) => item.action === 'metadata'));
    assert(dispositions.some((item: { action: string }) => item.action === 'promotion'));
    const parents = new Map<string, string>(done.decisions.map((item: any) => [item.id, item.text]));
    for (const id of new Set<string>(done.fragments.map((item: any) => item.unitId))) {
      const source = parents.get(id)!;
      const parts: Array<{ start: number; end: number; text: string }> = done.fragments.filter(
        (item: any) => item.unitId === id,
      );
      assert.equal(parts.map((part) => part.text).join(''), source);
      for (const part of parts) assert.equal(part.text, source.slice(part.start, part.end));
    }
    for (const part of done.fragments) {
      if (part.origin === 'text') assert.equal(raw.body.slice(part.rawStart, part.rawEnd), part.text);
      else assert(!Object.hasOwn(part, 'rawStart') && !Object.hasOwn(part, 'rawEnd'));
    }
    const generated = await api.request(cleanup + '/draft', range(1, 2));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const draftId = generated.json.job.draftId;
    const draftRoute = '/api/drafts/' + draftId;
    const draft = (await api.request(draftRoute)).json;
    const candidates = new Map<string, string>(
      draft.maintenance.changes.map((item: any) => [item.candidate.title, item.candidate.body]),
    );
    assert(!candidates.has('Page furniture'));
    assert.match(
      candidates.get('Pilot coverage')!,
      /### AI 整理[\s\S]*173 stores.*PDF 页图 AI 解读.*#page=1.*#page=2/u,
    );
    assert.doesNotMatch(
      candidates.get('Pilot coverage')!,
      /reached 173|merchants reached 61|new users totalled 875|qualitative/u,
    );
    assert.match(candidates.get('Merchant count')!, /merchants reached 61/u);
    assert.match(candidates.get('New users')!, /new users totalled 875/u);
    assert.match(candidates.get('Sample method')!, /Method used qualitative interviews/u);
    const pilot = draft.pages.find((item: any) => item.title === 'Pilot coverage');
    const merchant = draft.pages.find((item: any) => item.title === 'Merchant count');
    const rawEvidence = pilot.pdfEvidence.find((item: any) => item.kind === 'text');
    assert.equal(raw.body.slice(rawEvidence.start, rawEvidence.end), original);
    assert.equal(merchant.pdfEvidence[0].unitId, rawEvidence.unitId);
    assert(
      pilot.pdfEvidence.some(
        (item: any) => item.kind === 'image' && item.text === image && !Object.hasOwn(item, 'start'),
      ),
    );
    const draftFile = path.join(api.root, 'drafts', draftId + '.json');
    const saved = await readFile(draftFile);
    const changed = JSON.parse(saved.toString());
    const forged = changed.pages.find((item: any) => item.title === 'Merchant count').pdfEvidence[0];
    forged.text = 'X' + forged.text.slice(1);
    await writeFile(draftFile, JSON.stringify(changed));
    assert.equal((await api.request(draftRoute)).json.error.code, 'STORAGE_CORRUPT');
    await writeFile(draftFile, saved);
    const confirmed = await api.request(draftRoute + '/confirm', confirm(draft, [pilot.pageId, merchant.pageId]));
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed));
    const pages = await Promise.all((confirmed.json.wikiIds as string[]).map((id) => api.request('/api/wiki/' + id)));
    assert.equal(pages.length, 2);
    assert(
      pages.every((page) =>
        page.json.pdfDerivations[0].evidence.some((item: any) => item.unitId === rawEvidence.unitId),
      ),
    );
    assert.deepEqual((await api.request(pdf + '/original')).bytes, bytes);
  } finally {
    await api.close();
  }
});

test('range readiness, dropped or distinct merged units, durable restart, explicit retry and late cancellation', async () => {
  const api = await fixture();
  let release: (() => void) | undefined;
  try {
    api.setReply((call) =>
      call.stage === 'pdf_page_understanding' && call.page === 6 ? 'invalid' : defaultReply(call),
    );
    const raw = await api.upload(pdfFixture(Array.from({ length: 6 }, () => 'scan')), '合成恢复案例');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'failed');
    const cleanup = pdf + '/cleanup';
    assert.deepEqual((await api.request(cleanup, range(1, 6))).json.error.details.missingPages, [6]);
    api.setReply((call) => {
      if (call.stage !== 'pdf_cleanup') return defaultReply(call);
      return { decisions: classify(call.units).decisions.slice(1) };
    });
    await api.request(cleanup, range(1, 5));
    assert.equal((await api.wait(cleanup, 'failed')).job.error.code, 'PDF_CLEANUP_COVERAGE');
    api.setReply((call) => {
      if (call.stage !== 'pdf_cleanup') return defaultReply(call);
      const result = classify(call.units);
      return {
        decisions: [
          ...result.decisions.slice(0, 1),
          { ...result.decisions[1], decision: 'merge', mergedInto: result.decisions[0].id },
          ...result.decisions.slice(2),
        ],
      };
    });
    await api.request(cleanup, range(1, 5));
    assert.equal((await api.wait(cleanup, 'failed')).job.error.code, 'PDF_CLEANUP_DUPLICATE');
    const calls = () => api.calls.filter((call) => call.stage === 'pdf_cleanup');
    let dispatched!: () => void;
    const sent = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.setReply(async (call) => {
      if (call.stage === 'pdf_cleanup' && call.units[0].page === 5) {
        dispatched();
        await held;
      }
      return defaultReply(call);
    });
    await api.request(cleanup, range(1, 5));
    await sent;
    const inFlight = (await api.request(cleanup)).json.job;
    assert.deepEqual([inFlight.completedBatches, inFlight.attempts], [1, 4]);
    await api.stop();
    release!();
    await api.start();
    const prior = calls().length;
    const restored = (await api.request(cleanup)).json.job;
    assert.deepEqual(
      [restored.status, restored.completedBatches, restored.attempts, restored.error.code],
      ['failed', 1, 4, 'PDF_CLEANUP_INTERRUPTED'],
    );
    await delay(50);
    assert.equal(calls().length, prior);
    await api.configure('different-model');
    assert.equal((await api.request(cleanup, range(1, 5))).json.error.code, 'PDF_CLEANUP_PROVIDER_CHANGED');
    assert.equal(calls().length, prior);
    await api.configure('fixture-pdf02');
    let cancelling!: () => void;
    const cancellingSent = new Promise<void>((resolve) => {
      cancelling = resolve;
    });
    const cancellingHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.setReply(async (call) => {
      if (call.stage === 'pdf_cleanup') {
        cancelling();
        await cancellingHold;
      }
      return defaultReply(call);
    });
    assert.equal((await api.request(cleanup, range(1, 5))).status, 202);
    await cancellingSent;
    assert.equal((await api.request(cleanup, range(1, 5))).status, 202);
    assert.equal((await api.request(cleanup, range(1, 4))).json.error.code, 'PDF_CLEANUP_BUSY');
    assert.equal((await api.request(cleanup + '/cancel', {})).json.job.status, 'cancelled');
    release!();
    await delay(100);
    const cancelled = (await api.request(cleanup)).json.job;
    assert.deepEqual([cancelled.status, cancelled.completedBatches, cancelled.attempts], ['cancelled', 1, 5]);
    api.setReply(defaultReply);
    await api.request(cleanup, range(1, 5));
    const done = (await api.wait(cleanup, 'completed')).job;
    assert.deepEqual([done.startPage, done.endPage, done.completedBatches, done.attempts], [1, 5, 2, 8]);
    assert.deepEqual(
      calls().map((call) => call.units[0].page),
      [1, 1, 1, 5, 5, 5],
    );
    const generated = await api.request(cleanup + '/draft', range(1, 5));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const draft = (await api.request('/api/drafts/' + generated.json.job.draftId)).json;
    assert.deepEqual([draft.pdfInput.startPage, draft.pdfInput.endPage, draft.pdfInput.pageCount], [1, 5, 6]);
    assert(draft.pages.every((page: any) => page.pdfEvidence.every((unit: any) => unit.page <= 5)));
  } finally {
    release?.();
    await api.close();
  }
});

test('PDF R1 result and asset changes block draft/confirm, with no formal Wiki writes', async () => {
  const api = await fixture();
  try {
    const bytes = pdfFixture(['scan']);
    const raw = await api.upload(bytes, '合成防变案例');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    const cleanup = pdf + '/cleanup';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    await api.request(cleanup, range(1, 1));
    await api.wait(cleanup, 'completed');
    const generated = await api.request(cleanup + '/draft', range(1, 1));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const route = '/api/drafts/' + generated.json.job.draftId;
    const draft = (await api.request(route)).json;
    const intent = confirm(draft, [draft.pages[0].pageId]);
    const count = api.calls.length;
    const wiki = (await api.request('/api/wiki')).json;
    const r1file = path.join(api.root, 'state', 'raw-pdf', raw.id, 'manifest.json');
    const original = await readFile(r1file);
    const altered = JSON.parse(original.toString());
    altered.results[0].understanding.content += '\n改动内容';
    await writeFile(r1file, JSON.stringify(altered));
    assert.equal((await api.request(cleanup, range(1, 1))).json.error.code, 'PDF_CLEANUP_BASIS_CHANGED');
    assert.equal((await api.request(route + '/confirm', intent)).json.error.code, 'PDF_EVIDENCE_CHANGED');
    await writeFile(r1file, original);
    const asset = path.join(api.root, 'knowledge', 'raw', 'assets', raw.assetId + '.pdf');
    const bad = Buffer.from(bytes);
    bad[bad.length - 1] ^= 1;
    await writeFile(asset, bad);
    assert.equal((await api.request(route + '/confirm', intent)).json.error.code, 'PDF_ASSET_CHANGED');
    await writeFile(asset, bytes);
    assert.deepEqual((await api.request('/api/wiki')).json, wiki);
    assert.equal(api.calls.length, count);
    assert.deepEqual((await api.request(pdf + '/original')).bytes, bytes);
  } finally {
    await api.close();
  }
});

test('PDF cleanup rejects restricted sources, known secret wire data and provider-supplied locator overrides', async () => {
  const api = await fixture();
  try {
    const raw = await api.upload(pdfFixture(['scan']), '合成权限案例');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    const cleanup = pdf + '/cleanup';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    const count = api.calls.length;
    const rawFile = path.join(api.root, 'knowledge', 'raw', 'reports', raw.id + '.md');
    const rawBefore = await readFile(rawFile, 'utf8');
    await writeFile(rawFile, rawBefore.replace(/^---\r?\n/u, '---\norigin: {kind: meeting}\n'));
    assert.equal((await api.request(cleanup, range(1, 1))).json.error.code, 'MEETING_SOURCE_RESTRICTED');
    assert.equal(api.calls.length, count);
    await writeFile(rawFile, rawBefore);
    const r1File = path.join(api.root, 'state', 'raw-pdf', raw.id, 'manifest.json');
    const original = await readFile(r1File);
    const altered = JSON.parse(original.toString());
    altered.results[0].understanding.content = key;
    await writeFile(r1File, JSON.stringify(altered));
    await api.request(cleanup, range(1, 1));
    assert.equal((await api.wait(cleanup, 'failed')).job.error.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    assert.equal(api.calls.length, count);
    assert(
      !(await readFile(path.join(api.root, 'state', 'raw-pdf', raw.id, 'cleanup-1-1.json'), 'utf8')).includes(key),
    );
    await writeFile(r1File, original);
    await api.request(cleanup, range(1, 1));
    assert.equal(api.calls.length, count);

    const second = await api.upload(pdfFixture(['scan']), '合成结果边界');
    const next = '/api/raw/' + second.id + '/pdf';
    await api.request(next + '/understand', {});
    await api.wait(next, 'completed');
    api.setReply((call) => {
      if (call.stage !== 'pdf_cleanup') return defaultReply(call);
      const value = classify(call.units);
      return { decisions: [{ ...value.decisions[0], reason: key }, ...value.decisions.slice(1)] };
    });
    await api.request(next + '/cleanup', range(1, 1));
    assert.equal((await api.wait(next + '/cleanup', 'failed')).job.error.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    api.setReply((call) => {
      if (call.stage !== 'pdf_cleanup') return defaultReply(call);
      const value = classify(call.units);
      return {
        decisions: [{ ...value.decisions[0], page: 99, text: '伪造原文', origin: 'text' }, ...value.decisions.slice(1)],
      };
    });
    await api.request(next + '/cleanup', range(1, 1));
    const failed = (await api.wait(next + '/cleanup', 'failed')).job;
    assert.equal(failed.error.code, 'PDF_CLEANUP_SCHEMA');
    assert.deepEqual(failed.decisions, []);
    assert(
      !(await readFile(path.join(api.root, 'state', 'raw-pdf', second.id, 'cleanup-1-1.json'), 'utf8')).includes(key),
    );
  } finally {
    await api.close();
  }
});

test('PDF formal transaction resumes its frozen evidence after a disk-phase failure; manual updates retain the lineage', async () => {
  const api = await fixture();
  try {
    const raw = await api.upload(pdfFixture(['scan']), '合成正式恢复');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    const cleanup = pdf + '/cleanup';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    await api.request(cleanup, range(1, 1));
    await api.wait(cleanup, 'completed');
    const generated = await api.request(cleanup + '/draft', range(1, 1));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const route = '/api/drafts/' + generated.json.job.draftId;
    const draft = (await api.request(route)).json;
    const intent = confirm(draft, [draft.pages[0].pageId]);
    const log = path.join(api.root, 'knowledge', 'logs', 'wiki.jsonl');
    await mkdir(log);
    const broken = await api.request(route + '/confirm', intent);
    assert.equal(broken.status, 500, JSON.stringify(broken));
    const operation = broken.json.error.details.operationId;
    assert.equal((await api.request('/api/wiki-commits/' + operation)).json.status, 'failed');
    const requests = api.calls.length;
    await api.stop();
    await rmdir(log);
    await api.start();
    const completed = (await api.request('/api/wiki-commits/' + operation)).json;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.writtenWikiIds.length, 2);
    assert.equal((await api.request(route)).json.status, 'confirmed');
    assert.equal((await api.request(route + '/confirm', intent)).json.operationId, operation);
    const topic = (await api.request('/api/wiki')).json.items.find((item: any) => item.type !== 'source');
    const current = (await api.request('/api/wiki/' + topic.id)).json;
    assert.equal(current.pdfDerivations[0].evidence.length, 5);
    const updated = await api.request(
      '/api/wiki/' + topic.id,
      {
        ...current,
        baseRevision: current.revision,
        body: current.body + '\n补充人工背景。',
        sources: [],
        pdfDerivations: [],
      },
      'PUT',
    );
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.deepEqual(updated.json.sources, [raw.id]);
    assert.deepEqual(updated.json.pdfDerivations, current.pdfDerivations);
    assert.equal(api.calls.length, requests);
  } finally {
    await api.close();
  }
});

test('62-page real HTTP model chain classifies 310 distinct units in bounded page batches, keeps tail, then writes one reviewed theme', async () => {
  const api = await fixture();
  try {
    const bytes = pdfFixture(Array.from({ length: 62 }, (_, i) => (i % 2 ? 'scan' : 'vector')));
    const raw = await api.upload(bytes, '合成 62 页资料');
    const pdf = '/api/raw/' + raw.id + '/pdf';
    const cleanup = pdf + '/cleanup';
    await api.request(pdf + '/understand', {});
    await api.wait(pdf, 'completed');
    await api.request(cleanup, range(1, 62));
    const view = (await api.wait(cleanup, 'completed')).job;
    assert.equal(view.decisions.length, 310);
    assert.deepEqual(view.counts, { kept: 310, merged: 0, skipped: 0 });
    const batches = api.calls.filter((item) => item.stage === 'pdf_cleanup');
    const indexes = api.calls.filter((item) => item.stage === 'pdf_topic_index');
    assert.equal(batches.length, 16);
    assert.equal(indexes.length, 1);
    assert(
      batches.every(
        (call) =>
          call.units.length <= 48 && call.bytes <= 33 * 1024 && call.units.at(-1)!.page - call.units[0].page <= 3,
      ),
    );
    assert.deepEqual(
      indexes.map((item) => item.topics),
      [['地区样本', '区域数据']],
    );
    assert(indexes.every((call) => call.bytes < 1024));
    const presentations = api.calls.filter((item) => item.stage === 'pdf_topic_write');
    assert.equal(view.attempts, 24);
    assert.equal(presentations.length, 7);
    assert.equal(view.writing.length, 7);
    assert.equal(
      new Set(presentations.flatMap((item) => item.topics.flatMap((topic) => topic.items.map((unit) => unit.id)))).size,
      310,
    );
    assert(
      presentations.every(
        (item) =>
          item.topics.length <= 4 &&
          item.topics.flatMap((topic) => topic.items).length <= 48 &&
          item.bytes <= 24 * 1024,
      ),
    );
    const count = api.calls.length;
    const generated = await api.request(cleanup + '/draft', range(1, 62));
    assert.equal(generated.status, 200, JSON.stringify(generated));
    const route = '/api/drafts/' + generated.json.job.draftId;
    const draft = (await api.request(route)).json;
    assert.equal(draft.pages.length, 1);
    assert.equal(draft.pages[0].pdfEvidence.length, 310);
    assert.equal(draft.pages[0].pdfEvidence.at(-1).page, 62);
    assert.match(draft.maintenance.changes[0].candidate.body, /第 62 页指标 5 为 314 家门店.*#page=62/u);
    const wrote = await api.request(route + '/confirm', confirm(draft, [draft.pages[0].pageId]));
    assert.equal(wrote.status, 201, JSON.stringify(wrote));
    const wiki = (await api.request('/api/wiki/' + wrote.json.wikiIds[0])).json;
    assert.equal(wiki.pdfDerivations[0].evidence.length, 310);
    assert.match(wiki.body, /第 62 页指标 5 为 314 家门店/u);
    assert.equal(api.calls.length, count);
    assert.deepEqual((await api.request(pdf + '/original')).bytes, bytes);
    console.log(
      'PDF02 62-page receipt',
      JSON.stringify({
        understanding: 62,
        units: 310,
        batches: batches.length,
        batchMaxBytes: Math.max(...batches.map((call) => call.bytes)),
        indexCalls: indexes.length,
        indexMaxBytes: indexes[0].bytes,
        tail: draft.pages[0].pdfEvidence.at(-1).unitId,
        totalCalls: count,
      }),
    );
  } finally {
    await api.close();
  }
});
