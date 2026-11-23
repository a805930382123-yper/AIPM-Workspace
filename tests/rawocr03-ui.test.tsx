import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw, RawMediaArtifact } from '../app/api';
import { inspectRawMedia } from '../services/raw/media-context';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
const w = dom.window;
for (const [name, value] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawWebContent } = await import('../app/components/RawWebContent');
const { ImportDialog } = await import('../app/pages/RawPage');
const response = (data: unknown, status = 200) => {
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
    const value = raw(Math.max(1, ...data.items.map((item: RawMediaArtifact) => item.imageIndex ?? 0)));
    data = { readingSource: { bodySha256: value.bodySha256, ...inspectRawMedia(value) }, ...data };
  }
  return new Response(JSON.stringify(data), { status });
};
const metrics = {
  effectiveCharCount: 0,
  nonEmptyLineCount: 0,
  shortLineRatio: 0,
  gibberishRatio: 0,
  layoutDispersion: 0,
  chartSignalScore: 0,
  avgConfidence: null,
  qualityScore: 0,
};
const artifact = (index: number, routeStatus: RawMediaArtifact['routeStatus']): RawMediaArtifact => ({
  mediaId: String(index).repeat(64),
  imageIndex: index,
  sourceUrl: `https://example.test/${index}`,
  routeStatus,
  routeReasons: [],
  metrics,
  updatedAt: '2026-11-23T00:00:00Z',
});
const raw = (count = 1, id = 'raw-images'): Raw => ({
  id,
  title: '合成图片资料',
  sourceType: 'article',
  sourceName: '合成来源',
  tags: [],
  body: `原文正文保真\n${Array.from({ length: count }, (_, index) => `【来源图片 ${index + 1}】\n`).join('')}图后正文`,
  importedAt: '2026-11-23T00:00:00Z',
  status: 'unprocessed',
  bodySha256: 'a'.repeat(64),
  webImages: Array.from({ length: count }, (_, index) => ({
    start: index + 1,
    sourceUrl: `https://example.test/${index + 1}`,
    label: `测试图 ${index + 1}`,
    sha256: 'b'.repeat(64),
    status: 'transcribed' as const,
  })),
});
const button = (label: string) => {
  const found = [...w.document.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  assert.ok(found, `找不到按钮 ${label}`);
  return found;
};
const click = async (label: string) =>
  act(async () => {
    button(label).click();
  });
async function mount(value: Raw, fetcher: typeof fetch) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  const root = createRoot(w.document.getElementById('root')!);
  const render = async (next: Raw) =>
    act(async () => root.render(createElement(RawWebContent, { key: `${next.id}:${next.bodySha256}`, raw: next })));
  await render(value);
  return {
    render,
    close: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = previous;
    },
  };
}

test('RAWOCR03 five states expose only clean text, collapse long results, and format tables/lists without model requests', async () => {
  const records = [
    artifact(1, 'skipped'),
    { ...artifact(2, 'ocr_ready'), ocrCleanText: '干净文字'.repeat(300) },
    artifact(3, 'needs_vlm'),
    {
      ...artifact(4, 'vlm_done'),
      vlmSummary: '测试摘要',
      vlmMarkdown: '|字段|数值|\n|:---|---:|\n|数量|42|\n\n1. 第一步\n2. 第二步',
      vlmConfidence: 'low',
      vlmWarnings: ['模糊处待核对'],
    },
    { ...artifact(5, 'failed'), vlmError: '模拟识别失败' },
  ];
  const calls: string[] = [];
  const screen = await mount(raw(5), async (url, options) => {
    assert.notEqual(options?.method, 'POST');
    calls.push(String(url));
    return response({ items: records });
  });
  try {
    for (const status of ['已跳过', '文字已识别', '待精读', '已精读', '失败'])
      assert.ok(w.document.body.textContent?.includes(status));
    assert.equal(w.document.querySelectorAll('figure').length, 5);
    assert.ok([...w.document.querySelectorAll('details')].every((item) => !item.open));
    assert.equal(w.document.querySelector('table td')?.textContent, '数量');
    assert.equal(w.document.querySelectorAll('ol li').length, 2);
    assert.ok(w.document.body.textContent?.includes('置信度：低'));
    assert.equal(w.document.querySelectorAll('a img').length, 5);
    assert.equal(calls.length, 1);
    assert.ok(!w.document.body.innerHTML.includes('ocrRawText'));
  } finally {
    await screen.close();
  }
});

