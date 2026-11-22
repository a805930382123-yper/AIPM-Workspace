import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  }),
  w = dom.window;
for (const [name, value] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  MouseEvent: w.MouseEvent,
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react'),
  { createRoot } = await import('react-dom/client'),
  { WikiInspectionPanel, inspectionSummary } = await import('../app/components/WikiInspectionPanel.tsx');
const tick = async (check: () => boolean) => {
  for (let i = 0; i < 70; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    if (check()) return;
  }
  assert.fail('UI did not settle');
};
const result = {
  id: 'inspection',
  revision: 1,
  includeRelated: false,
  status: 'partial',
  stage: 'completed',
  attempts: 1,
  scope: {
    selected: ['a', 'b'],
    candidates: ['a', 'b'],
    read: [{ id: 'a', title: 'A', revision: 1 }],
    skipped: [{ id: 'b', reason: '当前不可读取' }],
    gaps: ['没有旧快照，不能确认来源变化'],
  },
  findings: [
    {
      id: 'f1',
      fingerprint: 'fp',
      type: 'conflict',
      origin: 'model',
      wikiIds: ['a'],
      summary: '90与120待核',
      reason: '原句存在差异',
      differences: '区域未确定',
      nextStep: 'add_note',
      evidence: [],
      status: 'deferred',
      statusReason: '等负责人确认',
    },
  ],
  lint: [],
  audits: [],
  drafts: [],
};
test('LW03 restores deferred result with visible actual scope and explicit Lint boundary; multi selection sends only selected IDs', async () => {
  const native = globalThis.fetch;
  const calls: any[] = [];
  let root: ReturnType<typeof createRoot> | undefined;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(String(url).endsWith('/current') ? result : { ...result, id: 'new' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    root = createRoot(w.document.getElementById('root')!);
    await act(async () =>
      root!.render(
        createElement(WikiInspectionPanel, {
          items: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
          ] as any,
          currentWikiId: 'a',
          onOpenWiki: () => {},
          onOpenRaw: () => {},
          onOpenDraft: () => {},
        }),
      ),
    );
    await tick(() => w.document.body.textContent!.includes('等负责人确认'));
    assert(w.document.body.textContent!.includes('当前不可读取'));
    assert(w.document.body.textContent!.includes('没有旧快照'));
    assert.equal(w.document.querySelector('details')?.open, false);
    assert.equal(w.document.querySelectorAll('.inspection-dimensions dt').length, 4);
    assert(w.document.body.textContent!.includes('前往结构检查'));
    const boxes = [...w.document.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')];
    await act(async () => boxes[1].click());
    const start = [...w.document.querySelectorAll('button')].find((b) => b.textContent === '开始本次检查')!;
    await act(async () => start.click());
    await tick(() => calls.some((c) => c.body?.wikiIds));
    assert.deepEqual(calls.find((c) => c.body?.wikiIds).body.wikiIds, ['a', 'b']);
  } finally {
    if (root) await act(async () => root!.unmount());
    globalThis.fetch = native;
  }
});
test('KBI01 distinguishes observed findings, incomplete coverage and snapshot comparisons', () => {
  const single = {
    ...result,
    status: 'completed',
    scope: { ...result.scope, selected: ['a'], skipped: [] },
    findings: [],
  } as unknown as Parameters<typeof inspectionSummary>[0];
  const multi = {
    ...single,
    scope: { ...single.scope, read: [...single.scope.read, { id: 'b', title: 'B', revision: 1 }] },
  };
  assert.deepEqual(
    inspectionSummary(single).dimensions.map((item) => item.state),
    ['skipped', 'skipped', 'skipped', 'unavailable'],
  );
  assert.match(inspectionSummary(single).dimensions[3].reason, /旧记录/);
  assert.match(inspectionSummary({ ...multi, sourceComparisonCount: 0 }).dimensions[3].reason, /没有完成/);
  assert.equal(inspectionSummary({ ...multi, sourceComparisonCount: 1 }).tone, 'clean');
  const handled = inspectionSummary({
    ...single,
    findings: [{ ...result.findings[0], status: 'committed' } as (typeof single.findings)[number]],
  });
  assert.equal(handled.dimensions[1].state, 'issues_found');
  assert.match(handled.headline, /均已审核提交/);
});
test('KBI01 shortcut sends the original selection once with related knowledge enabled', async () => {
  const native = globalThis.fetch,
    requests: Array<{ wikiIds: string[]; includeRelated: boolean }> = [];
  const record = { ...result, scope: { ...result.scope, selected: ['a'] }, findings: [] };
  globalThis.fetch = async (_url, init) => {
    if (init?.body) requests.push(JSON.parse(String(init.body)));
    return Response.json(record);
  };
  const root = createRoot(w.document.getElementById('root')!);
  try {
    await act(async () =>
      root.render(
        createElement(WikiInspectionPanel, {
          items: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
          ] as any,
          currentWikiId: 'b',
          onOpenWiki: () => {},
          onOpenRaw: () => {},
          onOpenDraft: () => {},
        }),
      ),
    );
    const shortcut = [...w.document.querySelectorAll('button')].find(
      (button) => button.textContent.includes('重新检查') && button.textContent.includes('勾选'),
    )!;
    assert.equal(w.document.querySelector('.inspection-findings'), null);
    await act(async () => shortcut.click());
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].wikiIds, ['a']);
    assert.equal(requests[0].includeRelated, true);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});
test('LW03 ignores a restored result that arrives after panel unmount', async () => {
  const native = globalThis.fetch;
  let release!: (r: Response) => void;
  globalThis.fetch = async () => new Promise((r) => (release = r));
  const root = createRoot(w.document.getElementById('root')!);
  let opened = false;
  await act(async () =>
    root.render(
      createElement(WikiInspectionPanel, {
        items: [],
        currentWikiId: null,
        onOpenWiki: () => {
          opened = true;
        },
        onOpenRaw: () => {},
        onOpenDraft: () => {
          opened = true;
        },
      }),
    ),
  );
  await act(async () => root.unmount());
  await act(async () => release(new Response(JSON.stringify(result))));
  assert.equal(opened, false);
  assert.equal(w.document.getElementById('root')!.textContent, '');
  globalThis.fetch = native;
});
