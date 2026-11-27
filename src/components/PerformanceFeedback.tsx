// 品質管理 > 実績フィードバック。TestCenter > 案件一覧（KPI）と同じ口径で、半期目標・半期実績・年度比較・月次の問題案件を表示する（閲覧のみ）
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  KPI_EFFICIENCY_DEFS, KPI_QUALITY_DEFS, aggregateHalf, alignToTargets, effAttention, extractMonth, fmtEff, fmtPct, groupBySystem,
  halfMonthsOrder, itemsInHalf, loadThresholds, qualAttention, toStatRow,
  type AttnItem, type CaseStatItem, type KpiDef, type KpiTarget, type SystemGroup,
} from './caseStatsCore';
import {
  HealthBar, ThresholdRow, effHead, plainCommentCell, qualHead, renderEffRow, renderQualRow, renderQualStats, summaryBlock,
} from './caseStatsParts';

type Mode = 'half' | 'year' | 'month';
type Half = 'first' | 'second';

const MODES: { id: Mode; label: string }[] = [
  { id: 'half', label: '半期' },
  { id: 'year', label: '年度比較' },
  { id: 'month', label: '月次' },
];
/** 年度比較に並べる業務年度の数 */
const COMPARE_YEARS = 4;
const HALF_LABEL: Record<Half, string> = { first: '上期', second: '下期' };

// 業務年度: 2月〜翌年1月。上期 2〜7月 / 下期 8〜翌年1月
const today = new Date();
const CURRENT_BIZ_YEAR = today.getMonth() + 1 === 1 ? today.getFullYear() - 1 : today.getFullYear();
const CURRENT_HALF: Half = today.getMonth() + 1 >= 2 && today.getMonth() + 1 <= 7 ? 'first' : 'second';
const CURRENT_MONTH = today.getMonth() + 1;

function SectionTitle({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'indigo' }) {
  const cls = tone === 'indigo' ? 'bg-indigo-600' : 'bg-neutral-900';
  return <h4 className={`inline-block rounded-md ${cls} text-white text-xs font-bold px-3 py-1 mb-2`}>{children}</h4>;
}

function Collapsible({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="text-sm font-bold text-neutral-800">{title}</span>
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function StatusBadges({ confirm, caution, count }: { confirm: number; caution: number; count: number }) {
  return (
    <span className="ml-auto flex items-center gap-2 shrink-0">
      {confirm > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5">
          <AlertTriangle size={11} />確認要 {confirm}
        </span>
      )}
      {caution > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-0.5">注意 {caution}</span>
      )}
      <span className="text-xs text-neutral-400">案件 {count}</span>
    </span>
  );
}

