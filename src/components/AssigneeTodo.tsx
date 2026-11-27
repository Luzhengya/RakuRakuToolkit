// 案件管理 > 担当者ビューの ToDo リスト（QA・指摘・追加説明・AI指摘の判断／対応）
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, ListTodo, Loader2, Save, X } from 'lucide-react';
import { PendingNoteRow } from './shared/NoteWidgets';
import type { EntityNote } from './shared/NoteWidgets';

interface AiTodoIssue {
  id: string;
  url: string;
  caseId: string;
  no: string;
  level: string;
  problem: string;
  fix: string;
  judgement: string;
  reason: string;
  assignees: string[];
  managers: string[];
  handled: boolean;
}

interface AiTodoCase {
  id: string;
  title: string;
  month: string;
}

/** 不具合流出（品質管理 > 不具合流出確認）の未確認案件 */
interface BugLeakTodo {
  id: string;
  system: string;
  caseMonth: string;
  cmdb: string;
  feature: string;
  defect: string;
  status: string;
}

const JUDGEMENTS = ['有効', '無効', 'その他'];
/** 不具合流出の確認待ちを ToDo に表示する担当者 */
const BUGLEAK_TODO_EMAILS = ['suntao@newcon.cn', 'jiahan@riskmonster.co.jp'];
const BUGLEAK_DONE = '確認完了';
const BUGLEAK_PAGE_HASH = '#/quality/bugleak';
const REASON_MAX = 2000;
const LEVEL_COLORS: Record<string, string> = {
  Critical: 'text-red-600',
  Major: 'text-orange-500',
  Minor: 'text-amber-500',
  Info: 'text-blue-500',
};

type TodoKey = 'qa' | 'issue' | 'aiJudge' | 'aiHandle' | 'explanation' | 'bugleak';

function TodoDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
          <span className="text-sm font-bold text-neutral-800">{title}</span>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto divide-y divide-neutral-100">{children}</div>
      </div>
    </div>
  );
}

/** AI 指摘を案件ごとにまとめる（月次の新しい順→案件名順） */
function groupByCase(issues: AiTodoIssue[], caseMap: Map<string, AiTodoCase>) {
  const groups = new Map<string, AiTodoIssue[]>();
  for (const it of issues) groups.set(it.caseId, [...(groups.get(it.caseId) ?? []), it]);
  return [...groups.entries()]
    .map(([caseId, list]) => ({ caseId, case: caseMap.get(caseId), list }))
    .sort((a, b) => (b.case?.month ?? '').localeCompare(a.case?.month ?? '') || (a.case?.title ?? '').localeCompare(b.case?.title ?? '', 'ja'));
}

function CaseGroupHeader({ c, count }: { c?: AiTodoCase; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-neutral-50 border-b border-neutral-100 text-xs">
      <span className="text-neutral-400 shrink-0">{c?.month || '—'}</span>
      <span className="font-bold text-neutral-700 truncate">{c?.title || '（案件なし）'}</span>
      <span className="ml-auto text-[10px] text-neutral-400 shrink-0">{count} 件</span>
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-neutral-400 text-center py-8">対象はありません</div>;
}

function AiIssueHeader({ issue }: { issue: AiTodoIssue }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span className="shrink-0">{issue.no}</span>
        <span className={`shrink-0 font-bold ${LEVEL_COLORS[issue.level] ?? ''}`}>{issue.level}</span>
        <a href={issue.url} target="_blank" rel="noopener noreferrer" title="Notionで開く" className="ml-auto shrink-0 hover:text-neutral-800">
          <ExternalLink size={12} />
        </a>
      </div>
      <div className="text-xs text-neutral-800 whitespace-pre-wrap break-words">{issue.problem}</div>
      {issue.fix && <div className="text-[11px] text-neutral-500 whitespace-pre-wrap break-words">修正案：{issue.fix}</div>}
    </div>
  );
}

