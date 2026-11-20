import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSubRoute } from '../hooks/useSubRoute';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderTree,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import {
  NoteBadges,
  NoteCategoryDialog,
  NoteHoverButtons,
  PendingNoteRow,
  useNoteCounts,
} from './shared/NoteWidgets';
import type { EntityNote } from './shared/NoteWidgets';

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
  '未開始': 'bg-neutral-100 text-neutral-600',
  '進行中': 'bg-blue-50 text-blue-700',
  '予定通り完了': 'bg-emerald-50 text-emerald-700',
  '遅延完了': 'bg-amber-50 text-amber-700',
  'ブロック': 'bg-red-50 text-red-700',
};

// BUG一覧のシステム選択肢もこの除外に合わせる
export const EXCLUDED_SYSTEMS = new Set(['改善対応', '管理作業', '全体システム', '月次改善タスク']);

/* ===== リマインド (常時表示) と進捗マトリクス (親案件・担当者が未選択のときに表示) の判定ルール ===== */
// Notion の「状態」は空にならず既定が未開始。空で返った場合も未開始として扱う
const DEFAULT_STATUS = '未開始';
const STOPPED_STATUS = '停止中';
const DESIGN_STATUS = '設計書作成中';
// Notion の status プロパティのグループ名 (/api/case-management/status-options の groups)
const STATUS_GROUP_COMPLETE = 'Complete';
// 進捗マトリクスの列 (作業フロー順)。ここに無い状態 (レビュー中・進行中・遅延中 等) は表示しない
const PROGRESS_COLUMNS: { label: string; statuses: string[]; tint: string }[] = [
  { label: '未開始', statuses: ['未開始'], tint: 'bg-neutral-50' },
  { label: 'スケジュール確認中', statuses: ['スケジュール確認中'], tint: 'bg-neutral-50' },
  { label: '設計書作成中', statuses: ['設計書作成中'], tint: 'bg-blue-50/60' },
  { label: '実装実施中', statuses: ['実装実施中'], tint: 'bg-blue-50/60' },
  { label: '完了', statuses: ['予定通り完了', '遅延完了', '停止中', 'テスト実施不要'], tint: 'bg-emerald-50/60' },
  { label: '追加テスト', statuses: ['追加テスト'], tint: 'bg-amber-50/60' },
  { label: '再テスト', statuses: ['再テスト'], tint: 'bg-amber-50/60' },
];
// 状態 → 期限判定に使う予定日。ここに無い状態は期限判定しない
const DEADLINE_FIELD_BY_STATUS: Record<string, 'tcDesignCompleteDate' | 'tcExecutionCompleteDate'> = {
  '設計書作成中': 'tcDesignCompleteDate',
  '実装実施中': 'tcExecutionCompleteDate',
  '進行中': 'tcExecutionCompleteDate',
  '遅延中': 'tcExecutionCompleteDate',
};
const DEADLINE_FIELD_LABEL: Record<string, string> = {
  tcDesignCompleteDate: 'TC設計書完了予定日',
  tcExecutionCompleteDate: 'TC実施完了予定日',
};
// 予定日の何日前から期限間近とするか
const NEAR_DEADLINE_DAYS = 2;
// 空なら未記入 (0 は記入済み)
const ESTIMATE_KEYS = ['designEstimate', 'implementationEstimate', 'executionEstimate', 'reviewEstimate'] as const;
const ACTUAL_KEYS = ['designActual', 'implActual', 'execActual', 'reviewActual'] as const;
const TEST_RESULT_KEYS = ['testTotalCount', 'bugCount', 'testBlockedCount', 'pendingConfirmCount', 'unexpectedNgCount'] as const;
// 実績・テスト結果の記入を求める状態 (この2つは対象月フィルタに従う)
const RESULT_REQUIRED_STATUSES = new Set(['予定通り完了', '遅延完了']);
// キーボード操作時のフォーカス表示 (全体サマリー・案件一覧ポップアップ共通)
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const SUMMARY_MONTH_UPCOMING = 'upcoming';
const SUMMARY_MONTH_ALL = 'all';
const UNASSIGNED_LABEL = '未決定';

type SummaryCase = ChildCase & { parentName: string; parentSystem: string; parentMonth: string; monthKey: number; normStatus: string };
type SummaryPopup = { title: string; ids: string[] };

function parseMonthKey(p: { month: string; projectName: string }): number {
  const src = p.month || p.projectName;
  // "2025年10月" or "2025/10" or "2025-10"
  const m1 = src.match(/(\d{4})\D+(\d{1,2})/);
  if (m1) return parseInt(m1[1], 10) * 100 + parseInt(m1[2], 10);
  // "202510" (6-digit YYYYMM embedded anywhere)
  const m2 = src.match(/(\d{4})(\d{2})/);
  if (m2) return parseInt(m2[1], 10) * 100 + parseInt(m2[2], 10);
  return 0;
}

/* ===== 案件編集ダイアログの項目 ===== */
// キー＝ChildCase のフィールド、値＝表示ラベル (入力欄の aria-label にも使う)
// 見積総・実績総は Notion の数式 (4項目の合計) のため編集対象にしない
const EDIT_LABELS: Record<string, string> = {
  projectName: '案件名',
  status: '状態',
  assignee: '担当者',
  manager: '管理者',
  tcStartDate: 'TC開始予定日',
  actualStartDate: '実際開始日',
  tcDesignCompleteDate: 'TC設計書完了予定日',
  actualDesignCompleteDate: '実際設計書完了日',
  tcExecutionCompleteDate: 'TC実施完了予定日',
  actualExecutionCompleteDate: '実際実施完了日',
  releaseDate: '本番日',
  verificationDate: '検証日',
  desiredCompleteDate: '完了希望日',
  designEstimate: '工数見積(設計書)',
  designActual: '工数実績(設計書)',
  implementationEstimate: '工数見積(実装)',
  implActual: '工数実績(実装)',
  executionEstimate: '工数見積(実施)',
  execActual: '工数実績(実施)',
  reviewEstimate: 'Review見積工数',
  reviewActual: 'Review実績工数',
  developmentEffort: '開発工数',
  testTotalCount: 'Test総件数',
  bugCount: 'NG数',
  testBlockedCount: 'Test不可',
  pendingConfirmCount: '確認中件数',
  unexpectedNgCount: '想定外NG数',
  japanCaseCount: '日本側case数',
  japanBugCount: '日本側NG数',
  comment: 'コメント',
};
const ALL_EDIT_KEYS = Object.keys(EDIT_LABELS);
// スケジュール: 段階ごとに予定と実際を並べる
const EDIT_SCHEDULE_ROWS = [
  { label: '開始', plan: 'tcStartDate', actual: 'actualStartDate' },
  { label: '設計書完了', plan: 'tcDesignCompleteDate', actual: 'actualDesignCompleteDate' },
  { label: '実施完了', plan: 'tcExecutionCompleteDate', actual: 'actualExecutionCompleteDate' },
];
const EDIT_MILESTONE_KEYS = ['releaseDate', 'verificationDate', 'desiredCompleteDate'];
// 工数: 工程ごとに見積と実績を並べる
const EDIT_EFFORT_COLS = [
  { label: '設計書', estimate: 'designEstimate', actual: 'designActual' },
  { label: '実装', estimate: 'implementationEstimate', actual: 'implActual' },
  { label: '実施', estimate: 'executionEstimate', actual: 'execActual' },
  { label: 'Review', estimate: 'reviewEstimate', actual: 'reviewActual' },
];
const EDIT_TEST_KEYS = ['testTotalCount', 'bugCount', 'testBlockedCount', 'pendingConfirmCount', 'unexpectedNgCount', 'japanCaseCount', 'japanBugCount'];