function AttnList({ list }: { list: AttnItem[] }) {
  if (list.length === 0) return null;
  return (
    <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
      <p className="text-xs font-bold text-neutral-700 mb-2 flex items-center gap-1"><AlertTriangle size={12} />確認要・注意 {list.length}件</p>
      <ul className="space-y-1">
        {list.map(({ r, status, labels }) => (
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
  );
}

/** システム別の品質・効率（案件一覧と同じ表示。閾値は表示のみ） */
function SystemDetail({ kind, groups }: { kind: 'qual' | 'eff'; groups: SystemGroup[] }) {
  const th = useMemo(() => loadThresholds(), []);
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const confirmOf = (g: SystemGroup) => (kind === 'qual' ? g.qualConfirm : g.effConfirm);
  const attnOf = (g: SystemGroup) => (kind === 'qual' ? g.qualAttn : g.effAttn);
  const sorted = [...groups].sort((a, b) => confirmOf(b) - confirmOf(a) || attnOf(b).length - attnOf(a).length);

  return (
    <>
      <div className="flex flex-wrap gap-x-6 gap-y-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
        <span className="text-[11px] font-semibold text-neutral-400 w-full">
          {kind === 'qual' ? '評価閾値（表示のみ / 値が大きいほど悪い）' : '評価閾値（表示のみ）'}
        </span>
        {kind === 'qual' ? (
          <>
            <ThresholdRow label="NG流出率(%)" value={th.ngLeak} />
            <ThresholdRow label="想定ケース差" value={th.caseDiff} />
            <ThresholdRow label="潜在見逃し" value={th.sensen} />
          </>
        ) : (
          <>
            <ThresholdRow label="総効率" value={th.total} />
            <ThresholdRow label="設計効率" value={th.design} />
            <ThresholdRow label="実施効率" value={th.exec} />
            <ThresholdRow label="レビュー効率" value={th.review} />
          </>
        )}
      </div>
      <div className="space-y-3">
        {sorted.map((g) => {
          const attn = attnOf(g);
          const confirm = confirmOf(g);
          const open = openOverride[g.system] ?? attn.length > 0;
          const c = g.effStats.total.counts;
          return (
            <div key={g.system} className="border border-neutral-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenOverride((prev) => ({ ...prev, [g.system]: !open }))}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
              >
                {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                <span className="text-sm font-bold text-neutral-800 truncate">{g.system}</span>
                <div className="w-24 shrink-0 hidden sm:block">
                  {kind === 'qual'
                    ? <HealthBar high={g.count - attn.length} mid={attn.length - confirm} low={confirm} />
                    : <HealthBar high={c.high} mid={c.mid} low={c.low} />}
                </div>
                <span className="text-xs text-neutral-500 shrink-0">
                  {kind === 'qual' ? 'NG率 ' : '総効率 '}
                  <b className="text-neutral-900 tabular-nums">
                    {kind === 'qual' ? fmtPct(g.qualStats.ngRate) : fmtEff(g.totalEff)}
                  </b>
                </span>
                <StatusBadges confirm={confirm} caution={attn.length - confirm} count={g.count} />
              </button>
              {open && (
                <div className="p-3 space-y-3">
                  {kind === 'qual' ? renderQualStats(g.qualStats) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {summaryBlock('総効率', g.effStats.total.agg, g.effStats.total.counts)}
                      {summaryBlock('設計効率', g.effStats.design.agg, g.effStats.design.counts)}
                      {summaryBlock('実施効率', g.effStats.exec.agg, g.effStats.exec.counts)}
                      {summaryBlock('レビュー効率', g.effStats.review.agg, g.effStats.review.counts)}
                    </div>
                  )}
                  <AttnList list={attn} />
                  <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                    <table className="w-full border-collapse">
                      {kind === 'qual' ? qualHead : effHead}
                      <tbody>
                        {g.rows.map((r) => (kind === 'qual'
                          ? renderQualRow(r, th, plainCommentCell(r))
                          : renderEffRow(r, th, plainCommentCell(r))))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <p className="text-center text-sm text-neutral-400 py-8">該当データなし</p>}
      </div>
    </>
  );
}

function KpiCards({ defs, tone = 'plain' }: { defs: { key: string; desc?: string; text: string }[]; tone?: 'plain' | 'target' }) {
  const box = tone === 'target' ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-neutral-200';
  const label = tone === 'target' ? 'text-indigo-500' : 'text-neutral-400';
  const value = tone === 'target' ? 'text-indigo-900' : 'text-neutral-800';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {defs.map((d) => (
        <div key={d.key} title={d.desc} className={`border rounded-lg px-3 py-2.5 ${box} ${d.desc ? 'cursor-help' : ''}`}>
          <p className={`text-[10px] font-semibold tracking-wider truncate ${label}`}>{d.key}</p>
          <p className={`text-xl font-bold mt-0.5 tabular-nums ${value}`}>{d.text}</p>
        </div>
      ))}
    </div>
  );
}

// ── 半期：目標 → 実績 → システム別の品質・効率 ──
function HalfView({ items, targets, years }: { items: CaseStatItem[]; targets: Record<Half, KpiTarget[]>; years: number[] }) {
  const [period, setPeriod] = useState(`${CURRENT_BIZ_YEAR}:${CURRENT_HALF}`);
  const [qualOpen, setQualOpen] = useState(true);
  const [effOpen, setEffOpen] = useState(true);
  const [yearStr, half] = period.split(':') as [string, Half];
  const year = Number(yearStr);

  const halfItems = useMemo(() => itemsInHalf(items, year, half), [items, year, half]);
  const agg = useMemo(() => aggregateHalf(halfItems), [halfItems]);
  const groups = useMemo(() => groupBySystem(halfItems.map(toStatRow), loadThresholds()), [halfItems]);
  const halfTargets = targets[half];
  const align = (defs: KpiDef[]) => alignToTargets(defs, halfTargets.map((t) => t.label));
  const actualCards = (defs: KpiDef[]) => align(defs).map((d) => ({ key: d.key, desc: d.desc, text: d.fmt(d.pick(agg)) }));

  return (
    <div className="space-y-4">
      <select value={period} onChange={(e) => setPeriod(e.target.value)}
        className="bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700">
        {years.flatMap((y) => (['first', 'second'] as Half[]).map((h) => (
          <option key={`${y}:${h}`} value={`${y}:${h}`}>{y}年度 {HALF_LABEL[h]}</option>
        )))}
      </select>

      <div>
        <SectionTitle tone="indigo">{HALF_LABEL[half]}目標</SectionTitle>
        {halfTargets.length > 0
          ? <KpiCards tone="target" defs={halfTargets.map((t) => ({ key: t.label, text: t.value }))} />
          : <p className="text-xs text-neutral-400">目標が設定されていません</p>}
      </div>

      <div className="space-y-3">
        <div><SectionTitle>実績（品質）</SectionTitle><KpiCards defs={actualCards(KPI_QUALITY_DEFS)} /></div>
        <div><SectionTitle>実績（効率・規模）</SectionTitle><KpiCards defs={actualCards(KPI_EFFICIENCY_DEFS)} /></div>
      </div>

      <Collapsible title="品質" open={qualOpen} onToggle={() => setQualOpen((v) => !v)}>
        <SystemDetail kind="qual" groups={groups} />
      </Collapsible>
      <Collapsible title="効率" open={effOpen} onToggle={() => setEffOpen((v) => !v)}>
        <SystemDetail kind="eff" groups={groups} />
      </Collapsible>
    </div>
  );
}

// ── 年度比較：直近4年度の上期・下期 ──
function YearView({ items }: { items: CaseStatItem[] }) {
  const years = Array.from({ length: COMPARE_YEARS }, (_, i) => CURRENT_BIZ_YEAR - (COMPARE_YEARS - 1) + i);
  const cols = useMemo(
    () => years.flatMap((y) => (['first', 'second'] as Half[]).map((h) => ({ y, h, agg: aggregateHalf(itemsInHalf(items, y, h)) }))),
    [items, years.join()],
  );
  const table = (title: string, defs: KpiDef[]) => (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th rowSpan={2} className="text-left px-3 py-2 font-semibold border-b border-neutral-200">指標</th>
              {years.map((y) => <th key={y} colSpan={2} className="px-3 py-1.5 font-semibold border-b border-l border-neutral-200">{y}年度</th>)}
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={`${c.y}${c.h}`} className={`px-3 py-1.5 font-medium text-right border-b border-neutral-200 ${c.h === 'first' ? 'border-l' : ''}`}>{HALF_LABEL[c.h]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.key} title={d.desc} className="border-t border-neutral-100 first:border-t-0 hover:bg-neutral-50/60 cursor-help">
                <td className="px-3 py-2 text-neutral-700 whitespace-nowrap">{d.key}</td>
                {cols.map((c) => (
                  <td key={`${c.y}${c.h}`} className={`px-3 py-2 text-right tabular-nums text-neutral-800 ${c.h === 'first' ? 'border-l border-neutral-100' : ''}`}>
                    {c.agg.caseCount === 0 ? '-' : d.fmt(d.pick(c.agg))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      {table('品質', KPI_QUALITY_DEFS)}
      {table('効率・規模', KPI_EFFICIENCY_DEFS)}
    </div>
  );
}

// ── 月次：その月の問題案件（確認要・注意） ──
function MonthView({ items, years }: { items: CaseStatItem[]; years: number[] }) {
  const [year, setYear] = useState(CURRENT_BIZ_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const th = useMemo(() => loadThresholds(), []);

  // 業務年度内の各月の案件と問題案件
  const byMonth = useMemo(() => {
    const map = new Map<number, { qual: AttnItem[]; eff: AttnItem[]; count: number }>();
    for (const m of halfMonthsOrder('full')) map.set(m, { qual: [], eff: [], count: 0 });
    for (const it of itemsInHalf(items, year, 'full')) {
      const m = extractMonth(it.month);
      const bucket = m === null ? undefined : map.get(m);
      if (!bucket) continue;
      const r = toStatRow(it);
      bucket.count++;
      const q = qualAttention(r, th);
      const e = effAttention(r, th);
      if (q) bucket.qual.push(q);
      if (e) bucket.eff.push(e);
    }
    return map;
  }, [items, year, th]);
  const current = byMonth.get(month) ?? { qual: [], eff: [], count: 0 };

  const list = (title: string, rows: AttnItem[]) => {
    const sorted = [...rows].sort((a, b) => (a.status === b.status ? 0 : a.status === '確認要' ? -1 : 1)
      || (a.r.it.system || '').localeCompare(b.r.it.system || '', 'ja'));
    return (
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-neutral-100 text-xs font-bold text-neutral-700">{title}（{rows.length} 件）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
              <th className="text-left px-3 py-2 font-medium w-32">システム</th>
              <th className="text-left px-3 py-2 font-medium">案件</th>
              <th className="text-center px-2 py-2 font-medium w-16">判定</th>
              <th className="text-left px-3 py-2 font-medium">理由</th>
              <th className="text-left px-3 py-2 font-medium w-28">担当者</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {sorted.map(({ r, status, labels }) => (
              <tr key={r.it.id} className="align-top">
                <td className="px-3 py-2 text-neutral-600">{r.it.system || '(未設定)'}</td>
                <td className="px-3 py-2 text-neutral-800">{r.it.projectName || '-'}</td>
                <td className={`text-center px-2 py-2 ${status === '確認要' ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}`}>{status}</td>
                <td className="px-3 py-2 text-neutral-600">{labels.join(' / ')}</td>
                <td className="px-3 py-2 text-neutral-500 truncate max-w-[7rem]" title={r.it.assignee}>{r.it.assignee || '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-neutral-400">問題のある案件はありません</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700">
          {years.map((y) => <option key={y} value={y}>{y}年度</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {halfMonthsOrder('full').map((m) => {
            const b = byMonth.get(m)!;
            const problems = new Set([...b.qual, ...b.eff].map((x) => x.r.it.id)).size;
            const on = m === month;
            return (
              <button key={m} type="button" onClick={() => setMonth(m)}
                className={`relative px-3 py-1.5 rounded-lg text-xs border transition-colors ${on ? 'bg-neutral-900 text-white border-neutral-900 font-bold' : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'}`}>
                {m}月
                {problems > 0 && (
                  <span className={`ml-1 inline-block min-w-[1.1rem] rounded-full px-1 text-[10px] font-bold ${on ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700'}`}>{problems}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-neutral-500">{year}年度 {month}月：案件 {current.count} 件</p>
      {list('品質', current.qual)}
      {list('効率', current.eff)}
    </div>
  );
}

export default function PerformanceFeedback({ reloadKey }: { reloadKey: number }) {
  const [mode, setMode] = useState<Mode>('half');
  const [items, setItems] = useState<CaseStatItem[] | null>(null);
  const [targets, setTargets] = useState<Record<Half, KpiTarget[]>>({ first: [], second: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetch(`/api/test-center/case-stats${reloadKey > 0 ? '?refresh=true' : ''}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (alive) setItems(d.items ?? []); })
      .catch(() => { if (alive) setError('実績データの読み込みに失敗しました'); });
    // 目標は取得できなくても実績は表示する
    fetch('/api/config/kpi-targets')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setTargets({ first: d.first ?? [], second: d.second ?? [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);

  // 選択肢の年度：データにある業務年度＋今年度（新しい順）
  const years = useMemo(() => {
    const set = new Set<number>([CURRENT_BIZ_YEAR]);
    for (const it of items ?? []) {
      const m = (it.month || '').match(/^(\d{4})(\d{2})$/) ?? (it.month || '').match(/(\d{4})[-/.年](\d{1,2})/);
      if (m) set.add(Number(m[2]) === 1 ? Number(m[1]) - 1 : Number(m[1]));
    }
    return [...set].sort((a, b) => b - a);
  }, [items]);

  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-xs flex items-center gap-1.5"><AlertCircle size={14} />{error}</div>;
  if (!items) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 w-fit text-sm font-medium">
        {MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)}
            className={`px-4 py-1 rounded-md transition-colors ${mode === m.id ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'half' && <HalfView items={items} targets={targets} years={years} />}
      {mode === 'year' && <YearView items={items} />}
      {mode === 'month' && <MonthView items={items} years={years} />}
    </div>
  );
}
