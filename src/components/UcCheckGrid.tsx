// UnivContents の検証項目 ①〜⑦ (OK / NG / 空) を詳細ダイアログに並べる
import { RESULT_COLOR, UC_CHECK_ITEMS, UC_CHECK_OPTIONS, type TcRow } from './testcaseFields';

export default function UcCheckGrid({ row, draft, editing, onChange }: {
  row: TcRow;
  draft: Record<string, string>;
  editing: boolean;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
      <p className="px-3 py-2 text-[11px] font-semibold text-neutral-400">検証項目</p>
      {UC_CHECK_ITEMS.map((f) => {
        const v = editing ? (draft[f] ?? '') : (row[f] || '');
        return (
          <div key={f} className="px-3 py-2 flex items-center gap-3">
            <p className="text-xs text-neutral-600 flex-1 min-w-0">{f}</p>
            {editing ? (
              <select
                value={v}
                onChange={(e) => onChange(f, e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none"
              >
                {UC_CHECK_OPTIONS.map((o) => <option key={o} value={o}>{o || '-'}</option>)}
              </select>
            ) : v ? (
              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[v] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                {v}
              </span>
            ) : <span className="text-sm text-neutral-400">-</span>}
          </div>
        );
      })}
    </div>
  );
}
