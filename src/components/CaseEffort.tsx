import { useEffect, useState } from 'react';
import { AlertCircle, Check, ClipboardList, Loader2, Lock, Pencil, Save } from 'lucide-react';

interface EffortField {
  key: string;
  label: string;
  property: string | null;
  value: string;
  editable: boolean;
  reason: string | null;
}

export default function CaseEffort({ caseId }: { caseId: string }) {
  const [fields, setFields] = useState<EffortField[]>([]);
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
    fetch(`/api/test-center/case-effort/${encodeURIComponent(caseId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<{ fields: EffortField[] }>;
      })
      .then((d) => { if (alive) setFields(d.fields ?? []); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [caseId]);

  const anyEditable = fields.some((f) => f.editable);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of fields) if (f.editable) d[f.key] = f.value ?? '';
    setDraft(d);
    setEditing(true);
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(draft)) {
      const cur = fields.find((f) => f.key === k)?.value ?? '';
      if (draft[k] !== cur) changed[k] = draft[k];
    }
    if (Object.keys(changed).length === 0) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-center/case-effort/${encodeURIComponent(caseId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: changed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '更新に失敗しました');
      setFields((body as { fields?: EffortField[] }).fields ?? fields);
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-neutral-400" />
          <h3 className="text-sm font-bold text-neutral-800">工数（見積）</h3>
          {saved && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
              <Check size={12} /> 保存しました
            </span>
          )}
        </div>
        {!loading && anyEditable && (
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {fields.map((f) => (
              <div key={f.key} className="bg-neutral-50 rounded-lg px-3 py-2">
                <p className="text-neutral-400 text-[10px] font-medium mb-0.5">{f.label.replace(/^工数見積\(/, '').replace(/\)$/, '')}</p>
                {editing && f.editable ? (
                  <input
                    type="text"
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-mono text-neutral-800 focus:border-neutral-500 focus:outline-none"
                  />
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <span className={`font-mono text-neutral-700 ${f.value ? '' : 'text-neutral-300'}`}>
                      {f.value || '-'}
                    </span>
                    {!f.editable && f.reason && (
                      <Lock size={10} className="text-neutral-300" title={f.reason} />
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
          {!anyEditable && (
            <p className="text-[11px] text-amber-600">
              この案件の工数見積は編集できません（{fields.find((f) => f.reason)?.reason ?? '理由不明'}）。
            </p>
          )}
        </>
      )}
    </section>
  );
}
