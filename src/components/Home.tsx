import {
  Loader2,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import { TOOLS, openTool, type Category } from '../tools';

interface Tool {
  id: string;
  title: string;
  description: string;
  category: Category;
  icon: ReactNode;
  onClick: () => void;
}

const CATEGORY_META: Record<string, { heading: string; sub: string }> = {
  ドキュメント類:      { heading: 'ドキュメントツール', sub: 'ファイル形式の変換・結合・編集' },
  管理類:      { heading: '管理ツール',   sub: 'プロジェクトとテスト工程の管理' },
  データ収集類: { heading: 'データ収集ツール', sub: 'ウェブ情報の自動収集と整理' },
};

interface HomeProps {
  category: Category;
  onSelectTool: (id: string) => void;
}

export default function Home({ category, onSelectTool }: HomeProps) {
  const allTools: Tool[] = TOOLS.map(def => ({
    id: def.id,
    title: def.title,
    description: def.description,
    category: def.category,
    icon: <def.icon className={def.iconClass} size={24} />,
    onClick: () => openTool(def, onSelectTool),
  }));

  const tools = allTools.filter(t => t.category === category);
  const meta = CATEGORY_META[category];

  return (
    <div className="space-y-8">
      <AnimatePresence mode="wait">
        <motion.div
          key={category}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="flex flex-col gap-2"
        >
          <h2 className="text-2xl font-bold text-neutral-900">{meta.heading}</h2>
          <p className="text-neutral-500">{meta.sub}</p>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={category}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {tools.map(tool => (
            <ToolCard key={tool.id} {...tool} />
          ))}

          {/* "Coming soon" placeholder */}
          <div className="border border-dashed border-neutral-200 rounded-xl p-6 flex flex-col items-center justify-center text-neutral-300 gap-2 min-h-[180px]">
            <div className="w-12 h-12 rounded-full bg-neutral-50 flex items-center justify-center">
              <Loader2 size={24} />
            </div>
            <p className="text-sm font-medium">その他のツールを開発中...</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// カードのホバー3D傾き
const TILT_MAX_DEG = 8;
const TILT_PERSPECTIVE_PX = 1000;
const TILT_SCALE = 1.02;
const TILT_FOLLOW_MS = 100; // マウス追従中の補間（小さいほど機敏）
const TILT_RESET_MS = 300;

const tiltTransform = (rotateX: number, rotateY: number, scale: number) =>
  `perspective(${TILT_PERSPECTIVE_PX}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;

function ToolCard({ title, description, category, icon, onClick }: any) {
  const cardRef = useRef<HTMLDivElement>(null);

  // マウス位置に応じて傾ける（カーソル側の辺が奥へ沈む）。動きを減らす設定の利用者には適用しない
  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5（左）〜 0.5（右）
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5（上）〜 0.5（下）
    el.style.transition = `transform ${TILT_FOLLOW_MS}ms ease-out, box-shadow 200ms ease-out`;
    el.style.transform = tiltTransform(-y * 2 * TILT_MAX_DEG, x * 2 * TILT_MAX_DEG, TILT_SCALE);
  };

  const handleMouseLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = `transform ${TILT_RESET_MS}ms ease-out, box-shadow 200ms ease-out`;
    el.style.transform = tiltTransform(0, 0, 1);
  };

  return (
    <div
      ref={cardRef}
      className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer group will-change-transform"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-neutral-50 rounded-xl flex items-center justify-center group-hover:bg-neutral-100 transition-colors">
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-neutral-900 group-hover:text-neutral-700 transition-colors">{title}</h3>
            <p className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider">[{category}]</p>
          </div>
        </div>
        <button className="text-neutral-300 hover:text-neutral-500 transition-colors">
          <ExternalLink size={16} />
        </button>
      </div>

      <p className="text-sm text-neutral-500 line-clamp-2 leading-relaxed h-10">
        {description}
      </p>

      <div className="flex items-center justify-end mt-2 pt-4 border-t border-neutral-50">
        <div className="flex items-center gap-1 text-sm font-bold text-neutral-900 group-hover:translate-x-1 transition-transform">
          開く <ChevronRight size={16} />
        </div>
      </div>
    </div>
  );
}
