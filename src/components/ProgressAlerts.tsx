import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Pause, Play } from 'lucide-react';

type AlertLevel = 'overdue' | 'today' | 'soon' | 'missing' | 'inconsistent';

export interface CaseAlert {
  caseId: string;
  areaId: string;
  projectName: string;
  system: string;
  assignee: string;
  status: string;
  level: AlertLevel;
  milestone: 'design' | 'execution' | null;
  plannedDate: string;
  days: number | null;
  message: string;
  note: string | null;
}

export interface AlertsResult {
  planMissing: CaseAlert[];
  design: CaseAlert[];
  execution: CaseAlert[];
  inconsistent: CaseAlert[];
  watched: number;
  completedStatuses: string[];
}

const PAUSE_KEY = 'testcenter:alerts:paused:v1';
// 1行が流れきるまでの秒数。行数 × この値がひと回りの時間になる
const SECONDS_PER_ROW = 2.5;
const ROW_HEIGHT = 36;   // px。ループのズレを防ぐため固定する
const VISIBLE_ROWS = 3;

const LEVEL_STYLE: Record<AlertLevel, { badge: string; text: string; rank: number }> = {
  overdue:      { badge: 'bg-red-100 text-red-700 border-red-200',            text: '遅延',      rank: 0 },
  today:        { badge: 'bg-orange-100 text-orange-700 border-orange-200',   text: '本日期限',  rank: 1 },
  soon:         { badge: 'bg-amber-100 text-amber-700 border-amber-200',      text: '期限接近',  rank: 2 },
  missing:      { badge: 'bg-violet-100 text-violet-700 border-violet-200',   text: '計画未登録', rank: 3 },
  inconsistent: { badge: 'bg-neutral-200 text-neutral-700 border-neutral-300', text: '要確認',    rank: 4 },
};

const MILESTONE_LABEL: Record<string, string> = { design: '設計書', execution: '実施' };

