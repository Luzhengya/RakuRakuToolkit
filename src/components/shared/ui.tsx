// 画面共通の UI 部品（案件管理・品質管理で使用）。カード・表ヘッダー・パンくず・エラー表示の見た目をここで揃える
import type { KeyboardEvent, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/** 表ヘッダー行（灰色背景・12px） */
export const TABLE_HEAD_ROW = 'bg-neutral-50 border-b border-neutral-200 text-xs font-medium text-neutral-500';
/** カード（白背景・枠線・角丸） */
export const CARD = 'bg-white border border-neutral-200 rounded-xl shadow-sm';

export function Breadcrumb({ items, className = 'mb-4' }: { items: { label: string; onClick?: () => void }[]; className?: string }) {
  return (
    <nav aria-label="パンくず" className={`flex items-center gap-2 text-sm ${className}`}>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-neutral-400" aria-hidden="true">{'>>'}</span>}
          {item.onClick ? (
            <button type="button" onClick={item.onClick} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
              {item.label}
            </button>
          ) : (
            <span className="text-neutral-900 font-medium" aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** カードの見出し行。title は 14px 太字、sub は補足（件数など）、actions は右寄せのボタン類 */
export function CardHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-neutral-800 truncate">{title}</h3>
        {sub && <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorAlert({ message }: { message: ReactNode }) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm flex items-center gap-2">
      <AlertCircle size={16} className="shrink-0" />
      {message}
    </div>
  );
}

/** 開閉できる行・クリックできる行のキーボードフォーカス表示 */
export const ROW_FOCUS = 'focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2';

/** クリックできる行（tr 等）をキーボード（Enter / Space）でも操作できるようにする。行内のボタンからのキー入力は無視 */
export function clickableRowProps(onActivate: () => void) {
  return {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    },
  };
}

/** クリックで開閉する行。clickableRowProps に開閉状態 (aria-expanded) を加えたもの */
export function expandableRowProps(expanded: boolean, onToggle: () => void) {
  return { ...clickableRowProps(onToggle), 'aria-expanded': expanded };
}
