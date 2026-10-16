import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSubRoute } from '../hooks/useSubRoute';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Save,
  Shield,
  Star,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

// ── Types ──

interface NeedsItem {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  assignee: string;
  requester: string;
  createdTime: string;
}

interface BugLeakItem {
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
  checklistIds: string[];
}

interface FieldInfo {
  type: string;
  options: string[];
  writable?: boolean;
}

// ── Shared Helpers ──

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-2 rounded-lg ${color}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs mt-0.5">{label}</span>
    </div>
  );
}

function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="flex items-center gap-2 text-sm mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-neutral-400">{'>>'}</span>}
          {item.onClick ? (
            <button type="button" onClick={item.onClick} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
              {item.label}
            </button>
          ) : (
            <span className="text-neutral-900 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-3">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30">
        <ChevronLeft size={16} />
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <button key={p} onClick={() => onPageChange(p)} className={`w-7 h-7 text-xs rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100 text-neutral-600'}`}>
          {p}
        </button>
      ))}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-neutral-700">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700">キャンセル</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">削除</button>
        </div>
      </div>
    </div>
  );
}

// ── Needs: category helpers ──

type NeedsCategory = 'QA' | '指摘' | 'AI' | 'その他';

function classifyNeeds(item: NeedsItem): NeedsCategory {
  if (item.category === 'QA') return 'QA';
  if (item.category === '指摘') return '指摘';
  if ((item.category ?? '').includes('AI')) return 'AI';
  return 'その他';
}

function sortNeedsItems(items: NeedsItem[]): NeedsItem[] {
  return [...items].sort((a, b) => {
    const aCompleted = a.status === '対応済' ? 1 : 0;
    const bCompleted = b.status === '対応済' ? 1 : 0;
    if (aCompleted !== bCompleted) return aCompleted - bCompleted;
    return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
  });
}

function openNotionPage(id: string) {
  const cleanId = id.replace(/-/g, '');
  window.open(`https://www.notion.so/${cleanId}`, '_blank');
}

const LOAD_SIZE = 10;

// ── Needs: Category Table Section ──

