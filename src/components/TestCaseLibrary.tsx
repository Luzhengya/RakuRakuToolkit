import { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Copy, Database, Loader2, Search, X,
} from 'lucide-react';
import {
  LONG_TEXT_FIELDS,
  type TcRow,
} from './testcaseFields';
import CasePicker, { type CaseCandidate } from './CasePicker';
import LibraryFlow from './LibraryFlow';
import { LIBRARY_FLOWS } from '../data/libraryFlows';
import { caseKey, nodeKey, unassignedRows, type FlowNode } from '../utils/libraryFlow';

const SYSTEM_DISPLAY_NAME: Record<string, string> = {
  wreport_admin_base: '海外調書管理システム',
  wreport_base: '海外調書利用者システム',
  cmdb_base: 'CMDBシステム',
};

type SystemInfo = { dbId: string; dbTitle: string; hasData: boolean };

const LIST_COLUMNS = [
  'ケース番号', '大分類', '中分類', '小分類',
  '機能名', 'テスト内容', '正常/異常', '優先級',
] as const;

const FILTER_FIELDS = ['機能名', '大分類', '中分類', '小分類', '正常/異常', '優先級'] as const;

// 詳細ダイアログ：テスト内容の直下に分類、優先級/正常異常の直下に機能名/カテゴリを置く
const PRIMARY_FIELDS = ['前提条件', 'ステップ', '予期結果', '備考'] as const;
const CATEGORY_FIELDS = ['大分類', '中分類', '小分類'] as const;
const HIGHLIGHT_FIELDS = ['優先級', '正常/異常'] as const;
const SUB_HIGHLIGHT_FIELDS = ['機能名', 'カテゴリ'] as const;
const SECONDARY_FIELDS = [
  'バージョン', '関連NO', '作成者', '作成日', '更新者', '更新日', 'システム', '源',
  'CMDB番号', '要件名', 'ポイント', '状態', 'テスト結果', '月次',
] as const;

