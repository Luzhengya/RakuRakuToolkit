// TestCase 画面からケースを1件追加する (ライブラリに無い、今回の案件で新しく必要になったケース)。
// ケース番号は案件の「CMDB番号-連番」でサーバーが採番する。
import { useState } from 'react';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import CasePicker, { type CaseCandidate } from './CasePicker';

const LONG_FIELDS = ['テスト内容', '前提条件', 'ステップ', '予期結果', '備考'] as const;
const SHORT_FIELDS = ['大分類', '中分類', '小分類', '機能名', '要件名', 'ポイント', '優先級', 'カテゴリ'] as const;
const REQUIRED = new Set<string>(['テスト内容', '予期結果']);

export default function NewTestcaseDialog({ initialSystem, onClose, onCreated }: {
  initialSystem: string;
  onClose: () => void;
  onCreated: (r: { caseNo: string; system: string; year: number }) => void;
}) {
  const [target, setTarget] = useState<CaseCandidate | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const missing: string[] = [];
  if (!target) missing.push('案件');
  for (const f of REQUIRED) if (!(form[f] ?? '').trim()) missing.push(f);
  const canSave = missing.length === 0 && !!target?.cmdbNo && !saving;

  const save = async () => {
    if (!canSave || !target) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/testcase/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: target.id, fields: form }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '作成に失敗しました');
      onCreated(body as { caseNo: string; system: string; year: number });
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none';
  const label = (f: string) => (
    <span className="text-xs font-bold text-neutral-700">{f} {REQUIRED.has(f) && <span className="text-red-500">*</span>}</span>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <h3 className="text-lg font-bold text-neutral-900">ケース新規作成</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-400"><span className="text-red-500">*</span> は必須</span>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={missing.length ? `未入力の必須項目: ${missing.join('、')}` : ''}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
            <button type="button" onClick={onClose} disabled={saving} className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-40">
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-center gap-2 shrink-0">
            <AlertCircle size={15} />{error}
          </div>
        )}

        <div className="p-5 overflow-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            {LONG_FIELDS.map((f) => (
              <label key={f} className="block space-y-1">
                {label(f)}
                <textarea value={form[f] ?? ''} onChange={(e) => set(f, e.target.value)} rows={3} className={inputCls} />
              </label>
            ))}
          </div>
          <div className="space-y-3">
            <div className="border border-neutral-200 rounded-lg p-3 space-y-2">
              <span className="text-xs font-bold text-neutral-700">案件 <span className="text-red-500">*</span></span>
              <CasePicker value={target?.id ?? ''} onChange={setTarget} initialSystem={initialSystem} />
            </div>
            {SHORT_FIELDS.map((f) => (
              <label key={f} className="block space-y-1">
                {label(f)}
                <input type="text" value={form[f] ?? ''} onChange={(e) => set(f, e.target.value)} className={inputCls} />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
