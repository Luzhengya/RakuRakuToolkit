import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertCircle, AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { type Lang } from '../i18n/testcenter';
import { buildCaseStatsReportHtml, caseStatsReportTitle, type ReportSystemGroup } from './caseStatsReportTemplate';

type CaseStatItem = {
  id: string;
  areaId: string;
  month: string;
  projectName: string;
  status: string;
  system: string;
  assignee: string;
  manager: string;
  estimateTotal: string;
  actualTotal: string;
  developmentEffort: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
  unexpectedNgCount: string;
  designActual: string;
  implActual: string;
  execActual: string;
  reviewActual: string;
  comment: string;
  commentId: string;
  expectedCase: string;
  expectedNg: string;
  japanNgCount: string;
  japanTestCount: string;
  tcNgCount: string;
};

type BugLeakDetail = {
  system: string;
  responsible: boolean;
  caseMonth: string;
  cmdb: string;
  feature: string;
  defect: string;
  process: string;
  category: string;
  cause: string;
  releaseTime: string;
  tcResult: string;
  status: string;
  improvable: string;
  checklist: string;
};

type CaseStatsProps = {
  onBack: () => void;
  onHome: () => void;
  lang: Lang;
  initialYear: number;
  initialMonth: 'all' | number;
};

const CASE_STATS_CACHE_KEY = 'testcenter:casestats:v3';
const TH_KEY = 'testcenter:casestats:thresholds:v2';
const CHART_LAYOUT_KEY = 'testcenter:casestats:chartLayout:v1';

type ChartLayout = { width?: number; height?: number; hidden?: boolean };
function loadChartLayouts(): Record<string, ChartLayout> {
  try {
    const raw = localStorage.getItem(CHART_LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChartLayout>) : {};
  } catch { return {}; }
}
function saveChartLayouts(m: Record<string, ChartLayout>) {
  try { localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(m)); } catch { /* ignore quota */ }
}

type CaseStatsCache = { items: CaseStatItem[]; updatedAt: number };

function loadCaseStatsCache(): CaseStatsCache | null {
  try {
    const raw = localStorage.getItem(CASE_STATS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CaseStatsCache;
  } catch {
    return null;
  }
}

function saveCaseStatsCache(cache: CaseStatsCache) {
  try {
    localStorage.setItem(CASE_STATS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota errors */
  }
}

// ─── 動的閾値 (localStorage 永続) ───
// 効率: high 以上=良(緑) / low 未満=要確認(赤)
// 品質(ngLeak/caseDiff/sensen): 値が大きいほど悪い → high 以上=要確認(赤) / mid 未満=安全(緑)
type EffTh = { high: number; mid: number };
type Thresholds = {
  total: EffTh;
  design: EffTh;
  exec: EffTh;
  review: EffTh;
  ngLeak: EffTh;   // NG流出率(%)  high以上=要確認
  caseDiff: EffTh; // 想定ケース差 high以上=要確認
  sensen: EffTh;   // 潜在見逃し   high以上=要確認
  diff: EffTh;     // 見積対実績差分(人日) high以上=要確認 (担当者別用)
};

// 暫定の既定値 (画面で編集可)
const DEFAULT_TH: Thresholds = {
  total: { high: 15, mid: 8 },
  design: { high: 15, mid: 8 },
  exec: { high: 30, mid: 15 },
  review: { high: 40, mid: 20 },
  ngLeak: { high: 50, mid: 30 },
  caseDiff: { high: 10, mid: 5 },
  sensen: { high: 1, mid: 0.5 },
  diff: { high: 10, mid: 5 },
};

function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(TH_KEY);
    if (!raw) return DEFAULT_TH;
    return { ...DEFAULT_TH, ...(JSON.parse(raw) as Partial<Thresholds>) };
  } catch {
    return DEFAULT_TH;
  }
}

function num(v: string): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function hasVal(v: string): boolean {
  return String(v ?? '').trim() !== '';
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}

function fmtEff(v: number | null): string {
  return v === null ? '-' : fmt(v);
}

function fmtPct(v: number | null): string {
  return v === null ? '-' : `${fmt(v)}%`;
}

// 効率値 (分母0は null)
function effVal(numer: number, denom: number): number | null {
  return denom > 0 ? numer / denom : null;
}

type Band = 'high' | 'mid' | 'low' | 'na';
function band(v: number | null, th: EffTh): Band {
  if (v === null) return 'na';
  if (v >= th.high) return 'high';
  if (v >= th.mid) return 'mid';
  return 'low';
}
const BAND_CLS: Record<Band, string> = {
  high: 'text-emerald-600 font-semibold',
  mid: 'text-neutral-700',
  low: 'bg-red-50 text-neutral-800 font-semibold',
  na: 'text-neutral-400',
};

// 月次: YYYYMM(6桁) / YYYY-MM / YYYY年M月 / M月
function matchPeriod(monthStr: string, year: number, month: 'all' | number): boolean {
  const t = (monthStr || '').trim();
  let y: number | null = null;
  let mo: number | null = null;
  const compact = t.match(/^(\d{4})(\d{2})$/);
  const full = t.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (compact) { y = Number(compact[1]); mo = Number(compact[2]); }
  else if (full) { y = Number(full[1]); mo = Number(full[2]); }
  else {
    const only = t.match(/(\d{1,2})月/);
    if (only) { mo = Number(only[1]); y = year; }
  }
  if (y === null || mo === null) return false;
  if (y !== year) return false;
  if (month !== 'all' && mo !== month) return false;
  return true;
}

// チャート表示設定 pill 用のメタ (月次/年度モードそれぞれ)
const MONTHLY_CHART_META: { id: string; title: string }[] = [
  { id: 'm.pi.estimate', title: 'システム別 見積時間比率' },
  { id: 'm.pi.actual', title: 'システム別 実績作業時間比率' },
  { id: 'm.pi.testSum', title: 'システム別 テストケース件数比率' },
];
const YEARLY_CHART_META: { id: string; title: string }[] = [
  { id: 'y.caseCount', title: '月別案件数' },
  { id: 'y.testSum', title: '月別テスト件数' },
  { id: 'y.ngSum', title: '月別NG件数' },
  { id: 'y.ngLeak', title: '月別NG流出率(%)' },
  { id: 'y.totalEff', title: '月別総効率' },
  { id: 'y.pi.caseCount', title: 'システム別 案件数' },
  { id: 'y.pi.actual', title: 'システム別 実績工数' },
  { id: 'y.pi.ngLeak', title: 'システム別 NG流出率' },
  { id: 'y.pi.totalEff', title: 'システム別 総効率' },
];

// 業務年度: year年2月 〜 (year+1)年1月
// 上期(first): year年 2〜7月 / 下期(second): year年8月 〜 (year+1)年1月
type HalfType = 'full' | 'first' | 'second';

// 月次文字列を YYYYMM(数値) に正規化。判定不能なら null
function parseMonthKey(monthStr: string, fallbackYear?: number): number | null {
  const t = (monthStr || '').trim();
  const compact = t.match(/^(\d{4})(\d{2})$/);
  if (compact) return Number(compact[1]) * 100 + Number(compact[2]);
  const full = t.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (full) return Number(full[1]) * 100 + Number(full[2]);
  const only = t.match(/(\d{1,2})月/);
  if (only && fallbackYear !== undefined) return fallbackYear * 100 + Number(only[1]);
  return null;
}

// 年度・半期の YYYYMM 範囲 [from, to] を返す
function halfPeriodRange(year: number, half: HalfType): { from: number; to: number } {
  if (half === 'first') return { from: year * 100 + 2, to: year * 100 + 7 };
  if (half === 'second') return { from: year * 100 + 8, to: (year + 1) * 100 + 1 };
  return { from: year * 100 + 2, to: (year + 1) * 100 + 1 }; // full = 業務年 2〜次年1月
}

// 業務年順の月配列。full=12ヶ月(2,3,...,12,1)、first=2〜7、second=8,9,...,12,1
function halfMonthsOrder(half: HalfType): number[] {
  if (half === 'first') return [2, 3, 4, 5, 6, 7];
  if (half === 'second') return [8, 9, 10, 11, 12, 1];
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1];
}

// 月次文字列から月(1-12)を抽出
function extractMonth(monthStr: string): number | null {
  const t = (monthStr || '').trim();
  const compact = t.match(/^(\d{4})(\d{2})$/);
  if (compact) return Number(compact[2]);
  const full = t.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (full) return Number(full[2]);
  const only = t.match(/(\d{1,2})月/);
  if (only) return Number(only[1]);
  return null;
}

// 年度チャート配色
const PIE_COLORS = ['#6366f1', '#f97316', '#10b981', '#06b6d4', '#ec4899', '#8b5cf6', '#eab308', '#ef4444'];