test('RAWOCR03 single parsing prevents duplicate clicks, returns failed state, retries, and forces only explicit reread', async () => {
  const record = artifact(1, 'needs_vlm');
  const calls: Array<{ path: string; body: unknown }> = [];
  let finish!: (response: Response) => void;
  const deferred = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const screen = await mount(raw(), async (url, options) => {
    if (!options?.method) return response({ items: [record] });
    calls.push({ path: String(url), body: JSON.parse(String(options.body)) });
    if (calls.length === 1) return deferred;
    return response({ ...record, routeStatus: 'vlm_done', vlmSummary: '成功结果', vlmMarkdown: '已核对图中信息' });
  });
  try {
    await act(async () => {
      const target = button('精读此图');
      target.click();
      target.click();
    });
    assert.equal(calls.length, 1);
    assert.ok([...w.document.querySelectorAll('button')].every((item) => item.disabled));
    await act(async () => finish(response({ ...record, routeStatus: 'failed', vlmError: '失败可重试' })));
    assert.ok(w.document.body.textContent?.includes('失败可重试'));
    await click('重试精读');
    assert.ok(w.document.body.textContent?.includes('成功结果'));
    await click('重新精读');
    assert.deepEqual(
      calls.map((item) => item.body),
      [{}, {}, { force: true }],
    );
    assert.ok(calls.every((item) => item.path.endsWith(`/${record.mediaId}/parse-vlm`)));
  } finally {
    await screen.close();
  }
});

test('RAWOCR03 batch targets only pending images and preserves successes beside individual errors', async () => {
  const records = [artifact(1, 'needs_vlm'), artifact(2, 'needs_vlm'), artifact(3, 'vlm_done'), artifact(4, 'skipped')];
  let submitted: unknown;
  const screen = await mount(raw(4), async (url, options) => {
    if (!options?.method) return response({ items: records });
    assert.ok(String(url).endsWith('/parse-vlm-batch'));
    submitted = JSON.parse(String(options.body));
    return response({
      items: [
        { mediaId: records[0].mediaId, artifact: { ...records[0], routeStatus: 'vlm_done', vlmSummary: '第一图成功' } },
        { mediaId: records[1].mediaId, error: 'LLM_NOT_CONFIGURED' },
      ],
    });
  });
  try {
    await click('批量精读');
    assert.deepEqual(submitted, { mediaIds: records.slice(0, 2).map((item) => item.mediaId) });
    assert.ok(w.document.body.textContent?.includes('第一图成功'));
    assert.ok(w.document.body.textContent?.includes('尚未配置产品 LLM Provider'));
    assert.equal(w.document.querySelectorAll('[data-media-status="vlm_done"]').length, 2);
    assert.ok(button('重试精读'));
  } finally {
    await screen.close();
  }
});

test('RAWOCR03 old image records remain readable without migration and failed reads can recover', async () => {
  let calls = 0;
  const screen = await mount(raw(), async (_url, options) => {
    assert.notEqual(options?.method, 'POST');
    return ++calls === 1
      ? response({ error: { message: '读取失败', code: 'READ_FAILED' } }, 503)
      : response({ items: [] });
  });
  try {
    assert.equal(w.document.querySelector('img'), null);
    assert.ok(w.document.body.textContent?.includes('读取失败'));
    await click('查看原始正文');
    assert.match(w.document.querySelector('.raw-web-content pre')!.textContent!, /原文正文保真/u);
    assert.ok([...w.document.querySelectorAll('a')].some((link) => link.textContent?.includes('查看采集原图 1')));
    await click('重读图片状态');
    assert.ok(w.document.querySelector('img'));
    assert.ok(w.document.body.textContent?.includes('暂无解析记录'));
    assert.equal(calls, 2);
    assert.equal(w.document.querySelectorAll('button').length, 0);
  } finally {
    await screen.close();
  }
});

test('RAWOCR03 switching Raw while parsing discards the previous result', async () => {
  let finish!: (response: Response) => void;
  const deferred = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const screen = await mount(raw(1, 'first'), async (url, options) => {
    if (options?.method) {
      assert.ok(String(url).includes('/first/'));
      return deferred;
    }
    return response({
      items: String(url).includes('/first/')
        ? [artifact(1, 'needs_vlm')]
        : [{ ...artifact(1, 'ocr_ready'), ocrCleanText: '第二条的文字' }],
    });
  });
  try {
    await click('精读此图');
    await screen.render(raw(1, 'second'));
    await act(async () => finish(response({ ...artifact(1, 'vlm_done'), vlmSummary: '不应串入第二条的旧结果' })));
    assert.ok(w.document.body.textContent?.includes('第二条的文字'));
    assert.ok(!w.document.body.textContent?.includes('不应串入'));
    assert.ok([...w.document.querySelectorAll('img')].every((item) => item.src.includes('/second/')));
  } finally {
    await screen.close();
  }
});

