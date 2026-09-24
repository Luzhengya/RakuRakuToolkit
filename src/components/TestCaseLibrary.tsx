import { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Database, Loader2, Search, X,
} from 'lucide-react';
import {
  LONG_TEXT_FIELDS,
  type TcRow,
} from './testcaseFields';

const SYSTEM_DISPLAY_NAME: Record<string, string> = {
  wreport_admin_base: '海外調書管理システム',
};

type SystemInfo = { dbId: string; dbTitle: string; hasData: boolean };

const LIST_COLUMNS = [
  'ケース番号', 'CMDB番号', '大分類', '中分類', '小分類',
  '機能名', 'テスト内容', '正常/異常', '優先級',
] as const;

const FILTER_FIELDS = ['機能名', '大分類', '中分類', '小分類', '正常/異常', '優先級'] as const;

const PRIMARY_FIELDS = ['テスト内容', '前提条件', 'ステップ', '予期結果', '備考'] as const;
const HIGHLIGHT_FIELDS = ['優先級', '正常/異常'] as const;
const SECONDARY_FIELDS = [
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', '要件名',
  'ポイント', 'カテゴリ', '状態', 'テスト結果',
  '源', 'システム', '月次', 'バージョン',
  '関連NO', '作成者', '作成日', '更新者', '更新日',
] as const;

type SortDir = 'asc' | 'desc' | null;
type SortState = { col: string; dir: SortDir };

