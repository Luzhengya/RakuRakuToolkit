import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, ClipboardList, Loader2 } from 'lucide-react';
import TestcaseDetailDialog from './TestcaseDetailDialog';
import { RESULT_COLOR, type TcRow } from './testcaseFields';

type Response = {
  items: TcRow[];
  total: number;
  exists: boolean;
  dbTitle: string;
  cmdbNo: string;
  projectName: string;
};

const COLUMNS = ['ケース番号', '機能名', 'テスト内容', 'テスト結果', '優先級'] as const;

export default function CaseTestcases({ caseId }: { caseId: string }) {
  // 既定は閉じておく。1案件で数十〜百件あるため、開いたときだけ取得する
  const [open, setOpen] = useState(false);
  // 詳細ダイアログで表示している行の位置。-1 は非表示
  const [detailIndex, setDetailIndex] = useState(-1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || data || loading) return;
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

  const stats = data
    ? {
        total: data.items.length,
        ok: data.items.filter((r) => r['テスト結果'] === 'OK').length,
        ng: data.items.filter((r) => r['テスト結果'] === 'NG').length,
        block: data.items.filter((r) => r['テスト結果'] === 'テスト不可').length,
        un: data.items.filter((r) => r['テスト結果'] === '未実施').length,
      }
    : null;

  const th0 = 'px-3 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
  const td0 = 'px-3 py-2 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';

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
        {/* 参照した表名を出す。データが有るはずなのに空の時、表名違いだと一目で分かる */}
        {data?.dbTitle && (
          <span className="text-[11px] text-neutral-400">{data.dbTitle}</span>
        )}
        {data?.cmdbNo && (
          <span className="text-[11px] text-neutral-400">CMDB {data.cmdbNo}</span>
        )}
        {!open && !data && (
          <span className="ml-auto text-[11px] text-neutral-400">クリックで読み込み</span>
        )}
      </button>

      {open && (
        <div className="border-t border-neutral-200">
          {loading ? (
            <div className="p-6 flex items-center justify-center gap-2 text-sm text-neutral-500">
              <Loader2 size={16} className="animate-spin" />
              読み込み中...
            </div>
          ) : error ? (
            <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-center gap-2">
              <AlertCircle size={15} />
              {error}
            </div>
          ) : !data ? null : data.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-400">
              この案件に紐づくテストケースはありません
              {data.dbTitle && <span className="block text-[11px] mt-1">参照した表: {data.dbTitle}</span>}
            </p>
          ) : (
            <>
              <div className="px-5 py-3 flex items-center gap-4 flex-wrap text-xs border-b border-neutral-100">
                <span className="text-neutral-500">総件数 <b className="tabular-nums text-neutral-900">{stats!.total}</b></span>
                <span className="text-emerald-600">OK <b className="tabular-nums">{stats!.ok}</b></span>
                <span className="text-red-600">NG <b className="tabular-nums">{stats!.ng}</b></span>
                <span className="text-amber-600">テスト不可 <b className="tabular-nums">{stats!.block}</b></span>
                <span className="text-neutral-500">未実施 <b className="tabular-nums">{stats!.un}</b></span>
              </div>
              <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white">
                    <tr>{COLUMNS.map((c) => <th key={c} className={th0}>{c}</th>)}<th className={th0}></th></tr>
                  </thead>
                  <tbody>
                    {data.items.map((r, i) => (
                      <tr key={r.id} className="hover:bg-neutral-50">
                        {COLUMNS.map((c) => {
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
                        <td className={td0}>
                          <button
                            type="button"
                            onClick={() => setDetailIndex(i)}
                            className="px-2 py-1 rounded border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-100"
                          >
                            詳細
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* 内容を見るだけのダイアログ。編集・削除・BUG移管 は置かない
          (それらは TestCase 画面から行う)。前後送りは残す */}
      {detailIndex >= 0 && data && (
        <TestcaseDetailDialog
          rows={data.items}
          index={detailIndex}
          onIndex={setDetailIndex}
          onClose={() => setDetailIndex(-1)}
        />
      )}
    </section>
  );
}
