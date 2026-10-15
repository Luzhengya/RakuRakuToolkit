import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSubRoute } from '../hooks/useSubRoute';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Save,
  Shield,
  Trash2,
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

type NeedsCategory = 'QA' | '指摘' | 'その他';

function classifyNeeds(item: NeedsItem): NeedsCategory {
  if (item.category === 'QA') return 'QA';
  if (item.category === '指摘') return '指摘';
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
    const other: NeedsItem[] = [];
    for (const item of items) {
      const cat = classifyNeeds(item);
      if (cat === 'QA') qa.push(item);
      else if (cat === '指摘') shiteki.push(item);
      else other.push(item);
    }
    return { qa, shiteki, other };
  }, [items]);

  const stats = useMemo(() => ({
    qa: grouped.qa.length,
    qaUnconfirmed: grouped.qa.filter((i) => i.status !== '対応済').length,
    shiteki: grouped.shiteki.length,
    shitekiUnconfirmed: grouped.shiteki.filter((i) => i.status !== '対応済').length,
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
        <StatCard label="その他" value={stats.other} color="bg-neutral-100 text-neutral-700" />
      </div>

      <NeedsCategoryTable label="QA" items={grouped.qa} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />
      <NeedsCategoryTable label="指摘" items={grouped.shiteki} onComplete={handleComplete} onDelete={setDeleteTarget} completing={completing} />
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

function BugLeakPage() {
  const [items, setItems] = useState<BugLeakItem[]>([]);
  const [fields, setFields] = useState<Record<string, FieldInfo>>({});
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
      const res = await fetch('/api/test-center/bug-leak');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setFields(data.fields ?? {});
    } catch {
      setError('読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const total = items.length;
    const responsible = items.filter((i) => i.responsible).length;
    const pending = items.filter((i) => !i.status || !['完了', '対応済', 'クローズ'].includes(i.status)).length;
    return { total, responsible, pending };
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);

  const displayFields: { key: keyof BugLeakItem; label: string }[] = [
    { key: 'system', label: 'サービス' },
    { key: 'caseMonth', label: '案件別' },
    { key: 'cmdb', label: 'CMDB' },
    { key: 'feature', label: '機能' },
    { key: 'defect', label: '障害内容' },
    { key: 'status', label: '状態' },
    { key: 'improvable', label: '改善可/不可' },
  ];

  const handleCreate = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/stats/bugleak/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) });
      if (!res.ok) throw new Error();
      setCreating(false); setCreateForm({}); await load();
    } catch { setError('作成に失敗しました'); } finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/test-center/bug-leak/${id}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
      if (!res.ok) throw new Error();
      setEditingId(null); await load();
    } catch { setError('更新に失敗しました'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/stats/bugleak/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { setError('削除に失敗しました'); }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-600 text-xs flex items-center gap-1.5">
          <AlertCircle size={14} />{error}<button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}
      <div className="flex gap-3 items-center">
        <StatCard label="総数" value={stats.total} color="bg-blue-50 text-blue-700" />
        <StatCard label="責任案件" value={stats.responsible} color="bg-red-50 text-red-700" />
        <StatCard label="待確認" value={stats.pending} color="bg-amber-50 text-amber-700" />
        <div className="ml-auto">
          {!creating && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Plus size={14} />新規</button>}
        </div>
      </div>

      {creating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(fields).filter(([, f]) => f.writable).slice(0, 6).map(([key, f]) => (
              <div key={key}>
                <label className="text-[10px] text-neutral-500">{key}</label>
                {f.options.length > 0 ? (
                  <select value={createForm[key] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [key]: e.target.value }))} className="w-full text-xs border rounded px-1.5 py-1"><option value="">--</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                ) : (
                  <input value={createForm[key] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [key]: e.target.value }))} className="w-full text-xs border rounded px-1.5 py-1" />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={handleCreate} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"><Save size={12} />{saving ? '保存中...' : '保存'}</button>
            <button onClick={() => { setCreating(false); setCreateForm({}); }} className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-700"><X size={14} /></button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-neutral-200 rounded-xl shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              {displayFields.map((f) => <th key={f.key} className="py-2.5 px-3 font-medium">{f.label}</th>)}
              <th className="py-2.5 px-3 font-medium">責任</th>
              <th className="py-2.5 px-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item) => (
              editingId === item.id ? (
                <tr key={item.id} className="border-b border-neutral-100 bg-blue-50/50">
                  {displayFields.map((f) => (
                    <td key={f.key} className="py-1.5 px-3">
                      {fields[f.key]?.options?.length ? (
                        <select value={editForm[f.key] ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))} className="text-xs border rounded px-1 py-1"><option value="">--</option>{fields[f.key].options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      ) : (
                        <input value={editForm[f.key] ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))} className="w-full px-1.5 py-1 text-xs border rounded" />
                      )}
                    </td>
                  ))}
                  <td className="py-1.5 px-3"><input type="checkbox" checked={editForm.responsible === 'true'} onChange={(e) => setEditForm((p) => ({ ...p, responsible: String(e.target.checked) }))} /></td>
                  <td className="py-1.5 px-3">
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdate(item.id)} disabled={saving} className="p-1 text-blue-600 hover:bg-blue-100 rounded"><Save size={13} /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-neutral-400 hover:bg-neutral-100 rounded"><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50 group">
                  {displayFields.map((f) => <td key={f.key} className="py-2 px-3 max-w-[140px] truncate">{String(item[f.key] ?? '')}</td>)}
                  <td className="py-2 px-3">{item.responsible && <span className="inline-block w-2 h-2 rounded-full bg-red-500" />}</td>
                  <td className="py-2 px-3">
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingId(item.id); const form: Record<string, string> = {}; for (const f of displayFields) form[f.key] = String(item[f.key] ?? ''); form.responsible = String(item.responsible); setEditForm(form); }} className="p-1 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(item.id)} className="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {items.length === 0 && <tr><td colSpan={displayFields.length + 2} className="text-center py-8 text-neutral-400">データなし</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
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

  const editableFields = useMemo(() => Object.entries(fields).filter(([, f]) => ['title', 'rich_text', 'select', 'status', 'number', 'checkbox', 'date'].includes(f.type)).map(([name, f]) => ({ name, ...f })), [fields]);
  const displayCols = useMemo(() => editableFields.slice(0, 6), [editableFields]);
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

function AIStatsPage() {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stats/ai-page')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setHtml(d.html ?? ''))
      .catch(() => setError('AI実績ページの読み込みに失敗しました'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 size={20} className="animate-spin mr-2" />読み込み中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-xs flex items-center gap-1.5"><AlertCircle size={14} />{error}</div>;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm prose prose-sm max-w-none text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-neutral-50 [&_th]:text-left [&_th]:font-medium">
      <div dangerouslySetInnerHTML={{ __html: html }} />
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
