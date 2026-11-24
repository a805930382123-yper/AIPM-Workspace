import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { buildRawContentForAI } from '../../services/raw/media-context.ts';
import { RawStore } from '../../services/raw/store.ts';
import { identifyWebImages } from '../../services/raw/web-material.ts';
import { maintenanceReply } from '../support/compat01-maintenance-reply.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr02-http-'));
const rawStore = new RawStore(root);
const secret = 'sk-rawocr02-fake-network-key';
const imageOnly = '磷光环扣';
const cleanOnly = '夜班核查窗';
const dirty = /(?:DIRTY_|sk-rawocr02-fake-network-key)/u;
const format = (markdown, extra = {}) => ({ should_skip: false, image_type: 'flowchart', summary: `图摘要\n${'摘要内容'.repeat(12)}`, markdown, confidence: 'medium', warnings: ['右侧局部模糊'], ...extra });
const requests = [];
const imageAttempts = new Map();
let activeImages = 0;
let maxActiveImages = 0;
let failPlanning = true;
const backendFailures = [];

const fake = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const wire = JSON.parse(Buffer.concat(chunks));
    const system = wire.messages[0].content;
    const user = wire.messages[1].content;
    const incoming = typeof user === 'string' ? user : user[0].text;
    const payload = JSON.parse(incoming.split('\n').at(-1));
    requests.push({ wire, system, incoming, payload });
    assert.doesNotMatch(incoming, dirty);
    const reply = (content, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(status === 200 ? { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }] } : content));
    };
    if (payload.stage === 'media_vlm_extraction') {
      activeImages++;
      maxActiveImages = Math.max(maxActiveImages, activeImages);
      response.once('close', () => activeImages--);
      const key = `${payload.article_title}/${payload.image_index}`;
      const attempt = (imageAttempts.get(key) ?? 0) + 1;
      imageAttempts.set(key, attempt);
      await delay(55);
      if (payload.article_title === '批量配图') {
        if (payload.image_index === 1 && attempt === 1) return reply({ error: { message: 'Rate limited' } }, 429);
        if (payload.image_index === 1 && attempt === 2) return reply('{invalid');
        if (payload.image_index === 2 && wire.response_format.type === 'json_schema')
          return reply({ error: { param: 'response_format', message: 'json_schema is unsupported' } }, 400);
        if (payload.image_index === 3 && attempt <= 2) return reply(format('不会被保存。', { confidential_extra: secret }));
        if (payload.image_index === 4) return reply(format('无效展示文本', { should_skip: true, image_type: 'decorative' }));
        if (payload.image_index === 5) return reply(format('```markdown\n```'));
      }
      if (payload.article_title === '门店配图报告' && payload.image_index === 5)
        return reply({ error: { message: secret } }, 503);
      const text = ['门店配图报告', '返修保留图片'].includes(payload.article_title) ? `先核对${imageOnly}，再登记出库。` : `本地验证图片 ${payload.image_index}。`;
      return reply(format('```markdown\n' + text + '\n\n```text\n内部围栏\n```\n```'));
    }
    if (Array.isArray(payload)) {
      const facts = payload.filter((atom) => /本日门店图前|本日门店图后|夜班核查窗|磷光环扣/u.test(atom.text));
      return reply({ version: 2, facts: facts.map((atom) => ({ atomId: atom.id, kind: 'fact' })), questions: [], sourceNotes: [] });
    }
    if (payload.factUnits) {
      if (failPlanning) {
        failPlanning = false;
        return reply('{invalid');
      }
      return reply({ version: 3, document: { title: '门店配图报告', main_topic: '门店图文依据', source_level: 'D' }, pages: [{ title: '门店配图查验指标', type: 'metric', category: 'metric', factUnitIds: payload.factUnits.map(({ id }) => id), questionUnitIds: [] }] });
    }
    if (payload.stage === 'maintenance') return reply(maintenanceReply(incoming));
    if (payload.stage === 'outline') return reply({ version: 1, sections: [{ id: 'evidence', title: '配图业务依据', question: '依据有哪些？', factIds: payload.facts.map((item) => item.id), questionIds: [] }], excluded: [] });
    if (payload.stage === 'writing') return reply({ version: 1, orientation: '核对图文依据。', sections: [{ id: 'evidence', title: '配图业务依据', question: '依据有哪些？', blocks: payload.facts.map((item) => ({ type: 'paragraph', text: item.text, role: item.kind === 'ambiguous' ? 'needs_verification' : 'source_supported', factIds: [item.id], ...(item.kind === 'ambiguous' ? { reason: '按原句核对。' } : {}) })) }] });
    if (payload.stage === 'quality') return reply({ version: 1, findings: [] });
    if (Array.isArray(payload.rawFragments)) {
      if (!payload.rawFragments.length) return reply({ version: 1, sections: [], citations: [], needsRaw: [{ rawId: payload.availableRawIds[0], reason: '核对图片词', query: imageOnly }] });
      const [fragment] = payload.rawFragments;
      if (payload.question.startsWith('已移除')) {
        assert.ok(!fragment.images?.some((entry) => entry.quote.includes(imageOnly) || entry.quote.includes(cleanOnly)));
        return reply({ version: 1, sections: [{ kind: 'insufficient', text: '当前 Raw 正文未提供该图片。', citationIds: [] }], citations: [], needsRaw: [] });
      }
      const picture = fragment.images.find((entry) => entry.quote.includes(imageOnly));
      assert.ok(picture, 'query found the image-only term');
      assert.equal(fragment.images.some((entry) => entry.quote.includes(cleanOnly)), !payload.question.startsWith('已改转录'));
      if (payload.question.startsWith('已改转录')) assert.match(fragment.quote, /本日门店图前记录/u);
      const start = picture.start + picture.quote.indexOf(imageOnly);
      return reply({ version: 1, sections: [{ kind: 'fact', text: `图片使用${imageOnly}。`, citationIds: ['picture'] }], citations: [{ id: 'picture', kind: 'raw', recordId: payload.question.includes('伪造') ? fragment.rawId : picture.mediaId, quote: imageOnly, start, end: start + imageOnly.length }], needsRaw: [] });
    }
    throw new Error('Unexpected request stage');
  } catch (error) {
    backendFailures.push(error);
    response.writeHead(500).end();
  }
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');

