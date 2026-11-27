// 案件一覧（KPI）の表示部品。TestCenter > 案件一覧 と 品質管理 > 実績フィードバック で共用する
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BAND_CLS, band, fmt, fmtEff, fmtPct, hasVal, type EffTh, type QualStats, type StatRow, type Thresholds } from './caseStatsCore';

export const th0 = 'px-2 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
export const td0 = 'px-2 py-1.5 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';
const tdNum = td0 + ' text-right tabular-nums';

// 閾値の1行。onChange が無ければ表示のみ
export function ThresholdRow({ label, value, onChange, hiLabel = '高≥', midLabel = '中≥' }: {
  label: string;
  value: EffTh;
  onChange?: (v: EffTh) => void;
  hiLabel?: string;
  midLabel?: string;
}) {
  const box = (v: number, set: (n: number) => void) => (onChange ? (
    <input
      type="number"
      value={v}
      onChange={(e) => set(Number(e.target.value))}
      className="w-16 border border-neutral-200 rounded px-1.5 py-0.5 text-xs text-right tabular-nums focus:outline-none focus:border-neutral-400"
    />
  ) : (
    <span className="w-16 px-1.5 py-0.5 text-xs text-right tabular-nums font-semibold text-neutral-700">{v}</span>
  ));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-neutral-600">{label}</span>
      <span className="text-neutral-400">{hiLabel}</span>
      {box(value.high, (n) => onChange?.({ ...value, high: n }))}
      <span className="text-neutral-400">{midLabel}</span>
      {box(value.mid, (n) => onChange?.({ ...value, mid: n }))}
    </div>
  );
}

// 分布バー。reverse=false: high=緑/low=赤(効率)。reverse=true: high=赤/low=緑(品質: 値大きいほど悪い)
export function HealthBar({ high, mid, low, reverse = false }: { high: number; mid: number; low: number; reverse?: boolean }) {
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
}

type Counts = { high: number; mid: number; low: number };

// 効率サマリカード (high=良)
export const summaryBlock = (label: string, agg: number | null, counts: Counts) => (
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
export const qualBlock = (label: string, aggText: string, counts: Counts) => (
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

// システム単位の品質サマリ (NG率統計 + 3カード: NG流出率 / 想定ケース差 / 潜在見逃し)
export const renderQualStats = (qs: QualStats) => (
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

// 備考セル (表示のみ)。案件一覧では編集可能なセルを渡す
export const plainCommentCell = (r: StatRow) => (
  <td className={td0 + ' max-w-[160px] truncate'} title={r.it.comment}>{r.it.comment || '-'}</td>
);

export const effHead = (
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

export const renderEffRow = (r: StatRow, th: Thresholds, commentCell: ReactNode) => (
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
    {commentCell}
    <td className={td0}>{r.it.assignee || '-'}</td>
    <td className={td0}>{r.it.manager || '-'}</td>
  </tr>
);

export const qualHead = (
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

export const renderQualRow = (r: StatRow, th: Thresholds, commentCell: ReactNode) => (
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
    {commentCell}
    <td className={td0}>{r.it.assignee || '-'}</td>
    <td className={td0}>{r.it.manager || '-'}</td>
  </tr>
);
