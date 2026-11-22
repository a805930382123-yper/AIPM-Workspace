// F03-03 / F03-04 / F03-01(UI): real DOM interaction tests without a browser.
// A jsdom document hosts the real React components; only `fetch` is stubbed, because the real
// HTTP behaviour of the same endpoints is covered by the HTTP self-check over a live server.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw } from '../app/api';
import { MAX_UPLOAD_BYTES } from '../services/raw/limits.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
// Node defines some of these as getter-only globals, so assign them explicitly.
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  FormData: window.FormData,
  File: window.File,
  Blob: window.Blob,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App.tsx');
const { RawPage } = await import('../app/pages/RawPage.tsx');

const sha = 'a'.repeat(64);
function makeRaw(overrides: Partial<Raw> = {}): Raw {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: '已有资料',
    sourceType: 'article',
    sourceName: '来源',
    tags: ['渠道', '库存'],
    body: '旧正文',
    importedAt: '2026-10-05T00:00:00.000Z',
    status: 'unprocessed',
    bodySha256: sha,
    ...overrides,
  };
}
const reply = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  }) as unknown as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const byText = (text: string, root: ParentNode = window.document) =>
  [...root.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text)) as
    HTMLButtonElement | undefined;
const required = <T,>(value: T | null | undefined, what: string): T => {
  assert.ok(value, `找不到${what}`);
  return value;
};
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  });
}
async function type(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    target instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  assert.ok(setter, 'value setter');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
  });
}
async function submitForm() {
  const form = required(window.document.querySelector('form') as HTMLFormElement | null, '导入表单');
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
  });
}
async function mount(element: React.ReactElement) {
  const container = window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await tick();
  });
  return {
    root,
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

type Harness = {
  calls: Array<{ url: string; method: string; body: unknown }>;
  raws: Raw[];
  mode: 'success' | 'partial';
  references: Array<{ id: string; title: string }>;
};
function stubFetch(initial: Raw[], mode: 'success' | 'partial'): Harness {
  const harness: Harness = { calls: [], raws: initial, mode, references: [] };
  const stats = () => ({
    rawCount: harness.raws.length,
    wikiCount: 0,
    thisWeekNewCount: harness.raws.length,
    pendingConfirmationCount: 0,
    openAuditCount: 0,
    promptCount: 0,
    weekStartsOn: '2026-10-05',
  });
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    harness.calls.push({ url, method, body: init.body });
    if (url === '/api/raw' && method === 'GET') return reply({ items: harness.raws });
    if (url === '/api/stats') return reply(stats());
    if (url === '/api/raw-processing') return reply({ items: [] });
    if (url === '/api/raw' && method === 'POST') {
      const input = JSON.parse(String(init.body)) as Partial<Raw>;
      const created = makeRaw({
        ...input,
        id: `created-${harness.raws.length}`,
        body: String(input.body),
        bodySha256: sha,
      });
      harness.raws = [created, ...harness.raws];
      return reply(created, 201);
    }
    if (url === '/api/raw/import' && method === 'POST') {
      // A real server commits the Raw before the linkage record is written, in both outcomes.
      const raw = uploadedRaw();
      if (!harness.raws.some((item) => item.id === raw.id)) harness.raws = [raw, ...harness.raws];
      return harness.mode === 'partial' ? partialPayload() : successPayload();
    }
    if (url.endsWith('/references')) return reply({ items: harness.references });
    if (url.startsWith('/api/raw/') && method === 'DELETE') {
      const id = url.split('/')[3];
      const removed = harness.raws.find((item) => item.id === id);
      harness.raws = harness.raws.filter((item) => item.id !== id);
      return reply({
        id,
        title: removed?.title ?? '',
        assetId: removed?.assetId ?? null,
        assetRetained: Boolean(removed?.assetId),
        warnings: [],
      });
    }
    if (url.startsWith('/api/raw/') && method === 'GET')
      return reply(harness.raws.find((item) => url.includes(item.id)) ?? {});
    return reply({}, 404);
  }) as unknown as typeof fetch;
  return harness;
}
const uploadedRaw = () =>
  makeRaw({
    id: 'new-pdf',
    title: '新上传的 PDF',
    assetId: 'asset-1',
    assetFileName: 'zh-report.pdf',
    assetFormat: 'pdf',
    assetByteSize: 40,
    assetSha256: 'b'.repeat(64),
    extractionParser: 'pdfjs-dist 6.4.299',
    extractionNote: 'pdfjs-dist 提取。',
  });
