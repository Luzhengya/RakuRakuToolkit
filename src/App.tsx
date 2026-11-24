/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Grid } from 'lucide-react';
import { TOOLS, openTool } from './tools';
import { motion, AnimatePresence } from 'motion/react';
import Home from './components/Home';
import ExcelToMarkdown from './components/ExcelToMarkdown';
import PdfToWord from './components/PdfToWord';
import PdfMerge from './components/PdfMerge';
import PdfEditor from './components/PdfEditor';
import PdfEditorTable from './components/PdfEditorTable';
import TestCenter from './components/TestCenter';
import TestCaseOrganize from './components/TestCaseOrganize';
import TestCaseView from './components/TestCaseView';
import TestCaseLibrary from './components/TestCaseLibrary';
import CaseManagement from './components/CaseManagement';
import DataCollection from './components/DataCollection';
import DailyNews from './components/DailyNews';
import DataStatsPanel from './components/DataStatsPanel';
import ReportView from './components/ReportView';
import ReportListPage from './components/ReportListPage';
import BugList from './components/BugList';

type View = 'home' | 'excel-to-md' | 'pdf-to-word' | 'pdf-merge' | 'pdf-edit' | 'pdf-edit-table' | 'test-center' | 'testcase-organize' | 'testcase-view' | 'testcase-library' | 'case-management' | 'data-stats' | 'reports' | 'bug-list' | 'data-collection' | 'daily-news';
type Category = 'ドキュメント類' | '管理類' | 'データ収集類';

const CATEGORIES: Category[] = ['ドキュメント類', '管理類', 'データ収集類'];

// ヘッダーのツール一覧ドロップダウン：ホバーで開くまで／離れてから閉じるまでの遅延
const MENU_OPEN_DELAY_MS = 120;
const MENU_CLOSE_DELAY_MS = 300;

const VALID_VIEWS = new Set<string>(['home', 'excel-to-md', 'pdf-to-word', 'pdf-merge', 'pdf-edit', 'pdf-edit-table', 'test-center', 'testcase-organize', 'testcase-view', 'testcase-library', 'case-management', 'data-stats', 'reports', 'bug-list', 'data-collection', 'daily-news']);

function hashToView(): View {
  const raw = location.hash.replace(/^#\/?/, '');
  const first = raw.split('/')[0] || '';
  return VALID_VIEWS.has(first) ? (first as View) : 'home';
}

function useHashRoute(): [View, (v: View) => void] {
  const view = useSyncExternalStore(
    (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); },
    hashToView,
  );
  const navigate = useCallback((v: View) => {
    location.hash = v === 'home' ? '/' : `/${v}`;
  }, []);
  return [view, navigate];
}

// レポート共有リンク（#/report/<pageId>、編集で開く場合は …/edit）はヘッダー無しで単独表示する
// 一覧から開いた時だけ ?key=<編集キー> が付く（共有リンクには付かない）
const reportHashPath = () => location.hash.split('?')[0];

function hashToReportId(): string {
  const [first, id] = reportHashPath().replace(/^#\/?/, '').split('/');
  return first === 'report' && id ? id : '';
}

const isReportEditHash = () => /^#\/?report\/[^/]+\/edit$/.test(reportHashPath());
const reportEditKeyFromHash = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('key') ?? '';

function useReportRoute(): string {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); },
    hashToReportId,
  );
}

