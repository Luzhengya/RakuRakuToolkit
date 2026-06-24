import { useMemo, useRef, useState } from 'react';
import { AlertCircle, Calendar, CheckCircle2, ChevronRight, FileText, Loader2, Search, X } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';
import { buildMonthlyReportHtml, monthlyReportTitle, systemLabel, type ReportItem } from './monthlyReportTemplate';

type MonthlyReportProps = {
  lang: Lang;
  onHome: () => void;
  onBack: () => void;
};

type AchievementItem = ReportItem & {
  year: number | null;
  month: number | null;
};

// 検索画面で対象とするシステム（実績表 select の選択肢に対応）
const SYSTEMS: { name: string; color: string }[] = [
  { name: 'J-MOTTOポータル', color: '#1e3a8a' },
  { name: 'Univ2', color: '#4f46e5' },
  { name: 'J-MOTTOアプリ', color: '#2563eb' },
  { name: 'Univコンテンツ', color: '#14b8a6' },
  { name: 'Univアプリ', color: '#6366f1' },
];

function defaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmt2(value: string): string {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : '-';
}

function isNgVal(value: string, threshold: number, mode: 'gte' | 'lt'): boolean {
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return false;
  return mode === 'gte' ? n >= threshold : n < threshold;
}

export default function MonthlyReport({ lang, onHome, onBack }: MonthlyReportProps) {
  const homeLabel = lang === 'zh' ? '首页' : 'ホーム';
  const [month, setMonth] = useState<string>(defaultMonth());
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SYSTEMS.map((s) => [s.name, true]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [searched, setSearched] = useState(false);
  const [target, setTarget] = useState<{ year: number; month: number; monthKey: string; systems: string[] } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState('');
  const [savingPdf, setSavingPdf] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const reportIframeRef = useRef<HTMLIFrameElement>(null);

  const selectedSystems = useMemo(
    () => SYSTEMS.filter((s) => selected[s.name]).map((s) => s.name),
    [selected]
  );
  const allChecked = selectedSystems.length === SYSTEMS.length;

  const monthYear = parseInt(month.slice(0, 4), 10) || new Date().getFullYear();
  const monthNum = parseInt(month.slice(4), 10) || (new Date().getMonth() + 1);
  const yearOptions = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i);
  const monthNums = Array.from({ length: 12 }, (_, i) => i + 1);
  const selectClass = 'px-2 py-1 text-xs border border-neutral-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 hover:border-neutral-300 transition-colors';

  const checkedCount = useMemo(
    () => items.filter((it) => checkedMap[it.id]).length,
    [items, checkedMap]
  );
  const allRowsChecked = items.length > 0 && checkedCount === items.length;

  const toggleAll = () => {
    const next = !allChecked;
    setSelected(Object.fromEntries(SYSTEMS.map((s) => [s.name, next])));
  };

  const handleClear = () => {
    setMonth(defaultMonth());
    setSelected(Object.fromEntries(SYSTEMS.map((s) => [s.name, true])));
    setItems([]);
    setCheckedMap({});
    setSearched(false);
    setError(null);
    setTarget(null);
  };

  const handleSearch = async () => {
    if (!/^\d{6}$/.test(month.trim())) {
      setError(lang === 'zh' ? '月份请使用 YYYYMM 格式' : '月は YYYYMM 形式で入力してください');
      return;
    }
    if (selectedSystems.length === 0) {
      setError(lang === 'zh' ? '请至少选择一个系统' : 'システムを1つ以上選択してください');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        month: month.trim(),
        systems: selectedSystems.join(','),
      });
      const res = await fetch(`/api/test-center/monthly-report?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const fetched: AchievementItem[] = Array.isArray(data.items) ? data.items : [];
      setItems(fetched);
      // 検索結果はデフォルト全てチェック済み
      setCheckedMap(Object.fromEntries(fetched.map((it) => [it.id, true])));
      setSearched(true);
      setTarget({ year: data.year, month: data.month, monthKey: month.trim(), systems: selectedSystems });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setItems([]);
      setCheckedMap({});
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const popupBlockedMsg =
    lang === 'zh' ? '浏览器阻止了弹窗，请允许后重试。' : 'ポップアップがブロックされました。許可してから再試行してください。';

  // 「月次報告書 作成」→ 編集可能なプレビューを開く（計画資料と同じフロー）
  const handleCreateReport = () => {
    if (!target) return;
    const targetItems = items.filter((it) => checkedMap[it.id]);
    if (targetItems.length === 0) return;

    const html = buildMonthlyReportHtml(targetItems, {
      year: target.year,
      month: target.month,
      monthKey: target.monthKey,
      systems: target.systems,
    });
    setReportHtml(html);
    setHistoryNotice(null);
    setReportOpen(true);
  };

  // プレビューで編集した内容を PDF 保存 ＋ Notion に履歴を残す
  const handleSaveReportPdf = async () => {
    if (!target) return;
    const iframe = reportIframeRef.current;
    const liveRoot = iframe?.contentDocument?.documentElement;
    const htmlToPrint = liveRoot ? `<!DOCTYPE html>\n${liveRoot.outerHTML}` : reportHtml;
    const title = monthlyReportTitle(target.systems, target.monthKey);

    // Notion へ履歴保存
    setSavingPdf(true);
    setHistoryNotice(null);
    try {
      const res = await fetch('/api/test-center/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'report',
          areaId: systemLabel(target.systems),
          monthKey: target.monthKey,
          title,
          htmlContent: htmlToPrint,
          savedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `保存失败 (${res.status})`);
      }
      setHistoryNotice(lang === 'zh' ? '已保存履历到 Notion' : 'Notion に履歴を保存しました');
    } catch (err) {
      setHistoryNotice(
        (lang === 'zh' ? '履历保存失败：' : '履歴の保存に失敗しました：') +
          (err instanceof Error ? err.message : 'Unknown error')
      );
    } finally {
      setSavingPdf(false);
    }

    // 印刷ウィンドウ
    const win = window.open('', '_blank');
    if (!win) {
      setHistoryNotice(popupBlockedMsg);
      return;
    }
    win.document.open();
    win.document.write(htmlToPrint);
    win.document.close();
    win.document.title = title;
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const breadcrumb = (
    <nav className="flex items-center gap-1.5 text-sm text-neutral-500">
      <button type="button" onClick={onHome} className="hover:text-neutral-900 hover:underline transition-colors">
        {homeLabel}
      </button>
      <ChevronRight size={14} className="text-neutral-300 shrink-0" />
      <button type="button" onClick={onBack} className="hover:text-neutral-900 hover:underline transition-colors">
        {lang === 'zh' ? '测试中心' : '測試中心'}
      </button>
      <ChevronRight size={14} className="text-neutral-300 shrink-0" />
      <span className="text-neutral-900 font-medium">月次報告</span>
    </nav>
  );

  return (
    <>
    <div className="space-y-6">
      {breadcrumb}

      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-neutral-900">月次報告書 検索</h2>
        <p className="text-neutral-500">月とシステムを指定してテスト実績を検索し、月次報告書を作成します。</p>
      </div>

      {/* 検索条件 */}
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm px-4 py-3 space-y-3">
        {/* Row 1: month + actions */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-600">
          <label className="flex items-center gap-1.5">
            <Calendar size={13} className="text-neutral-400" />
            <span className="text-neutral-500 font-medium">{lang === 'zh' ? '月份' : '月'}:</span>
            <select className={selectClass} value={monthYear} onChange={(e) => setMonth(`${e.target.value}${String(monthNum).padStart(2, '0')}`)}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select className={selectClass} value={monthNum} onChange={(e) => setMonth(`${monthYear}${String(Number(e.target.value)).padStart(2, '0')}`)}>
              {monthNums.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neutral-900 font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {lang === 'zh' ? '检索' : '検索'}
            </button>
            <button type="button" onClick={handleClear} className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors">
              {lang === 'zh' ? '重置' : 'リセット'}
            </button>
          </div>
        </div>
        {/* Row 2: system pills */}
        <div className="flex items-center gap-2 text-xs border-t border-neutral-100 pt-3 flex-wrap">
          <span className="text-neutral-500 font-medium shrink-0">{lang === 'zh' ? '系统' : 'システム'}:</span>
          <button type="button" onClick={toggleAll} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${allChecked ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'}`}>
            {lang === 'zh' ? '全部' : 'すべて'}
          </button>
          {SYSTEMS.map((sys) => {
            const on = !!selected[sys.name];
            return (
              <button
                key={sys.name}
                type="button"
                onClick={() => setSelected((prev) => ({ ...prev, [sys.name]: !prev[sys.name] }))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'}`}
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: on ? '#fff' : sys.color, opacity: on ? 0.7 : 1 }} />
                {sys.name}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* 検索結果 */}
      {searched && !error && (
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-neutral-600">
              検索結果 <span className="font-bold text-neutral-900">{items.length}</span> 件
              {items.length > 0 && (
                <span className="text-neutral-400 ml-2">（選択 {checkedCount} 件）</span>
              )}
              {target && (
                <span className="text-neutral-400 ml-3">
                  対象: {target.year}年{target.month}月 / {target.systems.length} システム
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleCreateReport}
              disabled={checkedCount === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed transition-colors"
            >
              <FileText size={16} />
              月次報告書 作成
            </button>
          </div>

          {items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-400">
              {loading ? '検索中...' : '条件に一致するデータがありません。'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-xs">
                    <th className="px-3 py-2.5 text-center font-semibold w-10">
                      <input
                        type="checkbox"
                        checked={allRowsChecked}
                        ref={(el) => { if (el) el.indeterminate = checkedCount > 0 && !allRowsChecked; }}
                        onChange={(e) =>
                          setCheckedMap(Object.fromEntries(items.map((it) => [it.id, e.target.checked])))
                        }
                        className="h-4 w-4 rounded border-neutral-300 text-blue-600 align-middle"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-semibold">案件名</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">テスト種類</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">理想ケース差<br/><span className="text-[10px] text-neutral-400 font-normal">≥10 NG</span></th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">理想NG差<br/><span className="text-[10px] text-neutral-400 font-normal">≥1 NG</span></th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">実施テスト件数差<br/><span className="text-[10px] text-neutral-400 font-normal">&lt;0 NG</span></th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">効率<br/><span className="text-[10px] text-neutral-400 font-normal">&lt;20 NG</span></th>
                    <th className="px-3 py-2.5 text-left font-semibold">コメント</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-neutral-50/60 align-top">
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={!!checkedMap[item.id]}
                          onChange={(e) => setCheckedMap((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                          className="h-4 w-4 rounded border-neutral-300 text-blue-600"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-neutral-700 min-w-[220px]">
                        {item.cmdb && <span className="block font-medium text-neutral-900">{item.cmdb}</span>}
                        <span className="block whitespace-pre-wrap break-words">{item.content || '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-600">{item.testType || '-'}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isNgVal(item.idealCaseDiff, 10, 'gte') ? 'text-red-600 font-semibold' : 'text-neutral-700'}`}>{fmt2(item.idealCaseDiff)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isNgVal(item.idealNgDiff, 1, 'gte') ? 'text-red-600 font-semibold' : 'text-neutral-700'}`}>{fmt2(item.idealNgDiff)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isNgVal(item.execTestCount, 0, 'lt') ? 'text-red-600 font-semibold' : 'text-neutral-700'}`}>{fmt2(item.execTestCount)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isNgVal(item.efficiency, 20, 'lt') ? 'text-red-600 font-semibold' : 'text-neutral-700'}`}>{fmt2(item.efficiency)}</td>
                      <td className="px-3 py-2.5 text-neutral-600 min-w-[160px]">
                        {item.comments.length ? (
                          <span className="block whitespace-pre-wrap break-words">{item.comments.join('\n')}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>

    {reportOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8">
        <div className="h-full max-w-[96rem] mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h3 className="text-base font-semibold text-neutral-900 whitespace-nowrap">月次報告書</h3>
              <span className="text-xs text-neutral-400 truncate">
                {lang === 'zh' ? '可直接在预览中编辑，再保存为 PDF' : 'プレビュー内で直接編集してから PDF 保存できます'}
              </span>
              {historyNotice && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 whitespace-nowrap">
                  <CheckCircle2 size={13} />
                  {historyNotice}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveReportPdf}
                disabled={savingPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:bg-neutral-300 disabled:cursor-not-allowed"
              >
                {savingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {lang === 'zh' ? '保存为 PDF' : 'PDFとして保存'}
              </button>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {lang === 'zh' ? '关闭' : '閉じる'}
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <iframe
              ref={reportIframeRef}
              title="monthly-report-preview"
              srcDoc={reportHtml}
              className="w-full h-full bg-white border-0"
            />
          </div>
        </div>
      </div>
    )}
    </>
  );
}
