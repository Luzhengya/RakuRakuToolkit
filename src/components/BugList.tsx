import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Download, Loader2, Pencil, Plus, Search, Trash2, X, ChevronRight as ChevronSep } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';
import { buildBugListHtml, inlineChildImages } from './bugListPdf';
import BugEditDialog, { type BugSavedResult } from './BugEditDialog';

type BugListProps = {
  lang: Lang;
  onHome: () => void;
  onBack: () => void;
  initialMonth?: string;
};

type BugItem = {
  id: string;
  no: string;
  system: string;
  module: string;
  priority: string;
  testCaseName: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  assignee: string;
  month: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  remarks: string;
  caseNumber: string;
  browserVersion: string;
  appVersion: string;
};

const JUDGMENT_COLOR: Record<string, string> = {
  '確認OK': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'NG': 'bg-red-50 text-red-700 border-red-200',
  'NG確認要': 'bg-orange-50 text-orange-700 border-orange-200',
  '想定以外NG': 'bg-purple-50 text-purple-700 border-purple-200',
};

const STATUS_COLOR: Record<string, string> = {
  '対応待ち': 'bg-neutral-100 text-neutral-600 border-neutral-200',
  '対応中': 'bg-blue-50 text-blue-700 border-blue-200',
  '確認中': 'bg-amber-50 text-amber-700 border-amber-200',
  '対応不要': 'bg-neutral-50 text-neutral-500 border-neutral-200',
  '対応完了': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// 手を打ち終わった状態。集計ではまとめて「完了」に数える。
// 対応不要 は「NG を挙げたが作業者と確認した結果、当初からその設計だった」
// という結論が出た状態で、放置されている案件ではない。
const CLOSED_STATUS = new Set(['対応完了', '対応不要']);

const PRIORITY_COLOR: Record<string, string> = {
  '高': 'bg-red-50 text-red-700 border-red-200',
  '中': 'bg-amber-50 text-amber-700 border-amber-200',
  '低': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function badge(value: string, palette: Record<string, string>): string {
  return palette[value] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

function toMonthKey(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const fullPattern = text.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (fullPattern) return `${fullPattern[1]}${String(Number(fullPattern[2])).padStart(2, '0')}`;
  const compactPattern = text.match(/^(\d{4})(\d{2})$/);
  if (compactPattern) return `${compactPattern[1]}${compactPattern[2]}`;
  return text;
}

function noNumber(no: string): number {
  const m = no.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function fmtDate(value: string): string {
  return value ? value.slice(0, 10) : '-';
}

const SUMMARY_CARDS = [
  { key: 'total', accent: 'border-l-neutral-400', numColor: 'text-neutral-900' },
  { key: 'ng', accent: 'border-l-red-500', numColor: 'text-red-600' },
  { key: 'incomplete', accent: 'border-l-amber-500', numColor: 'text-amber-600' },
  { key: 'done', accent: 'border-l-emerald-500', numColor: 'text-emerald-600' },
] as const;

// Replace Notion-hosted (S3) <img> URLs in the child HTML fragments with base64
// data URIs, so the exported report keeps showing images after Notion's ~1h
// pre-signed URLs expire. Mutates childMap in place. Each image is fetched via a
// dedicated request (one image per response) and deduped across all fragments.
export default function BugList({ lang, onHome, onBack, initialMonth = '' }: BugListProps) {
  const L =
    false
      ? {
          home: '首页', testCenter: 'TestCenter', title: 'BUG一览',
          keyword: '关键字', keywordPh: 'NO / 测试案件名 / BUG概要',
          system: '系统区分', year: '年份', month: '月份', judgment: '判定', status: '状态', wholeYear: '通年',
          all: '全部', clear: '清除条件', search: '检索', result: '检索结果', count: '件', exportHtml: '导出 HTML',
          sumTotal: '合计件数', sumNg: 'NG件数', sumIncomplete: '未完成', sumDone: '已完成',
          colNo: 'NO', colSystem: '系统区分', colCase: '测试案件名', colDesc: 'BUG概要',
          colJudg: '判定', colStatus: '状态', colPriority: '优先度', colDate: '测试时间', colAssignee: '测试担当者', colMonth: '月份',
          noData: '暂无符合条件的数据。', loading: '加载中...',
          dReproSteps: '再现手顺', dExpected: '预定结果', dActual: '实际结果', dRemarks: '备注',
          dCase: '测试案件名', dDesc: 'BUG概要', dChild: '子页面内容', dChildEmpty: '无子页面内容',
          close: '关闭', caseNo: '案例编号',
          filterLabel: '筛选条件',
        }
      : {
          home: 'ホーム', testCenter: 'TestCenter', title: 'BUG一覧',
          keyword: 'キーワード', keywordPh: 'NO / テスト案件名 / BUG説明',
          system: 'システム', year: '年度', month: '月次', judgment: '判定', status: 'ステータス', wholeYear: '通年',
          all: 'すべて', clear: '条件クリア', search: '検索', result: '検索結果', count: '件', exportHtml: 'HTML出力',
          sumTotal: '合計件数', sumNg: 'NG件数', sumIncomplete: '未完了', sumDone: '完了',
          colNo: 'NO', colSystem: 'システム', colCase: 'テスト案件名', colDesc: 'BUG説明',
          colJudg: '判定', colStatus: 'ステータス', colPriority: '優先度', colDate: '実施日', colAssignee: '担当者', colMonth: '月次',
          noData: '条件に一致するデータがありません。', loading: '読み込み中...',
          dReproSteps: '再現ステップ', dExpected: '予定結果', dActual: '実際結果', dRemarks: '備考欄',
          dCase: 'テスト案件名', dDesc: 'BUG説明', dChild: '子ページ内容', dChildEmpty: '子ページの内容はありません',
          close: '閉じる', caseNo: 'ケース番号',
          filterLabel: '絞り込み',
        };

  const [allItems, setAllItems] = useState<BugItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [system, setSystem] = useState('');
  // 月次は年度と月に分ける。月を選ばなければその年度の通年
  const [year, setYear] = useState(() => (/^\d{4}/.test(initialMonth) ? initialMonth.slice(0, 4) : ''));
  const [monthNo, setMonthNo] = useState(() =>
    /^\d{6}$/.test(initialMonth) ? String(Number(initialMonth.slice(4, 6))) : ''
  );
  const [judgments, setJudgments] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [childHtml, setChildHtml] = useState<string>('');
  const [childLoading, setChildLoading] = useState(false);

  // 新規作成・編集・削除
  const [editing, setEditing] = useState<BugItem | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 新規作成した BUG。絞り込みの並びに関係なく先頭に出して強調する
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/test-center/bugs');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        if (!aborted) setAllItems(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const systemOptions = useMemo(
    () => Array.from(new Set<string>(allItems.map((b) => b.system).filter(Boolean))).sort(),
    [allItems]
  );
  const judgmentOptions = useMemo(
    () => Array.from(new Set<string>(allItems.map((b) => b.judgment).filter(Boolean))).sort(),
    [allItems]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set<string>(allItems.map((b) => b.status).filter(Boolean))).sort(),
    [allItems]
  );
  // 年度はデータにあるものだけ。新しい年が上
  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set<string>(allItems.map((b) => toMonthKey(b.month).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))
      ).sort().reverse(),
    [allItems]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allItems
      .filter((b) => {
        if (system && b.system !== system) return false;
        if (year || monthNo) {
          const key = toMonthKey(b.month);
          if (year && key.slice(0, 4) !== year) return false;
          if (monthNo && Number(key.slice(4, 6)) !== Number(monthNo)) return false;
        }
        if (judgments.length && !judgments.includes(b.judgment)) return false;
        if (status && b.status !== status) return false;
        if (kw) {
          const hay = `${b.no} ${b.testCaseName} ${b.bugDesc}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.id === pinnedId || b.id === pinnedId) return a.id === pinnedId ? -1 : 1;
        return a.month === b.month ? noNumber(a.no) - noNumber(b.no) : b.month.localeCompare(a.month);
      });
  }, [allItems, keyword, system, year, monthNo, judgments, status, pinnedId]);

  const handleClear = () => {
    setKeyword('');
    setSystem('');
    setYear('');
    setMonthNo('');
    setJudgments([]);
    setStatus('');
  };

  const hasFilter = keyword || system || year || monthNo || judgments.length > 0 || status;

  // HTML出力のヘッダに出す対象期間。年だけなら「2026年」、月まで選べば YYYYMM
  const periodText = year
    ? (monthNo ? `${year}${String(Number(monthNo)).padStart(2, '0')}` : `${year}年`)
    : (monthNo ? `${Number(monthNo)}月` : '');

  const [exporting, setExporting] = useState(false);

  const handleExportHtml = async () => {
    setExporting(true);
    try {
      const childMap: Record<string, string> = {};
      const batchSize = 5;
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (bug) => {
            const res = await fetch(`/api/test-center/bugs/${encodeURIComponent(bug.id)}/children`);
            if (res.ok) {
              const data = await res.json();
              return { id: bug.id, html: typeof data.html === 'string' ? data.html : '' };
            }
            return { id: bug.id, html: '' };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') childMap[r.value.id] = r.value.html;
        }
      }

      // Inline Notion-hosted images as base64 so the exported HTML stays
      // viewable after Notion's ~1h S3 URLs expire. One request per image
      // (deduped) keeps each response under Vercel's 4.5MB body limit.
      await inlineChildImages(childMap);

      const html = buildBugListHtml(filtered, { keyword, system, month: periodText, judgments, status }, lang, childMap);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      a.download = `BUG_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const summary = useMemo(() => {
    const total = filtered.length;
    const ng = filtered.filter((b) => b.judgment === 'NG').length;
    const incomplete = filtered.filter((b) => b.status && !CLOSED_STATUS.has(b.status)).length;
    const done = filtered.filter((b) => CLOSED_STATUS.has(b.status)).length;
    return { total, ng, incomplete, done };
  }, [filtered]);

  const toggleRow = async (bug: BugItem) => {
    if (openId === bug.id) {
      setOpenId(null);
      return;
    }
    openRow(bug);
  };

  const openRow = async (bug: BugItem) => {
    setOpenId(bug.id);
    setChildHtml('');
    setChildLoading(true);
    try {
      const res = await fetch(`/api/test-center/bugs/${encodeURIComponent(bug.id)}/children`);
      if (res.ok) {
        const data = await res.json();
        setChildHtml(typeof data.html === 'string' ? data.html : '');
      }
    } catch {
      // silent
    } finally {
      setChildLoading(false);
    }
  };

  // 保存後は一覧を読み直さず、その行だけ差し替える
  const handleSaved = async (r: BugSavedResult) => {
    setEditing(null);
    setNotice(r.notice || null);
    if (!r.isNew) {
      setAllItems((prev) => prev.map((b) => (b.id === r.bugId ? { ...b, ...r.fields } : b)));
      return;
    }
    // システム・月次は案件の rollup なので、作成後の1件を取り直して一覧に足す
    try {
      const res = await fetch(`/api/test-center/bugs/single/${encodeURIComponent(r.bugId)}`);
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: BugItem };
      setAllItems((prev) => [item, ...prev.filter((b) => b.id !== item.id)]);
      setPinnedId(item.id);
      openRow(item);
    } catch {
      setNotice(`${r.notice ? `${r.notice}\n` : ''}BUG は登録しましたが、一覧への反映に失敗しました。ページを再読み込みしてください。`);
    }
  };

  const handleDelete = async (bug: BugItem) => {
    const linked = bug.caseNumber.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
    const msg = `No.${bug.no || '-'} を削除します。よろしいですか？`
      + (linked.length ? `\n関連テストケース: ${linked.join(', ')}（テスト結果は NG のまま）` : '');
    if (!window.confirm(msg)) return;
    setDeletingId(bug.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/test-center/bugs/${encodeURIComponent(bug.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || '削除に失敗しました');
      }
      setAllItems((prev) => prev.filter((b) => b.id !== bug.id));
      if (openId === bug.id) setOpenId(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setDeletingId(null);
    }
  };

  const summaryLabels = { total: L.sumTotal, ng: L.sumNg, incomplete: L.sumIncomplete, done: L.sumDone };
  const summaryValues = { total: summary.total, ng: summary.ng, incomplete: summary.incomplete, done: summary.done };

  const breadcrumb = (
    <nav className="flex items-center gap-1.5 text-sm">
      <button type="button" onClick={onHome} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
        {L.home}
      </button>
      <ChevronSep size={14} className="text-neutral-300 shrink-0" />
      <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
        {L.testCenter}
      </button>
      <ChevronSep size={14} className="text-neutral-300 shrink-0" />
      <span className="text-neutral-900 font-medium">{L.title}</span>
    </nav>
  );

  const selectCls =
    'appearance-none bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none hover:border-neutral-400 transition-colors';

  return (
    <>
      <div className="space-y-6">
        {breadcrumb}

        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold text-neutral-900">{L.title}</h2>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing('new')}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={15} />
            新規
          </button>
          <button
            type="button"
            onClick={handleExportHtml}
            disabled={filtered.length === 0 || exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {L.exportHtml}
          </button>
          </div>
        </div>

        {notice && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-amber-600 hover:text-amber-800"><X size={14} /></button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SUMMARY_CARDS.map((card) => (
            <div
              key={card.key}
              className={`bg-neutral-50 rounded-xl px-4 py-3.5 border-l-[3px] ${card.accent}`}
            >
              <div className="text-xs text-neutral-500 mb-1">{summaryLabels[card.key]}</div>
              <div className={`text-3xl font-bold tabular-nums tracking-tight ${card.numColor}`}>
                {summaryValues[card.key]}
              </div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm">
          <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">{L.filterLabel}</span>
            {hasFilter && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                <X size={13} />
                {L.clear}
              </button>
            )}
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-3 items-end">
              {/* Keyword */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-500">{L.keyword}</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder={L.keywordPh}
                    className="w-full rounded-lg border border-neutral-300 pl-9 pr-3 py-2 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none hover:border-neutral-400 transition-colors"
                  />
                </div>
              </div>
              {/* System */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-500">{L.system}</label>
                <select value={system} onChange={(e) => setSystem(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {systemOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* 年度 (TestCase 画面と同じく年と月を分ける) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-500">{L.year}</label>
                <select value={year} onChange={(e) => setYear(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
              </div>
              {/* 月次。未選択なら通年 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-500">{L.month}</label>
                <select value={monthNo} onChange={(e) => setMonthNo(e.target.value)} className={selectCls}>
                  <option value="">{L.wholeYear}</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>{m}月</option>
                  ))}
                </select>
              </div>
              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-500">{L.status}</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Judgment toggles */}
            {judgmentOptions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-neutral-100">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-neutral-500 shrink-0">{L.judgment}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {judgmentOptions.map((j) => {
                      const on = judgments.includes(j);
                      return (
                        <button
                          key={j}
                          type="button"
                          onClick={() =>
                            setJudgments((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]))
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:border-neutral-300'
                          }`}
                        >
                          {j}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Results */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-neutral-500">{L.result}</span>
            <span className="text-sm font-bold text-neutral-900 tabular-nums">{filtered.length}</span>
            <span className="text-sm text-neutral-500">{L.count}</span>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <p className="px-5 py-12 text-center text-sm text-neutral-400 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                {L.loading}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-neutral-400">{L.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  {/* Column header */}
                  <div
                    className="grid bg-neutral-50/80 border-b border-neutral-200 text-xs font-medium text-neutral-500"
                    style={{ gridTemplateColumns: GRID_COLS }}
                  >
                    <div className="px-3 py-2.5">{L.colNo}</div>
                    <div className="px-3 py-2.5">{L.colSystem}</div>
                    <div className="px-3 py-2.5">{L.colDesc}</div>
                    <div className="px-3 py-2.5">{L.colJudg}</div>
                    <div className="px-3 py-2.5">{L.colStatus}</div>
                    <div className="px-3 py-2.5">{L.colPriority}</div>
                    <div className="px-3 py-2.5">{L.colAssignee}</div>
                    <div />
                  </div>

                  {filtered.map((bug) => {
                    const isOpen = openId === bug.id;
                    return (
                      <div key={bug.id} className="border-b border-neutral-100 last:border-b-0">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleRow(bug)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleRow(bug);
                            }
                          }}
                          className={`grid items-center cursor-pointer transition-colors ${
                            bug.id === pinnedId ? 'bg-amber-50 hover:bg-amber-50/80'
                              : isOpen ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/60'
                          }`}
                          style={{ gridTemplateColumns: GRID_COLS }}
                        >
                          <div className="px-3 py-3 text-xs font-semibold text-blue-600 tabular-nums">{bug.no || '-'}</div>
                          <div className="px-3 py-3 text-xs text-neutral-500 truncate" title={bug.system}>{bug.system || '-'}</div>
                          <div className="px-3 py-3 text-sm text-neutral-800 truncate" title={bug.bugDesc}>{bug.bugDesc || '-'}</div>
                          <div className="px-3 py-3">
                            {bug.judgment ? (
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge(bug.judgment, JUDGMENT_COLOR)}`}>
                                {bug.judgment}
                              </span>
                            ) : '-'}
                          </div>
                          <div className="px-3 py-3">
                            {bug.status ? (
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge(bug.status, STATUS_COLOR)}`}>
                                {bug.status}
                              </span>
                            ) : '-'}
                          </div>
                          <div className="px-3 py-3">
                            {bug.priority ? (
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge(bug.priority, PRIORITY_COLOR)}`}>
                                {bug.priority}
                              </span>
                            ) : '-'}
                          </div>
                          <div className="px-3 py-3 text-xs text-neutral-600 truncate" title={bug.assignee}>{bug.assignee || '-'}</div>
                          <div className="flex items-center justify-center text-neutral-400">
                            <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                        </div>

                        {isOpen && (
                          <div className="bg-neutral-50/60 border-t border-neutral-100">
                            <div className="px-5 pt-3 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditing(bug)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-700 hover:bg-neutral-50"
                              >
                                <Pencil size={12} />
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(bug)}
                                disabled={deletingId === bug.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {deletingId === bug.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                削除
                              </button>
                            </div>
                            {/* Bug core info */}
                            <div className="px-5 py-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Field label={L.dCase} value={bug.testCaseName} />
                                <Field label={L.colSystem} value={bug.system} />
                              </div>
                              <Field label={L.dDesc} value={bug.bugDesc} block />
                            </div>

                            {/* Repro / Expected / Actual — grouped as comparison */}
                            <div className="mx-5 mb-4 border border-neutral-200 rounded-lg bg-white overflow-hidden">
                              <div className="px-4 py-3 border-b border-neutral-100">
                                <Field label={L.dReproSteps} value={bug.reproSteps} block pre />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-100">
                                <div className="px-4 py-3">
                                  <Field label={L.dExpected} value={bug.expectedResult} block />
                                </div>
                                <div className="px-4 py-3">
                                  <Field label={L.dActual} value={bug.actualResult} block />
                                </div>
                              </div>
                            </div>

                            {/* Metadata row */}
                            <div className="px-5 pb-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Field label={L.colDate} value={fmtDate(bug.execDate)} />
                                <Field label={L.colAssignee} value={bug.assignee} />
                                <Field label={L.colMonth} value={bug.month} />
                                {bug.caseNumber && <Field label={L.caseNo} value={bug.caseNumber} />}
                              </div>
                            </div>

                            {/* Remarks */}
                            {bug.remarks && (
                              <div className="px-5 pb-4">
                                <Field label={L.dRemarks} value={bug.remarks} block />
                              </div>
                            )}

                            {/* Child page content */}
                            <div className="mx-5 mb-4 pt-3 border-t border-neutral-200 space-y-1.5">
                              <p className="text-xs font-medium text-neutral-400">{L.dChild}</p>
                              {childLoading ? (
                                <p className="text-sm text-neutral-400 flex items-center gap-2">
                                  <Loader2 size={14} className="animate-spin" />
                                  {L.loading}
                                </p>
                              ) : childHtml.trim() ? (
                                <div
                                  className="notion-content text-sm text-neutral-700 border border-neutral-200 rounded-lg p-3 bg-white [&_img]:max-w-full [&_img]:max-h-[400px] [&_img]:rounded-lg [&_img]:object-contain [&_img]:my-2"
                                  dangerouslySetInnerHTML={{ __html: childHtml }}
                                />
                              ) : (
                                <p className="text-sm text-neutral-400">{L.dChildEmpty}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-neutral-200">{breadcrumb}</div>
      </div>
      {editing && (
        <BugEditDialog
          bug={editing === 'new' ? undefined : editing}
          initialSystem={system}
          initialMonthKey={year && monthNo ? `${year}${String(Number(monthNo)).padStart(2, '0')}` : ''}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

const GRID_COLS = '56px 88px minmax(0,1fr) 96px 96px 72px 88px 32px';

function Field({ label, value, block, pre }: { label: string; value: string; block?: boolean; pre?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <p className={`text-sm text-neutral-700 ${block ? '' : 'break-all'} ${pre ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap'}`}>
        {value || '-'}
      </p>
    </div>
  );
}
