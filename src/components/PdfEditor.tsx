import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
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
  Undo2,
  Redo2,
  PaintBucket,
  Square,
  RefreshCw,
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
  // Resolved CSS-usable family from pdfjs textContent.styles[fontName].fontFamily.
  // May still be a quoted/exotic name that the browser can't render — fall back
  // to FONT_STACK in that case.
  fontFamily?: string;
}

interface PageData {
  pageNum: number;
  canvasW: number;
  canvasH: number;
  dataUrl: string;  // JPEG of rendered page
  scale: number;    // canvas px / PDF user unit
  items: TextItem[];
}

// Font stack for redrawn text — prefers Japanese MS Gothic, then Chinese SimHei,
// then generic sans-serif as a fallback. The export pipeline rasterises the
// page to PNG before embedding into the PDF, so these fonts only need to be
// installed on the machine generating the file; the resulting PDF is
// self-contained and renders identically anywhere.
const FONT_STACK = '"MS Gothic", "ＭＳ ゴシック", "MS ゴシック", "MS-Gothic", MSGothic, SimHei, sans-serif';

// Editor mode: standard text editing vs. table region editing
type EditorMode = 'text' | 'table';

// A row or column "band" — describes the position and size of a row/column
// inside a table. Deletion is destructive: removed bands are spliced out and
// subsequent bands shift to fill the gap. The cumulative size of all bands
// is allowed to differ from region.w/h after insert/delete; the renderer
// uses band positions directly, not the region bounds.
interface Band {
  start: number; // canvas px (y for rowBand, x for colBand)
  size: number;  // canvas px (h for rowBand, w for colBand)
}

// Visual style for a single cell. Phase 1 inferred from Adobe Extract API
// (fontSize / fontName / bold) plus defaults (color #111, bgColor transparent).
// All fields user-editable via the top toolbar.
interface CellStyle {
  fontSize: number;       // canvas px
  fontFamily: string;     // CSS font-family (already includes fallback chain)
  color: string;          // CSS colour string — text colour
  bold: boolean;          // Bold weight
  bgColor: string;        // CSS colour or 'transparent' for cell background
}

interface TableRegion {
  id: string;
  pageNum: number;
  // Outer table bounding box in canvas px (origin: top-left). Used as the
  // erase mask when redrawing — entire area is whited out before redrawing.
  x: number;
  y: number;
  w: number;
  h: number;
  rowBands: Band[];
  colBands: Band[];
  // Original cell text extracted from PDF — read-only baseline
  origCells: string[][];
  // User edits, keyed `${row}_${col}`; only modified cells appear here
  cellEdits: Record<string, string>;
  // Per-cell visual style
  cellStyles: Record<string, CellStyle>;
  // Table-wide border style (toolbar adjusts these)
  borderColor: string;
  borderWidth: number;     // canvas px
}

// ── Helpers ────────────────────────────────────────────────────────────

// Raw shape returned by /api/pdf-extract-tables
interface ExtractedTablePayload {
  pageIdx: number;
  bounds: [number, number, number, number]; // PDF user space: [x1, y1, x2, y2]
  rows: {
    bounds: [number, number, number, number];
    cells: {
      bounds: [number, number, number, number];
      text: string;
      fontSize?: number;
      fontName?: string;
      bold?: boolean;
    }[];
  }[];
}

interface ExtractTablesPayload {
  pageSizes: { width: number; height: number }[];
  tables: ExtractedTablePayload[];
}

/**
 * Convert an extracted-table payload (PDF user space) into a TableRegion
 * positioned in canvas px space (top-left origin). The provided `pageScale`
 * tells us canvas_px = pdf_user_unit * pageScale; `pageHeight` (PDF user
 * units) lets us flip the y-axis since PDF user space has bottom-left origin.
 *
 * Assumes Adobe's bounds are [x1, y1, x2, y2] with bottom-left origin.
 * Rows are expected ordered top→bottom by the backend.
 */
