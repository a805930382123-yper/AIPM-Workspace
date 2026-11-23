import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  PopStateEvent: window.PopStateEvent,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

test.after(() => {
  dom.window.close();
});

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const routes = await import('../app/router/routes.ts');
const { useAppRoute } = await import('../app/router/useAppRoute.ts');

test('routes pure helpers handle query stripping, hash building, and parseLocation defaults', () => {
  assert.equal(routes.isAppPage('meeting'), true);
  assert.equal(routes.isAppPage('home'), true);
  assert.equal(routes.isAppPage('unknown'), false);
  assert.equal(routes.isAppPage(null), false);

  assert.equal(routes.getPageTitle('home'), '首页');
  assert.equal(routes.getPageTitle('meeting'), '会议档案');
  assert.equal(routes.getPageTitle('wiki'), '知识库');

  assert.deepEqual(routes.getForeignQueryKeys('meeting'), []);
  assert.deepEqual(routes.getForeignQueryKeys('wiki'), [...routes.MEETING_QUERY_KEYS]);

  const meetingSearch = '?meeting=m1&mq=q&mt=t&mg=g&mc=c&mp=p&ml=Sensitive&mo=asc&keep=yes';
  assert.deepEqual(routes.stripForeignQueryParams('meeting', meetingSearch), {
    search: meetingSearch,
    changed: false,
  });
  assert.deepEqual(routes.stripForeignQueryParams('wiki', meetingSearch), {
    search: '?keep=yes',
    changed: true,
  });
  assert.deepEqual(routes.stripForeignQueryParams('home', '?meeting=m2&mq=only'), {
    search: '',
    changed: true,
  });
  assert.deepEqual(routes.stripForeignQueryParams('raw', '?keep=yes'), {
    search: '?keep=yes',
    changed: false,
  });

  const params = new URLSearchParams('keep=yes');
  assert.equal(routes.buildUrlWithParams('/', params, '#sec'), '/?keep=yes#sec');
  assert.equal(routes.buildUrlWithParams('/', new URLSearchParams(), '#sec'), '/#sec');
  assert.equal(routes.buildUrlWithParams('/app', params), '/app?keep=yes');

  assert.equal(routes.parseLocation({ pathname: '/', search: '?meeting=m1&mq=abc' }, {}), 'home');
  assert.equal(routes.parseLocation({ pathname: '/', search: '' }, { appPage: 'meeting' }), 'meeting');
  assert.equal(routes.parseLocation({ pathname: '/', search: '' }, { appPage: 'invalid' }), 'home');

  window.history.replaceState({ appPage: 'meeting', custom: 7 }, '', '/?meeting=m1&keep=yes#sec');
  assert.equal(routes.readLocationSearch(), '?meeting=m1&keep=yes');
  assert.equal(routes.readQueryParams().get('meeting'), 'm1');
  routes.updateRouteQuery(
    (p) => {
      p.set('mq', 'abc');
    },
    { push: true },
  );
  assert.equal(window.location.search, '?meeting=m1&keep=yes&mq=abc');
  assert.equal(window.location.hash, '#sec');
  assert.deepEqual(window.history.state, { appPage: 'meeting', custom: 7 });
  window.history.replaceState({}, '', '/');
});

test('useAppRoute strips meeting query params on exit, preserves hash/other params, avoids ?page=, and syncs popstate', async () => {
  window.history.replaceState({}, '', '/?meeting=m1&mq=q&mt=t&mg=g&mc=c&mp=p&ml=Public&mo=asc&keep=yes#sec');

  let current!: ReturnType<typeof useAppRoute>;
  function Harness() {
    current = useAppRoute();
    return createElement(
      'div',
      { 'data-page': current.page, 'data-gen': String(current.navigationGeneration) },
      current.pageTitle,
    );
  }

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(Harness));
    });
    assert.equal(current.page, 'home');
    assert.equal(current.navigationGeneration, 0);
    assert.equal(current.getNavigationGeneration(), 0);
    assert.ok(window.location.search.includes('meeting=m1'));

    await act(async () => {
      current.navigate('meeting');
    });
    assert.equal(current.page, 'meeting');
    assert.equal(current.pageTitle, '会议档案');
    assert.equal(current.navigationGeneration, 1);
    assert.equal(current.getNavigationGeneration(), 1);
    assert.ok(window.location.search.includes('meeting=m1'));
    assert.equal(window.location.hash, '#sec');
    assert.equal(window.location.search.includes('page='), false);

    await act(async () => {
      current.navigate('wiki');
    });
    assert.equal(current.page, 'wiki');
    assert.equal(current.pageTitle, '知识库');
    assert.equal(current.navigationGeneration, 2);
    assert.equal(current.getNavigationGeneration(), 2);
    const readSearch = () => window.location.search;
    assert.equal(readSearch(), '?keep=yes');
    assert.equal(window.location.hash, '#sec');
    assert.equal(readSearch().includes('page='), false);
    assert.equal((window.history.state as { appPage?: string }).appPage, 'wiki');

    window.history.replaceState({ appPage: 'raw' }, '', '/?keep=yes#sec');
    await act(async () => {
      window.dispatchEvent(new window.PopStateEvent('popstate', { state: { appPage: 'raw' } }));
    });
    assert.equal(current.page, 'raw');
    assert.equal(current.navigationGeneration, 3);
    assert.equal(current.getNavigationGeneration(), 3);

    window.history.replaceState({}, '', '/?meeting=m2&mq=only');
    await act(async () => {
      current.navigate('home');
    });
    assert.equal(current.page, 'home');
    assert.equal(readSearch(), '');
    assert.equal(readSearch().includes('page='), false);
  } finally {
    await act(async () => {
      root.unmount();
    });
    window.history.replaceState({}, '', '/');
  }
});
