import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';

// レポート画面右側の注記パネル。ToDo 形式（チェック=解決済み）。注記・返信は匿名。

export interface ReportBlock {
  id: string;
  type: string;
  text: string;
}

// 注記ありを示すアイコン（lucide: message-square-exclamation-point）
export function NoteIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M12 15h.01" />
      <path d="M12 7v4" />
    </svg>
  );
}

// Notion のテキスト項目上限に合わせ、スナップショットは先頭 2000 文字で比較する
export const SNAPSHOT_MAX = 2000;

export function formatDateTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// IME 変換確定の Enter では送信しない
const isSubmitEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.nativeEvent.isComposing;

export interface ReportComment {
  id: string;
  content: string;
  blockId: string;
  snapshot: string;
  blockType: string;
  resolved: boolean;
  createdTime: string;
}

interface Reply {
  id: string;
  text: string;
  createdTime: string;
}

interface Props {
  reportId: string;
  comments: ReportComment[];
  setComments: React.Dispatch<React.SetStateAction<ReportComment[]>>;
  blockIndex: Map<string, number>;
  blockMap: Map<string, ReportBlock>;
  draftBlockId: string | null;
  onDraftDone: () => void;
  focus: { blockId: string; seq: number } | null;
  onJump: (c: ReportComment) => void;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function deleteRequest(url: string) {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const shorten = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

export default function ReportCommentPanel({
  reportId, comments, setComments, blockIndex, blockMap, draftBlockId, onDraftDone, focus, onJump,
}: Props) {
  const [hideResolved, setHideResolved] = useState(false);
  const [highlightBlockId, setHighlightBlockId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 本文の上から順。本文から消えたブロックへの注記は「原文削除済み」として最後に分ける
  const { normal, orphans } = useMemo(() => {
    const byCreated = (a: ReportComment, b: ReportComment) => a.createdTime.localeCompare(b.createdTime);
    const visible = comments.filter((c) => !hideResolved || !c.resolved);
    return {
      normal: visible
        .filter((c) => blockIndex.has(c.blockId))
        .sort((a, b) => blockIndex.get(a.blockId)! - blockIndex.get(b.blockId)! || byCreated(a, b)),
      orphans: visible.filter((c) => !blockIndex.has(c.blockId)).sort(byCreated),
    };
  }, [comments, blockIndex, hideResolved]);

  // 本文横の注記アイコンから来たら、そのブロックの注記までスクロールして強調
  useEffect(() => {
    if (!focus) return;
    const blockComments = comments.filter((c) => c.blockId === focus.blockId);
    if (hideResolved && blockComments.every((c) => c.resolved)) setHideResolved(false);
    setHighlightBlockId(focus.blockId);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-comment-block="${CSS.escape(focus.blockId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const update = (updated: ReportComment) => setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  const remove = (id: string) => setComments((prev) => prev.filter((c) => c.id !== id));

  const renderItem = (c: ReportComment, orphan: boolean) => (
    <CommentItem
      key={c.id}
      comment={c}
      orphan={orphan}
      highlighted={highlightBlockId === c.blockId}
      onJump={() => { setHighlightBlockId(c.blockId); onJump(c); }}
      onUpdate={update}
      onRemove={remove}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-2 border-b border-neutral-100 flex items-center justify-between text-xs text-neutral-500 shrink-0">
        <span>未解決 {unresolvedCount} / 全 {comments.length}</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
          解決済みを隠す
        </label>
      </div>

      {draftBlockId && (
        <DraftForm
          key={draftBlockId}
          reportId={reportId}
          block={blockMap.get(draftBlockId)}
          blockId={draftBlockId}
          onCreated={(c) => { setComments((prev) => [...prev, c]); onDraftDone(); }}
          onCancel={onDraftDone}
        />
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {comments.length === 0 && !draftBlockId && (
          <p className="text-xs text-neutral-400 text-center py-8">
            注記はまだありません。<br />本文のブロックにマウスを乗せ、右側のボタンから追加できます。
          </p>
        )}
        {normal.map((c) => renderItem(c, false))}
        {orphans.length > 0 && (
          <>
            <div className="pt-3 pb-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
              <AlertTriangle size={14} /> 原文削除済み
            </div>
            {orphans.map((c) => renderItem(c, true))}
          </>
        )}
      </div>
    </div>
  );
}

function DraftForm({ reportId, block, blockId, onCreated, onCancel }: {
  reportId: string;
  block: ReportBlock | undefined;
  blockId: string;
  onCreated: (c: ReportComment) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const data = await postJson(`/api/reports/${encodeURIComponent(reportId)}/comments`, {
        blockId,
        content: text.trim(),
        snapshot: (block?.text ?? '').slice(0, SNAPSHOT_MAX),
        blockType: block?.type ?? '',
      });
      onCreated(data.comment);
    } catch {
      setError('保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <div className="px-3 py-3 border-b border-neutral-200 bg-blue-50/50 shrink-0 space-y-2">
      <p className="text-xs text-neutral-500">対象：「{shorten(block?.text ?? '', 60)}」</p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (isSubmitEnter(e) && (e.ctrlKey || e.metaKey)) save(); }}
        placeholder="注記を入力（Ctrl+Enter で保存）"
        rows={3}
        className="w-full text-sm border border-neutral-200 rounded-md p-2 bg-white focus:outline-none focus:border-blue-400"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs px-3 py-1 rounded-md text-neutral-500 hover:bg-neutral-100">キャンセル</button>
        <button
          onClick={save}
          disabled={!text.trim() || saving}
          className="text-xs px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

function CommentItem({ comment: c, orphan, highlighted, onJump, onUpdate, onRemove }: {
  comment: ReportComment;
  orphan: boolean;
  highlighted: boolean;
  onJump: () => void;
  onUpdate: (c: ReportComment) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(c.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [repliesOpen, setRepliesOpen] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = () => run(async () => {
    const data = await postJson(`/api/report-comments/${encodeURIComponent(c.id)}/update`, { resolved: !c.resolved });
    onUpdate(data.comment);
  });

  const saveEdit = () => run(async () => {
    if (!editText.trim()) return;
    const data = await postJson(`/api/report-comments/${encodeURIComponent(c.id)}/update`, { content: editText.trim() });
    onUpdate(data.comment);
    setEditing(false);
  });

  const remove = () => {
    if (!window.confirm('この注記を削除しますか？（Notion のゴミ箱から復元できます）')) return;
    run(async () => {
      await deleteRequest(`/api/report-comments/${encodeURIComponent(c.id)}`);
      onRemove(c.id);
    });
  };

  return (
    <div
      data-comment-block={c.blockId}
      className={`rounded-lg border p-2.5 text-sm transition-colors ${
        highlighted ? 'border-blue-300 bg-blue-50/40' : 'border-neutral-200 bg-white'
      } ${c.resolved ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={c.resolved}
          disabled={busy}
          onChange={toggleResolved}
          className="mt-1 shrink-0 cursor-pointer"
          title={c.resolved ? '未解決に戻す' : '解決済みにする'}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full text-sm border border-neutral-200 rounded-md p-1.5 focus:outline-none focus:border-blue-400"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditing(false); setEditText(c.content); }} className="text-xs px-2 py-0.5 rounded text-neutral-500 hover:bg-neutral-100">キャンセル</button>
                <button onClick={saveEdit} disabled={busy || !editText.trim()} className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50">保存</button>
              </div>
            </div>
          ) : (
            <button
              onClick={orphan ? undefined : onJump}
              className={`block w-full text-left ${orphan ? 'cursor-default' : 'hover:text-blue-700'}`}
              title={orphan ? '原文が削除されたため移動できません' : '本文の該当箇所へ移動'}
            >
              <span className={`whitespace-pre-wrap break-words ${c.resolved ? 'line-through' : ''}`}>{c.content}</span>
            </button>
          )}
          <p className="mt-1 text-[11px] text-neutral-400 truncate" title={c.snapshot}>
            対象：「{shorten(c.snapshot)}」
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
            <span>{formatDateTime(c.createdTime)}</span>
            <div className="ml-auto flex items-center gap-1">
              {busy && <Loader2 size={12} className="animate-spin" />}
              <button onClick={() => setRepliesOpen((v) => !v)} className="p-1 rounded hover:bg-neutral-100 hover:text-neutral-700" title="返信">
                <MessageSquare size={13} />
              </button>
              <button onClick={() => setEditing(true)} disabled={busy} className="p-1 rounded hover:bg-neutral-100 hover:text-neutral-700" title="修正">
                <Pencil size={13} />
              </button>
              <button onClick={remove} disabled={busy} className="p-1 rounded hover:bg-red-50 hover:text-red-600" title="削除">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          {repliesOpen && <Replies commentId={c.id} />}
        </div>
      </div>
    </div>
  );
}

function Replies({ commentId }: { commentId: string }) {
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/report-comments/${encodeURIComponent(commentId)}/replies`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) setReplies(d.replies ?? []); })
      .catch(() => { if (alive) { setReplies([]); setError('返信の読み込みに失敗しました'); } });
    return () => { alive = false; };
  }, [commentId]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const add = () => run(async () => {
    if (!text.trim()) return;
    const data = await postJson(`/api/report-comments/${encodeURIComponent(commentId)}/replies`, { text: text.trim() });
    setReplies((prev) => [...(prev ?? []), data.reply]);
    setText('');
  });

  const saveEdit = (id: string) => run(async () => {
    if (!editText.trim()) return;
    const data = await postJson(`/api/report-replies/${encodeURIComponent(id)}/update`, { text: editText.trim() });
    setReplies((prev) => (prev ?? []).map((r) => (r.id === id ? data.reply : r)));
    setEditingId(null);
  });

  const remove = (id: string) => {
    if (!window.confirm('この返信を削除しますか？')) return;
    run(async () => {
      await deleteRequest(`/api/report-replies/${encodeURIComponent(id)}`);
      setReplies((prev) => (prev ?? []).filter((r) => r.id !== id));
    });
  };

  if (replies === null) {
    return <div className="mt-2 text-xs text-neutral-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 読み込み中...</div>;
  }

  return (
    <div className="mt-2 pl-2 border-l-2 border-neutral-100 space-y-1.5">
      {replies.map((r) => (
        <div key={r.id} className="text-xs">
          {editingId === r.id ? (
            <div className="flex gap-1">
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (isSubmitEnter(e)) saveEdit(r.id); }}
                className="flex-1 min-w-0 border border-neutral-200 rounded px-1.5 py-0.5"
              />
              <button onClick={() => saveEdit(r.id)} disabled={busy} className="px-1.5 rounded bg-blue-600 text-white disabled:opacity-50">保存</button>
              <button onClick={() => setEditingId(null)} className="px-1.5 rounded text-neutral-500 hover:bg-neutral-100">×</button>
            </div>
          ) : (
            <div className="group flex items-start gap-1">
              <p className="flex-1 whitespace-pre-wrap break-words text-neutral-700">{r.text}</p>
              <span className="shrink-0 text-[10px] text-neutral-400">{formatDateTime(r.createdTime)}</span>
              <button
                onClick={() => { setEditingId(r.id); setEditText(r.text); }}
                className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-neutral-400 hover:text-neutral-700"
                title="修正"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={() => remove(r.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-neutral-400 hover:text-red-600"
                title="削除"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isSubmitEnter(e)) add(); }}
          placeholder="返信を入力（Enter で送信）"
          className="flex-1 min-w-0 text-xs border border-neutral-200 rounded px-1.5 py-1 focus:outline-none focus:border-blue-400"
        />
        <button onClick={add} disabled={busy || !text.trim()} className="text-xs px-2 rounded bg-neutral-800 text-white disabled:opacity-40">送信</button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
