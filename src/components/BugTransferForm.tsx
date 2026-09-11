import { useEffect, useState } from 'react';
import { AlertCircle, Bug, Loader2, Send } from 'lucide-react';

interface Candidate {
  id: string;
  projectName: string;
  month: string;
  system: string;
}

interface BugContext {
  candidates: Candidate[];
  nextNo: string;
  defaults: {
    bugDesc: string;
    judgment: string;
    status: string;
    module: string;
    reproSteps: string;
    expectedResult: string;
    priority: string;
    caseNumber: string;
    execDate: string;
    browserVersion: string;
    appVersion: string;
  };
  fieldOptions: { judgment: string[]; status: string[]; priority: string[] };
}

export default function BugTransferForm({
  caseId, year, onDone,
}: {
  caseId: string;
  year: number;
  onDone: (bugId: string, bugNo: string) => void;
}) {
  const [ctx, setCtx] = useState<BugContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 入力値
  const [selectedCase, setSelectedCase] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [bugDesc, setBugDesc] = useState('');
  const [judgment, setJudgment] = useState('NG');
  const [status, setStatus] = useState('対応待ち');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/testcase/${encodeURIComponent(caseId)}/bug-context?year=${year}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<BugContext>;
      })
      .then((d) => {
        if (!alive) return;
        setCtx(d);
        setBugDesc(d.defaults.bugDesc);
        setJudgment(d.defaults.judgment);
        setStatus(d.defaults.status);
        // 候補が1件だけなら選ぶ手間を省く
        if (d.candidates.length === 1) setSelectedCase(d.candidates[0].id);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [caseId, year]);

  const submit = async () => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/testcase/${encodeURIComponent(caseId)}/transfer-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: selectedCase,
          no: ctx.nextNo,
          // ユーザーが編集した値
          bugDesc,
          actualResult,
          judgment,
          status,
          // 自動で入る値。defaults にも bugDesc/judgment/status があるため
          // spread すると上の編集値を上書きしてしまう。明示的に列挙する
          module: ctx.defaults.module,
          reproSteps: ctx.defaults.reproSteps,
          expectedResult: ctx.defaults.expectedResult,
          priority: ctx.defaults.priority,
          caseNumber: ctx.defaults.caseNumber,
          execDate: ctx.defaults.execDate,
          browserVersion: ctx.defaults.browserVersion,
          appVersion: ctx.defaults.appVersion,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '移管に失敗しました');
      const r = body as { bugId: string; bugNo: string; skipped?: string[]; resultUpdated?: boolean; resultError?: string };
      if (r.resultUpdated === false) {
        // BUG は作れているので、失敗したのはテスト結果の更新だけ
        setError(`BUG は作成しましたが、テスト結果を NG にできませんでした: ${r.resultError ?? ''}`);
        setSaving(false);
        return;
      }
      onDone(r.bugId, r.bugNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : '移管に失敗しました');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none';

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500 py-4">
        <Loader2 size={15} className="animate-spin" />
        移管情報を読み込み中...
      </div>
    );
  }

  const noCandidate = !ctx || ctx.candidates.length === 0;
  const canSubmit = !!selectedCase && !!actualResult.trim() && !saving;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bug size={15} className="text-red-500" />
        <h4 className="text-sm font-bold text-neutral-800">BUG移管</h4>
        {ctx && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
            No. {ctx.nextNo}（自動採番）
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {noCandidate ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
          対応するテスト案件が見つかりませんでした。BUG のシステム・月次は案件から
          決まるため、案件を特定できないと移管できません。
          <span className="block mt-1 text-[11px]">
            案件名の先頭が CMDB番号 になっているか、進捗管理表に該当案件があるか確認してください。
          </span>
        </div>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-neutral-500">
              テスト案件 <span className="text-red-500">*</span>
            </span>
            <select
              value={selectedCase}
              onChange={(e) => setSelectedCase(e.target.value)}
              className={inputCls}
            >
              <option value="">選択してください</option>
              {ctx!.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.projectName}{c.month ? `（${c.month}）` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-neutral-500">
              実際結果 <span className="text-red-500">*</span>
            </span>
            <textarea
              value={actualResult}
              onChange={(e) => setActualResult(e.target.value)}
              rows={3}
              placeholder="実際に起きたことを記入してください"
              className={inputCls}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-neutral-500">Bug説明</span>
            <textarea
              value={bugDesc}
              onChange={(e) => setBugDesc(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-neutral-500">判定</span>
              <select value={judgment} onChange={(e) => setJudgment(e.target.value)} className={inputCls}>
                {(ctx!.fieldOptions.judgment.length ? ctx!.fieldOptions.judgment : ['NG']).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-neutral-500">ステータス</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                {(ctx!.fieldOptions.status.length ? ctx!.fieldOptions.status : ['対応待ち']).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>

          {/* 自動で入る項目。確認だけできるように読み取り専用で見せる */}
          <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 text-xs">
            {[
              ['ケース番号', ctx!.defaults.caseNumber],
              ['モジュール', ctx!.defaults.module],
              ['優先度', ctx!.defaults.priority],
              ['実施日', ctx!.defaults.execDate],
              ['再現ステップ', ctx!.defaults.reproSteps],
              ['予定結果', ctx!.defaults.expectedResult],
              ['ブラウザ / バージョン', ctx!.defaults.browserVersion],
              ['アプリバージョン', ctx!.defaults.appVersion],
            ].map(([k, v]) => (
              <div key={k} className="px-3 py-1.5 flex items-start gap-3">
                <span className="text-neutral-400 w-32 shrink-0">{k}</span>
                <span className="text-neutral-700 flex-1 min-w-0 whitespace-pre-wrap">{v || '-'}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-neutral-400">
            移管するとこのテストケースのテスト結果は NG になります。
          </p>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            BUG を作成
          </button>
        </>
      )}
    </div>
  );
}
