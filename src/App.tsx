/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Grid } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Home from './components/Home';
import ExcelToMarkdown from './components/ExcelToMarkdown';
import PdfToWord from './components/PdfToWord';
import PdfMerge from './components/PdfMerge';
import PdfEditor from './components/PdfEditor';
import TestCenter from './components/TestCenter';
import CmdbSearch from './components/CmdbSearch';

type View = 'home' | 'excel-to-md' | 'pdf-to-word' | 'pdf-merge' | 'pdf-edit' | 'test-center' | 'cmdb-search';
type Category = '文档类' | '管理类';

const CATEGORIES: Category[] = ['文档类', '管理类'];

export default function App() {
  const [view, setView] = useState<View>('home');
  const [category, setCategory] = useState<Category>('文档类');

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
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => switchCategory(cat)}
                  className={[
                    'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                    category === cat && view === 'home'
                      ? 'bg-white text-neutral-900 shadow-sm font-semibold'
                      : 'text-neutral-500 hover:text-neutral-700',
                  ].join(' ')}
                >
                  {cat}
                </button>
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
          ) : view === 'cmdb-search' ? (
            <motion.div
              key="cmdb-search"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <CmdbSearch onBack={() => setView('home')} />
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
            <a href="#" className="hover:text-neutral-600">隐私政策</a>
            <a href="#" className="hover:text-neutral-600">服务条款</a>
          </div>
        </div>
      </footer>
    </div>
  );
}