export default function App() {
  const [view, setView] = useHashRoute();
  const [category, setCategory] = useState<Category>('ドキュメント類');
  const [openCat, setOpenCat] = useState<Category | null>(null);
  const menuTimer = useRef<number | undefined>(undefined);
  const scheduleMenu = (cat: Category | null, delayMs: number) => {
    window.clearTimeout(menuTimer.current);
    menuTimer.current = window.setTimeout(() => setOpenCat(cat), delayMs);
  };
  useEffect(() => () => window.clearTimeout(menuTimer.current), []);
  const reportId = useReportRoute();

  if (reportId) {
    const editKey = reportEditKeyFromHash();
    return <ReportView key={reportId} reportId={reportId} editKey={editKey} initialEdit={!!editKey && isReportEditHash()} />;
  }

  const switchCategory = (cat: Category) => {
    setCategory(cat);
    setView('home');
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-neutral-800 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setView('home')}
          >
            <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <Grid size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ToolSetLimo</h1>
          </div>

          {/* Category tab switcher */}
          <nav className="hidden md:flex items-center">
            <div className="flex items-center bg-neutral-100 rounded-full p-1 gap-0.5">
              {CATEGORIES.map((cat, i) => (
                // ホバー（開く120ms・閉じる300ms遅延）／キーボードフォーカスでツール一覧を表示する（カテゴリ名クリックは従来どおりホームへ）
                <div
                  key={cat}
                  className="relative group"
                  onMouseEnter={() => scheduleMenu(cat, MENU_OPEN_DELAY_MS)}
                  onMouseLeave={() => scheduleMenu(null, MENU_CLOSE_DELAY_MS)}
                >
                  <button
                    onClick={() => switchCategory(cat)}
                    aria-haspopup="menu"
                    className={[
                      'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                      category === cat && view === 'home'
                        ? 'bg-white text-neutral-900 shadow-sm font-semibold'
                        : openCat === cat
                          ? 'bg-white/60 text-neutral-800' // 一覧を開いている間はどのカテゴリの一覧かを示す
                          : 'text-neutral-600 hover:text-neutral-800',
                    ].join(' ')}
                  >
                    {cat}
                  </button>
                  {/* 幅はカテゴリボタン以上（名称は1行表示）。-left-1／-right-1 で項目の文字頭をカテゴリ名と揃え、最後のカテゴリは画面外へはみ出さないよう右揃え。
                      白地の面板で、項目はカテゴリバーと配色を反転（バー＝灰地に白の選択／面板＝白地に灰の選択）し、角丸・余白は揃える。pt-1 はバーの内側余白ぶんの橋渡し（見た目はバー下端に接する）。
                      開く：上8pxから200msで淡入／閉じる：150ms（閉じる方を速くして軽快に） */}
                  <div
                    role="menu"
                    aria-label={cat}
                    className={[
                      'absolute top-full min-w-[calc(100%+0.5rem)] w-max pt-1 z-20',
                      i === CATEGORIES.length - 1 ? '-right-1' : '-left-1',
                      'transition-[opacity,translate,visibility] ease-out',
                      openCat === cat
                        ? 'visible opacity-100 translate-y-0 duration-200'
                        : 'invisible opacity-0 -translate-y-2 duration-150 group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:translate-y-0',
                    ].join(' ')}
                  >
                    <ul className="flex flex-col gap-0.5 bg-white rounded-2xl p-1 ring-1 ring-black/[0.06] shadow-lg shadow-black/10">
                      {TOOLS.filter(t => t.category === cat && !t.hideInMenu).map(tool => (
                        <li key={tool.id}>
                          <button
                            role="menuitem"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              scheduleMenu(null, 0);
                              openTool(tool, (id) => setView(id as View));
                            }}
                            className={[
                              'w-full px-4 py-2 rounded-full text-sm font-medium text-left whitespace-nowrap transition-all duration-200',
                              view === tool.id
                                ? 'bg-neutral-100 text-neutral-900 font-semibold'
                                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 focus-visible:bg-neutral-100',
                            ].join(' ')}
                          >
                            {tool.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex-1 w-full">
        <AnimatePresence mode="wait">
          {view === 'home' ? (
            <motion.div
              key={`home-${category}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Home
                category={category}
                onSelectTool={(toolId) => setView(toolId as View)}
              />
            </motion.div>
          ) : view === 'excel-to-md' ? (
            <motion.div
              key="excel-to-md"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <ExcelToMarkdown onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'pdf-to-word' ? (
            <motion.div
              key="pdf-to-word"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <PdfToWord onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'pdf-merge' ? (
            <motion.div
              key="pdf-merge"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <PdfMerge onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'pdf-edit' ? (
            <motion.div
              key="pdf-edit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <PdfEditor onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'pdf-edit-table' ? (
            <motion.div
              key="pdf-edit-table"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <PdfEditorTable onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'testcase-organize' ? (
            <motion.div
              key="testcase-organize"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <TestCaseOrganize onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'testcase-view' ? (
            <motion.div
              key="testcase-view"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <TestCaseView onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'testcase-library' ? (
            <motion.div
              key="testcase-library"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <TestCaseLibrary onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'case-management' ? (
            <motion.div
              key="case-management"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <CaseManagement onBack={() => setView('home')} onNavigate={setView} />
            </motion.div>
          ) : view === 'data-stats' ? (
            <motion.div
              key="data-stats"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <DataStatsPanel onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'reports' ? (
            <motion.div
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <ReportListPage onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'bug-list' ? (
            <motion.div
              key="bug-list"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <BugList lang="ja" onHome={() => setView('home')} />
            </motion.div>
          ) : view === 'data-collection' ? (
            <motion.div
              key="data-collection"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <DataCollection onBack={() => setView('home')} />
            </motion.div>
          ) : view === 'daily-news' ? (
            <motion.div
              key="daily-news"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <DailyNews onBack={() => setView('home')} />
            </motion.div>
          ) : (
            <motion.div
              key="test-center"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <TestCenter onBack={() => setView('home')} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-neutral-400">
          <p>© 2026 ToolSetLimo. All rights reserved.</p>
          <div className="flex gap-6">
            <span className="hover:text-neutral-600 cursor-default">隐私政策</span>
            <span className="hover:text-neutral-600 cursor-default">服务条款</span>
          </div>
        </div>
      </footer>
    </div>
  );
}



