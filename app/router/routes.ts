export type AppPage =
  'news' | 'home' | 'wiki' | 'raw' | 'prompt' | 'settings' | 'meeting' | 'work' | 'automation' | 'blueprint';

export type AppRouteDefinition = {
  page: AppPage;
  title: string;
  ownedQueryKeys: readonly string[];
};

export const MEETING_QUERY_KEYS = ['meeting', 'mq', 'mt', 'mg', 'mc', 'mp', 'ml', 'mo'] as const;

export const APP_ROUTES: Record<AppPage, AppRouteDefinition> = {
  news: { page: 'news', title: '每日资讯', ownedQueryKeys: [] },
  home: { page: 'home', title: '首页', ownedQueryKeys: [] },
  wiki: { page: 'wiki', title: '知识库', ownedQueryKeys: [] },
  raw: { page: 'raw', title: 'Raw 原始资料', ownedQueryKeys: [] },
  prompt: { page: 'prompt', title: 'Prompt 工作台', ownedQueryKeys: [] },
  settings: { page: 'settings', title: '设置', ownedQueryKeys: [] },
  meeting: { page: 'meeting', title: '会议档案', ownedQueryKeys: MEETING_QUERY_KEYS },
  work: { page: 'work', title: '工作事项', ownedQueryKeys: [] },
  blueprint: { page: 'blueprint', title: '产品构想', ownedQueryKeys: ['blueprint'] },
  automation: { page: 'automation', title: '自动化', ownedQueryKeys: [] },
};

export function isAppPage(value: unknown): value is AppPage {
  return typeof value === 'string' && Object.hasOwn(APP_ROUTES, value);
}

export function getPageTitle(page: AppPage): string {
  return APP_ROUTES[page].title;
}

export function getForeignQueryKeys(targetPage: AppPage): string[] {
  const owned = new Set(APP_ROUTES[targetPage].ownedQueryKeys);
  const foreign = new Set<string>();
  for (const route of Object.values(APP_ROUTES)) {
    if (route.page === targetPage) continue;
    for (const key of route.ownedQueryKeys) {
      if (!owned.has(key)) foreign.add(key);
    }
  }
  return [...foreign];
}

export function stripForeignQueryParams(targetPage: AppPage, search: string): { search: string; changed: boolean } {
  if (!search) return { search: '', changed: false };
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of getForeignQueryKeys(targetPage)) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (!changed) return { search, changed: false };
  const encoded = params.toString();
  return { search: encoded ? `?${encoded}` : '', changed: true };
}

export function buildUrlWithParams(pathname: string, params: URLSearchParams, hash = ''): string {
  const query = params.toString();
  const normalizedHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  if (query) {
    return `${pathname}?${query}${normalizedHash}`;
  } else {
    return `${pathname}${normalizedHash}`;
  }
}

export function parseLocation(
  _locationLike?: { pathname?: string; search?: string } | null,
  historyState?: unknown,
): AppPage {
  if (historyState && typeof historyState === 'object') {
    const candidate = (historyState as { appPage?: unknown }).appPage;
    if (isAppPage(candidate)) return candidate;
  }
  return 'home';
}

export function readLocationSearch(): string {
  return typeof window !== 'undefined' ? window.location.search : '';
}

export function readQueryParams(): URLSearchParams {
  return new URLSearchParams(readLocationSearch());
}

export function updateRouteQuery(mutate: (params: URLSearchParams) => void, options: { push?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const nextUrl = buildUrlWithParams(window.location.pathname, params, window.location.hash);
  const nextState = window.history.state ?? {};
  if (options.push) {
    window.history.pushState(nextState, '', nextUrl);
  } else {
    window.history.replaceState(nextState, '', nextUrl);
  }
}
