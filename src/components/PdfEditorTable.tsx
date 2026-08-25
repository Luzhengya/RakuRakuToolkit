import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
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

// ── 罫線検出 ────────────────────────────────────────────────────────────
// Adobe の bounds は「文字がある範囲」しか含まないため、右端に空の列がある表では
// 幅が足りず、列の境界も文字位置からの推定に頼ることになる。
// レンダリング済みのページ画像から実際に描かれている罫線を読めば、
// 表の左右端と列/行の境界を正確に得られる (フェーズ3の色サンプリングにも同じ画像を使う)。

interface TableGeom {
  left: number;    // 表の左端 (canvas px)
  right: number;   // 表の右端
  top: number;     // 表の上端
  bottom: number;  // 表の下端
  xs: number[];    // 内側の縦罫線 (外枠は含まない)
  ys: number[];    // 内側の横罫線 (外枠は含まない)
}

// ページ画像を輝度マップに変換する
async function loadPageGray(dataUrl: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('page image load failed'));
    img.src = dataUrl;
  });
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return toGrayMap(ctx.getImageData(0, 0, w, h).data, w * h);
}

function toGrayMap(d: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  return g;
}

// 「罫線かもしれない」とみなす輝度の上限。
// 薄いグレーの罫線 (輝度 200 前後) を取り逃すと表が検出できないので緩めにする。
// 淡い塗り潰しもここを通ってしまうが、下の局所コントラスト判定で除外する。
const DARK_THRESHOLD = 228;

// 隣接するピクセル座標をひとつの罫線としてまとめ、中心を返す
// (罫線は 1px ではなく JPEG のにじみで数 px になる)
function clusterCenters(vals: number[], gap = 3): number[] {
  if (!vals.length) return [];
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  let start = s[0];
  let prev = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] - prev > gap) {
      out.push((start + prev) / 2);
      start = s[i];
    }
    prev = s[i];
  }
  out.push((start + prev) / 2);
  return out;
}

// ページの本文幅 (左右のマージン)。
// この文書の表はどれも本文幅いっぱいに引かれていて、章見出しの下の太い罫線と
// 左右端が揃っている。表ごとの薄い罫線を検出できなくても、ページ全体の
// 罫線から本文幅を取れば表の幅は分かる。
// 濃い罫線から多数決で決めるので、薄い罫線を取り逃しても影響を受けない。
function detectPageContentSpan(rules: PageRules, W: number): { left: number; right: number } | null {
  const minLen = W * 0.3;
  const long = rules.h.filter(s => s.x1 - s.x0 + 1 >= minLen);
  // 太い罫線は複数の走査行にまたがるので、本数は y をまとめてから数える。
  // 多数決に意味を持たせるため、独立した罫線が2本以上あることを要求する。
  if (clusterCenters(long.map(s => s.y)).length < 2) return null;
  // 数px のズレは同じマージンとみなすため 4px 単位に丸めて多数決を取る
  const mode = (vals: number[]) => {
    const counts = new Map<number, number>();
    for (const v of vals) {
      const k = Math.round(v / 4);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let bestK = 0;
    let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; bestK = k; }
    // 丸めた値ではなく、その束に属する実測値の中央値を返す
    const inBin = vals.filter(v => Math.round(v / 4) === bestK).sort((a, b) => a - b);
    return inBin[Math.floor(inBin.length / 2)];
  };
  const left = mode(long.map(s => s.x0));
  const right = mode(long.map(s => s.x1));
  return right - left >= 40 ? { left, right } : null;
}

