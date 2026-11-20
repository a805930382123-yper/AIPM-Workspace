import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { NewsService } from '../../services/news/service.ts';
import { readNewsSources } from '../../services/news/sources.ts';
import { fetchNewsSource, runInAutomationContext } from '../../services/automation/context.ts';
import { normalizedTitle } from '../../services/news/normalize.ts';
import { responseFor, titles, worldpanel, worldpanelList } from './news11-review-fixture.mjs';

const day = '2026-11-17', published = '2026-11-12';
const initial = new Date(day + 'T23:59:59.500+08:00');
const stamp = initial.toISOString();
const item = (id, sourceId = 'worldpanel', options = {}) => ({ id, title: '中国食品市场研究 ' + id,
  sourceId, sourceName: sourceId, url: `https://example.invalid/${id}`, publishedAt: published, fetchedAt: stamp,
  excerpt: `固定原始正文 ${id}。\n\n保留格式。`, evidenceKind: 'article_excerpt', ...options });
const researchExcerpt = '中国食品零售渠道调研显示，商超门店饮料销量同比增长 12%，便利店渗透率达到 35%。';
const priorAnalysis = { fact: '现有事实', whyItMatters: '原分析', possibleImpact: '原推断' };
const original = item('original', 'mintel', { analysis: priorAnalysis });
const originalAi = item('original-ai', 'aihot', { evidenceKind: 'source_summary' });
const part = (items, overrides = {}) => ({ status: 'source_only', attempt: 1, startedAt: stamp,
  finishedAt: stamp, items, sources: [], ...overrides });
const fmcg = (items, overrides = {}) => part(items, { contentVersion: 'research-v1', ...overrides });
const health = (name, status, error) => ({ name, status, checkedAt: stamp, ...(error ? { error } : {}) });
const withDir = async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'news11-review-'));
  const dir = path.join(root, 'state', 'news');
  await mkdir(dir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = date => path.join(dir, `${date}.json`);
  return { root, file,
    seed: (date, sections) => writeFile(file(date), JSON.stringify({ schemaVersion: 1, date, updatedAt: stamp, sections })) };
};
const waitFor = async (label, check) => {
  for (let i = 0; i < 200; i++) { const result = await check(); if (result) return result; await delay(10); }
  assert.fail(label + ' did not complete');
};
const defaults = { clock: () => initial, aiEnabled: true, providerFactory: async () => assert.fail('manual check must not prepare a provider') };

test('NEWS11 actual adapters distinguish transport, PDF timeout, parsing, duplicate and unreadable text without leaking details', async t => {
  const requests = [], nativeFetch = globalThis.fetch;
  globalThis.fetch = async input => { const url = new URL(String(input)); requests.push(url.href); return responseFor(url, 'diagnostics', published); };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const exclusions = { urls: new Set(), titles: new Set([normalizedTitle(titles.history)]) };
  const result = await readNewsSources('fmcg', initial, exclusions);
  const byId = Object.fromEntries(result.sources.map(x => [x.sourceId, x.diagnosis]));
  assert.deepEqual(Object.keys(byId).sort(), ['kpmg', 'mintel', 'nbs', 'niq', 'pwc', 'worldpanel']);
  const wp = byId.worldpanel;
  assert.equal(wp.outcome, 'partial');
  assert.deepEqual([wp.counts.qualified, wp.counts.duplicates, wp.counts.rejected, wp.counts.failed], [1, 1, 1, 1]);
  assert.deepEqual([wp.error.type, wp.error.stage, wp.error.httpStatus], ['http', 'detail', 503]);
  assert.equal(wp.lastSuccessAt, undefined);
  assert.deepEqual(result.items.map(x => x.title), [titles.first]);
  assert.ok(!requests.some(x => x.endsWith('/insights/news11-history')));
  assert.deepEqual([byId.niq.error.type, byId.niq.error.stage], ['timeout', 'pdf']);
  assert.deepEqual([byId.kpmg.error.type, byId.kpmg.error.stage], ['tls', 'list']);
  assert.deepEqual([byId.pwc.error.type, byId.pwc.error.stage, byId.pwc.error.httpStatus], ['http', 'list', 503]);
  assert.equal(byId.mintel.error.type, 'parse');
  assert.equal(byId.nbs.outcome, 'empty');
  assert.equal(byId.nbs.counts.failed, 0);
  assert.ok(Number.isFinite(Date.parse(byId.nbs.lastSuccessAt)));
  assert.doesNotMatch(JSON.stringify(result), /NEWS11_PRIVATE_BODY_MUST_NOT_LEAK|private (?:socket|timeout) marker/);
  for (const d of Object.values(byId)) {
    assert.ok(Number.isFinite(Date.parse(d.startedAt)));
    assert.ok(Date.parse(d.finishedAt) >= Date.parse(d.startedAt));
    assert.ok(Number.isFinite(d.elapsedMs) && d.elapsedMs >= 0);
  }
  const ai = await readNewsSources('ai', initial);
  assert.deepEqual([ai.sources[0].diagnosis.error.type, ai.sources[0].diagnosis.outcome], ['parse', 'failed']);
});

