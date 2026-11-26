import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import type { Prompt } from '../app/api';

const directory = fileURLToPath(new URL('../app/pages/prompt/', import.meta.url));

test('FE03 Prompt modules stay below the frozen limits with no entry back-import or internal cycle', async () => {
  const entry = await import('../app/pages/PromptLibraryPage.tsx');
  assert.deepEqual(Object.keys(entry), ['PromptLibraryPage']);
  const files = readdirSync(directory).filter((name) => /\.tsx?$/.test(name));
  const graph = new Map<string, string[]>();
  for (const file of ['../PromptLibraryPage.tsx', ...files]) {
    const source = readFileSync(path.join(directory, file), 'utf8');
    assert.ok(Buffer.byteLength(source) < 40_960, `${file}: byte limit`);
    assert.ok(source.trimEnd().split('\n').length < 800, `${file}: line limit`);
    if (file.startsWith('../')) continue;
    const dependencies = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(
      dependencies.every((dependency) => !dependency.includes('PromptLibraryPage')),
      `${file}: entry boundary`,
    );
    graph.set(
      file,
      dependencies
        .filter((dependency) => dependency.startsWith('./'))
        .map((dependency) => files.find((candidate) => candidate.replace(/\.tsx?$/, '') === dependency.slice(2)))
        .filter((dependency): dependency is string => !!dependency),
    );
  }
  const visit = (file: string, stack: string[]) => {
    assert.ok(!stack.includes(file), `cycle: ${[...stack, file].join(' -> ')}`);
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...stack, file]);
  };
  for (const file of files) visit(file, []);
});

test('FE03 two composed Prompt pages keep variables, busy ownership and delayed renders isolated', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PromptLibraryPage } = await import('../app/pages/PromptLibraryPage.tsx');
  const originalFetch = globalThis.fetch;
  const promptA: Prompt = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: '变量模板',
    category: 'office',
    scenario: '',
    body: '总结 {{资料}}',
    variables: ['资料'],
    inputRequirements: '',
    outputRequirements: '',
    relatedWikiIds: [],
    examples: '',
    tags: [],
    favorite: false,
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    version: 1,
    source: 'manual',
  };
  const promptB: Prompt = {
    ...promptA,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: '无变量模板',
    body: '独立正文',
    variables: [],
  };
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let renderRequests = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    let data: unknown;
    if (url === '/api/prompts/schema') data = { categories: [{ id: 'office', label: '办公' }] };
    else if (url === '/api/wiki') data = { items: [] };
    else if (url === '/api/prompts') data = { items: [promptA, promptB], categoryCounts: { office: 2 } };
    else if (url.endsWith('/render')) {
      const payload = JSON.parse(String(init.body)) as { values: Record<string, string> };
      renderRequests += 1;
      if (payload.values['资料'] === '左侧资料') await delayed;
      data = { id: promptA.id, version: 1, body: `总结 ${payload.values['资料']}`, missingVariables: [] };
    } else if (url.endsWith('/versions')) data = { items: [] };
    else if (url.includes('/feedback?')) data = { items: [] };
    else if (url === `/api/prompts/${promptA.id}`) data = { prompt: promptA, wikiLinks: [] };
    else if (url === `/api/prompts/${promptB.id}`) data = { prompt: promptB, wikiLinks: [] };
    else assert.fail(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const root = createRoot(window.document.getElementById('root')!);
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 130));
    });
  };
  const click = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  try {
    await act(async () => {
      root.render(
        <>
          <div id="left">
            <PromptLibraryPage onChanged={() => undefined} onOpenWiki={() => undefined} />
          </div>
          <div id="right">
            <PromptLibraryPage onChanged={() => undefined} onOpenWiki={() => undefined} />
          </div>
        </>,
      );
    });
    await settle();
    const left = window.document.getElementById('left')!;
    const right = window.document.getElementById('right')!;
    for (const [scope, value] of [
      [left, '左侧资料'],
      [right, '右侧资料'],
    ] as const) {
      const field = scope.querySelector('.prompt-fields input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    }
    const renderButton = (scope: Element) => {
      const button = [...scope.querySelectorAll('button')].find((item) => item.textContent === '生成最终正文');
      assert.ok(button);
      return button;
    };
    await click(renderButton(left));
    assert.equal(renderRequests, 1);
    assert.equal(renderButton(right).disabled, false, 'a pending left render must not lock the right page');
    await click(renderButton(right));
    assert.equal(right.querySelector('[data-testid="prompt-final"]')?.textContent, '总结 右侧资料');
    const rowB = [...left.querySelectorAll('.prompt-list-item')].find((item) =>
      item.textContent?.includes('无变量模板'),
    );
    assert.ok(rowB);
    await click(rowB);
    await act(async () => {
      release();
      await delayed;
    });
    assert.equal(left.querySelector('.prompt-detail h2')?.textContent, '无变量模板');
    assert.equal(left.querySelector('[data-testid="prompt-final"]')?.textContent, '独立正文');
    assert.equal(right.querySelector('.prompt-detail h2')?.textContent, '变量模板');
    assert.equal(right.querySelector('[data-testid="prompt-final"]')?.textContent, '总结 右侧资料');
    assert.equal((right.querySelector('.prompt-fields input') as HTMLInputElement).value, '右侧资料');
  } finally {
    release();
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    window.close();
  }
});
