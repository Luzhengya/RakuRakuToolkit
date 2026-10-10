import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';

interface ChildCase {
  id: string;
  projectName: string;
  status: string;
  assignee: string;
  manager: string;
  month: string;
  system: string;
  estimateTotal: string;
  actualTotal: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
  unexpectedNgCount: string;
  japanCaseCount: string;
  japanBugCount: string;
  tcStartDate: string;
  tcDesignCompleteDate: string;
  tcExecutionCompleteDate: string;
  actualStartDate: string;
  actualDesignCompleteDate: string;
  actualExecutionCompleteDate: string;
  developmentEffort: string;
  designEstimate: string;
  implementationEstimate: string;
  executionEstimate: string;
  reviewEstimate: string;
  designActual: string;
  implActual: string;
  execActual: string;
  reviewActual: string;
  releaseDate: string;
  verificationDate: string;
  desiredCompleteDate: string;
  comment: string;
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

type FieldDef = { key: string; label: string; type: 'text' | 'date' | 'number' | 'select' | 'multiselect'; span?: boolean };

const SCHEDULE_FIELDS: FieldDef[] = [
  { key: 'projectName', label: '案件名', type: 'text', span: true },
  { key: 'status', label: '状態', type: 'select' },
  { key: 'assignee', label: '担当者', type: 'multiselect' },
  { key: 'manager', label: '管理者', type: 'multiselect' },
  { key: 'releaseDate', label: '本番日', type: 'date' },
  { key: 'verificationDate', label: '検証日', type: 'date' },
  { key: 'desiredCompleteDate', label: '完了希望日', type: 'date' },
  { key: 'tcStartDate', label: 'TC開始予定日', type: 'date' },
  { key: 'actualStartDate', label: '実際開始日', type: 'date' },
  { key: 'tcDesignCompleteDate', label: 'TC設計書完了予定日', type: 'date' },
  { key: 'actualDesignCompleteDate', label: '実際設計書完了日', type: 'date' },
  { key: 'tcExecutionCompleteDate', label: 'TC実施完了予定日', type: 'date' },
  { key: 'actualExecutionCompleteDate', label: '実際実施完了日', type: 'date' },
  { key: 'comment', label: 'コメント', type: 'text', span: true },
];

const EFFORT_FIELDS: FieldDef[] = [
  { key: 'estimateTotal', label: '見積総', type: 'number' },
  { key: 'actualTotal', label: '実績総', type: 'number' },
  { key: 'developmentEffort', label: '開発工数', type: 'number' },
  { key: 'designEstimate', label: '工数見積(設計書)', type: 'number' },
  { key: 'designActual', label: '工数実績(設計書)', type: 'number' },
  { key: 'implementationEstimate', label: '工数見積(実装)', type: 'number' },
  { key: 'implActual', label: '工数実績(実装)', type: 'number' },
  { key: 'executionEstimate', label: '工数見積(実施)', type: 'number' },
  { key: 'execActual', label: '工数実績(実施)', type: 'number' },
  { key: 'reviewEstimate', label: 'Review見積工数', type: 'number' },
  { key: 'reviewActual', label: 'Review実績工数', type: 'number' },
];

const TEST_FIELDS: FieldDef[] = [
  { key: 'testTotalCount', label: 'Test総件数', type: 'number' },
  { key: 'bugCount', label: 'NG数', type: 'number' },
  { key: 'testBlockedCount', label: 'Test不可', type: 'number' },
  { key: 'pendingConfirmCount', label: '確認中件数', type: 'number' },
  { key: 'unexpectedNgCount', label: '想定外NG数', type: 'number' },
  { key: 'japanCaseCount', label: '日本側case数', type: 'number' },
  { key: 'japanBugCount', label: '日本側NG数', type: 'number' },
];

const ALL_EDIT_FIELDS = [...SCHEDULE_FIELDS, ...EFFORT_FIELDS, ...TEST_FIELDS];

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

  const [viewMode, setViewMode] = useState<'tree' | 'assignee'>('tree');
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [memberOptions, setMemberOptions] = useState<string[]>([]);

  // 行展開
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
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
    fetch('/api/case-management/member-options')
      .then((r) => r.ok ? r.json() : { members: [] })
      .then((d) => setMemberOptions(d.members ?? []))
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