export default function TestCaseLibrary({ onBack }: { onBack: () => void }) {
  const [systems, setSystems] = useState<SystemInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/testcase-library/systems')
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error((b as any).error || '取得に失敗しました');
        }
        return r.json() as Promise<{ systems: SystemInfo[] }>;
      })
      .then((d) => setSystems(d.systems))
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
      .finally(() => setLoading(false));
  }, []);

  const breadcrumb = (
    <nav className="flex items-center gap-1.5 text-sm mb-4">
      <button onClick={onBack} className="text-neutral-400 hover:text-neutral-700">ホーム</button>
      <ChevronRight size={14} className="text-neutral-300" />
      {selectedSystem ? (
        <>
          <button onClick={() => setSelectedSystem(null)} className="text-neutral-400 hover:text-neutral-700">
            TestCase Library
          </button>
          <ChevronRight size={14} className="text-neutral-300" />
          <span className="text-neutral-800 font-semibold">
            {SYSTEM_DISPLAY_NAME[selectedSystem] || selectedSystem}
          </span>
        </>
      ) : (
        <span className="text-neutral-800 font-semibold">TestCase Library</span>
      )}
    </nav>
  );

  if (selectedSystem) {
    return (
      <div>
        {breadcrumb}
        <LibraryList
          system={selectedSystem}
        />
      </div>
    );
  }

  return (
    <div>
      {breadcrumb}
      <h2 className="text-xl font-bold text-neutral-900 mb-6">TestCase Library</h2>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-neutral-500">
          <Loader2 size={20} className="animate-spin" />
          読み込み中...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 flex items-center gap-2">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : !systems || systems.length === 0 ? (
        <p className="text-center py-20 text-neutral-400">
          ライブラリが見つかりません
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {systems.map((s) => (
            <button
              key={s.dbId}
              type="button"
              onClick={() => setSelectedSystem(s.dbTitle)}
              className="bg-white border border-neutral-200 rounded-xl p-5 text-left shadow-sm hover:shadow-md hover:-translate-y-1 transition-all group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <Database size={20} className="text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-neutral-900 truncate">
                    {SYSTEM_DISPLAY_NAME[s.dbTitle] || s.dbTitle}
                  </h3>
                  <p className="text-[11px] text-neutral-400 font-mono">{s.dbTitle}</p>
                </div>
              </div>
              <div className="flex items-center justify-end">
                <ChevronRight size={16} className="text-neutral-300 group-hover:text-neutral-500 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryList({ system }: { system: string }) {
  const [rows, setRows] = useState<TcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Record<string, string>>(
    Object.fromEntries(FILTER_FIELDS.map((f) => [f, '']))
  );
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortState>({ col: '', dir: null });
  const [detailIndex, setDetailIndex] = useState(-1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/testcase-library/list?system=${encodeURIComponent(system)}`)
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error((b as any).error || '取得に失敗しました');
        }
        return r.json() as Promise<{ items: TcRow[]; total: number; exists: boolean; dbTitle: string }>;
      })
      .then((d) => setRows(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [system]);

  const optionsOf = (key: string): string[] => {
    let source = rows;
    if (key === '中分類' && filters['大分類']) {
      source = source.filter((r) => (r['大分類'] || '') === filters['大分類']);
    }
    if (key === '小分類') {
      if (filters['大分類']) source = source.filter((r) => (r['大分類'] || '') === filters['大分類']);
      if (filters['中分類']) source = source.filter((r) => (r['中分類'] || '') === filters['中分類']);
    }
    return Array.from(new Set(source.map((r) => (r[key] || '').trim()).filter(Boolean))).sort() as string[];
  };

  const filtered = useMemo(() => {
    let result = rows;
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      const terms = kw.split(/\s+/);
      result = result.filter((r) => {
        const text = LIST_COLUMNS.map((c) => (r[c] || '')).join(' ').toLowerCase();
        return terms.every((t) => text.includes(t));
      });
    }
    for (const f of FILTER_FIELDS) {
      if (filters[f]) {
        result = result.filter((r) => (r[f] || '') === filters[f]);
      }
    }
    return result;
  }, [rows, keyword, filters]);

  const sorted = useMemo(() => {
    if (!sort.col || !sort.dir) return filtered;
    const arr = [...filtered];
    const dir = sort.dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const va = (a[sort.col] || '').trim();
      const vb = (b[sort.col] || '').trim();
      return dir * va.localeCompare(vb, undefined, { numeric: true });
    });
    return arr;
  }, [filtered, sort]);

  const toggleSort = (col: string) => {
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: '', dir: null };
    });
  };

  const setFilter = (field: string, value: string) =>
    setFilters((prev) => {
      const next = { ...prev, [field]: value };
      if (field === '大分類') { next['中分類'] = ''; next['小分類'] = ''; }
      if (field === '中分類') { next['小分類'] = ''; }
      return next;
    });

  const clearFilters = () => {
    setFilters(Object.fromEntries(FILTER_FIELDS.map((f) => [f, ''])));
    setKeyword('');
  };

  const hasFilter = keyword.trim() !== '' || FILTER_FIELDS.some((f) => filters[f]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 flex items-center gap-2">
        <AlertCircle size={18} />
        {error}
      </div>
    );
  }

  const th = 'px-3 py-2.5 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200 select-none';
  const td = 'px-3 py-2 text-xs text-neutral-700 border-b border-neutral-100';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-neutral-900 mb-4">
        {SYSTEM_DISPLAY_NAME[system] || system}
      </h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold text-neutral-400 mb-1">総ケース数</p>
          <p className="text-2xl font-bold text-neutral-900 tabular-nums">{sorted.length}</p>
          {sorted.length !== rows.length && (
            <p className="text-[11px] text-neutral-400 mt-0.5">/ {rows.length}</p>
          )}
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold text-neutral-400 mb-1">画面数</p>
          <p className="text-2xl font-bold text-neutral-900 tabular-nums">
            {new Set(sorted.map((r) => (r['中分類'] || '').trim()).filter(Boolean)).size}
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold text-neutral-400 mb-1">機能数</p>
          <p className="text-2xl font-bold text-neutral-900 tabular-nums">
            {new Set(sorted.map((r) => (r['機能名'] || '').trim()).filter(Boolean)).size}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-neutral-500 block mb-1">キーワード</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="検索..."
              className="w-full pl-8 pr-3 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {FILTER_FIELDS.map((f) => (
            <div key={f} className="min-w-[120px] flex-1">
              <label className="text-[11px] font-semibold text-neutral-500 block mb-1">{f}</label>
              <select
                value={filters[f]}
                onChange={(e) => setFilter(f, e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-neutral-400"
              >
                <option value="">すべて</option>
                {optionsOf(f).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {hasFilter && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 border border-neutral-200 rounded-lg hover:bg-neutral-50"
            >
              クリア
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white z-[1]">
              <tr>
                {LIST_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className={th + ' cursor-pointer hover:bg-neutral-50'}
                    onClick={() => toggleSort(col)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col}
                      {sort.col === col && sort.dir === 'asc' && <ChevronUp size={12} />}
                      {sort.col === col && sort.dir === 'desc' && <ChevronDown size={12} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={LIST_COLUMNS.length} className="px-3 py-12 text-center text-sm text-neutral-400">
                    該当するケースがありません
                  </td>
                </tr>
              ) : sorted.map((r, i) => (
                <tr
                  key={r.id}
                  className="hover:bg-neutral-50 cursor-pointer"
                  onClick={() => setDetailIndex(i)}
                >
                  {LIST_COLUMNS.map((col) => {
                    const v = r[col] || '';
                    const wide = col === 'テスト内容' || col === '機能名';
                    return (
                      <td
                        key={col}
                        className={td + (wide ? ' max-w-[280px] truncate whitespace-nowrap' : ' whitespace-nowrap')}
                        title={wide ? v : undefined}
                      >
                        {v || '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail dialog */}
      {detailIndex >= 0 && sorted[detailIndex] && (
        <LibraryDetailDialog
          rows={sorted}
          index={detailIndex}
          onIndex={setDetailIndex}
          onClose={() => setDetailIndex(-1)}
        />
      )}
    </div>
  );
}

function LibraryDetailDialog({
  rows, index, onIndex, onClose,
}: {
  rows: TcRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const row = rows[index];
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
      <button
        type="button"
        onClick={() => onIndex(index - 1)}
        disabled={index <= 0}
        title="前のケース"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-lg font-bold text-neutral-900 truncate shrink-0">
              NO.{row['ケース番号'] || '-'}
            </h3>
            {row['機能名'] && (
              <span className="text-sm text-neutral-400 truncate">{row['機能名']}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rows.length > 1 && (
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {index + 1} / {rows.length}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {PRIMARY_FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">{f}</p>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                    {row[f] || '-'}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {HIGHLIGHT_FIELDS.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                    <p className="text-lg font-bold text-neutral-900">{row[f] || '-'}</p>
                  </div>
                ))}
              </div>

              <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {SECONDARY_FIELDS.map((f) => {
                  const isLong = LONG_TEXT_FIELDS.has(f);
                  return (
                    <div key={f} className="px-3 py-2 flex items-start gap-3">
                      <p className="text-[11px] text-neutral-400 w-20 shrink-0 pt-0.5">{f}</p>
                      <p
                        className={`flex-1 text-sm text-neutral-700 min-w-0 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`}
                        title={row[f] || ''}
                      >
                        {row[f] || '-'}
                      </p>
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
        onClick={() => onIndex(index + 1)}
        disabled={index >= rows.length - 1}
        title="次のケース"
        className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
