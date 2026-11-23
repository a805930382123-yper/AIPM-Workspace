import assert from 'node:assert/strict';
import test from 'node:test';
import { noteWithSourceCoordinates } from '../services/llm/knowledge-deep.ts';
import type { MediaArtifact } from '../services/raw/media-artifact.ts';
import {
  buildRawContentForAI,
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