/** 管理者：未判断の AI 指摘に人工判断を付ける */
function AiJudgeRow({ issue, onDone }: { issue: AiTodoIssue; onDone: (judgement: string, reason: string) => void }) {
  const [judgement, setJudgement] = useState('');
  const [reason, setReason] = useState(issue.reason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setSaving(true);
    setError(null);
    fetch(`/api/quality/ai-issues/${issue.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judgement, reason }),
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => onDone(judgement, reason))
      .catch(() => setError('保存に失敗しました'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <AiIssueHeader issue={issue} />
      <div className="flex flex-col md:flex-row md:items-start gap-2">
        <select value={judgement} onChange={(e) => setJudgement(e.target.value)} disabled={saving}
          className="border border-neutral-200 rounded px-2 py-1 text-xs bg-white md:w-28">
          <option value="">判断を選択</option>
          {JUDGEMENTS.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} maxLength={REASON_MAX} rows={2}
          placeholder="判断理由" className="flex-1 border border-neutral-200 rounded px-2 py-1 text-xs bg-white resize-y" />
        <button type="button" onClick={save} disabled={!judgement || saving}
          className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded text-xs font-medium bg-neutral-900 text-white disabled:opacity-40">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}保存
        </button>
      </div>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}

/** 担当者：有効と判断された AI 指摘を対応済にする */
function AiHandleRow({ issue, onDone }: { issue: AiTodoIssue; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markHandled = () => {
    setSaving(true);
    setError(null);
    fetch(`/api/quality/ai-issues/${issue.id}/handled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handled: true }),
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => onDone())
      .catch(() => setError('更新に失敗しました'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        <AiIssueHeader issue={issue} />
        {issue.reason && <div className="text-[11px] text-neutral-500 whitespace-pre-wrap break-words">判断理由：{issue.reason}</div>}
        {error && <div className="text-[11px] text-red-600">{error}</div>}
      </div>
      <button type="button" onClick={markHandled} disabled={saving}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
        {saving ? <Loader2 size={10} className="animate-spin" /> : '対応済にする'}
      </button>
    </div>
  );
}

