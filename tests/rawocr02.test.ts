import assert from 'node:assert/strict';
import test from 'node:test';
import { noteWithSourceCoordinates } from '../services/llm/knowledge-deep.ts';
import type { MediaArtifact } from '../services/raw/media-artifact.ts';
import {
  buildRawContentForAI,
  inspectRawMedia,
  mediaForEvidence,
  mediaQuoteMatches,
  rawMediaContext,
  sourceRange,
} from '../services/raw/media-context.ts';

const metrics = {
  effectiveCharCount: 20,
  nonEmptyLineCount: 1,
  shortLineRatio: 0,
  gibberishRatio: 0,
  layoutDispersion: 0,
  chartSignalScore: 0,
  avgConfidence: null,
  qualityScore: 100,
};
const body =
  '图前正文。🀄\n【来源图片 1】\n【图片 OCR 转录（需核对）】\n旧的调试文字\n【转录结束】\n紧接正文。\n【来源图片 2】\n图后正文。🚀\n\n```text\n【图片 OCR 转录（需核对）】\n说明中的示例，仍是正文。\n【转录结束】\n```';
const raw = {
  body,
  webImages: [1, 2].map((i) => ({
    start: body.indexOf(`【来源图片 ${i}】`),
    status: 'transcribed' as const,
    label: '',
    sourceUrl: 'https://example.invalid/image.png',
  })),
};
const image: MediaArtifact = {
  mediaId: '1'.repeat(64),
  imageIndex: 1,
  sourceUrl: raw.webImages[0].sourceUrl,
  updatedAt: '2026-11-23T00:00:00Z',
  routeStatus: 'ocr_ready',
  routeReasons: [],
  metrics,
  ocrRawText: '不应进入任何提示的调试原文',
  ocrCleanText: '文字解析独有信息。🧪',
};

test('the AI projection removes owned legacy OCR and keeps raw and image evidence in separate coordinates', () => {
  const failed: MediaArtifact = { ...image, mediaId: '2'.repeat(64), imageIndex: 2, routeStatus: 'failed' };
  const content = buildRawContentForAI(raw, [failed, image]);
  assert.doesNotMatch(content.body, /旧的调试文字|不应进入任何提示/u);
  assert.match(content.body, /说明中的示例，仍是正文/u);
  const source = mediaForEvidence(image)!;
  const imageStart = content.body.indexOf(source.text);
  const range = sourceRange(content, imageStart, imageStart + source.text.length)!;
  assert.deepEqual(range.media, { mediaId: source.mediaId, imageIndex: 1, textSha256: source.textSha256 });
  assert.equal(range.start, 0);
  assert.ok(mediaQuoteMatches(range.media!, range.start, range.end, source.text, [source]));
  assert.equal(
    mediaQuoteMatches(range.media!, range.start, range.end, source.text, [{ ...source, textSha256: '0'.repeat(64) }]),
    false,
  );
  assert.equal(sourceRange(content, content.body.indexOf('[来源图片'), imageStart), undefined);
  const note = noteWithSourceCoordinates(
    {
      version: 1,
      orientation: '核对证据',
      sections: [
        {
          id: 'evidence',
          title: '证据',
          question: '哪里可核对？',
          blocks: [
            {
              type: 'paragraph',
              role: 'needs_verification',
              factIds: [],
              text: source.text,
              sourceBoundary: {
                rawId: 'raw',
                category: 'ambiguous',
                start: imageStart,
                end: imageStart + source.text.length,
              },
            },
          ],
        },
      ],
    },
    content,
  );
  const [entry] = note.sections[0].blocks;
  assert.ok(entry.type === 'paragraph');
  assert.deepEqual(entry.sourceBoundary, { rawId: 'raw', category: 'ambiguous', ...range });
  for (const quote of ['图前正文。🀄', '图后正文。🚀']) {
    const at = content.body.indexOf(quote);
    const found = sourceRange(content, at, at + quote.length)!;
    assert.equal(found.media, undefined);
    assert.equal(body.slice(found.start, found.end), quote);
  }
  assert.equal(buildRawContentForAI({ body }, []).body, body);
  assert.match(rawMediaContext(raw, 1).context_after, /紧接正文/u);
  assert.doesNotMatch(rawMediaContext(raw, 1).context_after, /旧的调试文字/u);
  const shifted = { ...raw, body: '人工填写了引言。\n' + raw.body };
  assert.match(rawMediaContext(shifted, 1).context_before, /人工填写了引言/u);
  assert.doesNotMatch(buildRawContentForAI(shifted, [image]).body, /旧的调试文字/u);
});

