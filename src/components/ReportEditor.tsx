import { useEffect, useRef, useState } from 'react';
import {
  EditorContent, Extension, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor,
  type Editor, type JSONContent, type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import CodeBlock from '@tiptap/extension-code-block';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import {
  Bold, ChevronDown, Code, CodeSquare, Eraser, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List,
  ListChecks, ListCollapse, ListOrdered, Loader2, Minus, Pilcrow, Quote, Redo2, Strikethrough, Table as TableIcon,
  Underline as UnderlineIcon, Undo2,
} from 'lucide-react';

// レポートの編集画面（Tiptap）。読み込み・保存は Notion 原稿との変換をサーバーで行う。
// 各ブロックは Notion のブロック ID（blockId）を持ち、保存は差分のみ（注記を保つため）。
// 色は Notion の 9 色、見出しは 1〜3 のみ（Notion に保存できる範囲）。

const NOTION_COLORS: { name: string; label: string; text: string; bg: string }[] = [
  { name: 'gray', label: 'グレー', text: '#787774', bg: '#F1F1EF' },
  { name: 'brown', label: 'ブラウン', text: '#9F6B53', bg: '#F4EEEE' },
  { name: 'orange', label: 'オレンジ', text: '#D9730D', bg: '#FBECDD' },
  { name: 'yellow', label: 'イエロー', text: '#CB912F', bg: '#FBF3DB' },
  { name: 'green', label: 'グリーン', text: '#448361', bg: '#EDF3EC' },
  { name: 'blue', label: 'ブルー', text: '#337EA9', bg: '#E7F3F8' },
  { name: 'purple', label: 'パープル', text: '#9065B0', bg: '#F6F3F9' },
  { name: 'pink', label: 'ピンク', text: '#C14C8A', bg: '#FAF1F5' },
  { name: 'red', label: 'レッド', text: '#D44C47', bg: '#FDEBEC' },
];

const CODE_LANGUAGES = ['plain text', 'mermaid', 'javascript', 'typescript', 'java', 'python', 'sql', 'json', 'html', 'css', 'shell', 'bash', 'xml', 'yaml', 'markdown'];

// 各ブロックに Notion のブロック ID を持たせる。Enter で分割した新しい段落には引き継がない
const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'image', 'table', 'tableRow', 'details'],
      attributes: {
        blockId: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-block-id'),
          renderHTML: (attrs: Record<string, any>) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
        },
      },
    }];
  },
});

// 新しく挿入した画像は保存時に Notion へアップロードし、その ID を持たせる
const ReportImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: { default: null, renderHTML: () => ({}), parseHTML: () => null },
    };
  },
});

// 段組み・コールアウト等、編集画面では扱えないブロック（そのまま残す。削除はできる）
const NotionBlock = Node.create({
  name: 'notionBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { blockId: { default: null }, label: { default: '' }, html: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-notion-block]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-notion-block': '' }, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 're-readonly';
      dom.contentEditable = 'false';
      const label = document.createElement('div');
      label.className = 're-readonly-label';
      label.textContent = `🔒 ${node.attrs.label}（Notion で編集してください）`;
      const body = document.createElement('div');
      body.innerHTML = node.attrs.html; // サーバーで HTML エスケープ済み
      dom.append(label, body);
      return { dom };
    };
  },
});

function MermaidPreview({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      if (!code.trim()) {
        if (ref.current) ref.current.innerHTML = '';
        return;
      }
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        const { svg } = await mermaid.render(`re-mermaid-${Math.random().toString(36).slice(2)}`, code);
        if (alive && ref.current) { ref.current.innerHTML = svg; setError(''); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '図の描画に失敗しました');
      }
    }, 500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code]);
  return (
    <div contentEditable={false} className="re-mermaid-preview">
      <div ref={ref} />
      {error && <p className="text-xs text-red-500 whitespace-pre-wrap">{error}</p>}
    </div>
  );
}

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = String(node.attrs.language || 'plain text');
  return (
    <NodeViewWrapper className="re-code">
      <select
        contentEditable={false}
        value={CODE_LANGUAGES.includes(language) ? language : 'plain text'}
        onChange={(e) => updateAttributes({ language: e.target.value })}
        className="re-code-lang"
      >
        {CODE_LANGUAGES.map((l) => <option key={l} value={l}>{l === 'mermaid' ? 'Mermaid（図）' : l}</option>)}
      </select>
      <pre><NodeViewContent<'code'> as="code" /></pre>
      {language === 'mermaid' && <MermaidPreview code={node.textContent} />}
    </NodeViewWrapper>
  );
}

const ReportCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// コピー＆ペーストで同じブロック ID が複数できたら、後のものは新規扱いにする
function dedupeBlockIds(node: JSONContent, seen = new Set<string>()) {
  const id = node.attrs?.blockId;
  if (id) {
    if (seen.has(id)) node.attrs!.blockId = null;
    else seen.add(id);
  }
  node.content?.forEach((child) => dedupeBlockIds(child, seen));
}

