import { useState } from 'react';
import { Search } from 'lucide-react';

const DEFAULT_KEYWORDS =
  '倒産 or 破産 or 破綻 or ディフォルト or リストラ or 撤退 or 遅延 or 赤字 or 悪化 or 不振';

const REGIONS = [
  { id: 'china',            label: '中国' },
  { id: 'beijing-tianjin', label: '北京・天津' },
  { id: 'dalian-shenyang', label: '大連・瀋陽・東北' },
  { id: 'qingdao-shandong',label: '青島・山東省' },
  { id: 'shanghai-east',   label: '上海・華東' },
  { id: 'sichuan-west',    label: '四川・中西部' },
  { id: 'hongkong-south',  label: '香港・華南' },
];

function getFirstDayOfLastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

function getLastDayOfLastMonth() {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().split('T')[0];
}

interface JijiResult {
  title: string;
  date: string;
  region: string;
  url: string;
  summary: string;
}

const FETCH_TIMEOUT_MS = 120_000;
const PAGE_SIZE = 20;

export default function JijiSokuho() {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [dateFrom, setDateFrom] = useState(getFirstDayOfLastMonth);
  const [dateTo, setDateTo] = useState(getLastDayOfLastMonth);
  const [regions, setRegions] = useState<Set<string>>(
    () => new Set(REGIONS.map(r => r.id))
  );
  const [results, setResults] = useState<JijiResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const toggleRegion = (id: string) => {
    setRegions(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setPage(1);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch('/api/jiji-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, dateFrom, dateTo, regions: [...regions] }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'データ収集に失敗しました');
      setResults(json.results);
    } catch (e: any) {
      setError(
        e.name === 'AbortError'
          ? 'タイムアウトしました。再試行してください。'
          : e.message
      );
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const paged = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Search form */}
      <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
        {/* フリーワード */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">フリーワード</label>
          <input
            type="text"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
        </div>

        {/* 日付 */}
        <div className="flex gap-4">
          <div className="space-y-1.5 flex-1">
            <label className="text-sm font-medium text-neutral-700">開始日</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
          <div className="space-y-1.5 flex-1">
            <label className="text-sm font-medium text-neutral-700">終了日</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
        </div>

        {/* 国・地域 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-neutral-700">国・地域</label>
            <div className="flex gap-2 text-xs text-neutral-500">
              <button
                onClick={() => setRegions(new Set(REGIONS.map(r => r.id)))}
                className="hover:text-neutral-800 transition-colors"
              >
                全選択
              </button>
              <span className="text-neutral-300">|</span>
              <button
                onClick={() => setRegions(new Set())}
                className="hover:text-neutral-800 transition-colors"
              >
                全解除
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {REGIONS.map(r => (
              <label key={r.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={regions.has(r.id)}
                  onChange={() => toggleRegion(r.id)}
                  className="rounded border-neutral-300"
                />
                <span className="text-sm text-neutral-700">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 収集ボタン */}
        <button
          onClick={handleSearch}
          disabled={loading || regions.size === 0}
          className="flex items-center gap-2 px-5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Search size={15} />
          {loading ? '収集中...' : '収集'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">{results.length} 件</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 rounded border text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                >
                  ‹
                </button>
                <span className="text-neutral-500">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded border text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-600 w-28 whitespace-nowrap">日付</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-600 w-36 whitespace-nowrap">地域</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-600">タイトル</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'}>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{r.region}</td>
                    <td className="px-4 py-3">
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {r.title}
                        </a>
                      ) : (
                        <span className="text-neutral-800">{r.title}</span>
                      )}
                      {r.summary && (
                        <p className="text-xs text-neutral-400 mt-0.5 line-clamp-2">{r.summary}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && results.length === 0 && !error && (
        <div className="text-center py-16 text-neutral-400 text-sm">
          条件を入力して収集ボタンをクリックしてください
        </div>
      )}
    </div>
  );
}