function NeedsCategoryTable({
  label,
  items,
  onComplete,
  onDelete,
  completing,
}: {
  label: NeedsCategory;
  items: NeedsItem[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  completing: string | null;
}) {
  const [showCount, setShowCount] = useState(LOAD_SIZE);
  const sorted = useMemo(() => sortNeedsItems(items), [items]);
  const visible = sorted.slice(0, showCount);
  const hasMore = showCount < sorted.length;
  const unconfirmed = items.filter((i) => i.status !== '対応済').length;

  const colorMap: Record<NeedsCategory, { bg: string; text: string; badge: string }> = {
    QA: { bg: 'bg-blue-50', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
    指摘: { bg: 'bg-orange-50', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' },
    AI: { bg: 'bg-violet-50', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-700' },
    その他: { bg: 'bg-neutral-50', text: 'text-neutral-700', badge: 'bg-neutral-100 text-neutral-600' },
  };
  const colors = colorMap[label];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold">{label}</h3>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors.badge}`}>{items.length}件</span>
        {unconfirmed > 0 && (
          <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-700">未確認 {unconfirmed}件</span>
        )}
      </div>

      <div className="overflow-x-auto bg-white border border-neutral-200 rounded-xl shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2.5 px-3 font-medium">類型</th>
              <th className="py-2.5 px-3 font-medium">需求内容</th>
              <th className="py-2.5 px-3 font-medium">状態</th>
              <th className="py-2.5 px-3 font-medium">提出日</th>
              <th className="py-2.5 px-3 font-medium">請求者</th>
              <th className="py-2.5 px-3 font-medium">割当</th>
              <th className="py-2.5 px-3 font-medium">優先度</th>
              <th className="py-2.5 px-3 font-medium w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const done = item.status === '対応済';
              return (
                <tr key={item.id} className={`border-b border-neutral-100 ${done ? 'opacity-40' : 'hover:bg-neutral-50'}`}>
                  <td className="py-2 px-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${colors.badge}`}>{item.category || 'その他'}</span>
                  </td>
                  <td className="py-2 px-3 max-w-[220px] truncate">{item.title}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      done ? 'bg-emerald-100 text-emerald-700' :
                      item.status === '進行中' ? 'bg-blue-100 text-blue-700' :
                      'bg-neutral-100 text-neutral-600'
                    }`}>{item.status || '—'}</span>
                  </td>
                  <td className="py-2 px-3 text-neutral-400">{formatDate(item.createdTime)}</td>
                  <td className="py-2 px-3 text-neutral-500">{item.requester ? item.requester.split('@')[0] : ''}</td>
                  <td className="py-2 px-3 text-neutral-500">{item.assignee ? item.assignee.split('@')[0] : ''}</td>
                  <td className="py-2 px-3">{item.priority}</td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => onDelete(item.id)}
                        title="削除"
                        className="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                      <button
                        onClick={() => openNotionPage(item.id)}
                        title="Notionで編集"
                        className="p-1 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <ExternalLink size={13} />
                      </button>
                      <button
                        onClick={() => !done && onComplete(item.id)}
                        disabled={done || completing === item.id}
                        title="完了にする"
                        className={`p-1 rounded transition-colors ${done ? 'text-emerald-300 cursor-not-allowed' : 'text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {completing === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-neutral-400">データなし</td></tr>
            )}
          </tbody>
        </table>
        {hasMore && (
          <div className="flex justify-center py-2 border-t border-neutral-100">
            <button onClick={() => setShowCount((c) => c + LOAD_SIZE)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-3 py-1.5">
              もっと見る（残り {sorted.length - showCount}件）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Part 1: Needs List Page (categorized) ──

function NeedsListPage() {
  const [items, setItems] = useState<NeedsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats/needs');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setError('読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const qa: NeedsItem[] = [];
    const shiteki: NeedsItem[] = [];
    const ai: NeedsItem[] = [];
    const other: NeedsItem[] = [];
    for (const item of items) {
      const cat = classifyNeeds(item);
      if (cat === 'QA') qa.push(item);
      else if (cat === '指摘') shiteki.push(item);
      else if (cat === 'AI') ai.push(item);
      else other.push(item);
    }
    return { qa, shiteki, ai, other };
  }, [items]);

  const stats = useMemo(() => ({
    qa: grouped.qa.length,
    qaUnconfirmed: grouped.qa.filter((i) => i.status !== '対応済').length,
    shiteki: grouped.shiteki.length,
    shitekiUnconfirmed: grouped.shiteki.filter((i) => i.status !== '対応済').length,
    ai: grouped.ai.length,
    aiUnconfirmed: grouped.ai.filter((i) => i.status !== '対応済').length,
    other: grouped.other.length,
    otherUnconfirmed: grouped.other.filter((i) => i.status !== '対応済').length,
  }), [grouped]);

  const handleComplete = async (id: string) => {
    setCompleting(id);
    try {
      const res = await fetch(`/api/stats/needs/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: '対応済' }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: '対応済' } : i));
    } catch {
      setError('状態更新に失敗しました');
    } finally {
      setCompleting(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/stats/needs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      setError('削除に失敗しました');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <Loader2 size={20} className="animate-spin mr-2" />読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-600 text-xs flex items-center gap-1.5">
          <AlertCircle size={14} />{error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <StatCard label="QA" value={stats.qa} color="bg-blue-50 text-blue-700" />
        <StatCard label="指摘" value={stats.shiteki} color="bg-orange-50 text-orange-700" />
        <StatCard label="AI" value={stats.ai} color="bg-violet-50 text-violet-700" />
        <StatCard label="その他" value={stats.other} color="bg-neutral-100 text-neutral-700" />
      </div>

      <NeedsCategoryTable label="QA" items={grouped.qa} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />
      <NeedsCategoryTable label="指摘" items={grouped.shiteki} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />
      <NeedsCategoryTable label="AI" items={grouped.ai} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />
      <NeedsCategoryTable label="その他" items={grouped.other} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />

      {deleteTarget && (
        <ConfirmDialog
          message="このニーズを削除しますか？この操作は取り消せません。"
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Part 3: Bug Leak Section ──

const PAGE_SIZE = 10;

// Month Calendar (TestCenter style)
function MonthCalendar({ year, month, onSelect }: { year: number; month: number | null; onSelect: (y: number, m: number | null) => void }) {
  const [calYear, setCalYear] = useState(year);
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-3 shadow-sm w-48">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setCalYear((y) => y - 1)} className="text-neutral-400 hover:text-neutral-700 text-sm">&larr;</button>
        <span className="text-sm font-bold">{calYear}</span>
        <button onClick={() => setCalYear((y) => y + 1)} className="text-neutral-400 hover:text-neutral-700 text-sm">&rarr;</button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <button
            key={m}
            onClick={() => onSelect(calYear, calYear === year && m === month ? null : m)}
            className={`w-full py-1.5 text-xs rounded transition-colors ${
              calYear === year && m === month
                ? 'bg-neutral-900 text-white font-bold'
                : 'hover:bg-neutral-100 text-neutral-600'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

// BugLeak Detail Dialog (read-only, left-right layout)
function BugLeakDetailDialog({ item, onClose }: { item: BugLeakItem; onClose: () => void }) {
  const [checklistTitles, setChecklistTitles] = useState<string[]>([]);

  useEffect(() => {
    if ((item.checklistIds ?? []).length > 0) {
      fetch(`/api/stats/bugleak/${item.id}/checklist-title`)
        .then((r) => r.ok ? r.json() : { titles: [] })
        .then((d) => setChecklistTitles(d.titles ?? []))
        .catch(() => {});
    }
  }, [item.id, item.checklistIds]);

  const longField = (label: string, value: string) => (
    <div>
      <h4 className="text-xs font-semibold text-neutral-500 mb-1">{label}</h4>
      <div className="bg-neutral-50 rounded-lg p-3 text-sm text-neutral-700 min-h-[60px] whitespace-pre-wrap">
        {value || <span className="text-neutral-300">—</span>}
      </div>
    </div>
  );

  const propRow = (label: string, value: string) => (
    <div className="flex justify-between text-xs py-1.5 border-b border-neutral-100">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-700 font-medium text-right max-w-[120px] truncate">{value || '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold">{item.feature || '(機能名なし)'}</h3>
            <p className="text-xs text-neutral-500">{item.system}</p>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>

        <div className="flex gap-5">
          {/* Left: main content */}
          <div className="flex-1 space-y-3 min-w-0">
            {longField('障害内容', item.defect)}
            {longField('TestCenter確認結果', item.tcResult)}
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 mb-1">チェックリスト</h4>
              <div className="bg-neutral-50 rounded-lg p-3 text-sm text-neutral-700 min-h-[40px]">
                {item.checklist ? item.checklist : checklistTitles.length > 0 ? checklistTitles.join(', ') : <span className="text-neutral-300">—</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-neutral-400">指摘工程</span>
                <p className="text-sm">{item.process || '—'}</p>
              </div>
              <div>
                <span className="text-xs text-neutral-400">指摘分類</span>
                <p className="text-sm">{item.category || '—'}</p>
              </div>
            </div>
          </div>

          {/* Right: properties sidebar */}
          <div className="w-48 flex-shrink-0 space-y-0">
            {propRow('案件別', item.caseMonth)}
            {propRow('CMDB', item.cmdb)}
            {propRow('原因区分', item.cause)}
            {propRow('リリース時期', item.releaseTime)}
            {propRow('状態', item.status)}
            {propRow('改善可/不可', item.improvable)}
            <div className="flex justify-between text-xs py-1.5">
              <span className="text-neutral-400">責任</span>
              <span>{item.responsible ? <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> : '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// BugLeak Complete Dialog
function BugLeakCompleteDialog({
  item,
  fields,
  saving,
  onSave,
  onClose,
}: {
  item: BugLeakItem;
  fields: Record<string, FieldInfo>;
  saving: boolean;
  onSave: (form: { tcResult: string; improvable: string; checklistTitle: string }) => void;
  onClose: () => void;
}) {
  const [tcResult, setTcResult] = useState(item.tcResult);
  const [improvable, setImprovable] = useState(item.improvable);
  const [checklistTitle, setChecklistTitle] = useState('');
  const [showChecklistInput, setShowChecklistInput] = useState(false);
  const [checklistTitles, setChecklistTitles] = useState<string[]>([]);

  const improvableOptions = fields.improvable?.options ?? [];
  const hasChecklist = (item.checklistIds ?? []).length > 0 || !!item.checklist;

  useEffect(() => {
    if ((item.checklistIds ?? []).length > 0) {
      fetch(`/api/stats/bugleak/${item.id}/checklist-title`)
        .then((r) => r.ok ? r.json() : { titles: [] })
        .then((d) => setChecklistTitles(d.titles ?? []))
        .catch(() => {});
    }
  }, [item.id, item.checklistIds]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">確認完了</h3>
        <p className="text-xs text-neutral-500">{item.feature} — {item.system}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">TestCenter確認結果</label>
            <textarea value={tcResult} onChange={(e) => setTcResult(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg resize-none" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">改善可/不可</label>
            <select value={improvable} onChange={(e) => setImprovable(e.target.value)} className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2">
              <option value="">--</option>
              {improvableOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">チェックリスト</label>
            {hasChecklist ? (
              <div className="bg-neutral-50 rounded-lg p-2 text-sm text-neutral-700">
                {item.checklist || checklistTitles.join(', ') || '(関連あり)'}
              </div>
            ) : showChecklistInput ? (
              <input value={checklistTitle} onChange={(e) => setChecklistTitle(e.target.value)} placeholder="チェックリスト名を入力" className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg" autoFocus />
            ) : (
              <button onClick={() => setShowChecklistInput(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">
                <Plus size={12} />追加
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700">キャンセル</button>
          <button onClick={() => onSave({ tcResult, improvable, checklistTitle })} disabled={saving} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? '保存中...' : '確認完了にする'}
          </button>
        </div>
      </div>
    </div>
  );
}

// BugLeak Service Table
function BugLeakServiceTable({
  service,
  items,
  onRowClick,
  onDelete,
  onComplete,
}: {
  service: string;
  items: BugLeakItem[];
  onRowClick: (item: BugLeakItem) => void;
  onDelete: (id: string) => void;
  onComplete: (item: BugLeakItem) => void;
}) {
  const [showCount, setShowCount] = useState(LOAD_SIZE);
  const sorted = useMemo(() => [...items].sort((a, b) => {
    const aDone = a.status === '確認完了' ? 1 : 0;
    const bDone = b.status === '確認完了' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (b.caseMonth || '').localeCompare(a.caseMonth || '');
  }), [items]);
  const visible = sorted.slice(0, showCount);
  const hasMore = showCount < sorted.length;
  const pending = items.filter((i) => i.status !== '確認完了').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold">{service}</h3>
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">{items.length}件</span>
        {pending > 0 && <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-700">未確認 {pending}件</span>}
      </div>

      <div className="overflow-x-auto bg-white border border-neutral-200 rounded-xl shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2.5 px-3 font-medium">CMDB</th>
              <th className="py-2.5 px-3 font-medium">障害内容</th>
              <th className="py-2.5 px-3 font-medium">状態</th>
              <th className="py-2.5 px-3 font-medium">改善可/不可</th>
              <th className="py-2.5 px-3 font-medium">責任</th>
              <th className="py-2.5 px-3 font-medium w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const done = item.status === '確認完了';
              return (
                <tr key={item.id} className={`border-b border-neutral-100 cursor-pointer ${done ? 'opacity-40' : 'hover:bg-neutral-50'}`} onClick={() => onRowClick(item)}>
                  <td className="py-2 px-3">{item.cmdb}</td>
                  <td className="py-2 px-3 max-w-[220px] truncate">{item.defect}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      done ? 'bg-emerald-100 text-emerald-700' :
                      item.status === '確認中' ? 'bg-blue-100 text-blue-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{item.status || '—'}</span>
                  </td>
                  <td className="py-2 px-3">{item.improvable || '—'}</td>
                  <td className="py-2 px-3">{item.responsible ? <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> : '—'}</td>
                  <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={() => onDelete(item.id)} title="削除" className="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                      <button onClick={() => openNotionPage(item.id)} title="Notionで編集" className="p-1 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded"><ExternalLink size={13} /></button>
                      <button onClick={() => !done && onComplete(item)} disabled={done} title="完了" className={`p-1 rounded ${done ? 'text-emerald-300 cursor-not-allowed' : 'text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50'}`}><Check size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-neutral-400">データなし</td></tr>}
          </tbody>
        </table>
        {hasMore && (
          <div className="flex justify-center py-2 border-t border-neutral-100">
            <button onClick={() => setShowCount((c) => c + LOAD_SIZE)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-3 py-1.5">
              もっと見る（残り {sorted.length - showCount}件）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// BugLeak Page (main)
function BugLeakPage() {
  const [items, setItems] = useState<BugLeakItem[]>([]);
  const [fields, setFields] = useState<Record<string, FieldInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<BugLeakItem | null>(null);
  const [completeItem, setCompleteItem] = useState<BugLeakItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterMonth !== null) {
      params.set('year', String(filterYear));
      params.set('month', String(filterMonth));
    } else {
      params.set('all', 'true');
    }
    try {
      const res = await fetch(`/api/test-center/bug-leak?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setFields(data.fields ?? {});
    } catch {
      setError('読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [filterYear, filterMonth]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const byService = useMemo(() => {
    const map = new Map<string, BugLeakItem[]>();
    for (const item of items) {
      const s = item.system || '(未設定)';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  const stats = useMemo(() => ({
    total: items.length,
    responsible: items.filter((i) => i.responsible).length,
    pending: items.filter((i) => i.status !== '確認完了').length,
  }), [items]);

  const handleDelete = async (id: string) => {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/stats/bugleak/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { setError('削除に失敗しました'); }
  };

  const handleComplete = async (form: { tcResult: string; improvable: string; checklistTitle: string }) => {
    if (!completeItem || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stats/bugleak/${completeItem.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, system: completeItem.system }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((i) => i.id === completeItem.id ? { ...i, status: '確認完了', tcResult: form.tcResult, improvable: form.improvable } : i));
      setCompleteItem(null);
    } catch { setError('更新に失敗しました'); } finally { setSaving(false); }
  };

  const handleMonthSelect = (y: number, m: number | null) => {
    setFilterYear(y);
    setFilterMonth(m);
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-600 text-xs flex items-center gap-1.5">
          <AlertCircle size={14} />{error}<button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="flex gap-3 flex-wrap flex-1">
          <StatCard label="総数" value={stats.total} color="bg-red-50 text-red-700" />
          <StatCard label="責任案件" value={stats.responsible} color="bg-amber-50 text-amber-700" />
          <StatCard label="未確認" value={stats.pending} color="bg-blue-50 text-blue-700" />
        </div>
        <MonthCalendar year={filterYear} month={filterMonth} onSelect={handleMonthSelect} />
      </div>

      {byService.map(([service, serviceItems]) => (
        <BugLeakServiceTable
          key={service}
          service={service}
          items={serviceItems}
          onRowClick={setDetailItem}
          onDelete={setDeleteTarget}
          onComplete={setCompleteItem}
        />
      ))}

      {items.length === 0 && !loading && (
        <div className="text-center py-12 text-neutral-400 text-sm">
          {filterMonth !== null ? `${filterYear}年${filterMonth}月のデータはありません` : 'データなし'}
        </div>
      )}

      {detailItem && <BugLeakDetailDialog item={detailItem} onClose={() => setDetailItem(null)} />}
      {completeItem && <BugLeakCompleteDialog item={completeItem} fields={fields} saving={saving} onSave={handleComplete} onClose={() => setCompleteItem(null)} />}
      {deleteTarget && <ConfirmDialog message="この案件を削除しますか？この操作は取り消せません。" onConfirm={() => handleDelete(deleteTarget)} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}

// ── Part 4: Checklist Page ──

function ChecklistPage() {
  const [items, setItems] = useState<Record<string, any>[]>([]);
  const [fields, setFields] = useState<Record<string, { type: string; options: string[] }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats/checklist');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setFields(data.fields ?? {});
    } catch { setError('読み込みに失敗しました'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const CHECKLIST_COLS = ['ID', 'テスト内容', 'システム', 'テスト種類', '開発品質改善資料', 'コメント'];
  const allFields = useMemo(() => Object.entries(fields).map(([name, f]) => ({ name, ...f })), [fields]);
  const displayCols = useMemo(() => {
    const cols = CHECKLIST_COLS.map((name) => allFields.find((f) => f.name === name)).filter(Boolean) as typeof allFields;
    return cols.length > 0 ? cols : allFields.slice(0, 6);
  }, [allFields]);
  const editableFields = useMemo(() => allFields.filter((f) => ['title', 'rich_text', 'select', 'status', 'number', 'checkbox', 'date', 'multi_select'].includes(f.type)), [allFields]);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);

  const handleCreate = async () => { if (saving) return; setSaving(true); try { const res = await fetch('/api/stats/checklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) }); if (!res.ok) throw new Error(); setCreating(false); setCreateForm({}); await load(); } catch { setError('作成に失敗しました'); } finally { setSaving(false); } };
  const handleUpdate = async (id: string) => { if (saving) return; setSaving(true); try { const res = await fetch(`/api/stats/checklist/${id}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) }); if (!res.ok) throw new Error(); setEditingId(null); await load(); } catch { setError('更新に失敗しました'); } finally { setSaving(false); } };
  const handleDelete = async (id: string) => { try { const res = await fetch(`/api/stats/checklist/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); setItems((prev) => prev.filter((i) => i.id !== id)); } catch { setError('削除に失敗しました'); } };

  if (loading) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;

  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-600 text-xs flex items-center gap-1.5"><AlertCircle size={14} />{error}<button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button></div>}
      <div className="flex gap-3 items-center">
        <StatCard label="総数" value={items.length} color="bg-purple-50 text-purple-700" />
        <div className="ml-auto">{!creating && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Plus size={14} />新規</button>}</div>
      </div>
      {creating && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {editableFields.slice(0, 6).map((f) => (
              <div key={f.name}>
                <label className="text-[10px] text-neutral-500">{f.name}</label>
                {f.options.length > 0 ? <select value={createForm[f.name] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [f.name]: e.target.value }))} className="w-full text-xs border rounded px-1.5 py-1"><option value="">--</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input value={createForm[f.name] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [f.name]: e.target.value }))} className="w-full text-xs border rounded px-1.5 py-1" />}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={handleCreate} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"><Save size={12} />{saving ? '保存中...' : '保存'}</button>
            <button onClick={() => { setCreating(false); setCreateForm({}); }} className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-700"><X size={14} /></button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto bg-white border border-neutral-200 rounded-xl shadow-sm">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-neutral-200 text-left text-neutral-500">{displayCols.map((f) => <th key={f.name} className="py-2.5 px-3 font-medium">{f.name}</th>)}<th className="py-2.5 px-3 font-medium w-16"></th></tr></thead>
          <tbody>
            {pagedItems.map((item) => (
              editingId === item.id ? (
                <tr key={item.id} className="border-b border-neutral-100 bg-purple-50/50">
                  {displayCols.map((f) => <td key={f.name} className="py-1.5 px-3">{f.options.length > 0 ? <select value={editForm[f.name] ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, [f.name]: e.target.value }))} className="text-xs border rounded px-1 py-1"><option value="">--</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input value={editForm[f.name] ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, [f.name]: e.target.value }))} className="w-full px-1.5 py-1 text-xs border rounded" />}</td>)}
                  <td className="py-1.5 px-3"><div className="flex gap-1"><button onClick={() => handleUpdate(item.id)} disabled={saving} className="p-1 text-purple-600 hover:bg-purple-100 rounded"><Save size={13} /></button><button onClick={() => setEditingId(null)} className="p-1 text-neutral-400 hover:bg-neutral-100 rounded"><X size={13} /></button></div></td>
                </tr>
              ) : (
                <tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50 group">
                  {displayCols.map((f) => <td key={f.name} className="py-2 px-3 max-w-[140px] truncate">{Array.isArray(item[f.name]) ? (item[f.name] as string[]).join(', ') : String(item[f.name] ?? '')}</td>)}
                  <td className="py-2 px-3">
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingId(item.id); const form: Record<string, string> = {}; for (const f of displayCols) form[f.name] = Array.isArray(item[f.name]) ? (item[f.name] as string[]).join(', ') : String(item[f.name] ?? ''); setEditForm(form); }} className="p-1 text-neutral-400 hover:text-purple-600 hover:bg-purple-50 rounded"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(item.id)} className="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {items.length === 0 && <tr><td colSpan={displayCols.length + 1} className="text-center py-8 text-neutral-400">データなし</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}

// ── Part 5: AI Stats Page ──

interface AiReviewDimension { name: string; weight: string; score: number }
interface AiReviewScore { total: number; grade: string; dimensions: AiReviewDimension[] }
interface AiReviewIssues { critical: number; major: number; minor: number; info: number; total: number }
interface AiReviewItem {
  id: string; title: string; effortSaved: number | null;
  createdTime: string; createdBy: string; totalCases: number | null;
  score: AiReviewScore | null; issues: AiReviewIssues | null;
}
interface AiReviewSummary {
  totalReports: number; avgScore: number | null; totalEffortSaved: number;
  gradeDistribution: Record<string, number>;
}

const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  B: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  C: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  D: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  F: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};

function GradeBadge({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' }) {
  const c = GRADE_COLORS[grade] ?? GRADE_COLORS.C;
  const sz = size === 'lg' ? 'w-12 h-12 text-xl' : size === 'md' ? 'w-8 h-8 text-sm' : 'w-6 h-6 text-xs';
  return <span className={`inline-flex items-center justify-center rounded-lg font-bold ${sz} ${c.bg} ${c.text} border ${c.border}`}>{grade}</span>;
}

function RadarChart({ dimensions, size = 160 }: { dimensions: AiReviewDimension[]; size?: number }) {
  const n = dimensions.length;
  if (n < 3) return null;
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const gridLevels = [20, 40, 60, 80, 100];
  const pointAt = (i: number, val: number) => {
    const angle = startAngle + i * angleStep;
    return { x: cx + (r * val / 100) * Math.cos(angle), y: cy + (r * val / 100) * Math.sin(angle) };
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="mx-auto">
      {gridLevels.map((lv) => (
        <polygon key={lv} points={Array.from({ length: n }, (_, i) => { const p = pointAt(i, lv); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#e5e7eb" strokeWidth={lv === 100 ? 1.5 : 0.5} />
      ))}
      {dimensions.map((_, i) => {
        const p = pointAt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth={0.5} />;
      })}
      <polygon
        points={dimensions.map((d, i) => { const p = pointAt(i, d.score); return `${p.x},${p.y}`; }).join(' ')}
        fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={1.5}
      />
      {dimensions.map((d, i) => {
        const p = pointAt(i, d.score);
        return <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />;
      })}
      {dimensions.map((d, i) => {
        const p = pointAt(i, 115);
        const short = d.name.length > 6 ? d.name.slice(0, 6) + '…' : d.name;
        return <text key={`lbl-${i}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className="fill-neutral-500" style={{ fontSize: '8px' }}>{short}</text>;
      })}
    </svg>
  );
}

function IssueBar({ issues }: { issues: AiReviewIssues }) {
  const t = issues.total || 1;
  const bars: { label: string; count: number; color: string }[] = [
    { label: 'Critical', count: issues.critical, color: 'bg-red-500' },
    { label: 'Major', count: issues.major, color: 'bg-orange-400' },
    { label: 'Minor', count: issues.minor, color: 'bg-amber-300' },
    { label: 'Info', count: issues.info, color: 'bg-blue-300' },
  ];
  return (
    <div className="space-y-1">
      <div className="flex h-3 rounded-full overflow-hidden">
        {bars.map((b) => b.count > 0 && <div key={b.label} className={`${b.color}`} style={{ width: `${(b.count / t) * 100}%` }} />)}
      </div>
      <div className="flex gap-3 text-[10px] text-neutral-500">
        {bars.map((b) => b.count > 0 && <span key={b.label} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${b.color}`} />{b.label} {b.count}</span>)}
      </div>
    </div>
  );
}

function AiReviewDetail({ item }: { item: AiReviewItem }) {
  const [html, setHtml] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [loadingHtml, setLoadingHtml] = useState(false);

  const loadHtml = () => {
    if (html !== null) { setShowFull(!showFull); return; }
    setLoadingHtml(true);
    fetch(`/api/stats/ai-reviews/${item.id}/html`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setHtml(d?.html ?? ''); setShowFull(true); })
      .catch(() => setHtml(''))
      .finally(() => setLoadingHtml(false));
  };

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        {/* Left: Radar */}
        <div className="flex flex-col items-center gap-2">
          <h4 className="text-xs font-semibold text-neutral-600">評価レーダー</h4>
          {item.score?.dimensions && <RadarChart dimensions={item.score.dimensions} />}
          {item.score?.dimensions?.map((d) => (
            <div key={d.name} className="flex items-center gap-2 w-full max-w-[200px] text-[10px]">
              <span className="text-neutral-500 w-20 truncate text-right" title={d.name}>{d.name}</span>
              <div className="flex-1 h-1.5 bg-neutral-200 rounded-full">
                <div className={`h-full rounded-full ${d.score >= 80 ? 'bg-emerald-400' : d.score >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${d.score}%` }} />
              </div>
              <span className="text-neutral-600 font-medium w-6 text-right">{d.score}</span>
            </div>
          ))}
        </div>

        {/* Center: Score */}
        <div className="flex flex-col items-center gap-1 px-4">
          {item.score && (
            <>
              <span className="text-3xl font-bold text-neutral-800">{item.score.total}</span>
              <GradeBadge grade={item.score.grade} size="lg" />
              <span className="text-[10px] text-neutral-400 mt-1">A(90+) B(80+) C(70+) D(60+) F(&lt;60)</span>
            </>
          )}
        </div>

        {/* Right: Issues */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-neutral-600">指摘分布</h4>
          {item.issues && <IssueBar issues={item.issues} />}
          {item.issues && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Critical', count: item.issues.critical, color: 'text-red-600 bg-red-50 border-red-100' },
                { label: 'Major', count: item.issues.major, color: 'text-orange-600 bg-orange-50 border-orange-100' },
                { label: 'Minor', count: item.issues.minor, color: 'text-amber-600 bg-amber-50 border-amber-100' },
                { label: 'Info', count: item.issues.info, color: 'text-blue-600 bg-blue-50 border-blue-100' },
              ].map((s) => (
                <div key={s.label} className={`flex items-center justify-between px-2 py-1 rounded border text-[11px] ${s.color}`}>
                  <span>{s.label}</span><span className="font-bold">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full report toggle */}
      <button onClick={loadHtml} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors">
        {loadingHtml ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} className={showFull ? 'rotate-180' : ''} />}
        {showFull ? '報告を閉じる' : '完全な報告を表示'}
      </button>
      {showFull && html !== null && (
        <div className="bg-white border border-neutral-200 rounded-lg p-4 prose prose-sm max-w-none text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-neutral-50 [&_th]:text-left [&_th]:font-medium">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  );
}

function AIStatsPage() {
  const [items, setItems] = useState<AiReviewItem[]>([]);
  const [summary, setSummary] = useState<AiReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aiCheckItems, setAiCheckItems] = useState<{ id: string; title: string; status: string }[]>([]);
  const [aiToggling, setAiToggling] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/stats/needs')
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.items ?? []).filter((it: any) => (it.category ?? '').includes('AI'));
        setAiCheckItems(filtered.map((it: any) => ({ id: it.id, title: it.title, status: it.status })));
      })
      .catch(() => {});
  }, []);

  const toggleAiCheck = useCallback((id: string, currentDone: boolean) => {
    setAiToggling((s) => new Set(s).add(id));
    fetch(`/api/stats/needs/${id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: currentDone ? '新' : '対応済' }),
    })
      .then((r) => r.json())
      .then((updated) => {
        setAiCheckItems((prev) => prev.map((it) => it.id === id ? { ...it, status: updated.status ?? (currentDone ? '新' : '対応済') } : it));
      })
      .catch(() => {})
      .finally(() => setAiToggling((s) => { const n = new Set(s); n.delete(id); return n; }));
  }, []);

  useEffect(() => {
    fetch('/api/stats/ai-reviews')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setItems(d.items ?? []); setSummary(d.summary ?? null); })
      .catch(() => setError('AI実績の読み込みに失敗しました'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-xs flex items-center gap-1.5"><AlertCircle size={14} />{error}</div>;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400"><FileText size={12} />レビュー総数</div>
            <div className="text-2xl font-bold text-neutral-800">{summary.totalReports}</div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400"><Star size={12} />平均得点</div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-neutral-800">{summary.avgScore ?? '—'}</span>
              {summary.avgScore && <GradeBadge grade={summary.avgScore >= 90 ? 'A' : summary.avgScore >= 80 ? 'B' : summary.avgScore >= 70 ? 'C' : summary.avgScore >= 60 ? 'D' : 'F'} size="sm" />}
            </div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400"><TrendingUp size={12} />工数改善合計</div>
            <div className="text-2xl font-bold text-neutral-800">{summary.totalEffortSaved}<span className="text-sm font-normal text-neutral-400 ml-1">人日</span></div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400"><BarChart3 size={12} />等級分布</div>
            <div className="flex gap-1.5 mt-1">
              {['A', 'B', 'C', 'D', 'F'].map((g) => {
                const cnt = summary.gradeDistribution[g] || 0;
                if (cnt === 0) return null;
                const c = GRADE_COLORS[g];
                return <span key={g} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.text} border ${c.border}`}>{g}:{cnt}</span>;
              })}
            </div>
          </div>
        </div>
      )}

      {aiCheckItems.length > 0 && (
        <div className="bg-white border border-violet-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-violet-100 bg-violet-50/60 flex items-center gap-2">
            <Check size={13} className="text-violet-500" />
            <span className="text-xs font-bold text-violet-700">AI チェックリスト</span>
            <span className="text-[10px] text-violet-500 ml-1">
              {aiCheckItems.filter((it) => it.status === '対応済').length}/{aiCheckItems.length} 完了
            </span>
          </div>
          <div className="divide-y divide-neutral-50">
            {aiCheckItems.map((it) => {
              const done = it.status === '対応済';
              const toggling = aiToggling.has(it.id);
              return (
                <label key={it.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50/50 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={toggling}
                    onChange={() => toggleAiCheck(it.id, done)}
                    className="accent-violet-600 w-3.5 h-3.5 shrink-0"
                  />
                  <span className={`text-sm ${done ? 'line-through text-neutral-400' : 'text-neutral-700'}`}>{it.title}</span>
                  {toggling && <Loader2 size={12} className="animate-spin text-neutral-300 ml-auto" />}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Review list */}
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-[70px]">月次</th>
              <th className="text-left px-3 py-2 font-medium text-neutral-500">レビュー名称</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-20">日付</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-16">TC数</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-14">得点</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-12">等級</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-14">Critical</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-14">Major</th>
              <th className="text-center px-2 py-2 font-medium text-neutral-500 w-16">工数改善</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td colSpan={9} className="p-0">
                  <div>
                    <button
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      className="w-full flex items-center text-left hover:bg-neutral-50 transition-colors px-3 py-2 gap-1"
                    >
                      <span className="text-neutral-400 w-[70px] text-center shrink-0">{item.createdTime ? (() => { const d = new Date(item.createdTime); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; })() : '—'}</span>
                      <ChevronDown size={12} className={`text-neutral-400 shrink-0 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`} />
                      <span className="flex-1 truncate text-neutral-800 font-medium">{item.title}</span>
                      <span className="text-neutral-400 w-20 text-center shrink-0">{item.createdTime ? new Date(item.createdTime).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '—'}</span>
                      <span className="text-neutral-600 w-16 text-center shrink-0">{item.totalCases ?? '—'}</span>
                      <span className="text-neutral-800 font-bold w-14 text-center shrink-0">{item.score?.total ?? '—'}</span>
                      <span className="w-12 text-center shrink-0">{item.score?.grade ? <GradeBadge grade={item.score.grade} size="sm" /> : '—'}</span>
                      <span className={`w-14 text-center shrink-0 font-bold ${(item.issues?.critical ?? 0) > 0 ? 'text-red-600' : 'text-neutral-400'}`}>{item.issues?.critical ?? '—'}</span>
                      <span className={`w-14 text-center shrink-0 font-bold ${(item.issues?.major ?? 0) > 0 ? 'text-orange-500' : 'text-neutral-400'}`}>{item.issues?.major ?? '—'}</span>
                      <span className="text-neutral-600 w-16 text-center shrink-0">{item.effortSaved != null ? `${item.effortSaved}d` : '—'}</span>
                    </button>
                    {expandedId === item.id && <div className="px-3 pb-3"><AiReviewDetail item={item} /></div>}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-neutral-400">データなし</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section config ──

type SectionId = 'needs' | 'performance' | 'bugleak' | 'checklist' | 'ai';

const SECTIONS: { id: SectionId; title: string; icon: React.ReactNode; description: string; color: string }[] = [
  { id: 'needs', title: 'ニーズ集計', icon: <Database size={24} className="text-blue-600" />, description: 'ニーズ項目の集計・管理', color: 'border-blue-200 hover:border-blue-400' },
  { id: 'performance', title: '実績データ統計', icon: <BarChart3 size={24} className="text-green-600" />, description: '実績データの集計・分析', color: 'border-green-200 hover:border-green-400' },
  { id: 'bugleak', title: '開発品質問題案件確認', icon: <Shield size={24} className="text-red-600" />, description: '品質問題案件の確認・管理', color: 'border-red-200 hover:border-red-400' },
  { id: 'checklist', title: 'Checklist統計', icon: <CheckSquare size={24} className="text-purple-600" />, description: '改善チェックリストの管理', color: 'border-purple-200 hover:border-purple-400' },
  { id: 'ai', title: 'AI実績統計', icon: <Bot size={24} className="text-cyan-600" />, description: 'AI指摘・レビュー・課題の実績', color: 'border-cyan-200 hover:border-cyan-400' },
];

// ── Landing Page (cards with stats) ──

function StatsLanding({ onSelect }: { onSelect: (id: SectionId) => void }) {
  const [needsStats, setNeedsStats] = useState<{ total: number; unconfirmed: number; completed: number } | null>(null);
  const [bugLeakStats, setBugLeakStats] = useState<{ total: number; responsible: number; pending: number } | null>(null);
  const [checklistCount, setChecklistCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/stats/needs').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.stats) setNeedsStats(d.stats); }).catch(() => {});
    fetch('/api/test-center/bug-leak').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.items) {
        const items: BugLeakItem[] = d.items;
        setBugLeakStats({
          total: items.length,
          responsible: items.filter((i) => i.responsible).length,
          pending: items.filter((i) => !i.status || !['完了', '対応済', 'クローズ'].includes(i.status)).length,
        });
      }
    }).catch(() => {});
    fetch('/api/stats/checklist').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.items) setChecklistCount(d.items.length); }).catch(() => {});
  }, []);

  const statsMap: Record<string, React.ReactNode> = {
    needs: needsStats ? (
      <div className="flex gap-2 mt-2">
        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">総数 {needsStats.total}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700">未確認 {needsStats.unconfirmed}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">完了 {needsStats.completed}</span>
      </div>
    ) : null,
    bugleak: bugLeakStats ? (
      <div className="flex gap-2 mt-2">
        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">総数 {bugLeakStats.total}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">責任 {bugLeakStats.responsible}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700">待確認 {bugLeakStats.pending}</span>
      </div>
    ) : null,
    checklist: checklistCount !== null ? (
      <div className="flex gap-2 mt-2">
        <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">総数 {checklistCount}</span>
      </div>
    ) : null,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => s.id !== 'performance' && onSelect(s.id)}
          disabled={s.id === 'performance'}
          className={`text-left bg-white border-2 ${s.color} rounded-xl p-4 shadow-sm transition-all ${s.id === 'performance' ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}`}
        >
          <div className="flex items-center gap-3 mb-2">
            {s.icon}
            <div>
              <h3 className="font-semibold text-sm">{s.title}</h3>
              <p className="text-xs text-neutral-500">{s.description}</p>
            </div>
            {s.id !== 'performance' && <ChevronRight size={16} className="ml-auto text-neutral-400" />}
          </div>
          {statsMap[s.id]}
          {s.id === 'performance' && <p className="text-xs text-neutral-400 mt-2 italic">Coming soon</p>}
        </button>
      ))}
    </div>
  );
}

// ── Main Panel ──

export default function DataStatsPanel({ onBack }: { onBack: () => void }) {
  const [subRoute, setSubRoute] = useSubRoute();

  const activeSection: SectionId | null = SECTIONS.find((s) => s.id === subRoute[0])?.id ?? null;

  const goHome = () => setSubRoute([]);
  const goSection = (id: SectionId) => setSubRoute([id]);

  const sectionMeta = activeSection ? SECTIONS.find((s) => s.id === activeSection) : null;

  const breadcrumbItems = [
    { label: 'ホーム', onClick: onBack },
    ...(activeSection
      ? [
          { label: 'データ統計', onClick: goHome },
          { label: sectionMeta?.title ?? '' },
        ]
      : [{ label: 'データ統計' }]
    ),
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-2">
      <Breadcrumb items={breadcrumbItems} />

      {!activeSection ? (
        <StatsLanding onSelect={goSection} />
      ) : activeSection === 'needs' ? (
        <NeedsListPage />
      ) : activeSection === 'bugleak' ? (
        <BugLeakPage />
      ) : activeSection === 'checklist' ? (
        <ChecklistPage />
      ) : activeSection === 'ai' ? (
        <AIStatsPage />
      ) : null}
    </div>
  );
}
