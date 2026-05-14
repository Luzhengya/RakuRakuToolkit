import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  Upload,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Save,
  FileText,
  RotateCcw,
  FilePen,
  Download,
  Type,
  Table as TableIcon,
  Trash2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Canvas render width (px). All text positions are in this coordinate space.
const PAGE_WIDTH = 880;

// ── Types ─────────────────────────────────────────────────────────────

interface TextItem {
  id: string;
  str: string;
  x: number;      // left edge in canvas px
  y: number;      // top edge in canvas px
  w: number;      // width in canvas px
  h: number;      // height in canvas px
  fontSize: number; // font size in canvas px
}

interface PageData {
  pageNum: number;
  canvasW: number;
  canvasH: number;
  dataUrl: string;  // JPEG of rendered page
  scale: number;    // canvas px / PDF user unit
  items: TextItem[];
}

// Editor mode: standard text editing vs. table region editing
type EditorMode = 'text' | 'table';

interface TableRegion {
  id: string;
  pageNum: number;
  // Rectangle in canvas px (top-left origin)
  x: number;
  y: number;
  w: number;
  h: number;
  rows: number;
  cols: number;
  cells: string[][]; // [rowIdx][colIdx]
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * For a freshly-drawn table region, assign each original text item to a cell
 * based on its centre point. Items in the same cell are joined left-to-right
 * with a single space.
 */
function autoFillCells(region: TableRegion, items: TextItem[]): string[][] {
  const cellW = region.w / region.cols;
  const cellH = region.h / region.rows;
  const cells: string[][] = Array.from({ length: region.rows }, () =>
    Array.from({ length: region.cols }, () => ''),
  );
  const bucket: TextItem[][][] = Array.from({ length: region.rows }, () =>
    Array.from({ length: region.cols }, () => [] as TextItem[]),
  );

  for (const it of items) {
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    if (cx < region.x || cx >= region.x + region.w) continue;
    if (cy < region.y || cy >= region.y + region.h) continue;
    const col = Math.min(region.cols - 1, Math.floor((cx - region.x) / cellW));
    const row = Math.min(region.rows - 1, Math.floor((cy - region.y) / cellH));
    bucket[row][col].push(it);
  }

  for (let r = 0; r < region.rows; r++) {
    for (let c = 0; c < region.cols; c++) {
      bucket[r][c].sort((a, b) => a.x - b.x);
      cells[r][c] = bucket[r][c].map(it => it.str).join(' ').trim();
    }
  }
  return cells;
}

/**
 * Paint all table regions for a page onto a 2D context.
 * For each region: fill white over the original area, then draw black gridlines
 * and the (edited) cell text. Works in canvas px space.
 */
function paintTablesOnCanvas(
  ctx: CanvasRenderingContext2D,
  tables: TableRegion[],
) {
  for (const t of tables) {
    // White out the original area (covers original glyphs and rules)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(t.x, t.y, t.w, t.h);

    const cellW = t.w / t.cols;
    const cellH = t.h / t.rows;

    // Gridlines
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r <= t.rows; r++) {
      const y = t.y + r * cellH;
      ctx.moveTo(t.x, y);
      ctx.lineTo(t.x + t.w, y);
    }
    for (let c = 0; c <= t.cols; c++) {
      const x = t.x + c * cellW;
      ctx.moveTo(x, t.y);
      ctx.lineTo(x, t.y + t.h);
    }
    ctx.stroke();

    // Cell text — auto-shrink to fit, fall back to clipping
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    const PAD = 4;
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const text = (t.cells[r]?.[c] ?? '').trim();
        if (!text) continue;
        const cellX = t.x + c * cellW;
        const cellY = t.y + r * cellH;
        const innerW = cellW - PAD * 2;
        const innerH = cellH - PAD * 2;
        // Start from cell-height-based font, but clamp so it fits horizontally
        let fontSize = Math.min(Math.max(innerH * 0.6, 9), 18);
        ctx.font = `${fontSize}px sans-serif`;
        let metrics = ctx.measureText(text);
        while (metrics.width > innerW && fontSize > 7) {
          fontSize -= 1;
          ctx.font = `${fontSize}px sans-serif`;
          metrics = ctx.measureText(text);
        }
        // Clip to cell bounds so overflow doesn't bleed
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX + 1, cellY + 1, cellW - 2, cellH - 2);
        ctx.clip();
        ctx.fillText(text, cellX + PAD, cellY + cellH / 2);
        ctx.restore();
      }
    }
  }
}

