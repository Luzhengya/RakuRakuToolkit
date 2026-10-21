import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, ClipboardList, Loader2 } from 'lucide-react';
import TestcaseDetailDialog from './TestcaseDetailDialog';
import { RESULT_COLOR, effectiveResult, type TcRow } from './testcaseFields';

type Response = {
  items: TcRow[];
  total: number;
  exists: boolean;
  dbTitle: string;
  cmdbNo: string;
  projectName: string;
};

interface Stats {
  total: number;
  ok: number;
  ng: number;
  block: number;
  un: number;
  retestOk: number;
  retestNg: number;
}

const COLUMNS = ['ケース番号', '機能名', 'テスト内容', 'テスト結果', '優先級', 'BUG'] as const;

function computeStats(items: TcRow[]): Stats {
  let ok = 0, ng = 0, block = 0, un = 0, retestOk = 0, retestNg = 0;
  for (const r of items) {
    const result = (r['テスト結果'] || '').trim();
    const retest = (r['再テスト結果'] || '').trim();
    if (retest === '再確認OK') retestOk++;
    else if (retest === '再確認NG') retestNg++;
    const eff = effectiveResult(r);
    if (eff === 'OK') ok++;
    else if (eff === 'NG') ng++;
    else if (eff === 'テスト不可') block++;
    else un++;
  }
  return { total: items.length, ok, ng, block, un, retestOk, retestNg };
}

function StatsBar({ stats }: { stats: Stats }) {
  return (
    <div className="flex items-center gap-4 flex-wrap text-xs">
      <span className="text-neutral-500">総件数 <b className="tabular-nums text-neutral-900">{stats.total}</b></span>
      <span className="text-emerald-600">OK <b className="tabular-nums">{stats.ok}</b></span>
      <span className="text-red-600">NG <b className="tabular-nums">{stats.ng}</b></span>
      <span className="text-neutral-500">未実施 <b className="tabular-nums">{stats.un}</b></span>
      <span className="text-amber-600">テスト不可 <b className="tabular-nums">{stats.block}</b></span>
      <span className="text-emerald-500">再確認OK <b className="tabular-nums">{stats.retestOk}</b></span>
      <span className="text-red-500">再確認NG <b className="tabular-nums">{stats.retestNg}</b></span>
    </div>
  );
}

function TestcaseTable({ data, onDetailIndex }: { data: Response; onDetailIndex: (i: number) => void }) {
  const th0 = 'px-3 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
  const td0 = 'px-3 py-2 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';
  return (
    <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-white">
          <tr>{COLUMNS.map((c) => <th key={c} className={th0}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.items.map((r, i) => (
            <tr key={r.id} className="hover:bg-neutral-50 cursor-pointer" onClick={() => onDetailIndex(i)}>
              {COLUMNS.map((c) => {
                if (c === 'BUG') {
                  const bugNo = r._bugNo || '';
                  return (
                    <td key={c} className={td0}>
                      {bugNo ? (
                        <span className="inline-block rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold tabular-nums">
                          #{bugNo}
                        </span>
                      ) : '-'}
                    </td>
                  );
                }
                const v = r[c] || '';
                if (c === 'テスト結果') {
                  return (
                    <td key={c} className={td0}>
                      {v ? (
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[v] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                          {v}
                        </span>
                      ) : '-'}
                    </td>
                  );
                }
                const wide = c === 'テスト内容' || c === '機能名';
                return (
                  <td key={c} className={td0 + (wide ? ' max-w-[320px] truncate' : '')} title={wide ? v : undefined}>
                    {v || '-'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CaseTestcases({ caseId, embedded }: { caseId: string; embedded?: boolean }) {
  const [open, setOpen] = useState(false);
  const [detailIndex, setDetailIndex] = useState(-1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const doFetch = () => {
    if (data || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/test-center/case-testcases/${encodeURIComponent(caseId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<Response>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (embedded) doFetch();
  }, [embedded, caseId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) doFetch();
  };

  const stats = data ? computeStats(data.items) : null;

  const detailDialog = detailIndex >= 0 && data && (
    <TestcaseDetailDialog
      rows={data.items}
      index={detailIndex}
      onIndex={setDetailIndex}
      onClose={() => setDetailIndex(-1)}
      onSave={async (id, fields) => {
        const res = await fetch(`/api/testcase/${encodeURIComponent(id)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '更新に失敗しました');
        }
        setData((prev) => prev ? {
          ...prev,
          items: prev.items.map((r) => r.id === id ? { ...r, ...fields } : r),
        } : prev);
      }}
    />
  );

  if (embedded) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ClipboardList size={13} className="text-teal-500" />
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">システム統計</span>
            {data && (
              <span className="rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums ml-1">
                {data.total}
              </span>
            )}
            {data?.dbTitle && <span className="text-[10px] text-neutral-400">{data.dbTitle}</span>}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400 py-1">
            <Loader2 size={14} className="animate-spin" /> 読み込み中...
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-600 text-xs flex items-center gap-2">
            <AlertCircle size={13} /> {error}
          </div>
        ) : !data ? null : data.items.length === 0 ? (
          <p className="text-xs text-neutral-400">テストケースなし</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <StatsBar stats={stats!} />
              <button
                type="button"
                onClick={() => setListOpen(!listOpen)}
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium shrink-0"
              >
                {listOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                詳細
              </button>
            </div>
            {listOpen && <TestcaseTable data={data} onDetailIndex={setDetailIndex} />}
          </>
        )}
        {detailDialog}
      </div>
    );
  }

  // standalone mode (original)
  return (
    <section className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full px-5 py-3 flex items-center gap-2 hover:bg-neutral-50 transition-colors"
      >
        {open ? <ChevronDown size={15} className="text-neutral-400" /> : <ChevronRight size={15} className="text-neutral-400" />}
        <ClipboardList size={15} className="text-teal-500" />
        <h3 className="text-sm font-bold text-neutral-800">関連テストケース</h3>
        {data && (
          <span className="rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">
            {data.total}
          </span>
        )}
        {data?.dbTitle && <span className="text-[11px] text-neutral-400">{data.dbTitle}</span>}
        {data?.cmdbNo && <span className="text-[11px] text-neutral-400">CMDB {data.cmdbNo}</span>}
        {!open && !data && <span className="ml-auto text-[11px] text-neutral-400">クリックで読み込み</span>}
      </button>

      {open && (
        <div className="border-t border-neutral-200">
          {loading ? (
            <div className="p-6 flex items-center justify-center gap-2 text-sm text-neutral-500">
              <Loader2 size={16} className="animate-spin" /> 読み込み中...
            </div>
          ) : error ? (
            <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-center gap-2">
              <AlertCircle size={15} /> {error}
            </div>
          ) : !data ? null : data.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-400">
              この案件に紐づくテストケースはありません
              {data.dbTitle && <span className="block text-[11px] mt-1">参照した表: {data.dbTitle}</span>}
            </p>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-neutral-100">
                <StatsBar stats={stats!} />
              </div>
              <TestcaseTable data={data} onDetailIndex={setDetailIndex} />
            </>
          )}
        </div>
      )}
      {detailDialog}
    </section>
  );
}
