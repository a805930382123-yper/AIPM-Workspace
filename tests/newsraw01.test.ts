import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { AssetStore } from '../services/raw/assets.ts';
import { RawStore, hasEditedPdfBody } from '../services/raw/store.ts';
import { readWebImage } from '../services/raw/web-material.ts';
import { type WebOptions } from '../services/raw/url-import.ts';
import {
  acquireNewsMaterial,
  PartialNewsMaterialError,
  UnavailableNewsMaterialError,
} from '../services/news/raw-material.ts';
import { NewsRawSave } from '../services/news/raw-save.ts';
import type { NewsItem } from '../services/news/types.ts';
import { textPdf } from './support/news-pdf-fixture.ts';

const date = '2026-11-23';
const clock = () => new Date(date + 'T12:00:00+08:00');
const item: NewsItem = {
  id: 'fixture',
  title: '合成测试来源',
  url: 'https://publisher.test/story',
  sourceId: 'test',
  sourceName: '测试出版方',
  publishedAt: date,
  fetchedAt: clock().toISOString(),
  evidenceKind: 'source_summary',
  excerpt: '简讯摘录',
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBFQAAAAASUVORK5CYII=',
  'base64',
);
const response = (mime: string, bytes: Buffer | string, status = 200) => ({
  status,
  headers: { 'content-type': mime },
  body: Readable.from([Buffer.from(bytes)]),
});
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
async function fixture(
  t: TestContext,
  request: NonNullable<WebOptions['request']>,
  ocr = async () => '节点 A → 节点 B',
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-newsraw-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  const saves = new NewsRawSave(root, raws, clock, {
    acquire: (item, retain) => acquireNewsMaterial(root, item, retain, { request, resolve, ocr }),
  });
  return { root, raws, saves };
}

test('图文按正文顺序保存，装饰图跳过，转录可对照本地原图', async (t) => {
  const requests: string[] = [];
  const { root, raws, saves } = await fixture(t, async (url) => {
    requests.push(url.pathname);
    return url.pathname === '/story'
      ? response(
          'text/html',
          '<title>样本</title><article><p>正文第一段，请看下面流程图。</p><img src="/logo.png" alt="logo"><img data-src="/steps.png" alt="流程图"><p>正文第二段。</p></article>',
        )
      : response('image/png', png);
  });
  const first = await saves.save(date, 'ai', item);
  const second = await saves.save(date, 'ai', item, randomUUID());
  assert.equal(second.rawId, first.rawId);
  assert.equal(second.owned, false);
  assert.equal(first.material.kind, 'article');
  assert.deepEqual(requests, ['/story', '/steps.png']);
  const raw = (await raws.get(first.rawId))!;
  assert.match(raw.body, /正文第一段[\s\S]*来源图片[\s\S]*OCR 转录[\s\S]*节点 A → 节点 B[\s\S]*正文第二段/u);
  assert.doesNotMatch(raw.body, /简讯摘录/u);
  const [image] = raw.webImages!;
  assert.equal(raw.body.slice(image!.start, image!.start + 7), '【来源图片 1');
  assert.equal(image!.sourceUrl, 'https://publisher.test/steps.png');
  assert.deepEqual(await readWebImage(root, image!), png);
});

test('缺图时等待明确决定，补采保留同一 Raw 及历史，保留人工编辑', async (t) => {
  let available = false;
  const { raws, saves } = await fixture(t, async (url) =>
    url.pathname === '/story'
      ? response('text/html', '<article><p>这是流程图。</p><img src="/steps.png" alt="流程图"></article>')
      : available
        ? response('image/png', png)
        : response('text/plain', '', 503),
  );
  await assert.rejects(saves.save(date, 'ai', item), PartialNewsMaterialError);
  assert.deepEqual(await raws.list(), []);
  const kept = await saves.save(date, 'ai', item, undefined, { keepPartial: true });
  assert.equal(kept.material.canSupplement, true);
  assert.match(kept.material.issue!, /原图读取失败/u);
  const partial = (await raws.get(kept.rawId))!;
  const changed = await raws.updateBody(
    kept.rawId,
    {
      body: '人工修订内容',
      expectedBodySha256: partial.bodySha256,
      expectedBodyRevision: 0,
    },
    async () => {},
  );
  available = true;
  await assert.rejects(saves.save(date, 'ai', item, undefined, { supplement: true }), /保留当前原文/u);
  assert.equal((await raws.get(kept.rawId))?.body, changed?.body);
});

