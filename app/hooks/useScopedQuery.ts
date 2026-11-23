import { useCallback, useEffect, useRef, useState } from 'react';

export type ScopeKeyPart = string | number | boolean | null | undefined;
export type ScopeKey = string | readonly ScopeKeyPart[];

export type UseScopedQueryOptions<T> = {
  enabled?: boolean;
  cache?: boolean;
  initialData?: T;
  formatError?: (error: unknown) => string;
};

export type UseScopedQueryResult<T> = {
  data: T | undefined;
  loading: boolean;
  error: string;
  reload: () => void;
};

type QuerySnapshot<T> =
  | { key: string; token: number; status: 'success'; data: T }
  | { key: string; token: number; status: 'error'; error: string }
  | { key: string; token: number; status: 'cancelled' };

type CacheEntry = {
  data: unknown;
};

const scopedQueryCache = new Map<string, CacheEntry>();
const cacheListeners = new Set<(prefix?: ScopeKey) => void>();

function encodePart(part: ScopeKeyPart): string {
  if (part === undefined) return 'u';
  if (part === null) return 'z';
  if (typeof part === 'boolean') return part ? 'b:1' : 'b:0';
  if (typeof part === 'number') return `n:${Object.is(part, -0) ? '-0' : String(part)}`;
  return `s:${encodeURIComponent(part)}`;
}

function toParts(scopeKey: ScopeKey): readonly ScopeKeyPart[] {
  return typeof scopeKey === 'string' ? [scopeKey] : scopeKey;
}

export function serializeScopeKey(scopeKey: ScopeKey): string {
  return toParts(scopeKey).map(encodePart).join('/');
}

function matchesPrefix(serializedKey: string, prefix?: ScopeKey): boolean {
  if (prefix === undefined) return true;
  if (Array.isArray(prefix) && prefix.length === 0) return true;
  if (typeof prefix === 'string' && (serializedKey === prefix || serializedKey.startsWith(`${prefix}/`))) {
    return true;
  }
  const serializedPrefix = serializeScopeKey(prefix);
  return serializedKey === serializedPrefix || serializedKey.startsWith(`${serializedPrefix}/`);
}

export function invalidateScopedQueries(prefix?: ScopeKey): void {
  if (prefix === undefined) {
    scopedQueryCache.clear();
  } else {
    for (const key of [...scopedQueryCache.keys()]) {
      if (matchesPrefix(key, prefix)) scopedQueryCache.delete(key);
    }
  }
  for (const listener of [...cacheListeners]) {
    listener(prefix);
  }
}

export function clearScopedQueryCache(): void {
  scopedQueryCache.clear();
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

export function useScopedQuery<T>(
  scopeKey: ScopeKey,
  fetcher: (context: { signal: AbortSignal }) => Promise<T>,
  options?: UseScopedQueryOptions<T>,
): UseScopedQueryResult<T> {
  const enabled = options?.enabled ?? true;
  const cacheEnabled = options?.cache ?? false;
  const serializedKey = serializeScopeKey(scopeKey);

  const [reloadToken, setReloadToken] = useState(0);
  const [cacheRevision, setCacheRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<QuerySnapshot<T> | null>(null);

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  const formatErrorRef = useRef(options?.formatError);

  useEffect(() => {
    fetcherRef.current = fetcher;
    formatErrorRef.current = options?.formatError;
  }, [fetcher, options?.formatError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!cacheEnabled) return;
    const listener = (prefix?: ScopeKey) => {
      if (matchesPrefix(serializedKey, prefix)) {
        setCacheRevision((current) => current + 1);
      }
    };
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  }, [cacheEnabled, serializedKey]);

  const activeToken = reloadToken + cacheRevision;
  const hasCached = cacheEnabled && scopedQueryCache.has(serializedKey);

  useEffect(() => {
    if (!enabled) return;
    if (cacheEnabled && scopedQueryCache.has(serializedKey)) return;

    let active = true;
    const controller = new AbortController();

    fetcherRef
      .current({ signal: controller.signal })
      .then((result) => {
        if (!active || !mountedRef.current || controller.signal.aborted) return;
        if (cacheEnabled) {
          scopedQueryCache.set(serializedKey, { data: result });
        }
        setSnapshot({ key: serializedKey, token: activeToken, status: 'success', data: result });
      })
      .catch((caught) => {
        if (!active || !mountedRef.current) return;
        if (controller.signal.aborted || isAbortError(caught)) {
          if (!controller.signal.aborted) {
            setSnapshot({ key: serializedKey, token: activeToken, status: 'cancelled' });
          }
          return;
        }
        const formatter = formatErrorRef.current;
        const message = formatter ? formatter(caught) : caught instanceof Error ? caught.message : '加载失败，请重试。';
        setSnapshot({ key: serializedKey, token: activeToken, status: 'error', error: message });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, serializedKey, cacheEnabled, activeToken, hasCached]);

  const reload = useCallback(() => {
    if (cacheEnabled) {
      scopedQueryCache.delete(serializedKey);
    }
    setReloadToken((current) => current + 1);
  }, [cacheEnabled, serializedKey]);

  if (cacheEnabled && hasCached) {
    const cached = scopedQueryCache.get(serializedKey) as CacheEntry;
    return {
      data: cached.data as T,
      loading: false,
      error: '',
      reload,
    };
  }

  const isCurrentSnapshot = snapshot !== null && snapshot.key === serializedKey && snapshot.token === activeToken;
  const hasPreviousSuccess = snapshot !== null && snapshot.key === serializedKey && snapshot.status === 'success';
  const resolvedData =
    isCurrentSnapshot && snapshot.status === 'success'
      ? snapshot.data
      : hasPreviousSuccess
        ? snapshot.data
        : options?.initialData;

  if (!enabled) {
    return {
      data: resolvedData,
      loading: false,
      error: '',
      reload,
    };
  }

  return {
    data: resolvedData,
    loading: !isCurrentSnapshot,
    error: isCurrentSnapshot && snapshot.status === 'error' ? snapshot.error : '',
    reload,
  };
}