function statusBadge(status: string) {
  const cls = STATUS_COLOR[status.trim()] ?? 'bg-neutral-100 text-neutral-600';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status || '-'}</span>;
}

export default function CaseManagement({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (view: string) => void }) {
  const [tree, setTree] = useState<ParentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [statusGroups, setStatusGroups] = useState<Record<string, string[]>>({});
  const [systemOptions, setSystemOptions] = useState<string[]>([]);

  const [subRoute, setSubRoute] = useSubRoute();
  const viewMode: 'tree' | 'assignee' = subRoute[0] === 'assignee' ? 'assignee' : 'tree';
  const setViewMode = (m: 'tree' | 'assignee') => setSubRoute(m === 'tree' ? [] : [m]);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [memberOptions, setMemberOptions] = useState<string[]>([]);

  // ノート
  const { counts: noteCounts, reloadCounts: reloadNoteCountsBase } = useNoteCounts();
  const [pendingNoteCounts, setPendingNoteCounts] = useState<Record<string, number>>({});
  const [aiPendingCounts, setAiPendingCounts] = useState<Record<string, number>>({});
  const loadPendingNoteCounts = useCallback(() => {
    fetch('/api/notes/by-assignee')
      .then((r) => r.json())
      .then((d) => {
        const counts: Record<string, number> = {};
        for (const [email, notes] of Object.entries(d.byAssignee ?? {})) {
          counts[email] = (notes as any[]).length;
        }
        setPendingNoteCounts(counts);
      })
      .catch(() => {});
  }, []);
  const loadAiPendingCounts = useCallback(() => {
    fetch('/api/stats/needs')
      .then((r) => r.json())
      .then((data) => {
        const counts: Record<string, number> = {};
        for (const it of (data.items ?? [])) {
          if (!(it.category ?? '').includes('AI') || it.status === '対応済' || it.status === '中止') continue;
          const a = it.assignee ?? '';
          if (a) counts[a] = (counts[a] ?? 0) + 1;
        }
        setAiPendingCounts(counts);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { loadPendingNoteCounts(); loadAiPendingCounts(); }, [loadPendingNoteCounts, loadAiPendingCounts]);
  const reloadCounts = useCallback(() => {
    reloadNoteCountsBase();
    loadPendingNoteCounts();
    loadAiPendingCounts();
  }, [reloadNoteCountsBase, loadPendingNoteCounts, loadAiPendingCounts]);

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
      .then((d) => { setStatusOptions(d.options ?? []); setStatusGroups(d.groups ?? {}); })
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
      if (EXCLUDED_SYSTEMS.has(sys)) continue;
      if (!map.has(sys)) map.set(sys, []);
      map.get(sys)!.push(p);
    }
    return Array.from(map.entries()).map(([system, parents]) => ({
      system,
      parents: parents.sort((a, b) => parseMonthKey(b) - parseMonthKey(a)),
    }));
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

  // 全体サマリー用: 除外システム以外の全子案件 (月は親案件の month で判定)
  const [summaryMonth, setSummaryMonth] = useState<string>(SUMMARY_MONTH_UPCOMING);
  const [summaryPopup, setSummaryPopup] = useState<SummaryPopup | null>(null);
  const summaryCases = useMemo<SummaryCase[]>(() => {
    const list: SummaryCase[] = [];
    for (const parent of tree) {
      const system = parent.system || '(未設定)';
      if (EXCLUDED_SYSTEMS.has(system)) continue;
      const monthKey = parseMonthKey(parent);
      for (const child of parent.children) {
        list.push({
          ...child,
          parentName: parent.projectName,
          parentSystem: system,
          parentMonth: parent.month,
          monthKey,
          normStatus: (child.status ?? '').trim() || DEFAULT_STATUS,
        });
      }
    }
    return list;
  }, [tree]);
  // ポップアップは開いた時点の案件IDを保持し、保存後は最新の値で表示する (状態を変えても行が消えないように)
  const summaryPopupCases = useMemo(() => {
    if (!summaryPopup) return [];
    const byId = new Map(summaryCases.map((c) => [c.id, c]));
    return summaryPopup.ids.map((id) => byId.get(id)).filter((c): c is SummaryCase => !!c);
  }, [summaryPopup, summaryCases]);

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
      if (!systemOptions.includes(system)) {
        setSystemOptions((prev) => [...prev, system]);
      }
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
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">ホーム</button>
        <span className="text-neutral-400">{'>>'}</span>
        <button type="button" onClick={() => { setViewMode('tree'); setSelectedAssignee(null); setSelectedParentId(null); setEditingCase(null); }} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">案件管理</button>
        <span className="text-neutral-400">{'>>'}</span>
        <span className="text-neutral-900 font-medium">{viewMode === 'tree' ? 'ツリー' : '担当者'}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-3">
        <FolderTree size={22} className="text-orange-600" />
        <h2 className="text-xl font-bold">案件管理</h2>
        <div className="ml-auto flex items-center bg-neutral-100 rounded-lg p-0.5">
          <button
            onClick={() => { setViewMode('tree'); setSelectedAssignee(null); setSelectedParentId(null); setEditingCase(null); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'tree' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            <FolderTree size={14} />
            案件ツリー
          </button>
          <button
            onClick={() => { setViewMode('assignee'); setSelectedParentId(null); setSelectedAssignee(null); setEditingCase(null); }}
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

      {/* リマインド (両ビュー共通・常時表示)。初回読み込み中だけ隠し、保存後の再読み込みではレイアウトを動かさない */}
      {(!loading || tree.length > 0) && (
        <ReminderPanel cases={summaryCases} statusGroups={statusGroups} month={summaryMonth} onOpen={setSummaryPopup} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          読み込み中...
        </div>
      ) : (
        // 進捗マトリクス表示中は左右のカードの高さを揃える
        <div className={`flex gap-4 ${viewMode === 'tree' && !selectedParent ? 'items-stretch' : 'items-start'}`}>
          {viewMode === 'assignee' ? (
            /* ===== 担当者ビュー ===== */
            <div className="flex-1 min-w-0 space-y-4">
              <ChecklistPanel />
              <div className={`flex gap-4 ${!selectedAssignee ? 'items-stretch' : 'items-start'}`}>
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
                            <span className="flex items-center gap-1.5 shrink-0">
                              {((pendingNoteCounts[email] ?? 0) + (aiPendingCounts[email] ?? 0)) > 0 && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5" title="未処理の指摘・QA・追加説明・AI">
                                  <AlertCircle size={10} />{(pendingNoteCounts[email] ?? 0) + (aiPendingCounts[email] ?? 0)}
                                </span>
                              )}
                              <span className="text-[10px] text-neutral-400">{cases.length} 件</span>
                            </span>
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
                  <ProgressMatrix
                    mode="assignee"
                    cases={summaryCases}
                    month={summaryMonth}
                    onMonthChange={setSummaryMonth}
                    onOpen={setSummaryPopup}
                  />
                ) : (
                  <AssigneePanel
                    email={selectedAssignee}
                    cases={selectedAssigneeCases}
                    memberOptions={memberOptions}
                    noteCounts={noteCounts}
                    onNoteCountChange={reloadCounts}
                    onNavigate={onNavigate}
                    onEdit={(c) => { setEditingCase(c); setFormError(null); }}
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
                            <span className="flex items-center gap-1 shrink-0">
                              {(() => {
                                const total = p.children.reduce((sum, c) => {
                                  const nc = noteCounts[c.id];
                                  return sum + (nc ? nc.qa + nc.note + nc.issue : 0);
                                }, 0);
                                return total > 0 ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5">
                                    <AlertCircle size={10} />{total}
                                  </span>
                                ) : null;
                              })()}
                              <span className="text-[10px] text-neutral-400">{p.childCount}</span>
                            </span>
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
                  親案件追加
                </button>
              )}
            </div>
          </aside>

          {/* 右: 案件リスト */}
          <section className="flex-1 min-w-0">
            {!selectedParent ? (
              <ProgressMatrix
                mode="tree"
                cases={summaryCases}
                month={summaryMonth}
                onMonthChange={setSummaryMonth}
                onOpen={setSummaryPopup}
              />
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
                        selectedParent.children.map((c) => {
                          const nc = noteCounts[c.id];
                          return (
                          <Fragment key={c.id}>
                          <tr
                            className={`group/row hover:bg-neutral-50/50 cursor-pointer ${expandedCaseId === c.id ? 'bg-neutral-50' : ''}`}
                            onClick={() => setExpandedCaseId(expandedCaseId === c.id ? null : c.id)}
                          >
                            <td className="px-4 py-2.5 font-medium text-neutral-800 max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                <ChevronRight size={12} className={`shrink-0 transition-transform ${expandedCaseId === c.id ? 'rotate-90' : ''}`} />
                                <span className="truncate" title={c.projectName}>{c.projectName}</span>
                                {nc && <NoteBadges entityId={c.id} counts={nc} memberOptions={memberOptions} onCountChange={reloadCounts} editable />}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">{statusBadge(c.status)}</td>
                            <td className="px-3 py-2.5 text-neutral-600">{c.assignee ? c.assignee.split('@')[0] : '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.testTotalCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{c.bugCount || '-'}</td>
                            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <NoteHoverButtons
                                  entityId={c.id}
                                  entityType="case"
                                  memberOptions={memberOptions}
                                  onNoteCreated={reloadCounts}
                                />
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
                          {expandedCaseId === c.id && <CaseDetailRow c={c} colSpan={6} memberOptions={memberOptions} />}
                          </Fragment>
                          );
                        })
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
          </section>
          </>
          )}
        </div>
      )}

      {/* 全体サマリーの案件一覧ポップアップ (編集ダイアログより先に描画し、編集ダイアログを上に重ねる) */}
      {summaryPopup && (
        <SummaryCaseDialog
          title={summaryPopup.title}
          cases={summaryPopupCases}
          statusOptions={statusOptions}
          saving={saving}
          error={editingCase ? null : formError}
          active={!editingCase}
          onStatusChange={(id, status) => handleUpdate(id, { status })}
          onEdit={(c) => { setEditingCase(c); setFormError(null); }}
          onClose={() => { setSummaryPopup(null); setFormError(null); }}
        />
      )}

      {/* 編集ダイアログ (ツリー・担当者ビュー共通) */}
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

function AssigneePanel({ email, cases, memberOptions, noteCounts, onNoteCountChange, onNavigate, onEdit }: {
  email: string;
  cases: (ChildCase & { parentName: string; parentSystem: string; parentMonth: string })[];
  memberOptions: string[];
  noteCounts: Record<string, { qa: number; note: number; issue: number }>;
  onNoteCountChange: () => void;
  onNavigate?: (view: string) => void;
  onEdit: (c: ChildCase) => void;
}) {
  const [monthFilter, setMonthFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDialogCaseId, setNoteDialogCaseId] = useState<string | null>(null);
  const [pendingNotes, setPendingNotes] = useState<EntityNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesKey, setNotesKey] = useState(0);
  const [aiItems, setAiItems] = useState<{ id: string; title: string; status: string; assignee: string; createdTime: string }[]>([]);
  const [aiToggling, setAiToggling] = useState<Set<string>>(new Set());
  const [aiExpandedId, setAiExpandedId] = useState<string | null>(null);
  const [aiChildrenHtml, setAiChildrenHtml] = useState<Record<string, string>>({});
  const [aiChildrenLoading, setAiChildrenLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stats/needs')
      .then((r) => r.json())
      .then((data) => {
        const items = (data.items ?? []).filter((it: any) => (it.category ?? '').includes('AI'));
        setAiItems(items.map((it: any) => ({ id: it.id, title: it.title, status: it.status, assignee: it.assignee ?? '', createdTime: it.createdTime ?? '' })));
      })
      .catch(() => {});
  }, []);

  const toggleAiItem = useCallback((id: string, currentDone: boolean) => {
    setAiToggling((s) => new Set(s).add(id));
    fetch(`/api/stats/needs/${id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: currentDone ? '新' : '対応済' }),
    })
      .then((r) => r.json())
      .then((updated) => {
        setAiItems((prev) => prev.map((it) => it.id === id ? { ...it, status: updated.status ?? (currentDone ? '新' : '対応済') } : it));
      })
      .catch(() => {})
      .finally(() => setAiToggling((s) => { const n = new Set(s); n.delete(id); return n; }));
  }, []);

  const handleAiExpand = useCallback((id: string) => {
    setAiExpandedId((prev) => prev === id ? null : id);
    if (!aiChildrenHtml[id] && aiChildrenLoading !== id) {
      setAiChildrenLoading(id);
      fetch(`/api/stats/needs/${id}/children`)
        .then((r) => r.json())
        .then((d) => setAiChildrenHtml((prev) => ({ ...prev, [id]: d.html ?? '' })))
        .catch(() => setAiChildrenHtml((prev) => ({ ...prev, [id]: '' })))
        .finally(() => setAiChildrenLoading(null));
    }
  }, [aiChildrenHtml, aiChildrenLoading]);

  const myAiItems = useMemo(() => {
    const mine = aiItems.filter((it) => it.assignee === email && it.status !== '対応済' && it.status !== '中止');
    mine.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    return mine.slice(0, 3);
  }, [aiItems, email]);

  const myAiTotalPending = useMemo(() => aiItems.filter((it) => it.assignee === email && it.status !== '対応済' && it.status !== '中止').length, [aiItems, email]);

  useEffect(() => {
    let cancelled = false;
    setNotesLoading(true);
    fetch('/api/notes/by-assignee')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const mine: EntityNote[] = data.byAssignee?.[email] ?? [];
        setPendingNotes(mine.filter((n) => n.status !== '対応済' && n.status !== '中止'));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNotesLoading(false); });
    return () => { cancelled = true; };
  }, [email, notesKey]);

  const pendingQA = useMemo(() => pendingNotes.filter((n) => n.category === 'QA'), [pendingNotes]);
  const pendingIssues = useMemo(() => pendingNotes.filter((n) => n.category === '指摘'), [pendingNotes]);
  const pendingExplanations = useMemo(() => pendingNotes.filter((n) => n.category === '追加説明'), [pendingNotes]);

  const allMonths = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) if (c.parentMonth) set.add(c.parentMonth);
    return Array.from(set).sort().reverse();
  }, [cases]);

  const filtered = useMemo(() => {
    if (!monthFilter) return cases;
    return cases.filter((c) => c.parentMonth === monthFilter);
  }, [cases, monthFilter]);

  const STATUS_ORDER = ['予定通り完了', '遅延完了', '進行中', '未開始'] as const;

  const statusCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of filtered) {
      const s = c.status || '未設定';
      map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  }, [filtered]);

  const nearDeadlineCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let count = 0;
    for (const c of filtered) {
      if (c.status === '予定通り完了' || c.status === '遅延完了') continue;
      const dateStr = c.tcExecutionCompleteDate;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      d.setHours(0, 0, 0, 0);
      if (d <= tomorrow && d >= today) count++;
    }
    return count;
  }, [filtered]);

  const totals = useMemo(() => {
    let estTotal = 0;
    let actTotal = 0;
    for (const c of filtered) {
      estTotal += Number(c.estimateTotal) || 0;
      actTotal += Number(c.actualTotal) || 0;
    }
    return { estTotal: round2(estTotal), actTotal: round2(actTotal) };
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="担当案件数" value={filtered.length} />
          <StatCard label="期限間近" value={nearDeadlineCount} accent={nearDeadlineCount > 0 ? 'amber' : undefined} />
          <StatCard label="QA確認待" value={pendingQA.length} accent={pendingQA.length > 0 ? 'green' : undefined} />
          <StatCard label="指摘確認待" value={pendingIssues.length} accent={pendingIssues.length > 0 ? 'amber' : undefined} />
          <StatCard label="工数（見積/実績）" value={`${totals.estTotal} / ${totals.actTotal}`} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {STATUS_ORDER.map((status) => (
            <span key={status} className="inline-flex items-center gap-1">
              {statusBadge(status)}
              <span className="text-[11px] text-neutral-500 tabular-nums">{statusCount[status] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 指摘セクション */}
      <div className="bg-white border border-orange-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-orange-100 bg-orange-50/60 flex items-center gap-2">
          <TriangleAlert size={13} className="text-orange-500" />
          <span className="text-xs font-bold text-orange-700">指摘</span>
          <span className="text-[10px] text-orange-500 ml-1">{pendingIssues.length} 件</span>
        </div>
        {notesLoading ? (
          <div className="text-xs text-neutral-400 text-center py-4">読み込み中...</div>
        ) : pendingIssues.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-4">未処理の指摘はありません</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {pendingIssues.map((note) => (
              <PendingNoteRow key={note.id} note={note} memberOptions={memberOptions} onUpdated={() => setNotesKey((k) => k + 1)} />
            ))}
          </div>
        )}
      </div>

      {/* QAセクション */}
      <div className="bg-white border border-emerald-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-emerald-100 bg-emerald-50/60 flex items-center gap-2">
          <MessageCircle size={13} className="text-emerald-500" />
          <span className="text-xs font-bold text-emerald-700">QA</span>
          <span className="text-[10px] text-emerald-500 ml-1">{pendingQA.length} 件</span>
        </div>
        {notesLoading ? (
          <div className="text-xs text-neutral-400 text-center py-4">読み込み中...</div>
        ) : pendingQA.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-4">未処理のQAはありません</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {pendingQA.map((note) => (
              <PendingNoteRow key={note.id} note={note} memberOptions={memberOptions} onUpdated={() => setNotesKey((k) => k + 1)} />
            ))}
          </div>
        )}
      </div>

      {/* 追加説明セクション */}
      <div className="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-blue-100 bg-blue-50/60 flex items-center gap-2">
          <FileText size={13} className="text-blue-500" />
          <span className="text-xs font-bold text-blue-700">追加説明</span>
          <span className="text-[10px] text-blue-500 ml-1">{pendingExplanations.length} 件</span>
        </div>
        {notesLoading ? (
          <div className="text-xs text-neutral-400 text-center py-4">読み込み中...</div>
        ) : pendingExplanations.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-4">未読の追加説明はありません</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {pendingExplanations.map((note) => (
              <PendingNoteRow key={note.id} note={note} memberOptions={memberOptions} onUpdated={() => setNotesKey((k) => k + 1)} />
            ))}
          </div>
        )}
      </div>

      {myAiItems.length > 0 && (
        <div className="bg-white border border-violet-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-violet-100 bg-violet-50/60 flex items-center gap-2">
            <Check size={13} className="text-violet-500" />
            <span className="text-xs font-bold text-violet-700">AI チェックリスト</span>
            <span className="text-[10px] text-violet-500 ml-1">未完了 {myAiTotalPending}件</span>
          </div>
          <div className="divide-y divide-neutral-100">
            {myAiItems.map((it) => {
              const expanded = aiExpandedId === it.id;
              const toggling = aiToggling.has(it.id);
              return (
                <div key={it.id} className="px-4 py-3">
                  <div className="flex items-start gap-2 cursor-pointer" onClick={() => handleAiExpand(it.id)}>
                    {expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-violet-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-violet-400" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-neutral-800">{it.title}</span>
                        {it.status && it.status !== '新' && (
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            it.status === '確認中' ? 'bg-violet-50 text-violet-700' :
                            it.status === '計画済' ? 'bg-amber-50 text-amber-700' :
                            it.status === '進行中' ? 'bg-orange-50 text-orange-700' :
                            it.status === '対応済' ? 'bg-emerald-50 text-emerald-700' :
                            it.status === '中止' ? 'bg-neutral-100 text-neutral-500' :
                            'bg-blue-50 text-blue-700'
                          }`}>{it.status}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-400 mt-0.5">{it.createdTime?.slice(0, 10)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => toggleAiItem(it.id, false)} disabled={toggling}
                        className="px-2 py-1 text-[10px] rounded bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-50">
                        {toggling ? <Loader2 size={10} className="animate-spin" /> : '完了にする'}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-2 ml-5">
                      {aiChildrenLoading === it.id ? (
                        <div className="text-[10px] text-neutral-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" />読み込み中...</div>
                      ) : aiChildrenHtml[it.id] ? (
                        <div className="prose prose-sm max-w-none text-xs" dangerouslySetInnerHTML={{ __html: aiChildrenHtml[it.id] }} />
                      ) : (
                        <div className="text-[10px] text-neutral-400">内容なし</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {myAiTotalPending > 3 && onNavigate && (
            <div className="flex justify-center py-2 border-t border-violet-100">
              <button onClick={() => onNavigate('data-stats')} className="text-xs text-violet-600 hover:text-violet-800 hover:underline px-3 py-1.5 flex items-center gap-1">
                <ExternalLink size={11} />もっと見る（残り {myAiTotalPending - 3}件）
              </button>
            </div>
          )}
        </div>
      )}

      {/* 案件セクション（月別、新しい順） */}
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
                  <th className="text-right px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {monthCases.map((c) => (
                  <Fragment key={c.id}>
                  <tr
                    className={`hover:bg-neutral-50/50 cursor-pointer ${expandedId === c.id ? 'bg-neutral-50' : ''}`}
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <td className="px-4 py-2.5 font-medium text-neutral-800 max-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight size={12} className={`shrink-0 transition-transform ${expandedId === c.id ? 'rotate-90' : ''}`} />
                        <span className="truncate" title={c.projectName}>{c.projectName}</span>
                        {(noteCounts[c.id]?.note ?? 0) > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setNoteDialogCaseId(c.id); }}
                            className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold hover:opacity-80 transition-opacity"
                            title="追加説明"
                          >
                            <FileText size={10} />{noteCounts[c.id].note}
                          </button>
                        )}
                      </div>
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
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onEdit(c)}
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
                        title="編集"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                  {expandedId === c.id && <CaseDetailRow c={c} colSpan={8} memberOptions={memberOptions} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {noteDialogCaseId && (
        <NoteCategoryDialog
          category="追加説明"
          entityId={noteDialogCaseId}
          memberOptions={memberOptions}
          onClose={() => setNoteDialogCaseId(null)}
          onCountChange={onNoteCountChange}
        />
      )}
    </div>
  );
}