function AlertRow({ a, onSelectCase }: { key?: string; a: CaseAlert; onSelectCase: (areaId: string, caseId: string) => void }) {
  const style = LEVEL_STYLE[a.level];
  return (
    <button
      type="button"
      onClick={() => onSelectCase(a.areaId, a.caseId)}
      style={{ height: ROW_HEIGHT }}
      className="w-full text-left px-3 flex items-center gap-3 hover:bg-neutral-100 transition-colors border-b border-neutral-100"
      title="この案件の詳細を開いて日付を修正する"
    >
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>
        {style.text}
        {a.level === 'overdue' && a.days != null && ` ${a.days}日`}
        {a.level === 'soon' && a.days != null && ` 残${a.days}営業日`}
      </span>
      {a.milestone && (
        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
          {MILESTONE_LABEL[a.milestone]}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-neutral-400 w-24 truncate">{a.system || '-'}</span>
      <span className="shrink-0 text-xs font-medium text-neutral-800 w-56 truncate">{a.projectName || '-'}</span>
      <span className="shrink-0 text-[11px] text-neutral-500 w-20 truncate">{a.assignee || '-'}</span>
      {a.plannedDate && (
        <span className="shrink-0 text-[11px] text-neutral-400 tabular-nums">予定 {a.plannedDate.slice(0, 10)}</span>
      )}
      <span className="flex-1 text-[11px] text-neutral-500 truncate min-w-0">{a.message}</span>
      {a.note && (
        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">{a.note}</span>
      )}
    </button>
  );
}

export default function ProgressAlerts({ onSelectCase }: { onSelectCase: (areaId: string, caseId: string) => void }) {
  const [data, setData] = useState<AlertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState<boolean>(() => {
    try { return localStorage.getItem(PAUSE_KEY) === '1'; } catch { return false; }
  });
  // マウス中は止める。動いている行はクリックできないため
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/test-center/alerts')
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<AlertsResult>;
      })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const togglePause = () =>
    setPaused((p) => {
      const next = !p;
      try { localStorage.setItem(PAUSE_KEY, next ? '1' : '0'); } catch { /* 保存できなくても動作に影響しない */ }
      return next;
    });

  // 4つの区分をひとつのリストにまとめる。深刻な順に並べる
  const rows = useMemo(() => {
    if (!data) return [];
    const all = [...data.planMissing, ...data.design, ...data.execution, ...data.inconsistent];
    return all.sort((x, y) => {
      const r = LEVEL_STYLE[x.level].rank - LEVEL_STYLE[y.level].rank;
      if (r !== 0) return r;
      // 遅延は超過が長い順、期限接近は残りが少ない順
      if (x.level === 'overdue') return (y.days ?? 0) - (x.days ?? 0);
      if (x.level === 'soon') return (x.days ?? 0) - (y.days ?? 0);
      return 0;
    });
  }, [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of rows) c[a.level] = (c[a.level] ?? 0) + 1;
    return c;
  }, [rows]);

  if (loading) {
    return (
      <div className="border border-neutral-200 rounded-xl bg-white px-4 py-3 flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 size={15} className="animate-spin" />
        案件進捗を確認中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 flex items-center gap-2 text-sm">
        <AlertCircle size={16} />
        進捗アラートの取得に失敗しました: {error}
      </div>
    );
  }

  if (!data) return null;

  // 完了グループを読めていないと、完了済み案件を除外できず「要確認」が
  // 誤検知だらけになる。原因がアラートの山に埋もれないよう先頭に出す。
  const statusWarning = data.completedStatuses.length === 0 ? (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800 text-sm flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        状態の「完了」グループを取得できませんでした。完了した案件を除外できないため、
        「要確認」に誤検知が出ます。進捗管理表の「状態」がステータス型か確認してください。
      </span>
    </div>
  ) : null;

  // 何も無い時も一行だけ残す。消えてしまうと「問題なし」と「壊れている」の区別がつかない
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        {statusWarning}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} />
          期限リスクのある案件はありません
          <span className="text-emerald-600 text-xs">（監視中 {data.watched}件）</span>
        </div>
      </div>
    );
  }

  // 表示枠に収まる件数なら流す必要がない。
  // 少ない行を無理に回すと、同じ行が何度も通り過ぎて読みにくい。
  const scrolling = rows.length > VISIBLE_ROWS;
  const duration = rows.length * SECONDS_PER_ROW;
  const animating = scrolling && !paused && !hovering;

  return (
    <div className="space-y-2">
      {statusWarning}
      <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
        {/* 見出し: 種類ごとの件数をここに集約する (区分ごとの枠を無くしたため) */}
        <div className="px-3 py-2 flex items-center gap-2 bg-neutral-50 border-b border-neutral-200 flex-wrap">
          <AlertTriangle size={14} className="text-amber-500" />
          <span className="text-xs font-bold text-neutral-800">案件進捗アラート</span>
          <span className="rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">
            {rows.length}
          </span>
          <span className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(LEVEL_STYLE) as AlertLevel[])
              .filter((lv) => counts[lv])
              .map((lv) => (
                <span key={lv} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_STYLE[lv].badge}`}>
                  {LEVEL_STYLE[lv].text} {counts[lv]}
                </span>
              ))}
          </span>
          {scrolling && (
            <button
              type="button"
              onClick={togglePause}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-200 bg-white text-[11px] text-neutral-500 hover:bg-neutral-100"
              title={paused ? '自動スクロールを再開' : '自動スクロールを停止'}
            >
              {paused ? <Play size={11} /> : <Pause size={11} />}
              {paused ? '再開' : '停止'}
            </button>
          )}
        </div>

        {/* 自動スクロール。同じリストを2回並べ、-50% まで動かして繋ぎ目を無くす */}
        <div
          className="overflow-hidden relative"
          style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <style>{`@keyframes tc-alert-scroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }`}</style>
          <div
            style={
              animating
                ? { animation: `tc-alert-scroll ${duration}s linear infinite` }
                : undefined
            }
          >
            {rows.map((a) => (
              <AlertRow key={`a-${a.caseId}-${a.level}-${a.milestone ?? 'x'}-${a.message}`} a={a} onSelectCase={onSelectCase} />
            ))}
            {/* ループ用の複製。scrolling でない時は不要 */}
            {scrolling && rows.map((a) => (
              <AlertRow key={`b-${a.caseId}-${a.level}-${a.milestone ?? 'x'}-${a.message}`} a={a} onSelectCase={onSelectCase} />
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-neutral-400 px-1">
        月次セレクタとは連動しません（過去月から遅れている案件も表示します）。監視中 {data.watched}件
        {scrolling && '・マウスを乗せると停止します'}
      </p>
    </div>
  );
}
