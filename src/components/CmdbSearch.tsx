import { useState } from 'react';
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';

interface CmdbSearchProps {
  onBack: () => void;
}

const SERVICE_OPTIONS = [
  { value: 'C0000001', label: '与信　管理ツール' },
  { value: 'C0000002', label: '与信管理ASP' },
  { value: 'C0000041', label: '海外調書システム' },
  { value: 'C0000030', label: '上海利墨システム' },
  { value: 'C0000038', label: '教育コンテンツ' },
  { value: 'C0000027', label: 'スマホアプリ開発' },
  { value: 'C0000012', label: '教育支援' },
  { value: 'C0000017', label: 'J-MOTTO' },
  { value: 'C0000021', label: '名館長' },
];

interface CmdbResult {
  status: string;
  code: string;
  summary: string;
  addDate: string;
  releaseDate: string;
  serviceStartDate: string;
  completeDate: string;
  rmChargeUser: string;
  tmxChargeUser: string;
}

function getFirstDayOfMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}/${m}/01`;
}

function getLastDayOfMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}/${String(m).padStart(2, '0')}/${String(lastDay).padStart(2, '0')}`;
}

export default function CmdbSearch({ onBack }: CmdbSearchProps) {
  const [releaseDateFrom, setReleaseDateFrom] = useState(getFirstDayOfMonth());
  const [releaseDateTo, setReleaseDateTo] = useState(getLastDayOfMonth());
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [results, setResults] = useState<CmdbResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const toggleService = (value: string) => {
    setSelectedServices(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const FETCH_TIMEOUT_MS = 90_000;

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/cmdb-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseDateFrom, releaseDateTo, selectedServices }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResults(data.results ?? []);
      setCurrentPage(1);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('検索がタイムアウトしました（90秒）。条件を絞って再試行してください。');
      } else {
        setError(e.message);
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
        >
          首页
        </button>
        <span className="text-neutral-400">{'>>'}</span>
        <span className="text-neutral-900 font-medium">CMDB検索</span>
      </nav>

      {/* Search form */}
      <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
        {/* Release date range */}
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700 whitespace-nowrap">
              リリース日開始日
            </label>
            <input
              type="text"
              value={releaseDateFrom}
              onChange={e => setReleaseDateFrom(e.target.value)}
              placeholder="2026/05/01"
              className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700 whitespace-nowrap">
              リリース日終了日
            </label>
            <input
              type="text"
              value={releaseDateTo}
              onChange={e => setReleaseDateTo(e.target.value)}
              placeholder="2026/05/31"
              className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
        </div>

        {/* 変更対象 checkboxes */}
        <div>
          <label className="text-sm font-medium text-neutral-700 block mb-3">変更対象</label>
          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            {SERVICE_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={selectedServices.includes(opt.value)}
                  onChange={() => toggleService(opt.value)}
                  className="rounded border-neutral-300 accent-neutral-800"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Search button */}
        <div className="flex justify-end pt-1">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            検索
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          エラー: {error}
        </div>
      )}

      {/* Empty state */}
      {results !== null && results.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-neutral-400 text-sm">
          該当するデータがありません
        </div>
      )}

      {/* Results table */}
      {results && results.length > 0 && (() => {
        const totalPages = Math.ceil(results.length / PAGE_SIZE);
        const pageRows = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
        const startIndex = (currentPage - 1) * PAGE_SIZE;

        // page number buttons: show at most 5 around current
        const pageNums: number[] = [];
        const delta = 2;
        for (let p = Math.max(1, currentPage - delta); p <= Math.min(totalPages, currentPage + delta); p++) {
          pageNums.push(p);
        }

        return (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            {/* Table header bar */}
            <div className="px-6 py-3 border-b border-neutral-100 flex items-center justify-between text-sm text-neutral-500">
              <span className="font-medium">
                {results.length} 件中 {startIndex + 1}〜{Math.min(startIndex + PAGE_SIZE, results.length)} 件表示
              </span>
              {totalPages > 1 && (
                <span>{currentPage} / {totalPages} ページ</span>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-600 font-semibold text-left">
                    <th className="px-3 py-2 whitespace-nowrap">ステータス</th>
                    <th className="px-3 py-2 whitespace-nowrap">コード</th>
                    <th className="px-3 py-2">変更の概要</th>
                    <th className="px-3 py-2 whitespace-nowrap">起案日</th>
                    <th className="px-3 py-2 whitespace-nowrap">リリース</th>
                    <th className="px-3 py-2 whitespace-nowrap">S-IN</th>
                    <th className="px-3 py-2 whitespace-nowrap">完了日</th>
                    <th className="px-3 py-2 whitespace-nowrap">依頼元担</th>
                    <th className="px-3 py-2 whitespace-nowrap">依頼先担</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pageRows.map((row, i) => (
                    <tr key={startIndex + i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#EFF6FF]'}>
                      <td className="px-3 py-2 whitespace-nowrap">{row.status}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-blue-600">{row.code}</td>
                      <td className="px-3 py-2 max-w-xs">{row.summary}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.addDate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.releaseDate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.serviceStartDate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.completeDate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.rmChargeUser}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.tmxChargeUser}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-neutral-100 flex items-center justify-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>

                {pageNums[0] > 1 && (
                  <>
                    <button onClick={() => setCurrentPage(1)} className="min-w-[32px] h-8 px-2 rounded-lg text-sm text-neutral-500 hover:bg-neutral-100 transition-colors">1</button>
                    {pageNums[0] > 2 && <span className="text-neutral-300 text-sm px-1">…</span>}
                  </>
                )}

                {pageNums.map(p => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={[
                      'min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors',
                      p === currentPage
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-500 hover:bg-neutral-100',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}

                {pageNums[pageNums.length - 1] < totalPages && (
                  <>
                    {pageNums[pageNums.length - 1] < totalPages - 1 && <span className="text-neutral-300 text-sm px-1">…</span>}
                    <button onClick={() => setCurrentPage(totalPages)} className="min-w-[32px] h-8 px-2 rounded-lg text-sm text-neutral-500 hover:bg-neutral-100 transition-colors">{totalPages}</button>
                  </>
                )}

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Initial hint */}
      {results === null && !error && !loading && (
        <div className="text-center text-neutral-400 text-sm py-8">
          検索条件を入力して「検索」ボタンをクリックしてください
        </div>
      )}
    </motion.div>
  );
}