function buildTableFromExtracted(
  id: string,
  extracted: ExtractedTablePayload,
  pageHeight: number,
  pageScale: number,
  pageNum: number,
): TableRegion {
  const toCanvasX = (x: number) => x * pageScale;
  const toCanvasY = (y: number) => (pageHeight - y) * pageScale;

  const [bx1, by1, bx2, by2] = extracted.bounds;
  const x = toCanvasX(Math.min(bx1, bx2));
  const y = toCanvasY(Math.max(by1, by2));
  const w = Math.abs(bx2 - bx1) * pageScale;
  const h = Math.abs(by2 - by1) * pageScale;

  // Build row bands from row bounds (sorted top→bottom in canvas px)
  const rowEntries = extracted.rows.map(rw => {
    const [, ry1, , ry2] = rw.bounds;
    const top = toCanvasY(Math.max(ry1, ry2));
    const bottom = toCanvasY(Math.min(ry1, ry2));
    return { row: rw, top, bottom };
  });
  rowEntries.sort((a, b) => a.top - b.top);
  const rowBands: Band[] = rowEntries.map(e => ({
    start: e.top,
    size: Math.max(1, e.bottom - e.top),
  }));

  // Build col bands from the FIRST row's cell bounds (all rows assumed aligned)
  const firstRowCells = rowEntries[0]?.row.cells ?? [];
  const colEntries = firstRowCells.map(cell => {
    const [cx1, , cx2] = cell.bounds;
    return { left: toCanvasX(Math.min(cx1, cx2)), right: toCanvasX(Math.max(cx1, cx2)) };
  });
  colEntries.sort((a, b) => a.left - b.left);
  const colBands: Band[] = colEntries.length
    ? colEntries.map(c => ({ start: c.left, size: Math.max(1, c.right - c.left) }))
    : [{ start: x, size: w }];

  // Populate cell text + style by matching each cell's centre to (r, c) bands
  const rows = rowBands.length;
  const cols = colBands.length;
  const origCells: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''),
  );
  const cellStyles: Record<string, CellStyle> = {};

  const findBand = (bands: Band[], v: number): number => {
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (v >= b.start && v < b.start + b.size) return i;
    }
    // If v falls past the last band but within tolerance, snap to the last
    if (bands.length && v >= bands[bands.length - 1].start) return bands.length - 1;
    return v < (bands[0]?.start ?? 0) ? 0 : -1;
  };

  for (const rw of extracted.rows) {
    for (const cell of rw.cells) {
      const [cx1, cy1, cx2, cy2] = cell.bounds;
      const cx = toCanvasX((cx1 + cx2) / 2);
      const cy = toCanvasY((cy1 + cy2) / 2);
      const r = findBand(rowBands, cy);
      const c = findBand(colBands, cx);
      if (r < 0 || c < 0) continue;
      // Concatenate when multiple cells map to the same bucket
      if (origCells[r][c]) {
        origCells[r][c] = `${origCells[r][c]} ${cell.text}`.trim();
      } else {
        origCells[r][c] = cell.text;
      }
      // Style: take the first reported font for that cell
      if (!cellStyles[`${r}_${c}`]) {
        const fontSize = (cell.fontSize ?? 12) * pageScale; // pdf points → canvas px
        const fontFamily = cell.fontName
          ? `"${cell.fontName.replace(/[+\\,/]/g, '_')}", ${FONT_STACK}`
          : FONT_STACK;
        cellStyles[`${r}_${c}`] = {
          fontSize: Math.max(8, fontSize),
          fontFamily,
          color: '#111111',
          bold: cell.bold === true,
          bgColor: 'transparent',
        };
      }
    }
  }

  // Default style for cells with no extracted text
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cellStyles[`${r}_${c}`]) {
        cellStyles[`${r}_${c}`] = {
          fontSize: 12,
          fontFamily: FONT_STACK,
          color: '#111111',
          bold: false,
          bgColor: 'transparent',
        };
      }
    }
  }

  return {
    id,
    pageNum,
    x, y, w, h,
    rowBands,
    colBands,
    origCells,
    cellEdits: {},
    cellStyles,
    borderColor: '#000000',
    borderWidth: 1,
  };
}

/**
 * Paint each table by FULL REDRAW (WPS-style): erase the original table area,
 * then redraw the grid and every cell using user-controlled styles. The
 * underlying PDF pixels for the table region are entirely replaced — only
 * surrounding non-table content remains.
 *
 *   1. Fill region with white (covers original glyphs + rules)
 *   2. Per-cell background colour (skip if 'transparent')
 *   3. Grid lines using region.borderColor + borderWidth
 *   4. Every cell's text (origCells[r][c] or cellEdits[r_c]) using cellStyles
 */
