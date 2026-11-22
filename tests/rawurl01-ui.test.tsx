import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw } from '../app/api';

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
  HTMLTextAreaElement: w.HTMLTextAreaElement,
  Event: w.Event,
  Node: w.Node,
  FormData: w.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ImportDialog } = await import('../app/pages/RawPage');
const response = (value: unknown, status = 201) => new Response(JSON.stringify(value), { status });
const fixture: Raw = {
  id: 'fake-raw',
  title: '合成资料',
  sourceType: 'article',
  sourceName: '虚构来源',
  tags: [],
  body: '原文内容',
  importedAt: '2026-11-06T00:00:00Z',
  status: 'unprocessed',
  bodySha256: '0'.repeat(64),
};
const button = (label: string) =>
  [...w.document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
const click = (label: string) =>
  act(async () => {
    const item = button(label);
    assert(item, label);
    item.click();
  });
const tab = (prefix: string) =>
  act(async () => {
    const item = [...w.document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((tab) =>
      tab.textContent?.startsWith(prefix),
    );
    assert(item);
    item.click();
  });
const fill = (selector: string, value: string) =>
  act(async () => {
    const field = w.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    assert(field, selector);
    const prototype =
      field instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
const urlInput = 'input[type="url"]';
const mount = async (fetcher: typeof fetch) => {
  const old = globalThis.fetch,
    opened: Raw[] = [],
    committed: Raw[] = [],
    generated: Raw[] = [];
  globalThis.fetch = fetcher;
  const root = createRoot(w.document.getElementById('root')!);
  await act(async () =>
    root.render(
      createElement(ImportDialog, {
        onClose: () => {},
        onCommitted: async (raw) => {
          committed.push(raw);
        },
        onOpen: (raw) => {
          opened.push(raw);
        },
        onGenerate: async (raw) => {
          generated.push(raw);
        },
      }),
    ),
  );
  return {
    opened,
    committed,
    generated,
    close: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = old;
    },
  };
};

test('RAWURL01 only-link submit uses the import route, shows reading and saves before any generation', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  let finish!: (value: Response) => void;
  const wait = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const screen = await mount(async (input, options) => {
    calls.push({ path: String(input), body: JSON.parse(String(options?.body)) });
    return wait;
  });
  try {
    await tab('上传文件');
    await fill(urlInput, 'https://fixture.example/article');
    assert.equal(button('保存并生成 Wiki 草稿'), undefined);
    await click('从网页导入 Raw');
    assert(button('正在读取网页…').disabled);
    assert.deepEqual(calls, [
      {
        path: '/api/raw/import',
        body: {
          metadata: {
            title: '',
            sourceType: 'article',
            sourceName: '',
            url: 'https://fixture.example/article',
            tags: [],
          },
          translateToChinese: true,
        },
      },
    ]);
    await act(async () =>
      finish(response({ kind: 'url', raw: fixture, extraction: { parser: 'html', note: '本地样例', bodyChars: 4 } })),
    );
    assert.deepEqual(screen.opened, [fixture]);
    assert.deepEqual(screen.committed, [fixture]);
    assert.deepEqual(screen.generated, []);
  } finally {
    await screen.close();
  }
});

test('RAWURL01 failed webpage retains input, then adding pasted text saves exact body without a second fetch', async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const screen = await mount(async (input, options) => {
    calls.push({ path: String(input), body: JSON.parse(String(options?.body)) });
    return calls.length === 1
      ? response({ error: { code: 'RAW_URL_UNREADABLE', message: '网页需要登录，无法读取正文。' } }, 422)
      : response(fixture);
  });
  try {
    await fill(urlInput, 'https://fixture.example/login');
    await click('从网页导入 Raw');
    assert.match(w.document.body.textContent!, /可以上传文件或粘贴可读取的原文/);
    assert.equal(w.document.querySelector<HTMLInputElement>(urlInput)?.value, 'https://fixture.example/login');
    assert.equal(screen.opened.length, 0);
    await fill('input[data-autofocus]', '资料标题');
    await fill('input[placeholder*="客户访谈"]', '业务来源');
    await fill('textarea', '  正文\n\n第二段  ');
    await click('仅保存 Raw');
    assert.deepEqual(
      calls.map((call) => call.path),
      ['/api/raw/import', '/api/raw'],
    );
    assert.equal(calls[1].body.body, '  正文\n\n第二段  ');
    assert.equal(calls[1].body.url, 'https://fixture.example/login');
    assert.equal(screen.generated.length, 0);
  } finally {
    await screen.close();
  }
});

test('RAWURL01 file remains visible across tabs, and a failed upload does not fall back', async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const screen = await mount(async (input, options) => {
    calls.push({ path: String(input), body: options?.body });
    return response({ error: { code: 'PARSE_FAILED', message: '该原件不能解析。' } }, 422);
  });
  try {
    await fill(urlInput, 'https://fixture.example/bad');
    await fill('textarea', '已粘贴正文');
    await tab('上传文件');
    const picker = w.document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new w.File(['文件正文'], 'fixture.txt');
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => picker.dispatchEvent(new w.Event('change', { bubbles: true })));
    await tab('粘贴文本');
    assert.match(w.document.querySelector('.file-picked')!.textContent!, /本次使用文件 fixture.txt/);
    await click('仅保存 Raw');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/raw/import');
    assert.equal(calls[0].body.get('file').name, 'fixture.txt');
    assert.equal(calls[0].body.get('body'), null);
    assert.equal(screen.committed.length, 0);
    assert.match(w.document.body.textContent!, /该原件不能解析/);
    await click('移除文件');
    assert.match(w.document.body.textContent!, /本次使用已粘贴的正文/);
    assert.equal(w.document.querySelector('textarea')?.value, '已粘贴正文');
  } finally {
    await screen.close();
  }
});