test('旧摘录补采保留原始身份，并将有明确链接的 PDF 作为来源材料', async (t) => {
  const pdf = textPdf(['第一页的出处。', '第二页的出处。']);
  const requests: string[] = [];
  const { root, raws, saves } = await fixture(t, async (url) => {
    requests.push(url.pathname);
    return response('application/pdf', pdf);
  });
  const report = { ...item, research: { kind: '报告', dataPeriod: null, pdfUrl: 'https://publisher.test/report.pdf' } };
  const old = {
    title: report.title,
    url: report.url,
    body: report.excerpt,
    sourceType: 'article' as const,
    sourceName: '测试出版方（来源摘要）',
    tags: ['每日资讯', '来源摘要'],
  };
  const oldRaw = await raws.create(old);
  const receipts = path.join(root, 'state', 'news-saves');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(receipts, { recursive: true });
  const receiptFile = path.join(receipts, createHash('sha256').update(report.url).digest('hex') + '.json');
  await writeFile(
    receiptFile,
    JSON.stringify({
      schemaVersion: 1,
      date,
      section: 'fmcg',
      itemId: report.id,
      sourceId: report.sourceId,
      fetchedAt: report.fetchedAt,
      evidenceKind: report.evidenceKind,
      normalizedUrl: report.url,
      rawId: oldRaw.id,
      input: old,
      status: 'linked',
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    }),
  );
  assert.equal((await saves.savedRaw(report))?.material.canSupplement, true);
  const updated = await saves.save(date, 'fmcg', report, undefined, { supplement: true });
  assert.equal(updated.rawId, oldRaw.id);
  assert.equal(updated.material.kind, 'report_pdf');
  assert.deepEqual(requests, ['/report.pdf']);
  const raw = (await raws.get(oldRaw.id))!;
  assert.match(raw.body, /第一页的出处。[\s\S]*第二页的出处。/u);
  assert.equal(raw.urlImport?.finalUrl, report.research.pdfUrl);
  assert.equal(hasEditedPdfBody(raw), false);
  assert.equal((await raws.bodyHistory(raw.id, 0))?.body, report.excerpt);
  assert.deepEqual((await new AssetStore(root).readBoundPdf(raw)).bytes, pdf);
  assert.equal((await raws.list()).length, 1);
  assert.equal((await readFile(receiptFile, 'utf8')).includes(old.body), true);
});

test('关键流程图 OCR 为空时，即使正文存在也须确认部分材料', async (t) => {
  const { root, raws, saves } = await fixture(
    t,
    async (url) =>
      url.pathname === '/story'
        ? response('text/html', '<article><p>流程如下图。</p><img src="/steps.png" alt="流程图"></article>')
        : response('image/png', png),
    async () => '',
  );
  await assert.rejects(saves.save(date, 'ai', item), /未识别到可转录文字/u);
  assert.deepEqual(await raws.list(), []);
  const kept = await saves.save(date, 'ai', item, undefined, { keepPartial: true });
  assert.equal(kept.material.canSupplement, true);
  const raw = (await raws.get(kept.rawId))!;
  const [image] = raw.webImages!;
  assert.equal(image!.status, 'no_text');
  assert.deepEqual(await readWebImage(root, image!), png);
});

test('只有原图的页面保留图文转录，发布页和验证码均不冒充报告正文', async (t) => {
  let gate = false;
  const { root, raws, saves } = await fixture(t, async (url) => {
    if (url.pathname === '/steps.png') return response('image/png', png);
    if (gate) return response('text/html', '<title>安全验证</title><p>验证后继续</p>');
    return response('text/html', '<article><img src="/steps.png"></article>');
  });
  const pure = await saves.save(date, 'ai', item);
  assert.match((await raws.get(pure.rawId))!.body, /OCR 转录/u);
  const report = {
    ...item,
    id: 'report',
    url: 'https://publisher.test/report',
    research: { kind: '报告', dataPeriod: null },
  };
  await assert.rejects(saves.save(date, 'fmcg', report), /发布页/u);
  const kept = await saves.save(date, 'fmcg', report, undefined, { keepPartial: true });
  assert.equal(kept.material.kind, 'report_page');
  gate = true;
  const gated = { ...item, id: 'gate', url: 'https://publisher.test/gate' };
  await assert.rejects(saves.save(date, 'ai', gated), UnavailableNewsMaterialError);
  assert.equal(await saves.savedRawId(gated), undefined);
  await assert.rejects(saves.save(date, 'ai', gated, undefined, { keepPartial: true }), UnavailableNewsMaterialError);
  assert.equal((await raws.list()).length, 2);
  assert.equal(
    (
      await readFile(path.join(root, 'knowledge', 'raw', 'web-images', createHash('sha256').update(png).digest('hex')))
    ).equals(png),
    true,
  );
});
