// 案件一覧（KPI）の集計ロジック。
// TestCenter > 案件一覧 と 品質管理 > 実績フィードバック で共用し、指標の口径を1か所で管理する。

export type CaseStatItem = {
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

// ─── 動的閾値 (localStorage 永続) ───
// 効率: high 以上=良(緑) / low 未満=要確認(赤)
// 品質(ngLeak/caseDiff/sensen): 値が大きいほど悪い → high 以上=要確認(赤) / mid 未満=安全(緑)
export const TH_KEY = 'testcenter:casestats:thresholds:v2';

export type EffTh = { high: number; mid: number };
export type Thresholds = {
  total: EffTh;
  design: EffTh;
  exec: EffTh;
  review: EffTh;
  ngLeak: EffTh;   // NG流出率(%)  high以上=要確認
  caseDiff: EffTh; // 想定ケース差 high以上=要確認
  sensen: EffTh;   // 潜在見逃し   high以上=要確認
  diff: EffTh;     // 見積対実績差分(人日) high以上=要確認 (担当者別用)
};

// 暫定の既定値 (案件一覧の画面で編集可)
export const DEFAULT_TH: Thresholds = {
  total: { high: 8, mid: 5 },
  design: { high: 15, mid: 8 },
  exec: { high: 30, mid: 15 },
  review: { high: 40, mid: 20 },
  ngLeak: { high: 50, mid: 30 },
  caseDiff: { high: 10, mid: 5 },
  sensen: { high: 1, mid: 0.5 },
  diff: { high: 10, mid: 5 },
};

export function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(TH_KEY);
    if (!raw) return DEFAULT_TH;
    return { ...DEFAULT_TH, ...(JSON.parse(raw) as Partial<Thresholds>) };
  } catch {
    return DEFAULT_TH;
  }
}

export function num(v: string): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function hasVal(v: string): boolean {
  return String(v ?? '').trim() !== '';
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}

export function fmtEff(v: number | null): string {
  return v === null ? '-' : fmt(v);
}

export function fmtPct(v: number | null): string {
  return v === null ? '-' : `${fmt(v)}%`;
}

// 効率値 (分母0は null)
export function effVal(numer: number, denom: number): number | null {
  return denom > 0 ? numer / denom : null;
}

export type Band = 'high' | 'mid' | 'low' | 'na';
export function band(v: number | null, th: EffTh): Band {
  if (v === null) return 'na';
  if (v >= th.high) return 'high';
  if (v >= th.mid) return 'mid';
  return 'low';
}
export const BAND_CLS: Record<Band, string> = {
  high: 'text-emerald-600 font-semibold',
  mid: 'text-neutral-700',
  low: 'bg-red-50 text-neutral-800 font-semibold',
  na: 'text-neutral-400',
};

