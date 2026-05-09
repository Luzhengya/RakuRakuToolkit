import {
  FileSpreadsheet,
  FileText as FilePdf,
  Layers,
  LayoutGrid,
  FilePen,
  Loader2,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Tool {
  id: string;
  title: string;
  description: string;
  category: '文档类' | '管理类';
  icon: React.ReactNode;
  onClick: () => void;
}

const CATEGORY_META: Record<string, { heading: string; sub: string }> = {
  文档类: { heading: '文档工具', sub: '文件格式转换、合并与编辑' },
  管理类: { heading: '管理工具', sub: '项目与测试过程管理' },
};

interface HomeProps {
  category: '文档类' | '管理类';
  onSelectTool: (id: string) => void;
}

export default function Home({ category, onSelectTool }: HomeProps) {
  const allTools: Tool[] = [
    {
      id: 'excel-to-md',
      title: 'Excel转Markdown',
      description: '将Excel文件转换为精简的Markdown表格，支持图片提取和形状文字识别。',
      category: '文档类',
      icon: <FileSpreadsheet className="text-green-600" size={24} />,
      onClick: () => onSelectTool('excel-to-md'),
    },
    {
      id: 'pdf-to-word',
      title: 'PDF转Word',
      description: '将PDF文件转换为可编辑的Word文档，保持原有文件名。',
      category: '文档类',
      icon: <FilePdf className="text-red-600" size={24} />,
      onClick: () => onSelectTool('pdf-to-word'),
    },
    {
      id: 'pdf-merge',
      title: 'PDF合并',
      description: '上传多个PDF文件，拖拽调整合并顺序，一键合并成单个PDF文件下载。',
      category: '文档类',
      icon: <Layers className="text-indigo-600" size={24} />,
      onClick: () => onSelectTool('pdf-merge'),
    },
    {
      id: 'pdf-edit',
      title: 'PDF编辑',
      description: '上传PDF文件，直接点击文字区域修改内容，支持中日文，完成后下载修改版。',
      category: '文档类',
      icon: <FilePen className="text-violet-600" size={24} />,
      onClick: () => onSelectTool('pdf-edit'),
    },
    {
      id: 'test-center',
      title: '测试中心',
      description: '进入测试中心管理画面，按区域管理测试模块。',
      category: '管理类',
      icon: <LayoutGrid className="text-sky-600" size={24} />,
      onClick: () => onSelectTool('test-center'),
    },
    {
      id: 'cmdb-search',
      title: 'CMDB検索',
      description: 'CMDBシステムのRFCリストをリリース日・変更対象で検索し、結果を一覧表示します。',
      category: '管理类',
      icon: <LayoutGrid className="text-teal-600" size={24} />,
      onClick: () => onSelectTool('cmdb-search'),
    },
  ];

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
            <p className="text-sm font-medium">更多工具开发中...</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ToolCard({ title, description, category, icon, onClick }: any) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-all cursor-pointer group"
      onClick={onClick}
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
          进入 <ChevronRight size={16} />
        </div>
      </div>
    </motion.div>
  );
}