  // 担当者ビュー用: 全子案件を担当者でグループ化
  type AssigneeCaseItem = ChildCase & { parentName: string; parentSystem: string; parentMonth: string };
  const EXCLUDED_SYSTEMS = new Set(['改善対応', '管理作業', '全体システム', '月次改善タスク']);
  const assigneeMap = useMemo(() => {
    const map = new Map<string, AssigneeCaseItem[]>();
    for (const parent of tree) {
      if (EXCLUDED_SYSTEMS.has(parent.system)) continue;
      for (const child of parent.children) {
        const emails = child.assignee ? child.assignee.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const item: AssigneeCaseItem = { ...child, parentName: parent.projectName, parentSystem: parent.system, parentMonth: parent.month };
        if (emails.length === 0) {
          const key = '未決定';
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(item);
        } else {
          for (const email of emails) {
            if (!map.has(email)) map.set(email, []);
            map.get(email)!.push(item);
          }
        }
      }
    }
    return map;
  }, [tree]);

  const assigneeList = useMemo(() => {
    const all = Array.from(assigneeMap.keys()).sort((a, b) => {
      if (a === '未決定') return 1;
      if (b === '未決定') return -1;
      return a.localeCompare(b);
    });
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((a) =>
      a.toLowerCase().includes(q) ||
      assigneeMap.get(a)!.some((c) => c.projectName.toLowerCase().includes(q) || c.parentName.toLowerCase().includes(q)),
    );
  }, [assigneeMap, searchQuery]);