// コピー API の1回あたりの件数 (api の LIBRARY_COPY_BATCH_MAX と合わせる)
const COPY_BATCH_SIZE = 30;

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

  // 各項目で複数の値を選べる (空配列＝すべて)。影響範囲が複数の画面・機能にまたがるため
  const [filters, setFilters] = useState<Record<string, string[]>>(
    Object.fromEntries(FILTER_FIELDS.map((f) => [f, []]))
  );
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortState>({ col: '', dir: null });
  const [detailIndex, setDetailIndex] = useState(-1);
  // TestCase へコピーするケース (ページID)。絞り込みを変えても選択は残す
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyOpen, setCopyOpen] = useState(false);
  // フロー表示 (画面遷移図のあるシステムのみ)。絞り込み・選択は一覧表示と共有する
  const flowTabs = LIBRARY_FLOWS[system];
  const [mode, setMode] = useState<'list' | 'flow'>('list');
  const [flowTab, setFlowTab] = useState(0);
  const [flowNode, setFlowNode] = useState<FlowNode | 'unassigned' | null>(null);

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

  const matches = (r: TcRow, f: string) => filters[f].length === 0 || filters[f].includes(r[f] || '');

  const optionsOf = (key: string): string[] => {
    let source = rows;
    if (key === '中分類') source = source.filter((r) => matches(r, '大分類'));
    if (key === '小分類') source = source.filter((r) => matches(r, '大分類') && matches(r, '中分類'));
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
      if (filters[f].length) result = result.filter((r) => matches(r, f));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const unassigned = useMemo(() => (flowTabs ? unassignedRows(sorted, flowTabs) : []), [sorted, flowTabs]);

  // 表に出す行：フロー表示では選んだノードのケースだけ
  const visible = useMemo(() => {
    if (mode !== 'flow') return sorted;
    if (flowNode === 'unassigned') return unassigned;
    if (!flowNode) return [];
    const k = nodeKey(flowNode.dai, flowNode.chu);
    return sorted.filter((r) => caseKey(r) === k);
  }, [mode, sorted, flowNode, unassigned]);

  const selectFlowNode = (n: FlowNode | 'unassigned') => {
    setFlowNode(n);
    setDetailIndex(-1);
  };

  const toggleSort = (col: string) => {
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: '', dir: null };
    });
  };

  const setFilter = (field: string, values: string[]) =>
    setFilters((prev) => {
      const next = { ...prev, [field]: values };
      // 上位の分類を変えたら、候補から外れた下位の選択だけ外す
      const keep = (key: string, src: TcRow[]) => {
        const avail = new Set(src.map((r) => r[key] || ''));
        next[key] = next[key].filter((v) => avail.has(v));
      };
      const m = (r: TcRow, f: string) => next[f].length === 0 || next[f].includes(r[f] || '');
      if (field === '大分類') {
        keep('中分類', rows.filter((r) => m(r, '大分類')));
        keep('小分類', rows.filter((r) => m(r, '大分類') && m(r, '中分類')));
      }
      if (field === '中分類') keep('小分類', rows.filter((r) => m(r, '大分類') && m(r, '中分類')));
      return next;
    });

  const clearFilters = () => {
    setFilters(Object.fromEntries(FILTER_FIELDS.map((f) => [f, []])));
    setKeyword('');
  };

  const hasFilter = keyword.trim() !== '' || FILTER_FIELDS.some((f) => filters[f].length > 0);

  const toggleRow = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  // 見出しのチェック：表示中の行を全選択／解除 (表示外の選択は残す)
  const toggleAllFiltered = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allFilteredSelected) visible.forEach((r) => next.delete(r.id));
    else visible.forEach((r) => next.add(r.id));
    return next;
  });
  // コピーは画面の並び順 (絞り込み外の選択はライブラリの並び順) で送る
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

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
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-neutral-900">
          {SYSTEM_DISPLAY_NAME[system] || system}
        </h2>
        {flowTabs && (
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
            {(['list', 'flow'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setDetailIndex(-1); }}
                className={`px-3 py-1 rounded-md ${mode === m ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
              >
                {m === 'list' ? '一覧' : 'フロー'}
              </button>
            ))}
          </div>
        )}
      </div>

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
              <MultiSelect options={optionsOf(f)} value={filters[f]} onChange={(v) => setFilter(f, v)} />
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

      {/* フロー表示 */}
      {mode === 'flow' && flowTabs && (
        <>
          <LibraryFlow
            tabs={flowTabs}
            tabIndex={flowTab}
            onTab={(i) => { setFlowTab(i); setFlowNode(null); setDetailIndex(-1); }}
            rows={sorted}
            selectedId={flowNode && flowNode !== 'unassigned' ? flowNode.id : null}
            onSelect={selectFlowNode}
          />
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="text-neutral-600">
              {flowNode === 'unassigned'
                ? '未割当ケース（どのノードにも該当しない 大分類×中分類）'
                : flowNode
                  ? <>選択中のノード：<b className="text-neutral-900">{flowNode.shared ? '［共通］' : `${flowNode.dai} / `}{flowNode.chu}</b></>
                  : 'ノードを選択してください'}
            </span>
            {unassigned.length > 0 && (
              <button
                type="button"
                onClick={() => selectFlowNode('unassigned')}
                className="ml-auto px-3 py-1 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100"
              >
                未割当ケース {unassigned.length} 件
              </button>
            )}
          </div>
        </>
      )}

      {/* 選択中のケース */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-neutral-600">
          選択中 <b className="tabular-nums text-neutral-900">{selected.size}</b> 件
        </span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-neutral-500 hover:text-neutral-800"
          >
            選択をクリア
          </button>
        )}
        <button
          type="button"
          onClick={() => setCopyOpen(true)}
          disabled={selected.size === 0}
          title={selected.size === 0 ? 'コピーするケースにチェックを付けてください' : ''}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
        >
          <Copy size={14} />
          TestCaseへコピー
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white z-[1]">
              <tr>
                <th className={th + ' w-8'}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    disabled={visible.length === 0}
                    title="表示中のケースを全選択／解除"
                  />
                </th>
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
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={LIST_COLUMNS.length + 1} className="px-3 py-12 text-center text-sm text-neutral-400">
                    {mode === 'flow'
                      ? (flowNode ? '関連ケースなし' : 'フロー図のノードをクリックすると、関連するケースを表示します')
                      : '該当するケースがありません'}
                  </td>
                </tr>
              ) : visible.map((r, i) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer ${selected.has(r.id) ? 'bg-emerald-50/60 hover:bg-emerald-50' : 'hover:bg-neutral-50'}`}
                  onClick={() => setDetailIndex(i)}
                >
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                  </td>
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

      {copyOpen && (
        <CopyToTestcaseDialog
          rows={selectedRows}
          onClose={() => setCopyOpen(false)}
          onDone={() => setSelected(new Set())}
        />
      )}

      {/* Detail dialog */}
      {detailIndex >= 0 && visible[detailIndex] && (
        <LibraryDetailDialog
          rows={visible}
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
              <div className="space-y-1">
                <p className="text-xs font-bold text-neutral-700">テスト内容</p>
                <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                  {row['テスト内容'] || '-'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {CATEGORY_FIELDS.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg px-3 py-2 space-y-0.5 min-w-0">
                    <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                    <p className="text-sm text-neutral-800 break-words">{row[f] || '-'}</p>
                  </div>
                ))}
              </div>
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
                {SUB_HIGHLIGHT_FIELDS.map((f) => (
                  <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5 min-w-0">
                    <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                    <p className="text-sm font-semibold text-neutral-900 break-words">{row[f] || '-'}</p>
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

// 複数選択のドロップダウン (空＝すべて)
function MultiSelect({ options, value, onChange }: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  const label = value.length === 0 ? 'すべて' : value.length === 1 ? value[0] : `${value.length}件選択`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white text-left focus:outline-none focus:ring-1 focus:ring-neutral-400"
      >
        <span className={`truncate ${value.length ? 'text-neutral-900' : 'text-neutral-500'}`} title={value.join(', ')}>{label}</span>
        <ChevronDown size={14} className="text-neutral-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[200px] max-h-64 overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-lg py-1">
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50">
              選択を解除（すべて）
            </button>
          )}
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-neutral-400">候補なし</p>
          ) : options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 cursor-pointer">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
              <span className="truncate" title={o}>{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// 選択したケースを案件の TestCase へコピーする。
// API の実行時間内に収めるため COPY_BATCH_SIZE 件ずつ順に送る。
// 途中で失敗しても、再実行するとコピー済み (同じ CMDB番号・関連NO) はスキップされる。
function CopyToTestcaseDialog({ rows, onClose, onDone }: {
  rows: TcRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<CaseCandidate | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, created: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; dbTitle: string } | null>(null);

  const initialSystem = (rows[0]?.['システム'] || '').trim();

  const run = async () => {
    if (!target) return;
    setRunning(true);
    setError(null);
    setResult(null);
    let created = 0, skipped = 0, done = 0, dbTitle = '';
    setProgress({ done, created, skipped });
    try {
      for (let i = 0; i < rows.length; i += COPY_BATCH_SIZE) {
        const batch = rows.slice(i, i + COPY_BATCH_SIZE);
        const res = await fetch('/api/testcase/copy-from-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: target.id, rows: batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error || 'コピーに失敗しました');
        const r = body as { created: number; skipped: number; dbTitle: string };
        created += r.created; skipped += r.skipped; done += batch.length; dbTitle = r.dbTitle;
        setProgress({ done, created, skipped });
      }
      setResult({ created, skipped, dbTitle });
      onDone();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'コピーに失敗しました'}（${done}/${rows.length} 件まで処理済み。もう一度実行すると、コピー済みのケースはスキップされます）`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border border-neutral-200 shadow-xl">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900">TestCaseへコピー（{rows.length}件）</h3>
          <button type="button" onClick={onClose} disabled={running} className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-bold text-neutral-700">コピー先の案件 <span className="text-red-500">*</span></p>
            <CasePicker value={target?.id ?? ''} onChange={setTarget} initialSystem={initialSystem} />
          </div>
          <p className="text-[11px] text-neutral-500">
            ケース番号は「CMDB番号-連番」で採番し、関連NO にライブラリのケース番号を入れます。テスト結果は空で登録します。
            同じ案件にコピー済みのケースはスキップします。
          </p>

          {(running || progress.done > 0) && !result && (
            <div className="space-y-1">
              <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((progress.done / rows.length) * 100)}%` }} />
              </div>
              <p className="text-xs text-neutral-500 tabular-nums">
                コピー中 {progress.done}/{rows.length}（登録 {progress.created}・スキップ {progress.skipped}）
              </p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</p>
          )}
          {result && (
            <p className="text-sm text-emerald-700 flex items-start gap-1.5">
              <Check size={15} className="mt-0.5 shrink-0" />
              <span>
                {result.dbTitle} に {result.created} 件コピーしました。
                {result.skipped > 0 && `既にコピー済みの ${result.skipped} 件はスキップしました。`}
              </span>
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-neutral-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={running} className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">
            {result ? '閉じる' : 'キャンセル'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={run}
              disabled={running || !target || !target.cmdbNo}
              title={!target ? 'コピー先の案件を選択してください' : !target.cmdbNo ? '案件名の先頭に CMDB番号 がありません' : ''}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
              {error ? '再実行' : 'コピー'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