const successPayload = () =>
  reply(
    {
      raw: uploadedRaw(),
      asset: {
        id: 'asset-1',
        fileName: 'zh-report.pdf',
        format: 'pdf',
        declaredExtension: '.pdf',
        byteSize: 40,
        sha256: 'b'.repeat(64),
        storedFile: 'asset-1.pdf',
        createdAt: '2026-10-05T00:00:00.000Z',
        status: 'parsed',
        rawId: 'new-pdf',
        parser: 'pdfjs-dist 6.4.299',
        extractionNote: 'pdfjs-dist 提取。',
      },
      extraction: { parser: 'pdfjs-dist 6.4.299', note: 'pdfjs-dist 提取。', bodyChars: 96 },
    },
    201,
  );
const partialPayload = () =>
  reply(
    {
      error: {
        code: 'IMPORT_LINK_PENDING',
        message:
          '正文已写入正式 Raw（id new-pdf），原件已保留（assetId asset-1，40 字节，SHA-256 bb…），但原件关联记录写入失败：blocked。工作台会在此目录下次启动时自动补齐该关联；请不要重复导入同一文件。',
        details: {
          committed: true,
          recoverable: true,
          rawId: 'new-pdf',
          assetId: 'asset-1',
          fileName: 'zh-report.pdf',
          byteSize: 40,
          sha256: 'b'.repeat(64),
          format: 'pdf',
          raw: uploadedRaw(),
        },
      },
    },
    500,
  );