test('NEWS11 legacy source mapping retries partial only; leaves known healthy and unmatched retired source unchanged', async t => {
  const { root, seed } = await withDir(t);
  const accepted = item('preexisting-worldpanel', 'worldpanel', { title: titles.first, url: worldpanel + '/insights/news11-first', analysis: priorAnalysis });
  const legacyPartial = health('Worldpanel by Numerator', 'ok', '旧版部分详情失败');
  const healthy = health('NIQ', 'empty');
  const unknown = health('曾登记的未知来源', 'failed', '旧记录几个词');
  const historical = item('historical-worldpanel', 'worldpanel', { title: titles.history, url: worldpanel + '/insights/news11-history' });
  await seed('2026-11-16', { fmcg: fmcg([historical]) });
  await seed(day, { fmcg: fmcg([original, accepted], { sources: [legacyPartial, healthy, unknown] }), ai: part([originalAi]) });
  const requests = [], nativeFetch = globalThis.fetch;
  globalThis.fetch = async input => { const url = new URL(String(input)); requests.push(url.href); return responseFor(url, 'retry', published); };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const service = new NewsService({ ...defaults, root, readSources: readNewsSources });
  await service.check('fmcg', 'failed', 1);
  const recovered = (await service.ensure(true)).sections.fmcg;
  assert.deepEqual(recovered.items.slice(0, 2), [original, accepted]);
  assert.equal(recovered.items[2].title, titles.second);
  assert.deepEqual(requests.sort(), [worldpanelList, worldpanel + '/insights/news11-second', worldpanel + '/insights/news11-tiny'].sort());
  assert.deepEqual(recovered.sources.find(x => x.name === healthy.name), healthy);
  assert.deepEqual(recovered.sources.find(x => x.name === unknown.name), unknown);
  const checked = recovered.sources.find(x => x.name === legacyPartial.name);
  assert.notEqual(checked.status, 'failed');
  assert.deepEqual([checked.diagnosis.counts.duplicates, checked.diagnosis.counts.rejected, checked.diagnosis.counts.failed], [2, 1, 0]);
  const noRetry = await service.check('fmcg', 'failed', recovered.attempt);
  await service.ensure(true);
  assert.equal(requests.length, 3, 'quality rejection and unrecognized old provider may not trigger a retry');
  assert.match(JSON.stringify(noRetry), /无法定位|无.{0,8}失败来源|没有.{0,8}失败来源|没有.{0,8}补抓/);
});