function collectImages(node: JSONContent, out: JSONContent[] = []) {
  if (node.type === 'image') out.push(node);
  node.content?.forEach((child) => collectImages(child, out));
  return out;
}

interface Props {
  reportId: string;
  editKey: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function ReportEditor({ reportId, editKey, onSaved, onCancel }: Props) {
  const [initial, setInitial] = useState<JSONContent | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/reports/${encodeURIComponent(reportId)}/doc`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) setInitial(d.doc); })
      .catch(() => { if (alive) setLoadError('編集内容の読み込みに失敗しました'); });
    return () => { alive = false; };
  }, [reportId]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      TextStyle,
      Color,
      BackgroundColor,
      Highlight.configure({ multicolor: true }),
      ReportImage.configure({ allowBase64: true }),
      ReportCodeBlock,
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      NotionBlock,
      BlockId,
    ],
    content: initial ?? undefined,
    editable: !!initial,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'report-body report-editor-body focus:outline-none' },
      // 画像ファイルの貼り付け・ドロップ（スクリーンショット等）
      handlePaste: (view, event) => insertImageFiles(view, event.clipboardData?.files),
      handleDrop: (view, event) => insertImageFiles(view, (event as DragEvent).dataTransfer?.files),
    },
    onUpdate: () => setDirty(true),
  }, [initial]);

  function insertImageFiles(view: any, files: FileList | null | undefined): boolean {
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return false;
    images.forEach(async (file) => {
      if (file.size > 5 * 1024 * 1024) {
        setSaveError('画像は 5MB までです');
        return;
      }
      const src = await readAsDataUrl(file);
      const nodeType = view.state.schema.nodes.image;
      view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create({ src })));
    });
    return true;
  }

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    if (file.size > 5 * 1024 * 1024) {
      setSaveError('画像は 5MB までです');
      return;
    }
    editor.chain().focus().setImage({ src: await readAsDataUrl(file) }).run();
  };

  const save = async () => {
    if (!editor || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const doc = editor.getJSON();
      dedupeBlockIds(doc);
      // 新しく入れた画像（data URL）を Notion へアップロード
      for (const img of collectImages(doc)) {
        const src = String(img.attrs?.src ?? '');
        if (img.attrs?.blockId || img.attrs?.uploadId || !src.startsWith('data:')) continue;
        const blob = await (await fetch(src)).blob();
        const form = new FormData();
        form.append('file', blob, `image.${blob.type.split('/')[1] ?? 'png'}`);
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/upload`, { method: 'POST', headers: { 'X-Report-Key': editKey }, body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '画像のアップロードに失敗しました');
        img.attrs = { ...img.attrs, uploadId: data.uploadId };
      }
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Report-Key': editKey },
        body: JSON.stringify({ doc }),
      });
      if (res.status === 403) throw new Error('編集権限がありません（レポート一覧から開き直してください）');
      if (!res.ok) throw new Error('保存に失敗しました（一部だけ反映された可能性があります。最新に更新して確認してください）');
      setDirty(false);
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm('保存していない変更があります。破棄しますか？')) return;
    onCancel();
  };

  // 未保存のままタブを閉じようとしたら確認
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (loadError) return <p className="text-sm text-red-500 py-8 text-center">{loadError}</p>;
  if (!initial || !editor) {
    return <div className="py-16 flex justify-center text-neutral-400"><Loader2 className="animate-spin" size={20} /></div>;
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm">
      <Toolbar editor={editor} onPickImage={() => fileRef.current?.click()} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
      <div className="px-8 py-6">
        <EditorContent editor={editor} />
      </div>
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-neutral-200 px-4 py-2.5 flex items-center gap-3 rounded-b-xl">
        {saveError && <span className="text-xs text-red-500">{saveError}</span>}
        {!saveError && dirty && <span className="text-xs text-neutral-400">未保存の変更があります</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={cancel} disabled={saving} className="text-sm px-4 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100">キャンセル</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ツールバー ──

function ToolButton({ active, disabled, onClick, title, children }: {
  active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // エディタの選択範囲を保つ
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 ${active ? 'bg-blue-50 text-blue-700' : ''}`}
    >
      {children}
    </button>
  );
}

function ColorMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const textColor = editor.getAttributes('textStyle').color as string | undefined;
  const bgColor = editor.getAttributes('textStyle').backgroundColor as string | undefined;
  const apply = (fn: () => void) => { fn(); setOpen(false); };
  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title="文字色・背景色（ハイライト）"
        className="flex items-center gap-0.5 px-1.5 py-1 rounded hover:bg-neutral-100"
      >
        <span className="text-sm font-semibold px-1 rounded" style={{ color: textColor, backgroundColor: bgColor }}>A</span>
        <ChevronDown size={12} className="text-neutral-400" />
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 space-y-2">
          <div>
            <p className="text-[11px] text-neutral-400 mb-1">文字色</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(() => editor.chain().focus().unsetColor().run())}
                className="w-6 h-6 rounded border border-neutral-200 text-xs" title="標準">A</button>
              {NOTION_COLORS.map((c) => (
                <button key={c.name} type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(() => editor.chain().focus().setColor(c.text).run())}
                  className="w-6 h-6 rounded border border-neutral-200 text-xs font-semibold" style={{ color: c.text }} title={c.label}>A</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] text-neutral-400 mb-1">背景色（ハイライト）</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(() => editor.chain().focus().unsetBackgroundColor().unsetHighlight().run())}
                className="w-6 h-6 rounded border border-neutral-200 text-[10px]" title="なし">✕</button>
              {NOTION_COLORS.map((c) => (
                <button key={c.name} type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(() => editor.chain().focus().unsetHighlight().setBackgroundColor(c.bg).run())}
                  className="w-6 h-6 rounded border border-neutral-200" style={{ backgroundColor: c.bg }} title={c.label} />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-neutral-400">※ 文字色と背景色を両方付けた場合、保存時は背景色が優先されます（Notion の仕様）</p>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive('table');
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('リンク先の URL（空欄でリンク解除）', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const sep = <span className="w-px h-5 bg-neutral-200 mx-1" />;

  return (
    <div className="sticky top-14 z-20 bg-white/95 backdrop-blur border-b border-neutral-200 px-3 py-1.5 flex flex-wrap items-center gap-0.5 rounded-t-xl">
      <ToolButton title="元に戻す" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}><Undo2 size={16} /></ToolButton>
      <ToolButton title="やり直す" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}><Redo2 size={16} /></ToolButton>
      {sep}
      <ToolButton title="本文" active={editor.isActive('paragraph')} onClick={() => chain().setParagraph().run()}><Pilcrow size={16} /></ToolButton>
      <ToolButton title="見出し1" active={editor.isActive('heading', { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolButton>
      <ToolButton title="見出し2" active={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolButton>
      <ToolButton title="見出し3" active={editor.isActive('heading', { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></ToolButton>
      {sep}
      <ToolButton title="太字" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><Bold size={16} /></ToolButton>
      <ToolButton title="斜体" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><Italic size={16} /></ToolButton>
      <ToolButton title="下線" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}><UnderlineIcon size={16} /></ToolButton>
      <ToolButton title="取り消し線" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><Strikethrough size={16} /></ToolButton>
      <ToolButton title="インラインコード" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()}><Code size={16} /></ToolButton>
      <ColorMenu editor={editor} />
      <ToolButton title="リンク" active={editor.isActive('link')} onClick={setLink}><Link2 size={16} /></ToolButton>
      <ToolButton title="書式をクリア" onClick={() => chain().unsetAllMarks().run()}><Eraser size={16} /></ToolButton>
      {sep}
      <ToolButton title="箇条書き" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}><List size={16} /></ToolButton>
      <ToolButton title="番号付きリスト" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
      <ToolButton title="タスクリスト" active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()}><ListChecks size={16} /></ToolButton>
      <ToolButton title="引用" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}><Quote size={16} /></ToolButton>
      <ToolButton title="コードブロック（Mermaid 可）" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()}><CodeSquare size={16} /></ToolButton>
      <ToolButton title="折りたたみ（Toggle）" active={editor.isActive('details')} onClick={() => chain().setDetails().run()}><ListCollapse size={16} /></ToolButton>
      <ToolButton title="区切り線" onClick={() => chain().setHorizontalRule().run()}><Minus size={16} /></ToolButton>
      {sep}
      <ToolButton title="表を挿入" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></ToolButton>
      <ToolButton title="画像を挿入" onClick={onPickImage}><ImageIcon size={16} /></ToolButton>
      {inTable && (
        <>
          {sep}
          <span className="text-[11px] text-neutral-400 mr-1">表：</span>
          {[
            ['行を上に追加', () => chain().addRowBefore().run()],
            ['行を下に追加', () => chain().addRowAfter().run()],
            ['列を左に追加', () => chain().addColumnBefore().run()],
            ['列を右に追加', () => chain().addColumnAfter().run()],
            ['行を削除', () => chain().deleteRow().run()],
            ['列を削除', () => chain().deleteColumn().run()],
            ['見出し行 切替', () => chain().toggleHeaderRow().run()],
            ['表を削除', () => chain().deleteTable().run()],
          ].map(([label, fn]) => (
            <button key={label as string} type="button" onMouseDown={(e) => e.preventDefault()} onClick={fn as () => void}
              className="text-[11px] px-1.5 py-1 rounded text-neutral-600 hover:bg-neutral-100">{label as string}</button>
          ))}
        </>
      )}
    </div>
  );
}
