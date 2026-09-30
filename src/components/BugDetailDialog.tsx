import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Pencil, Save, Loader2, Check, AlertCircle } from 'lucide-react';

type CaseBug = {
  id: string;
  no: string;
  priority: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  assignee: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  caseNumber: string;
  browserVersion: string;
  remarks: string;
};

type FieldOptions = { judgment: string[]; status: string[]; priority: string[] };
type Draft = { judgment: string; status: string; priority: string; remarks: string };

const JUDGMENT_COLOR: Record<string, string> = {
  '確認OK': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'NG': 'bg-red-50 text-red-700 border-red-200',
  'NG確認要': 'bg-orange-50 text-orange-700 border-orange-200',
  '想定以外NG': 'bg-purple-50 text-purple-700 border-purple-200',
};
const STATUS_COLOR: Record<string, string> = {
  '対応待ち': 'bg-neutral-100 text-neutral-600 border-neutral-200',
  '対応中': 'bg-blue-50 text-blue-700 border-blue-200',
  '確認中': 'bg-amber-50 text-amber-700 border-amber-200',
  '対応不要': 'bg-neutral-50 text-neutral-500 border-neutral-200',
  '対応完了': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const PRIORITY_COLOR: Record<string, string> = {
  '高': 'bg-red-50 text-red-700 border-red-200',
  '中': 'bg-amber-50 text-amber-700 border-amber-200',
  '低': 'bg-blue-50 text-blue-700 border-blue-200',
};
function badgeCls(value: string, palette: Record<string, string>): string {
  return palette[value] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}
function withCurrent(opts: string[], cur: string): string[] {
  return cur && !opts.includes(cur) ? [cur, ...opts] : opts;
}
function fmtDate(value: string): string {
  return value ? value.slice(0, 10) : '-';
}

export default function BugDetailDialog({
  bugs, index, onIndex, onClose, fieldOptions, childHtml,
  onSave,
}: {
  bugs: CaseBug[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  fieldOptions: FieldOptions;
  childHtml?: string;
  onSave: (bugId: string, draft: Draft) => Promise<void>;
}) {
  const bug = bugs[index];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ judgment: '', status: '', priority: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bug) return null;

  const startEdit = () => {
    setDraft({ judgment: bug.judgment, status: bug.status, priority: bug.priority, remarks: bug.remarks });
    setEditing(true);
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(bug.id, draft);
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

  const selectCls = 'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => handleNav(index - 1)}
        disabled={index <= 0}
        title="前のバグ"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-lg font-bold text-neutral-900 truncate shrink-0">
              NO.{bug.no || '-'}
            </h3>
            <span className="text-sm text-neutral-500 truncate">{bug.bugDesc || '-'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <Check size={12} /> 更新しました
              </span>
            )}
            {bugs.length > 1 && (
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {index + 1} / {bugs.length}
              </span>
            )}
            {!editing ? (
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
            {/* Left 2/3 — primary info */}
            <div className="lg:col-span-2 space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-bold text-neutral-700">再現ステップ</p>
                <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                  {bug.reproSteps || '-'}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">予定結果</p>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                    {bug.expectedResult || '-'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">実際結果</p>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                    {bug.actualResult || '-'}
                  </p>
                </div>
              </div>

              {/* 確認結果(備考) */}
              <div className="space-y-1">
                <p className="text-xs font-bold text-neutral-700">確認結果</p>
                {editing ? (
                  <textarea
                    rows={3}
                    value={draft.remarks}
                    onChange={(e) => setDraft((p) => ({ ...p, remarks: e.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none resize-y"
                  />
                ) : (
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[2rem]">
                    {bug.remarks || '-'}
                  </p>
                )}
              </div>

              {/* 子ページ */}
              {childHtml !== undefined && (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">子ページの内容</p>
                  {childHtml.trim() ? (
                    <div
                      className="text-sm text-neutral-700 border border-neutral-200 rounded-lg p-3 bg-white [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_img]:my-1.5"
                      dangerouslySetInnerHTML={{ __html: childHtml }}
                    />
                  ) : (
                    <p className="text-sm text-neutral-400">子ページの内容はありません</p>
                  )}
                </div>
              )}
            </div>

            {/* Right 1/3 — highlight + secondary */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {([
                  { label: '判定', value: bug.judgment, palette: JUDGMENT_COLOR, draftKey: 'judgment' as const },
                  { label: 'ステータス', value: bug.status, palette: STATUS_COLOR, draftKey: 'status' as const },
                  { label: '優先度', value: bug.priority, palette: PRIORITY_COLOR, draftKey: 'priority' as const },
                ]).map((item) => (
                  <div key={item.label} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{item.label}</p>
                    {editing ? (
                      <select
                        className={selectCls}
                        value={draft[item.draftKey]}
                        onChange={(e) => setDraft((p) => ({ ...p, [item.draftKey]: e.target.value }))}
                      >
                        <option value="">-</option>
                        {withCurrent(fieldOptions[item.draftKey], draft[item.draftKey]).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : item.value ? (
                      <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${badgeCls(item.value, item.palette)}`}>
                        {item.value}
                      </span>
                    ) : (
                      <span className="text-sm text-neutral-400">-</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {([
                  { label: 'ケース番号', value: bug.caseNumber },
                  { label: '実施日', value: fmtDate(bug.execDate) },
                  { label: '実施者', value: bug.assignee },
                  { label: 'ブラウザ・バージョン', value: bug.browserVersion },
                ]).map((f) => (
                  <div key={f.label} className="px-3 py-2 flex items-start gap-3">
                    <p className="text-[11px] text-neutral-400 w-28 shrink-0 pt-0.5">{f.label}</p>
                    <p className="flex-1 text-sm text-neutral-700 min-w-0 truncate" title={f.value || ''}>
                      {f.value || '-'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => handleNav(index + 1)}
        disabled={index >= bugs.length - 1}
        title="次のバグ"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
