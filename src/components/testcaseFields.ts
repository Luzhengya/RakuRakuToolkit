// テストケースの表示定義。
// TestCase 画面の詳細ダイアログ (編集可) と、案件詳細から開く読み取り専用
// ダイアログの両方から使う。項目の並びがずれないよう1か所にまとめる。

// Notion の「{システム}{年度}」テーブル 1 行 (属性名をキーにした素の文字列)
export type TcRow = Record<string, string> & { id: string };

// 左に大きく見せる項目。
// 備考は自由記述で行数が読めないため、右の一覧では窮屈になる。予期結果の下に置く。
export const PRIMARY_FIELDS = ['テスト内容', '前提条件', 'ステップ', '予期結果', '備考'] as const;

// 右上に強調して出す項目
export const HIGHLIGHT_FIELDS = ['テスト結果', '優先級'] as const;

// 残りの項目 (ケース番号はヘッダ、備考は左に出すので重複させない)
export const SECONDARY_FIELDS = [
  'システム', '月次', 'CMDB番号',
  '大分類', '中分類', '小分類',
  '機能名', '要件名',
  'ポイント', 'カテゴリ', '状態',
  '作成者', '作成日', '更新者', '更新日',
  'バージョン', '関連NO',
] as const;

export const RESULT_COLOR: Record<string, string> = {
  OK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NG: 'bg-red-50 text-red-700 border-red-200',
  'テスト不可': 'bg-amber-50 text-amber-700 border-amber-200',
  '未実施': 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

// 長文はダイアログで改行を保持したいので pre-wrap 対象にする項目
export const LONG_TEXT_FIELDS = new Set(['前提条件', 'ステップ', '予期結果', 'テスト内容', '備考']);