function round2(n: number): string {
  return n === 0 ? '0' : (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: 'red' | 'amber' | 'green' }) {
  const colorCls = accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : accent === 'green' ? 'text-emerald-600' : 'text-neutral-800';
  return (
    <div className="rounded-lg bg-neutral-50 p-3">
      <p className="text-[11px] text-neutral-500 mb-0.5">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${colorCls}`}>{value}</p>
    </div>
  );
}

// 翌営業日 (土日を除く) を YYYY-MM-DD で返す。解析不能・空なら ''。
// 祝日は考慮しない (api/index.ts の businessDaysBetween と同じ方針。データソースが無いため)。
function nextBusinessDay(raw: string): string {
  const s = (raw ?? '').trim().slice(0, 10).replace(/[./]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function DateRange({ from, to, actual }: { from: string; to: string; actual?: boolean }) {
  const empty = !from && !to;
  return (
    <span className={`tabular-nums ${empty ? 'text-neutral-400' : actual ? 'text-neutral-800 font-medium' : 'text-neutral-700'}`}>
      {from || '-'} ~ {to || '-'}
    </span>
  );
}

function CaseDetailRow({ c, colSpan, memberOptions }: { c: ChildCase; colSpan: number; memberOptions: string[] }) {
  const schedule = [
    {
      label: '設計',
      planned: { from: c.tcStartDate, to: c.tcDesignCompleteDate },
      actual: { from: c.actualStartDate, to: c.actualDesignCompleteDate },
    },
    {
      label: '実施',
      planned: { from: nextBusinessDay(c.tcDesignCompleteDate), to: c.tcExecutionCompleteDate },
      actual: { from: nextBusinessDay(c.actualDesignCompleteDate), to: c.actualExecutionCompleteDate },
    },
  ];
  const ngCls = (v: string) => `tabular-nums ${Number(v) > 0 ? 'text-red-600 font-medium' : 'text-neutral-800'}`;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-3 bg-neutral-50/80">
        <div className="text-xs mb-3">
          <span className="font-bold text-neutral-600 mr-2">案件名</span>
          <span className="text-neutral-800 break-words">{c.projectName || '-'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* スケジュール */}
          <div>
            <p className="font-bold text-neutral-600 mb-1.5">スケジュール</p>
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-neutral-400">
                  <th className="text-left pb-1 font-medium"></th>
                  <th className="text-left pb-1 font-medium">予定</th>
                  <th className="text-left pb-1 font-medium">実績</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.label}>
                    <td className="py-0.5 text-neutral-500 pr-3">{s.label}</td>
                    <td className="py-0.5 pr-3"><DateRange from={s.planned.from} to={s.planned.to} /></td>
                    <td className="py-0.5"><DateRange from={s.actual.from} to={s.actual.to} actual /></td>
                  </tr>
                ))}
                <tr>
                  <td className="py-0.5 text-neutral-500 pr-3">検証日</td>
                  <td colSpan={2} className={`py-0.5 tabular-nums ${c.verificationDate ? 'text-neutral-700' : 'text-neutral-400'}`}>{c.verificationDate || '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* 工数・テスト */}
          <div>
            <p className="font-bold text-neutral-600 mb-1.5">工数 / テスト</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-neutral-500">開発工数</span>
              <span className="text-neutral-800 tabular-nums">{c.developmentEffort || '-'}</span>
              <span className="text-neutral-500">見積総工数</span>
              <span className="text-neutral-800 tabular-nums">{c.estimateTotal || '-'}</span>
              <span className="text-neutral-500">実績総工数</span>
              <span className="text-neutral-800 tabular-nums">{c.actualTotal || '-'}</span>
              <span className="text-neutral-500">Test総件数</span>
              <span className="text-neutral-800 tabular-nums">{c.testTotalCount || '-'}</span>
              <span className="text-neutral-500">NG数</span>
              <span className={ngCls(c.bugCount)}>{c.bugCount || '-'}</span>
              <span className="text-neutral-500">想定外NG数</span>
              <span className={ngCls(c.unexpectedNgCount)}>{c.unexpectedNgCount || '-'}</span>
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
  const [selectValue, setSelectValue] = useState('');
  const [customSystem, setCustomSystem] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const system = selectValue === '__custom__' ? customSystem.trim() : selectValue;
  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        onChange={(e) => { setSelectValue(e.target.value); if (e.target.value !== '__custom__') setCustomSystem(''); }}
        className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white"
      >
        <option value="">System を選択...</option>
        {systemOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__custom__">その他（手動入力）</option>
      </select>
      {selectValue === '__custom__' && (
        <input
          type="text"
          value={customSystem}
          onChange={(e) => setCustomSystem(e.target.value)}
          placeholder="システム名を入力..."
          className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none"
          autoFocus
        />
      )}
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
  const toDraft = (src: ChildCase) => {
    const d: Record<string, string> = {};
    for (const k of ALL_EDIT_KEYS) d[k] = (src as any)[k] ?? '';
    return d;
  };
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(item));

  useEffect(() => { setDraft(toDraft(item)); }, [item]);

  const changed = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const k of ALL_EDIT_KEYS) {
      if (draft[k] !== ((item as any)[k] ?? '')) diff[k] = draft[k];
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

  const inputCls = 'w-full px-2 py-1 text-sm border border-neutral-300 rounded-md focus:border-neutral-500 focus:outline-none bg-white';
  const labelCls = 'block text-[11px] font-medium text-neutral-500 mb-1';
  const sectionTitleCls = 'text-xs font-bold mb-2';

  const dateInput = (key: string) => (
    <input type="date" aria-label={EDIT_LABELS[key]} value={draft[key]} onChange={(e) => set(key, e.target.value)} className={inputCls} />
  );
  // 工数・件数は数字だけなので幅を詰め、右寄せで桁を揃える
  const numberInput = (key: string) => (
    <input
      type="text"
      inputMode="decimal"
      aria-label={EDIT_LABELS[key]}
      value={draft[key]}
      onChange={(e) => set(key, e.target.value)}
      className={`${inputCls} text-right tabular-nums`}
    />
  );

  const memberPicker = (key: string) => (
    <div>
      <span className={labelCls}>{EDIT_LABELS[key]}</span>
      <div role="group" aria-label={EDIT_LABELS[key]} className="flex flex-wrap gap-1.5 p-1.5 border border-neutral-300 rounded-md bg-white min-h-[34px]">
        {memberOptions.map((m) => {
          const selected = draft[key].split(',').map((s) => s.trim()).includes(m);
          return (
            <label key={m} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-blue-500 ${
              selected ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}>
              <input type="checkbox" checked={selected} onChange={() => toggleMulti(key, m)} className="sr-only" />
              {m}
            </label>
          );
        })}
        {memberOptions.length === 0 && <span className="text-xs text-neutral-400">メンバー未取得</span>}
      </div>
    </div>
  );

  // 背景クリックでは閉じない (入力中の内容を誤って失わないため)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-edit-dialog-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* ヘッダー: 閉じる・保存・キャンセルを常に右上に表示 (本文だけスクロール) */}
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center gap-3 shrink-0">
          <h4 id="case-edit-dialog-title" className="flex-1 min-w-0 text-sm font-bold text-neutral-800 truncate" title={item.projectName}>
            案件編集：{item.projectName}
          </h4>
          <button onClick={onCancel} className={`px-3 py-1.5 text-sm rounded-lg border border-neutral-300 hover:bg-neutral-50 ${FOCUS_RING}`}>
            キャンセル
          </button>
          <button
            onClick={() => onSave(changed)}
            disabled={saving || Object.keys(changed).length === 0}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 ${FOCUS_RING}`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
          <button
            onClick={onCancel}
            aria-label="閉じる"
            className={`inline-flex h-8 w-8 items-center justify-center rounded hover:bg-neutral-100 text-neutral-400 shrink-0 ${FOCUS_RING}`}
          >
            <X size={16} />
          </button>
        </div>
        {error && (
          <p role="alert" className="px-5 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100 flex items-center gap-1 shrink-0">
            <AlertCircle size={12} />{error}
          </p>
        )}

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* 基本情報 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3">
              <label htmlFor="case-edit-projectName" className={labelCls}>{EDIT_LABELS.projectName}</label>
              <input id="case-edit-projectName" type="text" value={draft.projectName} onChange={(e) => set('projectName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="case-edit-status" className={labelCls}>{EDIT_LABELS.status}</label>
              <select id="case-edit-status" value={draft.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
                <option value="">-</option>
                {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {memberPicker('assignee')}
            {memberPicker('manager')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* スケジュール (予定 / 実際) */}
            <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <h5 className={`${sectionTitleCls} text-blue-800`}>スケジュール</h5>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-neutral-500">
                    <th className="w-20"></th>
                    <th className="text-left font-medium pb-1 px-1">予定</th>
                    <th className="text-left font-medium pb-1 px-1">実際</th>
                  </tr>
                </thead>
                <tbody>
                  {EDIT_SCHEDULE_ROWS.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="text-left text-xs font-medium text-neutral-600 pr-2 py-1 whitespace-nowrap">{r.label}</th>
                      <td className="px-1 py-1">{dateInput(r.plan)}</td>
                      <td className="px-1 py-1">{dateInput(r.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-blue-100">
                {EDIT_MILESTONE_KEYS.map((k) => (
                  <div key={k}>
                    <span className={labelCls}>{EDIT_LABELS[k]}</span>
                    {dateInput(k)}
                  </div>
                ))}
              </div>
            </section>

            {/* 工数 (見積 / 実績) */}
            <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <h5 className={`${sectionTitleCls} text-amber-800`}>工数</h5>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-neutral-500">
                    <th className="w-12"></th>
                    {EDIT_EFFORT_COLS.map((c) => <th key={c.label} className="text-center font-medium pb-1 px-1">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="text-left text-xs font-medium text-neutral-600 pr-2 py-1">見積</th>
                    {EDIT_EFFORT_COLS.map((c) => <td key={c.label} className="px-1 py-1">{numberInput(c.estimate)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row" className="text-left text-xs font-medium text-neutral-600 pr-2 py-1">実績</th>
                    {EDIT_EFFORT_COLS.map((c) => <td key={c.label} className="px-1 py-1">{numberInput(c.actual)}</td>)}
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 pt-2 border-t border-amber-100 flex items-center gap-2">
                <span className="text-xs font-medium text-neutral-600">{EDIT_LABELS.developmentEffort}</span>
                <div className="w-24">{numberInput('developmentEffort')}</div>
              </div>
            </section>
          </div>

          {/* テスト結果 */}
          <section>
            <h5 className={`${sectionTitleCls} text-neutral-600`}>テスト結果</h5>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
              {EDIT_TEST_KEYS.map((k) => (
                <div key={k}>
                  <span className={`${labelCls} whitespace-nowrap`}>{EDIT_LABELS[k]}</span>
                  {numberInput(k)}
                </div>
              ))}
            </div>
          </section>

          {/* コメント */}
          <section>
            <label htmlFor="case-edit-comment" className={`${sectionTitleCls} block text-neutral-600`}>{EDIT_LABELS.comment}</label>
            <textarea
              id="case-edit-comment"
              rows={3}
              value={draft.comment}
              onChange={(e) => set('comment', e.target.value)}
              className={`${inputCls} resize-y`}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ===== 全体サマリー (親案件・担当者が未選択のとき) ===== */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMonthKey(key: number): string {
  return `${Math.floor(key / 100)}/${String(key % 100).padStart(2, '0')}`;
}

function filterByMonth(cases: SummaryCase[], month: string): SummaryCase[] {
  if (month === SUMMARY_MONTH_ALL) return cases;
  if (month === SUMMARY_MONTH_UPCOMING) {
    const now = new Date();
    const current = now.getFullYear() * 100 + now.getMonth() + 1;
    return cases.filter((c) => c.monthKey >= current);
  }
  return cases.filter((c) => String(c.monthKey) === month);
}

function summaryMonthLabel(month: string): string {
  return month === SUMMARY_MONTH_ALL ? '全期間' : month === SUMMARY_MONTH_UPCOMING ? '当月以降' : formatMonthKey(Number(month));
}

/* リマインド: 案件の月フィルタに関係なく常に表示 (実績・テスト結果未記入のみ対象月に従う) */
function ReminderPanel({ cases, statusGroups, month, onOpen }: {
  cases: SummaryCase[];
  statusGroups: Record<string, string[]>;
  month: string;
  onOpen: (popup: SummaryPopup) => void;
}) {
  const alerts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + NEAR_DEADLINE_DAYS);
    const todayYmd = toYmd(today);
    const limitYmd = toYmd(limit);
    const complete = new Set(statusGroups[STATUS_GROUP_COMPLETE] ?? []);
    // グループ未取得時はグループ依存の判定を出さない (全件が誤って対象になるため)
    const groupsReady = complete.size > 0;
    const isBlank = (v: string | undefined) => !(v ?? '').trim();

    const over: string[] = [];
    const near: string[] = [];
    const unplanned: string[] = [];
    const noEstimate: string[] = [];
    const noActual: string[] = [];
    const noTestResult: string[] = [];
    for (const c of cases) {
      const s = c.normStatus;
      const field = DEADLINE_FIELD_BY_STATUS[s];
      const due = field ? (c[field] ?? '').slice(0, 10) : '';
      if (due) {
        if (due < todayYmd) over.push(c.id);
        else if (due <= limitYmd) near.push(c.id);
      }
      const open = groupsReady && !complete.has(s) && s !== STOPPED_STATUS;
      if (open && (isBlank(c.tcStartDate) || isBlank(c.tcExecutionCompleteDate) || (s === DESIGN_STATUS && isBlank(c.tcDesignCompleteDate)))) {
        unplanned.push(c.id);
      }
      if (open && ESTIMATE_KEYS.some((k) => isBlank(c[k]))) noEstimate.push(c.id);
    }
    for (const c of filterByMonth(cases, month)) {
      if (!RESULT_REQUIRED_STATUSES.has(c.normStatus)) continue;
      if (ACTUAL_KEYS.some((k) => isBlank(c[k]))) noActual.push(c.id);
      if (TEST_RESULT_KEYS.some((k) => isBlank(c[k]))) noTestResult.push(c.id);
    }
    const monthLabel = summaryMonthLabel(month);
    return [
      { label: '期限超過', title: '期限超過', ids: over, accent: 'red' as const, ready: true },
      { label: '期限間近', title: '期限間近', ids: near, accent: 'amber' as const, ready: true },
      { label: '未計画', title: '未計画', ids: unplanned, accent: 'amber' as const, ready: groupsReady },
      { label: '見積未記入', title: '見積未記入', ids: noEstimate, accent: 'amber' as const, ready: groupsReady },
      { label: '実績未記入', title: `実績未記入（${monthLabel}）`, ids: noActual, accent: 'amber' as const, ready: true },
      { label: 'テスト結果未記入', title: `テスト結果未記入（${monthLabel}）`, ids: noTestResult, accent: 'amber' as const, ready: true },
    ];
  }, [cases, month, statusGroups]);

  return (
    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-4">
      <h3 className="text-sm font-bold text-neutral-800 mb-3">リマインド</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {alerts.map((a) => (
          <button
            key={a.label}
            disabled={!a.ready || a.ids.length === 0}
            onClick={() => onOpen({ title: a.title, ids: a.ids })}
            aria-label={`${a.title} ${a.ready ? `${a.ids.length}件を表示` : '判定不可'}`}
            className={`text-left rounded-lg enabled:hover:ring-2 enabled:hover:ring-neutral-200 disabled:cursor-default ${FOCUS_RING}`}
          >
            <StatCard label={a.label} value={a.ready ? a.ids.length : '-'} accent={a.ready && a.ids.length > 0 ? a.accent : undefined} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* 進捗マトリクス: 行＝システム (ツリー) / 担当者 (担当者ビュー)、列＝PROGRESS_COLUMNS */
function ProgressMatrix({ mode, cases, month, onMonthChange, onOpen }: {
  mode: 'tree' | 'assignee';
  cases: SummaryCase[];
  month: string;
  onMonthChange: (m: string) => void;
  onOpen: (popup: SummaryPopup) => void;
}) {
  const monthOptions = useMemo(
    () => Array.from(new Set(cases.map((c) => c.monthKey).filter((k) => k > 0))).sort((a, b) => b - a),
    [cases],
  );

  // 表示列のいずれかに該当する案件だけを対象にする (合計＝表示列の和)
  const columnIndexByStatus = useMemo(() => {
    const map = new Map<string, number>();
    PROGRESS_COLUMNS.forEach((col, i) => col.statuses.forEach((s) => map.set(s, i)));
    return map;
  }, []);
  const targets = useMemo(
    () => filterByMonth(cases, month).filter((c) => columnIndexByStatus.has(c.normStatus)),
    [cases, month, columnIndexByStatus],
  );

  // 行: ツリーはシステム、担当者ビューは担当者 (複数担当は各人に1件ずつ)。cells[i] は列 i の案件ID
  const rows = useMemo(() => {
    const map = new Map<string, string[][]>();
    const add = (rowKey: string, c: SummaryCase) => {
      if (!map.has(rowKey)) map.set(rowKey, PROGRESS_COLUMNS.map(() => []));
      map.get(rowKey)![columnIndexByStatus.get(c.normStatus)!].push(c.id);
    };
    for (const c of targets) {
      if (mode === 'tree') {
        add(c.parentSystem, c);
      } else {
        const emails = c.assignee ? c.assignee.split(',').map((s) => s.trim()).filter(Boolean) : [];
        if (emails.length === 0) add(UNASSIGNED_LABEL, c);
        else for (const e of emails) add(e, c);
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === UNASSIGNED_LABEL) return 1;
        if (b === UNASSIGNED_LABEL) return -1;
        return a.localeCompare(b);
      })
      .map(([key, cells]) => ({ key, cells }));
  }, [targets, mode, columnIndexByStatus]);

  const columnTotals = useMemo(() => {
    const totals: string[][] = PROGRESS_COLUMNS.map(() => []);
    for (const c of targets) totals[columnIndexByStatus.get(c.normStatus)!].push(c.id);
    return totals;
  }, [targets, columnIndexByStatus]);

  const rowLabel = (key: string) => (mode === 'assignee' && key !== UNASSIGNED_LABEL ? key.split('@')[0] : key);
  const monthLabel = summaryMonthLabel(month);

  // 件数セル: クリック領域を 32px 以上確保し、読み上げ用にどのセルかを aria-label で示す
  const countButton = (ids: string[], title: string) =>
    ids.length === 0 ? (
      <span className="inline-flex min-w-8 h-8 items-center justify-center px-2 tabular-nums text-neutral-400">0</span>
    ) : (
      <button
        onClick={() => onOpen({ title, ids })}
        aria-label={`${title} ${ids.length}件を表示`}
        className={`inline-flex min-w-8 h-8 items-center justify-center px-2 rounded tabular-nums font-medium text-blue-600 hover:bg-white hover:underline ${FOCUS_RING}`}
      >
        {ids.length}
      </button>
    );

  return (
    <div className="h-full bg-white border border-neutral-200 rounded-xl shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-neutral-800">全案件の進捗（{mode === 'tree' ? 'システム別' : '担当者別'}）</h3>
        <select
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          aria-label="対象月"
          className="px-2.5 py-1 text-xs border border-neutral-200 rounded-lg focus:border-neutral-400 focus:outline-none bg-white"
        >
          <option value={SUMMARY_MONTH_UPCOMING}>当月以降</option>
          <option value={SUMMARY_MONTH_ALL}>全期間</option>
          {monthOptions.map((k) => <option key={k} value={String(k)}>{formatMonthKey(k)}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-[11px] text-neutral-500 font-medium">
              <th className="sticky left-0 z-10 bg-white text-left px-4 py-2 whitespace-nowrap">{mode === 'tree' ? 'システム' : '担当者'}</th>
              {PROGRESS_COLUMNS.map((col) => (
                <th key={col.label} className={`text-center px-2 py-2 whitespace-nowrap ${col.tint}`}>{col.label}</th>
              ))}
              <th className="text-center px-3 py-2 whitespace-nowrap">合計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={PROGRESS_COLUMNS.length + 2} className="px-4 py-8 text-center text-neutral-400 text-xs">対象の案件がありません</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="group/row">
                  <td className="sticky left-0 z-10 bg-white group-hover/row:bg-neutral-100 px-4 py-1 text-neutral-700 whitespace-nowrap" title={r.key}>{rowLabel(r.key)}</td>
                  {PROGRESS_COLUMNS.map((col, i) => (
                    <td key={col.label} className={`px-1 py-1 text-center ${col.tint}`}>
                      {countButton(r.cells[i], `${rowLabel(r.key)} / ${col.label}（${monthLabel}）`)}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center group-hover/row:bg-neutral-100">
                    {countButton(r.cells.flat(), `${rowLabel(r.key)}（${monthLabel}）`)}
                  </td>
                </tr>
              ))
            )}
            {/* 合計行は案件単位で数える (担当者別では複数担当の案件を1件とするため、各行の和と一致しないことがある) */}
            {rows.length > 0 && (
              <tr className="font-medium border-t border-neutral-200">
                <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-1 text-neutral-700">合計</td>
                {PROGRESS_COLUMNS.map((col, i) => (
                  <td key={col.label} className={`px-1 py-1 text-center ${col.tint}`}>
                    {countButton(columnTotals[i], `${col.label}（${monthLabel}）`)}
                  </td>
                ))}
                <td className="px-2 py-1 text-center bg-neutral-50">
                  {countButton(targets.map((c) => c.id), `全案件（${monthLabel}）`)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCaseDialog({ title, cases, statusOptions, saving, error, active, onStatusChange, onEdit, onClose }: {
  title: string;
  cases: SummaryCase[];
  statusOptions: string[];
  saving: boolean;
  error: string | null;
  // false の間 (上に編集ダイアログが開いている間) は Esc で閉じない
  active: boolean;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (c: ChildCase) => void;
  onClose: () => void;
}) {
  // 保存中の行だけにローディングを出す
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => { if (!saving) setPendingId(null); }, [saving]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-case-dialog-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
          <h4 id="summary-case-dialog-title" className="text-sm font-bold text-neutral-800 min-w-0 break-words">{title}：{cases.length} 件</h4>
          <button
            onClick={onClose}
            aria-label="閉じる"
            autoFocus
            className={`inline-flex h-8 w-8 items-center justify-center rounded hover:bg-neutral-100 text-neutral-400 shrink-0 ${FOCUS_RING}`}
          >
            <X size={16} />
          </button>
        </div>
        {error && (
          <p className="px-5 pt-2 text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{error}</p>
        )}
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_var(--color-neutral-100)]">
              <tr className="text-[11px] text-neutral-400 font-medium">
                <th className="text-left px-4 py-2">案件名</th>
                <th className="text-left px-3 py-2">親案件</th>
                <th className="text-left px-3 py-2">状態</th>
                <th className="text-left px-3 py-2">担当者</th>
                <th className="text-left px-3 py-2">予定日</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {cases.map((c) => {
                const field = DEADLINE_FIELD_BY_STATUS[c.normStatus];
                const due = field ? (c[field] ?? '').slice(0, 10) : '';
                return (
                  <tr key={c.id} className="hover:bg-neutral-50/50">
                    <td className="px-4 py-2 font-medium text-neutral-800 max-w-[260px]">
                      <span className="block truncate" title={c.projectName}>{c.projectName}</span>
                    </td>
                    <td className="px-3 py-2 text-neutral-600 max-w-[200px]">
                      <span className="block truncate" title={c.parentName}>{c.parentSystem} / {c.parentMonth || '-'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={c.normStatus}
                          disabled={saving}
                          aria-label={`${c.projectName}の状態`}
                          onChange={(e) => {
                            if (e.target.value === c.normStatus) return;
                            setPendingId(c.id);
                            onStatusChange(c.id, e.target.value);
                          }}
                          className="px-2 py-1 text-xs border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none bg-white disabled:opacity-50"
                        >
                          {!statusOptions.includes(c.normStatus) && <option value={c.normStatus}>{c.normStatus}</option>}
                          {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {pendingId === c.id && (
                          <span role="status" aria-label="保存中" className="inline-flex">
                            <Loader2 size={14} className="animate-spin text-neutral-400" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">
                      {c.assignee ? c.assignee.split(',').map((s) => s.trim().split('@')[0]).join(', ') : '-'}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">
                      {field ? <span title={DEADLINE_FIELD_LABEL[field]}>{due || '未設定'}</span> : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onEdit(c)}
                        title="編集"
                        aria-label={`${c.projectName}を編集`}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 ${FOCUS_RING}`}
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
