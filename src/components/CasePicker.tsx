// TestCase の登録先にする案件を選ぶ (ライブラリからのコピーと新規ケースで共用)。
// 案件の システム・月次・案件名先頭の CMDB番号 で、登録先の表とケース番号が決まる。
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

export interface CaseCandidate {
  id: string;
  projectName: string;
  month: string;
  system: string;
  cmdbNo: string;
}

// 一覧と同じ月の比較キー (2026-09 / 2026/9 / 202609 → 202609)
function monthKeyOf(value: string): string {
  const m = (value ?? '').match(/(\d{4})[-/.年]?(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, '0')}` : '';
}

export default function CasePicker({ value, onChange, initialSystem = '' }: {
  value: string;
  onChange: (c: CaseCandidate | null) => void;
  /** 候補の初期絞り込み (システム名) */
  initialSystem?: string;
}) {
  const [candidates, setCandidates] = useState<CaseCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fSystem, setFSystem] = useState(initialSystem);
  const [fMonth, setFMonth] = useState('');
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/testcase/case-candidates')
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || '取得に失敗しました');
        return r.json() as Promise<{ candidates: CaseCandidate[] }>;
      })
      .then((d) => {
        if (!alive) return;
        setCandidates(d.candidates ?? []);
        // 初期絞り込みのシステムが候補に無ければ絞り込まない
        if (initialSystem && !(d.candidates ?? []).some((c) => c.system === initialSystem)) setFSystem('');
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [initialSystem]);

  const systems = useMemo(() => Array.from(new Set(candidates.map((c) => c.system).filter(Boolean))).sort(), [candidates]);
  const months = useMemo(() => Array.from(new Set(candidates.map((c) => monthKeyOf(c.month)).filter(Boolean))).sort().reverse(), [candidates]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return candidates.filter((c) =>
      (!fSystem || c.system === fSystem)
      && (!fMonth || monthKeyOf(c.month) === fMonth)
      && (!kw || c.projectName.toLowerCase().includes(kw)));
  }, [candidates, fSystem, fMonth, keyword]);

  // 絞り込みで選択中の案件が候補から消えたら選び直してもらう
  useEffect(() => {
    if (value && !filtered.some((c) => c.id === value)) onChange(null);
  }, [filtered, value, onChange]);

  const selected = candidates.find((c) => c.id === value) ?? null;
  const inputCls = 'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 bg-white focus:border-neutral-500 focus:outline-none';

  if (loading) {
    return <p className="text-sm text-neutral-400 inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />案件を読み込み中...</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600 inline-flex items-center gap-1.5"><AlertCircle size={14} />{error}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={fSystem} onChange={(e) => setFSystem(e.target.value)} className={inputCls}>
          <option value="">全システム</option>
          {systems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={inputCls}>
          <option value="">全期間</option>
          {months.map((m) => <option key={m} value={m}>{`${m.slice(0, 4)}/${m.slice(4)}`}</option>)}
        </select>
      </div>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="案件名・CMDB番号で絞り込み"
        className={inputCls}
      />
      <select
        value={value}
        onChange={(e) => onChange(candidates.find((c) => c.id === e.target.value) ?? null)}
        className={inputCls}
      >
        <option value="">選択してください（{filtered.length}件）</option>
        {filtered.map((c) => (
          <option key={c.id} value={c.id}>{c.projectName}{c.month ? `（${c.month}）` : ''}</option>
        ))}
      </select>
      {selected && (
        selected.cmdbNo ? (
          <p className="text-xs text-neutral-500">
            登録先：<b className="text-neutral-800">{selected.system}{monthKeyOf(selected.month).slice(0, 4)}</b>
            ／ ケース番号：<b className="text-neutral-800 tabular-nums">{selected.cmdbNo}-連番</b>
          </p>
        ) : (
          <p className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertCircle size={12} />案件名の先頭に CMDB番号 が無いため、この案件には登録できません
          </p>
        )
      )}
    </div>
  );
}
