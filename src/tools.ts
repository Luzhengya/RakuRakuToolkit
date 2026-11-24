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
  NotebookPen,
  Bug,
  Send,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type Category = 'ドキュメント類' | '管理類' | 'データ収集類';

/** ホーム画面のカードとヘッダーのドロップダウンで共用するツール定義 */
export interface ToolDef {
  id: string;
  title: string;
  description: string;
  category: Category;
  icon: LucideIcon;
  iconClass: string;
  /** 外部サイト（新しいタブで開く）の場合のみ指定 */
  href?: string;
  /** ヘッダーのドロップダウンに表示しない（ホームのカードには表示する） */
  hideInMenu?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'excel-to-md',
    title: 'Excel→Markdown変換',
    description: 'ExcelファイルをシンプルなMarkdownの表に変換します。画像の抽出や図形内の文字認識にも対応しています。',
    category: 'ドキュメント類',
    icon: FileSpreadsheet,
    iconClass: 'text-green-600',
  },
  {
    id: 'pdf-to-word',
    title: 'PDF→Word変換',
    description: 'PDFファイルを編集可能なWord文書に変換します。ファイル名は元のまま保持します。',
    category: 'ドキュメント類',
    icon: FilePdf,
    iconClass: 'text-red-600',
  },
  {
    id: 'pdf-merge',
    title: 'PDF結合',
    description: '複数のPDFファイルをアップロードし、ドラッグで順番を並べ替えて、1つのPDFにまとめてダウンロードします。',
    category: 'ドキュメント類',
    icon: Layers,
    iconClass: 'text-indigo-600',
  },
  {
    id: 'pdf-edit',
    title: 'PDF編集',
    description: 'PDFファイルをアップロードし、文字の部分をクリックして直接修正できます。日本語・中国語に対応し、修正後のファイルをダウンロードできます。',
    category: 'ドキュメント類',
    icon: FilePen,
    iconClass: 'text-violet-600',
  },
  {
    id: 'hennge-transfer',
    title: 'HENNGE Transfer',
    description: 'ファイル転送ツールです。HENNGE Transfer を新しいタブで開きます。',
    category: 'ドキュメント類',
    icon: Send,
    iconClass: 'text-sky-600',
    href: 'https://transfer.hennge.com/',
  },
  {
    id: 'safe-ai',
    title: 'Safe AI',
    description: 'リスクモンスター社内のAIであり、情報漏えいのリスクはなく、安心してデータを処理できるAIです。',
    category: 'ドキュメント類',
    icon: ShieldCheck,
    iconClass: 'text-emerald-600',
    href: 'https://sag-m-a4ruxh.gw.safeai.jp/#',
  },
  {
    id: 'pdf-edit-table',
    title: 'PDF編集（表対応）',
    description: 'テスト中',
    category: 'ドキュメント類',
    icon: FilePen,
    iconClass: 'text-indigo-600',
    hideInMenu: true,
  },
  {
    id: 'test-center',
    title: 'Test Center',
    description: 'テストセンターの管理画面を開き、エリアごとにテストモジュールを管理します。',
    category: '管理類',
    icon: LayoutGrid,
    iconClass: 'text-sky-600',
  },
  {
    id: 'case-management',
    title: '案件管理',
    description: '案件の新規作成・編集・削除をツリー形式で管理します。',
    category: '管理類',
    icon: FolderTree,
    iconClass: 'text-orange-600',
  },
  {
    id: 'bug-list',
    title: 'BUG管理',
    description: '全システムの BUG を一覧で確認・登録・編集します。',
    category: '管理類',
    icon: Bug,
    iconClass: 'text-red-600',
  },
  {
    id: 'testcase-library',
    title: 'TestCase Library',
    description: 'システムごとの基礎テストケースライブラリを閲覧します。',
    category: '管理類',
    icon: ClipboardList,
    iconClass: 'text-emerald-600',
  },
  {
    id: 'testcase-organize',
    title: 'Testcase Format',
    description: '上传测试用例 CSV，整形为标准 Excel 格式并按需求分组汇总测试结果。',
    category: '管理類',
    icon: ClipboardList,
    iconClass: 'text-teal-600',
  },
  {
    id: 'testcase-view',
    title: 'TestCase',
    description: 'Testcase Format で登録したテストケースを、月次・CMDB番号・分類などで絞り込んで確認します。',
    category: '管理類',
    icon: ClipboardList,
    iconClass: 'text-indigo-600',
  },
  {
    id: 'data-stats',
    title: 'データ統計',
    description: '需求池・品質問題・Checklist・AI実績などのデータ統計を管理します。',
    category: '管理類',
    icon: BarChart3,
    iconClass: 'text-violet-600',
  },
  {
    id: 'reports',
    title: 'レポート',
    description: 'レポートを作成・編集し、共有リンクで注記をもらいます。',
    category: '管理類',
    icon: NotebookPen,
    iconClass: 'text-orange-600',
  },
  {
    id: 'data-collection',
    title: '不安情報収集',
    description: '月次不安情報を集計・検索し、詳細確認やCSV出力ができます。',
    category: 'データ収集類',
    icon: LayoutGrid,
    iconClass: 'text-emerald-600',
  },
  {
    id: 'daily-news',
    title: '毎日ニュース',
    description: '毎日のニュースを収集・整理します（開発中）。',
    category: 'データ収集類',
    icon: Newspaper,
    iconClass: 'text-amber-600',
    hideInMenu: true,
  },
];

/** 外部ツールは新しいタブで開き、それ以外は画面遷移する */
export function openTool(tool: ToolDef, onSelectTool: (id: string) => void) {
  if (tool.href) window.open(tool.href, '_blank', 'noopener');
  else onSelectTool(tool.id);
}
