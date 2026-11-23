import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanParagraphOcr,
  evaluateImageOcr,
  OCR_TRIAGE_CONFIG,
  type OcrLineInput,
} from '../services/raw/media-ocr-triage.ts';
import { RawStore, type RawInput } from '../services/raw/store.ts';
import { identifyWebImages, parseTesseractTsv, readWebImage } from '../services/raw/web-material.ts';

const lines = (...text: string[]): OcrLineInput[] => text.map((text) => ({ text }));
const dimensions = { width: 800, height: 500 };
const longText = '这是一段清楚连续而且信息完整的技术文字说明';

test('OCR triage short-circuits tiny, elongated, and decorative images and annotates absent dimensions', () => {
  const imageCases = [
    [80, 80, longText, 'tiny_or_banner_image'],
    [800, 60, longText, 'tiny_or_banner_image'],
    [481, 80, longText, 'tiny_or_banner_image'],
    [120, 721, longText, 'tiny_or_banner_image'],
    [480, 80, longText, 'clean_text_pass'],
    [120, 80, longText, 'clean_text_pass'],
    [121, 800, longText.repeat(2), 'clean_text_pass'],
    [800, 500, '欢迎订阅！', 'low_text_decorative'],
  ] as const;
  for (const [width, height, text, reason] of imageCases) {
    const result = evaluateImageOcr({ width, height, lines: lines(text) });
    assert.deepEqual(result.routeReasons, [reason], `${width}×${height}`);
    assert.equal(result.routeStatus, reason === 'clean_text_pass' ? 'ocr_ready' : 'skipped');
  }

  const empty = evaluateImageOcr({ lines: lines('', ' ', '\t') });
  assert.deepEqual(empty.routeReasons, ['legacy_missing_dimensions', 'low_text_decorative']);
  assert.deepEqual(empty.metrics, {
    effectiveCharCount: 0,
    nonEmptyLineCount: 0,
    shortLineRatio: 0,
    gibberishRatio: 0,
    layoutDispersion: 0,
    chartSignalScore: 0,
    avgConfidence: null,
    qualityScore: 100,
  });
  const legacy = evaluateImageOcr({ width: 80, lines: lines(longText) });
  assert.equal(legacy.routeStatus, 'ocr_ready');
  assert.deepEqual(legacy.routeReasons, ['legacy_missing_dimensions', 'clean_text_pass']);
  assert.equal(evaluateImageOcr({ ...dimensions, lines: lines('x'.repeat(14)) }).routeStatus, 'skipped');
  assert.equal(evaluateImageOcr({ ...dimensions, lines: lines('x'.repeat(15)) }).routeStatus, 'ocr_ready');
});

test('clear OCR preserves technical tokens and cleans only paragraph formatting and edge noise', () => {
  const input = lines(
    '',
    ' O ',
    '使用 Gemini 和 Claude 对照这项技术说明并记录',
    '使用 GPT-6.2、API、SHA-256、HTML 与 CI/CD 的结果。',
    '',
    '',
    '',
    '操作步骤：',
    '一、填写所需的  模型参数',
    '二、检查请求服务的  接口配置',
    '•保存任务的模型配置',
    '（三）等待程序完成输出',
    '这是列表下方的一段完整说明文字',
    '结论见图',
    '127',
    '@',
  );
  const expected = [
    '使用 Gemini 和 Claude 对照这项技术说明并记录使用 GPT-6.2、API、SHA-256、HTML 与 CI/CD 的结果。',
    '',
    '操作步骤：',
    '一、填写所需的 模型参数',
    '二、检查请求服务的 接口配置',
    '•保存任务的模型配置',
    '（三）等待程序完成输出',
    '这是列表下方的一段完整说明文字',
    '结论见图',
  ].join('\n');
  assert.equal(cleanParagraphOcr(input), expected);
  const result = evaluateImageOcr({
    ...dimensions,
    lines: input.map(({ text }, row) => ({ text, bbox: [20, row * 23, 20 + text.length * 10, row * 23 + 17] })),
  });
  assert.equal(result.routeStatus, 'ocr_ready', JSON.stringify(result.metrics));
  assert.equal(result.ocrCleanText, expected);
  assert.equal(result.ocrRawText, input.map(({ text }) => text).join('\n'));
  assert.equal(result.metrics.avgConfidence, null);
  const terms = evaluateImageOcr({ ...dimensions, lines: lines('Gemini Claude GPT-6.2 API SHA-256 HTML CI/CD') });
  assert.equal(terms.metrics.gibberishRatio, 0);
  assert.equal(cleanParagraphOcr(lines('ABC', longText, 'KPI')), `ABC\n${longText}\nKPI`);
});

