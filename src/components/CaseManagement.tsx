import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

interface ChildCase {
  id: string;
  projectName: string;
  status: string;
  assignee: string;
  month: string;
  system: string;
  estimateTotal: string;
  actualTotal: string;
  testTotalCount: string;
  bugCount: string;
  tcStartDate: string;
  tcDesignCompleteDate: string;
  tcExecutionCompleteDate: string;
  actualStartDate: string;
  actualDesignCompleteDate: string;
  actualExecutionCompleteDate: string;
}

interface ParentNode {
  id: string;
  projectName: string;
  system: string;
  month: string;
  status: string;
  childCount: number;
  children: ChildCase[];
}

interface SystemGroup {
  system: string;
  parents: ParentNode[];
}

const STATUS_COLOR: Record<string, string> = {
  '未着手': 'bg-neutral-100 text-neutral-600',
  '進行中': 'bg-blue-50 text-blue-700',
  '予定通り完了': 'bg-emerald-50 text-emerald-700',
  '遅延完了': 'bg-amber-50 text-amber-700',
  'ブロック': 'bg-red-50 text-red-700',
};

function statusBadge(status: string) {
  const cls = STATUS_COLOR[status.trim()] ?? 'bg-neutral-100 text-neutral-600';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status || '-'}</span>;
}

