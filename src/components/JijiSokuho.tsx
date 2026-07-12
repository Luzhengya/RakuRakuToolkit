import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, Search } from 'lucide-react';
import JSZip from 'jszip';
import JijiDetail from './JijiDetail';
import {
  CAT_COLOR,
  CATEGORIES,
  NONE_CATEGORY,
  toBigCategory,
  type JijiItem,
} from './jijiShared';

function getFirstDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

function getLastDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().split('T')[0];
}

const PAGE_SIZE = 20;
const CHIP_OPTIONS = [...CATEGORIES, NONE_CATEGORY];

type Applied = { from: string; to: string; cats: Set<string> };

function inDateRange(item: JijiItem, from: string, to: string): boolean {
  const d = item.publishedAt ? item.publishedAt.slice(0, 10) : '';
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function catBadgeClass(raw: string): string {
  return CAT_COLOR[toBigCategory(raw)] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

// CSV セル用エスケープ（ダブルクォート・カンマ・改行を含む場合は引用符で囲む）
function csvCell(value: string): string {
  const v = value ?? '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface JijiSokuhoProps {
  onDetailChange?: (detail: { title: string; back: () => void } | null) => void;
  // データ取得先とCSVファイル名の接頭辞（時事速報/界面新聞で切り替え）
  endpoint?: string;
  csvPrefix?: string;
}

export default function JijiSokuho({ onDetailChange, endpoint = '/api/jiji-list', csvPrefix = 'jiji' }: JijiSokuhoProps) {
  const [allItems, setAllItems] = useState<JijiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 検索フォーム（ドラフト）
  const [draftFrom, setDraftFrom] = useState(getFirstDayOfLastMonth);
  const [draftTo, setDraftTo] = useState(getLastDayOfLastMonth);
  const [draftCats, setDraftCats] = useState<Set<string>>(() => new Set(CATEGORIES));

  // 適用済み条件（「検索」押下で反映）
  const [applied, setApplied] = useState<Applied>(() => ({
    from: getFirstDayOfLastMonth(),
    to: getLastDayOfLastMonth(),
    cats: new Set(CATEGORIES),
  }));

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<JijiItem | null>(null);
  const [exporting, setExporting] = useState(false);

  // 詳細から戻った際に元の行へ自動スクロール＆一時ハイライトするための状態
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    let aborted = false;
    // データ取得先が変わったら（タブ切替）詳細・ページを初期化し残留状態を消す
    setSelected(null);
    setPage(1);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(endpoint);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        if (!aborted) setAllItems(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [endpoint]);

  // 詳細画面の開閉を親(パンくず)へ通知。戻る操作では元の行を記憶しておく。
  useEffect(() => {
    if (!onDetailChange) return;
    if (selected) {
      const id = selected.id;
      onDetailChange({
        title: selected.title || '(無題)',
        back: () => {
          setPendingScrollId(id);
          setSelected(null);
        },
      });
    } else {
      onDetailChange(null);
    }
  }, [selected, onDetailChange]);

  // アンマウント時にパンくずの詳細表示をクリア
  useEffect(() => () => onDetailChange?.(null), [onDetailChange]);

  const toggleCat = (c: string) => {
    setDraftCats((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const handleSearch = () => {
    setApplied({ from: draftFrom, to: draftTo, cats: new Set(draftCats) });
    setPage(1);
  };

  // 統計は日付範囲のみに依存（分類チップの影響を受けない）
  const rangeItems = useMemo(
    () => allItems.filter((it) => inDateRange(it, applied.from, applied.to)),
    [allItems, applied.from, applied.to]
  );

  const stats = useMemo(() => {
    const total = rangeItems.length;
    let unsafe = 0;
    const perCat: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const it of rangeItems) {
      const big = toBigCategory(it.category);
      if (big && big !== NONE_CATEGORY) unsafe++;
      if (big in perCat) perCat[big]++;
    }
    return { total, unsafe, perCat };
  }, [rangeItems]);

  // 一覧は日付範囲 + 分類チップで絞り込み、掲載日時の降順
  const filtered = useMemo(() => {
    return rangeItems
      .filter((it) => {
        const big = toBigCategory(it.category);
        if (!big) return false; // 未処理（空）はチップが無いため常に非表示
        return applied.cats.has(big);
      })
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  }, [rangeItems, applied.cats]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 戻った後、対象行のあるページへ移動しスクロール＆ハイライト
  useEffect(() => {
    if (!pendingScrollId) return;
    const idx = filtered.findIndex((x) => x.id === pendingScrollId);
    if (idx < 0) {
      setPendingScrollId(null);
      return;
    }
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (page !== targetPage) {
      setPage(targetPage);
      return; // ページ更新後の再レンダリングで再実行
    }
    const el = rowRefs.current.get(pendingScrollId);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightId(pendingScrollId);
      setTimeout(() => setHighlightId(null), 1600);
    }
    setPendingScrollId(null);
  }, [pendingScrollId, page, filtered]);

  const handleExportCsv = async () => {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();

      const header = [
        '掲載日時', 'タイトル', 'URL', 'AI概要', '会社名',
        '会社概要', '統一会社信用コード', '不安情報分類', 'スクリーンショット',
      ];
      const rows: string[] = [header.map(csvCell).join(',')];

      // 各行のスクリーンショットを取得しつつ CSV 行を組み立てる
      for (const it of filtered) {
        const shotPaths: string[] = [];
        for (let i = 0; i < it.screenshots.length; i++) {
          const shot = it.screenshots[i];
          try {
            const res = await fetch(`/api/test-center/notion-image?url=${encodeURIComponent(shot.url)}`);
            if (!res.ok) continue;
            const data = await res.json();
            const dataUri: string = typeof data.dataUri === 'string' ? data.dataUri : '';
            const base64 = dataUri.split(',')[1];
            if (!base64) continue;

            let name = shot.name || `${it.id}_${i}.png`;
            if (usedNames.has(name)) {
              const dot = name.lastIndexOf('.');
              const stem = dot >= 0 ? name.slice(0, dot) : name;
              const ext = dot >= 0 ? name.slice(dot) : '';
              name = `${stem}_${i}${ext}`;
            }
            usedNames.add(name);
            zip.file(`screenshots/${name}`, base64, { base64: true });
            shotPaths.push(`screenshots/${name}`);
          } catch {
            // 取得失敗はスキップ
          }
        }

        rows.push(
          [
            it.publishedAt ? it.publishedAt.slice(0, 10) : '',
            it.title,
            it.url,
            it.aiSummary,
            it.companyName,
            it.companyProfile,
            it.creditCode,
            it.category,
            shotPaths.join(';'),
          ].map(csvCell).join(',')
        );
      }

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      // UTF-8 BOM を付与して Excel の文字化けを防ぐ
      zip.file(`${csvPrefix}_${stamp}.csv`, '﻿' + rows.join('\r\n'));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${csvPrefix}_${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  if (selected) {
    return <JijiDetail item={selected} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500">検索結果</span>
          <span className="text-sm font-bold text-neutral-900 tabular-nums">{filtered.length}</span>
          <span className="text-sm text-neutral-500">件</span>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filtered.length === 0 || exporting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          CSV出力
        </button>
      </div>

      {/* 統計パネル（日付範囲のみに依存） */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-neutral-50 rounded-xl px-4 py-3.5 border-l-[3px] border-l-neutral-400">
          <div className="text-xs text-neutral-500 mb-1">件数</div>
          <div className="text-3xl font-bold tabular-nums tracking-tight text-neutral-900">{stats.total}</div>
        </div>
        <div className="bg-neutral-50 rounded-xl px-4 py-3.5 border-l-[3px] border-l-red-500">
          <div className="text-xs text-neutral-500 mb-1">不安情報件数</div>
          <div className="text-3xl font-bold tabular-nums tracking-tight text-red-600">{stats.unsafe}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {CATEGORIES.map((c) => (
          <div key={c} className="bg-white border border-neutral-200 rounded-lg px-3 py-2">
            <div className="text-[11px] text-neutral-500 mb-0.5 truncate" title={c}>{c}</div>
            <div className="text-lg font-bold tabular-nums text-neutral-800">{stats.perCat[c]}</div>
          </div>
        ))}
      </div>

      {/* 検索条件 */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-500">開始日</label>
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="block border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-500">終了日</label>
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="block border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-neutral-500">不安情報分類</label>
          <div className="flex flex-wrap gap-1.5">
            {CHIP_OPTIONS.map((c) => {
              const on = draftCats.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCat(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    on
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:border-neutral-300'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleSearch}
          className="flex items-center gap-2 px-5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
        >
          <Search size={15} />
          検索
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* 一覧 */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="px-5 py-12 text-center text-sm text-neutral-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            読み込み中...
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-neutral-400">条件に一致するデータがありません。</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600 w-28 whitespace-nowrap">掲載日時</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">タイトル</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">不安情報内容</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600 w-40 whitespace-nowrap">不安情報分類</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((it, i) => (
                    <tr
                      key={it.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(it.id, el);
                        else rowRefs.current.delete(it.id);
                      }}
                      className={`transition-colors ${
                        highlightId === it.id
                          ? 'bg-amber-100'
                          : i % 2 === 0
                            ? 'bg-white'
                            : 'bg-neutral-50/50'
                      }`}
                    >
                      <td className="px-4 py-3 text-neutral-500 whitespace-nowrap align-top">
                        {it.publishedAt ? it.publishedAt.slice(0, 10) : '-'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => setSelected(it)}
                          className="text-left text-blue-600 hover:underline"
                        >
                          {it.title || '(無題)'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 align-top">
                        <span className="line-clamp-2">{it.aiSummary || '-'}</span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {it.category.trim() ? (
                          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${catBadgeClass(it.category)}`}>
                            {it.category.trim()}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-end gap-2 text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 rounded border text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                >
                  ‹
                </button>
                <span className="text-neutral-500">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded border text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                >
                  ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