async function renderAndExtract(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
): Promise<PageData> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = PAGE_WIDTH / base.width;
  const viewport = page.getViewport({ scale });

  // Render page to off-screen canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Extract text positions
  const textContent = await page.getTextContent();
  const items: TextItem[] = [];
  let idx = 0;

  for (const raw of textContent.items) {
    if (!('str' in raw) || !raw.str.trim()) continue;

    const tx = raw.transform as number[];
    // tx = [a, b, c, d, e, f] — PDF text matrix
    // (e, f) is the text origin in PDF user space (baseline, bottom-left origin)
    const [vx, vy] = viewport.convertToViewportPoint(tx[4], tx[5]);

    // Font size: use pdfjs-reported height if present, else compute from matrix
    const pdfFontH = (raw as { height?: number }).height || Math.hypot(tx[2], tx[3]);
    const fontSize = Math.max(pdfFontH * scale, 6);

    const itemW = ((raw as { width?: number }).width ?? 0) * scale;
    if (itemW < 2) continue;

    // vy is baseline position (top-left canvas origin)
    // Shift up by ~ascent to get the visual top of the glyph box
    const ascent = fontSize * 0.82;
    const itemH = fontSize * 1.25; // ascent + descent

    items.push({
      id: `p${pageNum}i${idx++}`,
      str: raw.str,
      x: Math.round(vx),
      y: Math.round(vy - ascent),
      w: Math.round(Math.max(itemW, 10)),
      h: Math.round(itemH),
      fontSize,
    });
  }

  return {
    pageNum,
    canvasW: canvas.width,
    canvasH: canvas.height,
    dataUrl,
    scale,
    items,
  };
}

/**
 * For each modified page: redraw the page with edits applied via Canvas 2D API
 * (handles CJK correctly since browser handles glyph rendering), then embed
 * the result as an image into the PDF.  Unmodified pages are left untouched.
 *
 * Modifications include text edits (per item) and table regions (per page).
 */
async function buildModifiedPdf(
  file: File,
  pages: PageData[],
  edits: Record<string, string>,
  pageTables: Record<number, TableRegion[]>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(await file.arrayBuffer());
  const pdfPages = pdfDoc.getPages();

  for (const pd of pages) {
    const changed = pd.items.filter(
      it => edits[it.id] !== undefined && edits[it.id] !== it.str,
    );
    const tables = pageTables[pd.pageNum] ?? [];
    if (changed.length === 0 && tables.length === 0) continue;

    // Build modified canvas frame
    const canvas = document.createElement('canvas');
    canvas.width = pd.canvasW;
    canvas.height = pd.canvasH;
    const ctx = canvas.getContext('2d')!;

    // Draw original rendered page as background
    const bgImg = await new Promise<HTMLImageElement>(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = pd.dataUrl;
    });
    ctx.drawImage(bgImg, 0, 0);

    // Paint tables (white overlay + gridlines + cell text)
    paintTablesOnCanvas(ctx, tables);

    // Apply each text edit: erase original, draw new text
    for (const item of changed) {
      const newText = edits[item.id];

      // Measure new text width to ensure the erase region is wide enough
      ctx.font = `${item.fontSize}px sans-serif`;
      const measuredW = ctx.measureText(newText).width;
      const eraseW = Math.max(item.w, measuredW);

      // Sample background color from just outside the left edge of the text box
      // (avoids sampling on top of the text glyphs themselves)
      const sampleX = Math.max(0, item.x - 4);
      const sampleY = Math.min(canvas.height - 1, Math.round(item.y + item.h / 2));
      const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
      const bgColor = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;

      ctx.fillStyle = bgColor;
      ctx.fillRect(item.x - 2, item.y - 2, eraseW + 4, item.h + 4);

      // Draw replacement text
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';
      ctx.fillText(newText, item.x, item.y + item.fontSize * 0.05);
    }

    // Export canvas as PNG → embed in pdf-lib
    const pngBytes = await new Promise<Uint8Array>(resolve => {
      canvas.toBlob(
        b => b!.arrayBuffer().then(ab => resolve(new Uint8Array(ab))),
        'image/png',
      );
    });

    const pdfPage = pdfPages[pd.pageNum - 1];
    const { width: pw, height: ph } = pdfPage.getSize();
    const embedded = await pdfDoc.embedPng(pngBytes);

    // Blank existing page content, then draw the modified image on top
    pdfPage.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(1, 1, 1) });
    pdfPage.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
  }

  return pdfDoc.save();
}