async function openRawPage(harness: Harness) {
  const mounted = await mount(<App />);
  await click(required(byText('Raw 原始资料', mounted.container), 'Raw 导航'));
  assert.ok(harness.raws.length >= 1);
  await click(required(byText('导入资料', mounted.container), '导入资料按钮'));
  return mounted;
}
async function choseFile(container: HTMLElement, name: string, size: number) {
  await click(required(byText('上传文件', container), '上传文件标签'));
  const input = required(container.querySelector('input[type="file"]') as HTMLInputElement | null, '文件选择框');
  const file = new window.File([new Uint8Array(size)], name, { type: 'application/octet-stream' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  return file;
}

test('F03-03 重新导入未经编辑的两个标签仍是两项', async () => {
  const harness = stubFetch([], 'partial');
  const committed: Raw[] = [];
  const mounted = await mount(
    <RawPage
      items={[makeRaw()]}
      selectedId={'11111111-1111-4111-8111-111111111111'}
      onSelected={() => undefined}
      onOpenImport={() => undefined}
      onCommitted={async (raw) => {
        committed.push(raw);
      }}
      openImport={false}
      onCloseImport={() => undefined}
      onDeleted={async () => undefined}
      processing={{}}
      job={null}
      onJobStarted={() => undefined}
      onOpenDraft={() => undefined}
      onRefresh={async () => undefined}
    />,
  );
  try {
    await click(required(byText('重新导入', mounted.container), '重新导入按钮'));
    assert.match(mounted.container.innerHTML, /重新导入会创建新的 Raw ID/);
    assert.match(mounted.container.innerHTML, /当前 2 项（未修改，按原标签保存）/);
    await type(
      required(mounted.container.querySelector('textarea') as HTMLTextAreaElement | null, '正文输入框'),
      '重新导入的新正文',
    );
    await submitForm();
    const posted = harness.calls.filter((call) => call.url === '/api/raw' && call.method === 'POST').at(-1);
    assert.ok(posted, '必须提交到 POST /api/raw');
    assert.deepEqual(JSON.parse(String(posted?.body)).tags, ['渠道', '库存'], '未编辑的标签不能被合并成一项');
    assert.equal(committed.length, 1, '粘贴导入成功后必须同步一次父组件');
  } finally {
    await mounted.unmount();
  }
});

test('F03-03 用户编辑标签时支持中文逗号、英文逗号与顿号', async () => {
  const harness = stubFetch([], 'partial');
  const mounted = await mount(
    <RawPage
      items={[makeRaw()]}
      selectedId={'11111111-1111-4111-8111-111111111111'}
      onSelected={() => undefined}
      onOpenImport={() => undefined}
      onCommitted={async () => undefined}
      openImport={false}
      onCloseImport={() => undefined}
      onDeleted={async () => undefined}
      processing={{}}
      job={null}
      onJobStarted={() => undefined}
      onOpenDraft={() => undefined}
      onRefresh={async () => undefined}
    />,
  );
  try {
    await click(required(byText('重新导入', mounted.container), '重新导入按钮'));
    const tags = required(
      [...mounted.container.querySelectorAll('input')].find((input) =>
        (input.getAttribute('placeholder') ?? '').startsWith('用逗号或顿号分隔'),
      ) as HTMLInputElement | undefined,
      '标签输入框',
    );
    await type(tags, '渠道,库存、动销；SKU');
    assert.match(mounted.container.innerHTML, /当前 4 项/);
    await type(
      required(mounted.container.querySelector('textarea') as HTMLTextAreaElement | null, '正文输入框'),
      '正文',
    );
    await submitForm();
    const posted = harness.calls.filter((call) => call.url === '/api/raw' && call.method === 'POST').at(-1);
    assert.deepEqual(JSON.parse(String(posted?.body)).tags, ['渠道', '库存', '动销', 'SKU']);
  } finally {
    await mounted.unmount();
  }
});

test('F03-04 上传成功后关闭结果面板，列表与统计已同步', async () => {
  const harness = stubFetch([makeRaw()], 'success');
  const mounted = await openRawPage(harness);
  try {
    await choseFile(mounted.container, 'zh-report.pdf', 40);
    await submitForm();
    assert.match(mounted.container.innerHTML, /导入成功：正文已入库，原件已保留/, '成功面板必须出现');
    assert.match(mounted.container.innerHTML, /96 字符/);
    // The parent list is already updated while the panel is still open (数据同步与展示分离).
    const listBefore = required(mounted.container.querySelector('.raw-list') as HTMLElement | null, '资料列表');
    assert.match(listBefore.textContent ?? '', /新上传的 PDF/, '成功后面板未关闭时列表就应包含新资料');
    const uploads = harness.calls.filter((call) => call.url === '/api/raw/import').length;
    await click(required(byText('关闭', mounted.container), '关闭按钮'));
    assert.equal(mounted.container.querySelector('.import-dialog'), null, '关闭后对话框必须消失');
    assert.match(
      required(mounted.container.querySelector('.raw-list') as HTMLElement | null, '资料列表').textContent ?? '',
      /新上传的 PDF/,
      '关闭结果后列表必须保留新资料',
    );
    assert.equal(harness.calls.filter((call) => call.url === '/api/raw/import').length, uploads, '关闭不得再次上传');
    assert.equal(harness.raws.filter((item) => item.id === 'new-pdf').length, 1, '不得重复添加');
  } finally {
    await mounted.unmount();
  }
});

test('F03-04 继续导入下一条也保持列表同步，且不重复上传', async () => {
  const harness = stubFetch([makeRaw()], 'success');
  const mounted = await openRawPage(harness);
  try {
    await choseFile(mounted.container, 'zh-report.pdf', 40);
    await submitForm();
    await click(required(byText('继续导入下一条', mounted.container), '继续导入按钮'));
    assert.ok(mounted.container.querySelector('form'), '继续导入应回到表单');
    assert.match(
      required(mounted.container.querySelector('.raw-list') as HTMLElement | null, '资料列表').textContent ?? '',
      /新上传的 PDF/,
    );
    assert.equal(harness.calls.filter((call) => call.url === '/api/raw/import').length, 1);
  } finally {
    await mounted.unmount();
  }
});

test('F03-01 部分提交：界面显示待恢复、不显示成功，并立即同步已创建的 Raw', async () => {
  const harness = stubFetch([makeRaw()], 'partial');
  const mounted = await openRawPage(harness);
  try {
    await choseFile(mounted.container, 'zh-report.pdf', 40);
    await submitForm();
    const html = mounted.container.innerHTML;
    assert.equal(html.includes('导入成功'), false, '部分提交不得显示导入成功');
    assert.match(html, /部分提交：正文已入库，原件关联待恢复/);
    assert.match(html, /IMPORT_LINK_PENDING/);
    assert.match(html, /请不要重复导入同一文件/);
    assert.match(html, /重启工作台自动对账/);
    assert.match(html, /new-pdf/, '必须展示已提交的 Raw ID');
    assert.match(html, /asset-1/, '必须展示原件 asset ID');
    assert.match(
      required(mounted.container.querySelector('.raw-list') as HTMLElement | null, '资料列表').textContent ?? '',
      /新上传的 PDF/,
      '已提交的 Raw 必须立即出现在列表',
    );
    await click(required(byText('查看已创建的 Raw', mounted.container), '查看按钮'));
    assert.equal(mounted.container.querySelector('.import-dialog'), null, '查看后应关闭对话框');
  } finally {
    await mounted.unmount();
  }
});

test('F03-04 前端超限拦截：超过 20 MiB 的文件不会上传', async () => {
  const harness = stubFetch([makeRaw()], 'success');
  const mounted = await openRawPage(harness);
  try {
    await choseFile(mounted.container, 'huge.txt', MAX_UPLOAD_BYTES + 1);
    assert.match(mounted.container.innerHTML, /FILE_TOO_LARGE/);
    assert.match(mounted.container.innerHTML, /工作台不会上传它/);
    await submitForm();
    assert.equal(harness.calls.filter((call) => call.url === '/api/raw/import').length, 0, '超限文件不得发起上传请求');
  } finally {
    await mounted.unmount();
  }
});

test('F03-04 右上角关闭与查看这条资料同样保持同步，首页计数一致', async () => {
  const first = stubFetch([makeRaw()], 'success');
  const mounted = await openRawPage(first);
  try {
    await choseFile(mounted.container, 'zh-report.pdf', 40);
    await submitForm();
    await click(
      required(mounted.container.querySelector('.icon-button') as HTMLButtonElement | null, '右上角关闭按钮'),
    );
    assert.equal(mounted.container.querySelector('.import-dialog'), null, '右上角关闭后对话框必须消失');
    assert.match(
      required(mounted.container.querySelector('.raw-list') as HTMLElement | null, '资料列表').textContent ?? '',
      /新上传的 PDF/,
    );
  } finally {
    await mounted.unmount();
  }

  const second = stubFetch([makeRaw()], 'success');
  const other = await openRawPage(second);
  try {
    await choseFile(other.container, 'zh-report.pdf', 40);
    await submitForm();
    await click(required(byText('查看这条资料', other.container), '查看按钮'));
    assert.equal(other.container.querySelector('.import-dialog'), null, '查看后对话框必须关闭');
    assert.match(
      required(other.container.querySelector('.raw-detail') as HTMLElement | null, '详情面板').textContent ?? '',
      /新上传的 PDF/,
      '查看后应打开新提交的资料',
    );
    await click(required(byText('首页', other.container), '首页导航'));
    const values = [...other.container.querySelectorAll('.stat-card strong')].map((element) => element.textContent);
    assert.ok(values.includes('2'), `首页统计必须包含新上传的 Raw：${values.join(',')}`);
  } finally {
    await other.unmount();
  }
});

test('UI 最终确认删除与引用阻止：确认后列表同步，被引用时按钮禁用', async () => {
  // The browser acceptance left "最终确认删除" as NOT_RUN; that path is reproduced here.
  const harness = stubFetch([makeRaw()], 'success');
  const mounted = await mount(<App />);
  try {
    await click(required(byText('Raw 原始资料', mounted.container), 'Raw 导航'));
    await click(required(byText('删除', mounted.container), '删除按钮'));
    assert.match(mounted.container.innerHTML, /删除后正文不可恢复/);
    await click(required(byText('确认删除', mounted.container), '确认删除按钮'));
    assert.equal(mounted.container.querySelector('.import-dialog'), null, '确认删除后对话框必须关闭');
    assert.equal(
      harness.calls.some((call) => call.url === `/api/raw/${makeRaw().id}` && call.method === 'DELETE'),
      true,
      '必须调用公开删除接口',
    );
    assert.match(mounted.container.innerHTML, /还没有原始资料/, '删除最后一条后列表必须同步为空');
    assert.equal(harness.raws.length, 0);
  } finally {
    await mounted.unmount();
  }

  const blocked = stubFetch([makeRaw()], 'success');
  blocked.references = [{ id: 'w1', title: '被引用的 Wiki 页' }];
  const other = await mount(<App />);
  try {
    await click(required(byText('Raw 原始资料', other.container), 'Raw 导航'));
    await click(required(byText('删除', other.container), '删除按钮'));
    assert.match(other.container.innerHTML, /已被 1 条正式 Wiki 引用，本批禁止删除/);
    assert.match(other.container.innerHTML, /被引用的 Wiki 页/);
    const confirm = required(byText('确认删除', other.container), '确认删除按钮');
    assert.equal(confirm.disabled, true, '被引用时确认删除必须禁用');
    assert.equal(blocked.raws.length, 1, '被引用时不得删除 Raw');
  } finally {
    await other.unmount();
  }
});

test('F03-01 关联写入成功后不出现待恢复面板', async () => {
  const harness = stubFetch([makeRaw()], 'success');
  const mounted = await openRawPage(harness);
  try {
    await choseFile(mounted.container, 'zh-report.pdf', 40);
    await submitForm();
    assert.equal(mounted.container.innerHTML.includes('部分提交'), false);
    assert.match(mounted.container.innerHTML, /导入成功：正文已入库，原件已保留/);
    assert.match(mounted.container.innerHTML, /查看这条资料/);
  } finally {
    await mounted.unmount();
  }
});
