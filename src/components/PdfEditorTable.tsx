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
  ChevronLeft,
  ChevronRight,
  Save,
  FileText,
  RotateCcw,
  FilePen,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Canvas render width (px). All text positions are in this coordinate space.
const PAGE_WIDTH = 880;

// ── Types ─────────────────────────────────────────────────────────────

// 文字揃え。フォントサイズ・書体は元のまま維持し、テキストが元の領域より
// 長くなった場合にどちら向きへ伸ばすかを利用者が選べるようにする。
// left: 左端固定で右へ / right: 右端固定で左へ / center: 中央から両方向へ
type TextAlign = 'left' | 'center' | 'right';

// ── テーブル抽出 (技術検証) のレスポンス型 ──
interface ExtractedCell {
  row: number;
  col: number;
  text: string;
  bounds: number[] | null;
  isHeader: boolean;
}
interface ExtractedTable {
  index: number;
  page: number;
  rows: number;
  cols: number;
  bounds: number[] | null;
  cells: ExtractedCell[];
  caption: string | null;
  colFromBounds: boolean;
}
interface ExtractTablesResponse {
  fileName: string;
  tableCount: number;
  elementCount: number;
  tables: ExtractedTable[];
}

// セルの bounds は「文字の範囲」であり罫線の位置ではない。
// (中央揃えのヘッダは列より狭い範囲になる)
// そこで隣接する列の文字範囲の中間点を列の境界とみなし、両端は表の外形を使う。
// 戻り値は cols+1 個の境界 (PDFポイント)。
function deriveColumnEdges(tb: ExtractedTable): number[] | null {
  if (!tb.bounds || tb.cols < 1) return null;
  const spans: ({ l: number; r: number } | null)[] = [];
  for (let c = 1; c <= tb.cols; c++) {
    const cs = tb.cells.filter(x => x.col === c && x.bounds);
    spans.push(
      cs.length
        ? { l: Math.min(...cs.map(x => x.bounds![0])), r: Math.max(...cs.map(x => x.bounds![2])) }
        : null,
    );
  }
  const edges: number[] = [tb.bounds[0]];
  for (let i = 0; i < spans.length - 1; i++) {
    const a = spans[i];
    const b = spans[i + 1];
    // 片方が空列なら直前の境界を引き継ぐ (幅0の列として扱う)
    edges.push(a && b ? (a.r + b.l) / 2 : edges[edges.length - 1]);
  }
  edges.push(tb.bounds[2]);
  // 単調増加を保証 (座標の乱れで逆順になるのを防ぐ)
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] < edges[i - 1]) edges[i] = edges[i - 1];
  }
  return edges;
}

// 行の境界。列と同じ考え方で、隣接する行の中間点を境界とする。
// PDF は上が大きい値なので降順で並べる。戻り値は rows+1 個 (PDFポイント)。
function deriveRowEdges(tb: ExtractedTable): number[] | null {
  if (!tb.bounds || tb.rows < 1) return null;
  const spans: ({ b: number; t: number } | null)[] = [];
  for (let r = 1; r <= tb.rows; r++) {
    const cs = tb.cells.filter(x => x.row === r && x.bounds);
    spans.push(
      cs.length
        ? { b: Math.min(...cs.map(x => x.bounds![1])), t: Math.max(...cs.map(x => x.bounds![3])) }
        : null,
    );
  }
  const edges: number[] = [tb.bounds[3]]; // 表の上端
  for (let i = 0; i < spans.length - 1; i++) {
    const a = spans[i];
    const b = spans[i + 1];
    edges.push(a && b ? (a.b + b.t) / 2 : edges[edges.length - 1]);
  }
  edges.push(tb.bounds[1]); // 表の下端
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] > edges[i - 1]) edges[i] = edges[i - 1];
  }
  return edges;
}

// Adobe Extract の座標 (PDFポイント, 原点=左下, [left,bottom,right,top]) を
// canvas の座標 (px, 原点=左上) へ変換する。
// PDF は下方向が原点なので y を反転させる。
function boundsToCanvasRect(
  bounds: number[],
  scale: number,
  canvasH: number,
): { left: number; top: number; width: number; height: number } {
  const [l, b, r, t] = bounds;
  return {
    left: l * scale,
    top: canvasH - t * scale,
    width: Math.max(0, (r - l) * scale),
    height: Math.max(0, (t - b) * scale),
  };
}

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

