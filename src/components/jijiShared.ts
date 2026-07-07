export type JijiScreenshot = { name: string; url: string };

export type JijiItem = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;   // 掲載日時 (ISO)
  url: string;
  aiSummary: string;     // AI概要 → 不安情報内容
  companyName: string;   // 会社名
  companyProfile: string; // 会社概要
  creditCode: string;    // 統一会社信用コード
  category: string;      // 不安情報分類 (自由テキスト)
  screenshots: JijiScreenshot[];
};

// 統計・検索で使う 10 大分類。実際の Notion 値は「業績悪化（赤字）」のように
// 括弧付きの細分類なので、括弧の前を大分類として突き合わせる。
export const CATEGORIES = [
  '業績悪化',
  '事業撤退',
  '店舗縮小',
  '清算',
  '資本・資産売却',
  '支払い遅延',
  '関連会社',
  '事件・事故',
  'リストラ',
  '倒産',
] as const;

export const NONE_CATEGORY = '該当なし';

// 生の分類テキスト → 大分類（全角/半角括弧の前・前後空白除去）。
// 空文字は未処理、'該当なし' はそのまま返す。
export function toBigCategory(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  return t.split(/[（(]/)[0].trim();
}

export const CAT_COLOR: Record<string, string> = {
  '業績悪化': 'bg-red-50 text-red-700 border-red-200',
  '事業撤退': 'bg-orange-50 text-orange-700 border-orange-200',
  '店舗縮小': 'bg-amber-50 text-amber-700 border-amber-200',
  '清算': 'bg-purple-50 text-purple-700 border-purple-200',
  '資本・資産売却': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  '支払い遅延': 'bg-rose-50 text-rose-700 border-rose-200',
  '関連会社': 'bg-blue-50 text-blue-700 border-blue-200',
  '事件・事故': 'bg-red-50 text-red-700 border-red-200',
  'リストラ': 'bg-orange-50 text-orange-700 border-orange-200',
  '倒産': 'bg-red-100 text-red-800 border-red-300',
  [NONE_CATEGORY]: 'bg-neutral-100 text-neutral-500 border-neutral-200',
};