export default function CaseStats({ onBack, onHome, initialYear, initialMonth }: CaseStatsProps) {
  const initialCache = useMemo(() => loadCaseStatsCache(), []);
  const [periodType, setPeriodType] = useState<'month' | 'year'>('month');
  const [year, setYear] = useState<number>(initialYear);
  const [month, setMonth] = useState<'all' | number>(initialMonth);
  // 年度モード時の半期区分 (通年/上期/下期)
  const [halfType, setHalfType] = useState<HalfType>('full');
  // 年度モードは通年集計 (月フィルタ無効)
  const effectiveMonth: 'all' | number = periodType === 'year' ? 'all' : month;
  const [items, setItems] = useState<CaseStatItem[]>(initialCache?.items ?? []);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initialCache?.updatedAt ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [th, setTh] = useState<Thresholds>(() => loadThresholds());
  // チャートのサイズ・表示状態を localStorage に保存
  const [chartLayouts, setChartLayouts] = useState<Record<string, ChartLayout>>(() => loadChartLayouts());
  const updateChartLayout = useCallback((id: string, patch: ChartLayout) => {
    setChartLayouts((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      saveChartLayouts(next);
      return next;
    });
  }, []);
  const [effOpen, setEffOpen] = useState(true);
  const [qualOpen, setQualOpen] = useState(true);
  const [assigneeOpen, setAssigneeOpen] = useState(true);
  const [incidentOpen, setIncidentOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // 報告書プレビュー
  const [reportOpen, setReportOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState('');
  const [savingPdf, setSavingPdf] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const reportIframeRef = useRef<HTMLIFrameElement>(null);
  // システム単位の開閉 (未操作なら 要確認>0 のとき既定で展開)
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const isSysOpen = (key: string, defaultOpen: boolean) => openOverride[key] ?? defaultOpen;
  const toggleSys = (key: string, defaultOpen: boolean) =>
    setOpenOverride((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultOpen) }));

  const updateTh = (next: Thresholds) => {
    setTh(next);
    try { localStorage.setItem(TH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // 備考(実績表コメント)のインライン編集。フォーカスアウトで自動保存
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSavingId, setCommentSavingId] = useState<string | null>(null);
  const [commentSavedId, setCommentSavedId] = useState<string | null>(null);

  const saveComment = async (caseId: string, commentId: string, original: string) => {
    const draft = commentDrafts[caseId];
    if (draft === undefined || draft === original) return; // 変更なし
    if (!commentId) return; // 実績表の紐付け無し → 保存先なし
    setCommentSavingId(caseId);
    try {
      const res = await fetch(`/api/test-center/achievement/${commentId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: draft }),
      });
      if (!res.ok) throw new Error('save failed');
      setItems((prev) => {
        const next = prev.map((it) => (it.id === caseId ? { ...it, comment: draft } : it));
        saveCaseStatsCache({ items: next, updatedAt: updatedAt ?? Date.now() });
        return next;
      });
      setCommentDrafts((prev) => {
        const n = { ...prev };
        delete n[caseId];
        return n;
      });
      setCommentSavedId(caseId);
      setTimeout(() => setCommentSavedId((c) => (c === caseId ? null : c)), 2000);
    } catch {
      setError('備考の保存に失敗しました');
    } finally {
      setCommentSavingId(null);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/test-center/case-stats');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || ('取得失敗'));
      }
      const data = (await res.json()) as { items: CaseStatItem[] };
      const fetched = data.items ?? [];
      const now = Date.now();
      setItems(fetched);
      setUpdatedAt(now);
      saveCaseStatsCache({ items: fetched, updatedAt: now });
    } catch (err) {
      setError(err instanceof Error ? err.message : ('取得失敗'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (updatedAt === null) fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // KPI目標 (上期=1 / 下期=2 の項目を Notion 設定表から取得。年度モードで最上方に表示)
  type KpiTarget = { label: string; value: string };
  const [kpiTargets, setKpiTargets] = useState<{ first: KpiTarget[]; second: KpiTarget[] }>({ first: [], second: [] });
  useEffect(() => {
    let alive = true;
    fetch('/api/config/kpi-targets')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setKpiTargets({ first: d.first ?? [], second: d.second ?? [] });
      })
      .catch(() => { /* 失敗時は空のまま */ });
    return () => { alive = false; };
  }, []);

  // BUG流出集計 (品質下部)。期間(年 + 月次のみ月)に連動して取得
  const [bugLeak, setBugLeak] = useState<{
    total: number;
    tcRelated: number;
    bySystem: { system: string; count: number }[];
    items: BugLeakDetail[];
  } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ year: String(year) });
    if (effectiveMonth !== 'all') params.set('month', String(effectiveMonth));
    let alive = true;
    fetch(`/api/test-center/bug-leak?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (alive) setBugLeak(d); })
      .catch(() => { if (alive) setBugLeak(null); });
    return () => { alive = false; };
  }, [year, effectiveMonth]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const it of items) {
      const m = (it.month || '').match(/(\d{4})/);
      if (m) years.add(Number(m[1]));
    }
    years.add(initialYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [items, initialYear]);

  const periodRows = useMemo(() => {
    // 年度モードは業務年(2月〜次年1月)+半期でフィルタ、月次モードは従来通り
    const range = periodType === 'year' ? halfPeriodRange(year, halfType) : null;
    return items
      .filter((it) => {
        if (periodType === 'year' && range) {
          const key = parseMonthKey(it.month, year);
          return key !== null && key >= range.from && key <= range.to;
        }
        return matchPeriod(it.month, year, effectiveMonth);
      })
      .map((it) => {
        const estimate = num(it.estimateTotal);
        const actual = num(it.actualTotal);
        const testTotal = num(it.testTotalCount);
        const ng = num(it.bugCount);
        const designA = num(it.designActual);
        const implA = num(it.implActual);
        const execA = num(it.execActual);
        const reviewA = num(it.reviewActual);
        const hasExpectedCase = hasVal(it.expectedCase);
        const hasExpectedNg = hasVal(it.expectedNg);
        const expectedCase = num(it.expectedCase);
        const expectedNg = num(it.expectedNg);
        const tcng = num(it.tcNgCount);
        const japanNg = num(it.japanNgCount);
        const japanTest = num(it.japanTestCount);
        const caseDiff = expectedCase - testTotal;
        const sensen = expectedNg - tcng - japanNg;
        const ngLeakDenom = tcng + japanNg;
        // NG流出率: NGデータあり(実績表 join済)で NG=0 なら 0%、データ無しなら null(-)
        const hasNgData = hasVal(it.japanNgCount) || hasVal(it.tcNgCount);
        return {
          it,
          estimate,
          actual,
          diff: actual - estimate,
          testTotal,
          ng,
          ngRate: testTotal > 0 ? (ng / testTotal) * 100 : null,
          designA, implA, execA, reviewA,
          totalEff: effVal(testTotal, actual),
          designEff: effVal(testTotal, designA + implA),
          execEff: effVal(testTotal, execA),
          reviewEff: effVal(testTotal, reviewA),
          hasExpectedCase,
          expectedCase,
          caseDiff,
          hasExpectedNg,
          expectedNg,
          japanNg,
          japanTest,
          tcng,
          sensen,
          hasNgData,
          ngLeakRate: ngLeakDenom > 0 ? (japanNg / ngLeakDenom) * 100 : (hasNgData ? 0 : null),
        };
      });
  }, [items, year, effectiveMonth, periodType, halfType]);

  // 対象期間に存在するシステム一覧 (システム選択の候補)
  const allSystems = useMemo(
    () => Array.from(new Set(periodRows.map((r) => r.it.system || '(未設定)'))).sort(),
    [periodRows]
  );
  // システム選択で画面・報告を絞り込む (deselected に入っているものを除外)
  const rows = useMemo(
    () => periodRows.filter((r) => !deselected.has(r.it.system || '(未設定)')),
    [periodRows, deselected]
  );

  // 基本 KPI
  const kpi = useMemo(() => {
    const estimateSum = rows.reduce((s, r) => s + r.estimate, 0);
    const actualSum = rows.reduce((s, r) => s + r.actual, 0);
    const testSum = rows.reduce((s, r) => s + r.testTotal, 0);
    const ngSum = rows.reduce((s, r) => s + r.ng, 0);
    // 要確認: いずれかの効率が低 or NG流出率超過 (想定ケース差/潜在見逃しは単独では警告しない)
    const attention = rows.filter((r) =>
      band(r.totalEff, th.total) === 'low' ||
      band(r.designEff, th.design) === 'low' ||
      band(r.execEff, th.exec) === 'low' ||
      band(r.reviewEff, th.review) === 'low' ||
      (r.ngLeakRate !== null && r.ngLeakRate >= th.ngLeak.high)
    ).length;
    return {
      caseCount: rows.length,
      estimateSum,
      actualSum,
      diff: actualSum - estimateSum,
      testSum,
      ngSum,
      ngRate: testSum > 0 ? (ngSum / testSum) * 100 : null,
      totalEff: actualSum > 0 ? testSum / actualSum : null,
      attention,
    };
  }, [rows, th]);

  // システム別グルーピング (案件数降順)。各システムの効率サマリ + 低効率(要確認)案件も算出。
  const rowsBySystem = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.it.system || '(未設定)';
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    const tally = (grp: typeof rows, pick: (r: (typeof rows)[number]) => number | null, t: EffTh) => {
      const c = { high: 0, mid: 0, low: 0 };
      for (const r of grp) {
        const b = band(pick(r), t);
        if (b === 'high') c.high++;
        else if (b === 'mid') c.mid++;
        else if (b === 'low') c.low++;
      }
      return c;
    };
    return Array.from(map.entries())
      .map(([system, grp]) => {
        const testSum = grp.reduce((s, r) => s + r.testTotal, 0);
        const actualSum = grp.reduce((s, r) => s + r.actual, 0);
        const designDen = grp.reduce((s, r) => s + r.designA + r.implA, 0);
        const execDen = grp.reduce((s, r) => s + r.execA, 0);
        const reviewDen = grp.reduce((s, r) => s + r.reviewA, 0);
        const effStats = {
          total: { agg: effVal(testSum, actualSum), counts: tally(grp, (r) => r.totalEff, th.total) },
          design: { agg: effVal(testSum, designDen), counts: tally(grp, (r) => r.designEff, th.design) },
          exec: { agg: effVal(testSum, execDen), counts: tally(grp, (r) => r.execEff, th.exec) },
          review: { agg: effVal(testSum, reviewDen), counts: tally(grp, (r) => r.reviewEff, th.review) },
        };
        // 効率: 低(確認要) or 中(注意) の案件を抽出。指標名:程度 をラベル化
        const effAttn = grp.flatMap((r) => {
          const parts: { name: string; b: Band }[] = [];
          const add = (name: string, v: number | null, t: EffTh) => {
            const b = band(v, t);
            if (b === 'low' || b === 'mid') parts.push({ name, b });
          };
          add('総', r.totalEff, th.total);
          add('設計', r.designEff, th.design);
          add('実施', r.execEff, th.exec);
          add('レビュー', r.reviewEff, th.review);
          if (parts.length === 0) return [];
          const status: '確認要' | '注意' = parts.some((p) => p.b === 'low') ? '確認要' : '注意';
          const labels = parts.map((p) => `${p.name}:${p.b === 'low' ? '低' : '中'}`);
          return [{ r, status, labels }];
        });

        // 品質サマリ (システム単位)
        const qTestSum = grp.reduce((s, r) => s + r.testTotal, 0);
        const qNgSum = grp.reduce((s, r) => s + r.ng, 0);
        const tcngSum = grp.reduce((s, r) => s + r.tcng, 0);
        const japanNgSum = grp.reduce((s, r) => s + r.japanNg, 0);
        const leakDen = tcngSum + japanNgSum;
        const grpHasNgData = grp.some((r) => r.hasNgData);
        // 各品質指標を high/中/low に分類 (high=要確認)。対象外(データ無し)は null で除外
        const ngLeakCounts = tally(grp, (r) => r.ngLeakRate, th.ngLeak);
        const caseDiffCounts = tally(grp, (r) => (r.hasExpectedCase ? r.caseDiff : null), th.caseDiff);
        const sensenCounts = tally(grp, (r) => (r.hasExpectedNg ? r.sensen : null), th.sensen);
        const qualStats = {
          testSum: qTestSum,
          ngSum: qNgSum,
          ngRate: qTestSum > 0 ? (qNgSum / qTestSum) * 100 : null,
          ngLeakRate: leakDen > 0 ? (japanNgSum / leakDen) * 100 : (grpHasNgData ? 0 : null),
          ngLeakCounts,
          caseDiffCounts,
          sensenCounts,
        };
        // 品質: 高(品質低=確認要) or 中(注意) の案件を抽出。理由(指標名+値)をラベル化
        // 警告判定は NG流出率のみ。想定ケース差/潜在見逃しは単独では警告せず、
        // NG流出率が高い(確認要/注意)時に付帯情報として併記する。
        const qualAttn = grp.flatMap((r) => {
          if (r.ngLeakRate === null) return [];
          const b = band(r.ngLeakRate, th.ngLeak);
          if (b !== 'high' && b !== 'mid') return [];
          const status: '確認要' | '注意' = b === 'high' ? '確認要' : '注意';
          const labels = [`NG流出率 ${fmtPct(r.ngLeakRate)}`];
          if (r.hasExpectedCase) {
            const cb = band(r.caseDiff, th.caseDiff);
            if (cb === 'high' || cb === 'mid') labels.push(`想定ケース差 ${fmt(r.caseDiff)}`);
          }
          if (r.hasExpectedNg) {
            const sb = band(r.sensen, th.sensen);
            if (sb === 'high' || sb === 'mid') labels.push(`潜在見逃し ${fmt(r.sensen)}`);
          }
          return [{ r, status, labels }];
        });

        const effConfirm = effAttn.filter((x) => x.status === '確認要').length;
        const qualConfirm = qualAttn.filter((x) => x.status === '確認要').length;

        return { system, rows: grp, count: grp.length, totalEff: effVal(testSum, actualSum), effStats, effAttn, effConfirm, qualStats, qualAttn, qualConfirm };
      })
      .sort((a, b) => b.count - a.count);
  }, [rows, th]);

  // 担当者別グルーピング (確認要件数降順)。効率4指標 + NG流出率 + 見積対実績差分 を統合した単一の確認要・注意リストを持つ。
  const rowsByAssignee = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.it.assignee || '(未設定)';
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    const tally = (grp: typeof rows, pick: (r: (typeof rows)[number]) => number | null, t: EffTh) => {
      const c = { high: 0, mid: 0, low: 0 };
      for (const r of grp) {
        const b = band(pick(r), t);
        if (b === 'high') c.high++;
        else if (b === 'mid') c.mid++;
        else if (b === 'low') c.low++;
      }
      return c;
    };
    return Array.from(map.entries())
      .map(([assignee, grp]) => {
        const testSum = grp.reduce((s, r) => s + r.testTotal, 0);
        const actualSum = grp.reduce((s, r) => s + r.actual, 0);
        const estimateSum = grp.reduce((s, r) => s + r.estimate, 0);
        const designDen = grp.reduce((s, r) => s + r.designA + r.implA, 0);
        const execDen = grp.reduce((s, r) => s + r.execA, 0);
        const reviewDen = grp.reduce((s, r) => s + r.reviewA, 0);
        const effStats = {
          total: { agg: effVal(testSum, actualSum), counts: tally(grp, (r) => r.totalEff, th.total) },
          design: { agg: effVal(testSum, designDen), counts: tally(grp, (r) => r.designEff, th.design) },
          exec: { agg: effVal(testSum, execDen), counts: tally(grp, (r) => r.execEff, th.exec) },
          review: { agg: effVal(testSum, reviewDen), counts: tally(grp, (r) => r.reviewEff, th.review) },
        };
        const tcngSum = grp.reduce((s, r) => s + r.tcng, 0);
        const japanNgSum = grp.reduce((s, r) => s + r.japanNg, 0);
        const leakDen = tcngSum + japanNgSum;
        const grpHasNgData = grp.some((r) => r.hasNgData);
        const ngLeakRate = leakDen > 0 ? (japanNgSum / leakDen) * 100 : (grpHasNgData ? 0 : null);
        const ngLeakCounts = tally(grp, (r) => r.ngLeakRate, th.ngLeak);
        const diffSum = actualSum - estimateSum;
        const diffCounts = tally(grp, (r) => r.diff, th.diff);

        // 確認要・注意: 効率4指標(低=悪化) / NG流出率・見積対実績差分(高=悪化) を1件ずつ統合
        const attn = grp.flatMap((r) => {
          const parts: { label: string; severity: 'high' | 'mid' }[] = [];
          const addEff = (name: string, v: number | null, t: EffTh) => {
            const b = band(v, t);
            if (b === 'low') parts.push({ label: `${name}:低`, severity: 'high' });
            else if (b === 'mid') parts.push({ label: `${name}:中`, severity: 'mid' });
          };
          addEff('総効率', r.totalEff, th.total);
          addEff('設計効率', r.designEff, th.design);
          addEff('実施効率', r.execEff, th.exec);
          addEff('レビュー効率', r.reviewEff, th.review);
          if (r.ngLeakRate !== null) {
            const b = band(r.ngLeakRate, th.ngLeak);
            if (b === 'high') parts.push({ label: `NG流出率 ${fmtPct(r.ngLeakRate)}`, severity: 'high' });
            else if (b === 'mid') parts.push({ label: `NG流出率 ${fmtPct(r.ngLeakRate)}`, severity: 'mid' });
          }
          {
            const b = band(r.diff, th.diff);
            const diffText = `見積対実績差分 ${r.diff > 0 ? '+' : ''}${fmt(r.diff)}`;
            if (b === 'high') parts.push({ label: diffText, severity: 'high' });
            else if (b === 'mid') parts.push({ label: diffText, severity: 'mid' });
          }
          if (parts.length === 0) return [];
          const status: '確認要' | '注意' = parts.some((p) => p.severity === 'high') ? '確認要' : '注意';
          return [{ r, status, labels: parts.map((p) => p.label) }];
        });
        const confirmCount = attn.filter((x) => x.status === '確認要').length;

        return {
          assignee,
          rows: grp,
          count: grp.length,
          totalEff: effVal(testSum, actualSum),
          effStats,
          ngLeakRate,
          ngLeakCounts,
          diffSum,
          diffCounts,
          attn,
          confirmCount,
        };
      })
      .sort((a, b) => b.confirmCount - a.confirmCount || b.attn.length - a.attn.length);
  }, [rows, th]);

  // 年度: 月次(1-12)集計シリーズ
  // 業務年順(2,3,...,12,1)で並べたシリーズ。halfTypeで first=前6ヶ月/second=後6ヶ月/full=12ヶ月
  const monthlySeries = useMemo(() => {
    const order = halfMonthsOrder(halfType);
    const arr = order.map((mo) => ({
      month: mo,
      label: String(mo),
      caseCount: 0,
      testSum: 0,
      ngSum: 0,
      _actual: 0,
      _tcng: 0,
      _japanNg: 0,
    }));
    const idxMap = new Map<number, number>();
    order.forEach((m, i) => idxMap.set(m, i));
    for (const r of rows) {
      const mo = extractMonth(r.it.month);
      if (mo === null) continue;
      const i = idxMap.get(mo);
      if (i === undefined) continue;
      const b = arr[i];
      b.caseCount++;
      b.testSum += r.testTotal;
      b.ngSum += r.ng;
      b._actual += r.actual;
      b._tcng += r.tcng;
      b._japanNg += r.japanNg;
    }
    return arr.map((b) => {
      const leakDen = b._tcng + b._japanNg;
      return {
        ...b,
        totalEff: b._actual > 0 ? Number((b.testSum / b._actual).toFixed(2)) : null,
        ngLeakRate: leakDen > 0 ? Number(((b._japanNg / leakDen) * 100).toFixed(2)) : null,
      };
    });
  }, [rows, halfType]);

  // 半期集計 (通年モードで上期vs下期を比較するため、halfTypeに関係なく年度全体から集計)
  const halfAgg = useMemo(() => {
    if (periodType !== 'year') return null;
    const empty = () => ({
      caseCount: 0,
      testSum: 0,
      ngSum: 0,
      unexpectedNgSum: 0,
      _actual: 0,
      _estimate: 0,
      _tcng: 0,
      _japanNg: 0,
    });
    const first = empty();
    const second = empty();
    // rows は現在 halfType でフィルタ済み。通年モードで上下期を比較するため、
    // items から改めて業務年フル範囲で走査する
    const fullRange = halfPeriodRange(year, 'full');
    const firstMonths = new Set(halfMonthsOrder('first'));
    for (const it of items) {
      const key = parseMonthKey(it.month, year);
      if (key === null || key < fullRange.from || key > fullRange.to) continue;
      if (it.system && deselected.has(it.system)) continue;
      const mo = key % 100;
      const target = firstMonths.has(mo) ? first : second;
      target.caseCount++;
      target.testSum += num(it.testTotalCount);
      target.ngSum += num(it.bugCount);
      target.unexpectedNgSum += num(it.unexpectedNgCount);
      target._actual += num(it.actualTotal);
      target._estimate += num(it.estimateTotal);
      target._tcng += num(it.tcNgCount);
      target._japanNg += num(it.japanNgCount);
    }
    const finalize = (h: ReturnType<typeof empty>) => {
      const leakDen = h._tcng + h._japanNg;
      return {
        caseCount: h.caseCount,
        testSum: h.testSum,
        ngSum: h.ngSum,
        unexpectedNgSum: h.unexpectedNgSum,
        estimateSum: h._estimate,
        actualSum: h._actual,
        diff: Number((h._actual - h._estimate).toFixed(2)),
        ngRate: h.testSum > 0 ? (h.ngSum / h.testSum) * 100 : null,
        ngLeakRate: leakDen > 0 ? (h._japanNg / leakDen) * 100 : null,
        totalEff: h._actual > 0 ? h.testSum / h._actual : null,
      };
    };
    return { first: finalize(first), second: finalize(second) };
  }, [items, year, periodType, deselected]);

  // 年度: システム別集計 (円グラフ4種: 案件数 / 実績工数 / NG流出率 / 総効率)
  const systemPies = useMemo(() => {
    const m = new Map<string, { count: number; actual: number; estimate: number; test: number; tcng: number; japanNg: number }>();
    for (const r of rows) {
      const k = r.it.system || '(未設定)';
      const e = m.get(k) || { count: 0, actual: 0, estimate: 0, test: 0, tcng: 0, japanNg: 0 };
      e.count++;
      e.actual += r.actual;
      e.estimate += r.estimate;
      e.test += r.testTotal;
      e.tcng += r.tcng;
      e.japanNg += r.japanNg;
      m.set(k, e);
    }
    const entries = Array.from(m.entries());
    return {
      caseCount: entries.map(([name, v]) => ({ name, value: v.count })),
      actual: entries.map(([name, v]) => ({ name, value: Number(v.actual.toFixed(2)) })),
      estimate: entries.map(([name, v]) => ({ name, value: Number(v.estimate.toFixed(2)) })),
      testSum: entries.map(([name, v]) => ({ name, value: v.test })),
      ngLeak: entries.map(([name, v]) => {
        const d = v.tcng + v.japanNg;
        return { name, value: d > 0 ? Number(((v.japanNg / d) * 100).toFixed(2)) : 0 };
      }),
      totalEff: entries.map(([name, v]) => ({ name, value: v.actual > 0 ? Number((v.test / v.actual).toFixed(2)) : 0 })),
    };
  }, [rows]);

  // 基本: 主要3指標 + 副次指標
  const primaryKpis = [
    { label: '要確認件数', value: fmt(kpi.attention), tone: kpi.attention > 0 ? 'alert' : 'ok' as const },
    { label: '工数差分(総)', value: (kpi.diff > 0 ? '+' : '') + fmt(kpi.diff), tone: kpi.diff > 0 ? 'alert' : 'ok' as const },
    { label: 'NG率(総)', value: fmtPct(kpi.ngRate), tone: 'neutral' as const },
  ];
  const secondaryKpis = [
    { label: '案件数(総)', value: fmt(kpi.caseCount) },
    { label: '見積工数(総)', value: fmt(kpi.estimateSum) },
    { label: '実績工数(総)', value: fmt(kpi.actualSum) },
    { label: '用例件数(総)', value: fmt(kpi.testSum) },
    { label: 'NG件数(総)', value: fmt(kpi.ngSum) },
    { label: '効率(総)', value: fmtEff(kpi.totalEff) },
  ];

  const th0 = 'px-2 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
  const td0 = 'px-2 py-1.5 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';
  const tdNum = td0 + ' text-right tabular-nums';

  // 閾値入力 (小さな数値ボックス)
  const ThInput = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-16 border border-neutral-200 rounded px-1.5 py-0.5 text-xs text-right tabular-nums focus:outline-none focus:border-neutral-400"
    />
  );

  type ThKey = 'total' | 'design' | 'exec' | 'review' | 'ngLeak' | 'caseDiff' | 'sensen' | 'diff';
  const effRow = (key: ThKey, label: string, hiLabel = '高≥', midLabel = '中≥') => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-neutral-600">{label}</span>
      <span className="text-neutral-400">{hiLabel}</span>
      <ThInput value={th[key].high} onChange={(v) => updateTh({ ...th, [key]: { ...th[key], high: v } })} />
      <span className="text-neutral-400">{midLabel}</span>
      <ThInput value={th[key].mid} onChange={(v) => updateTh({ ...th, [key]: { ...th[key], mid: v } })} />
    </div>
  );

  // 分布バー。reverse=false: high=緑/low=赤(効率)。reverse=true: high=赤/low=緑(品質: 値大きいほど悪い)
  const HealthBar = ({ high, mid, low, reverse = false }: { high: number; mid: number; low: number; reverse?: boolean }) => {
    const total = high + mid + low;
    if (total === 0) return <div className="h-1.5 rounded-full bg-neutral-100" />;
    const pct = (n: number) => `${(n / total) * 100}%`;
    const hiCls = reverse ? 'bg-red-500' : 'bg-emerald-500';
    const loCls = reverse ? 'bg-emerald-500' : 'bg-red-500';
    return (
      <div className="flex h-1.5 rounded-full overflow-hidden bg-neutral-100">
        {high > 0 && <div style={{ width: pct(high) }} className={hiCls} />}
        {mid > 0 && <div style={{ width: pct(mid) }} className="bg-slate-400" />}
        {low > 0 && <div style={{ width: pct(low) }} className={loCls} />}
      </div>
    );
  };

  // 効率サマリカード (high=良)
  const summaryBlock = (label: string, agg: number | null, counts: { high: number; mid: number; low: number }) => (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-neutral-600">{label}</span>
        <span className="text-lg font-bold text-neutral-900 tabular-nums">{fmtEff(agg)}</span>
      </div>
      <div className="mt-1.5"><HealthBar high={counts.high} mid={counts.mid} low={counts.low} /></div>
      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span className={counts.low > 0 ? 'text-red-600 font-semibold' : 'text-neutral-400'}>{'効率低'} {counts.low}</span>
        <span className="text-slate-500">{'効率中'} {counts.mid}</span>
        <span className="text-emerald-600">{'効率高'} {counts.high}</span>
      </div>
    </div>
  );

  // 品質サマリカード (high=品質低/悪い。counts.high=品質低件数, counts.low=品質高)
  const qualBlock = (label: string, aggText: string, counts: { high: number; mid: number; low: number }) => (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-neutral-600">{label}</span>
        <span className="text-lg font-bold text-neutral-900 tabular-nums">{aggText}</span>
      </div>
      <div className="mt-1.5"><HealthBar high={counts.high} mid={counts.mid} low={counts.low} reverse /></div>
      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span className={counts.high > 0 ? 'text-red-600 font-semibold' : 'text-neutral-400'}>{'品質低'} {counts.high}</span>
        <span className="text-slate-500">{'品質中'} {counts.mid}</span>
        <span className="text-emerald-600">{'品質高'} {counts.low}</span>
      </div>
    </div>
  );

  // 見積対実績差分サマリカード (high=超過/悪い。counts.high=確認要件数, counts.low=適正件数) ─ 担当者別用
  const diffSummaryBlock = (aggText: string, counts: { high: number; mid: number; low: number }) => (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-neutral-600">見積対実績差分</span>
        <span className="text-lg font-bold text-neutral-900 tabular-nums">{aggText}</span>
      </div>
      <div className="mt-1.5"><HealthBar high={counts.high} mid={counts.mid} low={counts.low} reverse /></div>
      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span className={counts.high > 0 ? 'text-red-600 font-semibold' : 'text-neutral-400'}>{'確認要'} {counts.high}</span>
        <span className="text-slate-500">{'注意'} {counts.mid}</span>
        <span className="text-emerald-600">{'適正'} {counts.low}</span>
      </div>
    </div>
  );

  // 担当件数カード (健康バー無し、単純な件数表示) ─ 担当者別用
  const workloadBlock = (label: string, count: number) => (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-neutral-600">{label}</span>
        <span className="text-lg font-bold text-neutral-900 tabular-nums">{fmt(count)}</span>
      </div>
    </div>
  );

  // 年度チャートカード (右下ハンドルでサイズ自由調節可、flex-wrapで隣接カードは自動再配置)
  const ChartCard = ({ id, title, children }: { id: string; title: string; children: any }) => {
    const layout = chartLayouts[id] || {};
    const cardRef = useRef<HTMLDivElement>(null);
    const saveTimerRef = useRef<number | null>(null);
    useEffect(() => {
      const el = cardRef.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.contentBoxSize?.[0] ?? entry.contentRect;
          const width = 'inlineSize' in box ? (box as any).inlineSize : (box as DOMRectReadOnly).width;
          const height = 'blockSize' in box ? (box as any).blockSize : (box as DOMRectReadOnly).height;
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            updateChartLayout(id, { width: Math.round(width), height: Math.round(height) });
          }, 400);
        }
      });
      ro.observe(el);
      return () => {
        ro.disconnect();
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);
    if (layout.hidden) return null;
    return (
      <div
        ref={cardRef}
        className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col resize overflow-hidden"
        style={{
          width: layout.width ? `${layout.width}px` : 'calc(50% - 8px)',
          height: layout.height ?? 300,
          minHeight: 200,
          minWidth: 240,
          flexShrink: 0,
        }}
      >
        <div className="flex items-center justify-between mb-3 shrink-0 gap-2">
          <h4 className="text-sm font-semibold text-neutral-700 truncate">{title}</h4>
          <button
            type="button"
            onClick={() => updateChartLayout(id, { hidden: true })}
            className="text-neutral-300 hover:text-red-500 text-sm leading-none shrink-0"
            title="非表示"
          >×</button>
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>{children}</ResponsiveContainer>
        </div>
      </div>
    );
  };
  const axisTick = { fontSize: 10, fill: '#94a3b8' };
  const tipStyle = { borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' };
  const monthLabel = (l: any) => `${l}月`;

  // チャート表示/非表示の切替バー
  const ChartVisibilityBar = ({ metas }: { metas: { id: string; title: string }[] }) => {
    const hiddenCount = metas.filter((m) => chartLayouts[m.id]?.hidden).length;
    return (
      <div className="bg-white border border-neutral-200 rounded-xl px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-neutral-500 shrink-0">チャート表示:</span>
        {metas.map((m) => {
          const on = !chartLayouts[m.id]?.hidden;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => updateChartLayout(m.id, { hidden: on })}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50'}`}
              title={on ? '非表示にする' : '表示する'}
            >
              {m.title}
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => metas.forEach((m) => updateChartLayout(m.id, { hidden: false }))}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-800 shrink-0"
          >
            全て表示
          </button>
        )}
      </div>
    );
  };
  // システム別 円グラフカード (占比表示)
  const PieCard = ({ id, title, data }: { id: string; title: string; data: { name: string; value: number }[] }) => (
    <ChartCard id={id} title={title}>
      <PieChart>
        <Tooltip contentStyle={tipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" labelLine={false} label={(e: any) => (e.percent >= 0.05 ? `${(e.percent * 100).toFixed(0)}%` : '')}>
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartCard>
  );

  const effHead = (
    <thead>
      <tr>
        <th className={th0}>案件名</th>
        <th className={th0}>システム</th>
        <th className={th0}>状態</th>
        <th className={th0}>テスト件数</th>
        <th className={th0}>実績(設計)</th>
        <th className={th0}>実績(実装)</th>
        <th className={th0}>実績(実施)</th>
        <th className={th0}>実績(review)</th>
        <th className={th0}>実績総</th>
        <th className={th0}>差分</th>
        <th className={th0}>総効率</th>
        <th className={th0}>設計効率</th>
        <th className={th0}>実施効率</th>
        <th className={th0}>レビュー効率</th>
        <th className={th0}>備考</th>
        <th className={th0}>担当者</th>
        <th className={th0}>管理者</th>
      </tr>
    </thead>
  );

  // 備考セル (実績表と紐付くもののみ編集可、フォーカスアウトで保存)
  const renderCommentCell = (r: (typeof rows)[number]) => {
    if (!r.it.commentId) {
      return <td className={td0 + ' max-w-[160px] truncate'} title={r.it.comment}>{r.it.comment || '-'}</td>;
    }
    const val = commentDrafts[r.it.id] ?? r.it.comment;
    return (
      <td className={td0}>
        <div className="flex items-center gap-1">
          <input
            value={val}
            onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [r.it.id]: e.target.value }))}
            onBlur={() => saveComment(r.it.id, r.it.commentId, r.it.comment)}
            className="w-full min-w-[110px] rounded border border-transparent hover:border-neutral-200 focus:border-neutral-400 px-1 py-0.5 text-xs focus:outline-none"
            placeholder="-"
          />
          {commentSavingId === r.it.id && <Loader2 size={11} className="animate-spin text-neutral-400 shrink-0" />}
          {commentSavedId === r.it.id && <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />}
        </div>
      </td>
    );
  };

  const renderEffRow = (r: (typeof rows)[number]) => (
    <tr key={r.it.id} className="hover:bg-neutral-50">
      <td className={td0 + ' max-w-[220px] truncate'} title={r.it.projectName}>{r.it.projectName || '-'}</td>
      <td className={td0}>{r.it.system || '-'}</td>
      <td className={td0}>{r.it.status || '-'}</td>
      <td className={tdNum}>{fmt(r.testTotal)}</td>
      <td className={tdNum}>{fmt(r.designA)}</td>
      <td className={tdNum}>{fmt(r.implA)}</td>
      <td className={tdNum}>{fmt(r.execA)}</td>
      <td className={tdNum}>{fmt(r.reviewA)}</td>
      <td className={tdNum}>{fmt(r.actual)}</td>
      <td className={tdNum + (r.diff > 0 ? ' text-red-600' : '')}>{(r.diff > 0 ? '+' : '') + fmt(r.diff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.totalEff, th.total)]}>{fmtEff(r.totalEff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.designEff, th.design)]}>{fmtEff(r.designEff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.execEff, th.exec)]}>{fmtEff(r.execEff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.reviewEff, th.review)]}>{fmtEff(r.reviewEff)}</td>
      {renderCommentCell(r)}
      <td className={td0}>{r.it.assignee || '-'}</td>
      <td className={td0}>{r.it.manager || '-'}</td>
    </tr>
  );

  const qualHead = (
    <thead>
      <tr>
        <th className={th0}>案件名</th>
        <th className={th0}>システム</th>
        <th className={th0}>状態</th>
        <th className={th0}>テスト数</th>
        <th className={th0}>NG</th>
        <th className={th0}>日本テスト件数</th>
        <th className={th0}>日本NG件数</th>
        <th className={th0}>想定ケース</th>
        <th className={th0}>想定NG数</th>
        <th className={th0}>NG率</th>
        <th className={th0}>NG流出率</th>
        <th className={th0}>潜在見逃し</th>
        <th className={th0}>備考</th>
        <th className={th0}>担当者</th>
        <th className={th0}>管理者</th>
      </tr>
    </thead>
  );

  const renderQualRow = (r: (typeof rows)[number]) => (
    <tr key={r.it.id} className="hover:bg-neutral-50">
      <td className={td0 + ' max-w-[220px] truncate'} title={r.it.projectName}>{r.it.projectName || '-'}</td>
      <td className={td0}>{r.it.system || '-'}</td>
      <td className={td0}>{r.it.status || '-'}</td>
      <td className={tdNum}>{fmt(r.testTotal)}</td>
      <td className={tdNum}>{fmt(r.ng)}</td>
      <td className={tdNum}>{hasVal(r.it.japanTestCount) ? fmt(r.japanTest) : '-'}</td>
      <td className={tdNum}>{hasVal(r.it.japanNgCount) ? fmt(r.japanNg) : '-'}</td>
      <td className={tdNum + (r.hasExpectedCase && r.caseDiff >= th.caseDiff.high ? ' text-red-600 font-semibold' : '')}>
        {r.hasExpectedCase ? (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {r.hasExpectedCase && r.caseDiff >= th.caseDiff.high && <AlertTriangle size={11} />}{fmt(r.expectedCase)}
          </span>
        ) : '-'}
      </td>
      <td className={tdNum}>{r.hasExpectedNg ? fmt(r.expectedNg) : '-'}</td>
      <td className={tdNum}>{fmtPct(r.ngRate)}</td>
      <td className={tdNum + (r.ngLeakRate !== null && r.ngLeakRate >= th.ngLeak.high ? ' bg-red-50 text-red-600 font-semibold' : '')}>
        {r.ngLeakRate !== null && r.ngLeakRate >= th.ngLeak.high ? (
          <span className="inline-flex items-center gap-0.5 justify-end"><AlertTriangle size={11} />{fmtPct(r.ngLeakRate)}</span>
        ) : fmtPct(r.ngLeakRate)}
      </td>
      <td className={tdNum + (r.hasExpectedNg && r.sensen >= th.sensen.high ? ' text-red-600 font-semibold' : '')}>
        {r.hasExpectedNg ? (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {r.hasExpectedNg && r.sensen >= th.sensen.high && <AlertTriangle size={11} />}{fmt(r.sensen)}
          </span>
        ) : '-'}
      </td>
      {renderCommentCell(r)}
      <td className={td0}>{r.it.assignee || '-'}</td>
      <td className={td0}>{r.it.manager || '-'}</td>
    </tr>
  );

  // システム単位の品質サマリ (NG率統計 + 3カード: NG流出率 / 想定ケース差 / 潜在見逃し)
  const renderQualStats = (qs: (typeof rowsBySystem)[number]['qualStats']) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-neutral-600">NG率(総)</span>
          <span className="text-lg font-bold text-neutral-900 tabular-nums">{fmtPct(qs.ngRate)}</span>
        </div>
        <div className="mt-1 text-[11px] text-neutral-500">総テスト {fmt(qs.testSum)} / NG {fmt(qs.ngSum)}</div>
      </div>
      {qualBlock('NG流出率', fmtPct(qs.ngLeakRate), qs.ngLeakCounts)}
      {qualBlock('想定ケース差', '', qs.caseDiffCounts)}
      {qualBlock('潜在見逃し', '', qs.sensenCounts)}
    </div>
  );

  // 担当者別 詳細テーブル (案件名/システム/状態/テスト件数/実績総/設計・実施・レビュー効率/NG流出率/見積対実績差分/備考)
  const assigneeHead = (
    <thead>
      <tr>
        <th className={th0}>案件名</th>
        <th className={th0}>システム</th>
        <th className={th0}>状態</th>
        <th className={th0}>テスト件数</th>
        <th className={th0}>実績総</th>
        <th className={th0}>設計効率</th>
        <th className={th0}>実施効率</th>
        <th className={th0}>レビュー効率</th>
        <th className={th0}>NG流出率</th>
        <th className={th0}>見積対実績差分</th>
        <th className={th0}>備考</th>
      </tr>
    </thead>
  );

  const renderAssigneeRow = (r: (typeof rows)[number]) => {
    const diffBand = band(r.diff, th.diff);
    return (
      <tr key={r.it.id} className="hover:bg-neutral-50">
        <td className={td0 + ' max-w-[220px] truncate'} title={r.it.projectName}>{r.it.projectName || '-'}</td>
        <td className={td0}>{r.it.system || '-'}</td>
        <td className={td0}>{r.it.status || '-'}</td>
        <td className={tdNum}>{fmt(r.testTotal)}</td>
        <td className={tdNum}>{fmt(r.actual)}</td>
        <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.designEff, th.design)]}>{fmtEff(r.designEff)}</td>
        <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.execEff, th.exec)]}>{fmtEff(r.execEff)}</td>
        <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.reviewEff, th.review)]}>{fmtEff(r.reviewEff)}</td>
        <td className={tdNum + (r.ngLeakRate !== null && r.ngLeakRate >= th.ngLeak.high ? ' bg-red-50 text-red-600 font-semibold' : '')}>
          {fmtPct(r.ngLeakRate)}
        </td>
        <td className={tdNum + (diffBand === 'high' ? ' bg-red-50 text-red-600 font-semibold' : diffBand === 'mid' ? ' text-amber-600 font-semibold' : '')}>
          {(r.diff > 0 ? '+' : '') + fmt(r.diff)}
        </td>
        {renderCommentCell(r)}
      </tr>
    );
  };

  // ── 報告書 ──
  const reportMonthKey = periodType === 'year'
    ? `${year}`
    : `${year}${month === 'all' ? '' : String(month).padStart(2, '0')}`;
  const reportSystems = allSystems.filter((s) => !deselected.has(s));

  // 確認要案件サマリー: 効率・品質の「確認要」を案件単位で統合 (原因ラベル結合・コメント=理由)
  const confirmCases = useMemo(() => {
    const map = new Map<string, { name: string; system: string; labels: string[]; comment: string }>();
    for (const g of rowsBySystem) {
      for (const a of [...g.effAttn, ...g.qualAttn]) {
        if (a.status !== '確認要') continue;
        const id = a.r.it.id;
        const ex = map.get(id);
        if (ex) ex.labels.push(...a.labels);
        else map.set(id, {
          name: a.r.it.projectName || '-',
          system: a.r.it.system || '-',
          labels: [...a.labels],
          comment: a.r.it.comment || '',
        });
      }
    }
    return Array.from(map.values());
  }, [rowsBySystem]);

  const buildReportGroups = (): ReportSystemGroup[] =>
    rowsBySystem.map((g) => ({
      system: g.system,
      count: g.count,
      totalEff: g.totalEff,
      testSum: g.qualStats.testSum,
      ngSum: g.qualStats.ngSum,
      ngRate: g.qualStats.ngRate,
      ngLeakRate: g.qualStats.ngLeakRate,
      effStats: g.effStats,
      qualStats: g.qualStats,
      lowCases: g.effAttn.map(({ r, status, labels }) => ({ name: r.it.projectName || '-', status, labels })),
      attnCases: g.qualAttn.map(({ r, status, labels }) => ({ name: r.it.projectName || '-', status, labels })),
      rows: g.rows.map((r) => ({
        projectName: r.it.projectName || '-',
        status: r.it.status || '-',
        assignee: r.it.assignee || '-',
        manager: r.it.manager || '-',
        estimate: r.estimate,
        actual: r.actual,
        diff: r.diff,
        designA: r.designA,
        implA: r.implA,
        execA: r.execA,
        reviewA: r.reviewA,
        designEff: r.designEff,
        execEff: r.execEff,
        reviewEff: r.reviewEff,
        testTotal: r.testTotal,
        ng: r.ng,
        ngRate: r.ngRate,
        japanTest: r.japanTest,
        hasJapanTest: hasVal(r.it.japanTestCount),
        japanNg: r.japanNg,
        hasJapanNg: hasVal(r.it.japanNgCount),
        expectedCase: r.expectedCase,
        hasExpectedCase: r.hasExpectedCase,
        caseDiff: r.caseDiff,
        expectedNg: r.expectedNg,
        sensen: r.sensen,
        hasExpectedNg: r.hasExpectedNg,
        ngLeakRate: r.ngLeakRate,
        comment: r.it.comment,
      })),
    }));

  const handleCreateReport = () => {
    if (rowsBySystem.length === 0) return;
    const html = buildCaseStatsReportHtml(buildReportGroups(), {
      monthKey: reportMonthKey,
      periodType,
      systems: reportSystems,
      thresholds: th,
      confirmCases,
      overall: {
        caseCount: kpi.caseCount,
        estimateSum: kpi.estimateSum,
        actualSum: kpi.actualSum,
        diff: kpi.diff,
        testSum: kpi.testSum,
        ngSum: kpi.ngSum,
        ngRate: kpi.ngRate,
        totalEff: kpi.totalEff,
        attention: kpi.attention,
      },
    });
    setReportHtml(html);
    setHistoryNotice(null);
    setReportOpen(true);
  };

  const handleSaveReportPdf = async () => {
    const iframe = reportIframeRef.current;
    const liveRoot = iframe?.contentDocument?.documentElement;
    const html = liveRoot ? `<!DOCTYPE html>\n${liveRoot.outerHTML}` : reportHtml;
    const title = caseStatsReportTitle(reportSystems, reportMonthKey, periodType);
    setSavingPdf(true);
    setHistoryNotice(null);
    try {
      const res = await fetch('/api/test-center/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'report',
          areaId: 'case-stats',
          monthKey: reportMonthKey,
          title,
          htmlContent: html,
          savedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error || `保存失敗 (${res.status})`);
      }
      setHistoryNotice('Notion に履歴を保存しました');
    } catch (err) {
      setHistoryNotice('履歴の保存に失敗しました：' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSavingPdf(false);
    }
    const win = window.open('', '_blank');
    if (!win) {
      setHistoryNotice('ポップアップがブロックされました。許可してから再試行してください。');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.document.title = title;
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  return (
    <>
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-neutral-500">
        <button type="button" onClick={onHome} className="hover:text-neutral-900 hover:underline transition-colors">ホーム</button>
        <ChevronRight size={14} className="text-neutral-300 shrink-0" />
        <button type="button" onClick={onBack} className="hover:text-neutral-900 hover:underline transition-colors">TestCenter</button>
        <ChevronRight size={14} className="text-neutral-300 shrink-0" />
        <span className="text-neutral-900 font-medium">案件一覧</span>
      </nav>

      {/* Title bar */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-neutral-900">{'案件一覧'}</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 月次 / 年度 切替 (スライド式セグメント) */}
          <div className="relative flex w-36 rounded-lg bg-neutral-100 p-1 text-sm font-medium">
            <span
              className="absolute inset-y-1 rounded-md bg-white shadow-sm transition-all duration-200 ease-out"
              style={{ left: periodType === 'year' ? '50%' : '4px', width: 'calc(50% - 4px)' }}
            />
            {(['month', 'year'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodType(p)}
                className={`relative z-10 flex-1 py-1 rounded-md transition-colors ${periodType === p ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
              >
                {p === 'month' ? '月次' : '年度'}
              </button>
            ))}
          </div>
          {periodType === 'year' ? (
            // 年度モード: 年+半期を1つの select に統合 (通年/上期/下期)
            <select
              value={`${year}:${halfType}`}
              onChange={(e) => {
                const [y, h] = e.target.value.split(':');
                setYear(Number(y));
                setHalfType(h as HalfType);
              }}
              className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
            >
              {availableYears.flatMap((y) => (
                (['full', 'first', 'second'] as HalfType[]).map((h) => (
                  <option key={`${y}:${h}`} value={`${y}:${h}`}>
                    {y}年 {h === 'full' ? '通年' : h === 'first' ? '上期' : '下期'}
                  </option>
                ))
              ))}
            </select>
          ) : (
            <>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select
                value={month === 'all' ? 'all' : String(month)}
                onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
              >
                <option value="all">{'全月'}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={fetchStats}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {'更新'}
          </button>
          {periodType === 'month' && (
            <button
              type="button"
              onClick={handleCreateReport}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
            >
              <FileText size={14} />
              報告書作成
            </button>
          )}
          {updatedAt && (
            <span className="text-[11px] text-neutral-400 whitespace-nowrap">
              {('最終更新 ') + new Date(updatedAt).toLocaleString('ja-JP')}
            </span>
          )}
        </div>
      </div>

      {/* システム選択 */}
      {allSystems.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-white border border-neutral-200 rounded-xl px-4 py-2.5">
          <span className="text-xs font-semibold text-neutral-500 shrink-0">システム:</span>
          <button
            type="button"
            onClick={() => setDeselected(new Set())}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${deselected.size === 0 ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'}`}
          >
            すべて
          </button>
          {allSystems.map((sys) => {
            const on = !deselected.has(sys);
            return (
              <button
                key={sys}
                type="button"
                onClick={() =>
                  setDeselected((prev) => {
                    const next = new Set(prev);
                    if (next.has(sys)) next.delete(sys);
                    else next.add(sys);
                    return next;
                  })
                }
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50'}`}
              >
                {sys}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {periodType === 'month' ? (
      <>
      {/* ═══ 基本 ═══ */}
      <section className="space-y-3">
        <h3 className="block w-full rounded-lg bg-neutral-900 text-white text-sm font-bold px-4 py-2">{'基本'}</h3>
        {/* 主要3指標 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {primaryKpis.map((c) => (
            <div
              key={c.label}
              className={
                'rounded-xl px-5 py-4 border ' +
                (c.tone === 'alert' ? 'bg-red-50 border-red-200' : c.tone === 'ok' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-neutral-200')
              }
            >
              <p className={'text-xs font-semibold tracking-wider ' + (c.tone === 'alert' ? 'text-red-500' : c.tone === 'ok' ? 'text-emerald-600' : 'text-neutral-400')}>{c.label}</p>
              <p className={'text-3xl font-bold mt-1 tabular-nums ' + (c.tone === 'alert' ? 'text-red-700' : c.tone === 'ok' ? 'text-emerald-700' : 'text-neutral-900')}>{c.value}</p>
            </div>
          ))}
        </div>
        {/* 副次指標 */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {secondaryKpis.map((c) => (
            <div key={c.label} className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
              <p className="text-[10px] text-neutral-400 font-semibold tracking-wider truncate">{c.label}</p>
              <p className="text-base font-bold text-neutral-800 mt-0.5 tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 詳細 ═══ */}
      <section className="space-y-4">
        <h3 className="block w-full rounded-lg bg-blue-600 text-white text-sm font-bold px-4 py-2">
          {'詳細'}
        </h3>

        {/* ─ 効率 ─ */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setEffOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
          >
            {effOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="text-sm font-bold text-neutral-800">{'効率'}</span>
          </button>

          {effOpen && (
            <div className="p-4 space-y-4">
              {/* 閾値設定 */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
                <span className="text-[11px] font-semibold text-neutral-400 w-full">{'閾値設定 (編集可・自動保存)'}</span>
                {effRow('total', '総効率')}
                {effRow('design', '設計効率')}
                {effRow('exec', '実施効率')}
                {effRow('review', 'レビュー効率')}
              </div>

              {/* システム別: 要確認(低効率)多い順・折りたたみ */}
              <div className="space-y-3">
                {[...rowsBySystem].sort((a, b) => b.effConfirm - a.effConfirm || b.effAttn.length - a.effAttn.length).map((g) => {
                  const key = `eff:${g.system}`;
                  const open = isSysOpen(key, g.effAttn.length > 0);
                  const c = g.effStats.total.counts;
                  const cautionCount = g.effAttn.length - g.effConfirm;
                  return (
                    <div key={g.system} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSys(key, g.effAttn.length > 0)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
                      >
                        {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                        <span className="text-sm font-bold text-neutral-800 truncate">{g.system}</span>
                        <div className="w-24 shrink-0 hidden sm:block"><HealthBar high={c.high} mid={c.mid} low={c.low} /></div>
                        <span className="text-xs text-neutral-500 shrink-0">総効率 <b className="text-neutral-900 tabular-nums">{fmtEff(g.totalEff)}</b></span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {g.effConfirm > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
                              <AlertTriangle size={11} />確認要 {g.effConfirm}
                            </span>
                          )}
                          {cautionCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-0.5">
                              注意 {cautionCount}
                            </span>
                          )}
                          <span className="text-xs text-neutral-400">案件 {g.count}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="p-3 space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {summaryBlock('総効率', g.effStats.total.agg, g.effStats.total.counts)}
                            {summaryBlock('設計効率', g.effStats.design.agg, g.effStats.design.counts)}
                            {summaryBlock('実施効率', g.effStats.exec.agg, g.effStats.exec.counts)}
                            {summaryBlock('レビュー効率', g.effStats.review.agg, g.effStats.review.counts)}
                          </div>
                          {g.effAttn.length > 0 && (
                            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
                              <p className="text-xs font-bold text-neutral-700 mb-2 flex items-center gap-1">
                                <AlertTriangle size={12} />確認要・注意 {g.effAttn.length}件
                              </p>
                              <ul className="space-y-1">
                                {g.effAttn.map(({ r, status, labels }) => (
                                  <li key={r.it.id} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="truncate text-neutral-800" title={r.it.projectName}>{r.it.projectName || '-'}</span>
                                    <span className="shrink-0 flex items-center gap-2">
                                      <span className={status === '確認要' ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>{status}</span>
                                      <span className="text-neutral-500">{labels.join(' / ')}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                            <table className="w-full border-collapse">
                              {effHead}
                              <tbody>{g.rows.map(renderEffRow)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <p className="text-center text-sm text-neutral-400 py-8">{loading ? '読み込み中...' : '該当データなし'}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─ 品質 ─ */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setQualOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
          >
            {qualOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="text-sm font-bold text-neutral-800">{'品質'}</span>
          </button>

          {qualOpen && (
            <div className="p-4 space-y-4">
              {/* 閾値設定 */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
                <span className="text-[11px] font-semibold text-neutral-400 w-full">{'閾値設定 (編集可・自動保存 / 値が大きいほど悪い)'}</span>
                {effRow('ngLeak', 'NG流出率(%)')}
                {effRow('caseDiff', '想定ケース差')}
                {effRow('sensen', '潜在見逃し')}
              </div>

              {/* システム別: 要確認 多い順・折りたたみ */}
              <div className="space-y-3">
                {[...rowsBySystem].sort((a, b) => b.qualConfirm - a.qualConfirm || b.qualAttn.length - a.qualAttn.length).map((g) => {
                  const key = `qual:${g.system}`;
                  const open = isSysOpen(key, g.qualAttn.length > 0);
                  const cautionCount = g.qualAttn.length - g.qualConfirm;
                  const safe = g.count - g.qualAttn.length;
                  return (
                    <div key={g.system} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSys(key, g.qualAttn.length > 0)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
                      >
                        {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                        <span className="text-sm font-bold text-neutral-800 truncate">{g.system}</span>
                        <div className="w-24 shrink-0 hidden sm:block" title={`安全${safe} / 注意${cautionCount} / 確認要${g.qualConfirm}`}><HealthBar high={safe} mid={cautionCount} low={g.qualConfirm} /></div>
                        <span className="text-xs text-neutral-500 shrink-0">NG率 <b className="text-neutral-900 tabular-nums">{fmtPct(g.qualStats.ngRate)}</b></span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {g.qualConfirm > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
                              <AlertTriangle size={11} />確認要 {g.qualConfirm}
                            </span>
                          )}
                          {cautionCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-0.5">
                              注意 {cautionCount}
                            </span>
                          )}
                          <span className="text-xs text-neutral-400">案件 {g.count}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="p-3 space-y-3">
                          {renderQualStats(g.qualStats)}
                          {g.qualAttn.length > 0 && (
                            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
                              <p className="text-xs font-bold text-neutral-700 mb-2 flex items-center gap-1">
                                <AlertTriangle size={12} />確認要・注意 {g.qualAttn.length}件
                              </p>
                              <ul className="space-y-1">
                                {g.qualAttn.map(({ r, status, labels }) => (
                                  <li key={r.it.id} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="truncate text-neutral-800" title={r.it.projectName}>{r.it.projectName || '-'}</span>
                                    <span className="shrink-0 flex items-center gap-2">
                                      <span className={status === '確認要' ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>{status}</span>
                                      <span className="text-neutral-500">{labels.join(' / ')}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                            <table className="w-full border-collapse">
                              {qualHead}
                              <tbody>{g.rows.map(renderQualRow)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <p className="text-center text-sm text-neutral-400 py-8">{loading ? '読み込み中...' : '該当データなし'}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─ 担当者別 ─ */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setAssigneeOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
          >
            {assigneeOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="text-sm font-bold text-neutral-800">{'担当者別'}</span>
          </button>

          {assigneeOpen && (
            <div className="p-4 space-y-4">
              {/* 閾値設定: 効率/NG流出率は効率・品質タブと共通。見積対実績差分のみここで設定 */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
                <span className="text-[11px] font-semibold text-neutral-400 w-full">
                  {'閾値設定 (編集可・自動保存 / 効率・NG流出率は効率・品質タブと共通、見積対実績差分は値が大きいほど悪い)'}
                </span>
                {effRow('diff', '見積対実績差分(人日)')}
              </div>

              {/* 担当者別: 要確認 多い順・折りたたみ */}
              <div className="space-y-3">
                {rowsByAssignee.map((a) => {
                  const key = `assignee:${a.assignee}`;
                  const open = isSysOpen(key, a.attn.length > 0);
                  const cautionCount = a.attn.length - a.confirmCount;
                  const safe = a.count - a.attn.length;
                  return (
                    <div key={a.assignee} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSys(key, a.attn.length > 0)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
                      >
                        {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                        <span className="text-sm font-bold text-neutral-800 truncate">{a.assignee}</span>
                        <div className="w-24 shrink-0 hidden sm:block" title={`安全${safe} / 注意${cautionCount} / 確認要${a.confirmCount}`}><HealthBar high={safe} mid={cautionCount} low={a.confirmCount} /></div>
                        <span className="text-xs text-neutral-500 shrink-0">総効率 <b className="text-neutral-900 tabular-nums">{fmtEff(a.totalEff)}</b></span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {a.confirmCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
                              <AlertTriangle size={11} />確認要 {a.confirmCount}
                            </span>
                          )}
                          {cautionCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-0.5">
                              注意 {cautionCount}
                            </span>
                          )}
                          <span className="text-xs text-neutral-400">担当 {a.count}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="p-3 space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {summaryBlock('総効率', a.effStats.total.agg, a.effStats.total.counts)}
                            {summaryBlock('設計効率', a.effStats.design.agg, a.effStats.design.counts)}
                            {summaryBlock('実施効率', a.effStats.exec.agg, a.effStats.exec.counts)}
                            {summaryBlock('レビュー効率', a.effStats.review.agg, a.effStats.review.counts)}
                            {qualBlock('NG流出率', fmtPct(a.ngLeakRate), a.ngLeakCounts)}
                            {diffSummaryBlock((a.diffSum > 0 ? '+' : '') + fmt(a.diffSum), a.diffCounts)}
                            {workloadBlock('担当件数', a.count)}
                          </div>
                          {a.attn.length > 0 && (
                            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
                              <p className="text-xs font-bold text-neutral-700 mb-2 flex items-center gap-1">
                                <AlertTriangle size={12} />確認要・注意 {a.attn.length}件
                              </p>
                              <ul className="space-y-1">
                                {a.attn.map(({ r, status, labels }) => (
                                  <li key={r.it.id} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="truncate text-neutral-800" title={r.it.projectName}>{r.it.projectName || '-'}</span>
                                    <span className="shrink-0 flex items-center gap-2">
                                      <span className={status === '確認要' ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>{status}</span>
                                      <span className="text-neutral-500">{labels.join(' / ')}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                            <table className="w-full border-collapse">
                              {assigneeHead}
                              <tbody>{a.rows.map(renderAssigneeRow)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <p className="text-center text-sm text-neutral-400 py-8">{loading ? '読み込み中...' : '該当データなし'}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─ インシデント確認 (旧 BUG流出について) ─ */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setIncidentOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
          >
            {incidentOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold text-neutral-800">インシデント確認</span>
              <span className="text-xs text-neutral-500 mt-0.5">テストセンターに関連する案件を確認し、調査結果を記録する</span>
            </div>
          </button>
          {incidentOpen && (
          <div className="p-4 space-y-3">
          {bugLeak ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-neutral-400 font-semibold tracking-wider">総数</p>
                  <p className="text-xl font-bold text-neutral-800 mt-0.5 tabular-nums">{bugLeak.total}</p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-neutral-400 font-semibold tracking-wider">テストセンター関連</p>
                  <p className="text-xl font-bold text-red-600 mt-0.5 tabular-nums">{bugLeak.tcRelated}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-500 mb-1.5">システム別件数</p>
                {bugLeak.bySystem.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {bugLeak.bySystem.map((s) => (
                      <span key={s.system} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs">
                        <span className="text-neutral-600">{s.system}</span>
                        <span className="font-bold text-neutral-900 tabular-nums">{s.count}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400">該当データなし</p>
                )}
              </div>

              {/* 詳細テーブル */}
              {bugLeak.items.length > 0 && (
                <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th0}>サービス</th>
                        <th className={th0}>案件別</th>
                        <th className={th0}>CMDB番号</th>
                        <th className={th0}>機能(画面)名</th>
                        <th className={th0}>障害内容</th>
                        <th className={th0}>指摘工程</th>
                        <th className={th0}>指摘分類</th>
                        <th className={th0}>原因区分</th>
                        <th className={th0}>リリース時期</th>
                        <th className={th0}>TestCenter確認結果</th>
                        <th className={th0}>状態</th>
                        <th className={th0}>改善可/不可</th>
                        <th className={th0}>責任</th>
                        <th className={th0}>チェックリスト</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bugLeak.items.map((b, i) => (
                        <tr key={i} className="hover:bg-neutral-50">
                          <td className={td0}>{b.system || '-'}</td>
                          <td className={td0}>{b.caseMonth || '-'}</td>
                          <td className={td0}>{b.cmdb || '-'}</td>
                          <td className={td0 + ' max-w-[160px] truncate'} title={b.feature}>{b.feature || '-'}</td>
                          <td className={td0 + ' max-w-[240px] truncate'} title={b.defect}>{b.defect || '-'}</td>
                          <td className={td0}>{b.process || '-'}</td>
                          <td className={td0}>{b.category || '-'}</td>
                          <td className={td0}>{b.cause || '-'}</td>
                          <td className={td0}>{b.releaseTime || '-'}</td>
                          <td className={td0 + ' max-w-[180px] truncate'} title={b.tcResult}>{b.tcResult || '-'}</td>
                          <td className={td0}>{b.status || '-'}</td>
                          <td className={td0}>{b.improvable || '-'}</td>
                          <td className={td0 + ' text-center'}>{b.responsible ? '✓' : '-'}</td>
                          <td className={td0 + ' max-w-[160px] truncate'} title={b.checklist}>{b.checklist || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400">{loading ? '読み込み中...' : '該当データなし'}</p>
          )}
          </div>
          )}
        </div>

        {/* ─ 図形 (月次モード用、レポート出力対象外) ─ */}
        {rows.length > 0 && (
          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setChartsOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
            >
              {chartsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="text-sm font-bold text-neutral-800">図形</span>
            </button>
            {chartsOpen && (
              <div className="p-4 space-y-3">
                <ChartVisibilityBar metas={MONTHLY_CHART_META} />
                <div className="flex flex-wrap gap-4 items-start">
                  <PieCard id="m.pi.estimate" title="システム別 見積時間比率" data={systemPies.estimate} />
                  <PieCard id="m.pi.actual" title="システム別 実績作業時間比率" data={systemPies.actual} />
                  <PieCard id="m.pi.testSum" title="システム別 テストケース件数比率" data={systemPies.testSum} />
                </div>
              </div>
            )}
          </div>
        )}

      </section>
      </>
      ) : (
      /* ═══ 年度: 月別トレンド ═══ */
      <section className="space-y-4">
        <h3 className="block w-full rounded-lg bg-neutral-900 text-white text-sm font-bold px-4 py-2">
          {`KPI (${year}年度 ${halfType === 'full' ? '通年' : halfType === 'first' ? '上期' : '下期'})`}
        </h3>

        {/* KPI目標 (上期/下期モードのみ表示、通年は非表示) */}
        {halfType !== 'full' && (() => {
          const targets = halfType === 'first' ? kpiTargets.first : kpiTargets.second;
          if (targets.length === 0) return null;
          const label = halfType === 'first' ? '上期目標' : '下期目標';
          return (
            <div>
              <h4 className="inline-block rounded-md bg-indigo-600 text-white text-xs font-bold px-3 py-1 mb-2">{label}</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {targets.map((t) => (
                  <div key={t.label} className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5">
                    <p className="text-[10px] text-indigo-500 font-semibold tracking-wider truncate">{t.label}</p>
                    <p className="text-xl font-bold text-indigo-900 mt-0.5 tabular-nums">{t.value}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* KPI パネル: 品質(4) + 効率・規模(4) の2グループに分けて表示 */}
        {halfAgg && (() => {
          type Half = typeof halfAgg.first;
          type FmtFn = (v: number | null) => string;
          const fmtNum: FmtFn = (v) => v === null ? '-' : fmt(v);
          const fmtDiff = (v: number): string => (v > 0 ? '+' : '') + fmt(v);
          const fmtDiffPct = (v: number): string => (v > 0 ? '+' : '') + fmt(v) + '%';
          type Def = { key: string; desc: string; pick: (h: Half) => number | null; higherIsWorse: boolean; fmt: FmtFn; diffFmt: (v: number) => string };
          // 品質グループ (4項)
          const qualityDefs: Def[] = [
            { key: 'NG率(総)',       desc: 'NG率(総) = 総NG件数 ÷ 総テスト件数 × 100\n各案件のNG数と検出テスト件数を合算して算出',                            pick: (h) => h.ngRate,          higherIsWorse: true, fmt: fmtPct, diffFmt: fmtDiffPct },
            { key: 'NG流出率(総)',   desc: 'NG流出率(総) = 日本側NG件数 ÷ (TCNG数 + 日本側NG件数) × 100\n日本側で検出されたNGの割合(テスト後流出したNG比率)', pick: (h) => h.ngLeakRate,      higherIsWorse: true, fmt: fmtPct, diffFmt: fmtDiffPct },
            { key: '想定外NG数(総)', desc: '想定外NG数(総) = 各案件の想定外NG数の合計\n仕様外・想定外の重大不具合を集計',                                   pick: (h) => h.unexpectedNgSum, higherIsWorse: true, fmt: fmtNum, diffFmt: fmtDiff },
            { key: '総NG件数',       desc: '総NG件数 = 各案件のNG数の合計\n対象期間内で検出された全NG件数',                                                  pick: (h) => h.ngSum,           higherIsWorse: true, fmt: fmtNum, diffFmt: fmtDiff },
          ];
          // 効率・規模グループ (4項)
          const efficiencyDefs: Def[] = [
            { key: '効率(総)',       desc: '効率(総) = 総テスト件数 ÷ 実績工数(合計)\n1人日あたりのテスト件数(生産性の指標)',                     pick: (h) => h.totalEff,        higherIsWorse: false, fmt: fmtEff, diffFmt: fmtDiff },
            { key: '見積対実績差分', desc: '見積対実績差分 = 実績工数(合計) − 見積工数(合計)\nプラス=見積超過、マイナス=見積内(工数管理の指標)', pick: (h) => h.diff,            higherIsWorse: true,  fmt: (v) => v === null ? '-' : fmtDiff(v), diffFmt: fmtDiff },
            { key: '案件数(総)',     desc: '案件数(総) = 対象期間内の案件数の合計',                                                                pick: (h) => h.caseCount,       higherIsWorse: false, fmt: fmtNum, diffFmt: fmtDiff },
            { key: '総テスト件数',   desc: '総テスト件数 = 各案件のテスト件数の合計\n対象期間内で実施したテスト用例の総数',                       pick: (h) => h.testSum,         higherIsWorse: false, fmt: fmtNum, diffFmt: fmtDiff },
          ];
          const groupHead = (label: string) => (
            <h4 className="inline-block rounded-md bg-neutral-900 text-white text-xs font-bold px-3 py-1 mb-2">{label}</h4>
          );
          if (halfType === 'full') {
            const renderTable = (defs: Def[]) => (
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-4 text-xs font-semibold text-neutral-500 bg-neutral-50 border-b border-neutral-200">
                  <div className="px-3 py-2">指標</div>
                  <div className="px-3 py-2 text-right">上期</div>
                  <div className="px-3 py-2 text-right">下期</div>
                  <div className="px-3 py-2 text-right">差分</div>
                </div>
                {defs.map((d) => {
                  const a = d.pick(halfAgg.first);
                  const b = d.pick(halfAgg.second);
                  const diff = a !== null && b !== null ? Number((b - a).toFixed(2)) : null;
                  const cls = diff === null || diff === 0
                    ? 'text-neutral-500'
                    : d.higherIsWorse
                      ? (diff > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold')
                      : (diff > 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold');
                  return (
                    <div key={d.key} title={d.desc} className="grid grid-cols-4 text-sm border-t border-neutral-100 first:border-t-0 cursor-help hover:bg-neutral-50/60">
                      <div className="px-3 py-2 text-neutral-700">{d.key}</div>
                      <div className="px-3 py-2 text-right tabular-nums text-neutral-800">{d.fmt(a)}</div>
                      <div className="px-3 py-2 text-right tabular-nums text-neutral-800">{d.fmt(b)}</div>
                      <div className={`px-3 py-2 text-right tabular-nums ${cls}`}>{diff === null ? '-' : d.diffFmt(diff)}</div>
                    </div>
                  );
                })}
              </div>
            );
            return (
              <div className="space-y-4">
                <div>{groupHead('品質')}{renderTable(qualityDefs)}</div>
                <div>{groupHead('効率・規模')}{renderTable(efficiencyDefs)}</div>
              </div>
            );
          }
          const h = halfType === 'first' ? halfAgg.first : halfAgg.second;
          const renderCards = (defs: Def[]) => (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {defs.map((d) => (
                <div key={d.key} title={d.desc} className="bg-white border border-neutral-200 rounded-lg px-3 py-2.5 cursor-help hover:border-neutral-300 transition-colors">
                  <p className="text-[10px] text-neutral-400 font-semibold tracking-wider truncate">{d.key}</p>
                  <p className="text-xl font-bold text-neutral-800 mt-0.5 tabular-nums">{d.fmt(d.pick(h))}</p>
                </div>
              ))}
            </div>
          );
          return (
            <div className="space-y-4">
              <div>{groupHead('品質')}{renderCards(qualityDefs)}</div>
              <div>{groupHead('効率・規模')}{renderCards(efficiencyDefs)}</div>
            </div>
          );
        })()}

        {rows.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 py-12">{loading ? '読み込み中...' : '該当データなし'}</p>
        ) : (
          <>
          <ChartVisibilityBar metas={YEARLY_CHART_META} />
          <div className="flex flex-wrap gap-4 items-start">
            <ChartCard id="y.caseCount" title="月別案件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="caseCount" name="案件数" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartCard>

            <ChartCard id="y.testSum" title="月別テスト件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="testSum" name="テスト件数" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartCard>

            <ChartCard id="y.ngSum" title="月別NG件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="ngSum" name="NG件数" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartCard>

            <ChartCard id="y.ngLeak" title="月別NG流出率(%)">
              <LineChart data={monthlySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} unit="%" />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} formatter={(v: any) => (v === null ? '-' : `${v}%`)} />
                <Line type="monotone" dataKey="ngLeakRate" name="NG流出率" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ChartCard>

            <ChartCard id="y.totalEff" title="月別総効率">
              <LineChart data={monthlySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} formatter={(v: any) => (v === null ? '-' : v)} />
                <Line type="monotone" dataKey="totalEff" name="総効率" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ChartCard>

            <PieCard id="y.pi.caseCount" title="システム別 案件数" data={systemPies.caseCount} />
            <PieCard id="y.pi.actual" title="システム別 実績工数" data={systemPies.actual} />
            <PieCard id="y.pi.ngLeak" title="システム別 NG流出率" data={systemPies.ngLeak} />
            <PieCard id="y.pi.totalEff" title="システム別 総効率" data={systemPies.totalEff} />
          </div>
          </>
        )}
      </section>
      )}
    </div>

    {reportOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8">
        <div className="h-full max-w-[96rem] mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h3 className="text-base font-semibold text-neutral-900 whitespace-nowrap">案件一覧報告書</h3>
              <span className="text-xs text-neutral-400 truncate">プレビュー内で直接編集してから PDF 保存できます</span>
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
                PDFとして保存
              </button>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                閉じる
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <iframe
              ref={reportIframeRef}
              title="case-stats-report-preview"
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