// 月次: YYYYMM(6桁) / YYYY-MM / YYYY年M月 / M月
export function matchPeriod(monthStr: string, year: number, month: 'all' | number): boolean {
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

// 業務年度: year年2月 〜 (year+1)年1月
// 上期(first): year年 2〜7月 / 下期(second): year年8月 〜 (year+1)年1月
export type HalfType = 'full' | 'first' | 'second';

// 月次文字列を YYYYMM(数値) に正規化。判定不能なら null
export function parseMonthKey(monthStr: string, fallbackYear?: number): number | null {
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
export function halfPeriodRange(year: number, half: HalfType): { from: number; to: number } {
  if (half === 'first') return { from: year * 100 + 2, to: year * 100 + 7 };
  if (half === 'second') return { from: year * 100 + 8, to: (year + 1) * 100 + 1 };
  return { from: year * 100 + 2, to: (year + 1) * 100 + 1 }; // full = 業務年 2〜次年1月
}

// 業務年順の月配列。full=12ヶ月(2,3,...,12,1)、first=2〜7、second=8,9,...,12,1
export function halfMonthsOrder(half: HalfType): number[] {
  if (half === 'first') return [2, 3, 4, 5, 6, 7];
  if (half === 'second') return [8, 9, 10, 11, 12, 1];
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1];
}

// 月次文字列から月(1-12)を抽出
export function extractMonth(monthStr: string): number | null {
  const t = (monthStr || '').trim();
  const compact = t.match(/^(\d{4})(\d{2})$/);
  if (compact) return Number(compact[2]);
  const full = t.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (full) return Number(full[2]);
  const only = t.match(/(\d{1,2})月/);
  if (only) return Number(only[1]);
  return null;
}

// ─── 案件1件の指標 ───
export function toStatRow(it: CaseStatItem) {
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
}
export type StatRow = ReturnType<typeof toStatRow>;

type Tally = { high: number; mid: number; low: number };
function tally(grp: StatRow[], pick: (r: StatRow) => number | null, t: EffTh): Tally {
  const c = { high: 0, mid: 0, low: 0 };
  for (const r of grp) {
    const b = band(pick(r), t);
    if (b === 'high') c.high++;
    else if (b === 'mid') c.mid++;
    else if (b === 'low') c.low++;
  }
  return c;
}

export type AttnItem = { r: StatRow; status: '確認要' | '注意'; labels: string[] };

// 効率: 低(確認要) or 中(注意) の案件と、指標名:程度 のラベル
export function effAttention(r: StatRow, th: Thresholds): AttnItem | null {
  const parts: { name: string; b: Band }[] = [];
  const add = (name: string, v: number | null, t: EffTh) => {
    const b = band(v, t);
    if (b === 'low' || b === 'mid') parts.push({ name, b });
  };
  add('総', r.totalEff, th.total);
  add('設計', r.designEff, th.design);
  add('実施', r.execEff, th.exec);
  add('レビュー', r.reviewEff, th.review);
  if (parts.length === 0) return null;
  const status: '確認要' | '注意' = parts.some((p) => p.b === 'low') ? '確認要' : '注意';
  return { r, status, labels: parts.map((p) => `${p.name}:${p.b === 'low' ? '低' : '中'}`) };
}

// 品質: 警告判定は NG流出率のみ。想定ケース差/潜在見逃しは単独では警告せず、
// NG流出率が高い(確認要/注意)時に付帯情報として併記する。
export function qualAttention(r: StatRow, th: Thresholds): AttnItem | null {
  if (r.ngLeakRate === null) return null;
  const b = band(r.ngLeakRate, th.ngLeak);
  if (b !== 'high' && b !== 'mid') return null;
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
  return { r, status, labels };
}

// システム別グルーピング (案件数降順)。各システムの効率・品質サマリ + 確認要・注意の案件
export function groupBySystem(rows: StatRow[], th: Thresholds) {
  const map = new Map<string, StatRow[]>();
  for (const r of rows) {
    const key = r.it.system || '(未設定)';
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
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
      const effAttn = grp.flatMap((r) => effAttention(r, th) ?? []);

      // 品質サマリ (システム単位)
      const qNgSum = grp.reduce((s, r) => s + r.ng, 0);
      const tcngSum = grp.reduce((s, r) => s + r.tcng, 0);
      const japanNgSum = grp.reduce((s, r) => s + r.japanNg, 0);
      const leakDen = tcngSum + japanNgSum;
      const grpHasNgData = grp.some((r) => r.hasNgData);
      // 各品質指標を high/中/low に分類 (high=要確認)。対象外(データ無し)は null で除外
      const qualStats = {
        testSum,
        ngSum: qNgSum,
        ngRate: testSum > 0 ? (qNgSum / testSum) * 100 : null,
        ngLeakRate: leakDen > 0 ? (japanNgSum / leakDen) * 100 : (grpHasNgData ? 0 : null),
        ngLeakCounts: tally(grp, (r) => r.ngLeakRate, th.ngLeak),
        caseDiffCounts: tally(grp, (r) => (r.hasExpectedCase ? r.caseDiff : null), th.caseDiff),
        sensenCounts: tally(grp, (r) => (r.hasExpectedNg ? r.sensen : null), th.sensen),
      };
      const qualAttn = grp.flatMap((r) => qualAttention(r, th) ?? []);

      const effConfirm = effAttn.filter((x) => x.status === '確認要').length;
      const qualConfirm = qualAttn.filter((x) => x.status === '確認要').length;

      return { system, rows: grp, count: grp.length, totalEff: effVal(testSum, actualSum), effStats, effAttn, effConfirm, qualStats, qualAttn, qualConfirm };
    })
    .sort((a, b) => b.count - a.count);
}
export type SystemGroup = ReturnType<typeof groupBySystem>[number];
export type QualStats = SystemGroup['qualStats'];

// ─── 半期の集計 (KPI パネル) ───
export function aggregateHalf(items: CaseStatItem[]) {
  let caseCount = 0, testSum = 0, ngSum = 0, unexpectedNgSum = 0, actual = 0, estimate = 0, tcng = 0, japanNg = 0;
  for (const it of items) {
    caseCount++;
    testSum += num(it.testTotalCount);
    ngSum += num(it.bugCount);
    unexpectedNgSum += num(it.unexpectedNgCount);
    actual += num(it.actualTotal);
    estimate += num(it.estimateTotal);
    tcng += num(it.tcNgCount);
    japanNg += num(it.japanNgCount);
  }
  const leakDen = tcng + japanNg;
  return {
    caseCount,
    testSum,
    ngSum,
    unexpectedNgSum,
    estimateSum: estimate,
    actualSum: actual,
    diff: Number((actual - estimate).toFixed(2)),
    ngRate: testSum > 0 ? (ngSum / testSum) * 100 : null,
    ngLeakRate: leakDen > 0 ? (japanNg / leakDen) * 100 : null,
    totalEff: actual > 0 ? testSum / actual : null,
  };
}
export type HalfAgg = ReturnType<typeof aggregateHalf>;