  const selectedAssigneeCases = useMemo(() => {
    if (!selectedAssignee) return [];
    return assigneeMap.get(selectedAssignee) ?? [];
  }, [assigneeMap, selectedAssignee]);

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
        <div className="ml-auto flex items-center bg-neutral-100 rounded-lg p-0.5">
          <button
            onClick={() => { setViewMode('tree'); setSelectedAssignee(null); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'tree' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            <FolderTree size={14} />
            案件ツリー
          </button>
          <button
            onClick={() => { setViewMode('assignee'); setSelectedParentId(null); setEditingCase(null); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'assignee' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            <User size={14} />
            担当者ビュー
          </button>
        </div>
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
          {viewMode === 'assignee' ? (
            /* ===== 担当者ビュー ===== */
            <div className="flex-1 min-w-0 space-y-4">
              <ChecklistPanel />
              <div className="flex gap-4 items-start">
              {/* 左: 担当者リスト */}
              <aside className="w-72 shrink-0 bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-3 border-b border-neutral-100">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="担当者を検索..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-lg focus:border-neutral-400 focus:outline-none"
                    />
                  </div>
                </div>
                <nav className="max-h-[calc(100vh-280px)] overflow-y-auto">
                  {assigneeList.length === 0 ? (
                    <p className="text-xs text-neutral-400 text-center py-6">担当者が見つかりません</p>
                  ) : (
                    assigneeList.map((email) => {
                      const cases = assigneeMap.get(email) ?? [];
                      const inProgress = cases.filter((c) => c.status === '進行中').length;
                      return (
                        <button
                          key={email}
                          onClick={() => setSelectedAssignee(email)}
                          className={`w-full text-left px-4 py-2.5 border-b border-neutral-50 hover:bg-neutral-50 transition-colors ${selectedAssignee === email ? 'bg-orange-50' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm truncate ${selectedAssignee === email ? 'text-orange-700 font-medium' : 'text-neutral-700'}`}>
                              {email.split('@')[0]}
                            </span>
                            <span className="text-[10px] text-neutral-400 shrink-0">{cases.length} 件</span>
                          </div>
                          {inProgress > 0 && (
                            <span className="text-[10px] text-blue-500 mt-0.5 block">{inProgress} 件進行中</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </nav>
              </aside>

              {/* 右: 担当者の案件一覧 */}
              <section className="flex-1 min-w-0">
                {!selectedAssignee ? (
                  <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-neutral-400 text-sm">
                    左のリストから担当者を選択してください
                  </div>
                ) : (
                  <AssigneePanel
                    email={selectedAssignee}
                    cases={selectedAssigneeCases}
                  />
                )}
              </section>
              </div>
            </div>
          ) : (
          /* ===== ツリービュー (既存) ===== */
          <>
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
                  新規案件追加
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
                          <Fragment key={c.id}>
                          <tr
                            className={`hover:bg-neutral-50/50 cursor-pointer ${expandedCaseId === c.id ? 'bg-neutral-50' : ''}`}
                            onClick={() => setExpandedCaseId(expandedCaseId === c.id ? null : c.id)}
                          >
                            <td className="px-4 py-2.5 font-medium text-neutral-800 max-w-[200px] truncate">
                              <ChevronRight size={12} className={`inline mr-1 transition-transform ${expandedCaseId === c.id ? 'rotate-90' : ''}`} />
                              {c.projectName}
                            </td>
                            <td className="px-3 py-2.5">{statusBadge(c.status)}</td>
                            <td className="px-3 py-2.5 text-neutral-600">{c.assignee ? c.assignee.split('@')[0] : '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.testTotalCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.bugCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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
                          {expandedCaseId === c.id && <CaseDetailRow c={c} colSpan={6} />}
                          </Fragment>
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
                memberOptions={memberOptions}
                saving={saving}
                error={formError}
                onSave={(fields) => handleUpdate(editingCase.id, fields)}
                onCancel={() => { setEditingCase(null); setFormError(null); }}
              />
            )}
          </section>
          </>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== 担当者パネル ===== */
function formatMonth(m: string) {
  if (m.length !== 6) return m;
  return `${m.slice(0, 4)}/${m.slice(4)}`;
}

interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  createdTime: string;
}

function ChecklistPanel() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/case-management/checklist');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/case-management/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setItems((prev) => [{ ...created, createdTime: new Date().toISOString() }, ...prev]);
      setNewTitle('');
      setAdding(false);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, done: boolean) => {
    setTogglingId(id);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, done } : it)));
    try {
      await fetch(`/api/case-management/checklist/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
    } catch {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, done: !done } : it)));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/case-management/checklist/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev);
    }
  };

  const pending = items.filter((it) => !it.done);
  const done = items.filter((it) => it.done);

  return (
    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-orange-500" />
          <span className="text-xs font-bold text-neutral-600">Checklist</span>
          {pending.length > 0 && (
            <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">{pending.length}</span>
          )}
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          {adding ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {adding && (
        <div className="px-4 py-2 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新しいタスクを入力..."
            className="flex-1 px-2.5 py-1 text-xs border border-neutral-200 rounded-lg focus:border-neutral-400 focus:outline-none bg-white"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newTitle.trim()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-neutral-900 text-white font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            追加
          </button>
        </div>
      )}

      {loading ? (
        <div className="px-4 py-4 text-center text-neutral-400 text-xs">
          <Loader2 size={14} className="animate-spin inline mr-1" />読み込み中...
        </div>
      ) : items.length === 0 && !adding ? (
        <div className="px-4 py-3 text-center text-neutral-400 text-xs">
          タスクがありません。+ ボタンで追加できます
        </div>
      ) : (
        <div className="divide-y divide-neutral-50">
          {pending.map((it) => (
            <div key={it.id} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-neutral-50/50">
              <button
                onClick={() => handleToggle(it.id, true)}
                disabled={togglingId === it.id}
                className="w-4 h-4 shrink-0 rounded border border-neutral-300 hover:border-orange-400 flex items-center justify-center transition-colors"
              >
                {togglingId === it.id && <Loader2 size={10} className="animate-spin text-neutral-400" />}
              </button>
              <span className="flex-1 text-xs text-neutral-700 min-w-0 truncate">{it.title}</span>
              <button
                onClick={() => handleDelete(it.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-neutral-300 hover:text-red-400 transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {done.map((it) => (
            <div key={it.id} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-neutral-50/50">
              <button
                onClick={() => handleToggle(it.id, false)}
                disabled={togglingId === it.id}
                className="w-4 h-4 shrink-0 rounded border border-emerald-400 bg-emerald-400 flex items-center justify-center transition-colors"
              >
                {togglingId === it.id ? <Loader2 size={10} className="animate-spin text-white" /> : <Check size={10} className="text-white" />}
              </button>
              <span className="flex-1 text-xs text-neutral-400 line-through min-w-0 truncate">{it.title}</span>
              <button
                onClick={() => handleDelete(it.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-neutral-300 hover:text-red-400 transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssigneePanel({ email, cases }: {
  email: string;
  cases: (ChildCase & { parentName: string; parentSystem: string; parentMonth: string })[];
}) {
  const [monthFilter, setMonthFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allMonths = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) if (c.parentMonth) set.add(c.parentMonth);
    return Array.from(set).sort().reverse();
  }, [cases]);

  const filtered = useMemo(() => {
    if (!monthFilter) return cases;
    return cases.filter((c) => c.parentMonth === monthFilter);
  }, [cases, monthFilter]);

  const statusCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of filtered) {
      const s = c.status || '未設定';
      map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    let testTotal = 0;
    let bugTotal = 0;
    let estTotal = 0;
    let actTotal = 0;
    for (const c of filtered) {
      testTotal += Number(c.testTotalCount) || 0;
      bugTotal += Number(c.bugCount) || 0;
      estTotal += Number(c.estimateTotal) || 0;
      actTotal += Number(c.actualTotal) || 0;
    }
    return { testTotal, bugTotal, estTotal: round2(estTotal), actTotal: round2(actTotal) };
  }, [filtered]);

  const byMonth = useMemo(() => {
    const map = new Map<string, typeof cases>();
    for (const c of filtered) {
      const m = c.parentMonth || '000000';
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(c);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  useEffect(() => { setMonthFilter(''); setExpandedId(null); }, [email]);

  return (
    <div className="space-y-4">
      {/* ヘッダー＋サマリ */}
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-neutral-800">{email}</h3>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-2.5 py-1 text-xs border border-neutral-200 rounded-lg focus:border-neutral-400 focus:outline-none bg-white"
          >
            <option value="">全期間</option>
            {allMonths.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="担当案件数" value={filtered.length} />
          <StatCard label="テスト総件数" value={totals.testTotal} />
          <StatCard label="NG数" value={totals.bugTotal} accent={totals.bugTotal > 0 ? 'red' : undefined} />
          <StatCard label="工数（見積/実績）" value={`${totals.estTotal} / ${totals.actTotal}`} />
        </div>
        {Object.keys(statusCount).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(statusCount).map(([status, count]) => (
              <span key={status} className="inline-flex items-center gap-1">
                {statusBadge(status)}
                <span className="text-[11px] text-neutral-500 tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 月別案件リスト（新しい順） */}
      {byMonth.map(([month, monthCases]) => (
        <div key={month} className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-neutral-100 bg-neutral-50/50">
            <span className="text-xs font-bold text-neutral-500">{formatMonth(month)}</span>
            <span className="text-[10px] text-neutral-400 ml-2">{monthCases.length} 件</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-[11px] text-neutral-400 font-medium">
                  <th className="text-left px-4 py-2">案件名</th>
                  <th className="text-left px-3 py-2">システム</th>
                  <th className="text-left px-3 py-2">状態</th>
                  <th className="text-right px-3 py-2">テスト件数</th>
                  <th className="text-right px-3 py-2">NG数</th>
                  <th className="text-left px-3 py-2">TC開始</th>
                  <th className="text-left px-3 py-2">実施完了</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {monthCases.map((c) => (
                  <Fragment key={c.id}>
                  <tr
                    className={`hover:bg-neutral-50/50 cursor-pointer ${expandedId === c.id ? 'bg-neutral-50' : ''}`}
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <td className="px-4 py-2.5 font-medium text-neutral-800 max-w-[180px] truncate">
                      <ChevronRight size={12} className={`inline mr-1 transition-transform ${expandedId === c.id ? 'rotate-90' : ''}`} />
                      {c.projectName}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500 text-xs">{c.parentSystem}</td>
                    <td className="px-3 py-2.5">{statusBadge(c.status)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.testTotalCount || '-'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.bugCount || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-neutral-500">
                      {c.actualStartDate ? <><span className="text-neutral-800">{c.actualStartDate}</span></> : c.tcStartDate ? <><span className="text-neutral-400">{c.tcStartDate}</span> <span className="text-[9px] text-neutral-300">予</span></> : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-neutral-500">
                      {c.actualExecutionCompleteDate ? <><span className="text-neutral-800">{c.actualExecutionCompleteDate}</span></> : c.tcExecutionCompleteDate ? <><span className="text-neutral-400">{c.tcExecutionCompleteDate}</span> <span className="text-[9px] text-neutral-300">予</span></> : '-'}
                    </td>
                  </tr>
                  {expandedId === c.id && <CaseDetailRow c={c} colSpan={7} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function round2(n: number): string {
  return n === 0 ? '0' : (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: 'red' }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-3">
      <p className="text-[11px] text-neutral-500 mb-0.5">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${accent === 'red' ? 'text-red-600' : 'text-neutral-800'}`}>{value}</p>
    </div>
  );
}

function CaseDetailRow({ c, colSpan }: { c: ChildCase; colSpan: number }) {
  const schedule = [
    { label: 'TC開始', planned: c.tcStartDate, actual: c.actualStartDate },
    { label: '設計書完了', planned: c.tcDesignCompleteDate, actual: c.actualDesignCompleteDate },
    { label: '実施完了', planned: c.tcExecutionCompleteDate, actual: c.actualExecutionCompleteDate },
  ];
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-3 bg-neutral-50/80">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* スケジュール */}
          <div>
            <p className="font-bold text-neutral-600 mb-1.5">スケジュール</p>
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-neutral-400">
                  <th className="text-left pb-1 font-medium"></th>
                  <th className="text-left pb-1 font-medium">予定日</th>
                  <th className="text-left pb-1 font-medium">実績日</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.label}>
                    <td className="py-0.5 text-neutral-500 pr-3">{s.label}</td>
                    <td className="py-0.5 text-neutral-700 tabular-nums pr-3">{s.planned || '-'}</td>
                    <td className={`py-0.5 tabular-nums ${s.actual ? 'text-neutral-800 font-medium' : 'text-neutral-400'}`}>{s.actual || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 工数・テスト */}
          <div>
            <p className="font-bold text-neutral-600 mb-1.5">工数 / テスト</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-neutral-500">見積総工数</span>
              <span className="text-neutral-800 tabular-nums">{c.estimateTotal || '-'}</span>
              <span className="text-neutral-500">実績総工数</span>
              <span className="text-neutral-800 tabular-nums">{c.actualTotal || '-'}</span>
              <span className="text-neutral-500">テスト件数</span>
              <span className="text-neutral-800 tabular-nums">{c.testTotalCount || '-'}</span>
              <span className="text-neutral-500">NG数</span>
              <span className={`tabular-nums ${Number(c.bugCount) > 0 ? 'text-red-600 font-medium' : 'text-neutral-800'}`}>{c.bugCount || '-'}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
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
      <div>
        <input
          type="text"
          list="system-options-list"
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          placeholder="System を選択 or 入力..."
          className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white"
        />
        <datalist id="system-options-list">
          {systemOptions.map((o) => <option key={o} value={o} />)}
        </datalist>
      </div>
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

function EditPanel({ item, statusOptions, memberOptions, saving, error, onSave, onCancel }: {
  item: ChildCase;
  statusOptions: string[];
  memberOptions: string[];
  saving: boolean;
  error: string | null;
  onSave: (fields: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const f of ALL_EDIT_FIELDS) d[f.key] = (item as any)[f.key] ?? '';
    return d;
  });

  useEffect(() => {
    const d: Record<string, string> = {};
    for (const f of ALL_EDIT_FIELDS) d[f.key] = (item as any)[f.key] ?? '';
    setDraft(d);
  }, [item]);

  const changed = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const f of ALL_EDIT_FIELDS) {
      if (draft[f.key] !== ((item as any)[f.key] ?? '')) diff[f.key] = draft[f.key];
    }
    return diff;
  }, [draft, item]);

  const set = (key: string, value: string) => setDraft((p) => ({ ...p, [key]: value }));

  const toggleMulti = (key: string, member: string) => {
    const current = draft[key].split(',').map((s) => s.trim()).filter(Boolean);
    const next = current.includes(member)
      ? current.filter((m) => m !== member)
      : [...current, member];
    set(key, next.join(', '));
  };

  const renderField = (f: FieldDef) => (
    <div key={f.key} className={f.span || f.type === 'multiselect' ? 'md:col-span-2' : ''}>
      <label className="block text-[11px] font-medium text-neutral-500 mb-1">{f.label}</label>
      {f.type === 'select' ? (
        <select
          value={draft[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white"
        >
          <option value="">-</option>
          {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === 'multiselect' ? (
        <div className="flex flex-wrap gap-2 p-2 border border-neutral-300 rounded-lg bg-white min-h-[36px]">
          {memberOptions.map((m) => {
            const selected = draft[f.key].split(',').map((s) => s.trim()).includes(m);
            return (
              <label key={m} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                selected ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMulti(f.key, m)}
                  className="sr-only"
                />
                {m}
              </label>
            );
          })}
          {memberOptions.length === 0 && <span className="text-xs text-neutral-400">メンバー未取得</span>}
        </div>
      ) : (
        <input
          type={f.type === 'number' ? 'text' : f.type}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          value={draft[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none"
        />
      )}
    </div>
  );

  const sectionCls = 'space-y-2';
  const headingCls = 'text-xs font-bold text-neutral-600 border-b border-neutral-100 pb-1';

  return (
    <div className="mt-4 bg-white border border-neutral-200 rounded-xl shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-neutral-800">案件編集</h4>
        <button onClick={onCancel} className="p-1 rounded hover:bg-neutral-100 text-neutral-400">
          <X size={16} />
        </button>
      </div>

      <div className={sectionCls}>
        <h5 className={headingCls}>スケジュール</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{SCHEDULE_FIELDS.map(renderField)}</div>
      </div>

      <div className={sectionCls}>
        <h5 className={headingCls}>工数</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{EFFORT_FIELDS.map(renderField)}</div>
      </div>

      <div className={sectionCls}>
        <h5 className={headingCls}>テスト結果</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{TEST_FIELDS.map(renderField)}</div>
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
