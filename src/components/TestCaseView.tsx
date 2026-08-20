import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';

// Notion の「{システム}{年度}」テーブル 1 行 (属性名をキーにした素の文字列)
type TcRow = Record<string, string> & { id: string };

type ListResponse = {
  items: TcRow[];
  total: number;
  exists: boolean;
  dbTitle: string;
};

// 明細テーブルに出す列 (残りは詳細ダイアログで表示)
const LIST_COLUMNS = [
  'ケース番号',
  'CMDB番号',
  '大分類',
  '中分類',
  '小分類',
  '機能名',
  'テスト内容',
  'テスト結果',
  '優先級',
  'バージョン',
] as const;

// 詳細ダイアログに出す項目 (明細テーブルに無いものを中心に全項目)
const DETAIL_FIELDS = [
  'ケース番号', 'システム', '月次', 'CMDB番号',
  '大分類', '中分類', '小分類',
  '機能名', '要件名', 'テスト内容',
  '前提条件', 'ステップ', '予期結果',
  'ポイント', '優先級', 'カテゴリ', '状態', 'テスト結果',
  '作成者', '作成日', '更新者', '更新日',
  'バージョン', '関連NO', '備考',
] as const;

const RESULT_COLOR: Record<string, string> = {
  OK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NG: 'bg-red-50 text-red-700 border-red-200',
  'テスト不可': 'bg-amber-50 text-amber-700 border-amber-200',
  '未実施': 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

// 長文はダイアログで改行を保持したいので pre-wrap 対象にする項目
const LONG_TEXT_FIELDS = new Set(['前提条件', 'ステップ', '予期結果', 'テスト内容', '備考']);

export default function TestCaseView({ onBack }: { onBack: () => void }) {
  const [systems, setSystems] = useState<string[]>([]);
  const [system, setSystem] = useState('');
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [rows, setRows] = useState<TcRow[]>([]);
  const [dbTitle, setDbTitle] = useState('');
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TcRow | null>(null);

  // 絞り込み
  const [fMonth, setFMonth] = useState('');
  const [fCmdb, setFCmdb] = useState('');
  const [fVersion, setFVersion] = useState('');
  const [fMajor, setFMajor] = useState('');
  const [fMiddle, setFMiddle] = useState('');
  const [fMinor, setFMinor] = useState('');

  // システム候補 (Testcase Format と同じ、進捗管理表から取得)
  useEffect(() => {
    let alive = true;
    fetch('/api/testcase-format/systems')
      .then((res) => (res.ok ? res.json() : { systems: [] }))
      .then((d: any) => {
        if (!alive) return;
        const list = (d?.systems ?? []) as string[];
        setSystems(list);
        if (list.length > 0) setSystem((cur) => cur || list[0]);
      })
      .catch(() => { /* 取得できなければ手入力にフォールバック */ });
    return () => { alive = false; };
  }, []);

  const fetchList = () => {
    if (!system) return;
    setLoading(true);
    setError(null);
    fetch(`/api/testcase/list?system=${encodeURIComponent(system)}&year=${year}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<ListResponse>;
      })
      .then((d) => {
        setRows(d.items ?? []);
        setDbTitle(d.dbTitle ?? '');
        setExists(!!d.exists);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '取得に失敗しました');
        setRows([]);
      })
      .finally(() => setLoading(false));
  };

  // システム・年度が決まったら自動取得
  useEffect(() => {
    if (system) fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system, year]);

  // 絞り込み候補 (取得済みデータから動的に生成)
  const optionsOf = (key: string): string[] =>
    Array.from(new Set<string>(rows.map((r) => (r[key] || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filtered = useMemo(() => {
    const kw = fCmdb.trim().toLowerCase();
    return rows.filter((r) => {
      if (fMonth && (r['月次'] || '') !== fMonth) return false;
      if (fVersion && (r['バージョン'] || '') !== fVersion) return false;
      if (fMajor && (r['大分類'] || '') !== fMajor) return false;
      if (fMiddle && (r['中分類'] || '') !== fMiddle) return false;
      if (fMinor && (r['小分類'] || '') !== fMinor) return false;
      if (kw && !(r['CMDB番号'] || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [rows, fMonth, fCmdb, fVersion, fMajor, fMiddle, fMinor]);

  // 統計 (絞り込み結果に連動)
  const stats = useMemo(() => {
    const total = filtered.length;
    const by = (v: string) => filtered.filter((r) => (r['テスト結果'] || '') === v).length;
    return { total, ok: by('OK'), un: by('未実施'), block: by('テスト不可'), ng: by('NG') };
  }, [filtered]);

  const hasFilter = fMonth || fCmdb || fVersion || fMajor || fMiddle || fMinor;
  const clearFilters = () => {
    setFMonth(''); setFCmdb(''); setFVersion(''); setFMajor(''); setFMiddle(''); setFMinor('');
  };

  const selectCls =
    'rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none';
  const th0 = 'px-3 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
  const td0 = 'px-3 py-2 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';

  return (
    <div className="max-w-[96rem] mx-auto space-y-5">
      {/* パンくず */}
      <nav className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
          ホーム
        </button>
        <span className="text-neutral-400">{'>>'}</span>
        <span className="text-neutral-900 font-medium">TestCase</span>
      </nav>

      {/* タイトル + テーブル選択 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-neutral-900">TestCase</h2>
          {dbTitle && <span className="text-sm text-neutral-400">{dbTitle}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {systems.length > 0 ? (
            <select value={system} onChange={(e) => setSystem(e.target.value)} className={selectCls}>
              {systems.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="システム名"
              className={selectCls}
            />
          )}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchList}
            disabled={loading || !system}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!error && !exists && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm">
          テーブル「{dbTitle}」はまだ作成されていません。Testcase Format からテストケースを登録してください。
        </div>
      )}

      {/* 統計パネル (絞り込みに連動) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'テスト総件数', value: stats.total, cls: 'text-neutral-900' },
          { label: 'テストOK', value: stats.ok, cls: 'text-emerald-600' },
          { label: '未実施', value: stats.un, cls: 'text-neutral-500' },
          { label: 'テスト不可', value: stats.block, cls: 'text-amber-600' },
          { label: 'テストNG', value: stats.ng, cls: 'text-red-600' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-neutral-200 rounded-xl px-4 py-3">
            <p className="text-[10px] text-neutral-400 font-semibold tracking-wider truncate">{c.label}</p>
            <p className={`text-2xl font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 絞り込み */}
      <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-end gap-3 flex-wrap">
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">月次</span>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={selectCls}>
            <option value="">全月</option>
            {optionsOf('月次').map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">CMDB番号</span>
          <input
            value={fCmdb}
            onChange={(e) => setFCmdb(e.target.value)}
            placeholder="部分一致"
            className={selectCls + ' w-40'}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">バージョン</span>
          <select value={fVersion} onChange={(e) => setFVersion(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('バージョン').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">大分類</span>
          <select value={fMajor} onChange={(e) => setFMajor(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('大分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">中分類</span>
          <select value={fMiddle} onChange={(e) => setFMiddle(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('中分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">小分類</span>
          <select value={fMinor} onChange={(e) => setFMinor(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('小分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        {hasFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
          >
            条件クリア
          </button>
        )}
      </div>

      {/* 明細テーブル */}
      {loading ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 flex items-center justify-center gap-2 text-neutral-500">
          <Loader2 size={18} className="animate-spin" />
          読み込み中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400">
          {rows.length === 0 ? 'データがありません' : '条件に一致するデータがありません'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {LIST_COLUMNS.map((c) => <th key={c} className={th0}>{c}</th>)}
                <th className={th0}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  {LIST_COLUMNS.map((c) => {
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
                      <td key={c} className={td0 + (wide ? ' max-w-[280px] truncate' : '')} title={wide ? v : undefined}>
                        {v || '-'}
                      </td>
                    );
                  })}
                  <td className={td0}>
                    <button
                      type="button"
                      onClick={() => setDetail(r)}
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
      )}

      {/* 詳細ダイアログ */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 md:p-8 overflow-auto">
          <div className="w-full max-w-3xl bg-white rounded-xl border border-neutral-200 shadow-xl">
            <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 sticky top-0 bg-white rounded-t-xl">
              <h3 className="text-base font-semibold text-neutral-900">
                ケース詳細 <span className="text-neutral-400 text-sm ml-2">{detail['ケース番号']}</span>
              </h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {DETAIL_FIELDS.map((f) => {
                const v = detail[f] || '';
                const isLong = LONG_TEXT_FIELDS.has(f);
                return (
                  <div key={f} className={isLong ? 'md:col-span-2 space-y-1' : 'space-y-1'}>
                    <p className="text-[11px] font-medium text-neutral-400">{f}</p>
                    <p className={`text-sm text-neutral-700 ${isLong ? 'whitespace-pre-wrap border border-neutral-200 rounded-lg p-2 bg-neutral-50' : ''}`}>
                      {v || '-'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
