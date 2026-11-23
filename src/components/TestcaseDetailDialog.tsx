import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Pencil, Save, Loader2, Check, AlertCircle } from 'lucide-react';
import UcCheckGrid from './UcCheckGrid';
import { ui } from './shared/uiClasses';
import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  HIGHLIGHT_FIELDS, LONG_TEXT_FIELDS, PRIMARY_FIELDS, RESULT_COLOR, RETEST_OPTIONS, SECONDARY_FIELDS,
  UC_EDITABLE_FIELDS, UC_HIGHLIGHT_FIELDS, UC_PRIMARY_FIELDS, UC_SECONDARY_FIELDS,
  bugLinkColor, isUnivContents, tcLabel, type TcRow,
} from './testcaseFields';

const EDITABLE_FIELDS = new Set([
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', '要件名',
  'テスト内容', '前提条件', 'ステップ', '予期結果',
  'ポイント', '優先級', 'カテゴリ', '状態', 'テスト結果',
  '再テスト結果', '再実施日', '再実施者', '関連NO', '備考',
]);

const RESULT_OPTIONS = ['OK', 'NG', 'テスト不可', '未実施'];
const UC_RESULT_OPTIONS = ['OK', 'NG'];

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
  // Esc で閉じる。編集中・保存中は入力が消えるので閉じない
  useEscapeKey(onClose, !!row && !editing && !saving);

  if (!row) return null;

  // UnivContents はブラウザ検証リストの別テンプレートで表示する
  const uc = isUnivContents(row['システム']);
  const editableFields = uc ? UC_EDITABLE_FIELDS : EDITABLE_FIELDS;
  const primaryFields: readonly string[] = uc ? UC_PRIMARY_FIELDS : PRIMARY_FIELDS;
  const highlightFields: readonly string[] = uc ? UC_HIGHLIGHT_FIELDS : HIGHLIGHT_FIELDS;
  const secondaryFields: readonly string[] = uc ? UC_SECONDARY_FIELDS : SECONDARY_FIELDS;
  const subtitle = uc ? row['course_name'] : row['機能名'];

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of editableFields) d[f] = row[f] ?? '';
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

  const isEditable = (f: string) => editing && editableFields.has(f);

  const renderField = (f: string, multiline: boolean) => {
    if (isEditable(f)) {
      if (f === 'テスト結果') {
        return (
          <select
            value={draft[f] ?? ''}
            onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
            className={`${ui.input} w-full`}
          >
            <option value="">-</option>
            {(uc ? UC_RESULT_OPTIONS : RESULT_OPTIONS).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      if (f === '再テスト結果') {
        return (
          <select
            value={draft[f] ?? ''}
            onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
            className={`${ui.input} w-full`}
          >
            {RETEST_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        );
      }
      if (multiline) {
        return (
          <textarea
            rows={4}
            value={draft[f] ?? ''}
            onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
            className={`${ui.input} w-full px-3 py-2 resize-y`}
          />
        );
      }
      return (
        <input
          type="text"
          value={draft[f] ?? ''}
          onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
          className={`${ui.input} w-full px-3 py-2`}
        />
      );
    }
    return null;
  };

  return (
    <div className={`${ui.dialogOverlay} gap-2`}>
      <button
        type="button"
        onClick={() => handleNav(index - 1)}
        disabled={index <= 0}
        title="前のケース"
        className={ui.dialogNav}
      >
        <ChevronLeft size={20} />
      </button>

      <div className={`${ui.dialogPanel} max-w-6xl`}>
        <div className={ui.dialogHeader}>
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className={`${ui.dialogTitle} shrink-0`}>
              NO.{row['ケース番号'] || '-'}
            </h3>
            {row._bugNo && (
              <span title={row._bugStatus || '状態未設定'} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums shrink-0 ${bugLinkColor(row._bugStatus)}`}>
                BUG #{row._bugNo}
              </span>
            )}
            {subtitle && (
              <span className="text-sm text-neutral-400 truncate">{subtitle}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                <Check size={12} /> 更新しました
              </span>
            )}
            {rows.length > 1 && (
              <span className="text-xs text-neutral-500 tabular-nums">
                {index + 1} / {rows.length}
              </span>
            )}
            {onSave && (
              !editing ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className={ui.btnSecondary}
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
                    className={ui.btnSecondary}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className={ui.btnPrimary}
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
              title="閉じる"
              aria-label="閉じる"
              className={ui.dialogClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className={`mx-5 mt-3 shrink-0 ${ui.errorBox} items-start`}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className={ui.dialogBody}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {primaryFields.map((f) => (
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
                {highlightFields.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-neutral-500">{tcLabel(f, uc)}</p>
                    {isEditable(f) ? (
                      renderField(f, false)
                    ) : f === 'テスト結果' ? (
                      row[f] ? (
                        <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${RESULT_COLOR[row[f]] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                          {row[f]}
                        </span>
                      ) : <span className="text-sm text-neutral-400">-</span>
                    ) : (
                      <p className={`font-bold text-neutral-900 ${uc ? 'text-sm break-words' : 'text-lg'}`}>{row[f] || '-'}</p>
                    )}
                  </div>
                ))}
              </div>

              {uc && (
                <UcCheckGrid
                  row={row}
                  draft={draft}
                  editing={editing}
                  onChange={(f, v) => setDraft((p) => ({ ...p, [f]: v }))}
                />
              )}

              {(editing ? (draft['テスト結果'] || '') : (row['テスト結果'] || '')).trim() === 'NG' && (
                <div className="border border-orange-200 rounded-lg p-3 bg-orange-50/40 space-y-3">
                  <p className="text-xs font-semibold text-orange-600">再テスト</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-neutral-500">再テスト結果</p>
                      {isEditable('再テスト結果') ? renderField('再テスト結果', false) : (
                        row['再テスト結果'] ? (
                          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[row['再テスト結果']] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                            {row['再テスト結果']}
                          </span>
                        ) : <span className="text-sm text-neutral-400">—</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-neutral-500">再実施日</p>
                      {isEditable('再実施日') ? (
                        <input type="date" value={draft['再実施日'] ?? ''} onChange={(e) => setDraft((p) => ({ ...p, '再実施日': e.target.value }))} className={`${ui.input} w-full`} />
                      ) : (
                        <p className="text-sm text-neutral-800">{row['再実施日'] || '—'}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-neutral-500">再実施者</p>
                      {isEditable('再実施者') ? (
                        <input value={draft['再実施者'] ?? ''} onChange={(e) => setDraft((p) => ({ ...p, '再実施者': e.target.value }))} className={`${ui.input} w-full`} />
                      ) : (
                        <p className="text-sm text-neutral-800">{row['再実施者'] || '—'}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {secondaryFields.map((f) => {
                  const isLong = LONG_TEXT_FIELDS.has(f);
                  return (
                    <div key={f} className="px-3 py-2 flex items-start gap-3">
                      <p className="text-xs text-neutral-500 w-20 shrink-0 pt-0.5">{f}</p>
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
        className={ui.dialogNav}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
