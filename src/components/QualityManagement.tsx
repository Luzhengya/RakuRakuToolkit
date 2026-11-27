import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Loader2, RefreshCw, Save } from 'lucide-react';
import { BugLeakPage, GradeBadge, MonthCalendar, RadarChart } from './DataStatsPanel';
import PerformanceFeedback from './PerformanceFeedback';
import { Breadcrumb, CARD, CardHeader, ErrorAlert, ROW_FOCUS, TABLE_HEAD_ROW, clickableRowProps, expandableRowProps } from './shared/ui';
import { useSubRoute } from '../hooks/useSubRoute';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// ── Types ──

interface AiIssue {
  id: string;
  url: string;
  caseId: string;
  no: string;
  level: string;
  dimension: string;
  problem: string;
  tc: string;
  fix: string;
  other: string;
  judgement: string;
  reason: string;
}

interface AiCase {
  id: string;
  title: string;
  month: string;
  url: string;
  totalScore: number | null;
  grade: string;
  effortSaved: string;
  totalCases: number | null;
  dimScores: Record<string, number | null>;
  feedback: string;
}

/** 上海側指摘（案件管理で追加した指摘。ニーズ管理 DB） */
interface ShanghaiIssue {
  id: string;
  url: string;
  title: string;
  status: string;
  priority: string;
  requester: string;
  createdTime: string;
  cmdb: string;
}

type ShanghaiMap = Map<string, ShanghaiIssue[]>;

// ── Constants ──

const JUDGEMENTS = ['有効', '無効', 'その他'] as const;
const UNJUDGED = '未判断';
const LEVELS = ['Critical', 'Major', 'Minor', 'Info'];
const DIMENSIONS = ['要件追溯と範囲', '規格忠実度', 'テスト類型覆盖', '可執行性', '日本語表現'];
const REASON_MAX = 2000;
const LOAD_SIZE = 10;
const CRITICAL = 'Critical';
/** Critical 行の強調（背景） */
const CRITICAL_ROW = 'bg-red-50/70';

const JUDGE_COLORS: Record<string, string> = {
  有効: 'text-green-700 bg-green-50 border-green-200',
  無効: 'text-red-700 bg-red-50 border-red-200',
  その他: 'text-neutral-700 bg-neutral-100 border-neutral-200',
  [UNJUDGED]: 'text-neutral-400 bg-white border-neutral-200',
};

const LEVEL_COLORS: Record<string, string> = {
  Critical: 'text-red-600',
  Major: 'text-orange-500',
  Minor: 'text-amber-500',
  Info: 'text-blue-500',
};

const TABS = [
  { id: 'ai-issues', title: 'AIレビュー' },
  { id: 'ai-designs', title: 'AI設計書' },
  { id: 'ai-docs', title: 'AI資料' },
  { id: 'bugleak', title: '不具合流出確認' },
  { id: 'feedback', title: '実績フィードバック' },
] as const;

// ── Helpers ──

const judgeOf = (it: AiIssue) => it.judgement || UNJUDGED;

/** 案件名の先頭の数字を CMDB 番号とみなす（上海側指摘との突き合わせ用） */
const cmdbOf = (title: string) => title.trim().match(/^(\d+)/)?.[1] ?? '';

/** 重要度の並び順（Critical → Major → Minor → Info → 未設定）。Array.sort は安定なので同順位は元の順を保つ */
const levelRank = (level: string) => { const i = LEVELS.indexOf(level); return i < 0 ? LEVELS.length : i; };

interface CountRow {
  label: string;
  counts: Record<string, number>;
  total: number;
}

/** 有効率 = 有効 ÷ 判断済み（有効＋無効＋その他）。判断済みが0件なら null */
function validRate(counts: Record<string, number>): number | null {
  const judged = JUDGEMENTS.reduce((s, j) => s + (counts[j] ?? 0), 0);
  return judged > 0 ? (counts['有効'] ?? 0) / judged : null;
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function countBy(items: AiIssue[], keys: string[], keyOf: (it: AiIssue) => string, labelOf: (k: string) => string = (k) => k): CountRow[] {
  return keys.map((k) => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const it of items) {
      if (keyOf(it) !== k) continue;
      counts[judgeOf(it)] = (counts[judgeOf(it)] ?? 0) + 1;
      total++;
    }
    return { label: labelOf(k), counts, total };
  });
}

// ── Sub components ──

function SummaryCard({ label, value, sub, center }: { label: string; value: string | number; sub?: string; center?: boolean }) {
  // center：ラベルは左上、数字はカード中央。補足は下部の固定高さ枠に置き、補足の有無・行数で数字の高さがずれないようにする
  if (center) {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-3 flex flex-col">
        <div className="text-xs text-neutral-400">{label}</div>
        <div className="flex-1 flex items-center justify-center text-2xl font-bold text-neutral-800">{value}</div>
        <div className="h-7 text-xs text-neutral-400 text-center leading-snug">{sub}</div>
      </div>
    );
  }
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-2xl font-bold text-neutral-800">{value}</div>
      {sub && <div className="text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}

const JUDGE_COLUMNS = [...JUDGEMENTS, UNJUDGED];

function CountCells({ row }: { row: CountRow }) {
  return (
    <>
      {JUDGE_COLUMNS.map((j) => (
        <td key={j} className="text-center px-2 py-2 text-neutral-600">{row.counts[j] ?? 0}</td>
      ))}
      <td className="text-center px-2 py-2 font-bold text-neutral-800">{row.total}</td>
      <td className="text-center px-2 py-2 font-bold text-neutral-800">{formatRate(validRate(row.counts))}</td>
    </>
  );
}

function CountHeads() {
  return (
    <>
      {JUDGE_COLUMNS.map((j) => <th key={j} className="text-center px-2 py-2 font-medium w-14">{j}</th>)}
      <th className="text-center px-2 py-2 font-medium w-14">合計</th>
      <th className="text-center px-2 py-2 font-medium w-14">有効率</th>
    </>
  );
}

function TableBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <CardHeader title={title} />
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}


