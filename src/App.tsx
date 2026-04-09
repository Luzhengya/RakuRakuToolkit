/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { 
  Grid
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Home from './components/Home';
import ExcelToMarkdown from './components/ExcelToMarkdown';
import PdfToWord from './components/PdfToWord';
import PdfMerge from './components/PdfMerge';

type View = 'home' | 'excel-to-md' | 'pdf-to-word' | 'pdf-merge';

export default function App() {
  const [view, setView] = useState<View>('home');

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-neutral-800 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setView('home')}
          >
            <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <Grid size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ToolSetLimo</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-500">
            <button onClick={() => setView('home')} className="hover:text-neutral-900 transition-colors">所有工具</button>
            <a href="#" className="hover:text-neutral-900 transition-colors">关于</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex-1 w-full">
        <AnimatePresence mode="wait">
          {view === 'home' ? (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Home onSelectTool={(toolId) => setView(toolId as View)} />
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
          ) : (
            <motion.div
              key="pdf-merge"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <PdfMerge onBack={() => setView('home')} />
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



