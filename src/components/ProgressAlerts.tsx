import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, FileWarning, Loader2 } from 'lucide-react';

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

// 折りたたみ状態は案件一覧のグラフ設定と同じく localStorage に残す
const COLLAPSE_KEY = 'testcenter:alerts:collapsed:v1';
// 3行ぶんの高さで固定してスクロールさせる。
// 4行目が少しだけ覗く高さにして、下に続きがあることを分かるようにする。
const LIST_MAX_HEIGHT = '7.4rem';

const LEVEL_STYLE: Record<AlertLevel, { badge: string; text: string }> = {
  overdue:      { badge: 'bg-red-100 text-red-700 border-red-200',           text: '遅延' },
  today:        { badge: 'bg-orange-100 text-orange-700 border-orange-200',  text: '本日期限' },
  soon:         { badge: 'bg-amber-100 text-amber-700 border-amber-200',     text: '期限接近' },
  missing:      { badge: 'bg-violet-100 text-violet-700 border-violet-200',  text: '計画未登録' },
  inconsistent: { badge: 'bg-neutral-200 text-neutral-700 border-neutral-300', text: '要確認' },
};

function AlertRow({ a, onSelectCase }: { key?: string; a: CaseAlert; onSelectCase: (areaId: string, caseId: string) => void }) {
  const style = LEVEL_STYLE[a.level];
  return (
    <button
      type="button"
      onClick={() => onSelectCase(a.areaId, a.caseId)}
      className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-neutral-50 transition-colors"
      title="この案件の詳細を開いて日付を修正する"
    >
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>
        {style.text}
        {a.level === 'overdue' && a.days != null && ` ${a.days}日`}
        {a.level === 'soon' && a.days != null && ` 残${a.days}営業日`}
      </span>
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

function AlertBlock({
  id, title, hint, icon, items, collapsed, onToggle, onSelectCase,
}: {
  key?: string;
  id: string;
  title: string;
  hint: string;
  icon: any;
  items: CaseAlert[];
  collapsed: boolean;
  onToggle: (id: string) => void;
  onSelectCase: (areaId: string, caseId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-neutral-50 border-b border-neutral-200 hover:bg-neutral-100 transition-colors"
      >
        {collapsed ? <ChevronRight size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
        {icon}
        <span className="text-xs font-bold text-neutral-800">{title}</span>
        <span className="rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">
          {items.length}
        </span>
        <span className="text-[11px] text-neutral-400 truncate">{hint}</span>
      </button>
      {!collapsed && (
        <div
          className="divide-y divide-neutral-100 overflow-y-auto"
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          {items.map((a) => (
            <AlertRow key={`${a.caseId}-${a.level}-${a.milestone ?? 'x'}-${a.message}`} a={a} onSelectCase={onSelectCase} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProgressAlerts({ onSelectCase }: { onSelectCase: (areaId: string, caseId: string) => void }) {
  const [data, setData] = useState<AlertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
    } catch {
      return {};
    }
  });

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

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作に影響しない */ }
      return next;
    });

  const total = useMemo(
    () => data ? data.planMissing.length + data.design.length + data.execution.length + data.inconsistent.length : 0,
    [data],
  );

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
  const statusGroupFailed = data.completedStatuses.length === 0;
  const statusWarning = statusGroupFailed ? (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800 text-sm flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        状態の「完了」グループを取得できませんでした。完了した案件を除外できないため、
        「要確認」に誤検知が出ます。進捗管理表の「状態」がステータス型か確認してください。
      </span>
    </div>
  ) : null;

  // 何も無い時も一行だけ残す。消えてしまうと「問題なし」と「壊れている」の区別がつかない
  if (total === 0) {
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

  return (
    <div className="space-y-2">
      {statusWarning}
      <AlertBlock
        id="missing"
        title="予定未登録"
        hint="計画書の日程欄が空欄になります"
        icon={<FileWarning size={14} className="text-violet-500" />}
        items={data.planMissing}
        collapsed={!!collapsed.missing}
        onToggle={toggle}
        onSelectCase={onSelectCase}
      />
      <AlertBlock
        id="design"
        title="設計書の期限"
        hint="TC設計書完了予定日との比較"
        icon={<CalendarClock size={14} className="text-blue-500" />}
        items={data.design}
        collapsed={!!collapsed.design}
        onToggle={toggle}
        onSelectCase={onSelectCase}
      />
      <AlertBlock
        id="execution"
        title="実施の期限"
        hint="TC実施完了予定日との比較"
        icon={<CalendarClock size={14} className="text-orange-500" />}
        items={data.execution}
        collapsed={!!collapsed.execution}
        onToggle={toggle}
        onSelectCase={onSelectCase}
      />
      <AlertBlock
        id="inconsistent"
        title="要確認"
        hint="完了日と状態が合っていない案件"
        icon={<AlertTriangle size={14} className="text-neutral-500" />}
        items={data.inconsistent}
        collapsed={!!collapsed.inconsistent}
        onToggle={toggle}
        onSelectCase={onSelectCase}
      />
      <p className="text-[11px] text-neutral-400 px-1">
        月次セレクタとは連動しません（過去月から遅れている案件も表示します）。監視中 {data.watched}件
      </p>
    </div>
  );
}
