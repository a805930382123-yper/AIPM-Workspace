import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { createWebImageScreening, webImagePositionSignals } from '../services/raw/media-image-screen.ts';

const position = (text: string) =>
  [
    ...webImagePositionSignals(
      text,
      [...text.matchAll(/§/gu)].map(({ index }) => ({ start: index, end: index + 1 })),
    ).values(),
  ][0];
const paragraph = '示例正文内容用于检验图片和转录是否对应。';
const input = (bytes: Buffer, label: string, text: string) => ({
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes,
  label,
  position: position(text),
});
function configure(t: TestContext, anchors?: string, ratio?: string) {
  for (const [key, value] of [
    ['FMCG_WEB_IMAGE_PROMO_ANCHORS', anchors],
    ['FMCG_WEB_IMAGE_PROMO_TAIL_RATIO', ratio],
  ] as const) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

test('tail threshold and configured anchors require a complete qualifying match after the configured boundary', (t) => {
  configure(t);
  assert.equal(position(`${paragraph.repeat(8)}\nfriend recommend\n§`).afterPromotion, false);
  for (const anchor of ['END', '往期推荐', '延伸阅读', '推荐阅读', '点击“阅读原文”', '如有需要请加微信继续沟通。'])
    assert.equal(position(`${paragraph.repeat(8)}\n${anchor}\n§`).afterPromotion, true, anchor);
  assert.equal(position(`加微信后继续正文。${paragraph.repeat(8)}\n§`).afterPromotion, false);
  assert.equal(position(`${paragraph.repeat(8)}\n§\n往期推荐`).afterPromotion, false);

  process.env.FMCG_WEB_IMAGE_PROMO_ANCHORS = '特定活动,资料[下载]';
  process.env.FMCG_WEB_IMAGE_PROMO_TAIL_RATIO = '0.5';
  assert.equal(position(`${paragraph.repeat(8)}\n点击阅读原文\n§`).afterPromotion, false);
  assert.equal(position(`${paragraph.repeat(8)}\n资料[下载]\n§`).afterPromotion, true);
  const halfway = `${paragraph.repeat(6)}\n特定活动\n§\n${paragraph.repeat(5)}`;
  assert.equal(position(halfway).afterPromotion, true);
  process.env.FMCG_WEB_IMAGE_PROMO_TAIL_RATIO = '0.3';
  assert.equal(position(halfway).afterPromotion, false);
  process.env.FMCG_WEB_IMAGE_PROMO_TAIL_RATIO = '0';
  assert.equal(position(`${paragraph.repeat(8)}\n特定活动\n§`).afterPromotion, false);
});

test('an actual QR occupying a small local region is skipped only with promotion in the adjacent paragraph', async (t) => {
  configure(t);
  // QR version 1, payload "fixture", rendered at 3 pixels per module in an unrelated large image.
  const modules = [
    '111111100101101111111',
    '100000101101001000001',
    '101110101100101011101',
    '101110100101001011101',
    '101110101000101011101',
    '100000101001101000001',
    '111111101010101111111',
    '000000001111100000000',
    '110100110110001110110',
    '001000001110001101111',
    '010010111100110001101',
    '001110001101000001010',
    '001011111010101111011',
    '000000001111000101101',
    '111111101100010111110',
    '100000100001110110001',
    '101110100111001001001',
    '101110101101000011011',
    '101110100000100110101',
    '100000101010011010000',
    '111111101101100110010',
  ];
  const canvas = createCanvas(2600, 1600);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  modules.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === '1') context.fillRect(2400 + x * 3, 1350 + y * 3, 3, 3);
    }),
  );
  const qr = canvas.toBuffer('image/png');
  let calls = 0;
  const screening = createWebImageScreening(async () => {
    calls++;
    return [{ text: paragraph }];
  });
  const contextAfter = `\n§\n${paragraph.repeat(8)}`;
  const placedNear = await screening.screen(input(qr, '样图', `微信${contextAfter}`));
  assert.deepEqual(placedNear.routeReasons, ['qr_with_promotion']);
  assert.match(placedNear.decisionReason!, /疑似引流二维码/u);
  assert.equal(calls, 0);
  const unrelated = await screening.screen(input(qr, '样图', `关于微信\n\n本段是说明${contextAfter}`));
  assert.equal(unrelated.routeStatus, 'ocr_ready');
  assert.equal(calls, 1);
  const noQr = createCanvas(500, 450).toBuffer('image/png');
  assert.equal((await screening.screen(input(noQr, '样图', `领取${contextAfter}`))).routeStatus, 'ocr_ready');
  assert.equal(calls, 2);
});

test('same original has position-specific decisions and shares OCR only among editorial appearances', async (t) => {
  configure(t);
  const bytes = createCanvas(340, 260).toBuffer('image/png');
  let calls = 0;
  const screening = createWebImageScreening(async () => {
    calls++;
    return [{ text: paragraph }];
  });
  const normal = input(bytes, '曲线图', '正文说明\n§');
  assert.equal((await screening.screen(normal)).routeStatus, 'ocr_ready');
  assert.deepEqual((await screening.screen({ ...normal, label: '装饰图' })).routeReasons, ['repeated_template']);
  assert.equal((await screening.screen(normal)).routeStatus, 'ocr_ready');
  assert.equal(calls, 1);
});

test('small GIF is skipped with both real animation and a decorative caption, while a small demo still reaches OCR', async (t) => {
  configure(t);
  const animated = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAAh+QQBAAAAACwAAAAAAQABAAACAUQAOw==',
    'base64',
  );
  animated.writeUInt16LE(120, 6);
  animated.writeUInt16LE(120, 8);
  const still = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  still.writeUInt16LE(120, 6);
  still.writeUInt16LE(120, 8);
  let calls = 0;
  const screening = createWebImageScreening(async () => {
    calls++;
    return [];
  });
  assert.deepEqual((await screening.screen(input(animated, '表情包', '§'))).routeReasons, ['decorative_animation']);
  assert.deepEqual((await screening.screen(input(animated, '流程演示', '§'))).routeReasons, ['sparse_image_text']);
  assert.deepEqual((await screening.screen(input(still, '表情包', '§'))).routeReasons, ['sparse_image_text']);
  assert.equal(calls, 2);
});