let child;
try {
  const canvas = createCanvas(2400, 1200);
  const draw = canvas.getContext('2d');
  draw.fillStyle = '#f4f0e8';
  draw.fillRect(0, 0, canvas.width, canvas.height);
  draw.fillStyle = '#123';
  draw.fillRect(100, 120, 700, 400);
  const jpeg = canvas.toBuffer('image/jpeg', 85);
  const sha256 = createHash('sha256').update(jpeg).digest('hex');
  const originals = path.join(root, 'knowledge', 'raw', 'web-images');
  await mkdir(originals, { recursive: true });
  await writeFile(path.join(originals, sha256), jpeg);
  const metric = { effectiveCharCount: 30, nonEmptyLineCount: 3, shortLineRatio: 0, gibberishRatio: 0, layoutDispersion: 0, chartSignalScore: 0, avgConfidence: null, qualityScore: 100 };
  async function seed(title, statuses) {
    const body = '长'.repeat(275) + '。\n本日门店图前记录😃。\n' + statuses.map((_, i) => {
      const index = i + 1;
      return `【来源图片 ${index}】\n${index === 1 ? '【图片 OCR 转录（需核对）】\nDIRTY_LEGACY\n【转录结束】\n' : ''}`;
    }).join('') + '本日门店图后记录😄。\n' + '尾'.repeat(270);
    const raw = await rawStore.create({ title, sourceType: 'article', sourceName: '隔离测试来源', tags: ['门店'], body, webImages: statuses.map((_, i) => ({ start: body.indexOf(`【来源图片 ${i + 1}】`), sourceUrl: 'https://example.invalid/test.jpg', label: '', mime: 'image/jpeg', sha256, status: 'transcribed' })) });
    const images = identifyWebImages(raw.id, raw.webImages);
    for (const [i, image] of images.entries()) {
      const routeStatus = statuses[i];
      await rawStore.saveMediaArtifact(raw.id, image.mediaId, { routeStatus, routeReasons: [], metrics: metric, ocrRawText: `DIRTY_${routeStatus}_${i}`, ...(routeStatus === 'ocr_ready' ? { ocrCleanText: `请核对${cleanOnly}是否开启。` } : {}) });
    }
    return { raw, images, file: path.join(root, 'knowledge', 'raw', 'articles', `${raw.id}.md`) };
  }
  const batch = await seed('批量配图', Array(5).fill('needs_vlm'));
  const flow = await seed('门店配图报告', ['ocr_ready', 'needs_vlm', 'failed', 'skipped', 'needs_vlm']);
  const initialBytes = await readFile(flow.file);
  const sample = '代码示例\n```text\n【图片 OCR 转录（需核对）】\n原始代码示例仍须保留\n【转录结束】\n```';
  assert.equal(buildRawContentForAI({ body: sample }, []).body, sample);

  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_LLM_/iu.test(key)));
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], env: { ...env, FMCG_PORT: String(port), FMCG_DATA_DIR: root, FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env'), FMCG_LLM_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`, FMCG_LLM_MODEL: 'fake-vision', FMCG_LLM_API_KEY: secret } });
  const base = `http://127.0.0.1:${port}`;
  const api = async (route, input, expected = 200, method = 'POST') => {
    const response = await fetch(base + route, { ...(input === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }), signal: AbortSignal.timeout(25000) });
    const text = await response.text();
    assert.equal(response.status, expected, `${route}: ${text}`);
    return JSON.parse(text);
  };
  let healthy = false;
  for (let i = 0; i < 150 && !healthy; i++) {
    assert.equal(child.exitCode, null);
    healthy = await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false);
    if (!healthy) await delay(80);
  }
  assert.ok(healthy);
  const batchRoute = `/api/raw/${batch.raw.id}/media`;
  const readOnly = await api(batchRoute);
  assert.equal(requests.length, 0);
  assert.doesNotMatch(JSON.stringify(readOnly), /ocrRawText|DIRTY_/u);
  const period = await api(`${batchRoute}/parse-vlm-batch`, {});
  const result = period.items.map(({ artifact }) => artifact);
  assert.deepEqual(result.map((item) => item.routeStatus), ['vlm_done', 'vlm_done', 'failed', 'skipped', 'skipped']);
  assert.ok(maxActiveImages >= 2 && maxActiveImages <= 3, `observed in-flight ${maxActiveImages}`);
  assert.deepEqual(result[0].vlmAttempts, ['json_schema:LLM_RATE_LIMITED', 'json_schema:MEDIA_JSON_INVALID', 'json_schema:ok']);
  assert.deepEqual(result[1].vlmAttempts, ['json_schema:LLM_PROVIDER_ERROR', 'json_object:ok']);
  assert.deepEqual(result[2].vlmAttempts, ['json_schema:MEDIA_SCHEMA_INVALID', 'json_schema:MEDIA_SCHEMA_INVALID']);
  assert.ok(result[2].vlmError);
  assert.equal(result[3].vlmSummary, undefined);
  assert.equal(result[4].vlmMarkdown, undefined);
  assert.match(result[0].vlmMarkdown, /```text\n内部围栏\n```/u);
  assert.equal([...result[0].vlmSummary].length, 40);
  assert.ok(!result[0].vlmSummary.includes('\n'));
  assert.doesNotMatch(JSON.stringify(period), dirty);

  const first = requests.find(({ payload }) => payload.image_index === 1);
  assert.equal(first.wire.temperature, 0.1);
  assert.equal(first.wire.max_tokens, 1536);
  assert.equal(first.wire.response_format.json_schema.strict, true);
  assert.equal(first.wire.response_format.json_schema.schema.required.length, 6);
  const data = first.wire.messages[1].content[1].image_url.url.split(',')[1];
  const scaled = await loadImage(Buffer.from(data, 'base64'));
  assert.equal(scaled.width, 1800);
  assert.equal(scaled.height, 900);
  assert.ok([...first.payload.context_before].length <= 250);
  assert.ok([...first.payload.context_after].length <= 250);
  assert.deepEqual(await readFile(path.join(originals, sha256)), jpeg);
  assert.deepEqual((await rawStore.getMediaArtifacts(batch.raw.id)).map((item) => item.routeStatus), result.map((item) => item.routeStatus));
  let count = requests.length;
  await api(`${batchRoute}/${batch.images[0].mediaId}/parse-vlm`, {});
  assert.equal(requests.length, count);
  await api(`${batchRoute}/${batch.images[0].mediaId}/parse-vlm`, { force: true });
  assert.equal(requests.length, ++count);
  const retry = await api(`${batchRoute}/${batch.images[2].mediaId}/parse-vlm`, {});
  assert.equal(retry.routeStatus, 'vlm_done');
  assert.equal(requests.length, ++count);
  const selected = await api(`${batchRoute}/parse-vlm-batch`, { mediaIds: [batch.images[2].mediaId] });
  assert.deepEqual(selected.items.map((item) => item.artifact.mediaId), [batch.images[2].mediaId]);
  assert.equal(requests.length, count);

  const rawRoute = `/api/raw/${flow.raw.id}`;
  const wait = async (jobId) => {
    for (let i = 0; i < 200; i++) {
      const job = await api(`/api/extraction-jobs/${jobId}`);
      if (job.status !== 'running' && job.execution === 'settled') return job;
      await delay(60);
    }
    assert.fail('extraction did not settle');
  };
  const start = await api(`${rawRoute}/extract`, {}, 202);
  const failure = await wait(start.jobId);
  assert.equal(failure.status, 'failed', JSON.stringify(failure));
  const checkpoint = await new ExtractionCheckpointStore(root).get(start.jobId);
  assert.ok(checkpoint.mediaInputSha256 && checkpoint.completedChunks.length > 0);
  assert.equal(failure.checkpoint.validatedChunks, checkpoint.completedChunks.length);
  const mediaCount = requests.filter(({ payload }) => payload.stage === 'media_vlm_extraction').length;
  const factsCount = requests.filter(({ payload }) => Array.isArray(payload)).length;
  const resumableImage = (await rawStore.getMediaArtifacts(flow.raw.id)).find((item) => item.mediaId === flow.images[1].mediaId);
  await rawStore.saveMediaArtifact(flow.raw.id, resumableImage.mediaId, { ...resumableImage, vlmMarkdown: '续跑前解析版本已变。' });
  const incompatible = await api(`${rawRoute}/extract`, {}, 409);
  assert.equal(incompatible.error.code, 'LLM_CHECKPOINT_INCOMPATIBLE');
  await rawStore.saveMediaArtifact(flow.raw.id, resumableImage.mediaId, resumableImage);
  const resumed = await api(`${rawRoute}/extract`, {}, 202);
  assert.equal(resumed.jobId, start.jobId);
  const completed = await wait(start.jobId);
  assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.equal(requests.filter(({ payload }) => payload.stage === 'media_vlm_extraction').length, mediaCount);
  assert.equal(requests.filter(({ payload }) => Array.isArray(payload)).length, factsCount);
  const draftRoute = `/api/drafts/${completed.draftId}`;
  let draft = await api(draftRoute);
  assert.doesNotMatch(JSON.stringify(draft.pages), dirty);
  const evidence = draft.pages[0].source_evidence;
  const cited = evidence.find((item) => item.media && item.quote.includes(imageOnly));
  assert.equal(cited.media.mediaId, flow.images[1].mediaId);
  assert.equal(cited.media.imageIndex, 2);
  assert.equal(cited.rawId, flow.raw.id);
  assert.ok(evidence.some((item) => item.media?.imageIndex === 1 && item.quote.includes(cleanOnly)));
  for (const terms of ['图前', '图后']) {
    const quote = evidence.find((item) => !item.media && item.quote.includes(terms));
    assert.equal(flow.raw.body.slice(quote.start, quote.end), quote.quote);
  }
  const changeId = draft.maintenance.changes[0].changeId;
  const reviewRoute = `/api/knowledge/drafts/${draft.id}/changes/review`;
  draft = await api(reviewRoute, { baseRevision: draft.revision, changeId, decision: 'accept' });
  draft = await api(reviewRoute, { baseRevision: draft.revision, changeId, confirmed: true, digest: draft.changeDigests[changeId] });
  const confirm = { baseRevision: draft.revision, selectedPageIds: [draft.pages[0].pageId], idempotencyKey: randomUUID() };
  assert.deepEqual((await api('/api/wiki')).items, []);
  const image = (await rawStore.getMediaArtifacts(flow.raw.id)).find((item) => item.mediaId === cited.media.mediaId);
  await rawStore.saveMediaArtifact(flow.raw.id, image.mediaId, { ...image, vlmMarkdown: '解析版本已变。' });
  const stale = await api(`${draftRoute}/confirm`, confirm, 409);
  assert.ok(['REVIEW_SOURCE_CHANGED', 'EVIDENCE_STALE'].includes(stale.error.code));
  assert.deepEqual((await api('/api/wiki')).items, []);
  await rawStore.saveMediaArtifact(flow.raw.id, image.mediaId, image);
  const committed = await api(`${draftRoute}/confirm`, confirm, 201);
  assert.ok(committed.wikiIds.length > 0);
  const formal = await api(`/api/wiki/${committed.wikiIds[0]}`);
  assert.ok(formal.body.includes(`/media/${cited.media.mediaId}?textSha256=${cited.media.textSha256}`));
  assert.deepEqual(await readFile(flow.file), initialBytes);
  const reread = await api(rawRoute);
  assert.equal(reread.bodySha256, flow.raw.bodySha256);
  assert.equal(reread.bodyRevision, flow.raw.bodyRevision);

  const ask = async (prefix) => api('/api/knowledge/answers', { requestId: randomUUID(), question: `${prefix}门店配图查验指标：${imageOnly}是什么？` });
  const answer = await ask('');
  assert.equal(answer.status, 'completed', JSON.stringify(answer));
  const ref = answer.citations[0];
  assert.equal(ref.recordId, flow.raw.id);
  assert.equal(ref.media.mediaId, image.mediaId);
  assert.equal(ref.quote, imageOnly);
  await api(`/api/knowledge/answers/${answer.id}/citations/${ref.id}`);
  const forged = await ask('伪造');
  assert.equal(forged.status, 'failed', JSON.stringify(forged));
  assert.equal(forged.error.code, 'ANSWER_CITATION_INVALID');
  const deep = await seed('门店配图深度整理', ['ocr_ready']);
  const deepJob = await api(`/api/raw/${deep.raw.id}/extract`, { mode: 'deep' }, 202);
  const deepDone = await wait(deepJob.jobId);
  assert.equal(deepDone.status, 'completed', JSON.stringify(deepDone));
  const deepDraft = await api(`/api/drafts/${deepDone.draftId}`);
  assert.ok(deepDraft.structuredNote.sections.length);
  assert.ok(deepDraft.pages[0].source_evidence.some((entry) => entry.media?.mediaId === deep.images[0].mediaId));
  assert.equal(requests.filter(({ payload }) => payload.stage === 'media_vlm_extraction').length, mediaCount);

  const patch = (raw, body) => api(`/api/raw/${raw.id}/body`, { body, expectedBodySha256: raw.bodySha256, expectedBodyRevision: raw.bodyRevision ?? 0 }, 200, 'PATCH');
  const blockers = await Promise.allSettled([
    (async () => {
      const fixture = await seed('返修保留图片', ['failed', 'needs_vlm']);
      const body = fixture.raw.body.replace('【来源图片 1】', '【来源图片 1（原图已撤下）】');
      const edited = await patch(fixture.raw, body);
      assert.equal(edited.body, body);
      const saved = await api(`/api/raw/${edited.id}/media/${fixture.images[1].mediaId}/parse-vlm`, {});
      const calls = requests.filter(({ payload }) => payload.article_title === fixture.raw.title);
      assert.ok(calls.length > 0);
      assert.ok(calls.every(({ payload }) => !payload.context_before.includes('DIRTY_LEGACY')), 'old OCR leaked to an adjacent image');
      assert.equal(saved.routeStatus, 'vlm_done');
      const mediaRoute = `/api/raw/${edited.id}/media/${fixture.images[1].mediaId}/parse-vlm`;
      let noMarker = edited;
      for (const [changed, replacement] of ['DIRTY_LEGACY。', 'DIRTY_REWORDED', 'DIRTY_REPLACEMENT\n本日门店图前的转录替换行'].entries()) {
        const editedBody = fixture.raw.body.replace('【来源图片 1】', '').replace('DIRTY_LEGACY', replacement);
        noMarker = await patch(noMarker, editedBody);
        const requestIndex = requests.length;
        const parsed = await api(mediaRoute, { force: true });
        assert.ok(requests.slice(requestIndex).every(({ incoming }) => !dirty.test(incoming)), `edited orphan OCR variant ${changed + 1} reached VLM`);
        assert.equal(parsed.routeStatus, 'vlm_done');
      }
      const editedBytes = await readFile(fixture.file);
      const job = await api(`/api/raw/${edited.id}/extract`, {}, 202);
      const complete = await wait(job.jobId);
      assert.equal(complete.status, 'completed', JSON.stringify(complete));
      const repairedDraft = await api(`/api/drafts/${complete.draftId}`);
      assert.doesNotMatch(JSON.stringify(repairedDraft.pages), /DIRTY_|转录替换行/u);
      const refs = repairedDraft.pages.flatMap((page) => page.source_evidence);
      assert.ok(refs.some((ref) => ref.media?.mediaId === fixture.images[1].mediaId && ref.quote.includes(imageOnly)));
      assert.ok(refs.every((ref) => !ref.media || ref.media.imageIndex === 2));
      for (const text of ['图前', '图后']) {
        const quote = refs.find((ref) => !ref.media && ref.quote.includes(text));
        assert.equal(noMarker.body.slice(quote.start, quote.end), quote.quote);
      }
      assert.deepEqual(await readFile(fixture.file), editedBytes);
      const code = '```text\n【来源图片 2】\n【图片 OCR 转录（需核对）】\n普通代码示例\n【转录结束】\n```\n';
      const moved = await patch(noMarker, code + noMarker.body.replace('【来源图片 2】\n', '').replace('本日门店图后记录', '左侧正文【来源图片 2 · 移动并改名】右侧正文。本日门店图后记录'));
      const movedBytes = await readFile(fixture.file);
      assert.equal((await api(mediaRoute, { force: true })).routeStatus, 'vlm_done');
      assert.ok(requests.at(-1).payload.context_before.endsWith('左侧正文'));
      assert.ok(requests.at(-1).payload.context_after.startsWith('右侧正文'));
      assert.deepEqual(await readFile(fixture.file), movedBytes);
      await patch(moved, moved.body + '\n【来源图片 2 · 重复】');
      const callsBefore = requests.filter(({ payload }) => payload.article_title === fixture.raw.title).length;
      assert.equal((await api(mediaRoute, { force: true }, 409)).error.code, 'RAW_MEDIA_NOT_ANCHORED');
      assert.equal((await api(`/api/raw/${edited.id}/media`)).items.length, 0);
      assert.equal(requests.filter(({ payload }) => payload.article_title === fixture.raw.title).length, callsBefore);
    })(),
    (async () => {
      const fixture = await seed('返修孤立图片', ['ocr_ready', 'needs_vlm']);
      const body = '本日门店图前记录，仅保留新的文字。';
      const edited = await patch(fixture.raw, body);
      assert.equal(edited.body, body);
      const bytes = await readFile(fixture.file);
      const job = await api(`/api/raw/${edited.id}/extract`, {}, 202);
      const done = await wait(job.jobId);
      assert.equal(done.status, 'completed', JSON.stringify(done));
      const generated = await api(`/api/drafts/${done.draftId}`);
      assert.ok(generated.pages[0].source_evidence.every((item) => !item.media), 'detached image appears as draft evidence');
      assert.ok(!requests.some(({ payload }) => payload.article_title === fixture.raw.title), 'detached image sent for automatic completion');
      assert.deepEqual(await readFile(fixture.file), bytes);
      assert.deepEqual(await api(`/api/raw/${edited.id}/media`), {
        items: [],
        readingSource: { bodySha256: edited.bodySha256, markers: [], removed: [] },
      });
      assert.deepEqual(await api(`/api/raw/${edited.id}/media/parse-vlm-batch`, {}), { items: [] });
      const blocked = await api(`/api/raw/${edited.id}/media/${fixture.images[1].mediaId}/parse-vlm`, { force: true }, 409);
      assert.equal(blocked.error.code, 'RAW_MEDIA_NOT_ANCHORED');
      const selected = await api(`/api/raw/${edited.id}/media/parse-vlm-batch`, { mediaIds: [fixture.images[1].mediaId] });
      assert.deepEqual(selected.items, [{ mediaId: fixture.images[1].mediaId, error: 'RAW_MEDIA_NOT_ANCHORED' }]);
      const retainedImage = await fetch(`${base}/api/raw/${edited.id}/web-images/${sha256}`);
      assert.equal(retainedImage.status, 200);
      assert.deepEqual(Buffer.from(await retainedImage.arrayBuffer()), jpeg);
    })(),
  ]);
  assert.deepEqual(blockers.map((outcome) => outcome.status === 'fulfilled' ? 'passed' : String(outcome.reason)), ['passed', 'passed']);

  const partiallyEditedBody = flow.raw.body.replace('【来源图片 1】', '').replace('DIRTY_LEGACY', 'DIRTY_REPLACED_FOR_ANSWER');
  const partiallyEdited = await patch(flow.raw, partiallyEditedBody);
  const editedAnswer = await ask('已改转录');
  assert.equal(editedAnswer.status, 'completed', JSON.stringify(editedAnswer));
  assert.equal(editedAnswer.citations[0].media.mediaId, cited.media.mediaId);
  assert.equal(editedAnswer.citations[0].quote, imageOnly);
  await patch(partiallyEdited, '本日门店图前记录：图已移除。图后正文保留。');
  const citationLink = `/api/raw/${flow.raw.id}/media/${cited.media.mediaId}?textSha256=${cited.media.textSha256}`;
  assert.equal((await api(citationLink, undefined, 409)).error.code, 'RAW_MEDIA_EVIDENCE_STALE');
  assert.equal((await ask('已移除')).status, 'insufficient');
  assert.deepEqual(backendFailures, []);
  console.log(`Production HTTP passed with ${requests.length} fake requests; images in flight max ${maxActiveImages}; checkpoint reuse, stale evidence, confirmation and retrieval verified.`);
} finally {
  if (child?.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await new Promise((resolve) => fake.close(resolve));
  await rm(root, { recursive: true, force: true });
}