// 業務年度・半期に含まれる案件
export function itemsInHalf(items: CaseStatItem[], year: number, half: HalfType): CaseStatItem[] {
  const range = halfPeriodRange(year, half);
  return items.filter((it) => {
    const key = parseMonthKey(it.month, year);
    return key !== null && key >= range.from && key <= range.to;
  });
}

// ─── KPI 指標の定義 (品質4 + 効率・規模4) ───
export type KpiTarget = { label: string; value: string };

type FmtFn = (v: number | null) => string;
export type KpiDef = {
  key: string;
  desc: string;
  pick: (h: HalfAgg) => number | null;
  higherIsWorse: boolean;
  fmt: FmtFn;
  diffFmt: (v: number) => string;
};

const fmtNum: FmtFn = (v) => v === null ? '-' : fmt(v);
export const fmtDiff = (v: number): string => (v > 0 ? '+' : '') + fmt(v);
const fmtDiffPct = (v: number): string => (v > 0 ? '+' : '') + fmt(v) + '%';

export const KPI_QUALITY_DEFS: KpiDef[] = [
  { key: 'NG率(総)',       desc: 'NG率(総) = 総NG件数 ÷ 総テスト件数 × 100\n各案件のNG数と検出テスト件数を合算して算出',                            pick: (h) => h.ngRate,          higherIsWorse: true, fmt: fmtPct, diffFmt: fmtDiffPct },
  { key: 'NG流出率(総)',   desc: 'NG流出率(総) = 日本側NG件数 ÷ (TCNG数 + 日本側NG件数) × 100\n日本側で検出されたNGの割合(テスト後流出したNG比率)', pick: (h) => h.ngLeakRate,      higherIsWorse: true, fmt: fmtPct, diffFmt: fmtDiffPct },
  { key: '想定外NG数(総)', desc: '想定外NG数(総) = 各案件の想定外NG数の合計\n仕様外・想定外の重大不具合を集計',                                   pick: (h) => h.unexpectedNgSum, higherIsWorse: true, fmt: fmtNum, diffFmt: fmtDiff },
  { key: '総NG件数',       desc: '総NG件数 = 各案件のNG数の合計\n対象期間内で検出された全NG件数',                                                  pick: (h) => h.ngSum,           higherIsWorse: true, fmt: fmtNum, diffFmt: fmtDiff },
];

export const KPI_EFFICIENCY_DEFS: KpiDef[] = [
  { key: '効率(総)',       desc: '効率(総) = 総テスト件数 ÷ 実績工数(合計)\n1人日あたりのテスト件数(生産性の指標)',                     pick: (h) => h.totalEff,        higherIsWorse: false, fmt: fmtEff, diffFmt: fmtDiff },
  { key: '見積対実績差分', desc: '見積対実績差分 = 実績工数(合計) − 見積工数(合計)\nプラス=見積超過、マイナス=見積内(工数管理の指標)', pick: (h) => h.diff,            higherIsWorse: true,  fmt: (v) => v === null ? '-' : fmtDiff(v), diffFmt: fmtDiff },
  { key: '案件数(総)',     desc: '案件数(総) = 対象期間内の案件数の合計',                                                                pick: (h) => h.caseCount,       higherIsWorse: false, fmt: fmtNum, diffFmt: fmtDiff },
  { key: '総テスト件数',   desc: '総テスト件数 = 各案件のテスト件数の合計\n対象期間内で実施したテスト用例の総数',                       pick: (h) => h.testSum,         higherIsWorse: false, fmt: fmtNum, diffFmt: fmtDiff },
];

// 目標と同じ位置に同名の指標を置く (目標に無い指標は空いた位置へ元の順で詰める)
export function alignToTargets(defs: KpiDef[], targetLabels: string[]): KpiDef[] {
  const slots: (KpiDef | undefined)[] = new Array(defs.length).fill(undefined);
  const placed = new Set<string>();
  targetLabels.forEach((label, i) => {
    const d = defs.find((x) => x.key === label);
    if (d && i < slots.length && !slots[i]) { slots[i] = d; placed.add(d.key); }
  });
  const rest = defs.filter((d) => !placed.has(d.key));
  return slots.map((s) => s ?? rest.shift()!);
}
