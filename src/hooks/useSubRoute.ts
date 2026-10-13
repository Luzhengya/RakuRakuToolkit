import { useCallback, useSyncExternalStore } from 'react';

function getSubSegments(): string[] {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return parts.slice(1);
}

export function useSubRoute(): [string[], (segments: string[]) => void] {
  const sub = useSyncExternalStore(
    (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); },
    getSubSegments,
  );
  const navigate = useCallback((segments: string[]) => {
    const raw = location.hash.replace(/^#\/?/, '');
    const root = raw.split('/').filter(Boolean)[0] || '';
    location.hash = '/' + [root, ...segments].filter(Boolean).join('/');
  }, []);
  return [sub, navigate];
}