test('NEWS11 simultaneous section updates, stale attempts and ensure wait preserve creator request counts across midnight', async t => {
  const { root, seed, file } = await withDir(t);
  await seed(day, { fmcg: fmcg([original]), ai: part([originalAi]) });
  let now = initial, providers = 0;
  const network = [], counts = [], reads = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async input => { network.push(String(input)); return new Response('fixture'); };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const gates = { fmcg: Promise.withResolvers(), ai: Promise.withResolvers() };
  const source = new NewsService({ root, clock: () => now, aiEnabled: true,
    providerFactory: async () => { providers++; return undefined; },
    readSources: async (section, attemptTime) => {
      reads.push([section, attemptTime.toISOString()]);
      await gates[section].promise;
      await fetchNewsSource(`https://example.invalid/${section}`);
      const sourceId = section === 'fmcg' ? 'worldpanel' : 'aihot';
      return { items: [item(`new-${section}`, sourceId, section === 'fmcg' ? { excerpt: researchExcerpt } : {})], sources: [{ ...health(sourceId, 'ok'), sourceId }] };
    },
  });
  const automation = (runId, action) => runInAutomationContext({ runId,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 }, countSource: async () => { counts.push(runId); } }, action);
  try {
    const [p1, p2, p3] = await Promise.allSettled([
      source.check('fmcg', 'all', 1), source.check('fmcg', 'all', 1), automation('creator', () => source.check('ai', 'all', 1)),
    ]);
    assert.equal(p1.status, 'fulfilled');
    if (p2.status === 'rejected') assert.equal(p2.reason.status, 409);
    assert.equal(p3.status, 'fulfilled');
    await waitFor('both source reads to launch', () => reads.length === 2);
    assert.deepEqual((await source.edition(day)).sections.fmcg.items, [original]);
    let settled = false;
    const first = automation('waiter-one', () => source.ensure(true)).then(x => { settled = true; return x; });
    const second = automation('waiter-two', () => source.ensure(true));
    await delay(40);
    assert.equal(settled, false, 'waitForSources may not finish while a launched check is still pending');
    now = new Date(+now + 2500);
    gates.ai.resolve();
    await waitFor('AI settles before FMCG', async () => (await source.edition(day)).sections.ai.status !== 'running');
    assert.equal(settled, false);
    gates.fmcg.resolve();
    const [edition, other] = await Promise.all([first, second]);
    assert.deepEqual(other, edition);
    assert.equal(edition.date, day);
    assert.deepEqual(edition.sections.fmcg.items.map(x => x.id), [original.id, 'new-fmcg']);
    assert.deepEqual(edition.sections.ai.items.map(x => x.id), [originalAi.id, 'new-ai']);
    assert.deepEqual(reads.sort(([a], [b]) => a.localeCompare(b)), [['ai', stamp], ['fmcg', stamp]]);
    assert.deepEqual(network.sort(), ['https://example.invalid/ai', 'https://example.invalid/fmcg']);
    assert.deepEqual(counts, ['creator']);
    assert.equal(providers, 0);
    await assert.rejects(readFile(file('2026-11-18')), { code: 'ENOENT' });
  } finally {
    gates.ai.resolve(); gates.fmcg.resolve();
    const launched = source.launched;
    if (launched) await Promise.allSettled(launched.values());
  }
});

test('NEWS11 interrupted and failed prior editions retain identity; a pending disk retry keeps merged content', async t => {
  const { root, seed } = await withDir(t);
  const priorDay = '2026-11-16';
  const prior = item('from-prior-failed', 'niq', { excerpt: researchExcerpt, research: { kind: 'PDF', dataPeriod: null, pdfUrl: 'https://example.invalid/report.pdf' } });
  await seed(priorDay, { fmcg: fmcg([prior], { status: 'failed' }) });
  await seed(day, { fmcg: fmcg([original], { status: 'running' }), ai: part([originalAi]) });
  const included = item('included', 'worldpanel', { excerpt: researchExcerpt });
  let requests = 0;
  const deps = { ...defaults, root, readSources: async () => {
    requests++;
    return { items: [item('same-pdf', 'niq', { excerpt: researchExcerpt, research: prior.research }), included], sources: [health('Worldpanel by Numerator', 'ok')] };
  } };
  const service = new NewsService(deps);
  const initialView = await service.today();
  assert.equal(initialView.edition.sections.fmcg.status, 'interrupted');
  assert.deepEqual(initialView.edition.sections.fmcg.items, [original]);
  assert.deepEqual(initialView.recentFmcg, [{ date: priorDay, item: prior }]);
  const writeEdition = service.write.bind(service);
  let failFinal = true;
  service.write = async edition => {
    if (failFinal && edition.sections.fmcg.items.length > 1) { failFinal = false; throw new Error('NEWS11 isolated finish write fault'); }
    return writeEdition(edition);
  };
  await service.check('fmcg', 'all', 1);
  const interrupted = (await service.ensure(true)).sections.fmcg;
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.items, [original]);
  assert.equal(failFinal, false);
  await service.retry('fmcg', interrupted.attempt);
  const recovered = (await service.ensure(true)).sections.fmcg;
  assert.equal(requests, 1);
  assert.deepEqual(recovered.items, [original, included]);
});

test('NEWS11 a full edition still checks and explains why qualified content was not added', async t => {
  const { root, seed } = await withDir(t);
  const alreadyPublished = [original, item('one'), item('two'), item('three', 'pwc'), item('four', 'nbs')];
  await seed(day, { fmcg: fmcg(alreadyPublished), ai: part([originalAi]) });
  let attempts = 0;
  const service = new NewsService({ ...defaults, root, readSources: async () => {
    attempts++;
    return { items: [item('possible-append', 'kpmg', { excerpt: researchExcerpt })], sources: [health('KPMG', 'ok')] };
  } });
  await service.check('fmcg', 'all', 1);
  const full = (await service.ensure(true)).sections.fmcg;
  assert.equal(attempts, 1);
  assert.deepEqual(full.items, alreadyPublished);
  assert.match(full.checkMessage, /满.{0,10}5|5.{0,10}满/);
  assert.match(full.checkMessage, /未加入|未替换|保留/);
});