test('RAWOCR04 reading hides historical OCR before loading and uses edited current anchors', async () => {
  const acquired = {
    ...raw(2),
    body: '图前原文\n【来源图片 1】\n【图片 OCR 转录（需核对）】\nDIRTY_LEGACY_SENTINEL\n【转录结束】\n图后原文\n【来源图片 2】\n结尾',
  };
  const revised = {
    ...acquired,
    bodyRevision: 1,
    body: `人工新引言\n${acquired.body.replace('DIRTY_LEGACY_SENTINEL', 'DIRTY_REVISED_SENTINEL')}`,
  };
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const screen = await mount(revised, async (_url, options) => {
    assert.notEqual(options?.method, 'POST');
    return pending;
  });
  try {
    assert.doesNotMatch(w.document.body.textContent!, /DIRTY_/u);
    await act(async () =>
      finish(
        response({
          items: [{ ...artifact(1, 'ocr_ready'), ocrCleanText: '已清洗识别正文' }],
          readingSource: { bodySha256: revised.bodySha256, ...inspectRawMedia(revised, acquired) },
        }),
      ),
    );
    const text = w.document.body.textContent!;
    assert.doesNotMatch(text, /DIRTY_|图片 OCR 转录|转录结束/u);
    assert.match(text, /人工新引言[\s\S]*图前原文[\s\S]*来源图片 1[\s\S]*图后原文[\s\S]*来源图片 2[\s\S]*结尾/u);
    assert.match(text, /已清洗识别正文/u);
    assert.equal(w.document.querySelectorAll('figure').length, 2);
    assert.match(revised.body, /DIRTY_REVISED_SENTINEL/u);
  } finally {
    await screen.close();
  }
});

test('RAWOCR04 deleted, repeated and code-only image markers do not restore an old picture', async () => {
  const acquired = {
    ...raw(),
    body: '保留正文\n【来源图片 1】\n【图片 OCR 转录（需核对）】\nDIRTY_LEGACY_SENTINEL\n【转录结束】\n结尾',
  };
  for (const replacement of ['', '【来源图片 1】\n【来源图片 1】', '```text\n【来源图片 1】\n```']) {
    const revised = { ...acquired, bodyRevision: 1, body: acquired.body.replace('【来源图片 1】', replacement) };
    const screen = await mount(revised, async () =>
      response({
        items: [],
        readingSource: { bodySha256: revised.bodySha256, ...inspectRawMedia(revised, acquired) },
      }),
    );
    try {
      assert.equal(w.document.querySelectorAll('figure').length, 0);
      assert.doesNotMatch(w.document.body.textContent!, /DIRTY_LEGACY_SENTINEL/u);
      assert.match(w.document.body.textContent!, /保留正文[\s\S]*结尾/u);
    } finally {
      await screen.close();
    }
  }
});

test('RAWOCR04 a reading source from another body revision requests refresh without exposing old OCR', async () => {
  const value = { ...raw(), body: 'DIRTY_LEGACY_SENTINEL' };
  const screen = await mount(value, async () =>
    response({
      items: [],
      readingSource: { bodySha256: '0'.repeat(64), markers: [], removed: [] },
    }),
  );
  try {
    assert.match(w.document.body.textContent!, /原文版本已变化/u);
    assert.doesNotMatch(w.document.body.textContent!, /DIRTY_LEGACY_SENTINEL/u);
  } finally {
    await screen.close();
  }
});

test('RAWOCR03 committed webpage derivative failure opens the existing Raw without file recovery claims or duplicate import', async () => {
  const previous = globalThis.fetch;
  const saved = raw();
  const committed: Raw[] = [];
  const opened: Raw[] = [];
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    assert.equal(String(url), '/api/raw/import');
    return response(
      {
        error: {
          code: 'RAW_MEDIA_IMPORT_INCOMPLETE',
          message: '图片派生记录写入失败，请打开已保存资料核对。',
          details: { committed: true, rawId: saved.id, raw: saved },
        },
      },
      500,
    );
  };
  const root = createRoot(w.document.getElementById('root')!);
  try {
    await act(async () =>
      root.render(
        createElement(ImportDialog, {
          onClose: () => {},
          onCommitted: async (value) => {
            committed.push(value);
          },
          onOpen: (value) => {
            opened.push(value);
          },
          onGenerate: async () => assert.fail('Partial import must not start generation'),
        }),
      ),
    );
    await act(async () => {
      const field = w.document.querySelector('input[type="url"]')!;
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        'https://example.test/article',
      );
      field.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    await click('从网页导入 Raw');
    assert.deepEqual(committed, [saved]);
    assert.ok(w.document.body.textContent?.includes('正文已保存，图片解析记录未完成'));
    assert.ok(w.document.body.textContent?.includes('图片派生记录写入失败，请打开已保存资料核对。'));
    assert.ok(w.document.body.textContent?.includes(saved.id));
    assert.ok(w.document.body.textContent?.includes(saved.title));
    const panel = w.document.querySelector('.result-panel')!.textContent!;
    assert.doesNotMatch(panel, /重启|自动对账|自动补齐|原件关联|asset ID|上传的文件/);
    await click('打开已保存资料');
    assert.deepEqual(opened, [saved]);
    assert.equal(requests, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
  }
});
