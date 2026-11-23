// TestCase 系画面 (TestCase / TestCase Library / 案件のテストケース詳細) で共通に使う見た目の定義。
// 枠線・角丸・無効時・フォーカスの書き方が画面ごとにずれないよう、ここにまとめる。
//
// 規約:
//  - 枠 (ダイアログ・カード・表): rounded-xl / border-neutral-200
//  - 入力欄・ボタン: rounded-lg / border-neutral-300
//  - 無効時: opacity-50 + cursor-not-allowed
//  - フォーカス: キーボード操作時だけ ring を出す (focus-visible)
//  - 文字は 12px (text-xs) 未満にしない

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1';
const disabled = 'disabled:opacity-50 disabled:cursor-not-allowed';

export const ui = {
  focusRing,

  // 入力欄 (input / select / textarea)。幅は呼び出し側で足す
  input: `rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-500 ${focusRing} ${disabled}`,
  // 入力欄の見出し
  label: 'block text-xs font-semibold text-neutral-500',

  // ボタン
  btnPrimary: `inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 whitespace-nowrap transition-colors ${focusRing} ${disabled}`,
  btnSecondary: `inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 whitespace-nowrap transition-colors ${focusRing} ${disabled}`,
  btnDanger: `inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 whitespace-nowrap transition-colors ${focusRing} ${disabled}`,
  // アイコンだけのボタン (枠あり)
  btnIcon: `inline-flex items-center justify-center p-2 rounded-lg border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 transition-colors ${focusRing} ${disabled}`,
  // 文字だけの軽いボタン (条件クリア 等)
  btnText: `text-xs text-neutral-500 hover:text-neutral-800 rounded ${focusRing} ${disabled}`,

  // 枠 (カード・表の外枠)
  card: 'bg-white border border-neutral-200 rounded-xl',

  // ダイアログ
  dialogOverlay: 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4',
  dialogPanel: 'w-full max-h-[90vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col',
  dialogHeader: 'px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0',
  dialogTitle: 'text-lg font-bold text-neutral-900 truncate',
  dialogBody: 'p-5 overflow-auto',
  dialogClose: `p-1 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 transition-colors ${focusRing} ${disabled}`,
  // 詳細ダイアログ左右の前後送り
  dialogNav: `shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white transition-colors ${focusRing} disabled:opacity-30 disabled:cursor-not-allowed`,

  // メッセージ
  errorBox: 'bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-center gap-2',
} as const;
