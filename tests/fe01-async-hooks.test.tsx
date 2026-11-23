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
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

test.after(() => {
  dom.window.close();
});

const { StrictMode, act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useLatestAsync } = await import('../app/hooks/useLatestAsync.ts');
const { clearScopedQueryCache, invalidateScopedQueries, serializeScopeKey, useScopedQuery } =
  await import('../app/hooks/useScopedQuery.ts');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  clearScopedQueryCache();
});

test('useLatestAsync discards stale slow results, aborts superseded/unmounted signals, and ignores AbortError', async () => {
  let api!: ReturnType<typeof useLatestAsync<string>>;
  function Harness() {
    api = useLatestAsync<string>({ initialData: 'init' });
    return createElement('div', null, `${api.loading}:${api.data ?? ''}:${api.error}`);
  }

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Harness)));
      await tick();
    });
    assert.equal(api.data, 'init');
    assert.equal(api.loading, false);

    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const currentChecks: Array<() => boolean> = [];

    let firstPromise!: Promise<string | undefined>;
    let secondPromise!: Promise<string | undefined>;
    await act(async () => {
      firstPromise = api.run(async ({ signal, isCurrent }) => {
        signals.push(signal);
        currentChecks.push(isCurrent);
        return first.promise;
      });
      secondPromise = api.run(async ({ signal, isCurrent }) => {
        signals.push(signal);
        currentChecks.push(isCurrent);
        return second.promise;
      });
    });

    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    assert.equal(currentChecks[0](), false);
    assert.equal(currentChecks[1](), true);
    assert.equal(api.loading, true);

    await act(async () => {
      second.resolve('fresh');
      await secondPromise;
    });
    assert.equal(api.data, 'fresh');
    assert.equal(api.loading, false);
    assert.equal(api.error, '');

    await act(async () => {
      first.resolve('stale');
      await firstPromise;
    });
    assert.equal(api.data, 'fresh');
    assert.equal(api.loading, false);

    // AbortError must not set error
    await act(async () => {
      await api.run(async () => {
        throw new DOMException('Aborted', 'AbortError');
      });
    });
    assert.equal(api.error, '');
    assert.equal(api.loading, false);

    // cancel() aborts active signal and stops loading
    const third = deferred<string>();
    let thirdSignal!: AbortSignal;
    let thirdPromise!: Promise<string | undefined>;
    await act(async () => {
      thirdPromise = api.run(async ({ signal }) => {
        thirdSignal = signal;
        return third.promise;
      });
    });
    assert.equal(api.loading, true);
    await act(async () => {
      api.cancel();
    });
    assert.equal(thirdSignal.aborted, true);
    assert.equal(api.loading, false);
    await act(async () => {
      third.reject(new Error('late error after cancel'));
      await thirdPromise;
    });
    assert.equal(api.error, '');

    // reset() restores initialData
    await act(async () => {
      api.setError('boom');
    });
    assert.equal(api.error, 'boom');
    await act(async () => {
      api.reset();
    });
    assert.equal(api.data, 'init');
    assert.equal(api.error, '');
    assert.equal(api.loading, false);

    // unmount aborts active signal
    const fourth = deferred<string>();
    let fourthSignal!: AbortSignal;
    await act(async () => {
      void api.run(async ({ signal }) => {
        fourthSignal = signal;
        return fourth.promise;
      });
    });
    assert.equal(fourthSignal.aborted, false);
    await act(async () => {
      root.unmount();
    });
    assert.equal(fourthSignal.aborted, true);
    fourth.resolve('after-unmount');
    await tick();
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('serializeScopeKey and useScopedQuery isolate A->B->A races, honor enabled:false, and support opt-in cache', async () => {
  assert.notEqual(serializeScopeKey(['a/b', 'c']), serializeScopeKey(['a', 'b/c']));
  assert.notEqual(serializeScopeKey(['wiki', 1]), serializeScopeKey(['wiki', '1']));
  assert.equal(serializeScopeKey(['wiki']), serializeScopeKey('wiki'));

  // 1. A -> B -> A race condition with cache: false (default)
  const pendingByCall: Array<{ id: string; signal: AbortSignal; gate: ReturnType<typeof deferred<string>> }> = [];
  let queryResult!: ReturnType<typeof useScopedQuery<string>>;

  function RaceHarness({ id, enabled = true }: { id: string; enabled?: boolean }) {
    queryResult = useScopedQuery<string>(
      ['item', id],
      async ({ signal }) => {
        const gate = deferred<string>();
        pendingByCall.push({ id, signal, gate });
        return gate.promise;
      },
      { enabled },
    );
    return createElement('div', null, `${queryResult.loading}:${queryResult.data ?? ''}:${queryResult.error}`);
  }

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(RaceHarness, { id: 'A' }));
      await tick();
    });
    assert.equal(pendingByCall.length, 1);
    assert.equal(queryResult.loading, true);

    await act(async () => {
      root.render(createElement(RaceHarness, { id: 'B' }));
      await tick();
    });
    assert.equal(pendingByCall[0].signal.aborted, true);
    assert.equal(pendingByCall.length, 2);

    await act(async () => {
      root.render(createElement(RaceHarness, { id: 'A' }));
      await tick();
    });
    assert.equal(pendingByCall[1].signal.aborted, true);
    assert.equal(pendingByCall.length, 3);
    assert.equal(pendingByCall[2].signal.aborted, false);

    // Resolve fresh A2 first, then resolve stale A1 (which ignored signal) -> A2 must win
    await act(async () => {
      pendingByCall[2].gate.resolve('fresh-A2');
      await tick();
    });
    assert.equal(queryResult.data, 'fresh-A2');
    assert.equal(queryResult.loading, false);

    await act(async () => {
      pendingByCall[0].gate.resolve('stale-A1');
      await tick();
    });
    assert.equal(queryResult.data, 'fresh-A2');

    // enabled: false suppresses fetch, enabled: true fetches
    const callsBeforeDisabled = pendingByCall.length;
    await act(async () => {
      root.render(createElement(RaceHarness, { id: 'C', enabled: false }));
      await tick();
    });
    assert.equal(pendingByCall.length, callsBeforeDisabled);
    assert.equal(queryResult.loading, false);
    assert.equal(queryResult.data, undefined);

    await act(async () => {
      root.render(createElement(RaceHarness, { id: 'C', enabled: true }));
      await tick();
    });
    assert.equal(pendingByCall.length, callsBeforeDisabled + 1);
    await act(async () => {
      pendingByCall[pendingByCall.length - 1].gate.resolve('data-C');
      await tick();
    });
    assert.equal(queryResult.data, 'data-C');
  } finally {
    await act(async () => {
      root.unmount();
    });
  }

  // 2. cache: false default does NOT share across mounts; cache: true + invalidateScopedQueries + reload()
  let uncachedCount = 0;
  function UncachedHarness() {
    const res = useScopedQuery<number>(['uncached', '1'], async () => ++uncachedCount);
    return createElement('span', null, String(res.data ?? 0));
  }
  const r1 = createRoot(container);
  await act(async () => {
    r1.render(createElement(UncachedHarness));
    await tick();
  });
  await act(async () => {
    r1.unmount();
  });
  const r2 = createRoot(container);
  await act(async () => {
    r2.render(createElement(UncachedHarness));
    await tick();
  });
  await act(async () => {
    r2.unmount();
  });
  assert.equal(uncachedCount, 2);

  let wikiCalls = 0;
  let otherCalls = 0;
  let wikiQuery!: ReturnType<typeof useScopedQuery<string>>;
  let otherQuery!: ReturnType<typeof useScopedQuery<string>>;
  function CachedHarness({ id }: { id: string }) {
    wikiQuery = useScopedQuery<string>(['wiki', id], async () => `wiki-${id}-v${++wikiCalls}`, { cache: true });
    otherQuery = useScopedQuery<string>(['wiki-other', id], async () => `other-${id}-v${++otherCalls}`, {
      cache: true,
    });
    return createElement('div', null, `${wikiQuery.data ?? ''}|${otherQuery.data ?? ''}`);
  }
  const r3 = createRoot(container);
  try {
    await act(async () => {
      r3.render(createElement(StrictMode, null, createElement(CachedHarness, { id: '1' })));
      await tick();
    });
    const wikiCallsAfter1 = wikiCalls;
    const otherCallsAfter1 = otherCalls;
    assert.ok(wikiQuery.data?.startsWith('wiki-1-'));

    await act(async () => {
      r3.render(createElement(StrictMode, null, createElement(CachedHarness, { id: '2' })));
      await tick();
    });
    const wikiCallsAfter2 = wikiCalls;
    assert.ok(wikiCallsAfter2 > wikiCallsAfter1);

    // Switching back to '1' hits cache without additional fetch
    await act(async () => {
      r3.render(createElement(StrictMode, null, createElement(CachedHarness, { id: '1' })));
      await tick();
    });
    assert.equal(wikiCalls, wikiCallsAfter2);

    // Prefix invalidation ['wiki'] invalidates ['wiki', '1'] without touching ['wiki-other', '1']
    const otherBeforeInvalidation = otherCalls;
    await act(async () => {
      invalidateScopedQueries(['wiki']);
      await tick();
    });
    assert.ok(wikiCalls > wikiCallsAfter2);
    assert.equal(otherCalls, otherBeforeInvalidation);
    assert.ok(otherCallsAfter1 >= 1);

    // String prefix 'wiki' also invalidates ['wiki', '1'] without touching ['wiki-other', '1']
    const wikiBeforeStringInvalidation = wikiCalls;
    await act(async () => {
      invalidateScopedQueries('wiki');
      await tick();
    });
    assert.ok(wikiCalls > wikiBeforeStringInvalidation);
    assert.equal(otherCalls, otherBeforeInvalidation);

    // reload() bypasses cache and refetches
    const wikiBeforeReload = wikiCalls;
    await act(async () => {
      wikiQuery.reload();
      await tick();
    });
    assert.ok(wikiCalls > wikiBeforeReload);
  } finally {
    await act(async () => {
      r3.unmount();
    });
  }
});
