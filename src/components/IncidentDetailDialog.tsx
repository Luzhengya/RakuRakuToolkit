import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// インシデント1件の全項目を見せるダイアログ。
// 一覧は列を絞ってあるので、隠した項目はここで確認する。
// 配置はテストケースの詳細ダイアログに合わせる:
// 読む必要のある長文を左に大きく、付随情報は右に一覧で。
export type IncidentRow = {
  system: string;
  responsible: boolean;
  caseMonth: string;
  cmdb: string;
  feature: string;
  defect: string;
  process: string;
  category: string;
  cause: string;
  releaseTime: string;
  tcResult: string;
  status: string;
  improvable: string;
  checklist: string;
};

// 右に並べる付随情報。サービスと機能(画面)名は見出しに出すので入れない
const SECONDARY: { label: string; get: (r: IncidentRow) => string }[] = [
  { label: '案件別', get: (r) => r.caseMonth },
  { label: 'CMDB番号', get: (r) => r.cmdb },
  { label: '原因区分', get: (r) => r.cause },
  { label: 'リリース時期', get: (r) => r.releaseTime },
  { label: '状態', get: (r) => r.status },
  { label: '改善可/不可', get: (r) => r.improvable },
  { label: '責任', get: (r) => (r.responsible ? '✓' : '') },
];

export default function IncidentDetailDialog({
  rows, index, onIndex, onClose,
}: {
  rows: IncidentRow[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const row = rows[index];
  if (!row) return null;

  const longBlock = (label: string, value: string) => (
    <div className="space-y-1">
      <p className="text-xs font-bold text-neutral-700">{label}</p>
      <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
        {value || '-'}
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => onIndex(index - 1)}
        disabled={index <= 0}
        title="前のインシデント"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-lg font-bold text-neutral-900 truncate">
              {row.feature || '(機能名なし)'}
            </h3>
            {row.system && <span className="text-sm text-neutral-400 shrink-0">{row.system}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rows.length > 1 && (
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {index + 1} / {rows.length}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {longBlock('障害内容', row.defect)}

              {/* 指摘工程と指摘分類は短いので横に並べる */}
              <div className="grid grid-cols-2 gap-3">
                {[['指摘工程', row.process], ['指摘分類', row.category]].map(([label, value]) => (
                  <div key={label} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{label}</p>
                    <p className="text-sm font-bold text-neutral-900 break-words">{value || '-'}</p>
                  </div>
                ))}
              </div>

              {longBlock('TestCenter確認結果', row.tcResult)}
              {longBlock('チェックリスト', row.checklist)}
            </div>

            <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 self-start w-full">
              {SECONDARY.map((f) => {
                const value = f.get(row);
                return (
                  <div key={f.label} className="px-3 py-2 flex items-start gap-3">
                    <p className="text-[11px] text-neutral-400 w-24 shrink-0 pt-0.5">{f.label}</p>
                    <p className="flex-1 text-sm text-neutral-700 min-w-0 break-words" title={value}>
                      {value || '-'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onIndex(index + 1)}
        disabled={index >= rows.length - 1}
        title="次のインシデント"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
