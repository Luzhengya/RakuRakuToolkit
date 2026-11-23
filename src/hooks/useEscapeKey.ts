import { useEffect } from 'react';

// Esc キーでダイアログを閉じる。編集中・保存中など閉じてはいけない間は enabled=false にする
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}
