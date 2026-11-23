import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageTitle, parseLocation, stripForeignQueryParams, type AppPage } from './routes';

export function subscribePopState(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

export type UseAppRouteResult = {
  page: AppPage;
  pageTitle: string;
  navigationGeneration: number;
  getNavigationGeneration: () => number;
  navigate: (destination: AppPage) => void;
};

export function useAppRoute(): UseAppRouteResult {
  const [page, setPage] = useState<AppPage>(() =>
    typeof window !== 'undefined' ? parseLocation(window.location, window.history.state) : 'home',
  );
  const [navigationGeneration, setNavigationGeneration] = useState(0);
  const navigationGenerationRef = useRef(0);

  const getNavigationGeneration = useCallback(() => navigationGenerationRef.current, []);

  const navigate = useCallback((destination: AppPage) => {
    navigationGenerationRef.current += 1;
    setNavigationGeneration(navigationGenerationRef.current);
    setPage(destination);
    if (typeof window === 'undefined') return;
    const { search, changed } = stripForeignQueryParams(destination, window.location.search);
    if (changed) {
      const currentState =
        window.history.state && typeof window.history.state === 'object'
          ? (window.history.state as Record<string, unknown>)
          : {};
      window.history.replaceState(
        { ...currentState, appPage: destination },
        '',
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    return subscribePopState(() => {
      const nextPage = parseLocation(window.location, window.history.state);
      navigationGenerationRef.current += 1;
      setNavigationGeneration(navigationGenerationRef.current);
      setPage(nextPage);
    });
  }, []);

  return {
    page,
    pageTitle: getPageTitle(page),
    navigationGeneration,
    getNavigationGeneration,
    navigate,
  };
}
