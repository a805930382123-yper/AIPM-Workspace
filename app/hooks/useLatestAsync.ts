import { useCallback, useEffect, useRef, useState } from 'react';

export type LatestAsyncContext = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export type UseLatestAsyncOptions<T> = {
  initialData?: T | null;
  formatError?: (error: unknown) => string;
};

export type UseLatestAsyncResult<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  setError: (error: string) => void;
  run: <R extends T = T>(task: (context: LatestAsyncContext) => Promise<R>) => Promise<R | undefined>;
  cancel: () => void;
  reset: () => void;
};

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

export function useLatestAsync<T = unknown>(options?: UseLatestAsyncOptions<T>): UseLatestAsyncResult<T> {
  const initialData = options?.initialData ?? null;
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const initialDataRef = useRef<T | null>(initialData);
  const formatErrorRef = useRef(options?.formatError);

  useEffect(() => {
    initialDataRef.current = options?.initialData ?? null;
    formatErrorRef.current = options?.formatError;
  }, [options?.initialData, options?.formatError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (mountedRef.current) setLoading(false);
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (!mountedRef.current) return;
    setData(initialDataRef.current);
    setLoading(false);
    setError('');
  }, []);

  const run = useCallback(async <R extends T = T>(task: (context: LatestAsyncContext) => Promise<R>) => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const isCurrent = () => mountedRef.current && requestIdRef.current === requestId && !controller.signal.aborted;

    if (mountedRef.current) {
      setLoading(true);
      setError('');
    }

    try {
      const result = await task({ signal: controller.signal, isCurrent });
      if (!isCurrent()) return undefined;
      setData(result);
      setLoading(false);
      return result;
    } catch (caught) {
      if (isAbortError(caught)) {
        if (mountedRef.current && requestIdRef.current === requestId) {
          setLoading(false);
        }
        return undefined;
      }
      if (!mountedRef.current || requestIdRef.current !== requestId || controller.signal.aborted) {
        return undefined;
      }
      const formatter = formatErrorRef.current;
      setError(formatter ? formatter(caught) : caught instanceof Error ? caught.message : '操作失败，请重试。');
      setLoading(false);
      return undefined;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  return { data, loading, error, setError, run, cancel, reset };
}
