import { useEffect, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Loader2, Lock, Pencil, Save } from 'lucide-react';

interface ScheduleField {
  key: string;
  label: string;
  property: string | null;
  value: string;
  editable: boolean;
  reason: string | null;
}

const ROWS: { plan: string; actual: string; title: string }[] = [
  { plan: 'tcStartDate', actual: 'actualStartDate', title: '開始' },
  { plan: 'tcDesignCompleteDate', actual: 'actualDesignCompleteDate', title: '設計書完了' },
  { plan: 'tcExecutionCompleteDate', actual: 'actualExecutionCompleteDate', title: '実施完了' },
];

function toInputDate(raw: string): string {
  const m = (raw ?? '').trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

const STATUS_COLORS: Record<string, string> = {
  '未着手': 'bg-neutral-100 text-neutral-600',
  '進行中': 'bg-blue-50 text-blue-700',
  '完了': 'bg-emerald-50 text-emerald-700',
  'リリース済み': 'bg-purple-50 text-purple-700',
};

export default function CaseSchedule({ caseId }: { caseId: string }) {
  const [fields, setFields] = useState<ScheduleField[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setEditing(false);
    setSaved(false);
    fetch(`/api/test-center/case-schedule/${encodeURIComponent(caseId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<{ fields: ScheduleField[]; statusOptions?: string[] }>;
      })
      .then((d) => {
        if (alive) {
          setFields(d.fields ?? []);
          setStatusOptions(d.statusOptions ?? []);
        }
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [caseId]);

  const byKey = (k: string) => fields.find((f) => f.key === k);

  const statusField = fields.find((f) => f.key === 'status');
  const dateFields = fields.filter((f) => f.key !== 'status');
  const anyDateEditable = dateFields.some((f) => f.editable);
  const anyFieldEditable = anyDateEditable || (statusField?.editable ?? false);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of dateFields) if (f.editable) d[f.key] = toInputDate(f.value);
    if (statusField?.editable) d['status'] = statusField.value ?? '';
    setDraft(d);
    setEditing(true);
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(draft)) {
      if (k === 'status') {
        if (draft[k] !== (statusField?.value ?? '')) changed[k] = draft[k];
        continue;
      }
      const cur = toInputDate(byKey(k)?.value ?? '');
      if (draft[k] !== cur) changed[k] = draft[k];
    }
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-center/case-schedule/${encodeURIComponent(caseId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: changed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '更新に失敗しました');
      const resp = body as { fields?: ScheduleField[]; statusOptions?: string[] };
      setFields(resp.fields ?? fields);
      if (resp.statusOptions) setStatusOptions(resp.statusOptions);
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const cell = (key: string) => {
    const f = byKey(key);
    if (!f) return <span className="text-sm text-neutral-300">-</span>;
    if (editing && f.editable) {
      return (
        <input
          type="date"
          value={draft[key] ?? ''}
          onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none"
        />
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`text-sm tabular-nums ${f.value ? 'text-neutral-800' : 'text-neutral-300'}`}>
          {toInputDate(f.value) || '未入力'}
        </span>
        {!f.editable && f.reason && (
          <Lock size={11} className="text-neutral-300" title={f.reason} />
        )}
      </span>
    );
  };

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarClock size={15} className="text-neutral-400" />
          <h3 className="text-sm font-bold text-neutral-800">予定・実績日</h3>
          {saved && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
              <Check size={12} /> 保存しました
            </span>
          )}
        </div>
        {!loading && anyFieldEditable && (
          editing ? (
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
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <Pencil size={14} />
              編集
            </button>
          )
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2 whitespace-pre-line">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400 py-2">
          <Loader2 size={14} className="animate-spin" />
          読み込み中...
        </div>
      ) : (
        <>
          {statusField && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500 text-xs font-medium">状態</span>
              {editing && statusField.editable ? (
                <select
                  value={draft['status'] ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))}
                  className="rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none"
                >
                  {statusOptions.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[statusField.value] ?? 'bg-neutral-100 text-neutral-600'}`}>
                  {statusField.value || '未設定'}
                </span>
              )}
            </div>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-28 px-2 py-1.5 text-left text-[11px] font-semibold text-neutral-400"></th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-neutral-400">予定</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-neutral-400">実績</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.title} className="border-t border-neutral-100">
                  <td className="px-2 py-2 text-xs font-medium text-neutral-600">{r.title}</td>
                  <td className="px-2 py-2">{cell(r.plan)}</td>
                  <td className="px-2 py-2">{cell(r.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!anyFieldEditable && (
            <p className="text-[11px] text-amber-600">
              この案件の日付は編集できません（{fields.find((f) => f.reason)?.reason ?? '理由不明'}）。
              Notion 側で直接更新してください。
            </p>
          )}
        </>
      )}
    </section>
  );
}
