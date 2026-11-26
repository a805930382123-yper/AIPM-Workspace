import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { RawDraftView } from '../app/api';
import { editedTemplateFields, reviewFingerprint } from '../app/pages/draft-review/draftReviewModel';
import type { TemplateFields } from '../services/wiki/template-fields';

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
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DraftReviewPage } = await import('../app/pages/DraftReviewPage');

function draft(id: string): RawDraftView {
  return {
    id,
    rawId: `raw-${id}`,
    rawTitle: id,
    status: 'pending_confirmation',
    revision: 1,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
    rulesVersion: 'synthetic',
    provider: { name: 'fake', model: 'fake' },
    jobId: `job-${id}`,
    document: { title: id, main_topic: id, summary: id },
    pages: [
      {
        pageId: 'shared-page-id',
        title: `page-${id}`,
        type: 'concept',
        category: 'other',
        one_line_definition: id,
        source_facts: [],
        ai_organized: [],
        ai_inferences: [],
        related_pages: [],
        open_questions: [],
        source_evidence: [],
        knowledge_status: 'ai_organized',
        confidence: 'medium',
        source_level: 'C',
        selected: false,
        provenance: [],
      },
    ],
    source: {
      title: id,
      category: 'other',
      summary: id,
      key_takeaways: [],
      body: id,
      knowledge_status: 'source_supported',
      confidence: 'medium',
      source_level: 'C',
    },
    warnings: [],
    extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    preview: null,
    raw: null,
  };
}

test('FE03 extracted field edits preserve evidence and fingerprint ignores saved rendering only', () => {
  const fields: TemplateFields = { definition: { evidenceIds: ['e1'], humanText: 'original' } };
  const edited = editedTemplateFields(fields, 'definition', { humanText: 'edited' });
  assert.equal(fields.definition?.humanText, 'original');
  assert.deepEqual(edited.definition, { evidenceIds: ['e1'], humanText: 'edited' });
  assert.deepEqual(editedTemplateFields(edited, 'definition', { evidenceIds: [], humanText: ' ' }), {});
  const view = draft('first');
  const saved = reviewFingerprint(view);
  assert.equal(reviewFingerprint(view, [{ ...view.pages[0], renderedBody: 'saved markdown' }]), saved);
  assert.notEqual(reviewFingerprint(view, [{ ...view.pages[0], selected: true }]), saved);
});

test('FE03 keyed page switch clears edits and merge state, and ignores old Raw and duplicate responses', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(w.document.getElementById('root')!);
  let resolveOldRaw!: (value: Response) => void;
  let resolveOldDuplicates!: (value: Response) => void;
  let oldDuplicateRequests = 0;
  let formalRequests = 0;
  const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
  globalThis.fetch = async (url, init) => {
    const request = String(url);
    if (init?.method && init.method !== 'GET') {
      formalRequests++;
      assert.fail(`Unexpected write: ${request}`);
    }
    if (request === '/api/wiki/schema')
      return reply({ types: [], categories: [], enums: {}, sourcePolicy: { levels: [] } });
    if (request === '/api/drafts/first') return reply(draft('first'));
    if (request === '/api/drafts/second') return reply(draft('second'));
    if (request === '/api/raw/raw-first') return new Promise<Response>((resolve) => (resolveOldRaw = resolve));
    if (request === '/api/raw/raw-second') return reply({ body: 'second raw body' });
    if (request.includes('/first/') && request.includes('/duplicates')) {
      oldDuplicateRequests++;
      return new Promise<Response>((resolve) => (resolveOldDuplicates = resolve));
    }
    if (request.includes('/second/') && request.includes('/duplicates')) return reply({ candidates: [] });
    assert.fail(`Unexpected request: ${request}`);
  };
  const render = async (draftId: string) => {
    await act(async () => {
      root.render(
        createElement(DraftReviewPage, {
          draftId,
          onBack: () => {},
          onOpenRaw: () => {},
          onCommitted: async () => assert.fail('No formal commit during page switching'),
        }),
      );
    });
  };
  const waitFor = async (check: () => boolean) => {
    const deadline = performance.now() + 3000;
    while (!check() && performance.now() < deadline)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    assert(check(), w.document.body.textContent ?? 'Missing page');
  };
  try {
    await render('first');
    await waitFor(() => oldDuplicateRequests > 0 && !!resolveOldRaw);
    const title = w.document.querySelector<HTMLInputElement>('.draft-title')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(title, 'unsaved first');
      title.dispatchEvent(new w.Event('input', { bubbles: true }));
      const merge = [...w.document.querySelectorAll('label')].find((label) => label.textContent?.trim() === '合并')!;
      merge.querySelector('input')!.click();
    });
    assert(w.document.body.textContent?.includes('有未保存修改'));
    assert(w.document.body.textContent?.includes('合并所选（1）'));
    await render('second');
    await waitFor(() => w.document.querySelector('.draft-raw-preview')?.textContent === 'second raw body');
    await act(async () => {
      resolveOldRaw(reply({ body: 'old raw response must not appear' }));
      resolveOldDuplicates(
        reply({
          candidates: [
            {
              wiki: { id: 'old-wiki', title: 'old duplicate must not appear', sources: [] },
              score: 0.9,
              matches: [],
            },
          ],
        }),
      );
    });
    assert.equal(w.document.querySelector<HTMLInputElement>('.draft-title')?.value, 'page-second');
    assert.equal(w.document.querySelector('.draft-raw-preview')?.textContent, 'second raw body');
    assert(w.document.body.textContent?.includes('合并所选（0）'));
    assert(!w.document.body.textContent?.includes('有未保存修改'));
    assert(!w.document.body.textContent?.includes('old duplicate must not appear'));
    assert.equal(formalRequests, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
    dom.window.close();
  }
});
