import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Download, Layers, List, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';
import { buildBugListHtml, inlineChildImages } from './bugListPdf';
import BugEditDialog, { type BugSavedResult } from './BugEditDialog';
import { EXCLUDED_SYSTEMS } from './CaseManagement';

// 案件管理のツリーでシステム未設定の案件が入るグループ名
const UNSET_SYSTEM = '(未設定)';

type BugListProps = {
  lang: Lang;
  onHome: () => void;
  // 未指定 (管理類の BUG管理 カードから直接開いた場合) は TestCenter の階層を出さない
  onBack?: () => void;
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
  caseId: string;
};

// 検索条件。入力中の値と「検索」で確定した値 (applied) を分ける
type Conditions = {
  keyword: string;
  system: string;
  year: string;
  monthNo: string;
  judgments: string[];
  status: string;
  assignee: string;
};

const PAGE_SIZE = 20;

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

function downloadHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set<string>(values.filter(Boolean))).sort();
}

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
          keyword: '关键字', keywordPh: 'NO / 测试案件名 / 测试内容',
          system: '系统区分', year: '年份', month: '月份', judgment: '判定', status: '状态',
          all: '全部', clear: '清除条件', search: '检索', result: '检索结果', count: '件', exportHtml: '导出 HTML',
          sumTotal: '合计件数', sumNg: 'NG件数', sumIncomplete: '未完成', sumDone: '已完成',
          colNo: 'NO', colSystem: '系统区分', colCase: '测试案件名', colDesc: '测试内容',
          colJudg: '判定', colStatus: '状态', colPriority: '优先度', colDate: '测试时间', colAssignee: '测试担当者', colMonth: '月份',
          noData: '暂无符合条件的数据。', loading: '加载中...',
          dReproSteps: '再现手顺', dExpected: '预定结果', dActual: '实际结果', dRemarks: '备注',
          dCase: '案件名', dDesc: '测试内容', dChild: '补充说明', dChildEmpty: '无补充说明',
          close: '关闭', caseNo: '案例编号',
          filterLabel: '筛选条件', detail: '详细条件', detailSet: '设定中', assignee: '担当者',
          groupByCase: '按案件分组', listView: '列表显示', noCase: '（无案件）',
          notSearched: '请指定条件后点击「检索」。', page: '页',
        }
      : {
          home: 'ホーム', testCenter: 'TestCenter', title: 'BUG一覧',
          keyword: 'キーワード', keywordPh: 'NO / テスト案件名 / テスト内容',
          system: 'システム', year: '年度', month: '月次', judgment: '判定', status: 'ステータス',
          all: 'すべて', clear: '条件クリア', search: '検索', result: '検索結果', count: '件', exportHtml: 'HTML出力',
          sumTotal: '合計件数', sumNg: 'NG件数', sumIncomplete: '未完了', sumDone: '完了',
          colNo: 'NO', colSystem: 'システム', colCase: 'テスト案件名', colDesc: 'テスト内容',
          colJudg: '判定', colStatus: 'ステータス', colPriority: '優先度', colDate: '実施日', colAssignee: '担当者', colMonth: '月次',
          noData: '条件に一致するデータがありません。', loading: '読み込み中...',
          dReproSteps: '再現ステップ', dExpected: '予定結果', dActual: '実際結果', dRemarks: '備考欄',
          dCase: '案件名', dDesc: 'テスト内容', dChild: '補充説明', dChildEmpty: '補充説明はありません',
          close: '閉じる', caseNo: 'ケース番号',
          filterLabel: '絞り込み', detail: '詳細条件', detailSet: '設定中', assignee: '担当者',
          groupByCase: '案件別表示', listView: '一覧表示', noCase: '（案件なし）',
          notSearched: '条件を指定して「検索」を押してください。', page: 'ページ',
        };

  const [allItems, setAllItems] = useState<BugItem[]>([]);
  // 一覧は画面を開いただけでは取らず、最初の「検索」で全件取得する
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [system, setSystem] = useState('');
  // 月次は年度と月に分ける。月を選ばなければその年度すべて
  const [year, setYear] = useState(() => (/^\d{4}/.test(initialMonth) ? initialMonth.slice(0, 4) : ''));
  const [monthNo, setMonthNo] = useState(() =>
    /^\d{6}$/.test(initialMonth) ? String(Number(initialMonth.slice(4, 6))) : ''
  );
  const [judgments, setJudgments] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  // 「検索」で確定した条件。null は未検索
  const [applied, setApplied] = useState<Conditions | null>(null);
  const [groupByCase, setGroupByCase] = useState(false);
  const [page, setPage] = useState(1);
  // システムの選択肢は案件管理の System 選択と同じ (進捗管理表の値)。検索前から選べる
  const [systemOptions, setSystemOptions] = useState<string[]>([]);

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
    // 案件管理の左ツリーと同じ: 親案件のシステムを出現順に、除外システムを除いて並べる
    fetch('/api/case-management/tree')
      .then((r) => (r.ok ? r.json() : { tree: [] }))
      .then((d: { tree?: { system?: string }[] }) => {
        if (aborted) return;
        const names = (d.tree ?? []).map((p) => p.system || UNSET_SYSTEM).filter((s) => !EXCLUDED_SYSTEMS.has(s));
        setSystemOptions(Array.from(new Set(names)));
      })
      .catch(() => {});
    return () => { aborted = true; };
  }, []);

  const handleSearch = async () => {
    setApplied({ keyword, system, year, monthNo, judgments, status, assignee });
    setPage(1);
    setOpenId(null);
    setPinnedId(null);
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/test-center/bugs');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setAllItems(Array.isArray(data.items) ? data.items : []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // 選択肢は データにある値 + 検索前でも選べる既定値
  const judgmentOptions = useMemo(
    () => uniqSorted([...Object.keys(JUDGMENT_COLOR), ...allItems.map((b) => b.judgment)]),
    [allItems]
  );
  const statusOptions = useMemo(
    () => uniqSorted([...Object.keys(STATUS_COLOR), ...allItems.map((b) => b.status)]),
    [allItems]
  );
  // 担当者はデータからのみ (最初の検索後に選べる)
  const assigneeOptions = useMemo(() => uniqSorted(allItems.map((b) => b.assignee)), [allItems]);
  // 年度は今年から2年前まで + データにある年。新しい年が上
  const yearOptions = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return uniqSorted([
      ...[0, 1, 2].map((d) => String(thisYear - d)),
      ...allItems.map((b) => toMonthKey(b.month).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)),
    ]).reverse();
  }, [allItems]);

  const filtered = useMemo(() => {
    if (!applied) return [];
    const kw = applied.keyword.trim().toLowerCase();
    return allItems
      .filter((b) => {
        if (applied.system && b.system !== (applied.system === UNSET_SYSTEM ? '' : applied.system)) return false;
        if (applied.year || applied.monthNo) {
          const key = toMonthKey(b.month);
          if (applied.year && key.slice(0, 4) !== applied.year) return false;
          if (applied.monthNo && Number(key.slice(4, 6)) !== Number(applied.monthNo)) return false;
        }
        if (applied.judgments.length && !applied.judgments.includes(b.judgment)) return false;
        if (applied.status && b.status !== applied.status) return false;
        if (applied.assignee && b.assignee !== applied.assignee) return false;
        if (kw) {
          const hay = `${b.no} ${b.testCaseName} ${b.bugDesc}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.id === pinnedId || b.id === pinnedId) return a.id === pinnedId ? -1 : 1;
        if (a.month !== b.month) return b.month.localeCompare(a.month);
        // 案件別表示では同じ案件を続けて並べる
        if (groupByCase && a.testCaseName !== b.testCaseName) return a.testCaseName.localeCompare(b.testCaseName);
        return noNumber(a.no) - noNumber(b.no);
      });
  }, [allItems, applied, pinnedId, groupByCase]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // 案件別表示の見出しに出す件数 (ページをまたいでも案件全体の件数)
  const caseCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of filtered) m.set(b.testCaseName, (m.get(b.testCaseName) ?? 0) + 1);
    return m;
  }, [filtered]);

  const handleClear = () => {
    setKeyword('');
    setSystem('');
    setYear('');
    setMonthNo('');
    setJudgments([]);
    setStatus('');
    setAssignee('');
  };

  const hasFilter = keyword || system || year || monthNo || judgments.length > 0 || status || assignee;
  const hasDetailFilter = keyword || judgments.length > 0 || assignee;

  // HTML出力のヘッダに出す条件は「検索」で確定したもの。年だけなら「2026年」、月まで選べば YYYYMM
  const ap: Conditions = applied ?? { keyword: '', system: '', year: '', monthNo: '', judgments: [], status: '', assignee: '' };
  const periodText = ap.year
    ? (ap.monthNo ? `${ap.year}${String(Number(ap.monthNo)).padStart(2, '0')}` : `${ap.year}年`)
    : (ap.monthNo ? `${Number(ap.monthNo)}月` : '');

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

      const filters = { keyword: ap.keyword, system: ap.system, month: periodText, judgments: ap.judgments, status: ap.status };
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      if (!groupByCase) {
        downloadHtml(buildBugListHtml(filtered, filters, lang, childMap), `BUG_${ymd}.html`);
        return;
      }
      // 案件別表示では案件ごとに1ファイル (画面の並び順)
      const groups = new Map<string, BugItem[]>();
      for (const b of filtered) groups.set(b.testCaseName, [...(groups.get(b.testCaseName) ?? []), b]);
      let first = true;
      for (const [caseName, items] of groups) {
        // 連続クリックをブラウザに間引かれないよう少し間を空ける
        if (!first) await new Promise((r) => setTimeout(r, 300));
        first = false;
        const safeName = (caseName || '案件なし').replace(/[\\/:*?"<>|]/g, '_');
        downloadHtml(buildBugListHtml(items, filters, lang, childMap), `BUG_${safeName}_${ymd}.html`);
      }
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
    if (!r.isNew && !r.caseChanged) {
      setAllItems((prev) => prev.map((b) => (b.id === r.bugId ? { ...b, ...r.fields } : b)));
      return;
    }
    // 未検索なら一覧が無いので、登録した旨だけ知らせる
    if (r.isNew && !loaded) {
      setNotice(`${r.notice ? `${r.notice}\n` : ''}BUG を登録しました。`);
      return;
    }
    // システム・月次・No は案件の rollup / 採番なので、保存後の1件を取り直して一覧に反映する
    try {
      const res = await fetch(`/api/test-center/bugs/single/${encodeURIComponent(r.bugId)}`);
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: BugItem };
      if (!r.isNew) {
        setAllItems((prev) => prev.map((b) => (b.id === item.id ? item : b)));
        return;
      }
      setAllItems((prev) => [item, ...prev.filter((b) => b.id !== item.id)]);
      setPinnedId(item.id);
      setPage(1);
      openRow(item);
    } catch {
      setNotice(`${r.notice ? `${r.notice}\n` : ''}BUG は保存しましたが、一覧への反映に失敗しました。ページを再読み込みしてください。`);
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
    <nav className="flex items-center gap-2 text-sm">
      <button type="button" onClick={onHome} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
        {L.home}
      </button>
      {onBack && (
        <>
          <span className="text-neutral-400">{'>>'}</span>
          <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
            {L.testCenter}
          </button>
        </>
      )}
      <span className="text-neutral-400">{'>>'}</span>
      <span className="text-neutral-900 font-medium">{L.title}</span>
    </nav>
  );

  // 検索条件の部品。高さ 36px・ラベルは上に置いて揃える
  const fieldCls = 'flex min-w-0 flex-col gap-1.5';
  const labelCls = 'block text-xs font-medium text-neutral-500';
  const selectCls =
    'h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-700 hover:border-neutral-400 focus:border-neutral-500 focus:outline-none transition-colors';

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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={15} />
            新規
          </button>
          <button
            type="button"
            onClick={handleExportHtml}
            disabled={filtered.length === 0 || exporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
        <form
          className="bg-white border border-neutral-200 rounded-xl shadow-sm"
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
        >
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
            {/* 基本条件: システム・年度・月次・ステータス + 検索 */}
            <div className="grid grid-cols-2 items-end gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
              <div className={`${fieldCls} col-span-2 md:col-span-1`}>
                <label htmlFor="bug-f-system" className={labelCls}>{L.system}</label>
                <select id="bug-f-system" value={system} onChange={(e) => setSystem(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {systemOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* 年度 (TestCase 画面と同じく年と月を分ける) */}
              <div className={fieldCls}>
                <label htmlFor="bug-f-year" className={labelCls}>{L.year}</label>
                <select id="bug-f-year" value={year} onChange={(e) => setYear(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
              </div>
              {/* 月次。未選択ならその年度すべて */}
              <div className={fieldCls}>
                <label htmlFor="bug-f-month" className={labelCls}>{L.month}</label>
                <select id="bug-f-month" value={monthNo} onChange={(e) => setMonthNo(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>{m}月</option>
                  ))}
                </select>
              </div>
              <div className={`${fieldCls} col-span-2 md:col-span-1`}>
                <label htmlFor="bug-f-status" className={labelCls}>{L.status}</label>
                <select id="bug-f-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
                  <option value="">{L.all}</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="col-span-2 md:col-span-1 inline-flex h-9 min-w-[96px] items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {L.search}
              </button>
            </div>

            {/* 詳細条件: キーワード・担当者・判定。既定は折りたたみ */}
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <button
                type="button"
                onClick={() => setDetailOpen((v) => !v)}
                aria-expanded={detailOpen}
                className="inline-flex h-7 items-center gap-1.5 rounded-md text-xs font-medium text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                <ChevronDown size={14} className={`transition-transform duration-200 ${detailOpen ? 'rotate-180' : ''}`} />
                {L.detail}
                {hasDetailFilter && <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] leading-none text-white">{L.detailSet}</span>}
              </button>
              {detailOpen && (
                <div className="mt-3 space-y-4">
                  <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
                    {/* Keyword */}
                    <div className={fieldCls}>
                      <label htmlFor="bug-f-keyword" className={labelCls}>{L.keyword}</label>
                      <div className="relative">
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          id="bug-f-keyword"
                          type="text"
                          value={keyword}
                          onChange={(e) => setKeyword(e.target.value)}
                          placeholder={L.keywordPh}
                          className={`${selectCls} pl-9`}
                        />
                      </div>
                    </div>
                    {/* 担当者 (選択肢は最初の検索後に揃う) */}
                    <div className={fieldCls}>
                      <label htmlFor="bug-f-assignee" className={labelCls}>{L.assignee}</label>
                      <select id="bug-f-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
                        <option value="">{L.all}</option>
                        {assigneeOptions.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* Judgment toggles */}
                  <div className={fieldCls}>
                    <span className={labelCls}>{L.judgment}</span>
                    <div className="flex flex-wrap gap-2">
                      {judgmentOptions.map((j) => {
                        const on = judgments.includes(j);
                        return (
                          <button
                            key={j}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setJudgments((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]))
                            }
                            className={`inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-medium transition-colors ${
                              on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:border-neutral-400'
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
        </form>

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
            {applied && (
              <button
                type="button"
                onClick={() => { setGroupByCase((v) => !v); setPage(1); }}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                {groupByCase ? <List size={14} /> : <Layers size={14} />}
                {groupByCase ? L.listView : L.groupByCase}
              </button>
            )}
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <p className="px-5 py-12 text-center text-sm text-neutral-400 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                {L.loading}
              </p>
            ) : !applied ? (
              <p className="px-5 py-12 text-center text-sm text-neutral-400">{L.notSearched}</p>
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

                  {pageItems.map((bug, idx) => {
                    const isOpen = openId === bug.id;
                    const showCaseHeader = groupByCase && (idx === 0 || pageItems[idx - 1].testCaseName !== bug.testCaseName);
                    return (
                      <div key={bug.id} className="border-b border-neutral-100 last:border-b-0">
                        {showCaseHeader && (
                          <div className="px-3 py-2 bg-neutral-100/80 border-b border-neutral-200 flex items-center gap-2 text-xs">
                            <span className="font-semibold text-neutral-800 truncate" title={bug.testCaseName}>{bug.testCaseName || L.noCase}</span>
                            {bug.month && <span className="text-neutral-400 shrink-0">{bug.month}</span>}
                            <span className="text-neutral-500 tabular-nums shrink-0">{caseCounts.get(bug.testCaseName) ?? 0}{L.count}</span>
                          </div>
                        )}
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
                            {/* 左: 案件名・テスト内容・再現/予定/実際・補充説明・備考 / 右: 実施日・担当者・月次・ケース番号 */}
                            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-4 gap-5">
                              <div className="md:col-span-3 space-y-4 min-w-0">
                                <Field label={L.dCase} value={bug.testCaseName} />
                                <Field label={L.dDesc} value={bug.bugDesc} block />

                                {/* Repro / Expected / Actual — grouped as comparison */}
                                <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
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

                                {/* 補充説明 (子ページの内容) */}
                                <div className="space-y-1.5">
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

                                {bug.remarks && <Field label={L.dRemarks} value={bug.remarks} block />}
                              </div>

                              <div className="space-y-4 md:border-l md:border-neutral-200 md:pl-5">
                                <Field label={L.colDate} value={fmtDate(bug.execDate)} />
                                <Field label={L.colAssignee} value={bug.assignee} />
                                <Field label={L.colMonth} value={bug.month} />
                                {bug.caseNumber && <Field label={L.caseNo} value={bug.caseNumber} />}
                              </div>
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

          {applied && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => { setPage(curPage - 1); setOpenId(null); }}
                disabled={curPage <= 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="tabular-nums text-neutral-600">{curPage} / {totalPages} {L.page}</span>
              <button
                type="button"
                onClick={() => { setPage(curPage + 1); setOpenId(null); }}
                disabled={curPage >= totalPages}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
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
