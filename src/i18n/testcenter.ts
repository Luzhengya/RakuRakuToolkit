// 日本語のみ (以前は zh/ja 切替だったが日本語固定に変更)
export type Lang = 'ja';

const dict = {
  // ── 通用 ──────────────────────────────────
  home: 'ホーム',
  close: '閉じる',
  update: '更新',
  noData: 'データなし',
  inputPlaceholder: '入力してください',
  lastUpdated: '最終更新',
  loadingNotion: 'Notionデータを読み込み中...',
  loadingOverview: '概要データを読み込み中...',
  noMatchingData: '条件に一致するデータがありません。',
  popupBlocked: 'ポップアップがブロックされました。許可してから再試行してください。',
  // ── 页面标题 ──────────────────────────────
  pageTitle: 'TestCenter管理画面',
  caseDetail: '案件詳細',
  pageSubtitle: 'エリアを選択してテスト管理モジュールに入ってください。',
  progressList: '進捗リスト',
  // ── 面包屑 / 区域 ──────────────────────────
  areaEriaSuffix: 'エリア',
  // ── KPI ───────────────────────────────────
  kpiCaseCount: '案件数',
  kpiBugTotal: 'BUG総数',
  kpiSystemClass: 'システム分類',
  kpiSystemSuffix: '類',
  // ── 仪表盘卡片 ────────────────────────────
  chartMonthlyBug: '月別 BUG 推移',
  chartSystemDist: 'システム分類別 案件数',
  chartStatus: '案件ステータス',
  // ── 月次报告入口 ──────────────────────────
  monthlyReportTitle: '月次報告',
  monthlyReportDesc: '月・システムを指定してテスト実績を検索し、月次報告書を作成します。',
  monthlyReportEnter: '検索画面へ',
  bugListEnter: 'BUG一覧へ →',
  // ── 区域卡片 ──────────────────────────────
  caseLabel: '案件',
  bugLabel: 'BUG',
  // ── 筛选器 ────────────────────────────────
  filterAllMonth: '全月',
  // ── 列表 ──────────────────────────────────
  caseCount: '件数：',
  resultReady: 'テスト結果完成',
  // ── 字段标签 ──────────────────────────────
  fieldMonth: '月次',
  fieldCaseName: '案件名',
  fieldStatus: '状態',
  fieldEstTotal: '見積総',
  fieldActTotal: '実績総',
  fieldTestTotal: 'Test総件数',
  fieldNgCount: 'NG数',
  fieldTestBlocked: 'Test不可',
  fieldPendingCount: '判断不可/想定外件数',
  // ── 按钮 ──────────────────────────────────
  btnSaveToNotion: 'Notionに保存',
  btnPlanDoc: '計画資料',
  btnResultReport: '結果報告',
  btnResultReportWithBug: '結果報告(BUG付き)',
  btnSavePdf: 'PDFとして保存',
  btnSaveReportPdf: 'PDFとして保存（結果報告）',
  btnSaveReportHtml: 'HTMLダウンロード',
  btnHistory: '履歴',
  btnPreview: 'プレビュー',
  btnReSavePdf: 'PDFを再保存',
  btnBack: '戻る',
  btnAllAreas: '全エリアを表示',
  btnAllAreasActive: '全エリア表示中',
  // ── 状态/通知 ─────────────────────────────
  saving: '保存中...',
  savedToNotion: 'Notionに保存しました',
  saveToNotionFailed: 'Notionへの保存に失敗しました',
  fetchFailed: 'TestCenterデータの取得に失敗しました',
  requestFailed: 'リクエスト失敗',
  overviewFetchFailed: '概要データの読み込みに失敗しました',
  templateReadFailed: 'テンプレートの読み込みに失敗しました',
  planGenerateFailed: '計画資料の生成に失敗しました',
  planSelectRequired: '少なくとも1件選択してから計画資料を作成してください。',
  reportTemplateReadFailed: '報告テンプレートの読み込みに失敗しました',
  reportGenerateFailed: '結果報告の生成に失敗しました',
  historyTooLarge: 'レポートのサイズが大きすぎ（画像が多い）て履歴の保存に失敗しました。PDF / HTML の保存は可能です。',
  reportSelectRequired: '少なくとも1件選択してから結果報告を作成してください。',
  // ── 履歴モーダル ───────────────────────────
  historyTitle: 'HTML保存履歴',
  historyEmpty: 'まだ履歴がありません。PDFを保存すると自動的に記録されます。',
  historyAreaEmpty: 'このエリアの履歴はありません。',
  historyTypePlan: '計画',
  historyTypeReport: '報告',
  historyLoading: '履歴を読み込み中...',
  historyLoadError: '履歴の読み込みに失敗しました',
  migrateLocal: 'ローカル履歴を移行',
  migrating: '移行中...',
  migrateNothingToDo: '移行できるローカル履歴はありません。',
  migrateSuccess: '移行が完了しました。ローカル履歴をクラウドに保存しました。',
  migrateFailed: '移行に失敗しました。後でもう一度お試しください。',
  // ── 结果报告预览 ───────────────────────────
  planRef: '計画資料（参考）',
  reportEdit: '結果報告',
  reportEditHint: '← 編集・印刷対象',
  noPlanHistory: '計画資料の履歴がありません',
  noPlanHistoryHint: '先に計画資料を作成・PDF保存してください',
  // ── 区域描述 ──────────────────────────────
  descJmotto: 'jmotto関連テスト項目の統一管理。',
  descUniv: 'UNIV関連テスト項目の統一管理。',
  descCredit: '企業信用情報関連テスト項目の統一管理。',
  descOverseas: '海外調書関連テスト項目の統一管理。',
  descJmottoApp: 'jmottoアプリ関連のテスト項目を統一管理する。',
  descUnivApp: 'Univアプリ関連のテスト項目を統一管理する。',
  descUnivContents: 'UnivContents関連のテスト項目を統一管理する。',
  descNayose: '名寄せアプリ関連のテスト項目を統一管理する。',
  descGyoshu: '業種別審査ノート関連のテスト項目を統一管理する。',
  descRos: '与信ROS関連のテスト項目を統一管理する。',
  descMeikancho: '名館長クラウド関連のテスト項目を統一管理する。',
  // ── 区域标题 ──────────────────────────────
  titleJmotto: 'jmottoエリア',
  titleUniv: 'UNIVエリア',
  titleCredit: '企業信用情報エリア',
  titleOverseas: '海外調書エリア',
  titleJmottoApp: 'jmottoアプリエリア',
  titleUnivApp: 'Univアプリエリア',
  titleUnivContents: 'UnivContentsエリア',
  titleNayose: '名寄せアプリエリア',
  titleGyoshu: '業種別エリア',
  titleRos: '与信ROSエリア',
  titleMeikancho: '名館長クラウドエリア',
} as const;

export type DictKey = keyof typeof dict;

// 互換のため createT を残すが、常に日本語辞書を返す
export function createT(_lang?: Lang) {
  return (key: DictKey): string => dict[key];
}
