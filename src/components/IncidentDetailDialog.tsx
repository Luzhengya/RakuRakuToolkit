import { useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Pencil, Save, X } from 'lucide-react';

// インシデント1件の全項目を見せるダイアログ。
// 一覧は列を絞ってあるので、隠した項目はここで確認・編集する。
// 配置はテストケースの詳細ダイアログに合わせる:
// 読む必要のある長文を左に大きく、付随情報は右に一覧で。
export type IncidentRow = {
  id: string;
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

// Notion 側のプロパティ型。入力欄の種類と選択肢をこれで決める
export type IncidentField = { type: string; options: string[]; writable: boolean };
export type IncidentFields = Record<string, IncidentField>;

type Key = Exclude<keyof IncidentRow, 'id' | 'responsible'>;

const LABEL: Record<string, string> = {
  system: 'サービス', caseMonth: '案件別', cmdb: 'CMDB番号', feature: '機能(画面)名',
  defect: '障害内容', process: '指摘工程', category: '指摘分類', cause: '原因区分',
  releaseTime: 'リリース時期', tcResult: 'TestCenter確認結果', status: '状態',
  improvable: '改善可/不可', checklist: 'チェックリスト', responsible: '責任',
};

// 左に大きく出す長文
const LONG: Key[] = ['defect', 'tcResult', 'checklist'];
// 左の中ほどに横並びで出す
const PAIR: Key[] = ['process', 'category'];
// 右の付随情報。サービスと機能(画面)名は見出しに出すので入れない
const SECONDARY: Key[] = ['caseMonth', 'cmdb', 'cause', 'releaseTime', 'status', 'improvable'];

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400';

export default function IncidentDetailDialog({
  rows, fields, index, onIndex, onClose, onSaved,
}: {
  rows: IncidentRow[];
  fields: IncidentFields;
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  onSaved: (row: IncidentRow) => void;
}) {
  const row = rows[index];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IncidentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!row) return null;
  const shown = editing && draft ? draft : row;

  const startEdit = () => {
    setDraft({ ...row });
    setError(null);
    setNotice(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
    setError(null);
  };
  // 編集中に別の件へ移ると入力が消える。テストケース側と同じく移動を止める
  const step = (delta: number) => {
    if (editing) return;
    setNotice(null);
    onIndex(index + delta);
  };

  const set = (k: keyof IncidentRow, v: string | boolean) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id, ...values } = draft;
      const res = await fetch(`/api/test-center/bug-leak/${encodeURIComponent(id)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '更新に失敗しました');
      const skipped = (body as { skipped?: string[] }).skipped ?? [];
      onSaved(draft);
      setEditing(false);
      setDraft(null);
      // 書けなかった項目は黙って捨てず知らせる
      setNotice(skipped.length ? `保存しました。次の項目は表側が書き込み不可のため反映されていません: ${skipped.join('、')}` : '保存しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 項目1つぶんの入力欄。Notion のプロパティ型に合わせて出し分ける
  const field = (k: Key, long: boolean) => {
    const f = fields[k];
    const value = shown[k];
    if (!editing) {
      return (
        <p className={`text-sm text-neutral-700 min-w-0 break-words ${long ? 'whitespace-pre-wrap' : ''}`} title={value}>
          {value || '-'}
        </p>
      );
    }
    if (f && !f.writable) {
      return (
        <p className="text-sm text-neutral-400 break-words" title="この項目は Notion 側で計算・自動入力のため編集できません">
          {value || '-'}（編集不可）
        </p>
      );
    }
    if (f && (f.type === 'select' || f.type === 'status') && f.options.length > 0) {
      return (
        <select value={value} onChange={(e) => set(k, e.target.value)} className={inputCls}>
          {/* 現在値が選択肢に無いことがある。空欄を足して選び直せるようにする */}
          {!f.options.includes(value) && <option value={value}>{value || '(未設定)'}</option>}
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (long) {
      return (
        <textarea value={value} onChange={(e) => set(k, e.target.value)} rows={5} className={inputCls} />
      );
    }
    return <input value={value} onChange={(e) => set(k, e.target.value)} className={inputCls} />;
  };

  const longBlock = (k: Key) => (
    <div key={k} className="space-y-1">
      <p className="text-xs font-bold text-neutral-700">{LABEL[k]}</p>
      {editing
        ? field(k, true)
        : (
          <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
            {shown[k] || '-'}
          </p>
        )}
    </div>
  );

  const respField = fields['responsible'];
  const respEditable = editing && (!respField || respField.writable);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={editing || index <= 0}
        title={editing ? '編集中は移動できません。保存またはキャンセルしてください' : '前のインシデント'}
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
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                <Pencil size={14} />
                編集
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-50"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-auto space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">{error}</span>
            </div>
          )}
          {notice && !editing && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-emerald-800 text-sm">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {longBlock('defect')}

              {/* 指摘工程と指摘分類は短いので横に並べる */}
              <div className="grid grid-cols-2 gap-3">
                {PAIR.map((k) => (
                  <div key={k} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{LABEL[k]}</p>
                    {editing ? field(k, false) : <p className="text-sm font-bold text-neutral-900 break-words">{shown[k] || '-'}</p>}
                  </div>
                ))}
              </div>

              {LONG.filter((k) => k !== 'defect').map((k) => longBlock(k))}
            </div>

            <div className="space-y-3 self-start w-full">
              {/* 編集中は見出しの2項目もここで直せるようにする */}
              {editing && (['feature', 'system'] as Key[]).map((k) => (
                <div key={k} className="space-y-1">
                  <p className="text-[11px] text-neutral-400">{LABEL[k]}</p>
                  {field(k, false)}
                </div>
              ))}

              <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {SECONDARY.map((k) => (
                  <div key={k} className="px-3 py-2 flex items-start gap-3">
                    <p className="text-[11px] text-neutral-400 w-24 shrink-0 pt-1.5">{LABEL[k]}</p>
                    <div className="flex-1 min-w-0">{field(k, false)}</div>
                  </div>
                ))}
                <div className="px-3 py-2 flex items-center gap-3">
                  <p className="text-[11px] text-neutral-400 w-24 shrink-0">{LABEL['responsible']}</p>
                  {respEditable ? (
                    <input
                      type="checkbox"
                      checked={shown.responsible}
                      onChange={(e) => set('responsible', e.target.checked)}
                      className="w-4 h-4 accent-neutral-900"
                    />
                  ) : (
                    <p className="text-sm text-neutral-700">{shown.responsible ? '✓' : '-'}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={editing || index >= rows.length - 1}
        title={editing ? '編集中は移動できません。保存またはキャンセルしてください' : '次のインシデント'}
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