function CrossTable({ title, rows }: { title: string; rows: CountRow[] }) {
  return (
    <TableBox title={title}>
      <table className="w-full text-xs">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className="text-left px-3 py-2 font-medium">{title}</th>
            <CountHeads />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {rows.map((r) => (
            <tr key={r.label} className={r.label === CRITICAL ? CRITICAL_ROW : 'hover:bg-neutral-50/50'}>
              <td className={`px-3 py-2 whitespace-nowrap ${r.label === CRITICAL ? 'text-red-600 font-bold' : 'text-neutral-800'}`}>{r.label}</td>
              <CountCells row={r} />
            </tr>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}

interface CaseRow extends CountRow {
  caseId: string;
  month: string;
  url: string;
  /** 重要度ごとの有効件数 */
  validByLevel: Record<string, number>;
  shanghai: number;
}

/** 案件一覧：月次の新しい順。行クリックで指摘一覧をその案件で絞り込む */
function CaseTable({ rows, onSelect }: {
  rows: CaseRow[];
  onSelect: (caseId: string) => void;
}) {
  const [showCount, setShowCount] = useState(LOAD_SIZE);
  return (
    <TableBox title="案件一覧">
      <table className="w-full text-xs">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className="text-center px-2 py-2 font-medium w-[70px]">月次</th>
            <th className="text-left px-3 py-2 font-medium">案件</th>
            {LEVELS.map((l) => (
              <th key={l} className={`text-center px-2 py-2 font-medium w-14 ${l === CRITICAL ? 'text-red-600' : ''}`}>{l}</th>
            ))}
            <th className="text-center px-2 py-2 font-medium w-14">{UNJUDGED}</th>
            <th className="text-center px-2 py-2 font-medium w-14">合計</th>
            <th className="text-center px-2 py-2 font-medium w-14">有効率</th>
            <th className="text-center px-2 py-2 font-medium w-14">上海側</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {rows.slice(0, showCount).map((r) => (
            <tr key={r.caseId} {...clickableRowProps(() => onSelect(r.caseId))} className={`cursor-pointer hover:bg-neutral-50 ${ROW_FOCUS}`}>
              <td className="text-center px-2 py-2 text-neutral-400">{r.month || '—'}</td>
              <td className="px-3 py-2 text-neutral-800">{r.label}</td>
              {LEVELS.map((l) => {
                const n = r.validByLevel[l] ?? 0;
                const cls = n === 0 ? 'text-neutral-300' : l === CRITICAL ? 'text-red-600 font-bold' : 'text-neutral-700';
                return <td key={l} className={`text-center px-2 py-2 ${cls}`}>{n}</td>;
              })}
              <td className="text-center px-2 py-2 text-neutral-600">{r.counts[UNJUDGED] ?? 0}</td>
              <td className="text-center px-2 py-2 font-bold text-neutral-800">{r.total}</td>
              <td className="text-center px-2 py-2 font-bold text-neutral-800">{formatRate(validRate(r.counts))}</td>
              <td className={`text-center px-2 py-2 ${r.shanghai > 0 ? 'text-neutral-800 font-bold' : 'text-neutral-300'}`}>{r.shanghai}</td>
              <td className="text-center px-2 py-2">
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Notionで開く" className="text-neutral-400 hover:text-neutral-800">
                    <ExternalLink size={12} />
                  </a>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-neutral-400">データなし</td></tr>}
        </tbody>
      </table>
      {rows.length > showCount && (
        <div className="text-center border-t border-neutral-100 py-1">
          <button type="button" onClick={() => setShowCount((c) => c + LOAD_SIZE)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-3 py-1.5">
            もっと見る（残り {rows.length - showCount}件）
          </button>
        </div>
      )}
    </TableBox>
  );
}

function IssueEditor({ issue, onSaved }: { issue: AiIssue; onSaved: (judgement: string, reason: string) => void }) {
  const [judgement, setJudgement] = useState(issue.judgement);
  const [reason, setReason] = useState(issue.reason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = judgement !== issue.judgement || reason !== issue.reason;

  const save = () => {
    setSaving(true);
    setError(null);
    fetch(`/api/quality/ai-issues/${issue.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judgement, reason }),
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => onSaved(d.judgement ?? judgement, d.reason ?? reason))
      .catch(() => setError('保存に失敗しました'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-col md:flex-row md:items-start gap-2 bg-amber-50/40 border border-amber-100 rounded-lg p-2">
      <select
        value={judgement}
        onChange={(e) => setJudgement(e.target.value)}
        disabled={saving}
        className="border border-neutral-200 rounded px-2 py-1 text-xs bg-white md:w-28"
      >
        <option value="">{UNJUDGED}</option>
        {JUDGEMENTS.map((j) => <option key={j} value={j}>{j}</option>)}
      </select>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={saving}
        maxLength={REASON_MAX}
        rows={2}
        placeholder="判断理由"
        className="flex-1 border border-neutral-200 rounded px-2 py-1 text-xs bg-white resize-y"
      />
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded text-xs font-medium bg-neutral-900 text-white disabled:opacity-40"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}保存
      </button>
      {error && <span className="text-xs text-red-600 self-center">{error}</span>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-700 whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}

// ── AI指摘分析 ──

interface ScopeProps {
  scoped: AiIssue[];
  caseMap: Map<string, AiCase>;
  scopeLabel: string;
}

/** 指摘のある案件だけを、月次の新しい順→名称の順に並べる */
function sortedCaseIds(scoped: AiIssue[], caseMap: Map<string, AiCase>): string[] {
  const ids = [...new Set(scoped.map((it) => it.caseId))];
  const monthOf = (id: string) => caseMap.get(id)?.month ?? '';
  const titleOf = (id: string) => caseMap.get(id)?.title ?? '';
  return ids.sort((a, b) => monthOf(b).localeCompare(monthOf(a)) || titleOf(a).localeCompare(titleOf(b), 'ja'));
}

function caseLabelOf(caseMap: Map<string, AiCase>, id: string): string {
  const c = caseMap.get(id);
  return c ? `${c.month ? `${c.month} ` : ''}${c.title}` : '（案件なし）';
}

// ── AI指摘分析（統計画面） ──

function AiStatsView({ scoped, allItems, year, monthKey, caseMap, scopeLabel, calendar, onSelectCase, shanghaiByCmdb }: ScopeProps & {
  allItems: AiIssue[];
  /** 月次カレンダーの選択（YYYYMM。未選択＝''＝全月） */
  monthKey: string;
  /** グラフに表示する年（カレンダーの年） */
  year: number;
  calendar: ReactNode;
  onSelectCase: (caseId: string) => void;
  shanghaiByCmdb: ShanghaiMap;
}) {
  const caseIds = useMemo(() => sortedCaseIds(scoped, caseMap), [scoped, caseMap]);
  const shanghaiOf = useCallback(
    (caseId: string) => shanghaiByCmdb.get(cmdbOf(caseMap.get(caseId)?.title ?? ''))?.length ?? 0,
    [shanghaiByCmdb, caseMap],
  );
  // 同じ CMDB の案件が複数あっても上海側指摘は1回だけ数える
  const shanghaiTotal = useMemo(() => {
    const cmdbs = new Set(caseIds.map((id) => cmdbOf(caseMap.get(id)?.title ?? '')).filter(Boolean));
    return [...cmdbs].reduce((n, c) => n + (shanghaiByCmdb.get(c)?.length ?? 0), 0);
  }, [caseIds, caseMap, shanghaiByCmdb]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of scoped) counts[judgeOf(it)] = (counts[judgeOf(it)] ?? 0) + 1;
    return { total: scoped.length, unjudged: counts[UNJUDGED] ?? 0, rate: validRate(counts), counts };
  }, [scoped]);

  // 改善工数の合計（人日）：選択月の全案件（未選択なら全案件）。月次別 工数改善グラフと同じ口径
  const effortTotal = useMemo(() => {
    let sum = 0;
    for (const c of caseMap.values()) {
      const v = parseFloat(c.effortSaved);
      if ((!monthKey || c.month === monthKey) && Number.isFinite(v)) sum += v;
    }
    return Math.round(sum * 100) / 100;
  }, [caseMap, monthKey]);

  // 月次別の AI有効指摘件数・Critical有効件数・上海側指摘件数（カレンダーの年の1月〜12月。月の選択には連動しない）
  const monthlySeries = useMemo(() => {
    const byMonth = new Map<string, { valid: number; critical: number; shanghai: number }>();
    const bucket = (m: string) => {
      if (!byMonth.has(m)) byMonth.set(m, { valid: 0, critical: 0, shanghai: 0 });
      return byMonth.get(m)!;
    };
    for (const it of allItems) {
      const m = caseMap.get(it.caseId)?.month;
      if (!m || it.judgement !== '有効') continue;
      bucket(m).valid++;
      if (it.level === CRITICAL) bucket(m).critical++;
    }
    // 上海側指摘は CMDB 番号が同じ案件の月次（複数あれば最新）に計上する
    const monthByCmdb = new Map<string, string>();
    for (const c of caseMap.values()) {
      const cmdb = cmdbOf(c.title);
      if (cmdb && c.month && c.month > (monthByCmdb.get(cmdb) ?? '')) monthByCmdb.set(cmdb, c.month);
    }
    for (const [cmdb, list] of shanghaiByCmdb) {
      const m = monthByCmdb.get(cmdb);
      if (m) bucket(m).shanghai += list.length;
    }
    return Array.from({ length: 12 }, (_, i) => {
      const v = byMonth.get(`${year}${String(i + 1).padStart(2, '0')}`) ?? { valid: 0, critical: 0, shanghai: 0 };
      return { month: `${i + 1}月`, ...v };
    });
  }, [allItems, caseMap, shanghaiByCmdb, year]);

  // 月次別の工数改善（人日）合計。案件の「案件月次」に計上（カレンダーの年の1月〜12月）
  const effortSeries = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const c of caseMap.values()) {
      const v = parseFloat(c.effortSaved);
      if (c.month && Number.isFinite(v)) byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + v);
    }
    return Array.from({ length: 12 }, (_, i) => ({
      month: `${i + 1}月`,
      effort: Math.round((byMonth.get(`${year}${String(i + 1).padStart(2, '0')}`) ?? 0) * 100) / 100,
    }));
  }, [caseMap, year]);

  const caseRows = useMemo(
    () => countBy(scoped, caseIds, (it) => it.caseId, (id) => caseMap.get(id)?.title ?? '（案件なし）').map((r, i) => ({
      ...r,
      caseId: caseIds[i],
      month: caseMap.get(caseIds[i])?.month ?? '',
      url: caseMap.get(caseIds[i])?.url ?? '',
      validByLevel: Object.fromEntries(LEVELS.map((l) => [
        l,
        scoped.filter((it) => it.caseId === caseIds[i] && it.level === l && it.judgement === '有効').length,
      ])),
      shanghai: shanghaiOf(caseIds[i]),
    })),
    [scoped, caseIds, caseMap, shanghaiOf],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-stretch gap-4">
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 h-full">
            <SummaryCard center label="AI指摘数" value={summary.total} />
            <SummaryCard center label="判断済み" value={summary.total - summary.unjudged} sub={JUDGEMENTS.map((j) => `${j} ${summary.counts[j] ?? 0}`).join(' / ')} />
            <SummaryCard center label="未判断" value={summary.unjudged} />
            <SummaryCard center label="有効率" value={formatRate(summary.rate)} sub="有効 ÷ 判断済み" />
            <SummaryCard center label="上海側指摘" value={shanghaiTotal} />
            <SummaryCard center label="工数改善" value={effortTotal} sub="人日" />
          </div>
        </div>
        {calendar}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <TableBox title={`月次別 AI有効指摘・Critical有効・上海側指摘（${year}年）`}>
        {/* overflow-hidden：リサイズ時に SVG が旧幅のまま一瞬はみ出し、TableBox の横スクロールバーが出るのを防ぐ */}
        <div className="h-56 p-3 overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlySeries} barGap={0} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#a3a3a3" />
              <YAxis tick={{ fontSize: 10 }} stroke="#a3a3a3" allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="valid" name="AI有効指摘" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="critical" name="Critical（有効）" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="shanghai" name="上海側指摘" fill="#334155" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TableBox>
      <TableBox title={`月次別 工数改善（${year}年・人日）`}>
        <div className="h-56 p-3 overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={effortSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#a3a3a3" />
              <YAxis tick={{ fontSize: 10 }} stroke="#a3a3a3" />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }} formatter={(v) => [`${v} 人日`, '工数改善']} />
              <Line type="monotone" dataKey="effort" name="工数改善" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TableBox>
      </div>
      <CaseTable key={scopeLabel} rows={caseRows} onSelect={onSelectCase} />
    </div>
  );
}

// ── 案件分析（案件を指定して指摘一覧を開いた場合） ──

function FeedbackEditor({ caseInfo, onSaved, endpoint }: {
  caseInfo: Pick<AiCase, 'id' | 'feedback'>;
  onSaved: (feedback: string) => void;
  /** 保存先 API（省略時は AIレビュー案件） */
  endpoint?: string;
}) {
  const [text, setText] = useState(caseInfo.feedback);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setSaving(true);
    setError(null);
    fetch(endpoint ?? `/api/quality/ai-cases/${caseInfo.id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: text }),
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => onSaved(d.feedback ?? text))
      .catch(() => setError('保存に失敗しました'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={saving}
        maxLength={REASON_MAX}
        rows={4}
        placeholder="このレビュー結果へのフィードバック"
        className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs bg-white resize-y"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={text === caseInfo.feedback || saving}
          className="inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-medium bg-neutral-900 text-white disabled:opacity-40"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}保存
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

const SCORE_DIMENSIONS: { key: string; name: string }[] = [
  { key: '要件追溯', name: '要件追溯と範囲' },
  { key: '規格忠実度', name: '規格忠実度' },
  { key: 'テスト類型', name: 'テスト類型覆盖' },
  { key: '可執行性', name: '可執行性' },
  { key: '日本語表現', name: '日本語表現' },
];

function CaseAnalysis({ caseInfo, issues, shanghaiCount, onFeedbackSaved }: {
  caseInfo: AiCase;
  issues: AiIssue[];
  shanghaiCount: number;
  onFeedbackSaved: (feedback: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const criticalCount = issues.filter((it) => it.level === CRITICAL).length;
  const criticalValid = issues.filter((it) => it.level === CRITICAL && it.judgement === '有効').length;
  const levelRows = useMemo(() => countBy(issues, LEVELS, (it) => it.level), [issues]);
  const dimRows = useMemo(() => countBy(issues, DIMENSIONS, (it) => it.dimension), [issues]);
  const judgeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of issues) counts[judgeOf(it)] = (counts[judgeOf(it)] ?? 0) + 1;
    return counts;
  }, [issues]);
  const dims = SCORE_DIMENSIONS
    .filter((d) => caseInfo.dimScores[d.key] != null)
    .map((d) => ({ name: d.name, weight: '', score: caseInfo.dimScores[d.key] as number }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
          <div className="text-xs text-neutral-400">総合得点</div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-neutral-800">{caseInfo.totalScore ?? '—'}</span>
            {caseInfo.grade && <GradeBadge grade={caseInfo.grade} size="sm" />}
          </div>
        </div>
        <SummaryCard label="工数改善" value={caseInfo.effortSaved ? `${caseInfo.effortSaved} 人日` : '—'} />
        <SummaryCard label="テスト総件数" value={caseInfo.totalCases ?? '—'} />
        <div className={`rounded-xl p-3 space-y-1 border ${criticalCount > 0 ? 'bg-red-50 border-red-300' : 'bg-white border-neutral-200'}`}>
          <div className={`text-xs ${criticalCount > 0 ? 'text-red-600 font-bold' : 'text-neutral-400'}`}>Critical</div>
          <div className={`text-2xl font-bold ${criticalCount > 0 ? 'text-red-600' : 'text-neutral-800'}`}>{criticalCount}</div>
          <div className="text-xs text-neutral-400">うち有効 {criticalValid}</div>
        </div>
        <SummaryCard
          label="有効率"
          value={formatRate(validRate(judgeCounts))}
          sub={JUDGE_COLUMNS.map((j) => `${j} ${judgeCounts[j] ?? 0}`).join(' / ')}
        />
        <SummaryCard label="上海側指摘" value={shanghaiCount} />
      </div>

      <TableBox title="フィードバック">
        <div className="p-3">
          <FeedbackEditor key={caseInfo.id + caseInfo.feedback} caseInfo={caseInfo} onSaved={onFeedbackSaved} />
        </div>
      </TableBox>

      <div className={`${CARD} overflow-hidden`}>
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          aria-expanded={detailOpen}
          className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
        >
          <ChevronDown size={12} className={`text-neutral-400 transition-transform ${detailOpen ? 'rotate-180' : ''}`} />
          評価の詳細（評価標準・重要度）
        </button>
        {detailOpen && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 border-t border-neutral-100">
        <TableBox title="評価標準 得点">
          {dims.length >= 3 ? (
            <div className="p-3 space-y-2">
              <RadarChart dimensions={dims} size={180} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {dims.map((d) => (
                  <div key={d.name} className="flex justify-between"><span className="text-neutral-500">{d.name}</span><span className="font-bold text-neutral-800">{d.score}</span></div>
                ))}
              </div>
            </div>
          ) : <div className="text-center py-8 text-xs text-neutral-400">得点なし</div>}
        </TableBox>

        <TableBox title={`重要度（指摘 ${issues.length} 件）`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className="text-left px-3 py-2 font-medium">重要度</th>
                <th className="text-center px-2 py-2 font-medium">件数</th>
                <th className="text-center px-2 py-2 font-medium">比率</th>
                <th className="text-center px-2 py-2 font-medium">有効</th>
                <th className="text-center px-2 py-2 font-medium">有効率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {levelRows.map((r) => (
                <tr key={r.label} className={r.label === CRITICAL ? CRITICAL_ROW : ''}>
                  <td className={`px-3 py-2 font-bold ${LEVEL_COLORS[r.label] ?? ''}`}>{r.label}</td>
                  <td className="text-center px-2 py-2 text-neutral-700">{r.total}</td>
                  <td className="text-center px-2 py-2 text-neutral-700">{formatRate(issues.length ? r.total / issues.length : null)}</td>
                  <td className="text-center px-2 py-2 text-neutral-700">{r.counts['有効'] ?? 0}</td>
                  <td className="text-center px-2 py-2 text-neutral-700">{formatRate(validRate(r.counts))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
        <div className="lg:col-span-2">
          <CrossTable title="評価標準" rows={dimRows} />
        </div>
      </div>
        )}
      </div>
    </div>
  );
}

// ── 指摘一覧（子画面） ──

function IssueListView({ scoped, caseMap, caseId, onCaseChange, onSaved, onFeedbackSaved, shanghaiByCmdb }: Omit<ScopeProps, 'scopeLabel'> & {
  caseId: string;
  onCaseChange: (caseId: string) => void;
  onSaved: (id: string, judgement: string, reason: string) => void;
  onFeedbackSaved: (caseId: string, feedback: string) => void;
  shanghaiByCmdb: ShanghaiMap;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fDim, setFDim] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fJudge, setFJudge] = useState('');

  const caseIds = useMemo(() => sortedCaseIds(scoped, caseMap), [scoped, caseMap]);
  const filtered = useMemo(() => scoped.filter((it) =>
    it.caseId === caseId
    && (!fDim || it.dimension === fDim)
    && (!fLevel || it.level === fLevel)
    && (!fJudge || judgeOf(it) === fJudge),
  ).sort((a, b) => levelRank(a.level) - levelRank(b.level)), [scoped, caseId, fDim, fLevel, fJudge]);

  const selectClass = 'border border-neutral-200 rounded px-2 py-1 text-xs bg-white';
  const caseInfo = caseId ? caseMap.get(caseId) : undefined;
  const caseIssues = useMemo(() => scoped.filter((it) => it.caseId === caseId), [scoped, caseId]);
  const shanghai = shanghaiByCmdb.get(cmdbOf(caseInfo?.title ?? '')) ?? [];

  return (
    <div className="space-y-3">
      {caseInfo && (
        <CaseAnalysis caseInfo={caseInfo} issues={caseIssues} shanghaiCount={shanghai.length} onFeedbackSaved={(fb) => onFeedbackSaved(caseInfo.id, fb)} />
      )}
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-neutral-100 flex flex-wrap items-center gap-2">
          <select value={caseId} onChange={(e) => onCaseChange(e.target.value)} className={`${selectClass} max-w-[320px]`}>
            {caseIds.map((id) => <option key={id} value={id}>{caseLabelOf(caseMap, id)}</option>)}
          </select>
          <select value={fDim} onChange={(e) => setFDim(e.target.value)} className={selectClass}>
            <option value="">評価標準：すべて</option>
            {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={fLevel} onChange={(e) => setFLevel(e.target.value)} className={selectClass}>
            <option value="">重要度：すべて</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={fJudge} onChange={(e) => setFJudge(e.target.value)} className={selectClass}>
            <option value="">判断：すべて</option>
            {JUDGE_COLUMNS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <span className="text-xs text-neutral-400 ml-auto">{filtered.length} 件</span>
        </div>
        <div className="divide-y divide-neutral-50">
          {filtered.map((it) => {
            const open = expandedId === it.id;
            const judge = judgeOf(it);
            return (
              <div key={it.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : it.id)}
                  aria-expanded={open}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-l-4 ${it.level === CRITICAL ? `${CRITICAL_ROW} border-red-500 hover:bg-red-50` : 'border-transparent hover:bg-neutral-50'}`}
                >
                  <ChevronDown size={12} className={`text-neutral-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                  <span className="w-12 shrink-0 text-neutral-400">{it.no || '—'}</span>
                  <span className={`w-14 shrink-0 font-bold ${LEVEL_COLORS[it.level] ?? 'text-neutral-400'}`}>{it.level || '—'}</span>
                  <span className="w-28 shrink-0 text-neutral-500 truncate">{it.dimension || '—'}</span>
                  <span className="flex-1 truncate text-neutral-800">{it.problem}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] ${JUDGE_COLORS[judge]}`}>{judge}</span>
                </button>
                {open && (
                  <div className="px-8 pb-3 space-y-2 text-xs">
                    <DetailRow label="案件" value={caseLabelOf(caseMap, it.caseId)} />
                    <DetailRow label="問題" value={it.problem} />
                    <DetailRow label="該当TC" value={it.tc} />
                    <DetailRow label="修正案" value={it.fix} />
                    <DetailRow label="その他記載" value={it.other} />
                    <IssueEditor key={`${it.judgement}|${it.reason}`} issue={it} onSaved={(j, r) => onSaved(it.id, j, r)} />
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900">
                      <ExternalLink size={11} />Notionで開く
                    </a>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-8 text-xs text-neutral-400">データなし</div>}
        </div>
      </div>

      <TableBox title={`上海側指摘（${shanghai.length} 件）`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              <th className="text-left px-3 py-2 font-medium">内容</th>
              <th className="text-center px-2 py-2 font-medium w-20">状態</th>
              <th className="text-center px-2 py-2 font-medium w-16">優先度</th>
              <th className="text-center px-2 py-2 font-medium w-28">請求者</th>
              <th className="text-center px-2 py-2 font-medium w-24">提出日</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {shanghai.map((n) => (
              <tr key={n.id} className="hover:bg-neutral-50/50">
                <td className="px-3 py-2 text-neutral-800 whitespace-pre-wrap break-words">{n.title || '—'}</td>
                <td className="text-center px-2 py-2 text-neutral-600">{n.status || '—'}</td>
                <td className="text-center px-2 py-2 text-neutral-600">{n.priority || '—'}</td>
                <td className="text-center px-2 py-2 text-neutral-600">{n.requester || '—'}</td>
                <td className="text-center px-2 py-2 text-neutral-500">{n.createdTime ? n.createdTime.slice(0, 10) : '—'}</td>
                <td className="text-center px-2 py-2">
                  {n.url && (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" title="Notionで開く" className="text-neutral-400 hover:text-neutral-800">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {shanghai.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-neutral-400">上海側指摘なし</td></tr>}
          </tbody>
        </table>
      </TableBox>
    </div>
  );
}

// ── AI設計書（AIテスト設計書成果物。1行＝1成果物） ──

interface AiDesign {
  id: string;
  url: string;
  title: string;
  month: string;
  effortSaved: number | null;
  feedback: string;
  createdTime: string;
  caseNames: string[];
}

/** 一覧の取得（reloadKey が 0 より大きければキャッシュを無視） */
function useQualityData<T>(path: string, reloadKey: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    fetch(`${path}${reloadKey > 0 ? '?refresh=1' : ''}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setData(d))
      .catch(() => setError('読み込みに失敗しました'));
  }, [path, reloadKey]);
  return { data, setData, error };
}

function LoadState({ error }: { error: string | null }) {
  return error ? (
    <ErrorAlert message={error} />
  ) : (
    <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>
  );
}

function NotionLink({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Notionで開く" className="text-neutral-400 hover:text-neutral-800">
      <ExternalLink size={12} />
    </a>
  );
}

function AiDesignView({ monthKey, reloadKey, calendar }: { monthKey: string; reloadKey: number; calendar: ReactNode }) {
  const { data, setData, error } = useQualityData<{ items: AiDesign[] }>('/api/quality/ai-designs', reloadKey);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(LOAD_SIZE);

  // 月次カレンダーの選択（未選択＝全月）。案件月次が未入力の成果物は全月のときだけ表示する
  const rows = useMemo(
    () => (data?.items ?? []).filter((d) => !monthKey || d.month === monthKey),
    [data, monthKey],
  );
  const effortTotal = Math.round(rows.reduce((s, d) => s + (d.effortSaved ?? 0), 0) * 100) / 100;

  if (!data) return <LoadState error={error} />;

  const onFeedbackSaved = (id: string, feedback: string) =>
    setData((prev) => prev && { items: prev.items.map((d) => (d.id === id ? { ...d, feedback } : d)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-stretch gap-4">
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 gap-3 h-full">
            <SummaryCard center label="案件数" value={rows.length} />
            <SummaryCard center label="工数改善" value={effortTotal} sub="人日" />
          </div>
        </div>
        {calendar}
      </div>

      <TableBox title="成果物一覧">
        <table className="w-full text-xs">
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              <th className="text-center px-2 py-2 font-medium w-[70px]">月次</th>
              <th className="text-left px-3 py-2 font-medium">成果物</th>
              <th className="text-left px-3 py-2 font-medium">関連案件</th>
              <th className="text-center px-2 py-2 font-medium w-20">工数改善</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {rows.slice(0, showCount).map((d) => {
              const open = expandedId === d.id;
              return (
                <Fragment key={d.id}>
                  <tr {...expandableRowProps(open, () => setExpandedId(open ? null : d.id))} className={`cursor-pointer hover:bg-neutral-50 align-top ${ROW_FOCUS}`}>
                    <td className="text-center px-2 py-2 text-neutral-400">{d.month || '—'}</td>
                    <td className="px-3 py-2 text-neutral-800">{d.title || '—'}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {d.caseNames.length ? d.caseNames.map((n, i) => <div key={i}>{n}</div>) : '—'}
                    </td>
                    <td className="text-center px-2 py-2 font-bold text-neutral-800">{d.effortSaved ?? '—'}</td>
                    <td className="text-center px-2 py-2"><NotionLink url={d.url} /></td>
                  </tr>
                  {/* フィードバックは長くなるため一覧には出さず、行クリックで展開して表示・編集する */}
                  {open && (
                    <tr>
                      <td colSpan={5} className="px-3 py-3 bg-neutral-50/60">
                        <div className="text-xs text-neutral-400 mb-1">フィードバック</div>
                        <FeedbackEditor
                          key={d.id + d.feedback}
                          caseInfo={d}
                          endpoint={`/api/quality/ai-designs/${d.id}/feedback`}
                          onSaved={(fb) => onFeedbackSaved(d.id, fb)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-neutral-400">データなし</td></tr>}
          </tbody>
        </table>
        {rows.length > showCount && (
          <div className="text-center border-t border-neutral-100 py-1">
            <button type="button" onClick={() => setShowCount((c) => c + LOAD_SIZE)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-3 py-1.5">
              もっと見る（残り {rows.length - showCount}件）
            </button>
          </div>
        )}
      </TableBox>
    </div>
  );
}

// ── AI資料（Skills／関連使用手順／関連調査。一覧のみ、行クリックで Notion を開く） ──

interface AiDoc {
  id: string;
  url: string;
  title: string;
  createdTime: string;
  lastEditedTime: string;
}

interface AiSkill extends AiDoc {
  description: string;
  history: string;
}

const openNotion = (url: string) => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); };
const dateOf = (iso: string) => (iso ? iso.slice(0, 10) : '—');

function DocTable({ title, docs }: { title: string; docs: AiDoc[] }) {
  return (
    <TableBox title={`${title}（${docs.length} 件）`}>
      <table className="w-full text-xs">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className="text-left px-3 py-2 font-medium">名称</th>
            <th className="text-center px-2 py-2 font-medium w-24">作成日</th>
            <th className="text-center px-2 py-2 font-medium w-24">更新日</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {docs.map((d) => (
            <tr key={d.id} {...clickableRowProps(() => openNotion(d.url))} className={`cursor-pointer hover:bg-neutral-50 ${ROW_FOCUS}`}>
              <td className="px-3 py-2 text-neutral-800">{d.title || '—'}</td>
              <td className="text-center px-2 py-2 text-neutral-500">{dateOf(d.createdTime)}</td>
              <td className="text-center px-2 py-2 text-neutral-500">{dateOf(d.lastEditedTime)}</td>
              <td className="text-center px-2 py-2"><NotionLink url={d.url} /></td>
            </tr>
          ))}
          {docs.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-neutral-400">データなし</td></tr>}
        </tbody>
      </table>
    </TableBox>
  );
}

function AiDocsView({ reloadKey }: { reloadKey: number }) {
  const { data, error } = useQualityData<{ skills: AiSkill[]; manuals: AiDoc[]; researches: AiDoc[] }>('/api/quality/ai-docs', reloadKey);
  if (!data) return <LoadState error={error} />;
  return (
    <div className="space-y-4">
      <TableBox title={`Skills（${data.skills.length} 件）`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              <th className="text-left px-3 py-2 font-medium w-56">名称</th>
              <th className="text-left px-3 py-2 font-medium">説明</th>
              <th className="text-left px-3 py-2 font-medium">更新履歴</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {data.skills.map((s) => (
              <tr key={s.id} {...clickableRowProps(() => openNotion(s.url))} className={`cursor-pointer hover:bg-neutral-50 align-top ${ROW_FOCUS}`}>
                <td className="px-3 py-2 text-neutral-800 font-medium">{s.title || '—'}</td>
                <td className="px-3 py-2 text-neutral-600 whitespace-pre-wrap break-words">{s.description || '—'}</td>
                <td className="px-3 py-2 text-neutral-600 whitespace-pre-wrap break-words">{s.history || '—'}</td>
                <td className="text-center px-2 py-2"><NotionLink url={s.url} /></td>
              </tr>
            ))}
            {data.skills.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-neutral-400">データなし</td></tr>}
          </tbody>
        </table>
      </TableBox>
      <DocTable title="関連使用手順" docs={data.manuals} />
      <DocTable title="関連調査" docs={data.researches} />
    </div>
  );
}

// ── Page ──
// ルート：#/quality（統計）／#/quality/issues（指摘一覧）／#/quality/issues/<案件ページID>（案件で絞り込み）

export default function QualityManagement({ onBack }: { onBack: () => void }) {
  const [subRoute, setSubRoute] = useSubRoute();
  const [tabState, setTabState] = useState<(typeof TABS)[number]['id']>('ai-issues');
  // 不具合流出確認は URL（#/quality/bugleak）で開く。データ統計の旧URLからの転送先
  const tab = subRoute[0] === 'bugleak' ? 'bugleak' : tabState === 'bugleak' ? 'ai-issues' : tabState;
  const setTab = (id: (typeof TABS)[number]['id']) => {
    setTabState(id);
    setSubRoute(id === 'bugleak' ? ['bugleak'] : []);
  };
  const [items, setItems] = useState<AiIssue[]>([]);
  const [cases, setCases] = useState<AiCase[]>([]);
  const [shanghaiIssues, setShanghaiIssues] = useState<ShanghaiIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  // 指摘一覧は案件を指定した場合だけ開く（#/quality/issues/<案件ページID>）
  const routeCaseId = subRoute[0] === 'issues' ? subRoute[1] ?? '' : '';
  const issuesOpen = routeCaseId !== '';

  const load = useCallback((refresh: boolean) => {
    setLoading(true);
    setError(null);
    fetch(`/api/quality/ai-issues${refresh ? '?refresh=1' : ''}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setItems(d.items ?? []); setCases(d.cases ?? []); setShanghaiIssues(d.shanghaiIssues ?? []); })
      .catch(() => setError('AI指摘の読み込みに失敗しました'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);
  // 再読込の回数。AI設計書・AI資料はこの値が変わったらキャッシュを無視して取り直す
  const [reloadKey, setReloadKey] = useState(0);

  const caseMap = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const shanghaiByCmdb = useMemo(() => {
    const map: ShanghaiMap = new Map();
    for (const n of shanghaiIssues) map.set(n.cmdb, [...(map.get(n.cmdb) ?? []), n]);
    return map;
  }, [shanghaiIssues]);

  // 月次カレンダーの選択（未選択＝全月）。案件の「案件月次」(YYYYMM) で絞り込み、子画面にも引き継ぐ
  const monthKey = filterMonth == null ? '' : `${filterYear}${String(filterMonth).padStart(2, '0')}`;
  const scoped = useMemo(
    () => (monthKey ? items.filter((it) => caseMap.get(it.caseId)?.month === monthKey) : items),
    [items, monthKey, caseMap],
  );
  const scopeLabel = monthKey ? `${filterYear}年${filterMonth}月の案件` : '全月';

  const onSaved = (id: string, judgement: string, reason: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, judgement, reason } : it)));
  };

  const onFeedbackSaved = (caseId: string, feedback: string) => {
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, feedback } : c)));
  };

  const goStats = () => setSubRoute([]);
  const goIssues = (caseId: string) => setSubRoute(['issues', caseId]);

  // 案件の無い #/quality/issues は統計画面へ戻す
  useEffect(() => {
    if (subRoute[0] === 'issues' && !subRoute[1]) setSubRoute([]);
  }, [subRoute, setSubRoute]);

  // 指摘一覧は月次に関係なくその案件の指摘を表示し、パンくずを案件名にする
  const routeCase = routeCaseId ? caseMap.get(routeCaseId) : undefined;
  const breadcrumb = issuesOpen
    ? [{ label: 'ホーム', onClick: onBack }, { label: '品質管理', onClick: goStats }, { label: routeCase ? caseLabelOf(caseMap, routeCase.id) : '指摘一覧' }]
    : [{ label: 'ホーム', onClick: onBack }, { label: '品質管理' }];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-2">
      <div className="flex items-start">
        <Breadcrumb items={breadcrumb} />
        <button type="button" onClick={() => { load(true); setReloadKey((k) => k + 1); }} className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900">
          <RefreshCw size={12} />再読込
        </button>
      </div>
      {!issuesOpen && (
        <div className="flex gap-1 border-b border-neutral-200 mb-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${tab === t.id ? 'border-neutral-900 text-neutral-900 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
      {!issuesOpen && tab === 'bugleak' ? (
        <BugLeakPage key={reloadKey} />
      ) : !issuesOpen && tab === 'feedback' ? (
        <PerformanceFeedback reloadKey={reloadKey} />
      ) : !issuesOpen && tab === 'ai-designs' ? (
        <AiDesignView
          monthKey={monthKey}
          reloadKey={reloadKey}
          calendar={<MonthCalendar year={filterYear} month={filterMonth} onSelect={(y, m) => { setFilterYear(y); setFilterMonth(m); }} />}
        />
      ) : !issuesOpen && tab === 'ai-docs' ? (
        <AiDocsView reloadKey={reloadKey} />
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>
      ) : error ? (
        <ErrorAlert message={error} />
      ) : issuesOpen ? (
        <IssueListView
          scoped={items}
          caseMap={caseMap}
          caseId={routeCaseId}
          onCaseChange={goIssues}
          onSaved={onSaved}
          onFeedbackSaved={onFeedbackSaved}
          shanghaiByCmdb={shanghaiByCmdb}
        />
      ) : tab === 'ai-issues' ? (
        <AiStatsView
          scoped={scoped}
          allItems={items}
          year={filterYear}
          monthKey={monthKey}
          caseMap={caseMap}
          scopeLabel={scopeLabel}
          calendar={<MonthCalendar year={filterYear} month={filterMonth} onSelect={(y, m) => { setFilterYear(y); setFilterMonth(m); }} />}
          onSelectCase={goIssues}
          shanghaiByCmdb={shanghaiByCmdb}
        />
      ) : null}
    </div>
  );
}
