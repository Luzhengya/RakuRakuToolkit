import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { formatDateTime } from './ReportCommentPanel';

// 管理类 > レポート（#/reports）。Notion「レポート」DB の一覧。
// 下書きもプレビューできる。ステータスはこの画面で切り替え、共有リンクはレポート画面でコピーする（公開中のみ）。

export interface ReportListItem {
  id: string;
  title: string;
  status: string;
  updatedTime: string;
  unresolvedCount: number;
  editKey: string;
}

// 共有リンク（編集キー無し＝閲覧・注記のみ）
export function reportShareUrl(id: string) {
  return `${location.origin}${location.pathname}#/report/${id.replace(/-/g, '')}`;
}

// 一覧から開くリンク（編集キー付き＝編集・ステータス変更・共有リンクのコピーができる）
const reportOwnerHash = (id: string, editKey: string, edit = false) =>
  `#/report/${id.replace(/-/g, '')}${edit ? '/edit' : ''}?key=${encodeURIComponent(editKey)}`;

export default function ReportListPage({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setError('レポート一覧の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 新規作成：Notion「レポート」DB に下書きで追加し、編集画面（新しいタブ）で開く
  const create = async () => {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    setError('');
    // await の後に開くとポップアップブロックされるため、クリック時点でタブを確保しておく
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setNewTitle('');
      setCreating(false);
      const url = `${location.origin}${location.pathname}${reportOwnerHash(String(data.id), String(data.editKey ?? ''), true)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      await load();
    } catch {
      tab?.close();
      setError('レポートの作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (id: string, editKey: string, status: string) => {
    setStatusSavingId(id);
    setError('');
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Report-Key': editKey },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      setError('ステータスの変更に失敗しました');
    } finally {
      setStatusSavingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-2">
      <nav className="flex items-center gap-2 text-sm mb-4">
        <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">ホーム</button>
        <span className="text-neutral-400">{'>>'}</span>
        <span className="text-neutral-900 font-medium">レポート</span>
      </nav>
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center gap-2">
          <h2 className="font-semibold text-sm">レポート一覧</h2>
          <button
            onClick={() => setCreating((v) => !v)}
            className="ml-auto flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus size={14} /> 新規作成
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 更新
          </button>
        </div>

        {creating && (
          <div className="px-4 py-3 border-b border-neutral-100 bg-blue-50/40 flex items-center gap-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) create();
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="レポートのタイトル（下書きとして作成します）"
              className="flex-1 text-sm border border-neutral-200 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={create}
              disabled={saving || !newTitle.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
            >
              {saving ? '作成中...' : '作成'}
            </button>
            <button onClick={() => setCreating(false)} className="text-xs px-3 py-1.5 rounded-md text-neutral-500 hover:bg-neutral-100">キャンセル</button>
          </div>
        )}

        {error && (
          <div className="px-4 py-3 text-sm text-red-600 flex items-center gap-2"><AlertCircle size={16} /> {error}</div>
        )}
        {items === null && !error ? (
          <div className="py-12 flex justify-center text-neutral-400"><Loader2 className="animate-spin" size={20} /></div>
        ) : items && items.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-400">レポートがありません</p>
        ) : items && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-neutral-100">
                <th className="px-4 py-2 font-medium">タイトル</th>
                <th className="px-4 py-2 font-medium w-28">ステータス</th>
                <th className="px-4 py-2 font-medium w-40">更新日時</th>
                <th className="px-4 py-2 font-medium w-24 text-right">未解決注記</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const published = r.status === '公開中';
                return (
                  <tr key={r.id} className="border-b border-neutral-50 hover:bg-neutral-50/60">
                    <td className="px-4 py-2.5">
                      <a
                        href={reportOwnerHash(r.id, r.editKey)}
                        target="_blank"
                        rel="noopener"
                        className="text-blue-700 hover:underline"
                        title={published ? 'レポートを開く' : 'プレビュー'}
                      >
                        {r.title || '(無題)'}
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <select
                          value={r.status}
                          disabled={statusSavingId === r.id}
                          onChange={(e) => changeStatus(r.id, r.editKey, e.target.value)}
                          className={`text-xs px-1.5 py-0.5 rounded border-0 cursor-pointer disabled:opacity-50 ${
                            published ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
                          }`}
                          title="ステータスを変更"
                        >
                          {!r.status && <option value="">未設定</option>}
                          <option value="下書き">下書き</option>
                          <option value="公開中">公開中</option>
                        </select>
                        {statusSavingId === r.id && <Loader2 size={12} className="animate-spin text-neutral-400" />}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-500">{formatDateTime(r.updatedTime)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.unresolvedCount > 0
                        ? <span className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-700">{r.unresolvedCount}</span>
                        : <span className="text-xs text-neutral-300">0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