// ── EditableTextItem ───────────────────────────────────────────────────

interface EditableTextItemProps {
  item: TextItem;
  value: string;
  onChange: (v: string) => void;
  isFocused: boolean;
  isModified: boolean;
  onFocus: () => void;
  onBlur: () => void;
}

function EditableTextItem({
  item,
  value,
  onChange,
  isFocused,
  isModified,
  onFocus,
  onBlur,
}: EditableTextItemProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  // Sync content when value changes externally (e.g. reset)
  useEffect(() => {
    const el = divRef.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        onFocus();
        // Ensure the div shows the current value when editing begins
        if (divRef.current && divRef.current.textContent !== value) {
          divRef.current.textContent = value;
        }
      }}
      onBlur={e => {
        onBlur();
        onChange(e.currentTarget.textContent ?? '');
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
        if (e.key === 'Escape') {
          // Revert to original
          if (divRef.current) divRef.current.textContent = item.str;
          onChange(item.str);
          (e.target as HTMLElement).blur();
        }
      }}
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        width: item.w,
        minHeight: item.h,
        fontSize: item.fontSize,
        lineHeight: '1.25',
        fontFamily: 'sans-serif',
        // Normal: transparent so PDF text shows through
        // Hover: subtle indigo tint
        // Modified: amber highlight
        // Focused: white bg + visible black text
        color: isFocused ? '#111111' : 'transparent',
        backgroundColor: isFocused
          ? 'rgba(255,255,255,0.97)'
          : isModified
          ? 'rgba(251,191,36,0.22)'
          : hovered
          ? 'rgba(99,102,241,0.09)'
          : 'transparent',
        border: isFocused
          ? '1.5px solid #6366f1'
          : isModified
          ? '1px dashed #f59e0b'
          : hovered
          ? '1px solid rgba(99,102,241,0.3)'
          : '1px solid transparent',
        borderRadius: 2,
        outline: 'none',
        padding: '0 1px',
        cursor: 'text',
        whiteSpace: 'pre',
        overflow: 'visible',
        boxSizing: 'border-box',
        zIndex: isFocused ? 20 : 10,
        pointerEvents: 'all',
        caretColor: '#6366f1',
        transition: 'background-color 0.1s, border-color 0.1s',
      }}
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function PdfEditor({ onBack }: { onBack: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null!);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Table-mode state ────────────────────────────────────────────────
  const [mode, setMode] = useState<EditorMode>('text');
  // Tables keyed by 1-based page number
  const [pageTables, setPageTables] = useState<Record<number, TableRegion[]>>({});
  // In-progress rectangle selection (canvas px, top-left origin)
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Pending region: selection finished, awaiting rows/cols input
  const [pendingRegion, setPendingRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pendingRows, setPendingRows] = useState(3);
  const [pendingCols, setPendingCols] = useState(3);
  // Overlay canvas ref — re-drawn whenever the current page's tables change
  const tableLayerRef = useRef<HTMLCanvasElement>(null);

  // Count genuinely modified text items
  const textEditCount = Object.entries(editedTexts).filter(([id, v]) => {
    for (const pg of pages) {
      const it = pg.items.find(x => x.id === id);
      if (it) return v !== it.str;
    }
    return false;
  }).length;

  const tableCount = (Object.values(pageTables) as TableRegion[][]).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalEdits = textEditCount + tableCount;

  // Mirror totalEdits into a ref so stable callbacks can read the live value
  const totalEditsRef = useRef(0);
  useEffect(() => {
    totalEditsRef.current = totalEdits;
  }, [totalEdits]);

  // Redraw the table overlay layer whenever the current page's tables change.
  // The overlay canvas sits on top of the rendered PDF image but below the
  // contenteditable text layer; it shows the live white-out + grid + cell text
  // so the user sees the result in real time.
  useEffect(() => {
    const canvas = tableLayerRef.current;
    const page = pages[currentPageIdx];
    if (!canvas || !page) return;
    if (canvas.width !== page.canvasW) canvas.width = page.canvasW;
    if (canvas.height !== page.canvasH) canvas.height = page.canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const tables = page.pageNum != null ? pageTables[page.pageNum] ?? [] : [];
    paintTablesOnCanvas(ctx, tables);
  }, [pages, currentPageIdx, pageTables]);

  const loadPdf = useCallback(async (f: File) => {
    setLoading(true);
    setUploadError(null);
    setEditedTexts({});
    setPageTables({});
    setPendingRegion(null);
    setDragRect(null);
    setMode('text');
    setCurrentPageIdx(0);
    setProgress({ current: 0, total: 0 });

    try {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const total = pdf.numPages;
      setProgress({ current: 0, total });

      const result: PageData[] = [];
      for (let i = 1; i <= total; i++) {
        setProgress({ current: i, total });
        result.push(await renderAndExtract(pdf, i));
      }
      setFile(f);
      setPages(result);
    } catch (err) {
      console.error(err);
      setUploadError('PDF 读取失败，请确认文件未损坏');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!confirmDiscardEdits()) return;
    loadPdf(f);
  };

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const dropped: File[] = e.dataTransfer.files ? Array.from<File>(e.dataTransfer.files) : [];
      if (dropped.length === 0) return;
      const f = dropped[0];
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        setUploadError('请上传 .pdf 格式的文件');
        return;
      }
      const pending = totalEditsRef.current;
      if (pending > 0 && !window.confirm(`当前有 ${pending} 处未保存的修改，确定要丢弃并加载新文件吗？`)) {
        return;
      }
      if (dropped.length > 1) {
        setUploadError(`PDF 编辑器每次只能处理一个文件，已加载「${f.name}」，其余文件已忽略`);
      } else {
        setUploadError(null);
      }
      loadPdf(f);
    },
    [loadPdf],
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // ── Table editing callbacks ─────────────────────────────────────────

  const currentPageNum = pages[currentPageIdx]?.pageNum;
  const currentTables: TableRegion[] =
    currentPageNum != null ? pageTables[currentPageNum] ?? [] : [];

  const beginDragSelect = (canvasX: number, canvasY: number) => {
    dragStartRef.current = { x: canvasX, y: canvasY };
    setDragRect({ x: canvasX, y: canvasY, w: 0, h: 0 });
  };

  const updateDragSelect = (canvasX: number, canvasY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const x = Math.min(start.x, canvasX);
    const y = Math.min(start.y, canvasY);
    const w = Math.abs(canvasX - start.x);
    const h = Math.abs(canvasY - start.y);
    setDragRect({ x, y, w, h });
  };

  const finishDragSelect = () => {
    const r = dragRect;
    dragStartRef.current = null;
    setDragRect(null);
    if (!r || r.w < 24 || r.h < 24) return; // ignore tiny accidental drags
    setPendingRegion(r);
    setPendingRows(3);
    setPendingCols(3);
  };

  const cancelPendingRegion = () => {
    setPendingRegion(null);
  };

  const confirmPendingRegion = () => {
    if (!pendingRegion || currentPageNum == null) return;
    const page = pages[currentPageIdx];
    const region: TableRegion = {
      id: `t-${currentPageNum}-${Date.now()}`,
      pageNum: currentPageNum,
      x: pendingRegion.x,
      y: pendingRegion.y,
      w: pendingRegion.w,
      h: pendingRegion.h,
      rows: Math.max(1, Math.min(50, pendingRows | 0)),
      cols: Math.max(1, Math.min(20, pendingCols | 0)),
      cells: [],
    };
    region.cells = autoFillCells(region, page.items);
    setPageTables(prev => ({
      ...prev,
      [currentPageNum]: [...(prev[currentPageNum] ?? []), region],
    }));
    setPendingRegion(null);
  };

  const updateRegion = (regionId: string, updater: (r: TableRegion) => TableRegion) => {
    if (currentPageNum == null) return;
    setPageTables(prev => ({
      ...prev,
      [currentPageNum]: (prev[currentPageNum] ?? []).map(r => (r.id === regionId ? updater(r) : r)),
    }));
  };

  const removeRegion = (regionId: string) => {
    if (currentPageNum == null) return;
    setPageTables(prev => ({
      ...prev,
      [currentPageNum]: (prev[currentPageNum] ?? []).filter(r => r.id !== regionId),
    }));
  };

  const editCell = (regionId: string, rowIdx: number, colIdx: number, value: string) => {
    updateRegion(regionId, r => {
      const cells = r.cells.map((row, i) =>
        i === rowIdx ? row.map((c, j) => (j === colIdx ? value : c)) : row,
      );
      return { ...r, cells };
    });
  };

  const deleteRow = (regionId: string, rowIdx: number) => {
    updateRegion(regionId, r => {
      if (r.rows <= 1) return r;
      const cellH = r.h / r.rows;
      return {
        ...r,
        rows: r.rows - 1,
        h: r.h - cellH,
        cells: r.cells.filter((_, i) => i !== rowIdx),
      };
    });
  };

  const deleteCol = (regionId: string, colIdx: number) => {
    updateRegion(regionId, r => {
      if (r.cols <= 1) return r;
      const cellW = r.w / r.cols;
      return {
        ...r,
        cols: r.cols - 1,
        w: r.w - cellW,
        cells: r.cells.map(row => row.filter((_, j) => j !== colIdx)),
      };
    });
  };

  // ── Save / reset ────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!file || saving || totalEdits === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const bytes = await buildModifiedPdf(file, pages, editedTexts, pageTables);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '_edited.pdf');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveSuccess(true);
    } catch (err) {
      console.error(err);
      setSaveError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const resetEditor = () => {
    if (totalEdits > 0 && !window.confirm(`当前有 ${totalEdits} 处未保存的修改，确定要丢弃并重新上传吗？`)) {
      return;
    }
    setFile(null);
    setPages([]);
    setEditedTexts({});
    setPageTables({});
    setPendingRegion(null);
    setDragRect(null);
    setMode('text');
    setCurrentPageIdx(0);
    setSaveError(null);
    setSaveSuccess(false);
    setUploadError(null);
  };

  const confirmDiscardEdits = (): boolean => {
    if (totalEdits === 0) return true;
    return window.confirm(`当前有 ${totalEdits} 处未保存的修改，确定要丢弃并加载新文件吗？`);
  };

  const currentPage = pages[currentPageIdx];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 transition-colors mb-6 group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        返回首页
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        {/* Card header */}
        <div className="px-8 pt-8 pb-0 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900">PDF 编辑</h2>
            <p className="text-neutral-500 mt-1">
              上传 PDF，点击文字区域直接修改内容，完成后下载修改版
            </p>
          </div>
          {file && (
            <button
              onClick={resetEditor}
              className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-700 transition-colors mt-1"
            >
              <RotateCcw size={14} />
              重新上传
            </button>
          )}
        </div>

        <div className="p-8 space-y-6">

          {/* ── Upload zone ── */}
          <AnimatePresence>
            {!file && !loading && (
              <motion.div
                key="upload"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={[
                    'cursor-pointer border-2 border-dashed rounded-xl p-14 text-center transition-all duration-300',
                    isDragging
                      ? 'border-violet-500 bg-violet-50 scale-[1.01]'
                      : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50',
                  ].join(' ')}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInput}
                    className="hidden"
                    accept=".pdf"
                  />
                  <div className="flex flex-col items-center gap-4">
                    <div
                      className={[
                        'w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300',
                        isDragging
                          ? 'bg-violet-100 text-violet-600 scale-110'
                          : 'bg-white shadow-sm text-neutral-400',
                      ].join(' ')}
                    >
                      <FilePen size={28} />
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-700 text-lg">
                        {isDragging ? '松开以载入 PDF' : '点击或拖拽上传 PDF 文件'}
                      </p>
                      <p className="text-sm text-neutral-400 mt-1">
                        仅支持单个 .pdf 文件，最大 50MB
                      </p>
                    </div>
                  </div>
                </div>

                {uploadError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600"
                  >
                    <AlertCircle size={15} />
                    <p className="text-sm">{uploadError}</p>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Loading / render progress ── */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-5 py-16"
            >
              <Loader2 size={36} className="animate-spin text-violet-500" />
              <div className="text-center">
                <p className="font-semibold text-neutral-700">正在渲染页面...</p>
                <p className="text-sm text-neutral-400 mt-1">
                  {progress.current} / {progress.total} 页
                </p>
              </div>
              <div className="w-64 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-violet-500 rounded-full"
                  animate={{
                    width:
                      progress.total > 0
                        ? `${(progress.current / progress.total) * 100}%`
                        : '0%',
                  }}
                  transition={{ duration: 0.15 }}
                />
              </div>
            </motion.div>
          )}

          {/* ── Editor ── */}
          {file && pages.length > 0 && (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-neutral-50 rounded-xl border border-neutral-100">
                {/* File name + edit badge */}
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={15} className="text-red-500 flex-shrink-0" />
                  <span
                    className="text-sm font-medium text-neutral-700 truncate"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  {textEditCount > 0 && (
                    <span className="flex-shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">
                      {textEditCount} 处文本
                    </span>
                  )}
                  {tableCount > 0 && (
                    <span className="flex-shrink-0 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[11px] font-bold rounded-full">
                      {tableCount} 个表格
                    </span>
                  )}
                </div>

                {/* Page navigation */}
                {pages.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPageIdx(i => Math.max(0, i - 1))}
                      disabled={currentPageIdx === 0}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-white disabled:opacity-25 transition-all"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium text-neutral-600 px-1 tabular-nums">
                      {currentPageIdx + 1} / {pages.length}
                    </span>
                    <button
                      onClick={() => setCurrentPageIdx(i => Math.min(pages.length - 1, i + 1))}
                      disabled={currentPageIdx === pages.length - 1}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-white disabled:opacity-25 transition-all"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={saving || totalEdits === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm font-bold rounded-lg hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed transition-all flex-shrink-0"
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      下载修改版
                    </>
                  )}
                </button>
              </div>

              {/* Mode switch + contextual legend */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
                  <button
                    onClick={() => { setMode('text'); setPendingRegion(null); setDragRect(null); }}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                      mode === 'text'
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-500 hover:text-neutral-800',
                    ].join(' ')}
                  >
                    <Type size={13} />
                    文本模式
                  </button>
                  <button
                    onClick={() => setMode('table')}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                      mode === 'table'
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-500 hover:text-neutral-800',
                    ].join(' ')}
                  >
                    <TableIcon size={13} />
                    表格模式
                  </button>
                </div>

                {mode === 'text' ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-3 border border-dashed border-amber-400 rounded-sm bg-amber-50" />
                      已修改
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-3 border-[1.5px] border-violet-500 rounded-sm bg-white/90" />
                      编辑中
                    </span>
                    <span className="text-neutral-300">
                      • 点击文字编辑 · Enter 或点击空白处确认 · Esc 还原
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-neutral-400">
                    在 PDF 上拖框 → 输入行/列数 → 自动识别为表格,可编辑单元格 / 删除行 / 删除列
                  </div>
                )}
              </div>

              {/* Page view: canvas background + table overlay + text overlay */}
              {currentPage && (
                <div className="overflow-x-auto">
                  <div
                    className="relative mx-auto rounded-xl border border-neutral-200 shadow-sm overflow-hidden"
                    style={{ width: currentPage.canvasW }}
                  >
                    {/* Rendered page image */}
                    <img
                      src={currentPage.dataUrl}
                      alt={`第 ${currentPageIdx + 1} 页`}
                      style={{
                        display: 'block',
                        width: currentPage.canvasW,
                        height: currentPage.canvasH,
                      }}
                      draggable={false}
                    />

                    {/* Table overlay layer (live-redrawn from pageTables) */}
                    <canvas
                      ref={tableLayerRef}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: currentPage.canvasW,
                        height: currentPage.canvasH,
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    />

                    {/* Editable text overlay — disabled while in table mode */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: mode === 'table' ? 'none' : 'auto',
                      }}
                    >
                      {currentPage.items.map(item => (
                        <EditableTextItem
                          key={item.id}
                          item={item}
                          value={editedTexts[item.id] ?? item.str}
                          onChange={v =>
                            setEditedTexts(prev => ({ ...prev, [item.id]: v }))
                          }
                          isFocused={focusedItemId === item.id}
                          isModified={
                            editedTexts[item.id] !== undefined &&
                            editedTexts[item.id] !== item.str
                          }
                          onFocus={() => setFocusedItemId(item.id)}
                          onBlur={() => setFocusedItemId(null)}
                        />
                      ))}
                    </div>

                    {/* Table-mode drag-select capture layer */}
                    {mode === 'table' && !pendingRegion && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          cursor: 'crosshair',
                          zIndex: 30,
                        }}
                        onMouseDown={e => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          beginDragSelect(
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                          );
                        }}
                        onMouseMove={e => {
                          if (!dragStartRef.current) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          updateDragSelect(
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                          );
                        }}
                        onMouseUp={finishDragSelect}
                        onMouseLeave={() => {
                          if (dragStartRef.current) finishDragSelect();
                        }}
                      >
                        {/* In-progress selection rectangle */}
                        {dragRect && (
                          <div
                            style={{
                              position: 'absolute',
                              left: dragRect.x,
                              top: dragRect.y,
                              width: dragRect.w,
                              height: dragRect.h,
                              background: 'rgba(99,102,241,0.18)',
                              border: '1.5px dashed #6366f1',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </div>
                    )}

                    {/* Pending region: rows/cols input popover */}
                    {mode === 'table' && pendingRegion && (
                      <>
                        <div
                          style={{
                            position: 'absolute',
                            left: pendingRegion.x,
                            top: pendingRegion.y,
                            width: pendingRegion.w,
                            height: pendingRegion.h,
                            background: 'rgba(99,102,241,0.12)',
                            border: '1.5px solid #6366f1',
                            pointerEvents: 'none',
                            zIndex: 25,
                          }}
                        />
                        <div
                          className="absolute bg-white rounded-lg shadow-xl border border-neutral-200 p-3 flex items-center gap-3"
                          style={{
                            left: Math.min(
                              pendingRegion.x,
                              currentPage.canvasW - 280,
                            ),
                            top: Math.min(
                              pendingRegion.y + pendingRegion.h + 8,
                              currentPage.canvasH - 60,
                            ),
                            zIndex: 40,
                          }}
                        >
                          <label className="flex items-center gap-1.5 text-xs">
                            <span className="text-neutral-500 font-medium">行</span>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={pendingRows}
                              onChange={e => setPendingRows(Number(e.target.value) || 1)}
                              className="w-14 px-2 py-1 border border-neutral-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs">
                            <span className="text-neutral-500 font-medium">列</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={pendingCols}
                              onChange={e => setPendingCols(Number(e.target.value) || 1)}
                              className="w-14 px-2 py-1 border border-neutral-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          </label>
                          <button
                            onClick={confirmPendingRegion}
                            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 transition-colors"
                          >
                            创建表格
                          </button>
                          <button
                            onClick={cancelPendingRegion}
                            className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Per-table editing panels (below canvas, current page only) */}
              {currentTables.length > 0 && (
                <div className="space-y-4">
                  {currentTables.map((t, idx) => (
                    <div
                      key={t.id}
                      className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <TableIcon size={14} className="text-indigo-600" />
                          <span className="text-sm font-bold text-indigo-700">
                            表格 #{idx + 1}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {t.rows} 行 × {t.cols} 列
                          </span>
                        </div>
                        <button
                          onClick={() => removeRegion(t.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          title="移除该表格(恢复原 PDF 这块内容)"
                        >
                          <Trash2 size={12} />
                          移除表格
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="border-collapse">
                          <thead>
                            <tr>
                              {/* Top-left empty corner */}
                              <th className="w-8 h-8 bg-neutral-100" />
                              {Array.from({ length: t.cols }, (_, c) => (
                                <th
                                  key={c}
                                  className="relative min-w-[100px] bg-neutral-100 border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-500"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span>列 {c + 1}</span>
                                    <button
                                      onClick={() => deleteCol(t.id, c)}
                                      disabled={t.cols <= 1}
                                      className="p-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      title="删除该列"
                                    >
                                      <X size={11} />
                                    </button>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {t.cells.map((row, r) => (
                              <tr key={r}>
                                <th className="w-8 bg-neutral-100 border border-neutral-200 px-1 text-[11px] font-semibold text-neutral-500">
                                  <div className="flex items-center justify-between gap-1">
                                    <span>{r + 1}</span>
                                    <button
                                      onClick={() => deleteRow(t.id, r)}
                                      disabled={t.rows <= 1}
                                      className="p-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      title="删除该行"
                                    >
                                      <X size={11} />
                                    </button>
                                  </div>
                                </th>
                                {row.map((cell, c) => (
                                  <td
                                    key={c}
                                    className="border border-neutral-200 bg-white p-0"
                                  >
                                    <input
                                      type="text"
                                      value={cell}
                                      onChange={e => editCell(t.id, r, c, e.target.value)}
                                      className="w-full min-w-[100px] px-2 py-1.5 text-sm bg-transparent outline-none focus:bg-indigo-50 transition-colors"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Save error */}
              {saveError && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600"
                >
                  <AlertCircle size={18} />
                  <p className="text-sm font-medium">{saveError}</p>
                </motion.div>
              )}

              {/* Save success */}
              {saveSuccess && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 bg-green-50 border border-green-100 rounded-lg flex items-center gap-3 text-green-600"
                >
                  <Download size={18} />
                  <p className="text-sm font-medium">
                    已下载修改版：{file?.name.replace(/\.pdf$/i, '_edited.pdf')}
                  </p>
                </motion.div>
              )}

              {/* Upload zone (inline, for re-upload without leaving page) */}
              <div className="pt-2 border-t border-neutral-100">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <Upload size={14} />
                  上传其他 PDF 文件
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInput}
                  className="hidden"
                  accept=".pdf"
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
