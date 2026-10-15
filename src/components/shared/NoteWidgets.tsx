import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImagePlus,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Send,
  TriangleAlert,
  X,
} from 'lucide-react';
import { captureScreen } from '../../utils/captureScreen';
import ScreenshotEditor from '../ScreenshotEditor';

export type NoteCategory = '追加説明' | '指摘' | 'QA';
export type EntityType = 'case' | 'bug' | 'testcase';

export type EntityNote = {
  id: string;
  title: string;
  category: NoteCategory;
  status: string;
  priority: string;
  assignee: string;
  requester: string;
  entityId: string;
  createdTime: string;
  screenshots?: string[];
};

export type NoteReply = {
  id: string;
  text: string;
  createdTime: string;
  type: string;
  screenshot?: string;
};

export const NOTE_ICONS: Record<NoteCategory, typeof FileText> = {
  '追加説明': FileText,
  '指摘': TriangleAlert,
  'QA': MessageCircle,
};

export const NOTE_COLORS: Record<NoteCategory, string> = {
  '追加説明': 'text-blue-500',
  '指摘': 'text-orange-500',
  'QA': 'text-emerald-500',
};

// ── ScreenshotViewer (fullscreen lightbox) ──

function ScreenshotViewer({ images, startIndex, onClose }: {
  images: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIdx((i) => (i > 0 ? i - 1 : i));
      else if (e.key === 'ArrowRight') setIdx((i) => (i < images.length - 1 ? i + 1 : i));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [images.length, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 z-10">
        <X size={20} />
      </button>

      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm z-10">
          {idx + 1} / {images.length}
        </div>
      )}

      {images.length > 1 && idx > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx(idx - 1); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 z-10"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {images.length > 1 && idx < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx(idx + 1); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 z-10"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <img
        src={images[idx]}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── NoteCreateForm (modal) ──

export function NoteCreateForm({ category, memberOptions, entityId, entityType = 'case', onCreated, onCancel }: {
  category: NoteCategory;
  memberOptions: string[];
  entityId: string;
  entityType?: EntityType;
  onCreated: (note: EntityNote) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [requester, setRequester] = useState('');
  const [priority, setPriority] = useState('');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), category, entityId, entityType,
          assignee: assignees.length > 0 ? assignees.join(',') : undefined,
          requester: requester || undefined,
          priority: priority || undefined,
          screenshots: screenshots.length > 0 ? screenshots : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const note = await res.json();
      onCreated(note);
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleCapture = async () => {
    const dataUrl = await captureScreen();
    if (dataUrl) setEditingImage(dataUrl);
  };

  const handleFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      if (!input.files) return;
      const file = input.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => { if (reader.result) setEditingImage(reader.result as string); };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (!f) continue;
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => { if (reader.result) setEditingImage(reader.result as string); };
          reader.readAsDataURL(f);
          break;
        }
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, []);

  if (editingImage) {
    return (
      <ScreenshotEditor
        imageDataUrl={editingImage}
        onDone={(edited) => {
          setScreenshots((prev) => [...prev, edited]);
          setEditingImage(null);
        }}
        onCancel={() => setEditingImage(null)}
      />
    );
  }

  const Icon = NOTE_ICONS[category];
  const needsAssignee = category === '指摘' || category === 'QA';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-700">
            <Icon size={16} className={NOTE_COLORS[category]} />
            {category}を追加
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600">
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs text-neutral-500 font-medium mb-1 block">内容</label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="内容を入力..."
              className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:border-neutral-500 focus:outline-none resize-none"
              rows={3}
              autoFocus
            />
          </div>

          {/* screenshots */}
          <div>
            <label className="text-xs text-neutral-500 font-medium mb-1.5 block">スクリーンショット</label>
            {screenshots.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {screenshots.map((src, i) => (
                  <div key={i} className="relative group/thumb">
                    <img src={src} alt="" className="h-20 w-auto rounded-lg border border-neutral-200 object-cover" />
                    <button
                      type="button"
                      onClick={() => setScreenshots(screenshots.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCapture}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-neutral-300 hover:bg-neutral-50 text-neutral-600"
              >
                <Camera size={14} />
                画面キャプチャ
              </button>
              <button
                type="button"
                onClick={handleFileSelect}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-neutral-300 hover:bg-neutral-50 text-neutral-600"
              >
                <ImagePlus size={14} />
                ファイル選択
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-1">Ctrl+V で貼り付けも可能</p>
          </div>

          {/* people / priority fields */}
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {category !== '追加説明' && (
              <div>
                <label className="text-xs text-neutral-500 font-medium mb-1 block">請求者</label>
                <select value={requester} onChange={(e) => setRequester(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus:border-neutral-400 focus:outline-none min-w-[140px]">
                  <option value="">選択...</option>
                  {memberOptions.map((m) => <option key={m} value={m}>{m.split('@')[0]}</option>)}
                </select>
              </div>
            )}
            {needsAssignee && (
              <div className="relative">
                <label className="text-xs text-neutral-500 font-medium mb-1 block">割当</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {assignees.map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                      {email.split('@')[0]}
                      <button type="button" onClick={() => setAssignees(assignees.filter((e) => e !== email))}
                        className="hover:text-red-500">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {memberOptions.filter((m) => !assignees.includes(m)).length > 0 && (
                    <button type="button" onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-neutral-300 text-neutral-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                {showAssigneeDropdown && (
                  <div className="absolute z-10 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
                    {memberOptions.filter((m) => !assignees.includes(m)).map((m) => (
                      <button key={m} type="button"
                        onClick={() => { setAssignees([...assignees, m]); setShowAssigneeDropdown(false); }}
                        className="block w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 text-neutral-700">
                        {m.split('@')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {category === '指摘' && (
              <div>
                <label className="text-xs text-neutral-500 font-medium mb-1 block">優先度</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus:border-neutral-400 focus:outline-none min-w-[100px]">
                  <option value="">-</option>
                  <option value="高">高</option>
                  <option value="中">中</option>
                  <option value="低">低</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-100 bg-neutral-50/50">
          <button onClick={onCancel} className="px-4 py-1.5 text-xs rounded-lg border border-neutral-300 hover:bg-white text-neutral-600">
            キャンセル
          </button>
          <button onClick={handleSubmit} disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            追加
          </button>
        </div>
      </div>
    </div>
  );
}

// ── QaThread ──

export function QaThread({ noteId, memberOptions }: { noteId: string; memberOptions: string[] }) {
  const [replies, setReplies] = useState<NoteReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [sending, setSending] = useState(false);
  const [replyScreenshots, setReplyScreenshots] = useState<string[]>([]);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/replies`);
        if (res.ok) {
          const data = await res.json();
          if (alive) setReplies(data.replies ?? []);
        }
      } catch { /* */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [noteId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [replies]);

  const handleSend = async () => {
    if ((!text.trim() && replyScreenshots.length === 0) || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          author: author || undefined,
          screenshots: replyScreenshots.length > 0 ? replyScreenshots : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplies((prev) => [...prev, { id: Date.now().toString(), text: data.content, createdTime: new Date().toISOString(), type: 'paragraph' }]);
        setText('');
        setReplyScreenshots([]);
      }
    } catch { /* */ }
    finally { setSending(false); }
  };

  const handleReplyCapture = async () => {
    const dataUrl = await captureScreen();
    if (dataUrl) setEditingImage(dataUrl);
  };

  if (editingImage) {
    return (
      <ScreenshotEditor
        imageDataUrl={editingImage}
        onDone={(edited) => {
          setReplyScreenshots((prev) => [...prev, edited]);
          setEditingImage(null);
        }}
        onCancel={() => setEditingImage(null)}
      />
    );
  }

  return (
    <div className="mt-2 border border-neutral-200 rounded-lg overflow-hidden bg-white">
      <div ref={scrollRef} className="max-h-48 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center py-4"><Loader2 size={16} className="animate-spin mx-auto text-neutral-400" /></div>
        ) : replies.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-2">まだ返信がありません</p>
        ) : (
          replies.map((r) => (
            <div key={r.id} className="text-xs text-neutral-700 bg-neutral-50 rounded-lg px-3 py-2">
              {r.text && <p>{r.text}</p>}
              {r.screenshot && <img src={r.screenshot} alt="" className="mt-1 max-h-32 rounded border border-neutral-200" />}
            </div>
          ))
        )}
      </div>
      <div className="border-t border-neutral-100 p-2 space-y-2">
        {replyScreenshots.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {replyScreenshots.map((src, i) => (
              <div key={i} className="relative group/thumb">
                <img src={src} alt="" className="h-10 w-auto rounded border border-neutral-200 object-cover" />
                <button type="button" onClick={() => setReplyScreenshots(replyScreenshots.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100">
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <select value={author} onChange={(e) => setAuthor(e.target.value)}
            className="px-2 py-1 text-[11px] border border-neutral-200 rounded bg-white shrink-0">
            <option value="">匿名</option>
            {memberOptions.map((m) => <option key={m} value={m}>{m.split('@')[0]}</option>)}
          </select>
          <input
            type="text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="返信を入力..."
            className="flex-1 px-2 py-1 text-xs border border-neutral-200 rounded focus:border-neutral-400 focus:outline-none"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button type="button" onClick={handleReplyCapture}
            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 shrink-0" title="画面キャプチャ">
            <Camera size={12} />
          </button>
          <button onClick={handleSend} disabled={(!text.trim() && replyScreenshots.length === 0) || sending}
            className="p-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 shrink-0">
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NoteList (per entity) ──

export function NoteList({ entityId, entityType = 'case', memberOptions, refreshKey = 0, editable = false }: {
  entityId: string;
  entityType?: EntityType;
  memberOptions: string[];
  refreshKey?: number;
  editable?: boolean;
}) {
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/notes?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`);
        if (res.ok) {
          const data = await res.json();
          if (alive) setNotes(data.items ?? []);
        }
      } catch { /* */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [entityId, entityType, refreshKey]);

  const handleToggle = async (id: string, done: boolean) => {
    setTogglingId(id);
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, status: done ? '対応済' : '新' } : n));
    try {
      await fetch(`/api/notes/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
    } catch {
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, status: done ? '新' : '対応済' } : n));
    } finally {
      setTogglingId(null);
    }
  };

  const handleUpdate = (updated: EntityNote) => {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? { ...n, ...updated } : n));
    setEditingId(null);
  };

  if (loading) return <div className="py-2 text-center"><Loader2 size={14} className="animate-spin mx-auto text-neutral-400" /></div>;
  if (notes.length === 0) return null;

  const groups = {
    '追加説明': notes.filter((n) => n.category === '追加説明'),
    '指摘': notes.filter((n) => n.category === '指摘'),
    'QA': notes.filter((n) => n.category === 'QA'),
  };

  return (
    <div className="mt-3 space-y-2">
      {(Object.entries(groups) as [NoteCategory, EntityNote[]][]).map(([cat, items]) => {
        if (items.length === 0) return null;
        const Icon = NOTE_ICONS[cat];
        return (
          <div key={cat}>
            <p className="text-[11px] font-bold text-neutral-500 flex items-center gap-1 mb-1">
              <Icon size={12} className={NOTE_COLORS[cat]} />{cat} ({items.length})
            </p>
            <div className="space-y-1">
              {items.map((n) => {
                const isDone = n.status === '対応済';
                if (editingId === n.id) {
                  return (
                    <NoteInlineEdit key={n.id} note={n} memberOptions={memberOptions}
                      onSaved={handleUpdate} onCancel={() => setEditingId(null)} />
                  );
                }
                return (
                  <div key={n.id} className="rounded-lg bg-white border border-neutral-100 px-3 py-2 group/note">
                    <div className="flex items-start gap-2">
                      {cat !== '追加説明' && (
                        <button
                          onClick={() => handleToggle(n.id, !isDone)}
                          disabled={togglingId === n.id}
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-neutral-300 hover:border-neutral-400'}`}
                        >
                          {isDone && <Check size={10} />}
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs ${isDone ? 'line-through text-neutral-400' : 'text-neutral-700'}`}>{n.title}</p>
                        {n.screenshots && n.screenshots.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {n.screenshots.map((src, i) => (
                              <img key={i} src={src} alt="" className="h-16 w-auto rounded border border-neutral-200 object-cover cursor-pointer hover:opacity-80" onClick={() => { setViewerImages(n.screenshots!); setViewerIndex(i); }} />
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-neutral-400">
                          {n.requester && <span>提出: {n.requester.split('@')[0]}</span>}
                          {n.assignee && <span>割当: {n.assignee.split(',').map((e) => e.trim().split('@')[0]).join(', ')}</span>}
                          {n.priority && <span className={n.priority === '高' ? 'text-red-500 font-medium' : ''}>{n.priority}</span>}
                          <span>{new Date(n.createdTime).toLocaleDateString('ja-JP')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {editable && (
                          <button onClick={() => setEditingId(n.id)}
                            className="p-1 rounded hover:bg-neutral-100 text-neutral-300 opacity-0 group-hover/note:opacity-100 transition-opacity"
                            title="編集">
                            <Pencil size={12} />
                          </button>
                        )}
                        {cat === 'QA' && (
                          <button
                            onClick={() => setExpandedQaId(expandedQaId === n.id ? null : n.id)}
                            className="text-[10px] text-emerald-600 hover:underline"
                          >
                            {expandedQaId === n.id ? '閉じる' : '対話'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cat === 'QA' && expandedQaId === n.id && (
                      <QaThread noteId={n.id} memberOptions={memberOptions} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {viewerImages && (
        <ScreenshotViewer images={viewerImages} startIndex={viewerIndex} onClose={() => setViewerImages(null)} />
      )}
    </div>
  );
}

function NoteInlineEdit({ note, memberOptions, onSaved, onCancel }: {
  note: EntityNote;
  memberOptions: string[];
  onSaved: (n: EntityNote) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [assignees, setAssignees] = useState<string[]>(note.assignee ? note.assignee.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const [requester, setRequester] = useState(note.requester ?? '');
  const [priority, setPriority] = useState(note.priority ?? '');
  const [saving, setSaving] = useState(false);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const needsAssignee = note.category === '指摘' || note.category === 'QA';

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          ...(needsAssignee ? { assignee: assignees.join(',') } : {}),
          ...(note.category !== '追加説明' ? { requester } : {}),
          ...(note.category === '指摘' ? { priority } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      onSaved({ ...note, ...updated });
    } catch { /* */ }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg bg-blue-50/50 border border-blue-200 px-3 py-2.5 space-y-2.5">
      <div>
        <label className="text-[10px] text-neutral-500 font-medium mb-0.5 block">内容</label>
        <textarea value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-neutral-200 rounded-lg focus:border-blue-400 focus:outline-none resize-none bg-white"
          rows={2} autoFocus />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {note.category !== '追加説明' && (
          <div>
            <label className="text-[10px] text-neutral-500 font-medium mb-0.5 block">請求者</label>
            <select value={requester} onChange={(e) => setRequester(e.target.value)}
              className="px-2 py-1 text-xs border border-neutral-200 rounded-lg bg-white focus:border-blue-400 focus:outline-none min-w-[120px]">
              <option value="">選択...</option>
              {memberOptions.map((m) => <option key={m} value={m}>{m.split('@')[0]}</option>)}
            </select>
          </div>
        )}
        {needsAssignee && (
          <div className="relative">
            <label className="text-[10px] text-neutral-500 font-medium mb-0.5 block">割当</label>
            <div className="flex flex-wrap items-center gap-1">
              {assignees.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 border border-blue-200 rounded-full">
                  {email.split('@')[0]}
                  <button type="button" onClick={() => setAssignees(assignees.filter((e) => e !== email))} className="hover:text-red-500"><X size={8} /></button>
                </span>
              ))}
              {memberOptions.filter((m) => !assignees.includes(m)).length > 0 && (
                <button type="button" onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-neutral-300 text-neutral-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                  <Plus size={10} />
                </button>
              )}
            </div>
            {showAssigneeDropdown && (
              <div className="absolute z-10 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 min-w-[140px] max-h-[160px] overflow-y-auto">
                {memberOptions.filter((m) => !assignees.includes(m)).map((m) => (
                  <button key={m} type="button"
                    onClick={() => { setAssignees([...assignees, m]); setShowAssigneeDropdown(false); }}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 text-neutral-700">
                    {m.split('@')[0]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {note.category === '指摘' && (
          <div>
            <label className="text-[10px] text-neutral-500 font-medium mb-0.5 block">優先度</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="px-2 py-1 text-xs border border-neutral-200 rounded-lg bg-white focus:border-blue-400 focus:outline-none min-w-[80px]">
              <option value="">-</option>
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1 text-[11px] rounded-lg border border-neutral-300 hover:bg-white text-neutral-600">
          キャンセル
        </button>
        <button onClick={handleSave} disabled={saving || !title.trim()}
          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
          保存
        </button>
      </div>
    </div>
  );
}

// ── PendingNoteRow ──

export function PendingNoteRow({ note, memberOptions, onUpdated }: {
  note: EntityNote;
  memberOptions: string[];
  onUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [screenshots, setScreenshots] = useState<string[] | null>(null);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const Icon = NOTE_ICONS[note.category] || FileText;

  const handleToggle = async () => {
    setToggling(true);
    try {
      await fetch(`/api/notes/${note.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      });
      onUpdated();
    } catch { /* */ }
    finally { setToggling(false); }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && screenshots === null && !screenshotsLoading) {
      setScreenshotsLoading(true);
      fetch(`/api/notes/${note.id}/screenshots`)
        .then((r) => r.json())
        .then((d) => setScreenshots(d.screenshots ?? []))
        .catch(() => setScreenshots([]))
        .finally(() => setScreenshotsLoading(false));
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2 cursor-pointer" onClick={handleExpand}>
        <Icon size={14} className={`mt-0.5 shrink-0 ${note.category === '指摘' ? 'text-amber-500' : note.category === 'QA' ? 'text-emerald-500' : 'text-sky-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-800">{note.title}</span>
            {note.priority === '高' && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-bold">高</span>}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">
            from {note.requester ? note.requester.split('@')[0] : '?'} &middot; {note.createdTime?.slice(0, 10)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {note.category === '指摘' && (
            <button onClick={handleToggle} disabled={toggling}
              className="px-2 py-1 text-[10px] rounded bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-50">
              対応済にする
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          {screenshotsLoading && <div className="text-[10px] text-neutral-400">スクリーンショット読み込み中...</div>}
          {screenshots && screenshots.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {screenshots.map((src, i) => (
                <img key={i} src={src} alt="" className="h-16 w-auto rounded border border-neutral-200 object-cover cursor-pointer hover:opacity-80" onClick={() => { setViewerImages(screenshots); setViewerIndex(i); }} />
              ))}
            </div>
          )}
          {note.category === 'QA' && (
            <QaThread noteId={note.id} memberOptions={memberOptions} />
          )}
        </div>
      )}
      {viewerImages && (
        <ScreenshotViewer images={viewerImages} startIndex={viewerIndex} onClose={() => setViewerImages(null)} />
      )}
    </div>
  );
}

// ── NoteHoverButtons ──

export function NoteHoverButtons({ entityId, entityType = 'case', memberOptions, onNoteCreated }: {
  entityId: string;
  entityType?: EntityType;
  memberOptions: string[];
  onNoteCreated: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<NoteCategory | null>(null);

  return (
    <>
      <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
        {(['追加説明', '指摘', 'QA'] as const).map((cat) => {
          const Icon = NOTE_ICONS[cat];
          return (
            <button
              key={cat}
              onClick={(e) => { e.stopPropagation(); setActiveCategory(cat); }}
              className={`p-1 rounded hover:bg-neutral-100 ${NOTE_COLORS[cat]} transition-colors`}
              title={`${cat}を追加`}
            >
              <Icon size={13} />
            </button>
          );
        })}
      </div>
      {activeCategory && (
        <NoteCreateForm
          category={activeCategory}
          memberOptions={memberOptions}
          entityId={entityId}
          entityType={entityType}
          onCreated={() => { setActiveCategory(null); onNoteCreated(); }}
          onCancel={() => setActiveCategory(null)}
        />
      )}
    </>
  );
}

// ── Pending section for assignee view ──

export function PendingNotesSection({ email, memberOptions }: {
  email: string;
  memberOptions: string[];
}) {
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/notes/by-assignee')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const mine: EntityNote[] = data.byAssignee?.[email] ?? [];
        setNotes(mine.filter((n) => n.status !== '対応済'));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email, refreshKey]);

  if (loading) return <div className="text-xs text-neutral-400 text-center py-4">読み込み中...</div>;
  if (notes.length === 0) return null;

  return (
    <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50/60 flex items-center gap-2">
        <TriangleAlert size={13} className="text-amber-500" />
        <span className="text-xs font-bold text-amber-700">待処理事項</span>
        <span className="text-[10px] text-amber-500 ml-1">{notes.length} 件</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {notes.map((note) => (
          <PendingNoteRow
            key={note.id}
            note={note}
            memberOptions={memberOptions}
            onUpdated={() => setRefreshKey((k) => k + 1)}
          />
        ))}
      </div>
    </div>
  );
}

// ── NoteCategoryDialog (modal showing notes of one category for an entity) ──

export function NoteCategoryDialog({ category, entityId, entityType = 'case', memberOptions, onClose, onCountChange, editable = false }: {
  category: NoteCategory;
  entityId: string;
  entityType?: EntityType;
  memberOptions: string[];
  onClose: () => void;
  onCountChange?: () => void;
  editable?: boolean;
}) {
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/notes?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (!alive) return;
        const filtered: EntityNote[] = (data.items ?? []).filter((n: EntityNote) => n.category === category);
        setNotes(filtered);
        for (const note of filtered) {
          if (!alive) break;
          try {
            const sr = await fetch(`/api/notes/${encodeURIComponent(note.id)}/screenshots`);
            if (sr.ok) {
              const sd = await sr.json();
              if (alive && sd.screenshots?.length > 0) {
                setNotes((prev) => prev.map((n) => n.id === note.id ? { ...n, screenshots: sd.screenshots } : n));
              }
            }
          } catch { /* */ }
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entityId, entityType, category, refreshKey]);

  const handleToggle = async (id: string, done: boolean) => {
    setTogglingId(id);
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, status: done ? '対応済' : '新' } : n));
    try {
      await fetch(`/api/notes/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
      onCountChange?.();
    } catch {
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, status: done ? '新' : '対応済' } : n));
    } finally {
      setTogglingId(null);
    }
  };

  if (creating) {
    return (
      <NoteCreateForm
        category={category}
        memberOptions={memberOptions}
        entityId={entityId}
        entityType={entityType}
        onCreated={() => {
          setCreating(false);
          setRefreshKey((k) => k + 1);
          onCountChange?.();
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  const Icon = NOTE_ICONS[category];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100 shrink-0">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-700">
            <Icon size={16} className={NOTE_COLORS[category]} />
            {category}
            <span className="text-xs font-normal text-neutral-400">({notes.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-neutral-900 text-white hover:bg-neutral-800">
              <Plus size={12} />追加
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="py-8 text-center"><Loader2 size={16} className="animate-spin mx-auto text-neutral-400" /></div>
          ) : notes.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-8">まだ{category}はありません</p>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => {
                const isDone = n.status === '対応済';
                if (editingId === n.id) {
                  return (
                    <NoteInlineEdit key={n.id} note={n} memberOptions={memberOptions}
                      onSaved={(updated) => { setNotes((prev) => prev.map((x) => x.id === updated.id ? { ...x, ...updated } : x)); setEditingId(null); }}
                      onCancel={() => setEditingId(null)} />
                  );
                }
                return (
                  <div key={n.id} className="rounded-lg border border-neutral-100 px-3 py-2 group/note">
                    <div className="flex items-start gap-2">
                      {category !== '追加説明' && (
                        <button
                          onClick={() => handleToggle(n.id, !isDone)}
                          disabled={togglingId === n.id}
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-neutral-300 hover:border-neutral-400'}`}
                        >
                          {isDone && <Check size={10} />}
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs ${isDone ? 'line-through text-neutral-400' : 'text-neutral-700'}`}>{n.title}</p>
                        {n.screenshots && n.screenshots.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {n.screenshots.map((src, i) => (
                              <img key={i} src={src} alt="" className="h-16 w-auto rounded border border-neutral-200 object-cover cursor-pointer hover:opacity-80" onClick={() => { setViewerImages(n.screenshots!); setViewerIndex(i); }} />
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-neutral-400">
                          {n.requester && <span>提出: {n.requester.split('@')[0]}</span>}
                          {n.assignee && <span>割当: {n.assignee.split(',').map((e) => e.trim().split('@')[0]).join(', ')}</span>}
                          {n.priority && <span className={n.priority === '高' ? 'text-red-500 font-medium' : ''}>{n.priority}</span>}
                          <span>{new Date(n.createdTime).toLocaleDateString('ja-JP')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {editable && (
                          <button onClick={() => setEditingId(n.id)}
                            className="p-1 rounded hover:bg-neutral-100 text-neutral-300 opacity-0 group-hover/note:opacity-100 transition-opacity"
                            title="編集">
                            <Pencil size={12} />
                          </button>
                        )}
                        {category === 'QA' && (
                          <button
                            onClick={() => setExpandedQaId(expandedQaId === n.id ? null : n.id)}
                            className="text-[10px] text-emerald-600 hover:underline"
                          >
                            {expandedQaId === n.id ? '閉じる' : '対話'}
                          </button>
                        )}
                      </div>
                    </div>
                    {category === 'QA' && expandedQaId === n.id && (
                      <QaThread noteId={n.id} memberOptions={memberOptions} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {viewerImages && (
        <ScreenshotViewer images={viewerImages} startIndex={viewerIndex} onClose={() => setViewerImages(null)} />
      )}
    </div>
  );
}

// ── NoteBadges (icon badges for case name row) ──

const BADGE_STYLES: Record<NoteCategory, { bg: string; text: string }> = {
  '追加説明': { bg: 'bg-blue-100', text: 'text-blue-700' },
  '指摘': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'QA': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

export function NoteBadges({ entityId, entityType = 'case', counts, memberOptions, onCountChange, editable = false }: {
  entityId: string;
  entityType?: EntityType;
  counts: { qa: number; note: number; issue: number };
  memberOptions: string[];
  onCountChange?: () => void;
  editable?: boolean;
}) {
  const [activeCategory, setActiveCategory] = useState<NoteCategory | null>(null);

  const badges = ([
    { cat: '追加説明' as NoteCategory, count: counts.note },
    { cat: '指摘' as NoteCategory, count: counts.issue },
    { cat: 'QA' as NoteCategory, count: counts.qa },
  ]).filter((b) => b.count > 0);

  if (badges.length === 0) return null;

  return (
    <>
      <span className="inline-flex items-center gap-1">
        {badges.map(({ cat, count }) => {
          const Icon = NOTE_ICONS[cat];
          const style = BADGE_STYLES[cat];
          return (
            <button
              key={cat}
              onClick={(e) => { e.stopPropagation(); setActiveCategory(cat); }}
              className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${style.bg} ${style.text} text-[10px] font-bold hover:opacity-80 transition-opacity`}
              title={cat}
            >
              <Icon size={10} />{count}
            </button>
          );
        })}
      </span>
      {activeCategory && (
        <NoteCategoryDialog
          category={activeCategory}
          entityId={entityId}
          entityType={entityType}
          memberOptions={memberOptions}
          onClose={() => setActiveCategory(null)}
          onCountChange={onCountChange}
          editable={editable}
        />
      )}
    </>
  );
}

// ── Note counts hook ──

export function useNoteCounts() {
  const [counts, setCounts] = useState<Record<string, { qa: number; note: number; issue: number }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notes/counts');
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts ?? {});
      }
    } catch { /* */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { counts, reloadCounts: load };
}
