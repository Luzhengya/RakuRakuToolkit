import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertCircle, AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { type Lang } from '../i18n/testcenter';
import { buildCaseStatsReportHtml, caseStatsReportTitle, type ReportSystemGroup } from './caseStatsReportTemplate';
import IncidentDetailDialog, { type IncidentFields } from './IncidentDetailDialog';
import {
  KPI_EFFICIENCY_DEFS, KPI_QUALITY_DEFS, TH_KEY, aggregateHalf, alignToTargets, band, effVal, extractMonth, fmt, fmtEff,
  fmtPct, groupBySystem, halfMonthsOrder, halfPeriodRange, loadThresholds, matchPeriod, parseMonthKey, toStatRow,
  BAND_CLS, hasVal, type CaseStatItem, type EffTh, type HalfType, type KpiDef, type KpiTarget, type StatRow, type Thresholds,
} from './caseStatsCore';
import {
  HealthBar, ThresholdRow, effHead, plainCommentCell, qualBlock, qualHead, renderEffRow as renderEffRowBase,
  renderQualRow as renderQualRowBase, renderQualStats, summaryBlock, td0, th0,
} from './caseStatsParts';

type BugLeakDetail = {
  id: string;
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

// 年度チャート配色
const PIE_COLORS = ['#6366f1', '#f97316', '#10b981', '#06b6d4', '#ec4899', '#8b5cf6', '#eab308', '#ef4444'];

const CHART_TIP_STYLE = { borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' };

// チャートカード。CaseStats の外で定義することで、再レンダー毎に別コンポーネント扱いされて
// 子ツリーがアンマウント→再マウントされる (= グラフが再読み込みを繰り返す/サイズが戻る) のを防ぐ。
// サイズはリサイズ操作の完了時(pointerup)にのみ保存し、保存値を style に戻さないことで
// 「保存→再描画→測定→保存」の無限ループも避ける。
function ChartCard({
  id,
  title,
  layout,
  onLayout,
  children,
}: {
  id: string;
  title: string;
  layout: ChartLayout | undefined;
  onLayout: (id: string, patch: ChartLayout) => void;
  children: any;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // 初期サイズのみ layout から反映する (以降は DOM 側の実サイズが正)
  const initial = useRef(layout);
  if (layout?.hidden) return null;
  const commitSize = () => {
    const el = cardRef.current;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    const h = Math.round(el.getBoundingClientRect().height);
    if (w > 0 && h > 0 && (w !== layout?.width || h !== layout?.height)) {
      onLayout(id, { width: w, height: h });
    }
  };
  return (
    <div
      ref={cardRef}
      onPointerUp={commitSize}
      className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col resize overflow-hidden"
      style={{
        width: initial.current?.width ? `${initial.current.width}px` : 'calc(50% - 8px)',
        height: initial.current?.height ?? 300,
        minHeight: 200,
        minWidth: 240,
        flexShrink: 0,
      }}
    >
      <div className="flex items-center justify-between mb-3 shrink-0 gap-2">
        <h4 className="text-sm font-semibold text-neutral-700 truncate">{title}</h4>
        <button
          type="button"
          onClick={() => onLayout(id, { hidden: true })}
          className="text-neutral-300 hover:text-red-500 text-sm leading-none shrink-0"
          title="非表示"
        >×</button>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

// システム別 円グラフカード (占比表示)
function PieCard({
  id,
  title,
  data,
  layout,
  onLayout,
}: {
  id: string;
  title: string;
  data: { name: string; value: number }[];
  layout: ChartLayout | undefined;
  onLayout: (id: string, patch: ChartLayout) => void;
}) {
  return (
    <ChartCard id={id} title={title} layout={layout} onLayout={onLayout}>
      <PieChart>
        <Tooltip contentStyle={CHART_TIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" labelLine={false} isAnimationActive={false} label={(e: any) => (e.percent >= 0.05 ? `${(e.percent * 100).toFixed(0)}%` : '')}>
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartCard>
  );
}

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
  // 一覧で開いている行。null なら閉じている
  const [incidentIndex, setIncidentIndex] = useState<number | null>(null);
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
  const [pendingNoteCounts, setPendingNoteCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/notes/by-assignee')
      .then((r) => r.json())
      .then((d) => {
        const counts: Record<string, number> = {};
        for (const [email, notes] of Object.entries(d.byAssignee ?? {})) {
          counts[email] = (notes as any[]).length;
        }
        setPendingNoteCounts(counts);
      })
      .catch(() => {});
  }, []);

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

  const fetchStats = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-center/case-stats${refresh ? '?refresh=true' : ''}`);
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
    // 詳細ダイアログの入力欄をプロパティ型に合わせるための情報
    fields?: IncidentFields;
  } | null>(null);
  // 取得失敗を「該当データなし」と区別するためのエラー。
  // 設定漏れ(DB未設定)を「今月は流出なし」と同じ見た目にしてはいけない。
  const [bugLeakError, setBugLeakError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ year: String(year) });
    if (effectiveMonth !== 'all') params.set('month', String(effectiveMonth));
    let alive = true;
    fetch(`/api/test-center/bug-leak?${params.toString()}`)
      .then(async (res) => {
        if (res.ok) return res.json();
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string; error?: string }).detail
          || (body as { error?: string }).error
          || `取得に失敗しました (${res.status})`);
      })
      .then((d) => { if (alive) { setBugLeak(d); setBugLeakError(null); } })
      .catch((e: unknown) => {
        if (!alive) return;
        setBugLeak(null);
        setBugLeakError(e instanceof Error ? e.message : '取得に失敗しました');
      });
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
      .map(toStatRow);
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

  const filteredBugLeak = useMemo(() => {
    if (!bugLeak) return null;
    if (deselected.size === 0) return bugLeak;
    const items = bugLeak.items.filter((b) => !deselected.has(b.system || '(未設定)'));
    const sysMap = new Map<string, number>();
    for (const b of items) {
      const s = b.system || '(未設定)';
      sysMap.set(s, (sysMap.get(s) ?? 0) + 1);
    }
    const bySystem = Array.from(sysMap, ([system, count]) => ({ system, count }));
    return {
      ...bugLeak,
      total: items.length,
      tcRelated: items.filter((b) => b.responsible).length,
      bySystem,
      items,
    };
  }, [bugLeak, deselected]);

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
  const rowsBySystem = useMemo(() => groupBySystem(rows, th), [rows, th]);

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
    // rows は現在 halfType でフィルタ済み。通年モードで上下期を比較するため、
    // items から改めて業務年フル範囲で走査する
    const fullRange = halfPeriodRange(year, 'full');
    const firstMonths = new Set(halfMonthsOrder('first'));
    const first: CaseStatItem[] = [];
    const second: CaseStatItem[] = [];
    for (const it of items) {
      const key = parseMonthKey(it.month, year);
      if (key === null || key < fullRange.from || key > fullRange.to) continue;
      if (it.system && deselected.has(it.system)) continue;
      (firstMonths.has(key % 100) ? first : second).push(it);
    }
    return { first: aggregateHalf(first), second: aggregateHalf(second) };
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

  const tdNum = td0 + ' text-right tabular-nums';

  type ThKey = 'total' | 'design' | 'exec' | 'review' | 'ngLeak' | 'caseDiff' | 'sensen' | 'diff';
  const effRow = (key: ThKey, label: string, hiLabel = '高≥', midLabel = '中≥') => (
    <ThresholdRow label={label} value={th[key]} onChange={(v) => updateTh({ ...th, [key]: v })} hiLabel={hiLabel} midLabel={midLabel} />
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

  // ChartCard / PieCard に渡す共通 props (layout と保存ハンドラ)
  const chartProps = (id: string) => ({ layout: chartLayouts[id], onLayout: updateChartLayout });
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

  // 備考セル (実績表と紐付くもののみ編集可、フォーカスアウトで保存)
  const renderCommentCell = (r: (typeof rows)[number]) => {
    if (!r.it.commentId) return plainCommentCell(r);
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

  const renderEffRow = (r: StatRow) => renderEffRowBase(r, th, renderCommentCell(r));
  const renderQualRow = (r: StatRow) => renderQualRowBase(r, th, renderCommentCell(r));

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
      // 入力の参照用。インシデント区画と同じ絞り込み結果をそのまま渡す
      incidents: (filteredBugLeak?.items ?? []).map((b) => ({
        system: b.system,
        caseMonth: b.caseMonth,
        cmdb: b.cmdb,
        feature: b.feature,
        process: b.process,
        category: b.category,
        status: b.status,
        responsible: b.responsible,
        defect: b.defect,
        cause: b.cause,
        releaseTime: b.releaseTime,
        tcResult: b.tcResult,
        improvable: b.improvable,
        checklist: b.checklist,
      })),
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
      <nav className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onHome} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">ホーム</button>
        <span className="text-neutral-400">{'>>'}</span>
        <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">TestCenter</button>
        <span className="text-neutral-400">{'>>'}</span>
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
            onClick={() => fetchStats(true)}
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
                        {(pendingNoteCounts[a.assignee] ?? 0) > 0 && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5" title="未処理の指摘・QA">
                            <FileText size={10} />{pendingNoteCounts[a.assignee]}
                          </span>
                        )}
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
          {filteredBugLeak ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-neutral-400 font-semibold tracking-wider">総数</p>
                  <p className="text-xl font-bold text-neutral-800 mt-0.5 tabular-nums">{filteredBugLeak.total}</p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-neutral-400 font-semibold tracking-wider">テストセンター関連</p>
                  <p className="text-xl font-bold text-red-600 mt-0.5 tabular-nums">{filteredBugLeak.tcRelated}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-500 mb-1.5">システム別件数</p>
                {filteredBugLeak.bySystem.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {filteredBugLeak.bySystem.map((s) => (
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
              {filteredBugLeak.items.length > 0 && (
                <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th0}>サービス</th>
                        <th className={th0}>案件別</th>
                        <th className={th0}>CMDB番号</th>
                        <th className={th0}>機能(画面)名</th>
                        <th className={th0}>指摘工程</th>
                        <th className={th0}>指摘分類</th>
                        <th className={th0}>状態</th>
                        <th className={th0}>責任</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBugLeak.items.map((b, i) => (
                        <tr key={i} className="hover:bg-neutral-50">
                          <td className={td0}>{b.system || '-'}</td>
                          <td className={td0}>{b.caseMonth || '-'}</td>
                          <td className={td0}>{b.cmdb || '-'}</td>
                          {/* 隠した項目 (障害内容・TestCenter確認結果 など) はここから開く */}
                          <td className={td0 + ' max-w-[220px]'}>
                            <button
                              type="button"
                              onClick={() => setIncidentIndex(i)}
                              title={`${b.feature || '(機能名なし)'} の詳細を開く`}
                              className="w-full text-left truncate text-neutral-800 hover:text-neutral-900 hover:underline"
                            >
                              {b.feature || '(機能名なし)'}
                            </button>
                          </td>
                          <td className={td0}>{b.process || '-'}</td>
                          <td className={td0}>{b.category || '-'}</td>
                          <td className={td0}>{b.status || '-'}</td>
                          <td className={td0 + ' text-center'}>{b.responsible ? '✓' : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : bugLeakError ? (
            <p className="text-sm text-red-600">インシデント情報を取得できませんでした: {bugLeakError}</p>
          ) : (
            <p className="text-sm text-neutral-400">{loading ? '読み込み中...' : '該当データなし'}</p>
          )}
          </div>
          )}
        </div>

        {filteredBugLeak && incidentIndex != null && (
          <IncidentDetailDialog
            rows={filteredBugLeak.items}
            fields={filteredBugLeak.fields ?? {}}
            index={incidentIndex}
            onIndex={setIncidentIndex}
            onClose={() => setIncidentIndex(null)}
            // 保存できた行を差し替え、派生している集計も数え直す。
            // 再取得しないのは、開いている行の位置がずれないようにするため。
            // 案件別を対象期間の外へ変えた場合だけ、次の期間切り替えまで残る
            onSaved={(updated) =>
              setBugLeak((prev) => {
                if (!prev) return prev;
                const items = prev.items.map((b) => (b.id === updated.id ? updated : b));
                const bySystemMap = new Map<string, number>();
                for (const b of items) {
                  const s = b.system || '(未設定)';
                  bySystemMap.set(s, (bySystemMap.get(s) ?? 0) + 1);
                }
                return {
                  ...prev,
                  items,
                  tcRelated: items.filter((b) => b.responsible).length,
                  bySystem: Array.from(bySystemMap.entries())
                    .map(([system, count]) => ({ system, count }))
                    .sort((a, b) => b.count - a.count),
                };
              })
            }
          />
        )}

        {/* ─ 図形 (月次モード用、レポート出力対象外) ─ */}
        {/* overflow-hidden はリサイズ可能なカードを切り取ってしまうためヘッダ側のみに適用する */}
        {rows.length > 0 && (
          <div className="border border-neutral-200 rounded-xl">
            <button
              type="button"
              onClick={() => setChartsOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left rounded-t-xl"
            >
              {chartsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="text-sm font-bold text-neutral-800">図形</span>
            </button>
            {chartsOpen && (
              <div className="p-4 space-y-3">
                <ChartVisibilityBar metas={MONTHLY_CHART_META} />
                <div className="flex flex-wrap gap-4 items-start">
                  <PieCard {...chartProps('m.pi.estimate')} id="m.pi.estimate" title="システム別 見積時間比率" data={systemPies.estimate} />
                  <PieCard {...chartProps('m.pi.actual')} id="m.pi.actual" title="システム別 実績作業時間比率" data={systemPies.actual} />
                  <PieCard {...chartProps('m.pi.testSum')} id="m.pi.testSum" title="システム別 テストケース件数比率" data={systemPies.testSum} />
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
          const qualityDefs = KPI_QUALITY_DEFS;
          const efficiencyDefs = KPI_EFFICIENCY_DEFS;
          type Def = KpiDef;
          const groupHead = (label: string) => (
            <h4 className="inline-block rounded-md bg-neutral-900 text-white text-xs font-bold px-3 py-1 mb-2">{label}</h4>
          );
          // 目標と同じ位置に同名の指標を置く (目標に無い指標は空いた位置へ元の順で詰める)
          // 通年は上期目標の順 (上期目標が無ければ下期目標の順) に合わせる
          const targetsForOrder = halfType === 'second'
            ? kpiTargets.second
            : halfType === 'first' || kpiTargets.first.length > 0 ? kpiTargets.first : kpiTargets.second;
          const alignedDefs = (defs: Def[]): Def[] => alignToTargets(defs, targetsForOrder.map((t) => t.label));
          if (halfType === 'full') {
            const renderTable = (defs: Def[]) => (
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-4 text-xs font-semibold text-neutral-500 bg-neutral-50 border-b border-neutral-200">
                  <div className="px-3 py-2">指標</div>
                  <div className="px-3 py-2 text-right">上期</div>
                  <div className="px-3 py-2 text-right">下期</div>
                  <div className="px-3 py-2 text-right">差分</div>
                </div>
                {alignedDefs(defs).map((d) => {
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
              {alignedDefs(defs).map((d) => (
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
            <ChartCard {...chartProps('y.caseCount')} id="y.caseCount" title="月別案件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="caseCount" name="案件数" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ChartCard>

            <ChartCard {...chartProps('y.testSum')} id="y.testSum" title="月別テスト件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="testSum" name="テスト件数" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ChartCard>

            <ChartCard {...chartProps('y.ngSum')} id="y.ngSum" title="月別NG件数">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} />
                <Bar dataKey="ngSum" name="NG件数" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ChartCard>

            <ChartCard {...chartProps('y.ngLeak')} id="y.ngLeak" title="月別NG流出率(%)">
              <LineChart data={monthlySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} unit="%" />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} formatter={(v: any) => (v === null ? '-' : `${v}%`)} />
                <Line type="monotone" dataKey="ngLeakRate" name="NG流出率" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ChartCard>

            <ChartCard {...chartProps('y.totalEff')} id="y.totalEff" title="月別総効率">
              <LineChart data={monthlySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tipStyle} labelFormatter={monthLabel} formatter={(v: any) => (v === null ? '-' : v)} />
                <Line type="monotone" dataKey="totalEff" name="総効率" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ChartCard>

            <PieCard {...chartProps('y.pi.caseCount')} id="y.pi.caseCount" title="システム別 案件数" data={systemPies.caseCount} />
            <PieCard {...chartProps('y.pi.actual')} id="y.pi.actual" title="システム別 実績工数" data={systemPies.actual} />
            <PieCard {...chartProps('y.pi.ngLeak')} id="y.pi.ngLeak" title="システム別 NG流出率" data={systemPies.ngLeak} />
            <PieCard {...chartProps('y.pi.totalEff')} id="y.pi.totalEff" title="システム別 総効率" data={systemPies.totalEff} />
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
