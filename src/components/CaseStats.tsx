import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, AlertCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';

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
  designActual: string;
  implActual: string;
  execActual: string;
  reviewActual: string;
  comment: string;
  expectedCase: string;
  expectedNg: string;
  japanNgCount: string;
  japanTestCount: string;
  tcNgCount: string;
};

type CaseStatsProps = {
  onBack: () => void;
  lang: Lang;
  initialYear: number;
  initialMonth: 'all' | number;
};

const CASE_STATS_CACHE_KEY = 'testcenter:casestats:v1';
const TH_KEY = 'testcenter:casestats:thresholds:v1';

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
type EffTh = { high: number; mid: number };
type Thresholds = {
  total: EffTh;
  design: EffTh;
  exec: EffTh;
  review: EffTh;
  sensen: number;   // 潜在見逃し 注意閾値 (>= で注意)
  caseDiff: number; // 想定ケース差 注意閾値 (|差| >= で注意)
};

// 暫定の既定値 (画面で編集可)
const DEFAULT_TH: Thresholds = {
  total: { high: 15, mid: 8 },
  design: { high: 15, mid: 8 },
  exec: { high: 30, mid: 15 },
  review: { high: 40, mid: 20 },
  sensen: 1,
  caseDiff: 10,
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
  low: 'text-red-600 font-semibold',
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

export default function CaseStats({ onBack, initialYear, initialMonth }: CaseStatsProps) {
  const initialCache = useMemo(() => loadCaseStatsCache(), []);
  const [year, setYear] = useState<number>(initialYear);
  const [month, setMonth] = useState<'all' | number>(initialMonth);
  const [items, setItems] = useState<CaseStatItem[]>(initialCache?.items ?? []);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initialCache?.updatedAt ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [th, setTh] = useState<Thresholds>(() => loadThresholds());
  const [effOpen, setEffOpen] = useState(true);
  const [qualOpen, setQualOpen] = useState(true);
  // システム単位の開閉 (未操作なら 要確認>0 のとき既定で展開)
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const isSysOpen = (key: string, defaultOpen: boolean) => openOverride[key] ?? defaultOpen;
  const toggleSys = (key: string, defaultOpen: boolean) =>
    setOpenOverride((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultOpen) }));

  const updateTh = (next: Thresholds) => {
    setTh(next);
    try { localStorage.setItem(TH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
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

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const it of items) {
      const m = (it.month || '').match(/(\d{4})/);
      if (m) years.add(Number(m[1]));
    }
    years.add(initialYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [items, initialYear]);

  const rows = useMemo(() => {
    return items
      .filter((it) => matchPeriod(it.month, year, month))
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
          ngLeakRate: ngLeakDenom > 0 ? (japanNg / ngLeakDenom) * 100 : null,
        };
      });
  }, [items, year, month]);

  // 基本 KPI
  const kpi = useMemo(() => {
    const estimateSum = rows.reduce((s, r) => s + r.estimate, 0);
    const actualSum = rows.reduce((s, r) => s + r.actual, 0);
    const testSum = rows.reduce((s, r) => s + r.testTotal, 0);
    const ngSum = rows.reduce((s, r) => s + r.ng, 0);
    // 要確認: いずれかの効率が低 or 想定ケース差超過 or 潜在見逃し
    const attention = rows.filter((r) =>
      band(r.totalEff, th.total) === 'low' ||
      band(r.designEff, th.design) === 'low' ||
      band(r.execEff, th.exec) === 'low' ||
      band(r.reviewEff, th.review) === 'low' ||
      (r.hasExpectedCase && Math.abs(r.caseDiff) >= th.caseDiff) ||
      (r.hasExpectedNg && r.sensen >= th.sensen)
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
        // いずれかの効率が「低」の案件を要確認リストに (どの効率が低かをラベル化)
        const lowCases = grp
          .map((r) => {
            const labels: string[] = [];
            if (band(r.totalEff, th.total) === 'low') labels.push('総');
            if (band(r.designEff, th.design) === 'low') labels.push('設計');
            if (band(r.execEff, th.exec) === 'low') labels.push('実施');
            if (band(r.reviewEff, th.review) === 'low') labels.push('レビュー');
            return { r, labels };
          })
          .filter((x) => x.labels.length > 0);

        // 品質サマリ (システム単位)
        const qTestSum = grp.reduce((s, r) => s + r.testTotal, 0);
        const qNgSum = grp.reduce((s, r) => s + r.ng, 0);
        const tcngSum = grp.reduce((s, r) => s + r.tcng, 0);
        const japanNgSum = grp.reduce((s, r) => s + r.japanNg, 0);
        const expectedNgSum = grp.reduce((s, r) => s + (r.hasExpectedNg ? r.expectedNg : 0), 0);
        const sensenSum = grp.reduce((s, r) => s + (r.hasExpectedNg ? r.sensen : 0), 0);
        const caseRows = grp.filter((r) => r.hasExpectedCase);
        const caseAttn = caseRows.filter((r) => Math.abs(r.caseDiff) >= th.caseDiff).length;
        const ngRows = grp.filter((r) => r.hasExpectedNg);
        const sensenAttn = ngRows.filter((r) => r.sensen >= th.sensen).length;
        const leakDen = tcngSum + japanNgSum;
        const qualStats = {
          testSum: qTestSum,
          ngSum: qNgSum,
          ngRate: qTestSum > 0 ? (qNgSum / qTestSum) * 100 : null,
          ngLeakRate: leakDen > 0 ? (japanNgSum / leakDen) * 100 : null,
          caseSafe: caseRows.length - caseAttn,
          caseAttention: caseAttn,
          caseTotal: caseRows.length,
          sensenRatio: expectedNgSum > 0 ? (sensenSum / expectedNgSum) * 100 : null,
          sensenSafe: ngRows.length - sensenAttn,
          sensenAttention: sensenAttn,
          sensenTotal: ngRows.length,
        };
        // 想定ケース超過 or 潜在見逃し の案件を要確認リストに
        const attnCases = grp
          .map((r) => {
            const labels: string[] = [];
            if (r.hasExpectedCase && Math.abs(r.caseDiff) >= th.caseDiff) labels.push('想定ケース差');
            if (r.hasExpectedNg && r.sensen >= th.sensen) labels.push('潜在見逃し');
            return { r, labels };
          })
          .filter((x) => x.labels.length > 0);

        return { system, rows: grp, count: grp.length, totalEff: effVal(testSum, actualSum), effStats, lowCases, qualStats, attnCases };
      })
      .sort((a, b) => b.count - a.count);
  }, [rows, th]);

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

  const effRow = (key: 'total' | 'design' | 'exec' | 'review', label: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-neutral-600">{label}</span>
      <span className="text-neutral-400">{'高≥'}</span>
      <ThInput value={th[key].high} onChange={(v) => updateTh({ ...th, [key]: { ...th[key], high: v } })} />
      <span className="text-neutral-400">{'中≥'}</span>
      <ThInput value={th[key].mid} onChange={(v) => updateTh({ ...th, [key]: { ...th[key], mid: v } })} />
    </div>
  );

  // 高/中/低 の分布バー (低=要確認 を赤で強調)
  const HealthBar = ({ high, mid, low }: { high: number; mid: number; low: number }) => {
    const total = high + mid + low;
    if (total === 0) return <div className="h-1.5 rounded-full bg-neutral-100" />;
    const pct = (n: number) => `${(n / total) * 100}%`;
    return (
      <div className="flex h-1.5 rounded-full overflow-hidden bg-neutral-100" title={`高${high} / 中${mid} / 低${low}`}>
        {high > 0 && <div style={{ width: pct(high) }} className="bg-emerald-500" />}
        {mid > 0 && <div style={{ width: pct(mid) }} className="bg-slate-400" />}
        {low > 0 && <div style={{ width: pct(low) }} className="bg-red-500" />}
      </div>
    );
  };

  const summaryBlock = (label: string, agg: number | null, counts: { high: number; mid: number; low: number }) => (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-neutral-600">{label}</span>
        <span className="text-lg font-bold text-neutral-900 tabular-nums">{fmtEff(agg)}</span>
      </div>
      <div className="mt-1.5"><HealthBar high={counts.high} mid={counts.mid} low={counts.low} /></div>
      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span className="text-emerald-600">{'高'} {counts.high}</span>
        <span className="text-slate-500">{'中'} {counts.mid}</span>
        <span className={counts.low > 0 ? 'text-red-600 font-semibold' : 'text-neutral-400'}>{'低(要確認)'} {counts.low}</span>
      </div>
    </div>
  );

  const effHead = (
    <thead>
      <tr>
        <th className={th0}>案件名</th>
        <th className={th0}>システム</th>
        <th className={th0}>状態</th>
        <th className={th0}>見積</th>
        <th className={th0}>実績(設計)</th>
        <th className={th0}>実績(実装)</th>
        <th className={th0}>実績(実施)</th>
        <th className={th0}>実績(review)</th>
        <th className={th0}>実績総</th>
        <th className={th0}>差分</th>
        <th className={th0}>設計効率</th>
        <th className={th0}>実施効率</th>
        <th className={th0}>レビュー効率</th>
        <th className={th0}>備考</th>
        <th className={th0}>担当者</th>
        <th className={th0}>管理者</th>
      </tr>
    </thead>
  );

  const renderEffRow = (r: (typeof rows)[number]) => (
    <tr key={r.it.id} className="hover:bg-neutral-50">
      <td className={td0 + ' max-w-[220px] truncate'} title={r.it.projectName}>{r.it.projectName || '-'}</td>
      <td className={td0}>{r.it.system || '-'}</td>
      <td className={td0}>{r.it.status || '-'}</td>
      <td className={tdNum}>{fmt(r.estimate)}</td>
      <td className={tdNum}>{fmt(r.designA)}</td>
      <td className={tdNum}>{fmt(r.implA)}</td>
      <td className={tdNum}>{fmt(r.execA)}</td>
      <td className={tdNum}>{fmt(r.reviewA)}</td>
      <td className={tdNum}>{fmt(r.actual)}</td>
      <td className={tdNum + (r.diff > 0 ? ' text-red-600' : '')}>{(r.diff > 0 ? '+' : '') + fmt(r.diff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.designEff, th.design)]}>{fmtEff(r.designEff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.execEff, th.exec)]}>{fmtEff(r.execEff)}</td>
      <td className={td0 + ' text-right tabular-nums ' + BAND_CLS[band(r.reviewEff, th.review)]}>{fmtEff(r.reviewEff)}</td>
      <td className={td0 + ' max-w-[160px] truncate'} title={r.it.comment}>{r.it.comment || '-'}</td>
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
      <td className={tdNum + (r.hasExpectedCase && Math.abs(r.caseDiff) >= th.caseDiff ? ' bg-red-50 text-red-600 font-semibold' : '')}>
        {r.hasExpectedCase ? (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {r.hasExpectedCase && Math.abs(r.caseDiff) >= th.caseDiff && <AlertTriangle size={11} />}{fmt(r.expectedCase)}
          </span>
        ) : '-'}
      </td>
      <td className={tdNum}>{fmtPct(r.ngRate)}</td>
      <td className={tdNum}>{fmtPct(r.ngLeakRate)}</td>
      <td className={tdNum + (r.hasExpectedNg && r.sensen >= th.sensen ? ' bg-red-50 text-red-600 font-semibold' : '')}>
        {r.hasExpectedNg ? (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {r.hasExpectedNg && r.sensen >= th.sensen && <AlertTriangle size={11} />}{fmt(r.sensen)}
          </span>
        ) : '-'}
      </td>
      <td className={td0 + ' max-w-[160px] truncate'} title={r.it.comment}>{r.it.comment || '-'}</td>
      <td className={td0}>{r.it.assignee || '-'}</td>
      <td className={td0}>{r.it.manager || '-'}</td>
    </tr>
  );

  // システム単位の品質サマリ (3ブロック)
  const renderQualStats = (qs: (typeof rowsBySystem)[number]['qualStats']) => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="font-semibold text-neutral-600">総件数 / NG</p>
        <p className="text-neutral-700">総テスト件数: <b className="tabular-nums">{fmt(qs.testSum)}</b></p>
        <p className="text-neutral-700">検出NG: <b className="tabular-nums">{fmt(qs.ngSum)}</b>（NG率 {fmtPct(qs.ngRate)}）</p>
        <p className="text-neutral-700">NG流出率: <b className="tabular-nums">{fmtPct(qs.ngLeakRate)}</b></p>
      </div>
      <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="font-semibold text-neutral-600">想定ケース範囲</p>
        <p className="text-emerald-600">範囲内(安全): <b className="tabular-nums">{qs.caseSafe}</b></p>
        <p className="text-red-600">超過(要確認): <b className="tabular-nums">{qs.caseAttention}</b></p>
        <p className="text-neutral-400">(想定あり {qs.caseTotal}件)</p>
      </div>
      <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="font-semibold text-neutral-600">潜在見逃し</p>
        <p className="text-neutral-700">比率: <b className="tabular-nums">{fmtPct(qs.sensenRatio)}</b></p>
        <p className="text-emerald-600">範囲内(安全): <b className="tabular-nums">{qs.sensenSafe}</b></p>
        <p className="text-red-600">超過(要確認): <b className="tabular-nums">{qs.sensenAttention}</b></p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            <ArrowLeft size={16} />
            {'戻る'}
          </button>
          <h2 className="text-xl font-bold text-neutral-900">{'案件統計'}</h2>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
          >
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={month === 'all' ? 'all' : String(month)}
            onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
          >
            <option value="all">{'全月'}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button
            type="button"
            onClick={fetchStats}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {'更新'}
          </button>
          {updatedAt && (
            <span className="text-[11px] text-neutral-400 whitespace-nowrap">
              {('最終更新 ') + new Date(updatedAt).toLocaleString('ja-JP')}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* ═══ 基本 ═══ */}
      <section className="space-y-3">
        <h3 className="inline-block rounded-lg bg-neutral-900 text-white text-sm font-bold px-4 py-1.5">{'基本'}</h3>
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

      {/* ═══ 詳細 (案件別) ═══ */}
      <section className="space-y-4">
        <h3 className="inline-block rounded-lg bg-blue-600 text-white text-sm font-bold px-4 py-1.5">
          {'詳細 / 案件別'}
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
                {[...rowsBySystem].sort((a, b) => b.lowCases.length - a.lowCases.length).map((g) => {
                  const key = `eff:${g.system}`;
                  const open = isSysOpen(key, g.lowCases.length > 0);
                  const c = g.effStats.total.counts;
                  return (
                    <div key={g.system} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSys(key, g.lowCases.length > 0)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
                      >
                        {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                        <span className="text-sm font-bold text-neutral-800 truncate">{g.system}</span>
                        <div className="w-24 shrink-0 hidden sm:block"><HealthBar high={c.high} mid={c.mid} low={c.low} /></div>
                        <span className="text-xs text-neutral-500 shrink-0">総効率 <b className="text-neutral-900 tabular-nums">{fmtEff(g.totalEff)}</b></span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {g.lowCases.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
                              <AlertTriangle size={11} />要確認 {g.lowCases.length}
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
                          {g.lowCases.length > 0 && (
                            <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                              <p className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1">
                                <AlertTriangle size={12} />要確認（低効率）{g.lowCases.length}件
                              </p>
                              <ul className="space-y-1">
                                {g.lowCases.map(({ r, labels }) => (
                                  <li key={r.it.id} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="truncate text-neutral-800" title={r.it.projectName}>{r.it.projectName || '-'}</span>
                                    <span className="text-red-600 shrink-0 font-medium">{labels.map((l) => `${l}:低`).join(' / ')}</span>
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
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
                <span className="text-[11px] font-semibold text-neutral-400 w-full">{'閾値設定 (編集可・自動保存)'}</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-600">{'想定ケース差 注意≥'}</span>
                  <ThInput value={th.caseDiff} onChange={(v) => updateTh({ ...th, caseDiff: v })} />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-600">{'潜在見逃し 注意≥'}</span>
                  <ThInput value={th.sensen} onChange={(v) => updateTh({ ...th, sensen: v })} />
                </div>
              </div>

              {/* システム別: 要確認 多い順・折りたたみ */}
              <div className="space-y-3">
                {[...rowsBySystem].sort((a, b) => b.attnCases.length - a.attnCases.length).map((g) => {
                  const key = `qual:${g.system}`;
                  const open = isSysOpen(key, g.attnCases.length > 0);
                  const safe = g.count - g.attnCases.length;
                  return (
                    <div key={g.system} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSys(key, g.attnCases.length > 0)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
                      >
                        {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                        <span className="text-sm font-bold text-neutral-800 truncate">{g.system}</span>
                        <div className="w-24 shrink-0 hidden sm:block"><HealthBar high={safe} mid={0} low={g.attnCases.length} /></div>
                        <span className="text-xs text-neutral-500 shrink-0">NG率 <b className="text-neutral-900 tabular-nums">{fmtPct(g.qualStats.ngRate)}</b></span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {g.attnCases.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
                              <AlertTriangle size={11} />要確認 {g.attnCases.length}
                            </span>
                          )}
                          <span className="text-xs text-neutral-400">案件 {g.count}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="p-3 space-y-3">
                          {renderQualStats(g.qualStats)}
                          {g.attnCases.length > 0 && (
                            <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                              <p className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1">
                                <AlertTriangle size={12} />要確認 {g.attnCases.length}件
                              </p>
                              <ul className="space-y-1">
                                {g.attnCases.map(({ r, labels }) => (
                                  <li key={r.it.id} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="truncate text-neutral-800" title={r.it.projectName}>{r.it.projectName || '-'}</span>
                                    <span className="text-red-600 shrink-0 font-medium">{labels.join(' / ')}</span>
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

      </section>
    </div>
  );
}
