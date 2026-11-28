import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ProductBlueprintPage } = await import('../app/pages/ProductBlueprintPage.tsx');

test('保留跨区草稿并在版本冲突后保留表单', async () => {
  const blueprint = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    title: '测试构想',
    oneLiner: '',
    status: 'exploring',
    createdAt: '2026-11-29T00:00:00Z',
    updatedAt: '2026-11-29T00:00:00Z',
    context: { background: '', businessGoal: '', constraints: '' },
    links: { rawIds: [], wikiIds: [], workItemIds: [] },
    personas: [],
    scenarios: [],
    pains: [],
    alternatives: [],
    values: [],
    features: [],
    vision: { northStar: '', targetScope: '', outOfScope: '', metrics: [], risks: [] },
    milestones: [],
  };
  const detail = { blueprint, checks: [], sources: { raw: [], wiki: [], workItems: [] } };
  globalThis.fetch = (async (url, init) => {
    if (init?.method === 'POST') return Response.json(detail);
    if (init?.method === 'PUT')
      return Response.json({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } }, { status: 409 });
    if (String(url).endsWith('/sources')) return Response.json({ raw: [], wiki: [], workItems: [] });
    return Response.json({ items: [], errors: [] });
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    assert.ok(button, text);
    await act(async () => {
      button.click();
    });
  };
  const set = async (label: string, value: string) => {
    const input = [...document.querySelectorAll('label')]
      .find((l) => l.textContent?.includes(label))
      ?.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement;
    assert.ok(input, label);
    const prototype =
      input instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  await act(async () => {
    root.render(
      createElement(ProductBlueprintPage, { onOpenRaw: () => {}, onDirtyChange: () => {}, onBusyChange: () => {} }),
    );
  });
  await set('名称', '测试构想');
  await click('新建构想');
  await set('业务背景', '尚未保存的背景');
  await click('使用者');
  await click('添加角色');
  await set('角色名称', '业务员');
  await click('保存使用者');
  assert.match(document.body.textContent!, /版本冲突/);
  assert.equal((document.querySelector('input[value="业务员"]') as HTMLInputElement)?.value, '业务员');
  await click('背景 •');
  assert.equal(
    [...document.querySelectorAll('textarea')].find((x) => x.value === '尚未保存的背景')?.value,
    '尚未保存的背景',
  );
  await act(async () => root.unmount());
});

test('其他区保存返回受限来源时遮蔽旧引文并保留改选和其他草稿', async () => {
  const raw1 = '11111111-1111-4111-8111-111111111111';
  const raw2 = '22222222-2222-4222-8222-222222222222';
  const id = '33333333-3333-4333-8333-333333333333';
  const blueprint = {
    id,
    revision: 1,
    title: '测试构想',
    oneLiner: '',
    status: 'exploring',
    createdAt: '2026-11-29T00:00:00Z',
    updatedAt: '2026-11-29T00:00:00Z',
    context: { background: '', businessGoal: '', constraints: '' },
    links: { rawIds: [raw1, raw2], wikiIds: [], workItemIds: [] },
    personas: [],
    scenarios: [],
    pains: [
      {
        id: 'pain1',
        text: '原痛点一',
        kind: 'fact',
        severity: 'medium',
        evidence: { rawId: raw1, quote: '旧敏感引文' },
      },
      {
        id: 'pain2',
        text: '原痛点二',
        kind: 'fact',
        severity: 'medium',
        evidence: { rawId: raw1, quote: '旧敏感引文' },
      },
    ],
    alternatives: [],
    values: [],
    features: [],
    vision: { northStar: '', targetScope: '', outOfScope: '', metrics: [], risks: [] },
    milestones: [],
  };
  const before = {
    blueprint,
    checks: [],
    sources: {
      raw: [
        { id: raw1, title: '旧来源标题', available: true },
        { id: raw2, title: '合法来源', available: true },
      ],
      wiki: [],
      workItems: [],
    },
  };
  const after = {
    ...before,
    blueprint: {
      ...blueprint,
      revision: 2,
      context: { ...blueprint.context, background: '已保存背景' },
      pains: blueprint.pains.map((p) => ({ ...p, evidence: { rawId: raw1 }, evidenceRedacted: true })),
    },
    sources: {
      ...before.sources,
      raw: [
        { id: raw1, available: false },
        { id: raw2, title: '合法来源', available: true },
      ],
    },
  };
  window.history.replaceState({ appPage: 'blueprint' }, '', '?blueprint=' + id);
  globalThis.fetch = (async (url, init) => {
    if (init?.method === 'PUT') return Response.json({ ...after, idMap: {} });
    if (String(url).endsWith('/sources'))
      return Response.json({
        raw: [
          { id: raw1, title: '旧来源标题' },
          { id: raw2, title: '合法来源' },
        ],
        wiki: [],
        workItems: [],
      });
    if (String(url).endsWith(id)) return Response.json(before);
    return Response.json({ items: [], errors: [] });
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    assert.ok(button, text);
    await act(async () => {
      button.click();
    });
  };
  const setText = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype =
      input instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  await act(async () => {
    root.render(
      createElement(ProductBlueprintPage, { onOpenRaw: () => {}, onDirtyChange: () => {}, onBusyChange: () => {} }),
    );
  });
  await click('使用者');
  const cards = [...document.querySelectorAll('#pb-pain1, #pb-pain2')];
  await setText(cards[0].querySelector('textarea')!, '保留的未保存痛点');
  const secondSelect = cards[1].querySelectorAll('select')[4] as HTMLSelectElement;
  await act(async () => {
    secondSelect.value = raw2;
    secondSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await setText(cards[1].querySelectorAll('textarea')[1], '新合法引文');
  await click('背景');
  await setText(
    [...document.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('业务背景'))!
      .querySelector('textarea')!,
    '已保存背景',
  );
  await click('保存背景');
  assert.doesNotMatch(document.body.textContent!, /旧来源标题/);
  assert.match(document.body.textContent!, /不可用/);
  await click('使用者 •');
  assert.equal(document.querySelector<HTMLTextAreaElement>('#pb-pain1 textarea')?.value, '保留的未保存痛点');
  assert.doesNotMatch(document.querySelector('#pb-pain1')!.textContent!, /旧敏感引文|打开原文/);
  assert.match(document.querySelector('#pb-pain1')!.textContent!, /可能已删除或受限/);
  assert.equal((document.querySelectorAll('#pb-pain2 select')[4] as HTMLSelectElement).value, raw2);
  assert.equal(document.querySelectorAll<HTMLTextAreaElement>('#pb-pain2 textarea')[1].value, '新合法引文');
  assert.match(document.querySelector('#pb-pain2')!.textContent!, /打开原文/);
  await act(async () => root.unmount());
});