test('fragmented ranking and flow/table fixtures route to VLM by measured signals', () => {
  const ranking = evaluateImageOcr({
    ...dimensions,
    lines: lines(
      'MODEL ARENA   OVERALL SCORE',
      '01   KRCHANEAPRM   1432',
      '02   VRTNCPLS   1390',
      '03   QWRTFPS ★ 13%',
      'a 1 口 |',
      '※ ⌁',
      '04   AAAAEEER   1312',
    ),
  });
  assert.equal(ranking.routeStatus, 'needs_vlm');
  assert.ok(ranking.routeReasons.some((reason) => reason.startsWith('high_gibberish:')));
  assert.ok(ranking.routeReasons.some((reason) => reason.startsWith('chart_or_table_signal:')));
  assert.equal(ranking.ocrCleanText, undefined);
  const withoutOtherNoise = evaluateImageOcr({ ...dimensions, lines: lines('ENTRY KRCHANEAPRM SCORE') });
  assert.equal(withoutOtherNoise.metrics.gibberishRatio, 0);
  assert.equal(evaluateImageOcr({ ...dimensions, lines: lines('a-1-口') }).metrics.gibberishRatio, 0.6);

  const flow = evaluateImageOcr({ ...dimensions, lines: lines('入口 → 注册', '01', '↓', '反馈', '02', '输出 → 结束') });
  assert.equal(flow.routeStatus, 'needs_vlm');
  assert.ok(flow.routeReasons.some((reason) => reason.startsWith('high_short_line:')));
  assert.ok(flow.metrics.chartSignalScore >= 0.6);
  const table = evaluateImageOcr({
    ...dimensions,
    lines: lines('方案\t得分\t成本', '标准   89%   30', '试点   70%   12'),
  });
  assert.equal(table.routeStatus, 'needs_vlm');
  assert.ok(table.routeReasons.includes('chart_or_table_signal:0.65'));
  assert.equal(table.metrics.layoutDispersion, 1);
});

test('OCR numeric thresholds apply at their boundaries and confidence ignores absent readings', () => {
  const justAt = evaluateImageOcr({ ...dimensions, lines: [{ text: longText, confidence: 0.72 }] });
  assert.equal(justAt.metrics.qualityScore, 90);
  assert.equal(justAt.routeStatus, 'ocr_ready');
  const repeatedlyAt = evaluateImageOcr({
    ...dimensions,
    lines: Array.from({ length: 6 }, () => ({ text: longText, confidence: 0.72 })),
  });
  assert.equal(repeatedlyAt.routeStatus, 'ocr_ready');
  const below = evaluateImageOcr({
    ...dimensions,
    lines: [{ text: longText, confidence: 0.719 }, { text: longText }, { text: '', confidence: 0 }],
  });
  assert.equal(below.metrics.avgConfidence, 0.719);
  assert.equal(below.metrics.nonEmptyLineCount, 2);
  assert.equal(below.routeStatus, 'needs_vlm');
  assert.ok(below.routeReasons.includes('low_confidence:0.719'));
  const exactNoise = evaluateImageOcr({ ...dimensions, lines: lines('x'.repeat(41) + '☃'.repeat(9)) });
  assert.equal(exactNoise.metrics.gibberishRatio, OCR_TRIAGE_CONFIG.maxGibberishRatio);
  assert.ok(exactNoise.routeReasons.includes('high_gibberish:0.18'));
  assert.equal(
    evaluateImageOcr({ ...dimensions, lines: lines('x'.repeat(42) + '☃'.repeat(8)) }).routeStatus,
    'ocr_ready',
  );
  const short = '审批中';
  const shortSamples = lines(short, short, short, longText, longText);
  const reason = (entries: OcrLineInput[]) => evaluateImageOcr({ ...dimensions, lines: entries }).routeReasons;
  assert.ok(!reason(shortSamples).some((value) => value.startsWith('high_short_line:')));
  assert.ok(reason([...shortSamples, { text: longText }]).includes('high_short_line:0.50'));
  const quality = (confidence: number) =>
    evaluateImageOcr({
      ...dimensions,
      lines: [
        { text: 'x'.repeat(21) + '☃'.repeat(8), bbox: [0, 0, 250, 20], confidence },
        { text: 'y'.repeat(21), bbox: [160, 40, 300, 60], confidence },
      ],
    });
  assert.equal(quality(0.78).metrics.qualityScore, 70);
  assert.equal(quality(0.78).routeStatus, 'ocr_ready');
  assert.deepEqual(quality(0.77).routeReasons, ['low_quality_score:69']);
});

