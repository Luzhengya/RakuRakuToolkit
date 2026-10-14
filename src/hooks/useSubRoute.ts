import { useCallback, useSyncExternalStore } from 'react';

let cached: string[] = [];
let cachedKey = '';

function getSubSegments(): string[] {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const sub = parts.slice(1);
  const key = sub.join('/');
  if (key !== cachedKey) {
    cachedKey = key;
    cached = sub;
  }
  return cached;
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
