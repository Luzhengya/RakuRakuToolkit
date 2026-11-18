import {
  BarChart3,
  FileSpreadsheet,
  FileText as FilePdf,
  Layers,
  LayoutGrid,
  FilePen,
  ClipboardList,
  FolderTree,
  Newspaper,
  Loader2,
  ExternalLink,
  ChevronRight,
  NotebookPen,
  Bug,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

interface Tool {
  id: string;
  title: string;
  description: string;
  category: 'ドキュメント類' | '管理類' | 'データ収集類';
  icon: ReactNode;
  onClick: () => void;
}

const CATEGORY_META: Record<string, { heading: string; sub: string }> = {
  ドキュメント類:      { heading: 'ドキュメントツール', sub: 'ファイル形式の変換・結合・編集' },
  管理類:      { heading: '管理ツール',   sub: 'プロジェクトとテスト工程の管理' },
  データ収集類: { heading: 'データ収集ツール', sub: 'ウェブ情報の自動収集と整理' },
};

interface HomeProps {
  category: 'ドキュメント類' | '管理類' | 'データ収集類';
  onSelectTool: (id: string) => void;
}

export default function Home({ category, onSelectTool }: HomeProps) {
  const allTools: Tool[] = [
    {
      id: 'excel-to-md',
      title: 'Excel→Markdown変換',
      description: 'ExcelファイルをシンプルなMarkdownの表に変換します。画像の抽出や図形内の文字認識にも対応しています。',
      category: 'ドキュメント類',
      icon: <FileSpreadsheet className="text-green-600" size={24} />,
      onClick: () => onSelectTool('excel-to-md'),
    },
    {
      id: 'pdf-to-word',
      title: 'PDF→Word変換',
      description: 'PDFファイルを編集可能なWord文書に変換します。ファイル名は元のまま保持します。',
      category: 'ドキュメント類',
      icon: <FilePdf className="text-red-600" size={24} />,
      onClick: () => onSelectTool('pdf-to-word'),
    },
    {
      id: 'pdf-merge',
      title: 'PDF結合',
      description: '複数のPDFファイルをアップロードし、ドラッグで順番を並べ替えて、1つのPDFにまとめてダウンロードします。',
      category: 'ドキュメント類',
      icon: <Layers className="text-indigo-600" size={24} />,
      onClick: () => onSelectTool('pdf-merge'),
    },
    {
      id: 'pdf-edit',
      title: 'PDF編集',
      description: 'PDFファイルをアップロードし、文字の部分をクリックして直接修正できます。日本語・中国語に対応し、修正後のファイルをダウンロードできます。',
      category: 'ドキュメント類',
      icon: <FilePen className="text-violet-600" size={24} />,
      onClick: () => onSelectTool('pdf-edit'),
    },
    {
      id: 'hennge-transfer',
      title: 'HENNGE Transfer',
      description: 'ファイル転送ツールです。HENNGE Transfer を新しいタブで開きます。',
      category: 'ドキュメント類',
      icon: <Send className="text-sky-600" size={24} />,
      onClick: () => window.open('https://transfer.hennge.com/', '_blank', 'noopener'),
    },
    {
      id: 'safe-ai',
      title: 'Safe AI',
      description: 'リスクモンスター社内のAIであり、情報漏えいのリスクはなく、安心してデータを処理できるAIです。',
      category: 'ドキュメント類',
      icon: <ShieldCheck className="text-emerald-600" size={24} />,
      onClick: () => window.open('https://sag-m-a4ruxh.gw.safeai.jp/#', '_blank', 'noopener'),
    },
    {
      id: 'pdf-edit-table',
      title: 'PDF編集（表対応）',
      description: 'テスト中',
      category: 'ドキュメント類',
      icon: <FilePen className="text-indigo-600" size={24} />,
      onClick: () => onSelectTool('pdf-edit-table'),
    },
    {
      id: 'test-center',
      title: 'Test Center',
      description: 'テストセンターの管理画面を開き、エリアごとにテストモジュールを管理します。',
      category: '管理類',
      icon: <LayoutGrid className="text-sky-600" size={24} />,
      onClick: () => onSelectTool('test-center'),
    },
    {
      id: 'case-management',
      title: '案件管理',
      description: '案件の新規作成・編集・削除をツリー形式で管理します。',
      category: '管理類',
      icon: <FolderTree className="text-orange-600" size={24} />,
      onClick: () => onSelectTool('case-management'),
    },
    {
      id: 'bug-list',
      title: 'BUG管理',
      description: '全システムの BUG を一覧で確認・登録・編集します。',
      category: '管理類',
      icon: <Bug className="text-red-600" size={24} />,
      onClick: () => onSelectTool('bug-list'),
    },
    {
      id: 'testcase-library',
      title: 'TestCase Library',
      description: 'システムごとの基礎テストケースライブラリを閲覧します。',
      category: '管理類',
      icon: <ClipboardList className="text-emerald-600" size={24} />,
      onClick: () => onSelectTool('testcase-library'),
    },
    {
      id: 'testcase-organize',
      title: 'Testcase Format',
      description: '上传测试用例 CSV，整形为标准 Excel 格式并按需求分组汇总测试结果。',
      category: '管理類',
      icon: <ClipboardList className="text-teal-600" size={24} />,
      onClick: () => onSelectTool('testcase-organize'),
    },
    {
      id: 'testcase-view',
      title: 'TestCase',
      description: 'Testcase Format で登録したテストケースを、月次・CMDB番号・分類などで絞り込んで確認します。',
      category: '管理類',
      icon: <ClipboardList className="text-indigo-600" size={24} />,
      onClick: () => onSelectTool('testcase-view'),
    },
    {
      id: 'data-stats',
      title: 'データ統計',
      description: '需求池・品質問題・Checklist・AI実績などのデータ統計を管理します。',
      category: '管理類',
      icon: <BarChart3 className="text-violet-600" size={24} />,
      onClick: () => onSelectTool('data-stats'),
    },
    {
      id: 'reports',
      title: 'レポート',
      description: 'レポートを作成・編集し、共有リンクで注記をもらいます。',
      category: '管理類',
      icon: <NotebookPen className="text-orange-600" size={24} />,
      onClick: () => onSelectTool('reports'),
    },
    {
      id: 'data-collection',
      title: '不安情報収集',
      description: '月次不安情報を集計・検索し、詳細確認やCSV出力ができます。',
      category: 'データ収集類',
      icon: <LayoutGrid className="text-emerald-600" size={24} />,
      onClick: () => onSelectTool('data-collection'),
    },
    {
      id: 'daily-news',
      title: '毎日ニュース',
      description: '毎日のニュースを収集・整理します（開発中）。',
      category: 'データ収集類',
      icon: <Newspaper className="text-amber-600" size={24} />,
      onClick: () => onSelectTool('daily-news'),
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
            <p className="text-sm font-medium">その他のツールを開発中...</p>
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
          開く <ChevronRight size={16} />
        </div>
      </div>
    </motion.div>
  );
}
