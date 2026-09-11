import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  HIGHLIGHT_FIELDS, LONG_TEXT_FIELDS, PRIMARY_FIELDS, RESULT_COLOR, SECONDARY_FIELDS,
  type TcRow,
} from './testcaseFields';

// テストケースの内容だけを見せるダイアログ。
// 案件詳細の「関連テストケース」から開く用途なので、編集・削除・BUG移管 は
// 置かない (TestCase 画面側のダイアログがそれらを持つ)。
// 前後送りは残す。数十件あるので1件ずつ閉じ開きするのは手間。
export default function TestcaseDetailDialog({
  rows, index, onIndex, onClose,
}: {
  rows: TcRow[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const row = rows[index];
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => onIndex(index - 1)}
        disabled={index <= 0}
        title="前のケース"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-lg font-bold text-neutral-900 truncate shrink-0">
              NO.{row['ケース番号'] || '-'}
            </h3>
            {row['機能名'] && (
              <span className="text-sm text-neutral-400 truncate">{row['機能名']}</span>
            )}
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
              {PRIMARY_FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">{f}</p>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                    {row[f] || '-'}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {HIGHLIGHT_FIELDS.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                    {f === 'テスト結果' ? (
                      row[f] ? (
                        <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${RESULT_COLOR[row[f]] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                          {row[f]}
                        </span>
                      ) : <span className="text-sm text-neutral-400">-</span>
                    ) : (
                      <p className="text-lg font-bold text-neutral-900">{row[f] || '-'}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {SECONDARY_FIELDS.map((f) => {
                  const isLong = LONG_TEXT_FIELDS.has(f);
                  return (
                    <div key={f} className="px-3 py-2 flex items-start gap-3">
                      <p className="text-[11px] text-neutral-400 w-20 shrink-0 pt-0.5">{f}</p>
                      <p
                        className={`flex-1 text-sm text-neutral-700 min-w-0 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`}
                        title={row[f] || ''}
                      >
                        {row[f] || '-'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onIndex(index + 1)}
        disabled={index >= rows.length - 1}
        title="次のケース"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