// 表領域に重ねる編集可能な HTML テーブル。
// 表全体の幅は元のまま固定し、セル編集で列幅を再配分する (溢れさせない)。
// 列境界はドラッグで調整でき、隣の列が同じ分だけ縮む。
function EditableTable({
  tb, scale, canvasH, items, edit, onCellChange, onColWidths,
}: {
  key?: string; // @types/react 未導入のため JSX の key を明示的に許可する
  tb: ExtractedTable;
  scale: number;
  canvasH: number;
  items: TextItem[];
  edit?: { cells: Record<string, string>; colWidths: number[] | null };
  onCellChange: (row: number, col: number, text: string) => void;
  onColWidths: (widths: number[]) => void;
}) {
  if (!tb.bounds) return null;
  const rect = boundsToCanvasRect(tb.bounds, scale, canvasH);
  const colEdges = deriveColumnEdges(tb);
  const rowEdges = deriveRowEdges(tb);
  if (!colEdges || !rowEdges) return null;

  // 列幅 (canvas px)。編集済みならそれを使う
  const baseWidths = colEdges.slice(1).map((e, i) => Math.max(1, (e - colEdges[i]) * scale));
  const widths =
    edit?.colWidths && edit.colWidths.length === baseWidths.length ? edit.colWidths : baseWidths;
  const totalW = widths.reduce((a, b) => a + b, 0) || 1;

  // 行の高さ (canvas px)。最低値として使い、文字が折り返せば伸びる
  const rowHeights = rowEdges.slice(1).map((e, i) => Math.max(4, (rowEdges[i] - e) * scale));

  // 表内テキストのフォントサイズ中央値 (セル単位で取れなかった時のフォールバック)
  const allFonts = items
    .filter(it => it.x >= rect.left - 2 && it.x <= rect.left + rect.width + 2 &&
                  it.y >= rect.top - 2 && it.y <= rect.top + rect.height + 2)
    .map(it => it.fontSize)
    .sort((a, b) => a - b);
  const fallbackFont = allFonts.length ? allFonts[Math.floor(allFonts.length / 2)] : 10;

  // セルの元のフォントサイズを pdf.js のテキストから取得する
  const cellFont = (c: ExtractedCell): number => {
    if (c.bounds) {
      const r = boundsToCanvasRect(c.bounds, scale, canvasH);
      const hits = items.filter(
        it =>
          it.x + it.w / 2 >= r.left && it.x + it.w / 2 <= r.left + r.width &&
          it.y + it.h / 2 >= r.top && it.y + it.h / 2 <= r.top + r.height,
      );
      if (hits.length) return hits[0].fontSize;
    }
    return fallbackFont;
  };

  const cellAt = (row: number, col: number) =>
    tb.cells.find(c => c.row === row && c.col === col);

  // 列境界のドラッグ: 掴んだ境界の左右2列だけを増減させ、合計幅は不変
  const startDrag = (e: any, edgeIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const orig = [...widths];
    const move = (ev: PointerEvent) => {
      const min = 8;
      let d = ev.clientX - startX;
      d = Math.max(-(orig[edgeIdx] - min), Math.min(orig[edgeIdx + 1] - min, d));
      const next = [...orig];
      next[edgeIdx] = orig[edgeIdx] + d;
      next[edgeIdx + 1] = orig[edgeIdx + 1] - d;
      onColWidths(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        background: '#fff',
        outline: '1px solid rgba(99,102,241,0.5)',
      }}
    >
      <table
        style={{
          width: '100%',
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          fontFamily: 'sans-serif',
        }}
      >
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${(w / totalW) * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {Array.from({ length: tb.rows }, (_, ri) => (
            <tr key={ri} style={{ height: rowHeights[ri] }}>
              {Array.from({ length: tb.cols }, (_, ci) => {
                const c = cellAt(ri + 1, ci + 1);
                const key = `${ri + 1}-${ci + 1}`;
                const text = edit?.cells[key] ?? c?.text ?? '';
                const changed = edit?.cells[key] !== undefined && edit.cells[key] !== (c?.text ?? '');
                const fs = c ? cellFont(c) : fallbackFont;
                return (
                  <td
                    key={ci}
                    style={{
                      border: '1px solid #999',
                      padding: '1px 3px',
                      verticalAlign: 'middle',
                      position: 'relative',
                      // ヘッダ行は元のPDFに合わせて中央揃え
                      textAlign: c?.isHeader ? 'center' : 'left',
                      background: changed ? 'rgba(254,240,138,0.55)' : c?.isHeader ? 'rgba(0,0,0,0.04)' : undefined,
                    }}
                  >
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(ev: any) => {
                        const v = ev.currentTarget.textContent ?? '';
                        if (v !== text) onCellChange(ri + 1, ci + 1, v);
                      }}
                      style={{
                        fontSize: fs,
                        lineHeight: 1.15,
                        // 溢れさせず折り返す。列幅が足りなければ行が縦に伸びる
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        outline: 'none',
                        minHeight: fs,
                        color: '#111',
                      }}
                    >
                      {text}
                    </div>
                    {/* 右端の列境界ドラッグハンドル */}
                    {ri === 0 && ci < tb.cols - 1 && (
                      <div
                        onPointerDown={(ev: any) => startDrag(ev, ci)}
                        title="ドラッグで列幅を調整 (表全体の幅は変わりません)"
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: -3,
                          width: 6,
                          height: rect.height,
                          cursor: 'col-resize',
                          zIndex: 5,
                        }}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

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
    canvas,
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
 */
async function buildModifiedPdf(
  file: File,
  pages: PageData[],
  edits: Record<string, string>,
  aligns: Record<string, TextAlign>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(await file.arrayBuffer());
  const pdfPages = pdfDoc.getPages();

  for (const pd of pages) {
    const changed = pd.items.filter(
      it => edits[it.id] !== undefined && edits[it.id] !== it.str,
    );
    if (changed.length === 0) continue;

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

    // Apply each edit: erase original, draw new text
    // フォントサイズ・書体は変更せず、揃え方向によって伸びる向きを変える。
    // 消去範囲も描画範囲と一致させるため、罫線や隣接セルを不要に塗り潰さない。
    for (const item of changed) {
      const newText = edits[item.id];
      const align = aligns[item.id] ?? 'left';

      ctx.font = `${item.fontSize}px sans-serif`;
      const measuredW = ctx.measureText(newText).width;
      // 実際に文字が占める幅 (元の枠より広ければそれに従う)
      const drawW = Math.max(item.w, measuredW);

      // 揃えに応じて描画開始位置と消去開始位置を決める
      // left : 左端 item.x 固定 → 右へ伸びる
      // right: 右端 item.x + item.w 固定 → 左へ伸びる
      // center: 元の枠の中心を基準に左右へ伸びる
      let drawX: number;
      if (align === 'right') drawX = item.x + item.w - drawW;
      else if (align === 'center') drawX = item.x + (item.w - drawW) / 2;
      else drawX = item.x;
      // ページ外にはみ出さないようクランプ
      drawX = Math.max(0, Math.min(drawX, canvas.width - drawW));

      // Sample background color from just outside the original box
      // (avoids sampling on top of the text glyphs themselves)
      const sampleX = Math.max(0, item.x - 4);
      const sampleY = Math.min(canvas.height - 1, Math.round(item.y + item.h / 2));
      const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
      const bgColor = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;

      ctx.fillStyle = bgColor;
      ctx.fillRect(drawX - 2, item.y - 2, drawW + 4, item.h + 4);

      // Draw replacement text (フォントサイズ・書体は元のまま)
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(newText, drawX, item.y + item.fontSize * 0.05);
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
  // 本プロジェクトは @types/react 未導入で JSX が key を自動除去しないため明示的に許容
  key?: string | number;
  item: TextItem;
  value: string;
  onChange: (v: string) => void;
  isFocused: boolean;
  isModified: boolean;
  onFocus: () => void;
  onBlur: () => void;
  align: TextAlign;
  onAlignChange: (a: TextAlign) => void;
}

function EditableTextItem({
  item,
  value,
  onChange,
  isFocused,
  isModified,
  onFocus,
  onBlur,
  align,
  onAlignChange,
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
    <>
    {/* 揃え切替ツールバー (フォーカス中のみ表示)。文字サイズ・書体は変えず、
        テキストが元の領域より長い場合に伸びる方向を選べる */}
    {isFocused && (
      <div
        style={{
          position: 'absolute',
          left: item.x,
          top: Math.max(0, item.y - 26),
          display: 'flex',
          gap: 2,
          zIndex: 30,
          background: '#ffffff',
          border: '1px solid #6366f1',
          borderRadius: 4,
          padding: '2px 3px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}
        // ツールバー操作でエディタの blur が発生しないようにする
        onMouseDown={e => e.preventDefault()}
      >
        {([
          ['left', '⇤', '左揃え (右へ伸ばす)'],
          ['center', '↔', '中央揃え (左右へ伸ばす)'],
          ['right', '⇥', '右揃え (左へ伸ばす)'],
        ] as [TextAlign, string, string][]).map(([a, icon, tip]) => (
          <button
            key={a}
            type="button"
            title={tip}
            onClick={() => onAlignChange(a)}
            style={{
              width: 20,
              height: 18,
              fontSize: 11,
              lineHeight: '16px',
              cursor: 'pointer',
              borderRadius: 3,
              border: '1px solid ' + (align === a ? '#6366f1' : 'transparent'),
              background: align === a ? '#eef2ff' : 'transparent',
              color: align === a ? '#4338ca' : '#6b7280',
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    )}
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
        // 出力側と同じ揃えでプレビューする (フォントサイズ・書体は変えない)
        textAlign: align,
      }}
    />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function PdfEditorTable({ onBack }: { onBack: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null!);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  // テキストごとの揃え設定 (既定は左揃え = 元の位置から右へ伸ばす)
  const [textAligns, setTextAligns] = useState<Record<string, TextAlign>>({});
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── テーブル構造抽出 (技術検証) ──
  // Adobe Extract API が PDF の表を行列として認識できるかを確認する。
  // 認識精度がこの方式(HTMLテーブルとして再配置)の実現可否を左右するため、
  // まずここだけを切り出して検証する。
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractTablesResponse | null>(null);
  // 座標マッピングの検証用オーバーレイ表示 ('none' | 'table' | 'cell')
  const [overlayMode, setOverlayMode] = useState<'none' | 'table' | 'cell'>('table');
  // テーブル編集モード: 表領域に編集可能な HTML テーブルを重ねる
  const [tableEditMode, setTableEditMode] = useState(false);
  // 表ごとの編集内容。キーは `${page}-${tableIndex}`
  // colWidths は canvas px。null なら元の列幅を使う
  const [tableEdits, setTableEdits] = useState<
    Record<string, { cells: Record<string, string>; colWidths: number[] | null }>
  >({});

  const tableKey = (tb: ExtractedTable) => `${tb.page}-${tb.index}`;
  const setTableCell = (tb: ExtractedTable, row: number, col: number, text: string) =>
    setTableEdits(prev => {
      const k = tableKey(tb);
      const cur = prev[k] ?? { cells: {}, colWidths: null };
      return { ...prev, [k]: { ...cur, cells: { ...cur.cells, [`${row}-${col}`]: text } } };
    });
  const setTableColWidths = (tb: ExtractedTable, widths: number[]) =>
    setTableEdits(prev => {
      const k = tableKey(tb);
      const cur = prev[k] ?? { cells: {}, colWidths: null };
      return { ...prev, [k]: { ...cur, colWidths: widths } };
    });

  const runTableExtract = async () => {
    if (!file) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/pdf-extract-tables', { method: 'POST', body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || 'テーブル抽出に失敗しました');
      }
      setExtractResult((await res.json()) as ExtractTablesResponse);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'テーブル抽出に失敗しました');
    } finally {
      setExtracting(false);
    }
  };

  // Count genuinely modified text items
  const totalEdits = Object.entries(editedTexts).filter(([id, v]) => {
    for (const pg of pages) {
      const it = pg.items.find(x => x.id === id);
      if (it) return v !== it.str;
    }
    return false;
  }).length;

  // Mirror totalEdits into a ref so stable callbacks can read the live value
  const totalEditsRef = useRef(0);
  useEffect(() => {
    totalEditsRef.current = totalEdits;
  }, [totalEdits]);

  const loadPdf = useCallback(async (f: File) => {
    setLoading(true);
    setUploadError(null);
    setEditedTexts({});
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

  const handleSave = async () => {
    if (!file || saving || totalEdits === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const bytes = await buildModifiedPdf(file, pages, editedTexts, textAligns);
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

  // テーブル編集モード中は、表の中に入る pdf.js の文字レイヤを隠す。
  // (HTMLテーブル側で編集するため、そのままだと二重に表示される)
  const tableRects =
    tableEditMode && extractResult && currentPage
      ? extractResult.tables
          .filter(tb => tb.page === currentPageIdx && tb.bounds)
          .map(tb => boundsToCanvasRect(tb.bounds!, currentPage.scale, currentPage.canvasH))
      : [];
  const hiddenByTable = (it: TextItem) =>
    tableRects.some(r => {
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      return cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height;
    });

  const breadcrumb = (
    <nav className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
      >
        首页
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      <span className="text-neutral-900 font-medium">PDF編集 (テーブル対応)</span>
    </nav>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {breadcrumb}

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        {/* Card header */}
        <div className="px-8 pt-8 pb-0 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900">PDF編集 (テーブル対応)</h2>
            <p className="text-neutral-500 mt-1">
              PDFをアップロードし、テーブル構造を解析します(技術検証)。テキスト編集は従来通り可能です
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
                  {totalEdits > 0 && (
                    <span className="flex-shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">
                      {totalEdits} 处修改
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

              {/* Legend */}
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

              {/* ── テーブル構造抽出 (技術検証) ── */}
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-800">テーブル構造の解析 (技術検証)</h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Adobe Extract API で表を行・列として認識できるか確認します。
                      認識できれば「セル編集で列幅が自動的に広がる」方式が実現可能です。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={runTableExtract}
                    disabled={extracting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:bg-neutral-300 disabled:cursor-not-allowed shrink-0"
                  >
                    {extracting ? <Loader2 size={14} className="animate-spin" /> : null}
                    {extracting ? '解析中...' : 'テーブル構造を解析'}
                  </button>
                </div>

                {extractError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{extractError}</span>
                  </div>
                )}

                {extractResult && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span>検出テーブル数: <b className="tabular-nums">{extractResult.tableCount}</b></span>
                      <span className="text-neutral-500">要素総数: <b className="tabular-nums">{extractResult.elementCount}</b></span>
                      {/* 座標マッピング検証用の表示切替 */}
                      <span className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-neutral-500 mr-1">座標オーバーレイ:</span>
                        {([
                          ['none', '非表示'],
                          ['table', '表の外枠'],
                          ['cell', 'セル境界'],
                        ] as ['none' | 'table' | 'cell', string][]).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setOverlayMode(mode)}
                            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                              overlayMode === mode
                                ? 'border-indigo-500 bg-indigo-100 text-indigo-700 font-medium'
                                : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      下のページ画像に枠が重なります。枠が実際の表とズレていないか確認してください
                      (青=表の外枠 / 緑=セル境界)。
                      {extractResult.tables.filter(t => t.page === currentPageIdx).length === 0 && (
                        <span className="text-amber-600"> ※このページには検出された表がありません</span>
                      )}
                    </p>

                    {/* テーブル編集モード */}
                    <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
                      <button
                        type="button"
                        onClick={() => setTableEditMode(v => !v)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          tableEditMode
                            ? 'border-indigo-500 bg-indigo-600 text-white font-medium'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        {tableEditMode ? 'テーブル編集モード: ON' : 'テーブル編集モード: OFF'}
                      </button>
                      {tableEditMode && Object.keys(tableEdits).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setTableEdits({})}
                          className="px-2.5 py-1 rounded-lg text-xs border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                        >
                          編集をリセット
                        </button>
                      )}
                      <p className="text-xs text-neutral-500 flex-1 min-w-[240px]">
                        表領域に編集可能なテーブルを重ねます。セルをクリックして書き換えると、
                        <b>表全体の幅は変わらず</b>文字が折り返されるため元の領域を超えません。
                        列幅を変えたい場合は<b>列の境界をドラッグ</b>してください (隣の列が同じ分縮みます)。
                      </p>
                    </div>

                    {extractResult.tables.length === 0 ? (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        テーブルとして認識されませんでした。このPDFでは表構造ベースの編集は使えません。
                      </p>
                    ) : (
                      extractResult.tables.map((tb) => {
                        // 行列マトリクスに並べ直してプレビュー
                        const grid: string[][] = Array.from({ length: tb.rows }, () => Array(tb.cols).fill(''));
                        for (const c of tb.cells) {
                          if (c.row >= 1 && c.row <= tb.rows && c.col >= 1 && c.col <= tb.cols) {
                            grid[c.row - 1][c.col - 1] = c.text;
                          }
                        }
                        return (
                          <div key={`${tb.page}-${tb.index}`} className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
                            <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-200 text-xs text-neutral-600 flex flex-wrap gap-3 items-center">
                              <span>Table[{tb.index}]</span>
                              <span>ページ {tb.page + 1}</span>
                              <span><b>{tb.rows}</b> 行 × <b>{tb.cols}</b> 列</span>
                              {tb.caption && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  見出し: {tb.caption}
                                </span>
                              )}
                              {tb.colFromBounds && (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700" title="Adobeの列マージを座標から補正しました">
                                  列を座標補正
                                </span>
                              )}
                              {tb.bounds && (
                                <span className="text-neutral-400">
                                  外形 [{tb.bounds.map((v) => Math.round(v)).join(', ')}]
                                </span>
                              )}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse text-xs">
                                <tbody>
                                  {grid.map((r, ri) => (
                                    <tr key={ri}>
                                      {r.map((cell, ci) => (
                                        <td
                                          key={ci}
                                          className="border border-neutral-200 px-2 py-1 text-neutral-700 align-top max-w-[220px]"
                                        >
                                          {cell || <span className="text-neutral-300">-</span>}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Page view: canvas background + text overlay */}
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

                    {/* テーブル座標のオーバーレイ (座標マッピングの検証用)。
                        Adobe が返した座標を canvas 座標に変換して枠を重ねる。
                        枠が実際の表とズレる場合は座標変換の見直しが必要。 */}
                    {overlayMode !== 'none' && extractResult && (
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        {extractResult.tables
                          .filter(tb => tb.page === currentPageIdx)
                          .map(tb => {
                            const rects: any[] = [];
                            if (tb.bounds) {
                              const r = boundsToCanvasRect(tb.bounds, currentPage.scale, currentPage.canvasH);
                              rects.push(
                                <div
                                  key={`t-${tb.index}`}
                                  style={{
                                    position: 'absolute',
                                    left: r.left,
                                    top: r.top,
                                    width: r.width,
                                    height: r.height,
                                    border: '2px solid rgba(99,102,241,0.9)',
                                    background: 'rgba(99,102,241,0.07)',
                                    borderRadius: 2,
                                  }}
                                >
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: -16,
                                      left: 0,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: '#4338ca',
                                      background: 'rgba(255,255,255,0.9)',
                                      padding: '0 3px',
                                      borderRadius: 2,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    T{tb.index} ({tb.rows}×{tb.cols})
                                  </span>
                                </div>,
                              );
                            }
                            if (overlayMode === 'cell') {
                              for (const c of tb.cells) {
                                if (!c.bounds) continue;
                                const cr = boundsToCanvasRect(c.bounds, currentPage.scale, currentPage.canvasH);
                                rects.push(
                                  <div
                                    key={`c-${tb.index}-${c.row}-${c.col}`}
                                    style={{
                                      position: 'absolute',
                                      left: cr.left,
                                      top: cr.top,
                                      width: cr.width,
                                      height: cr.height,
                                      border: '1px solid rgba(16,185,129,0.85)',
                                      background: 'rgba(16,185,129,0.08)',
                                    }}
                                  />,
                                );
                              }
                            }
                            return rects;
                          })}
                      </div>
                    )}

                    {/* 編集可能な HTML テーブルのオーバーレイ (フェーズ2)。
                        表領域は元の文字レイヤの代わりにこちらで編集する。 */}
                    {tableEditMode && extractResult && (
                      <div style={{ position: 'absolute', inset: 0 }}>
                        {extractResult.tables
                          .filter(tb => tb.page === currentPageIdx && tb.bounds)
                          .map(tb => (
                            <EditableTable
                              key={`et-${tb.index}`}
                              tb={tb}
                              scale={currentPage.scale}
                              canvasH={currentPage.canvasH}
                              items={currentPage.items}
                              edit={tableEdits[tableKey(tb)]}
                              onCellChange={(r, c, t) => setTableCell(tb, r, c, t)}
                              onColWidths={w => setTableColWidths(tb, w)}
                            />
                          ))}
                      </div>
                    )}

                    {/* Editable text overlay。
                        テーブル編集モード中は表の中の文字レイヤを隠す (二重表示になるため) */}
                    <div style={{ position: 'absolute', inset: 0 }}>
                      {currentPage.items.filter(it => !hiddenByTable(it)).map(item => (
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
                          align={textAligns[item.id] ?? 'left'}
                          onAlignChange={a =>
                            setTextAligns(prev => ({ ...prev, [item.id]: a }))
                          }
                        />
                      ))}
                    </div>
                  </div>
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

      <div className="pt-4 border-t border-neutral-200">
        {breadcrumb}
      </div>
    </div>
  );
}
