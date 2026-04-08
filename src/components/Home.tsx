import { 
  FileSpreadsheet, 
  FileText as FilePdf, 
  Loader2, 
  ExternalLink, 
  ChevronRight 
} from 'lucide-react';
import { motion } from 'motion/react';

export default function Home({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  const tools = [
    {
      id: 'excel-to-md',
      title: 'Excel转Markdown',
      description: '将Excel文件转换为精简的Markdown表格，支持图片提取和形状文字识别。',
      category: '文档类',
      icon: <FileSpreadsheet className="text-green-600" size={24} />,
      onClick: () => onSelectTool('excel-to-md')
    },
    {
      id: 'pdf-to-word',
      title: 'PDF转Word',
      description: '将PDF文件转换为可编辑的Word文档，保持原有文件名。',
      category: '文档类',
      icon: <FilePdf className="text-red-600" size={24} />,
      onClick: () => onSelectTool('pdf-to-word')
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-neutral-900">推荐工具</h2>
        <p className="text-neutral-500">高效、简洁、好用的在线工具集</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <ToolCard key={tool.id} {...tool} />
        ))}
        
        <div className="border border-dashed border-neutral-200 rounded-xl p-6 flex flex-col items-center justify-center text-neutral-300 gap-2 min-h-[180px]">
          <div className="w-12 h-12 rounded-full bg-neutral-50 flex items-center justify-center">
            <Loader2 size={24} />
          </div>
          <p className="text-sm font-medium">更多工具开发中...</p>
        </div>
      </div>
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
