import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Search, X, Calendar } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';
import { buildBugListHtml } from './bugListPdf';

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
  'NG確認要': 'bg-amber-50 text-amber-700 border-amber-200',
  '想定以外NG': 'bg-purple-50 text-purple-700 border-purple-200',
};

const STATUS_COLOR: Record<string, string> = {
  '対応待ち': 'bg-neutral-100 text-neutral-600 border-neutral-200',
  '対応中': 'bg-blue-50 text-blue-700 border-blue-200',
  '確認中': 'bg-amber-50 text-amber-700 border-amber-200',
  '対応不要': 'bg-neutral-50 text-neutral-500 border-neutral-200',
  '対応完了': 'bg-emerald-50 text-emerald-700 border-emerald-200',
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

export default function BugList({ lang, onHome, onBack, initialMonth = '' }: BugListProps) {
  const L =
    lang === 'zh'
      ? {
          home: '首页', testCenter: '测试中心', title: 'BUG一览',
          keyword: '关键字', keywordPh: 'NO / 测试案件名 / BUG概要',
          system: '系统区分', month: '月份', judgment: '判定', status: '状态',
          all: '全部', clear: '清除条件', search: '检索', result: '检索结果', count: '件', exportHtml: '导出 HTML',
          sumTotal: '合计件数', sumNg: 'NG件数', sumIncomplete: '未完成', sumDone: '已完成',
          colNo: 'NO', colSystem: '系统区分', colCase: '测试案件名', colDesc: 'BUG概要',
          colJudg: '判定', colStatus: '状态', colDate: '测试时间', colAssignee: '测试担当者', colMonth: '月份',
          noData: '暂无符合条件的数据。', loading: '加载中...',
          dReproSteps: '再现手顺', dExpected: '预定结果', dActual: '实际结果', dRemarks: '备注',
          dCase: '测试案件名', dDesc: 'BUG概要', dChild: '子页面内容', dChildEmpty: '无子页面内容',
          close: '关闭', caseNo: '案例编号',
        }
      : {
          home: 'ホーム', testCenter: '測試中心', title: 'BUG一覧',
          keyword: 'キーワード', keywordPh: 'NO / テスト案件名 / BUG説明',
          system: 'システム', month: '月次', judgment: '判定', status: 'ステータス',
          all: 'すべて', clear: '条件クリア', search: '検索', result: '検索結果', count: '件', exportHtml: 'HTML出力',
          sumTotal: '合計件数', sumNg: 'NG件数', sumIncomplete: '未完了', sumDone: '対応完了',
          colNo: 'NO', colSystem: 'システム', colCase: 'テスト案件名', colDesc: 'BUG説明',
          colJudg: '判定', colStatus: 'ステータス', colDate: '実施日', colAssignee: '担当者', colMonth: '月次',
          noData: '条件に一致するデータがありません。', loading: '読み込み中...',
          dReproSteps: '再現ステップ', dExpected: '予定結果', dActual: '実際結果', dRemarks: '備考欄',
          dCase: 'テスト案件名', dDesc: 'BUG説明', dChild: '子ページ内容', dChildEmpty: '子ページの内容はありません',
          close: '閉じる', caseNo: 'ケース番号',
        };

  const [allItems, setAllItems] = useState<BugItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [system, setSystem] = useState('');
  const [month, setMonth] = useState(initialMonth);
  const [judgments, setJudgments] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => {
    if (initialMonth && initialMonth.length >= 4) return Number(initialMonth.slice(0, 4));
    return new Date().getFullYear();
  });
  const monthPickerRef = useRef<HTMLDivElement>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [childHtml, setChildHtml] = useState<string>('');
  const [childLoading, setChildLoading] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setMonthPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allItems
      .filter((b) => {
        if (system && b.system !== system) return false;
        if (month && toMonthKey(b.month) !== month) return false;
        if (judgments.length && !judgments.includes(b.judgment)) return false;
        if (status && b.status !== status) return false;
        if (kw) {
          const hay = `${b.no} ${b.testCaseName} ${b.bugDesc}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.month === b.month ? noNumber(a.no) - noNumber(b.no) : b.month.localeCompare(a.month)));
  }, [allItems, keyword, system, month, judgments, status]);

  const handleClear = () => {
    setKeyword('');
    setSystem('');
    setMonth('');
    setJudgments([]);
    setStatus('');
  };

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

      const html = buildBugListHtml(filtered, { keyword, system, month, judgments, status }, lang, childMap);
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
    const incomplete = filtered.filter((b) => b.status && b.status !== '対応完了').length;
    const done = filtered.filter((b) => b.status === '対応完了').length;
    return { total, ng, incomplete, done };
  }, [filtered]);

  // 行クリックでアコーディオン展開。展開時に子ページ本文を遅延取得
  const toggleRow = async (bug: BugItem) => {
    if (openId === bug.id) {
      setOpenId(null);
      return;
    }
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
      // 子页面加载失败时静默
    } finally {
      setChildLoading(false);
    }
  };

  const breadcrumb = (
    <nav className="flex items-center gap-2 text-sm">
      <button type="button" onClick={onHome} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
        {L.home}
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
        {L.testCenter}
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      <span className="text-neutral-900 font-medium">{L.title}</span>
    </nav>
  );

  const selectCls =
    'appearance-none bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none';

  return (
    <>
      <div className="space-y-6">
        {breadcrumb}

        <h2 className="text-2xl font-bold text-neutral-900">{L.title}</h2>

        {/* サマリー */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: L.sumTotal, value: summary.total, color: 'text-neutral-900' },
            { label: L.sumNg, value: summary.ng, color: 'text-red-600' },
            { label: L.sumIncomplete, value: summary.incomplete, color: 'text-amber-600' },
            { label: L.sumDone, value: summary.done, color: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-neutral-200 rounded-xl px-4 py-3 shadow-sm">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-neutral-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 検索条件 */}
        <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 flex-1 min-w-[220px]">
              <label className="text-xs font-semibold text-neutral-500">{L.keyword}</label>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={L.keywordPh}
                  className="w-full rounded-lg border border-neutral-300 pl-9 pr-3 py-2 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-500">{L.system}</label>
              <select value={system} onChange={(e) => setSystem(e.target.value)} className={selectCls}>
                <option value="">{L.all}</option>
                {systemOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 relative" ref={monthPickerRef}>
              <label className="text-xs font-semibold text-neutral-500">{L.month}</label>
              <button
                type="button"
                onClick={() => setMonthPickerOpen((v) => !v)}
                className="flex items-center gap-2 bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:border-neutral-400 focus:border-neutral-500 focus:outline-none min-w-[120px]"
              >
                <Calendar size={14} className="text-neutral-400" />
                <span className="flex-1 text-left">{month || L.all}</span>
                <ChevronDown size={14} className={`text-neutral-400 transition-transform ${monthPickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {monthPickerOpen && (
                <div className="absolute top-full right-0 mt-1 z-20 bg-white border border-neutral-200 rounded-xl shadow-lg p-3 w-[260px]">
                  <div className="flex items-center justify-between mb-2">
                    <button type="button" onClick={() => setMonthPickerYear((y) => y - 1)} className="p-1 rounded hover:bg-neutral-100"><ChevronLeft size={16} /></button>
                    <span className="text-sm font-semibold text-neutral-800">{monthPickerYear}</span>
                    <button type="button" onClick={() => setMonthPickerYear((y) => y + 1)} className="p-1 rounded hover:bg-neutral-100"><ChevronRight size={16} /></button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 12 }, (_, i) => {
                      const m = i + 1;
                      const key = `${monthPickerYear}${String(m).padStart(2, '0')}`;
                      const isActive = month === key;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setMonth(key); setMonthPickerOpen(false); }}
                          className={`rounded-lg py-1.5 text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-neutral-900 text-white'
                              : 'text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          {m}月
                        </button>
                      );
                    })}
                  </div>
                  {month && (
                    <button
                      type="button"
                      onClick={() => { setMonth(''); setMonthPickerOpen(false); }}
                      className="w-full mt-2 rounded-lg border border-neutral-200 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50 transition-colors"
                    >
                      {L.clear}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-500">{L.judgment}</label>
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
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        on ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'
                      }`}
                    >
                      {j}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-500">{L.status}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
                <option value="">{L.all}</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              <X size={15} />
              {L.clear}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* 結果 */}
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
            <div className="text-sm text-neutral-600">
              {L.result} <span className="font-bold text-neutral-900">{filtered.length}</span> {L.count}
            </div>
            <button
              type="button"
              onClick={handleExportHtml}
              disabled={filtered.length === 0 || exporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {L.exportHtml}
            </button>
          </div>

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-400 flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {L.loading}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-400">{L.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                {/* 列ヘッダー */}
                <div
                  className="grid bg-neutral-50 border-b border-neutral-100 text-[11px] font-semibold text-neutral-500"
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  <div className="px-3 py-2">{L.colNo}</div>
                  <div className="px-3 py-2">{L.colSystem}</div>
                  <div className="px-3 py-2">{L.colDesc}</div>
                  <div className="px-3 py-2">{L.colJudg}</div>
                  <div className="px-3 py-2">{L.colStatus}</div>
                  <div className="px-3 py-2">{L.colAssignee}</div>
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
                          isOpen ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/70'
                        }`}
                        style={{ gridTemplateColumns: GRID_COLS }}
                      >
                        <div className="px-3 py-2.5 text-xs font-semibold text-blue-600">{bug.no || '-'}</div>
                        <div className="px-3 py-2.5 text-xs text-neutral-600 truncate" title={bug.system}>{bug.system || '-'}</div>
                        <div className="px-3 py-2.5 text-sm text-neutral-800 truncate" title={bug.bugDesc}>{bug.bugDesc || '-'}</div>
                        <div className="px-3 py-2.5">
                          {bug.judgment ? (
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${badge(bug.judgment, JUDGMENT_COLOR)}`}>
                              {bug.judgment}
                            </span>
                          ) : '-'}
                        </div>
                        <div className="px-3 py-2.5">
                          {bug.status ? (
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${badge(bug.status, STATUS_COLOR)}`}>
                              {bug.status}
                            </span>
                          ) : '-'}
                        </div>
                        <div className="px-3 py-2.5 text-xs text-neutral-600 truncate" title={bug.assignee}>{bug.assignee || '-'}</div>
                        <div className="flex items-center justify-center text-neutral-400">
                          <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {isOpen && (
                        <div className="bg-neutral-50 border-t border-neutral-100 px-5 py-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label={L.dCase} value={bug.testCaseName} />
                            <Field label={L.colSystem} value={bug.system} />
                          </div>
                          <Field label={L.dDesc} value={bug.bugDesc} block />
                          <Field label={L.dReproSteps} value={bug.reproSteps} block pre />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label={L.dExpected} value={bug.expectedResult} block />
                            <Field label={L.dActual} value={bug.actualResult} block />
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Field label={L.colDate} value={fmtDate(bug.execDate)} />
                            <Field label={L.colAssignee} value={bug.assignee} />
                            <Field label={L.colMonth} value={bug.month} />
                            {bug.caseNumber && <Field label={L.caseNo} value={bug.caseNumber} />}
                          </div>
                          <Field label={L.dRemarks} value={bug.remarks} block />

                          {/* 子ページ内容 */}
                          <div className="space-y-1.5">
                            <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{L.dChild}</p>
                            {childLoading ? (
                              <p className="text-sm text-neutral-400 flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                {L.loading}
                              </p>
                            ) : childHtml.trim() ? (
                              <div
                                className="notion-content text-sm text-neutral-700 border border-neutral-200 rounded-lg p-3 bg-white"
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

        <div className="pt-4 border-t border-neutral-200">{breadcrumb}</div>
      </div>
    </>
  );
}

const GRID_COLS = '72px 96px minmax(0,1fr) 88px 92px 96px 32px';

function Field({ label, value, block, pre }: { label: string; value: string; block?: boolean; pre?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{label}</p>
      <p className={`text-sm text-neutral-700 ${block ? '' : 'break-all'} ${pre ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap'}`}>
        {value || '-'}
      </p>
    </div>
  );
}