test('pixel and normalized boxes give the same layout metric, with text-only fallback', () => {
  const input: OcrLineInput[] = [
    { text: longText, bbox: [80, 50, 280, 76] },
    { text: longText, bbox: [500, 54, 740, 83] },
    { text: longText, bbox: [80, 150, 280, 176] },
    { text: longText, bbox: [500, 154, 740, 183] },
    { text: longText, bbox: [80, 250, 280, 276] },
  ];
  const pixel = evaluateImageOcr({ ...dimensions, lines: input });
  const fraction = evaluateImageOcr({
    ...dimensions,
    lines: input.map(({ text, bbox }) => ({
      text,
      bbox: bbox!.map(
        (coordinate, index) => coordinate / (index % 2 ? dimensions.height : dimensions.width),
      ) as OcrLineInput['bbox'],
    })),
  });
  const fallback = evaluateImageOcr({ ...dimensions, lines: input.map(({ text }) => ({ text })) });
  assert.deepEqual(pixel.metrics, fraction.metrics);
  assert.equal(pixel.metrics.layoutDispersion, 1);
  assert.ok(pixel.routeReasons.includes('scattered_layout:1.00'));
  assert.equal(fallback.metrics.layoutDispersion, 0);
  assert.equal(fallback.routeStatus, 'ocr_ready');
  const staggered = evaluateImageOcr({
    ...dimensions,
    lines: [
      { text: longText, bbox: [0, 0, 240, 20] },
      { text: longText, bbox: [100, 50, 340, 70] },
    ],
  });
  assert.equal(staggered.metrics.layoutDispersion, 0.125);
  const flush = evaluateImageOcr({
    lines: input.map(({ text, bbox }) => ({ text, bbox: [20, bbox![1], 150, bbox![3]] })),
  });
  assert.equal(flush.metrics.layoutDispersion, 0);
  assert.equal(flush.routeStatus, 'ocr_ready');
});

test('Tesseract TSV groups valid words by page, block, paragraph, and line', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '4\t1\t1\t1\t1\t0\t25\t20\t140\t30\t-1\t',
    '5\t1\t1\t1\t1\t1\t25\t23\t45\t20\t90.0\tGemini',
    '5\t1\t1\t1\t1\t2\t78\t20\t87\t30\t80.0\tAPI',
    '5\t1\t2\t1\t1\t1\t310\t27\t40\t24\t-1\t得分',
    '5\t1\t2\t1\t1\t2\t310\t50\t40\t24\t92\t ',
    '5\t1\t2\t1\t1\t3\t310\t50\t0\t24\t92\t无效行',
  ].join('\r\n');
  assert.deepEqual(parseTesseractTsv(tsv), [
    { text: 'Gemini API', bbox: [25, 20, 165, 50], confidence: 0.85 },
    { text: '得分', bbox: [310, 27, 350, 51] },
  ]);
});

test('Tesseract TSV rejoins continuous Han text and retains measured column gaps', () => {
  const plainParagraph = '本周我们整理了用户对工作台的反馈并补充全部支持材料';
  const tsv = [...plainParagraph]
    .map((text, index) => [5, 1, 1, 1, 1, index + 1, 20 + 21 * index, 23, 19, 20, 95, text].join('\t'))
    .join('\n');
  const recognized = parseTesseractTsv(tsv);
  assert.equal(recognized[0].text, plainParagraph);
  const result = evaluateImageOcr({ ...dimensions, lines: recognized });
  assert.equal(result.ocrCleanText, plainParagraph);
  assert.equal(result.routeStatus, 'ocr_ready');
  assert.equal(result.metrics.gibberishRatio, 0);

  const separated = parseTesseractTsv(
    '5\t1\t1\t1\t1\t1\t20\t20\t20\t20\t90\t甲\n5\t1\t1\t1\t1\t2\t140\t20\t20\t20\t90\t乙',
  );
  assert.equal(separated[0].text, '甲   乙');
});

