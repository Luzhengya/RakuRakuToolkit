import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Pencil, Save, Loader2, Check, AlertCircle } from 'lucide-react';
import {
  HIGHLIGHT_FIELDS, LONG_TEXT_FIELDS, PRIMARY_FIELDS, RESULT_COLOR, SECONDARY_FIELDS,
  type TcRow,
} from './testcaseFields';

const EDITABLE_FIELDS = new Set([
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', '要件名',
  'テスト内容', '前提条件', 'ステップ', '予期結果',
  'ポイント', '優先級', 'カテゴリ', '状態', 'テスト結果', '関連NO', '備考',
]);

const RESULT_OPTIONS = ['OK', 'NG', 'テスト不可', '未実施'];

export default function TestcaseDetailDialog({
  rows, index, onIndex, onClose, onSave,
}: {
  rows: TcRow[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  onSave?: (id: string, fields: Record<string, string>) => Promise<void>;
}) {
  const row = rows[index];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!row) return null;

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) d[f] = row[f] ?? '';
    setDraft(d);
    setEditing(true);
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!onSave) return;
    const changed: Record<string, string> = {};
    for (const k of Object.keys(draft)) {
      if (draft[k] !== (row[k] ?? '')) changed[k] = draft[k];
    }
    if (Object.keys(changed).length === 0) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(row.id, changed);
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleNav = (next: number) => {
    setEditing(false);
    setSaved(false);
    setError(null);
    onIndex(next);
  };

  const isEditable = (f: string) => editing && EDITABLE_FIELDS.has(f);

  const renderField = (f: string, multiline: boolean) => {
    if (isEditable(f)) {
      if (f === 'テスト結果') {
        return (
          <select
            value={draft[f] ?? ''}
            onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none"
          >
            <option value="">-</option>
            {RESULT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      if (multiline) {
        return (
          <textarea
            rows={4}
            value={draft[f] ?? ''}
            onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none resize-y"
          />
        );
      }
      return (
        <input
          type="text"
          value={draft[f] ?? ''}
          onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
        />
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => handleNav(index - 1)}
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
            {row._bugNo && (
              <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold tabular-nums shrink-0">
                BUG #{row._bugNo}
              </span>
            )}
            {row['機能名'] && (
              <span className="text-sm text-neutral-400 truncate">{row['機能名']}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <Check size={12} /> 更新しました
              </span>
            )}
            {rows.length > 1 && (
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {index + 1} / {rows.length}
              </span>
            )}
            {onSave && (
              !editing ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <Pencil size={14} />
                  編集
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setError(null); }}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    保存
                  </button>
                </div>
              )
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

        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="p-5 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {PRIMARY_FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">{f}</p>
                  {isEditable(f) ? (
                    renderField(f, LONG_TEXT_FIELDS.has(f))
                  ) : (
                    <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                      {row[f] || '-'}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {HIGHLIGHT_FIELDS.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                    {isEditable(f) ? (
                      renderField(f, false)
                    ) : f === 'テスト結果' ? (
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
                      {isEditable(f) ? (
                        <div className="flex-1 min-w-0">
                          {renderField(f, isLong)}
                        </div>
                      ) : (
                        <p
                          className={`flex-1 text-sm text-neutral-700 min-w-0 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`}
                          title={row[f] || ''}
                        >
                          {row[f] || '-'}
                        </p>
                      )}
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
        onClick={() => handleNav(index + 1)}
        disabled={index >= rows.length - 1}
        title="次のケース"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