function paintTablesOnCanvas(
  ctx: CanvasRenderingContext2D,
  tables: TableRegion[],
) {
  for (const t of tables) {
    // 1. White-out the entire table region
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(t.x, t.y, t.w, t.h);

    // 2. Cell backgrounds
    for (let r = 0; r < t.rowBands.length; r++) {
      const rb = t.rowBands[r];
      for (let c = 0; c < t.colBands.length; c++) {
        const cb = t.colBands[c];
        const style = t.cellStyles[`${r}_${c}`];
        if (!style || !style.bgColor || style.bgColor === 'transparent') continue;
        ctx.fillStyle = style.bgColor;
        ctx.fillRect(cb.start, rb.start, cb.size, rb.size);
      }
    }

    // Total grid extents (sum of band sizes — may differ from t.w/h after insert/delete)
    const totalH = t.rowBands.reduce((s, b) => s + b.size, 0);
    const totalW = t.colBands.reduce((s, b) => s + b.size, 0);

    // 3. Grid lines
    if (t.borderWidth > 0) {
      ctx.strokeStyle = t.borderColor;
      ctx.lineWidth = t.borderWidth;
      ctx.beginPath();
      // Horizontal lines: top edge of each row, plus bottom of last row
      for (let r = 0; r <= t.rowBands.length; r++) {
        const y = r < t.rowBands.length
          ? t.rowBands[r].start
          : (t.rowBands[t.rowBands.length - 1]?.start ?? t.y) +
            (t.rowBands[t.rowBands.length - 1]?.size ?? 0);
        ctx.moveTo(t.x, y);
        ctx.lineTo(t.x + totalW, y);
      }
      // Vertical lines
      for (let c = 0; c <= t.colBands.length; c++) {
        const x = c < t.colBands.length
          ? t.colBands[c].start
          : (t.colBands[t.colBands.length - 1]?.start ?? t.x) +
            (t.colBands[t.colBands.length - 1]?.size ?? 0);
        ctx.moveTo(x, t.y);
        ctx.lineTo(x, t.y + totalH);
      }
      ctx.stroke();
    }

    // 4. Cell text — draw every cell (not just edited ones, since we wiped the region)
    ctx.textBaseline = 'middle';
    const PAD = 4;
    for (let r = 0; r < t.rowBands.length; r++) {
      const rb = t.rowBands[r];
      for (let c = 0; c < t.colBands.length; c++) {
        const cb = t.colBands[c];
        const key = `${r}_${c}`;
        const text = t.cellEdits[key] ?? t.origCells[r]?.[c] ?? '';
        if (!text) continue;
        const cellX = cb.start;
        const cellY = rb.start;
        const cellW = cb.size;
        const cellH = rb.size;
        if (cellW < 2 || cellH < 2) continue;

        const style = t.cellStyles[key] ?? {
          fontSize: Math.min(Math.max(cellH * 0.55, 9), 16),
          fontFamily: FONT_STACK,
          color: '#111111',
          bold: false,
          bgColor: 'transparent',
        };
        ctx.fillStyle = style.color;
        const weight = style.bold ? 'bold ' : '';
        let fontSize = style.fontSize;
        ctx.font = `${weight}${fontSize}px ${style.fontFamily}`;
        while (ctx.measureText(text).width > cellW - PAD * 2 && fontSize > 7) {
          fontSize -= 1;
          ctx.font = `${weight}${fontSize}px ${style.fontFamily}`;
        }
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

  // pdfjs styles map: { [fontName]: { fontFamily, ascent, descent, vertical } }
  const styles = (textContent as { styles?: Record<string, { fontFamily?: string }> }).styles ?? {};

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

    // Resolve fontName → fontFamily via styles map. pdfjs assigns synthetic IDs
    // like "g_d0_f1" to fontName, and styles[id].fontFamily holds the actual
    // font family string. May be missing if pdfjs couldn't parse the font.
    const fontName = (raw as { fontName?: string }).fontName;
    const fontFamily = fontName && styles[fontName]?.fontFamily;

    items.push({
      id: `p${pageNum}i${idx++}`,
      str: raw.str,
      x: Math.round(vx),
      y: Math.round(vy - ascent),
      w: Math.round(Math.max(itemW, 10)),
      h: Math.round(itemH),
      fontSize,
      fontFamily: fontFamily || undefined,
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
      ctx.font = `${item.fontSize}px ${FONT_STACK}`;
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
        fontFamily: FONT_STACK,
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
  // Per-page PDF user-space size (for converting Adobe coords to canvas px).
  // Lives alongside `pages` but addressed by 1-based pageNum.
  const [pdfPageSizes, setPdfPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  // Overlay canvas ref — re-drawn whenever the current page's tables change
  const tableLayerRef = useRef<HTMLCanvasElement>(null);

  // Auto-recognition state
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // WPS-style in-place editing
  const [editingCell, setEditingCell] = useState<{ regionId: string; r: number; c: number } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ regionId: string; r: number; c: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; regionId: string; r: number; c: number;
  } | null>(null);
  // Currently selected cell (drives toolbar — single click selects, double-click edits)
  const [selectedCell, setSelectedCell] = useState<{ regionId: string; r: number; c: number } | null>(null);

  // Undo/redo: history of pageTables snapshots. Capped to 50 entries to keep memory bounded.
  const HISTORY_LIMIT = 50;
  const [history, setHistory] = useState<Record<number, TableRegion[]>[]>([]);
  const [future, setFuture] = useState<Record<number, TableRegion[]>[]>([]);

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

  // Dismiss the context menu when the user clicks anywhere else or hits Escape
  useEffect(() => {
    if (!contextMenu) return;
    const onDown = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Redraw the table overlay layer whenever the current page's tables change.
  // The overlay canvas sits on top of the rendered PDF image; we paint the
  // full page background onto it first so paintTablesOnCanvas can sample real
  // pixel colours for edited cells (the underlying <img> is purely a fallback).
  useEffect(() => {
    let cancelled = false;
    const canvas = tableLayerRef.current;
    const page = pages[currentPageIdx];
    if (!canvas || !page) return;
    if (canvas.width !== page.canvasW) canvas.width = page.canvasW;
    if (canvas.height !== page.canvasH) canvas.height = page.canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const tables = page.pageNum != null ? pageTables[page.pageNum] ?? [] : [];
      paintTablesOnCanvas(ctx, tables);
    };
    img.src = page.dataUrl;
    return () => { cancelled = true; };
  }, [pages, currentPageIdx, pageTables]);

  const loadPdf = useCallback(async (f: File) => {
    setLoading(true);
    setUploadError(null);
    setEditedTexts({});
    setPageTables({});
    setPdfPageSizes({});
    setEditingCell(null);
    setHoveredCell(null);
    setContextMenu(null);
    setSelectedCell(null);
    setHistory([]);
    setFuture([]);
    setExtractError(null);
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

  // Push the current pageTables snapshot onto the undo stack before mutating.
  // Always clears the redo stack — a fresh user action invalidates the future.
  const pushHistory = () => {
    setHistory(prev => {
      const next = [...prev, pageTables];
      if (next.length > HISTORY_LIMIT) next.shift();
      return next;
    });
    setFuture([]);
  };

  const undo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setFuture(f => [pageTables, ...f]);
      setPageTables(last);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture(prev => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setHistory(h => [...h, pageTables]);
      setPageTables(next);
      return prev.slice(1);
    });
  };

  // Generic region updater. `recordHistory=true` snapshots state for undo.
  const updateRegion = (
    regionId: string,
    updater: (r: TableRegion) => TableRegion,
    recordHistory = true,
  ) => {
    if (currentPageNum == null) return;
    if (recordHistory) pushHistory();
    setPageTables(prev => ({
      ...prev,
      [currentPageNum]: (prev[currentPageNum] ?? []).map(r => (r.id === regionId ? updater(r) : r)),
    }));
  };

  const removeRegion = (regionId: string) => {
    if (currentPageNum == null) return;
    pushHistory();
    setPageTables(prev => ({
      ...prev,
      [currentPageNum]: (prev[currentPageNum] ?? []).filter(r => r.id !== regionId),
    }));
  };

  // Edit cell text. Reverting to the original value drops the override.
  const editCell = (regionId: string, rowIdx: number, colIdx: number, value: string) => {
    updateRegion(regionId, r => {
      const key = `${rowIdx}_${colIdx}`;
      const orig = r.origCells[rowIdx]?.[colIdx] ?? '';
      const nextEdits = { ...r.cellEdits };
      if (value === orig) delete nextEdits[key];
      else nextEdits[key] = value;
      return { ...r, cellEdits: nextEdits };
    });
  };

  // Update one cell's visual style (toolbar uses this)
  const updateCellStyle = (
    regionId: string,
    rowIdx: number,
    colIdx: number,
    patch: Partial<CellStyle>,
  ) => {
    updateRegion(regionId, r => {
      const key = `${rowIdx}_${colIdx}`;
      const cur = r.cellStyles[key] ?? {
        fontSize: 12, fontFamily: FONT_STACK, color: '#111111', bold: false, bgColor: 'transparent',
      };
      return {
        ...r,
        cellStyles: { ...r.cellStyles, [key]: { ...cur, ...patch } },
      };
    });
  };

  // Update region-level fields (toolbar border colour / width)
  const updateRegionFields = (regionId: string, patch: Partial<TableRegion>) => {
    updateRegion(regionId, r => ({ ...r, ...patch }));
  };

  // Re-pack bands so they tile contiguously from a starting position. Sets each
  // band's `start` to the cumulative offset of preceding bands.
  const repackBands = (bands: Band[], origin: number): Band[] => {
    let cursor = origin;
    return bands.map(b => {
      const out: Band = { start: cursor, size: b.size };
      cursor += b.size;
      return out;
    });
  };

  // True deletion of a row: removes the band, re-packs subsequent rows upward
  // by the deleted height, and shifts cellEdits / cellStyles / origCells.
  const deleteRow = (regionId: string, rowIdx: number) => {
    updateRegion(regionId, r => {
      if (r.rowBands.length <= 1) return r; // refuse to delete the last row
      const newBands = repackBands(
        r.rowBands.filter((_, i) => i !== rowIdx),
        r.rowBands[0]?.start ?? r.y,
      );
      const origCells = r.origCells.filter((_, i) => i !== rowIdx);
      const remapKey = (key: string): string | null => {
        const [rStr, cStr] = key.split('_');
        const rr = Number(rStr);
        if (rr === rowIdx) return null;
        return rr > rowIdx ? `${rr - 1}_${cStr}` : key;
      };
      const cellEdits: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.cellEdits)) {
        const nk = remapKey(k);
        if (nk !== null) cellEdits[nk] = v;
      }
      const cellStyles: Record<string, CellStyle> = {};
      for (const [k, v] of Object.entries(r.cellStyles)) {
        const nk = remapKey(k);
        if (nk !== null) cellStyles[nk] = v;
      }
      return { ...r, rowBands: newBands, origCells, cellEdits, cellStyles };
    });
  };

  const deleteCol = (regionId: string, colIdx: number) => {
    updateRegion(regionId, r => {
      if (r.colBands.length <= 1) return r;
      const newBands = repackBands(
        r.colBands.filter((_, i) => i !== colIdx),
        r.colBands[0]?.start ?? r.x,
      );
      const origCells = r.origCells.map(row => row.filter((_, j) => j !== colIdx));
      const remapKey = (key: string): string | null => {
        const [rStr, cStr] = key.split('_');
        const cc = Number(cStr);
        if (cc === colIdx) return null;
        return cc > colIdx ? `${rStr}_${cc - 1}` : key;
      };
      const cellEdits: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.cellEdits)) {
        const nk = remapKey(k);
        if (nk !== null) cellEdits[nk] = v;
      }
      const cellStyles: Record<string, CellStyle> = {};
      for (const [k, v] of Object.entries(r.cellStyles)) {
        const nk = remapKey(k);
        if (nk !== null) cellStyles[nk] = v;
      }
      return { ...r, colBands: newBands, origCells, cellEdits, cellStyles };
    });
  };

  // Insert a new row at anchorIdx (above) or anchorIdx+1 (below). Existing
  // rows shift down by the new row's height; the table grows downward.
  const insertRow = (regionId: string, anchorIdx: number, above: boolean) => {
    updateRegion(regionId, r => {
      const insertAt = above ? anchorIdx : anchorIdx + 1;
      const anchorBand = r.rowBands[anchorIdx];
      const newSize = anchorBand?.size ?? (r.h / Math.max(1, r.rowBands.length));
      const newBand: Band = { start: 0, size: newSize };
      const draftBands = [...r.rowBands];
      draftBands.splice(insertAt, 0, newBand);
      const rowBands = repackBands(draftBands, r.rowBands[0]?.start ?? r.y);

      const newRow = Array.from({ length: r.colBands.length }, () => '');
      const origCells = [
        ...r.origCells.slice(0, insertAt),
        newRow,
        ...r.origCells.slice(insertAt),
      ];
      const remap = (key: string): string => {
        const [rStr, cStr] = key.split('_');
        const rr = Number(rStr);
        return rr >= insertAt ? `${rr + 1}_${cStr}` : key;
      };
      const cellEdits: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.cellEdits)) cellEdits[remap(k)] = v;
      const cellStyles: Record<string, CellStyle> = {};
      for (const [k, v] of Object.entries(r.cellStyles)) cellStyles[remap(k)] = v;
      // New row inherits the anchor row's per-cell style
      for (let c = 0; c < r.colBands.length; c++) {
        const anchorStyle = r.cellStyles[`${anchorIdx}_${c}`];
        cellStyles[`${insertAt}_${c}`] = anchorStyle ?? {
          fontSize: 12, fontFamily: FONT_STACK, color: '#111111',
          bold: false, bgColor: 'transparent',
        };
      }

      // Extend region.h by the new band size
      const newH = r.h + newSize;
      return { ...r, rowBands, origCells, cellEdits, cellStyles, h: newH };
    });
  };

  const insertCol = (regionId: string, anchorIdx: number, left: boolean) => {
    updateRegion(regionId, r => {
      const insertAt = left ? anchorIdx : anchorIdx + 1;
      const anchorBand = r.colBands[anchorIdx];
      const newSize = anchorBand?.size ?? (r.w / Math.max(1, r.colBands.length));
      const newBand: Band = { start: 0, size: newSize };
      const draftBands = [...r.colBands];
      draftBands.splice(insertAt, 0, newBand);
      const colBands = repackBands(draftBands, r.colBands[0]?.start ?? r.x);

      const origCells = r.origCells.map(row => [
        ...row.slice(0, insertAt),
        '',
        ...row.slice(insertAt),
      ]);
      const remap = (key: string): string => {
        const [rStr, cStr] = key.split('_');
        const cc = Number(cStr);
        return cc >= insertAt ? `${rStr}_${cc + 1}` : key;
      };
      const cellEdits: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.cellEdits)) cellEdits[remap(k)] = v;
      const cellStyles: Record<string, CellStyle> = {};
      for (const [k, v] of Object.entries(r.cellStyles)) cellStyles[remap(k)] = v;
      for (let rr = 0; rr < r.rowBands.length; rr++) {
        const anchorStyle = r.cellStyles[`${rr}_${anchorIdx}`];
        cellStyles[`${rr}_${insertAt}`] = anchorStyle ?? {
          fontSize: 12, fontFamily: FONT_STACK, color: '#111111',
          bold: false, bgColor: 'transparent',
        };
      }

      const newW = r.w + newSize;
      return { ...r, colBands, origCells, cellEdits, cellStyles, w: newW };
    });
  };

  // Auto-recognise tables via Adobe Extract API. Called when entering table mode
  // for the first time, or via the "重新识别" button.
  const fetchAndPopulateTables = useCallback(async () => {
    if (!file) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/pdf-extract-tables', { method: 'POST', body: formData });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || '识别失败');
      }
      const payload = (await resp.json()) as ExtractTablesPayload;
      // Build pdfPageSizes map (1-based pageNum)
      const sizes: Record<number, { width: number; height: number }> = {};
      payload.pageSizes.forEach((sz, i) => { sizes[i + 1] = sz; });
      setPdfPageSizes(sizes);

      // Group extracted tables by 1-based pageNum and build TableRegions
      const out: Record<number, TableRegion[]> = {};
      for (const t of payload.tables) {
        const pageNum = t.pageIdx + 1;
        const page = pages.find(p => p.pageNum === pageNum);
        const pageSize = payload.pageSizes[t.pageIdx];
        if (!page || !pageSize) continue;
        const region = buildTableFromExtracted(
          `t-${pageNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          t,
          pageSize.height,
          page.scale,
          pageNum,
        );
        (out[pageNum] ??= []).push(region);
      }
      setPageTables(out);
      setHistory([]);
      setFuture([]);
    } catch (err) {
      console.error('extract tables failed', err);
      setExtractError(err instanceof Error ? err.message : '识别失败');
    } finally {
      setExtracting(false);
    }
  }, [file, pages]);

  // Context menu open/close
  const openContextMenu = (
    e: ReactMouseEvent,
    regionId: string,
    r: number,
    c: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, regionId, r, c });
  };
  const closeContextMenu = () => setContextMenu(null);

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
    setPdfPageSizes({});
    setEditingCell(null);
    setHoveredCell(null);
    setContextMenu(null);
    setSelectedCell(null);
    setHistory([]);
    setFuture([]);
    setExtractError(null);
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

              {/* Mode switch */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
                  <button
                    onClick={() => {
                      setMode('text');
                      setEditingCell(null);
                      setHoveredCell(null);
                      setContextMenu(null);
                    }}
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
                    onClick={() => {
                      setMode('table');
                      // Auto-detect on first entry if no tables yet
                      if (Object.keys(pageTables).length === 0 && !extracting) {
                        void fetchAndPopulateTables();
                      }
                    }}
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

                {mode === 'text' && (
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
                )}
              </div>

              {/* Table mode: top toolbar — drives selected cell's style and region border */}
              {mode === 'table' && (() => {
                const sel = selectedCell;
                const selRegion = sel ? currentTables.find(t => t.id === sel.regionId) : null;
                const selStyle = sel && selRegion
                  ? selRegion.cellStyles[`${sel.r}_${sel.c}`]
                  : null;
                const disabled = !sel || !selRegion;
                return (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white rounded-lg border border-neutral-200 shadow-sm">
                    {/* Undo / Redo */}
                    <button
                      onClick={undo}
                      disabled={history.length === 0}
                      title="撤销 (Ctrl+Z)"
                      className="p-1.5 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Undo2 size={15} />
                    </button>
                    <button
                      onClick={redo}
                      disabled={future.length === 0}
                      title="重做 (Ctrl+Y)"
                      className="p-1.5 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Redo2 size={15} />
                    </button>
                    <div className="w-px h-5 bg-neutral-200" />

                    {/* Font size */}
                    <label className="flex items-center gap-1.5 text-xs">
                      <span className="text-neutral-500">字号</span>
                      <input
                        type="number"
                        min={6}
                        max={48}
                        value={selStyle ? Math.round(selStyle.fontSize) : ''}
                        disabled={disabled}
                        onChange={e => {
                          if (!sel) return;
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 6 && v <= 48) {
                            updateCellStyle(sel.regionId, sel.r, sel.c, { fontSize: v });
                          }
                        }}
                        className="w-14 px-2 py-1 border border-neutral-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-neutral-50 disabled:text-neutral-400"
                      />
                    </label>

                    {/* Bold */}
                    <button
                      onClick={() => sel && selStyle && updateCellStyle(sel.regionId, sel.r, sel.c, { bold: !selStyle.bold })}
                      disabled={disabled}
                      title="加粗 (Ctrl+B)"
                      className={[
                        'p-1.5 rounded text-sm font-bold transition-colors',
                        disabled ? 'text-neutral-300 cursor-not-allowed' :
                          selStyle?.bold ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:bg-neutral-100',
                      ].join(' ')}
                      style={{ minWidth: 28 }}
                    >
                      B
                    </button>

                    {/* Font color */}
                    <label className="flex items-center gap-1 text-xs" title="字体颜色">
                      <Type size={13} className="text-neutral-500" />
                      <input
                        type="color"
                        value={selStyle?.color ?? '#111111'}
                        disabled={disabled}
                        onChange={e => sel && updateCellStyle(sel.regionId, sel.r, sel.c, { color: e.target.value })}
                        className="w-7 h-7 rounded cursor-pointer border border-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    </label>

                    {/* Cell background */}
                    <label className="flex items-center gap-1 text-xs" title="单元格背景色">
                      <PaintBucket size={13} className="text-neutral-500" />
                      <input
                        type="color"
                        value={selStyle?.bgColor && selStyle.bgColor !== 'transparent' ? selStyle.bgColor : '#ffffff'}
                        disabled={disabled}
                        onChange={e => sel && updateCellStyle(sel.regionId, sel.r, sel.c, { bgColor: e.target.value })}
                        className="w-7 h-7 rounded cursor-pointer border border-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                      <button
                        onClick={() => sel && updateCellStyle(sel.regionId, sel.r, sel.c, { bgColor: 'transparent' })}
                        disabled={disabled}
                        title="清除背景"
                        className="text-[10px] px-1 py-0.5 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ✕
                      </button>
                    </label>

                    <div className="w-px h-5 bg-neutral-200" />

                    {/* Border color + width (region-level) */}
                    <label className="flex items-center gap-1 text-xs" title="表格边框颜色">
                      <Square size={13} className="text-neutral-500" />
                      <input
                        type="color"
                        value={selRegion?.borderColor ?? '#000000'}
                        disabled={!selRegion}
                        onChange={e => selRegion && updateRegionFields(selRegion.id, { borderColor: e.target.value })}
                        className="w-7 h-7 rounded cursor-pointer border border-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs" title="边框粗细 (0 = 无边框)">
                      <span className="text-neutral-500">粗</span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.5}
                        value={selRegion?.borderWidth ?? 1}
                        disabled={!selRegion}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 0 && v <= 5 && selRegion) {
                            updateRegionFields(selRegion.id, { borderWidth: v });
                          }
                        }}
                        className="w-12 px-1.5 py-1 border border-neutral-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-neutral-50 disabled:text-neutral-400"
                      />
                    </label>

                    <div className="flex-1" />

                    {/* Re-detect button */}
                    <button
                      onClick={() => { if (!extracting) void fetchAndPopulateTables(); }}
                      disabled={extracting || !file}
                      title="重新识别表格"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {extracting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      重新识别
                    </button>

                    <span className="text-[11px] text-neutral-400 ml-1">
                      {selRegion ? (
                        sel ? `选中 #${currentTables.indexOf(selRegion) + 1} (R${sel.r + 1}/C${sel.c + 1})` : `选中 #${currentTables.indexOf(selRegion) + 1}`
                      ) : '点击单元格选中后调样式'}
                    </span>
                  </div>
                );
              })()}

              {/* Table mode loading state */}
              {mode === 'table' && extracting && (
                <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-700 text-sm">
                  <Loader2 size={15} className="animate-spin" />
                  正在通过 Adobe PDF Extract 识别表格(约 30-60 秒)...
                </div>
              )}
              {mode === 'table' && extractError && !extracting && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
                  <AlertCircle size={15} />
                  识别失败:{extractError}
                </div>
              )}
              {mode === 'table' && !extracting && !extractError && currentTables.length === 0 && (
                <div className="text-xs text-neutral-400 px-3 py-2">
                  当前页未识别到表格。可点击"重新识别"重试,或翻页查看其他页面。
                </div>
              )}

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

                    {/* WPS-style cell grid overlays: in-place double-click
                        edit, hover highlight, right-click menu. One overlay
                        per table region on the current page. Lives above the
                        drag-select layer so single-clicks on cells don't
                        accidentally start a new selection. */}
                    {mode === 'table' && currentTables.map(t => (
                      <div
                        key={`grid-${t.id}`}
                        style={{
                          position: 'absolute',
                          left: t.x,
                          top: t.y,
                          width: t.w,
                          height: t.h,
                          zIndex: 35,
                        }}
                      >
                        {t.rowBands.map((rb, r) =>
                          t.colBands.map((cb, c) => {
                            const key = `${r}_${c}`;
                            const isEditing =
                              editingCell?.regionId === t.id &&
                              editingCell.r === r &&
                              editingCell.c === c;
                            const isHoveredRow =
                              hoveredCell?.regionId === t.id && hoveredCell.r === r;
                            const isHoveredCol =
                              hoveredCell?.regionId === t.id && hoveredCell.c === c;
                            const style = t.cellStyles[key];
                            const orig = t.origCells[r]?.[c] ?? '';
                            const edited = t.cellEdits[key];
                            const value = edited ?? orig;

                            // Hovered row/col gets a light tint. Selected cell
                            // gets a stronger highlight (drives the toolbar).
                            const isSelected =
                              selectedCell?.regionId === t.id &&
                              selectedCell.r === r &&
                              selectedCell.c === c;

                            return (
                              <div
                                key={key}
                                onMouseEnter={() => setHoveredCell({ regionId: t.id, r, c })}
                                onMouseLeave={() =>
                                  setHoveredCell(prev =>
                                    prev?.regionId === t.id && prev.r === r && prev.c === c
                                      ? null
                                      : prev,
                                  )
                                }
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => {
                                  e.stopPropagation();
                                  setSelectedCell({ regionId: t.id, r, c });
                                }}
                                onDoubleClick={e => {
                                  e.stopPropagation();
                                  setSelectedCell({ regionId: t.id, r, c });
                                  setEditingCell({ regionId: t.id, r, c });
                                }}
                                onContextMenu={e => {
                                  setSelectedCell({ regionId: t.id, r, c });
                                  openContextMenu(e, t.id, r, c);
                                }}
                                style={{
                                  position: 'absolute',
                                  left: cb.start - t.x,
                                  top: rb.start - t.y,
                                  width: cb.size,
                                  height: rb.size,
                                  cursor: 'text',
                                  background:
                                    isHoveredRow || isHoveredCol
                                      ? 'rgba(99,102,241,0.06)'
                                      : 'transparent',
                                  outline: isSelected
                                    ? '2px solid #6366f1'
                                    : 'none',
                                  outlineOffset: '-2px',
                                  boxSizing: 'border-box',
                                }}
                              >
                                {isEditing && (
                                  <input
                                    autoFocus
                                    defaultValue={value}
                                    onMouseDown={e => e.stopPropagation()}
                                    onDoubleClick={e => e.stopPropagation()}
                                    onBlur={e => {
                                      editCell(t.id, r, c, e.target.value);
                                      setEditingCell(null);
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                    style={{
                                      position: 'absolute',
                                      inset: 0,
                                      width: '100%',
                                      height: '100%',
                                      fontSize: style?.fontSize ?? 12,
                                      fontFamily: style?.fontFamily ?? FONT_STACK,
                                      color: style?.color ?? '#111',
                                      background: 'rgba(255,255,255,0.97)',
                                      border: '1.5px solid #6366f1',
                                      outline: 'none',
                                      padding: '0 4px',
                                      boxSizing: 'border-box',
                                      lineHeight: 1,
                                    }}
                                  />
                                )}
                              </div>
                            );
                          }),
                        )}
                      </div>
                    ))}

                  </div>
                </div>
              )}

              {/* Per-table summary cards — editing happens on the canvas (WPS-style).
                  Each card just shows status and lets the user discard the table. */}
              {currentTables.length > 0 && (
                <div className="space-y-2">
                  {currentTables.map((t, idx) => {
                    const totalRows = t.rowBands.length;
                    const totalCols = t.colBands.length;
                    const editCount = Object.keys(t.cellEdits).length;

                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <TableIcon size={14} className="text-indigo-600 flex-shrink-0" />
                          <span className="text-sm font-bold text-indigo-700">
                            表格 #{idx + 1}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {totalRows} 行 × {totalCols} 列
                          </span>
                          {editCount > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                              {editCount} 处编辑
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeRegion(t.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                          title="重新框选(放弃当前表格,恢复原 PDF 这块内容)"
                        >
                          <Trash2 size={12} />
                          重新框选
                        </button>
                      </div>
                    );
                  })}
                  <p className="text-xs text-neutral-400 pl-1">
                    操作:双击单元格编辑文字 · 鼠标右键弹出菜单(删除/插入行列) · 字号字体自动从原 PDF 提取
                  </p>
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

      {/* WPS-style right-click context menu — fixed-positioned at cursor */}
      {contextMenu && (() => {
        const region = (currentTables.find(t => t.id === contextMenu.regionId)) ?? null;
        if (!region) return null;
        const canDeleteRow = region.rowBands.length > 1;
        const canDeleteCol = region.colBands.length > 1;
        const item = (
          label: string,
          onClick: () => void,
          opts: { disabled?: boolean; danger?: boolean } = {},
        ) => (
          <button
            onClick={() => { if (!opts.disabled) { onClick(); closeContextMenu(); } }}
            disabled={opts.disabled}
            className={[
              'block w-full text-left px-3 py-1.5 text-sm transition-colors',
              opts.disabled ? 'text-neutral-300 cursor-not-allowed' : 'hover:bg-neutral-100',
              opts.danger && !opts.disabled ? 'text-red-600' : 'text-neutral-700',
            ].join(' ')}
          >
            {label}
          </button>
        );
        return (
          <div
            onMouseDown={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 320),
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              zIndex: 60,
              padding: '4px 0',
              minWidth: 170,
            }}
          >
            {item('编辑文字', () => setEditingCell({
              regionId: contextMenu.regionId,
              r: contextMenu.r,
              c: contextMenu.c,
            }))}
            <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
            {item('上方插入行', () => insertRow(contextMenu.regionId, contextMenu.r, true))}
            {item('下方插入行', () => insertRow(contextMenu.regionId, contextMenu.r, false))}
            {item('左侧插入列', () => insertCol(contextMenu.regionId, contextMenu.c, true))}
            {item('右侧插入列', () => insertCol(contextMenu.regionId, contextMenu.c, false))}
            <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
            {item('删除该行', () => deleteRow(contextMenu.regionId, contextMenu.r), {
              disabled: !canDeleteRow, danger: canDeleteRow,
            })}
            {item('删除该列', () => deleteCol(contextMenu.regionId, contextMenu.c), {
              disabled: !canDeleteCol, danger: canDeleteCol,
            })}
            <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
            {item('移除整张表格', () => removeRegion(contextMenu.regionId), { danger: true })}
          </div>
        );
      })()}
    </div>
  );
}
