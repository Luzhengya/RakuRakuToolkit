import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, Link2, Loader2, MessageSquarePlus, PanelRightClose, PanelRightOpen, Pencil, RefreshCw,
} from 'lucide-react';
import { reportShareUrl } from './ReportListPage';
import ReportCommentPanel, { formatDateTime, NoteIcon, SNAPSHOT_MAX, type ReportBlock, type ReportComment } from './ReportCommentPanel';

// 編集画面（Tiptap）は編集する時だけ読み込む
const ReportEditor = lazy(() => import('./ReportEditor'));

// レポート共有画面（#/report/<pageId>、編集で開く場合は #/report/<pageId>/edit）。ヘッダー無しの単独表示。
// 本文は Notion 原稿をサーバーで HTML 化したもの。注記はブロック単位（data-block-id）。

interface ReportData {
  id: string;
  title: string;
  status: string;
  updatedTime: string;
  html: string;
  blocks: ReportBlock[];
}

interface Marker {
  blockId: string;
  top: number;
  count: number;
  open: boolean;
}

// 文字でないブロック（画像・表・Mermaid 等）は原文比較の表示をしない
function isNonTextBlock(type: string, snapshot: string) {
  return ['image', 'table', 'divider'].includes(type) || snapshot === '[Mermaid 図表]' || snapshot === `[${type}]`;
}

function findBlock(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

// 閉じた Toggle の中のブロックは、いちばん外側の閉じた Toggle の位置に寄せる
function visibleAnchor(root: HTMLElement, el: HTMLElement) {
  let anchor = el;
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    if (p.tagName === 'DETAILS' && !(p as HTMLDetailsElement).open) anchor = p;
  }
  return anchor;
}