// 表の外形と内側の罫線を求める。
// 罫線の収集は collectPageRules に任せる (閾値とフィルタが画面側/保存側で共通になる)。
// 横罫線が1本も無い領域は「罫線のない表」= 表ではないと判断して null を返す。
// (表紙のようにラベルと値が並んでいるだけの箇所を Adobe が表として返してくるため)
function detectTableGeom(
  rules: PageRules,
  span: { left: number; right: number } | null,
  r: { left: number; top: number; width: number; height: number },
): TableGeom | null {
  const pad = 6;
  const y0 = r.top - pad;
  const y1 = r.top + r.height + pad;
  if (y1 - y0 < 4 || r.width < 20) return null;

  // この帯に入る横罫線。Adobe の幅は信用できないので長さの下限だけで絞る
  const minRun = Math.max(40, r.width * 0.5);
  const hs = rules.h.filter(s => s.y >= y0 && s.y <= y1 && s.x1 - s.x0 + 1 >= minRun);
  // 罫線が引かれていないなら表として扱わない (表紙を弾く)
  if (!hs.length) return null;

  // 幅はページの本文幅を優先する。表ごとの薄い罫線は検出できないことがあるが、
  // 本文幅は濃い罫線から多数決で決まるので信頼できる。
  const detLeft = Math.min(...hs.map(s => s.x0));
  const detRight = Math.max(...hs.map(s => s.x1));
  const left = span ? Math.min(span.left, detLeft) : detLeft;
  const right = span ? Math.max(span.right, detRight) : detRight;
  if (right - left < 20) return null;

  // 上下端。横罫線が1本しか無い場合は Adobe の範囲で補う
  const yAll = clusterCenters(hs.map(s => s.y));
  const top = yAll[0];
  const bottom = yAll.length >= 2 ? yAll[yAll.length - 1] : r.top + r.height;
  // 見出しの下線1本だけを表と誤認しないよう高さを要求する
  // (「支店・支社」のような見出しが表として返ってくるケースを弾く)
  if (bottom - top < 8) return null;

  // 表の高さの 60% 以上を占める縦罫線を列の境界とみなす
  const minVLen = Math.max(10, (bottom - top) * 0.6);
  const vs = rules.v.filter(
    s =>
      s.x >= left && s.x <= right &&
      Math.min(s.y1, bottom) - Math.max(s.y0, top) + 1 >= minVLen,
  );

  // 外枠は left/right/top/bottom で持つので、xs/ys は内側の罫線だけにする
  const margin = 3;
  return {
    left,
    right,
    top,
    bottom,
    xs: clusterCenters(vs.map(s => s.x)).filter(x => x > left + margin && x < right - margin),
    ys: yAll.filter(y => y > top + margin && y < bottom - margin),
  };
}
// ── フォントサイズ ──────────────────────────────────────────────────────
// pdf.js が報告する文字の高さは字形のボックスなので、そのまま CSS の font-size に
// すると実際の描画より大きく見える。元の文字が占めていた「幅」に合うサイズを
// 逆算する方が、見た目も列に収まるかの判断も正確になる。
let measureCtx: CanvasRenderingContext2D | null = null;
function fitFontSize(text: string, targetW: number, fallback: number): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx || !text.trim() || targetW <= 0) return fallback;
  measureCtx.font = '100px sans-serif';
  const w = measureCtx.measureText(text).width;
  if (w <= 0) return fallback;
  const fs = (100 * targetW) / w;
  // 計測が外れた時に極端な値を採用しない
  return fs >= 4 && fs <= 40 ? fs : fallback;
}

