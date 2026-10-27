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
  '再確認OK': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '再確認NG': 'bg-red-50 text-red-700 border-red-200',
};

export const RETEST_OPTIONS = ['', '再確認OK', '再確認NG'] as const;

export function effectiveResult(row: TcRow): string {
  const result = (row['テスト結果'] || '').trim();
  if (result !== 'NG') return result;
  const retest = (row['再テスト結果'] || '').trim();
  if (retest === '再確認OK') return 'OK';
  return 'NG';
}

// 長文はダイアログで改行を保持したいので pre-wrap 対象にする項目
export const LONG_TEXT_FIELDS = new Set(['前提条件', 'ステップ', '予期結果', 'テスト内容', '備考']);

// ── UnivContents 専用テンプレート (コース × ブラウザ検証項目) ──────────
// api の UC_NOTION_FIELDS と対応。テスト結果 は CSV「結果」を入れる共通の属性名。
export const UNIV_CONTENTS_SYSTEM = 'UnivContents';

export const UC_CHECK_ITEMS = [
  '①コース起動', '②動画再生', '③タイトル一致', '④コース終了',
  '⑤時間記録/進捗', '⑥試験結果の確認', '⑦ページ内にPDFリンクなど動作の確認',
] as const;

// 空欄 = 未確認
export const UC_CHECK_OPTIONS = ['', 'OK', 'NG'] as const;

// サーバー側の TESTCASE_EDITABLE_FIELDS のうち UnivContents の項目
export const UC_EDITABLE_FIELDS = new Set<string>([
  'CMDB番号', 'course_no', 'course_name', '版数', 'CHROME', ...UC_CHECK_ITEMS,
  'テスト結果', '再テスト結果', '再実施日', '再実施者', '備考',
  '作業者', '作業日', '確認者', '確認日',
]);

export const UC_PRIMARY_FIELDS = ['course_name', '備考'] as const;
export const UC_HIGHLIGHT_FIELDS = ['テスト結果', 'CHROME'] as const;
export const UC_SECONDARY_FIELDS = [
  'システム', '月次', 'CMDB番号',
  'course_no', '版数',
  '作業者', '作業日', '確認者', '確認日',
  'バージョン',
] as const;

export function isUnivContents(system: string | undefined): boolean {
  return (system ?? '').trim() === UNIV_CONTENTS_SYSTEM;
}

// 画面の見出し。UnivContents は CSV に合わせて テスト結果 →「結果」、ケース番号 →「course_id」と出す
export function tcLabel(field: string, uc: boolean): string {
  if (!uc) return field;
  if (field === 'テスト結果') return '結果';
  if (field === 'ケース番号') return 'course_id';
  return field;
}

// 検証項目の見出しは丸数字だけにする (表の列幅を抑えるため。全文は title に出す)
export function ucCheckShort(field: string): string {
  return field.slice(0, 1);
}