// editKey がある（一覧から開いた）時だけ編集・共有リンクのコピーができる。共有リンクで開いた人は閲覧と注記のみ
export default function ReportView({ reportId, editKey = '', initialEdit = false }: { reportId: string; editKey?: string; initialEdit?: boolean }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [draftBlockId, setDraftBlockId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ blockId: string; seq: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; top: number } | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [editMode, setEditMode] = useState(initialEdit);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const id = encodeURIComponent(reportId);
      const [r, c] = await Promise.all([fetch(`/api/reports/${id}`), fetch(`/api/reports/${id}/comments`)]);
      if (r.status === 404) throw new Error('レポートが見つかりません');
      if (!r.ok || !c.ok) throw new Error('読み込みに失敗しました');
      const reportData: ReportData = await r.json();
      const commentData = await c.json();
      setReport(reportData);
      setComments(commentData.comments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (report?.title) document.title = report.title;
  }, [report?.title]);

  const blockIndex = useMemo(() => new Map((report?.blocks ?? []).map((b, i) => [b.id, i])), [report?.blocks]);
  const blockMap = useMemo(() => new Map((report?.blocks ?? []).map((b) => [b.id, b])), [report?.blocks]);

  // Mermaid の描画（レポート画面を開いた時だけライブラリを読み込む）
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !report) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])'));
    if (nodes.length === 0) return;
    let alive = true;
    import('mermaid').then(async ({ default: mermaid }) => {
      if (!alive) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      try {
        await mermaid.run({ nodes });
      } catch (e) {
        console.error('Mermaid render error:', e);
      }
    });
    return () => { alive = false; };
  }, [report?.html, editMode]);

  // 注記のあるブロックに色付きの下線（未解決あり=橙、全解決=灰）
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    root.querySelectorAll('.rb-commented').forEach((n) => n.classList.remove('rb-commented', 'rb-open', 'rb-done'));
    const openByBlock = new Map<string, boolean>();
    for (const c of comments) openByBlock.set(c.blockId, (openByBlock.get(c.blockId) ?? false) || !c.resolved);
    for (const [blockId, open] of openByBlock) {
      findBlock(root, blockId)?.classList.add('rb-commented', open ? 'rb-open' : 'rb-done');
    }
  }, [report?.html, comments, editMode]);

  // 本文の外側（右の余白）に置く注記アイコンの位置を計算する
  const measure = useCallback(() => {
    const root = bodyRef.current;
    const wrap = wrapRef.current;
    if (!root || !wrap) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    const byTop = new Map<number, Marker>();
    const byBlock = new Map<string, ReportComment[]>();
    for (const c of comments) byBlock.set(c.blockId, [...(byBlock.get(c.blockId) ?? []), c]);
    for (const [blockId, list] of byBlock) {
      const el = findBlock(root, blockId);
      if (!el) continue;
      const top = Math.round(visibleAnchor(root, el).getBoundingClientRect().top - wrapTop);
      const open = list.some((c) => !c.resolved);
      const prev = byTop.get(top);
      byTop.set(top, prev
        ? { ...prev, count: prev.count + list.length, open: prev.open || open }
        : { blockId, top, count: list.length, open });
    }
    setMarkers([...byTop.values()]);
  }, [comments]);

  useEffect(() => { measure(); }, [measure, report?.html, editMode]);

  // Toggle の開閉・Mermaid 描画・画像読込・画面幅変更で本文の高さが変わったら測り直す
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure, report?.id, editMode]);

  const handleBodyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.rb-snapshot-close')) target.closest('.rb-snapshot')?.remove();
  };

  const handleMouseOver = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-block-id]');
    if (!el || !wrapRef.current || !bodyRef.current?.contains(el)) return;
    const top = el.getBoundingClientRect().top - wrapRef.current.getBoundingClientRect().top;
    setHover({ id: el.dataset.blockId!, top });
  };

  const copyLink = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportShareUrl(report.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('共有リンク', reportShareUrl(report.id));
    }
  };

  const startDraft = (blockId: string) => {
    setDraftBlockId(blockId);
    setPanelOpen(true);
  };

  const finishEdit = (saved: boolean) => {
    setEditMode(false);
    // 編集で開いた URL（…/edit）は閲覧用に戻す
    if (/\/edit(\?|$)/.test(location.hash)) history.replaceState(null, '', location.hash.replace(/\/edit(?=\?|$)/, ''));
    if (saved) load();
  };

  // 右の一覧から本文の該当ブロックへ移動。閉じた Toggle は開き、原文が変わっていれば下に表示
  const jumpTo = (c: ReportComment) => {
    const root = bodyRef.current;
    if (!root) return;
    root.querySelectorAll('.rb-snapshot').forEach((n) => n.remove());
    const el = findBlock(root, c.blockId);
    if (!el) return;
    for (let p: HTMLElement | null = el; p && p !== root; p = p.parentElement) {
      if (p.tagName === 'DETAILS') (p as HTMLDetailsElement).open = true;
    }
    const current = blockMap.get(c.blockId)?.text ?? '';
    if (!isNonTextBlock(c.blockType, c.snapshot) && current.slice(0, SNAPSHOT_MAX) !== c.snapshot) {
      const note = document.createElement('div');
      note.className = 'rb-snapshot';
      const label = document.createElement('span');
      label.className = 'rb-snapshot-label';
      label.textContent = '📝 注記時の原文：';
      const text = document.createElement('span');
      text.textContent = `「${c.snapshot}」`;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'rb-snapshot-close';
      close.textContent = '×';
      note.append(label, text, close);
      el.appendChild(note);
    }
    el.classList.remove('rb-flash');
    void el.offsetWidth; // 連続クリックでもアニメーションをやり直す
    el.classList.add('rb-flash');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (loading && !report) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={20} /> 読み込み中...
      </div>
    );
  }
  if (!report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-neutral-500">
        <AlertCircle size={28} className="text-red-400" />
        <p>{error || 'レポートが見つかりません'}</p>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">再読み込み</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-neutral-800 flex">
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200 px-6 h-14 flex items-center gap-3">
          <h1 className="font-bold text-lg truncate">{report.title || '(無題)'}</h1>
          {report.status !== '公開中' && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-500">{report.status || '下書き'}（プレビュー）</span>
          )}
          <span className="shrink-0 text-xs text-neutral-400">更新 {formatDateTime(report.updatedTime)}</span>
          {error && <span className="text-xs text-red-500 truncate">{error}</span>}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {!editMode && (
              <>
                {editKey && report.status === '公開中' && (
                  <button
                    onClick={copyLink}
                    className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
                    title={copied ? 'コピーしました' : '共有リンクをコピー'}
                  >
                    {copied ? <Check size={16} className="text-emerald-600" /> : <Link2 size={16} />}
                  </button>
                )}
                {editKey && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
                    title="編集"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  onClick={load}
                  disabled={loading}
                  className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
                  title="最新に更新"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </>
            )}
            {editMode && <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">編集中</span>}
            {!panelOpen && (
              <button onClick={() => setPanelOpen(true)} className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100" title="注記パネルを開く">
                <PanelRightOpen size={18} />
              </button>
            )}
          </div>
        </header>

        {editMode ? (
          <div className="max-w-4xl mx-auto px-6 py-8">
            <Suspense fallback={<div className="py-16 flex justify-center text-neutral-400"><Loader2 className="animate-spin" size={20} /></div>}>
              <ReportEditor reportId={report.id} editKey={editKey} onSaved={() => finishEdit(true)} onCancel={() => finishEdit(false)} />
            </Suspense>
          </div>
        ) : (
          <div ref={wrapRef} className="relative max-w-4xl mx-auto px-6 py-8 pr-28" onMouseLeave={() => setHover(null)}>
            <div
              ref={bodyRef}
              className="report-body bg-white border border-neutral-200 rounded-xl p-8 shadow-sm"
              onClick={handleBodyClick}
              onMouseOver={handleMouseOver}
              dangerouslySetInnerHTML={{ __html: report.html }}
            />

            {/* 注記アイコン（本文の外側） */}
            {markers.map((m) => (
              <button
                key={`${m.blockId}-${m.top}`}
                onClick={() => { setPanelOpen(true); setFocus({ blockId: m.blockId, seq: Date.now() }); }}
                style={{ top: m.top, right: 52 }}
                className={`absolute flex items-center gap-0.5 px-1.5 py-1 rounded-md text-xs border bg-white shadow-sm ${
                  m.open ? 'text-orange-600 border-orange-200 hover:bg-orange-50' : 'text-neutral-400 border-neutral-200 hover:bg-neutral-50'
                }`}
                title="注記を表示"
              >
                <NoteIcon size={15} /> {m.count}
              </button>
            ))}

            {hover && (
              <button
                onClick={() => startDraft(hover.id)}
                style={{ top: hover.top }}
                className="absolute right-4 p-1.5 rounded-md bg-white border border-neutral-200 shadow-sm text-neutral-500 hover:text-blue-600 hover:border-blue-300"
                title="このブロックに注記を追加"
              >
                <MessageSquarePlus size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {panelOpen && (
        <aside className="w-[30%] min-w-[320px] max-w-[480px] shrink-0 border-l border-neutral-200 bg-white sticky top-0 h-screen flex flex-col">
          <div className="h-14 px-4 border-b border-neutral-200 flex items-center justify-between shrink-0">
            <span className="font-semibold text-sm">注記</span>
            <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100" title="注記パネルを閉じる">
              <PanelRightClose size={18} />
            </button>
          </div>
          <ReportCommentPanel
            reportId={report.id}
            comments={comments}
            setComments={setComments}
            blockIndex={blockIndex}
            blockMap={blockMap}
            draftBlockId={draftBlockId}
            onDraftDone={() => setDraftBlockId(null)}
            focus={focus}
            onJump={jumpTo}
          />
        </aside>
      )}
    </div>
  );
}