test('Raw derivative persistence uses image occurrences, preserves Raw bytes, and follows replacement and deletion', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr01-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new RawStore(root);
  const original = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l+QAAAAASUVORK5CYII=',
    'base64',
  );
  const sha256 = createHash('sha256').update(original).digest('hex');
  const sourceUrl = 'https://example.invalid/original.png';
  const body = '  原文🙂\r\n【来源图片 1】\n原文段落\n【来源图片 2】\n尾部空格  ';
  const image = { sourceUrl, sha256, mime: 'image/png', label: '测试图', status: 'transcribed' as const };
  const input: RawInput = {
    title: 'Image occurrences',
    sourceType: 'article',
    sourceName: 'fixture',
    tags: [],
    body,
    webImages: [1, 2].map((index) => ({ ...image, start: body.indexOf(`【来源图片 ${index}】`) })),
  };
  const originalsDirectory = path.join(root, 'knowledge', 'raw', 'web-images');
  await mkdir(originalsDirectory, { recursive: true });
  await writeFile(path.join(originalsDirectory, sha256), original);
  const raw = await store.create(input);
  const file = path.join(root, 'knowledge', 'raw', 'articles', `${raw.id}.md`);
  const before = await readFile(file);
  assert.deepEqual(await store.getMediaArtifacts(raw.id), []);
  assert.deepEqual(await readFile(file), before);
  const occurrences = identifyWebImages(raw.id, (await store.get(raw.id))?.webImages);
  assert.deepEqual(
    occurrences.map(({ imageIndex }) => imageIndex),
    [1, 2],
  );
  assert.notEqual(occurrences[0].mediaId, occurrences[1].mediaId);
  assert.deepEqual(identifyWebImages(raw.id, input.webImages), occurrences);
  assert.deepEqual(await readWebImage(root, occurrences[1]), original);

  const ok = evaluateImageOcr({ ...dimensions, lines: lines(longText) });
  const failure = { ...ok, routeStatus: 'failed' as const, ocrRawText: 'internal diagnostic example' };
  assert.equal(await store.saveMediaArtifact(raw.id, 'invalid', ok), undefined);
  const [first, second] = await Promise.all([
    store.saveMediaArtifact(raw.id, occurrences[0].mediaId, ok),
    store.saveMediaArtifact(raw.id, occurrences[1].mediaId, ok),
  ]);
  assert.ok(first && second);
  const updated = await store.saveMediaArtifact(raw.id, occurrences[1].mediaId, failure);
  assert.equal(updated?.ocrCleanText, undefined);
  const reopened = new RawStore(root);
  assert.deepEqual(await reopened.getMediaArtifacts(raw.id), [first, updated]);
  assert.equal(first.localPath, `knowledge/raw/web-images/${sha256}`);
  assert.equal(first.sourceUrl, sourceUrl);
  assert.equal(first.width, dimensions.width);
  assert.ok(Date.parse(first.updatedAt));
  assert.deepEqual(await reopened.get(raw.id), raw);
  assert.deepEqual(await reopened.list(), [raw]);
  assert.deepEqual(await readFile(file), before);
  assert.ok(!JSON.stringify(await reopened.list()).includes('ocrRawText'));
  assert.equal(raw.bodySha256, createHash('sha256').update(body).digest('hex'));

  const bodyRevision = raw.bodyRevision ?? 0;
  const replacementText = `补采\n${body}`;
  await store.updateBody(
    raw.id,
    { body: replacementText, expectedBodySha256: raw.bodySha256, expectedBodyRevision: bodyRevision },
    async () => undefined,
    {
      ...input,
      body: replacementText,
      webImages: [{ ...occurrences[0], start: replacementText.indexOf('【来源图片 1】') }],
    },
  );
  const sidecars = path.join(root, 'knowledge', 'raw', 'media-artifacts', raw.id);
  assert.deepEqual(await reopened.getMediaArtifacts(raw.id), [first]);
  assert.deepEqual(await readdir(sidecars), [`${first.mediaId}.json`]);
  assert.equal(await store.saveMediaArtifact(raw.id, occurrences[1].mediaId, ok), undefined);
  assert.equal((await store.bodyHistory(raw.id, 0))?.body, body);
  assert.equal(await store.delete(raw.id).then((record) => record?.id), raw.id);
  assert.deepEqual(await reopened.getMediaArtifacts(raw.id), []);
  await assert.rejects(readdir(sidecars), { code: 'ENOENT' });
  assert.deepEqual(await readWebImage(root, occurrences[0]), original);
});