export default function AssigneeTodo({ email, pendingNotes, notesLoading, memberOptions, onNotesUpdated }: {
  email: string;
  pendingNotes: EntityNote[];
  notesLoading: boolean;
  memberOptions: string[];
  onNotesUpdated: () => void;
}) {
  const [aiIssues, setAiIssues] = useState<AiTodoIssue[]>([]);
  const [aiCases, setAiCases] = useState<AiTodoCase[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(false);
  const [open, setOpen] = useState<TodoKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAiLoading(true);
    fetch('/api/quality/ai-issues')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (!cancelled) { setAiIssues(d.items ?? []); setAiCases(d.cases ?? []); setAiError(false); } })
      .catch(() => { if (!cancelled) setAiError(true); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 不具合流出：確認完了以外の案件（全月）。対象の担当者のときだけ取得する
  const showBugLeak = BUGLEAK_TODO_EMAILS.includes(email);
  const [bugLeaks, setBugLeaks] = useState<BugLeakTodo[]>([]);
  const [bugLeakLoading, setBugLeakLoading] = useState(false);
  const [bugLeakError, setBugLeakError] = useState(false);
  useEffect(() => {
    if (!showBugLeak) return;
    let cancelled = false;
    setBugLeakLoading(true);
    fetch('/api/test-center/bug-leak?all=true')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        setBugLeaks(((d.items ?? []) as BugLeakTodo[]).filter((b) => b.status !== BUGLEAK_DONE));
        setBugLeakError(false);
      })
      .catch(() => { if (!cancelled) setBugLeakError(true); })
      .finally(() => { if (!cancelled) setBugLeakLoading(false); });
    return () => { cancelled = true; };
  }, [showBugLeak]);
  const bugLeakGroups = useMemo(() => {
    const groups = new Map<string, BugLeakTodo[]>();
    for (const b of bugLeaks) {
      const s = b.system || '(未設定)';
      groups.set(s, [...(groups.get(s) ?? []), b]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [bugLeaks]);

  const caseMap = useMemo(() => new Map(aiCases.map((c) => [c.id, c])), [aiCases]);

  const pendingQA = useMemo(() => pendingNotes.filter((n) => n.category === 'QA'), [pendingNotes]);
  const pendingIssues = useMemo(() => pendingNotes.filter((n) => n.category === '指摘'), [pendingNotes]);
  const pendingExplanations = useMemo(() => pendingNotes.filter((n) => n.category === '追加説明'), [pendingNotes]);
  const aiToJudge = useMemo(() => aiIssues.filter((it) => it.managers.includes(email) && !it.judgement), [aiIssues, email]);
  const aiToHandle = useMemo(
    () => aiIssues.filter((it) => it.assignees.includes(email) && it.judgement === '有効' && !it.handled),
    [aiIssues, email],
  );

  const updateIssue = (id: string, patch: Partial<AiTodoIssue>) => {
    setAiIssues((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const rows: { key: TodoKey; label: string; count: number; loading: boolean; failed?: boolean }[] = [
    { key: 'qa', label: 'QA 確認待ち', count: pendingQA.length, loading: notesLoading },
    { key: 'issue', label: '指摘 確認待ち', count: pendingIssues.length, loading: notesLoading },
    { key: 'aiJudge', label: 'AI指摘 判断待ち（管理者）', count: aiToJudge.length, loading: aiLoading, failed: aiError },
    { key: 'aiHandle', label: 'AI指摘 対応待ち（担当者）', count: aiToHandle.length, loading: aiLoading, failed: aiError },
    { key: 'explanation', label: '追加説明 確認待ち', count: pendingExplanations.length, loading: notesLoading },
    ...(showBugLeak
      ? [{ key: 'bugleak' as const, label: '不具合流出 確認待ち', count: bugLeaks.length, loading: bugLeakLoading, failed: bugLeakError }]
      : []),
  ];
  const openRow = rows.find((r) => r.key === open);

  const noteList = (notes: EntityNote[]) => (notes.length === 0 ? <Empty /> : notes.map((note) => (
    <PendingNoteRow key={note.id} note={note} memberOptions={memberOptions} onUpdated={onNotesUpdated} />
  )));

  return (
    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-2">
        <ListTodo size={13} className="text-neutral-500" />
        <span className="text-xs font-bold text-neutral-700">ToDo</span>
      </div>
      <div className="divide-y divide-neutral-50">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center px-4 py-2.5 text-xs">
            <span className="text-neutral-700">{r.label}</span>
            <span className="ml-auto">
              {r.loading ? (
                <Loader2 size={12} className="animate-spin text-neutral-300" />
              ) : r.failed ? (
                <span className="text-red-500">取得失敗</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(r.key)}
                  className={`min-w-[2.5rem] px-2 py-0.5 rounded font-bold tabular-nums hover:underline ${r.count > 0 ? 'bg-amber-50 text-amber-700' : 'text-neutral-400'}`}
                >
                  {r.count} 件
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {openRow && (
        <TodoDialog title={`${openRow.label}（${openRow.count} 件）`} onClose={() => setOpen(null)}>
          {open === 'qa' && noteList(pendingQA)}
          {open === 'issue' && noteList(pendingIssues)}
          {open === 'explanation' && noteList(pendingExplanations)}
          {open === 'aiJudge' && (aiToJudge.length === 0 ? <Empty /> : groupByCase(aiToJudge, caseMap).map((g) => (
            <div key={g.caseId}>
              <CaseGroupHeader c={g.case} count={g.list.length} />
              <div className="divide-y divide-neutral-100">
                {g.list.map((it) => (
                  <AiJudgeRow key={it.id} issue={it} onDone={(judgement, reason) => updateIssue(it.id, { judgement, reason })} />
                ))}
              </div>
            </div>
          )))}
          {open === 'bugleak' && (
            <>
              {/* 確認完了などの操作は品質管理の不具合流出確認タブで行う */}
              <div className="flex justify-end px-4 py-2">
                <a href={BUGLEAK_PAGE_HASH} onClick={() => setOpen(null)}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline">
                  品質管理で確認する<ExternalLink size={11} />
                </a>
              </div>
              {bugLeaks.length === 0 ? <Empty /> : bugLeakGroups.map(([system, list]) => (
                <div key={system}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-neutral-50 border-b border-neutral-100 text-xs">
                    <span className="font-bold text-neutral-700 truncate">{system}</span>
                    <span className="ml-auto text-[10px] text-neutral-400 shrink-0">{list.length} 件</span>
                  </div>
                  <div className="divide-y divide-neutral-100">
                    {list.map((b) => (
                      <div key={b.id} className="px-4 py-2.5 space-y-1">
                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                          <span className="shrink-0">{b.caseMonth || '—'}</span>
                          {b.cmdb && <span className="shrink-0">{b.cmdb}</span>}
                          <span className="ml-auto shrink-0">{b.status || '未確認'}</span>
                        </div>
                        <div className="text-xs text-neutral-800 whitespace-pre-wrap break-words">{b.defect || '—'}</div>
                        {b.feature && <div className="text-[11px] text-neutral-500 whitespace-pre-wrap break-words">機能：{b.feature}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {open === 'aiHandle' && (aiToHandle.length === 0 ? <Empty /> : groupByCase(aiToHandle, caseMap).map((g) => (
            <div key={g.caseId}>
              <CaseGroupHeader c={g.case} count={g.list.length} />
              <div className="divide-y divide-neutral-100">
                {g.list.map((it) => (
                  <AiHandleRow key={it.id} issue={it} onDone={() => updateIssue(it.id, { handled: true })} />
                ))}
              </div>
            </div>
          )))}
        </TodoDialog>
      )}
    </div>
  );
}