test('Raw edits keep legacy transcriptions isolated independently from current image anchors', () => {
  const after = (body: string) => {
    const edited = { ...raw, body };
    return inspectRawMedia(edited, raw);
  };
  for (const replacement of ['【来源图片 1（原图已撤下）】', '', '`【来源图片 1】`']) {
    const body = raw.body.replace('【来源图片 1】', replacement);
    const source = after(body);
    assert.deepEqual(
      source.markers.map(({ imageIndex }) => imageIndex),
      [2],
    );
    const projection = buildRawContentForAI({ ...raw, body }, [image], source);
    assert.doesNotMatch(projection.body, /旧的调试文字|文字解析独有信息/u);
    assert.match(projection.body, /说明中的示例，仍是正文/u);
  }
  const moved = raw.body
    .replace('【来源图片 1】', '图前内联【来源图片 1 · 新标签】')
    .replace('旧的调试文字', '编辑过的旧转录');
  assert.deepEqual(
    after(moved).markers.map(({ imageIndex }) => imageIndex),
    [1, 2],
  );
  assert.doesNotMatch(buildRawContentForAI({ ...raw, body: moved }, [image], after(moved)).body, /编辑过的旧转录/u);
  const duplicate = `${moved}\n【来源图片 1 · 重复】`;
  assert.deepEqual(
    after(duplicate).markers.map(({ imageIndex }) => imageIndex),
    [2],
  );
  const fenced = raw.body.replace('【来源图片 1】', '```text\n【来源图片 1】\n```');
  assert.deepEqual(
    after(fenced).markers.map(({ imageIndex }) => imageIndex),
    [2],
  );
  const identicalExample =
    '保留原样的演示:\n```text\n【来源图片 1】\n【图片 OCR 转录（需核对）】\n旧的调试文字\n【转录结束】\n```';
  const withExample = raw.body.replace('【来源图片 1】', '') + '\n' + identicalExample;
  const exampleProjection = buildRawContentForAI({ ...raw, body: withExample }, [image], after(withExample));
  assert.ok(exampleProjection.body.endsWith(identicalExample));
  assert.equal(exampleProjection.body.match(/旧的调试文字/gu)?.length, 1);
});

test('complete owned blocks remain isolated after removal of the image marker and rewriting the transcription', () => {
  const revised = raw.body.replace('【来源图片 1】', '').replace('旧的调试文字', '改写后整行已与采集文本不同');
  const updated = { ...raw, body: revised };
  const source = inspectRawMedia(updated, raw);
  assert.deepEqual(
    source.markers.map(({ imageIndex }) => imageIndex),
    [2],
  );
  assert.doesNotMatch(rawMediaContext(updated, 2, source).context_before, /改写后整行/u);
  assert.doesNotMatch(buildRawContentForAI(updated, [image], source).body, /改写后整行/u);
  assert.match(buildRawContentForAI(updated, [image], source).body, /紧接正文/u);
});

test('opaque and ambiguous blocks stay local while verifiable prose and code examples remain', () => {
  const ocr = (content: string) => `【图片 OCR 转录（需核对）】\n${content}\n【转录结束】`;
  const left = '例子上方的公开说明。'.repeat(9);
  const right = '例子下方的公开说明。'.repeat(9);
  const ordinary = ocr('采集版已经明确保留的普通原文示范。');
  const code = '```text\n' + ocr('采集旧转录甲。') + '\n```';
  const acquisitionBody = [
    '开头普通原文',
    '【来源图片 1】',
    ocr('采集旧转录甲。'),
    left,
    ordinary,
    right,
    '【来源图片 2】',
    ocr('采集旧转录乙。'),
    '收尾普通原文',
    '【来源图片 3】',
    code,
  ].join('\n');
  const acquisition = {
    body: acquisitionBody,
    webImages: [1, 2, 3].map((imageIndex) => ({
      ...raw.webImages[0],
      start: acquisitionBody.indexOf(`【来源图片 ${imageIndex}】`),
    })),
  };
  const revised = {
    ...acquisition,
    body:
      acquisitionBody
        .replace('【来源图片 1】\n', '')
        .replace(ocr('采集旧转录甲。'), ocr('标点改写后的第一块！'))
        .replace('【来源图片 2】\n', '')
        .replace(ocr('采集旧转录乙。'), ocr('第二块整行换掉，无法凭文本识别。'))
        .replace('收尾普通原文', '收尾普通原文改写') +
      '\n独立普通正文\n' +
      ocr('远处新增，无法确定归属。'),
  };
  const projection = buildRawContentForAI(revised, [], inspectRawMedia(revised, acquisition));
  assert.doesNotMatch(projection.body, /标点改写后的第一块|第二块整行换掉|远处新增/u);
  for (const text of [ordinary, code, '开头普通原文', '收尾普通原文改写', '独立普通正文'])
    assert.ok(projection.body.includes(text));
  assert.deepEqual(
    inspectRawMedia(revised, acquisition).markers.map(({ imageIndex }) => imageIndex),
    [3],
  );
  assert.equal(buildRawContentForAI({ body: revised.body }, []).body, revised.body);
  const noLegacy = { ...raw, body: '【来源图片 1】\n此处没有旧转录。' };
  const ordinaryEdit = { ...noLegacy, body: noLegacy.body + '\n' + ordinary };
  assert.equal(buildRawContentForAI(ordinaryEdit, [], inspectRawMedia(ordinaryEdit, noLegacy)).body, ordinaryEdit.body);
});

test('document boundaries preserve known ordinary examples while the middle transcription remains local', () => {
  const example = '【图片 OCR 转录（需核对）】\n本文演示的字串属于公开正文。\n【转录结束】';
  const padding = '两侧原有正文未编辑。'.repeat(9);
  const originalBody = `${example}\n${padding}\n【来源图片 1】\n【图片 OCR 转录（需核对）】\n实际旧识别结果\n【转录结束】\n${padding}\n${example}`;
  const acquired = {
    body: originalBody,
    webImages: [{ ...raw.webImages[0], start: originalBody.indexOf('【来源图片 1】') }],
  };
  const revised = {
    ...acquired,
    body: originalBody.replace('【来源图片 1】\n', '').replace('实际旧识别结果', '实际转录改写内容'),
  };
  const projection = buildRawContentForAI(revised, [], inspectRawMedia(revised, acquired));
  assert.ok(projection.body.startsWith(example));
  assert.ok(projection.body.endsWith(example));
  assert.doesNotMatch(projection.body, /实际转录改写内容/u);
});
