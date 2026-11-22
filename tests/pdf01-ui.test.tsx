import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw, RawPdf } from '../app/api';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const w = dom.window;
for (const [name, value] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  Event: w.Event,
  Node: w.Node,
  FormData: w.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PdfPages } = await import('../app/PdfPages');
const { ImportDialog, RawPage } = await import('../app/pages/RawPage');
const node = () => w.document.getElementById('root')!;
const scan: Raw = {
  id: 'scan',
  title: '扫描件',
  sourceType: 'report',
  sourceName: '合成',
  tags: [],
  body: '',
  bodySha256: '0'.repeat(64),
  importedAt: '2026-11-09T00:00:00Z',
  status: 'unprocessed',
  assetId: 'asset',
  assetFormat: 'pdf',
  assetSha256: 'a'.repeat(64),
  pdf: {
    pageCount: 2,
    hasTextLayer: false,
    pages: [
      { page: 1, textStart: null, textEnd: null },
      { page: 2, textStart: null, textEnd: null },
    ],
  },
};
const base = '/api/raw/scan/pdf';
const pdf: RawPdf = {
  rawId: scan.id,
  assetId: 'asset',
  assetSha256: 'a'.repeat(64),
  pageCount: 2,
  hasTextLayer: false,
  originalUrl: base + '/original',
  pages: scan.pdf!.pages.map((page) => ({ ...page, imageUrl: `${base}/pages/${page.page}/image`, status: 'pending' })),
  job: null,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const no = () => {};
const settled = async () => {};
const click = (label: string) =>
  act(async () => {
    const button = [...w.document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    assert(button, label);
    button.click();
  });
const tick = async (check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  assert.fail('PDF UI did not settle');
};

test('PDF01 scanned file saves the Raw and offers page reading without starting legacy extraction', async () => {
  const native = globalThis.fetch,
    posts: string[] = [];
  let generated = 0,
    committed: Raw | undefined,
    opened: Raw | undefined;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') posts.push(String(input));
    return response(
      {
        kind: 'file',
        raw: scan,
        asset: { fileName: 'scan.pdf', format: 'pdf', byteSize: 9, storedFile: 'asset.pdf', sha256: 'a'.repeat(64) },
        extraction: { parser: 'pdfjs', note: '无文字层', bodyChars: 0 },
      },
      201,
    );
  };
  const root = createRoot(node());
  try {
    await act(async () =>
      root.render(
        createElement(ImportDialog, {
          onClose: no,
          onCommitted: async (raw) => {
            committed = raw;
          },
          onOpen: (raw) => {
            opened = raw;
          },
          onGenerate: async () => {
            generated++;
          },
        }),
      ),
    );
    await act(async () =>
      [...w.document.querySelectorAll<HTMLButtonElement>('[role=tab]')]
        .find((tab) => tab.textContent?.startsWith('上传文件'))!
        .click(),
    );
    const picker = w.document.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(picker, 'files', { value: [new w.File(['%PDF-test'], 'scan.pdf')], configurable: true });
    await act(async () => picker.dispatchEvent(new w.Event('change', { bubbles: true })));
    assert.doesNotMatch(node().textContent!, /保存并生成 Wiki 草稿/);
    await click('仅保存 Raw');
    assert.deepEqual(posts, ['/api/raw/import']);
    assert.deepEqual(committed, scan);
    assert.equal(generated, 0);
    assert.match(node().textContent!, /导入成功：扫描 PDF 原件已保存/);
    await click('查看 PDF 页面');
    assert.deepEqual(opened, scan);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('mixed PDF import uses page reading even when the submitted filename did not signal PDF', async () => {
  const native = globalThis.fetch;
  const mixed: Raw = { ...scan, body: '第一页文字', pdf: { ...scan.pdf!, hasTextLayer: true } };
  let generated = 0,
    committed: Raw | undefined;
  globalThis.fetch = async () =>
    response(
      {
        kind: 'file',
        raw: mixed,
        asset: { fileName: 'mixed.pdf', format: 'pdf', byteSize: 9, storedFile: 'asset.pdf', sha256: 'a'.repeat(64) },
        extraction: { parser: 'pdfjs', note: '混合资料', bodyChars: mixed.body.length },
      },
      201,
    );
  const root = createRoot(node());
  try {
    await act(async () =>
      root.render(
        createElement(ImportDialog, {
          onClose: no,
          onCommitted: async (raw) => {
            committed = raw;
          },
          onOpen: no,
          onGenerate: async () => {
            generated++;
          },
        }),
      ),
    );
    await act(async () =>
      [...w.document.querySelectorAll<HTMLButtonElement>('[role=tab]')]
        .find((tab) => tab.textContent?.startsWith('上传文件'))!
        .click(),
    );
    const picker = w.document.querySelector<HTMLInputElement>('input[type=file]')!;
    const choose = async (name: string) =>
      act(async () => {
        Object.defineProperty(picker, 'files', { value: [new w.File(['%PDF-test'], name)], configurable: true });
        picker.dispatchEvent(new w.Event('change', { bubbles: true }));
      });
    await choose('mixed.PDF');
    assert.doesNotMatch(node().textContent!, /保存并生成 Wiki 草稿/);
    assert.match(node().textContent!, /保存后可逐页阅读/);
    await choose('mixed.txt');
    await click('保存并生成 Wiki 草稿');
    assert.deepEqual(committed, mixed);
    assert.equal(generated, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('PDF01 scan details expose the page viewer and never the old extraction entry; navigation is read only', async () => {
  const native = globalThis.fetch,
    calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url === base) return response(pdf);
    const match = /\/pages\/(\d+)$/u.exec(url);
    return match ? response({ ...pdf.pages[Number(match[1]) - 1], text: '' }) : response({ items: [] });
  };
  const root = createRoot(node());
  try {
    await act(async () =>
      root.render(
        createElement(RawPage, {
          items: [scan],
          selectedId: scan.id,
          onSelected: no,
          onOpenImport: no,
          onCommitted: settled,
          openImport: false,
          onCloseImport: no,
          onDeleted: settled,
          processing: {},
          job: null,
          onJobStarted: no,
          onOpenDraft: no,
          onRefresh: settled,
        }),
      ),
    );
    await tick(() => node().textContent!.includes('本页没有可提取的文字层'));
    assert.doesNotMatch(node().textContent!, /整理并融入知识库/);
    assert.equal(node().querySelector('a[href="#pdf-pages"]')?.textContent, '前往 PDF 逐页阅读');
    await click('下一页');
    await tick(() => node().querySelector('img[alt="PDF 第 2 页"]') !== null);
    assert.equal(node().querySelector('a[href$="#page=2"]')?.getAttribute('href'), base + '/original#page=2');
    assert(calls.some((call) => call.url === base + '/pages/2'));
    assert(calls.every((call) => call.method === 'GET'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('PDF01 marks a failed job as incomplete, preserves the page result, and continues only on click', async () => {
  const native = globalThis.fetch,
    posts: string[] = [];
  let job: RawPdf['job'] = {
    status: 'failed',
    completedPages: 1,
    totalPages: 2,
    attempts: 2,
    failedPage: 2,
    error: { code: 'FAILED', message: '第2页受控失败。' },
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push(url);
      job = { status: 'completed', completedPages: 2, totalPages: 2, attempts: 3 };
    }
    if (url === base + '/pages/1')
      return response({
        ...pdf.pages[0],
        status: 'completed',
        text: '',
        understanding: {
          blank: false,
          content: '已完成第一页',
          visuals: '图像信息',
          inference: '待验证推断',
          questions: ['核对图例'],
        },
      });
    return response({
      ...pdf,
      job,
      pages: pdf.pages.map((page, index) => (index === 0 ? { ...page, status: 'completed' } : page)),
    });
  };
  const root = createRoot(node());
  try {
    await act(async () => root.render(createElement(PdfPages, { rawId: 'scan' })));
    await tick(() => node().textContent!.includes('已完成第一页'));
    assert.match(node().textContent!, /页理解未完成 · 1\/2 页/);
    assert.match(node().textContent!, /第 2 页：第2页受控失败/);
    assert.doesNotMatch(node().textContent!, /整份 PDF 已完成/);
    assert.deepEqual(posts, []);
    await click('继续 AI 页理解');
    await tick(() => node().textContent!.includes('整份 PDF 已完成页理解 · 2/2 页'));
    assert.deepEqual(posts, [base + '/understand']);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});