// 表領域に重ねる編集可能な HTML テーブル。
// 表全体の幅は元のまま固定し、セル編集で列幅を再配分する (溢れさせない)。
// 列境界はドラッグで調整でき、隣の列が同じ分だけ縮む。
function EditableTable({
  tb, scale, canvasH, items, geom, edit, onCellChange, onColWidths,
}: {
  key?: string; // @types/react 未導入のため JSX の key を明示的に許可する
  tb: ExtractedTable;
  scale: number;
  canvasH: number;
  items: TextItem[];
  geom?: TableGeom;
  edit?: { cells: Record<string, string>; colWidths: number[] | null };
  onCellChange: (row: number, col: number, text: string) => void;
  onColWidths: (widths: number[]) => void;
}) {
  if (!tb.bounds) return null;
  const adobeRect = boundsToCanvasRect(tb.bounds, scale, canvasH);

  // 罫線が検出できていない領域は表として扱わない (表紙などを弾く)
  if (!geom) return null;

  // 外形は必ず検出結果を使う。Adobe の幅は文字の範囲しか含まないので信用しない。
  // 内側の境界は、検出した罫線が足りていればそれを、足りなければ
  // 文字位置からの推定を使う。
  const useDetCols = geom.xs.length >= tb.cols - 1;
  const useDetRows = geom.ys.length >= tb.rows - 1;

  // 推定した内側の境界を外形の中に収める。
  // 位置は元のまま使い、外形との隙間は空の列/行で埋める
  // (T7 のように右側に空列がある表で、文字を引き伸ばさず幅だけ合わせるため)。
  const fitInside = (inner: number[], lo: number, hi: number): number[] => {
    const kept = inner.filter(v => v > lo + 3 && v < hi - 3).sort((a, b) => a - b);
    return [lo, ...kept, hi];
  };

  const colPx = useDetCols
    ? [geom.left, ...geom.xs, geom.right]
    : fitInside(
        (deriveColumnEdges(tb) ?? []).map(v => v * scale),
        geom.left,
        geom.right,
      );
  const rowPx = useDetRows
    ? [geom.top, ...geom.ys, geom.bottom]
    : fitInside(
        (deriveRowEdges(tb) ?? []).map(v => canvasH - v * scale),
        geom.top,
        geom.bottom,
      );

  const nCols = colPx.length - 1;
  const nRows = rowPx.length - 1;
  if (nCols < 1 || nRows < 1) return null;

  const rect = {
    left: colPx[0],
    top: rowPx[0],
    width: colPx[nCols] - colPx[0],
    height: rowPx[nRows] - rowPx[0],
  };

  // 列幅 (canvas px)。編集済みならそれを使う
  const baseWidths = colPx.slice(1).map((e, i) => Math.max(1, e - colPx[i]));
  const widths =
    edit?.colWidths && edit.colWidths.length === baseWidths.length ? edit.colWidths : baseWidths;
  const totalW = widths.reduce((a, b) => a + b, 0) || 1;

  // 行の高さ。最低値として使い、文字が折り返せば伸びる
  const rowHeights = rowPx.slice(1).map((e, i) => Math.max(4, e - rowPx[i]));

  // Adobe のセルを、罫線から決めたグリッドに座標で割り当てる。
  // (Adobe の row/col は空列を数えないためグリッドと一致しない)
  const idxOf = (edges: number[], v: number) => {
    for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i] && v < edges[i + 1]) return i;
    return v >= edges[edges.length - 1] ? edges.length - 2 : -1;
  };
  const placed: Record<string, ExtractedCell> = {};
  for (const c of tb.cells) {
    let ri: number;
    let ci: number;
    if (c.bounds) {
      const cr = boundsToCanvasRect(c.bounds, scale, canvasH);
      ci = idxOf(colPx, cr.left + cr.width / 2);
      ri = idxOf(rowPx, cr.top + cr.height / 2);
    } else {
      ci = c.col - 1;
      ri = c.row - 1;
    }
    if (ri < 0 || ci < 0 || ri >= nRows || ci >= nCols) continue;
    const k = `${ri + 1}-${ci + 1}`;
    // 同じマスに複数要素が来たらテキストを連結する
    placed[k] = placed[k]
      ? { ...placed[k], text: `${placed[k].text} ${c.text}`.trim() }
      : c;
  }

  // 表内テキストのフォントサイズ中央値 (セル単位で取れなかった時のフォールバック)
  const inTable = items.filter(
    it =>
      it.x + it.w / 2 >= rect.left && it.x + it.w / 2 <= rect.left + rect.width &&
      it.y + it.h / 2 >= rect.top && it.y + it.h / 2 <= rect.top + rect.height,
  );
  const fonts = inTable.map(it => it.fontSize).sort((a, b) => a - b);
  const fallbackFont = fonts.length ? fonts[Math.floor(fonts.length / 2)] : 10;

  // セルのフォントサイズ。pdf.js のテキストの「幅」から逆算するので
  // 元の見た目とほぼ一致する。同じセルに複数行ある場合は最も長い行で合わせる。
  const cellFont = (c: ExtractedCell): number => {
    if (!c.bounds) return fallbackFont;
    const r = boundsToCanvasRect(c.bounds, scale, canvasH);
    const hits = items.filter(
      it =>
        it.x + it.w / 2 >= r.left - 1 && it.x + it.w / 2 <= r.left + r.width + 1 &&
        it.y + it.h / 2 >= r.top - 1 && it.y + it.h / 2 <= r.top + r.height + 1,
    );
    if (!hits.length) return fallbackFont;
    // 同じ行 (y が近い) をまとめる
    const lines = new Map<number, TextItem[]>();
    for (const it of hits) {
      const key = Math.round(it.y / 4);
      const arr = lines.get(key);
      if (arr) arr.push(it);
      else lines.set(key, [it]);
    }
    let best: TextItem[] = [];
    for (const arr of lines.values()) {
      const len = arr.reduce((n, it) => n + it.str.length, 0);
      if (len > best.reduce((n, it) => n + it.str.length, 0)) best = arr;
    }
    const sorted = [...best].sort((a, b) => a.x - b.x);
    const text = sorted.map(it => it.str).join('');
    const w = Math.max(...sorted.map(it => it.x + it.w)) - Math.min(...sorted.map(it => it.x));
    return fitFontSize(text, w, hits[0].fontSize);
  };

  const cellAt = (row: number, col: number) => placed[`${row}-${col}`];

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
      {/* 罫線検出の結果をテーブルの真上に出す。
          パネルまでスクロールせずに、どの表が推定にフォールバックしたか分かるようにする */}
      <span
        style={{
          position: 'absolute',
          top: -14,
          left: 0,
          fontSize: 9,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          padding: '0 3px',
          borderRadius: 2,
          color: useDetCols ? '#15803d' : '#b45309',
          background: useDetCols ? 'rgba(220,252,231,0.95)' : 'rgba(254,243,199,0.95)',
        }}
        title={
          useDetCols
            ? '外形も列の境界も、ページ画像から検出した罫線を使っています'
            : '外形は罫線から確定しています。列の境界だけ縦罫線が検出できず、文字位置からの推定です'
        }
      >
        T{tb.index} {nCols}列×{nRows}行 (枠=罫線 / 列={useDetCols ? '罫線' : '推定'})
      </span>
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
          {Array.from({ length: nRows }, (_, ri) => (
            <tr key={ri} style={{ height: rowHeights[ri] }}>
              {Array.from({ length: nCols }, (_, ci) => {
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
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 列境界のドラッグハンドル。表とは別のレイヤに出して掴みやすくする */}
      {widths.slice(0, -1).map((_, i) => (
        <ColResizeHandle
          key={i}
          left={widths.slice(0, i + 1).reduce((a, b) => a + b, 0)}
          onDown={(ev: any) => startDrag(ev, i)}
        />
      ))}
    </div>
  );
}

// 列境界のつまみ。常に薄く見えていて、ホバーで濃くなる
function ColResizeHandle({ left, onDown }: { key?: number; left: number; onDown: (e: any) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onPointerDown={onDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="ドラッグで列幅を調整 (表全体の幅は変わりません)"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: left - 4,
        width: 8,
        cursor: 'col-resize',
        zIndex: 10,
        background: hover ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.12)',
      }}
    />
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

// ── 保存時に「マス」を特定する ───────────────────────────────────────────
// 書き換えた文字が枠を越えるのと、消去範囲の色が罫線を拾って灰色の箱になるのを
// 防ぐため、レンダリング画像から文字を囲む罫線を探してマスの矩形を求める。

interface PageRules {
  v: { x: number; y0: number; y1: number }[];
  h: { y: number; x0: number; x1: number }[];
}

// ページ画像から罫線の線分を集める。
// 長さの下限だけでは、太字や塗り潰しの塊を罫線と誤認する
// (幅40px の文字ブロックは横罫線に見えてしまう)。
// そこで「局所コントラスト」で判定する: 罫線は上下 (縦罫線なら左右) の両側より
// はっきり暗い。塗り潰しの内部や文字の塊は周囲と同じ暗さなので弾かれる。
// 太さで判定していた時は、淡い塗り潰しのヘッダに接した罫線が塊と一体化して
// 消えてしまっていた。
const RULE_PROBE = 3;      // 何px離れた両側と比べるか
const RULE_CONTRAST = 30;  // 両側との輝度差の下限

function collectPageRules(gray: Uint8Array, W: number, H: number): PageRules {
  const MIN_V = 18; // 縦罫線の最小長 (px)。本文の文字より十分長い
  const MIN_H = 40; // 横罫線の最小長

  // 横罫線らしさ: (x, y) が上下 RULE_PROBE px の両側よりはっきり暗い
  const hContrast = (x: number, y: number) => {
    if (y - RULE_PROBE < 0 || y + RULE_PROBE >= H) return true; // ページ端は判定不能
    const c = gray[y * W + x];
    return (
      gray[(y - RULE_PROBE) * W + x] - c >= RULE_CONTRAST &&
      gray[(y + RULE_PROBE) * W + x] - c >= RULE_CONTRAST
    );
  };
  // 縦罫線らしさ: 左右の両側よりはっきり暗い
  const vContrast = (x: number, y: number) => {
    if (x - RULE_PROBE < 0 || x + RULE_PROBE >= W) return true;
    const row = y * W;
    const c = gray[row + x];
    return (
      gray[row + x - RULE_PROBE] - c >= RULE_CONTRAST &&
      gray[row + x + RULE_PROBE] - c >= RULE_CONTRAST
    );
  };

  // 線分に沿って何点か調べ、過半数がコントラストを満たすかを見る。
  // 1点だけ見ると罫線の交点や文字との重なりで誤判定する。
  const mostlyContrasted = (
    start: number,
    len: number,
    at: (pos: number) => boolean,
  ): boolean => {
    let n = 0;
    for (let i = 1; i <= 5; i++) if (at(start + Math.floor((len * i) / 6))) n++;
    return n >= 3;
  };

  const v: PageRules['v'] = [];
  const h: PageRules['h'] = [];
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && gray[y * W + x] < DARK_THRESHOLD) {
        run++;
      } else {
        if (run >= MIN_V) {
          const y0 = y - run;
          if (mostlyContrasted(y0, run, pos => vContrast(x, pos))) {
            v.push({ x, y0, y1: y - 1 });
          }
        }
        run = 0;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let run = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && gray[row + x] < DARK_THRESHOLD) {
        run++;
      } else {
        if (run >= MIN_H) {
          const x0 = x - run;
          if (mostlyContrasted(x0, run, pos => hContrast(pos, y))) {
            h.push({ y, x0, x1: x - 1 });
          }
        }
        run = 0;
      }
    }
  }
  return { v, h };
}
// item を囲むマスを罫線から求める。左右の罫線が見つからなければ null
// (表の外のテキストなので従来どおりの処理に任せる)。
function findCellBox(
  rules: PageRules,
  item: TextItem,
): { left: number; right: number; top: number; bottom: number } | null {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const tol = 1;
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const s of rules.v) {
    if (s.y0 - tol > cy || s.y1 + tol < cy) continue;
    if (s.x <= cx && s.x > left) left = s.x;
    if (s.x >= cx && s.x < right) right = s.x;
  }
  for (const s of rules.h) {
    if (s.x0 - tol > cx || s.x1 + tol < cx) continue;
    if (s.y <= cy && s.y > top) top = s.y;
    if (s.y >= cy && s.y < bottom) bottom = s.y;
  }
  if (left === -Infinity || right === Infinity || right - left < 8) return null;
  // 上下が取れない/潰れている場合は元の文字の高さで代用する
  const t = top > -Infinity ? top : item.y - 2;
  const b = bottom < Infinity ? bottom : item.y + item.h + 2;
  if (b - t < 4) return { left, right, top: item.y - 2, bottom: item.y + item.h + 2 };
  return { left, right, top: t, bottom: b };
}