export default function CaseManagement({ onBack }: { onBack: () => void }) {
  const [tree, setTree] = useState<ParentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [systemOptions, setSystemOptions] = useState<string[]>([]);

  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());

  // CRUD state
  const [editingCase, setEditingCase] = useState<ChildCase | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingParent, setCreatingParent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/case-management/tree');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch {
      setError('案件ツリーの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    fetch('/api/case-management/status-options')
      .then((r) => r.ok ? r.json() : { options: [] })
      .then((d) => setStatusOptions(d.options ?? []))
      .catch(() => {});
    fetch('/api/case-management/system-options')
      .then((r) => r.ok ? r.json() : { options: [] })
      .then((d) => setSystemOptions(d.options ?? []))
      .catch(() => {});
  }, []);

  // system でグルーピング
  const systemGroups = useMemo<SystemGroup[]>(() => {
    const map = new Map<string, ParentNode[]>();
    for (const p of tree) {
      const sys = p.system || '(未設定)';
      if (!map.has(sys)) map.set(sys, []);
      map.get(sys)!.push(p);
    }
    return Array.from(map.entries()).map(([system, parents]) => ({ system, parents }));
  }, [tree]);

  // 検索フィルタ
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return systemGroups;
    const q = searchQuery.toLowerCase();
    return systemGroups
      .map((g) => ({
        ...g,
        parents: g.parents.filter((p) =>
          p.projectName.toLowerCase().includes(q) ||
          p.children.some((c) => c.projectName.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.parents.length > 0);
  }, [systemGroups, searchQuery]);

  const selectedParent = useMemo(() => tree.find((p) => p.id === selectedParentId), [tree, selectedParentId]);

  const toggleSystem = (sys: string) => {
    setExpandedSystems((prev) => {
      const next = new Set(prev);
      if (next.has(sys)) next.delete(sys);
      else next.add(sys);
      return next;
    });
  };

  // 親案件作成
  const handleCreateParent = async (system: string, releaseDate: string) => {
    if (!system || !releaseDate) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/case-management/create-parent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, releaseDate }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error || '作成に失敗しました');
      }
      setCreatingParent(false);
      await loadTree();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 新規案件作成
  const handleCreate = async (name: string) => {
    if (!selectedParent || !name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/case-management/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: selectedParent.id,
          projectName: name.trim(),
          system: selectedParent.system,
          month: selectedParent.month,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error || '作成に失敗しました');
      }
      setCreating(false);
      await loadTree();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 案件更新
  const handleUpdate = async (id: string, fields: Record<string, string>) => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/case-management/${encodeURIComponent(id)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error || '更新に失敗しました');
      }
      setEditingCase(null);
      await loadTree();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 案件削除(アーカイブ)
  const handleDelete = async (id: string) => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/case-management/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      setDeleteConfirm(null);
      setEditingCase(null);
      await loadTree();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-neutral-100 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <FolderTree size={22} className="text-orange-600" />
        <h2 className="text-xl font-bold">案件管理</h2>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          読み込み中...
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* 左: ツリーナビ */}
          <aside className="w-72 shrink-0 bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-3 border-b border-neutral-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="案件を検索..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-lg focus:border-neutral-400 focus:outline-none"
                />
              </div>
            </div>
            <nav className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-neutral-50">
              {filteredGroups.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-6">該当する案件がありません</p>
              ) : (
                filteredGroups.map((g) => (
                  <div key={g.system}>
                    <button
                      onClick={() => toggleSystem(g.system)}
                      className="w-full text-left px-3 py-2 text-xs font-bold text-neutral-500 hover:bg-neutral-50 flex items-center gap-1.5"
                    >
                      <ChevronRight
                        size={12}
                        className={`transition-transform ${expandedSystems.has(g.system) ? 'rotate-90' : ''}`}
                      />
                      {g.system}
                      <span className="text-neutral-300 font-normal ml-auto">{g.parents.length}</span>
                    </button>
                    {expandedSystems.has(g.system) && (
                      <div className="pb-1">
                        {g.parents.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedParentId(p.id); setEditingCase(null); setCreating(false); }}
                            className={`w-full text-left pl-7 pr-3 py-1.5 text-sm hover:bg-neutral-50 flex items-center justify-between gap-2 ${
                              selectedParentId === p.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-neutral-700'
                            }`}
                          >
                            <span className="truncate">{p.month || p.projectName}</span>
                            <span className="text-[10px] text-neutral-400 shrink-0">{p.childCount}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </nav>
            <div className="p-3 border-t border-neutral-100">
              {creatingParent ? (
                <CreateParentForm
                  systemOptions={systemOptions}
                  saving={saving}
                  error={formError}
                  onSave={handleCreateParent}
                  onCancel={() => { setCreatingParent(false); setFormError(null); }}
                />
              ) : (
                <button
                  onClick={() => { setCreatingParent(true); setFormError(null); }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-neutral-300 text-neutral-500 text-sm hover:border-neutral-400 hover:text-neutral-700 transition-colors"
                >
                  <Plus size={14} />
                  新規親案件
                </button>
              )}
            </div>
          </aside>

          {/* 右: 案件リスト */}
          <section className="flex-1 min-w-0">
            {!selectedParent ? (
              <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-neutral-400 text-sm">
                左のツリーから親案件を選択してください
              </div>
            ) : (
              <div className="bg-white border border-neutral-200 rounded-xl shadow-sm">
                {/* 親ヘッダー */}
                <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-800">{selectedParent.projectName}</h3>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {selectedParent.system} / {selectedParent.month} / {selectedParent.childCount} 件
                    </p>
                  </div>
                  <button
                    onClick={() => { setCreating(true); setEditingCase(null); setFormError(null); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
                  >
                    <Plus size={14} />
                    新規追加
                  </button>
                </div>

                {/* 新規フォーム */}
                {creating && (
                  <CreateForm
                    saving={saving}
                    error={formError}
                    onSave={handleCreate}
                    onCancel={() => { setCreating(false); setFormError(null); }}
                  />
                )}

                {/* 子案件テーブル */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 text-[11px] text-neutral-400 font-medium">
                        <th className="text-left px-4 py-2">案件名</th>
                        <th className="text-left px-3 py-2">状態</th>
                        <th className="text-left px-3 py-2">担当者</th>
                        <th className="text-right px-3 py-2">テスト件数</th>
                        <th className="text-right px-3 py-2">NG数</th>
                        <th className="text-right px-3 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50">
                      {selectedParent.children.length === 0 && !creating ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-neutral-400 text-xs">子案件がありません</td>
                        </tr>
                      ) : (
                        selectedParent.children.map((c) => (
                          <tr key={c.id} className="hover:bg-neutral-50/50">
                            <td className="px-4 py-2.5 font-medium text-neutral-800 max-w-[200px] truncate">{c.projectName}</td>
                            <td className="px-3 py-2.5">{statusBadge(c.status)}</td>
                            <td className="px-3 py-2.5 text-neutral-600">{c.assignee || '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.testTotalCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.bugCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => { setEditingCase(c); setCreating(false); setFormError(null); setDeleteConfirm(null); }}
                                  className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
                                  title="編集"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => { setDeleteConfirm(c.id); setFormError(null); }}
                                  className="p-1.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"
                                  title="削除"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 削除確認 */}
                {deleteConfirm && (
                  <div className="px-4 py-3 border-t border-neutral-100 bg-red-50/50 flex items-center justify-between">
                    <p className="text-sm text-red-600">この案件をアーカイブしますか？</p>
                    <div className="flex gap-2">
                      <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-sm rounded border border-neutral-300 hover:bg-white">キャンセル</button>
                      <button onClick={() => handleDelete(deleteConfirm)} disabled={saving} className="px-3 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : '削除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 編集パネル */}
            {editingCase && (
              <EditPanel
                item={editingCase}
                statusOptions={statusOptions}
                saving={saving}
                error={formError}
                onSave={(fields) => handleUpdate(editingCase.id, fields)}
                onCancel={() => { setEditingCase(null); setFormError(null); }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CreateParentForm({ systemOptions, saving, error, onSave, onCancel }: {
  systemOptions: string[];
  saving: boolean;
  error: string | null;
  onSave: (system: string, releaseDate: string) => void;
  onCancel: () => void;
}) {
  const [system, setSystem] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  return (
    <div className="space-y-2">
      <select
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white"
      >
        <option value="">System を選択...</option>
        {systemOptions.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        type={releaseDate ? 'date' : 'text'}
        value={releaseDate}
        placeholder="本番予定日"
        onFocus={(e) => { (e.target as HTMLInputElement).type = 'date'; }}
        onBlur={(e) => { if (!releaseDate) (e.target as HTMLInputElement).type = 'text'; }}
        onChange={(e) => setReleaseDate(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => onSave(system, releaseDate)}
          disabled={saving || !system || !releaseDate}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          作成
        </button>
        <button onClick={onCancel} className="px-2 py-1.5 text-sm rounded-lg border border-neutral-300 hover:bg-neutral-50">
          取消
        </button>
      </div>
    </div>
  );
}

function CreateForm({ saving, error, onSave, onCancel }: {
  saving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新しい案件名を入力..."
          className="flex-1 px-3 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name); }}
        />
        <button
          onClick={() => onSave(name)}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          作成
        </button>
        <button onClick={onCancel} className="p-1.5 rounded hover:bg-neutral-200 text-neutral-500">
          <X size={16} />
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}

function EditPanel({ item, statusOptions, saving, error, onSave, onCancel }: {
  item: ChildCase;
  statusOptions: string[];
  saving: boolean;
  error: string | null;
  onSave: (fields: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    projectName: item.projectName,
    status: item.status,
    tcStartDate: item.tcStartDate,
    tcDesignCompleteDate: item.tcDesignCompleteDate,
    tcExecutionCompleteDate: item.tcExecutionCompleteDate,
  });

  useEffect(() => {
    setDraft({
      projectName: item.projectName,
      status: item.status,
      tcStartDate: item.tcStartDate,
      tcDesignCompleteDate: item.tcDesignCompleteDate,
      tcExecutionCompleteDate: item.tcExecutionCompleteDate,
    });
  }, [item]);

  const changed = useMemo(() => {
    const diff: Record<string, string> = {};
    if (draft.projectName !== item.projectName) diff.projectName = draft.projectName;
    if (draft.status !== item.status) diff.status = draft.status;
    if (draft.tcStartDate !== item.tcStartDate) diff.tcStartDate = draft.tcStartDate;
    if (draft.tcDesignCompleteDate !== item.tcDesignCompleteDate) diff.tcDesignCompleteDate = draft.tcDesignCompleteDate;
    if (draft.tcExecutionCompleteDate !== item.tcExecutionCompleteDate) diff.tcExecutionCompleteDate = draft.tcExecutionCompleteDate;
    return diff;
  }, [draft, item]);

  const FIELDS: { key: keyof typeof draft; label: string; type: 'text' | 'date' | 'select' }[] = [
    { key: 'projectName', label: '案件名', type: 'text' },
    { key: 'status', label: '状態', type: 'select' },
    { key: 'tcStartDate', label: 'TC開始予定日', type: 'date' },
    { key: 'tcDesignCompleteDate', label: 'TC設計書完了予定日', type: 'date' },
    { key: 'tcExecutionCompleteDate', label: 'TC実施完了予定日', type: 'date' },
  ];

  return (
    <div className="mt-4 bg-white border border-neutral-200 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-neutral-800">案件編集</h4>
        <button onClick={onCancel} className="p-1 rounded hover:bg-neutral-100 text-neutral-400">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === 'projectName' ? 'md:col-span-2' : ''}>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">{f.label}</label>
            {f.type === 'select' ? (
              <select
                value={draft[f.key]}
                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white"
              >
                <option value="">-</option>
                {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type}
                value={draft[f.key]}
                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 hover:bg-neutral-50">
          キャンセル
        </button>
        <button
          onClick={() => onSave(changed)}
          disabled={saving || Object.keys(changed).length === 0}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          保存
        </button>
      </div>
    </div>
  );
}