// 矩形の内側から複数点を拾い、最も多い色を背景とみなす。
// 1点だけ見ていると罫線や文字を拾って塗り潰しが灰色の箱になる。
function sampleBgColor(
  ctx: CanvasRenderingContext2D,
  box: { left: number; right: number; top: number; bottom: number },
): string {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const xs: number[] = [];
  for (let i = 1; i <= 6; i++) xs.push(box.left + ((box.right - box.left) * i) / 7);
  // 文字は上下方向の中央にあるので、罫線の内側ぎりぎりを狙う
  const ys = [box.top + 2, box.top + 3, box.bottom - 2, box.bottom - 3];
  const counts = new Map<string, number>();
  for (const x of xs) {
    for (const y of ys) {
      const px = Math.max(0, Math.min(W - 1, Math.round(x)));
      const py = Math.max(0, Math.min(H - 1, Math.round(y)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      const key = `${d[0]},${d[1]},${d[2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bestKey = '255,255,255';
  let bestN = 0;
  for (const [k, n] of counts) {
    // 同数なら明るい方を選ぶ (罫線や文字より背景を優先する)
    const lum = k.split(',').reduce((a, b) => a + Number(b), 0);
    const bestLum = bestKey.split(',').reduce((a, b) => a + Number(b), 0);
    if (n > bestN || (n === bestN && lum > bestLum)) {
      bestN = n;
      bestKey = k;
    }
  }
  return `rgb(${bestKey})`;
}

// 指定幅に収まるよう改行する (フォントサイズは変えない)
function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (maxW <= 0 || !text) return [text];
  const lines: string[] = [];
  let cur = '';
  for (const ch of Array.from(text)) {
    const next = cur + ch;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  lines.push(cur);
  return lines;
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

    // 罫線を集めておく。書き換えた文字がどのマスに入っているかを判定して、
    // 消去範囲をマス内に限り、はみ出す文字はマス幅で折り返す。
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rules = collectPageRules(
      toGrayMap(px, canvas.width * canvas.height),
      canvas.width,
      canvas.height,
    );

    // Apply each edit: erase original, draw new text
    // フォントサイズ・書体は変更しない。
    for (const item of changed) {
      const newText = edits[item.id];
      const align = aligns[item.id] ?? 'left';
      ctx.font = `${item.fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      const cell = findCellBox(rules, item);

      if (cell) {
        // マスが分かった場合: 罫線を残したままマスの内側だけを塗り、
        // マス幅に収まるよう折り返す (外枠を越えない)
        const pad = 2;
        const innerL = cell.left + 1 + pad;
        const innerR = cell.right - 1 - pad;
        const maxW = innerR - innerL;

        ctx.fillStyle = sampleBgColor(ctx, cell);
        ctx.fillRect(
          cell.left + 1,
          cell.top + 1,
          Math.max(0, cell.right - cell.left - 1),
          Math.max(0, cell.bottom - cell.top - 1),
        );

        const lines = wrapToWidth(ctx, newText, maxW);
        const lh = item.fontSize * 1.15;
        // 1行なら元の位置、複数行ならマス内で縦中央に置く
        const blockH = lines.length * lh;
        const startY =
          lines.length === 1
            ? item.y + item.fontSize * 0.05
            : Math.max(cell.top + 1 + pad, (cell.top + cell.bottom) / 2 - blockH / 2);

        ctx.fillStyle = '#000000';
        lines.forEach((ln, i) => {
          const w = ctx.measureText(ln).width;
          let x: number;
          if (align === 'right') x = innerR - w;
          else if (align === 'center') x = innerL + (maxW - w) / 2;
          else x = innerL;
          ctx.fillText(ln, Math.max(innerL, x), startY + i * lh);
        });
      } else {
        // 表の外のテキスト: 従来どおり、揃え方向に応じて伸ばす
        const measuredW = ctx.measureText(newText).width;
        const drawW = Math.max(item.w, measuredW);
        let drawX: number;
        if (align === 'right') drawX = item.x + item.w - drawW;
        else if (align === 'center') drawX = item.x + (item.w - drawW) / 2;
        else drawX = item.x;
        drawX = Math.max(0, Math.min(drawX, canvas.width - drawW));

        ctx.fillStyle = sampleBgColor(ctx, {
          left: drawX - 2,
          right: drawX + drawW + 2,
          top: item.y - 2,
          bottom: item.y + item.h + 2,
        });
        ctx.fillRect(drawX - 2, item.y - 2, drawW + 4, item.h + 4);

        ctx.fillStyle = '#000000';
        ctx.fillText(newText, drawX, item.y + item.fontSize * 0.05);
      }
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

  // このページで編集対象にする表。
  // Adobe は入れ子や重複した表を返すことがあるので、他の表にほぼ含まれる
  // ものは捨てる (重ねて表示すると二重になる)。
  const editableTables = useMemo(() => {
    if (!extractResult || !currentPage) return [];
    const list = extractResult.tables.filter(tb => tb.page === currentPageIdx && tb.bounds);
    const area = (b: number[]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    return list.filter(tb => {
      const a = tb.bounds!;
      return !list.some(o => {
        if (o === tb || !o.bounds) return false;
        const b = o.bounds;
        const ov =
          Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
          Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        const mine = area(a);
        // 自分の 80% 以上が相手に覆われ、かつ相手の方が大きいなら捨てる
        return mine > 0 && ov / mine > 0.8 && area(b) > mine;
      });
    });
  }, [extractResult, currentPageIdx, currentPage]);

  // ページ画像から罫線を検出して、表ごとのグリッドを求める。
  // Adobe の bounds では空列が抜けて幅が足りないため、これが無いと
  // 覆いかぶせるテーブルの大きさが元と合わない。
  const [tableGeoms, setTableGeoms] = useState<Record<string, TableGeom>>({});
  useEffect(() => {
    // 編集モードに関係なく走らせる。座標オーバーレイ側でも
    // 「罫線がないので表として扱わない」領域を区別して描きたいため。
    if (!currentPage || editableTables.length === 0) {
      setTableGeoms({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const gray = await loadPageGray(currentPage.dataUrl, currentPage.canvasW, currentPage.canvasH);
        if (cancelled) return;
        // 罫線の収集はページ単位で1回だけ
        const rules = collectPageRules(gray, currentPage.canvasW, currentPage.canvasH);
        // 本文幅もページ単位で1回だけ求める
        const span = detectPageContentSpan(rules, currentPage.canvasW);
        const out: Record<string, TableGeom> = {};
        for (const tb of editableTables) {
          const r = boundsToCanvasRect(tb.bounds!, currentPage.scale, currentPage.canvasH);
          const g = detectTableGeom(rules, span, r);
          if (g) out[`${tb.page}-${tb.index}`] = g;
        }
        if (!cancelled) setTableGeoms(out);
      } catch (err) {
        console.error('ruling detection failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPage, editableTables]);

  // テーブル編集モード中は、表の中に入る pdf.js の文字レイヤを隠す。
  // (HTMLテーブル側で編集するため、そのままだと二重に表示される)
  const tableRects =
    tableEditMode && currentPage
      ? // 罫線が取れた表だけを隠す。表として描かない領域 (表紙など) の文字は
        // 従来どおり編集できるよう残す
        editableTables
          .map(tb => tableGeoms[`${tb.page}-${tb.index}`])
          .filter((g): g is TableGeom => !!g)
          .map(g => ({
            left: g.left,
            top: g.top,
            width: g.right - g.left,
            height: g.bottom - g.top,
          }))
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
                      下のページ画像に枠が重なります (青=表の外枠 / 緑=セル境界)。
                      <b>グレーの破線</b>は Adobe が表として返したものの、罫線が無いため
                      表として扱わない領域です (表紙など)。
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
                              {/* 罫線検出の結果。推定にフォールバックした表を見分けられるようにする */}
                              {tableEditMode && tb.page === currentPageIdx && (() => {
                                const g = tableGeoms[`${tb.page}-${tb.index}`];
                                if (!g) {
                                  return (
                                    <span
                                      className="px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600"
                                      title="この領域には罫線がないため、表としては扱いません (表紙など)"
                                    >
                                      罫線なし → 表として扱わない
                                    </span>
                                  );
                                }
                                return g.xs.length >= tb.cols - 1 ? (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-green-100 text-green-700"
                                    title="外形も列の境界も検出した罫線を使いました"
                                  >
                                    罫線検出 {g.xs.length + 1}列 × {g.ys.length + 1}行
                                  </span>
                                ) : (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700"
                                    title="外形は罫線から確定。列の境界だけ文字位置からの推定"
                                  >
                                    枠=罫線 / 列=推定
                                  </span>
                                );
                              })()}
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
                            // 罫線が無く表として扱わない領域はグレーの破線で描く。
                            // 青枠のままだと「表と認識している」ように見えて、
                            // 編集レイヤ側の判定と矛盾して見えてしまう。
                            const isTable = !!tableGeoms[`${tb.page}-${tb.index}`];
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
                                    border: isTable
                                      ? '2px solid rgba(99,102,241,0.9)'
                                      : '2px dashed rgba(120,113,108,0.75)',
                                    background: isTable
                                      ? 'rgba(99,102,241,0.07)'
                                      : 'rgba(120,113,108,0.05)',
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
                                      color: isTable ? '#4338ca' : '#57534e',
                                      background: 'rgba(255,255,255,0.9)',
                                      padding: '0 3px',
                                      borderRadius: 2,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    T{tb.index} ({tb.rows}×{tb.cols})
                                    {!isTable && ' 罫線なし → 表として扱わない'}
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
                    {tableEditMode && (
                      <div style={{ position: 'absolute', inset: 0 }}>
                        {editableTables.map(tb => (
                          <EditableTable
                            key={`et-${tb.index}`}
                            tb={tb}
                            scale={currentPage.scale}
                            canvasH={currentPage.canvasH}
                            items={currentPage.items}
                            geom={tableGeoms[tableKey(tb)]}
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
