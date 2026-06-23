// 月次報告書（実績報告レポート）の自己完結 HTML を生成する。
// 別ウィンドウで開いて印刷／PDF 保存する前提。図表はインライン SVG。

export type ReportItem = {
  id: string;
  system: string;
  cmdb: string;
  content: string;
  testType: string;
  testCount: string;
  validNg: string;
  japanNgCount: string;
  expectedCase: string;
  expectedNg: string;
  planEffort: string;
  actualEffort: string;
  idealCaseDiff: string;
  idealNgDiff: string;
  execTestCount: string;
  efficiency: string;
  comments: string[];
};

export type ReportMeta = {
  year: number;
  month: number;
  monthKey: string; // YYYYMM
  systems: string[];
};

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value: string): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function hasNum(value: string): boolean {
  return String(value ?? '').trim() !== '' && Number.isFinite(Number(String(value).replace(/[^\d.-]/g, '')));
}

function fmt(value: string, digits = 2): string {
  if (!hasNum(value)) return '-';
  return num(value).toFixed(digits);
}

function caseName(item: ReportItem): string {
  return [item.cmdb, item.content].filter(Boolean).join(' / ') || '-';
}

/** レポートタイトルの末尾ラベル（_Jmotto / _Univ / それ以外はシステム名連結） */
export function systemLabel(systems: string[]): string {
  const jmotto = new Set(['J-MOTTOポータル', 'J-MOTTOアプリ']);
  const univ = new Set(['Univ2', 'Univコンテンツ', 'Univアプリ']);
  if (systems.length > 0 && systems.every((s) => jmotto.has(s))) return 'Jmotto';
  if (systems.length > 0 && systems.every((s) => univ.has(s))) return 'Univ';
  return systems.join('・') || 'TestCenter';
}

/** レポートタイトル（表紙・履歴・印刷ウィンドウで共有） */
export function monthlyReportTitle(systems: string[], monthKey: string): string {
  return `TestCenter実績報告レポート_${systemLabel(systems)}${monthKey}`;
}

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 縦棒グラフ（インライン SVG）。NG バーは赤、通常は青。細身・上品。 */
function barChart(
  rows: { label: string; value: number; ng: boolean }[],
  opt: { width?: number; height?: number } = {}
): string {
  if (rows.length === 0) return '<p class="muted">データなし</p>';
  const width = opt.width ?? 560;
  const height = opt.height ?? 150;
  const padL = 30;
  const padR = 10;
  const padT = 16;
  const padB = 42;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const min = Math.min(0, ...rows.map((r) => r.value));
  const range = max - Math.min(0, min) || 1;
  const zeroY = padT + innerH * (max / range);
  const slot = innerW / rows.length;
  const bw = Math.min(18, slot * 0.4);

  const bars = rows
    .map((r, i) => {
      const cx = padL + i * slot + slot / 2;
      const h = (Math.abs(r.value) / range) * innerH;
      const y = r.value >= 0 ? zeroY - h : zeroY;
      const color = r.ng ? '#dc2626' : '#3b82f6';
      const label = esc(r.label.length > 9 ? `${r.label.slice(0, 9)}…` : r.label);
      const labelY = r.value >= 0 ? y - 3 : y + h + 9;
      return `
        <rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${color}" rx="2" />
        <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="7.5" text-anchor="middle" fill="#475569">${r.value.toFixed(1)}</text>
        <text x="${cx.toFixed(1)}" y="${(height - padB + 11).toFixed(1)}" font-size="7.5" text-anchor="end" fill="#94a3b8" transform="rotate(-40 ${cx.toFixed(1)} ${(height - padB + 11).toFixed(1)})">${label}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${width - padR}" y2="${zeroY.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" />
    ${bars}
  </svg>`;
}

type Dimension = {
  key: string;
  anchor: string;
  title: string;
  desc: string;
  metricLabel: string;
  metricOf: (it: ReportItem) => string;
  isNg: (it: ReportItem) => boolean;
  columns: { label: string; of: (it: ReportItem) => string; num?: boolean }[];
};

function buildDimensions(): Dimension[] {
  return [
    {
      key: 'bug-leak',
      anchor: 'sec-bug-leak',
      title: 'バグ流出率について',
      desc: '理想NG差が 1 を超える案件はバグ流出リスクが高いため強調表示しています。',
      metricLabel: '理想NG差',
      metricOf: (it) => it.idealNgDiff,
      isNg: (it) => hasNum(it.idealNgDiff) && num(it.idealNgDiff) > 1,
      columns: [
        { label: '想定NG数', of: (it) => fmt(it.expectedNg) },
        { label: '有効NG数', of: (it) => fmt(it.validNg), num: true },
        { label: '日本実施テストNG件数', of: (it) => fmt(it.japanNgCount, 0), num: true },
        { label: '理想NG差', of: (it) => fmt(it.idealNgDiff), num: true },
      ],
    },
    {
      key: 'efficiency',
      anchor: 'sec-efficiency',
      title: 'テスト効率について',
      desc: 'テスト効率（テストケース数/1人日）が 20 を下回る案件を強調表示しています。',
      metricLabel: '効率',
      metricOf: (it) => it.efficiency,
      isNg: (it) => hasNum(it.efficiency) && num(it.efficiency) < 20,
      columns: [
        { label: '予定工数', of: (it) => fmt(it.planEffort), num: true },
        { label: '実績工数', of: (it) => fmt(it.actualEffort), num: true },
        { label: 'テスト件数', of: (it) => fmt(it.testCount, 0), num: true },
        { label: '効率', of: (it) => fmt(it.efficiency), num: true },
      ],
    },
    {
      key: 'count-diff',
      anchor: 'sec-count-diff',
      title: 'テスト件数の実績が想定件数との差異について',
      desc: '想定ケース数（修正ステップ数から自動推定）と TCテスト件数 の差が 0 を下回る（実績が想定を下回る）案件を強調表示しています。',
      metricLabel: '実施テスト件数差',
      metricOf: (it) => it.execTestCount,
      isNg: (it) => hasNum(it.execTestCount) && num(it.execTestCount) < 0,
      columns: [
        { label: '想定ケース数', of: (it) => fmt(it.expectedCase) },
        { label: 'TCテスト件数', of: (it) => fmt(it.testCount, 0), num: true },
        { label: '差異', of: (it) => fmt(it.execTestCount), num: true },
      ],
    },
    {
      key: 'ideal-case',
      anchor: 'sec-ideal-case',
      title: '理想ケース差について',
      desc: '理想ケース差が 10 を超える案件を強調表示しています。',
      metricLabel: '理想ケース差',
      metricOf: (it) => it.idealCaseDiff,
      isNg: (it) => hasNum(it.idealCaseDiff) && num(it.idealCaseDiff) > 10,
      columns: [
        { label: '想定ケース数', of: (it) => fmt(it.expectedCase) },
        { label: '実施件数', of: (it) => fmt(it.testCount, 0), num: true },
        { label: '理想ケース差', of: (it) => fmt(it.idealCaseDiff), num: true },
      ],
    },
  ];
}

function dimensionSection(dim: Dimension, items: ReportItem[]): string {
  const chart = barChart(
    items.map((it) => ({
      label: it.cmdb || it.content || '-',
      value: hasNum(dim.metricOf(it)) ? num(dim.metricOf(it)) : 0,
      ng: dim.isNg(it),
    })),
    {}
  );

  const headCols = dim.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');

  const rows = items
    .map((it) => {
      const ng = dim.isNg(it);
      const cells = dim.columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.of(it)}</td>`).join('');
      const reason = ng ? (it.comments.length ? esc(it.comments.join('\n')) : '') : '';
      return `
      <tr class="${ng ? 'ng-row' : ''}">
        <td>${esc(caseName(it))}</td>
        <td>${esc(it.testType || '-')}</td>
        ${cells}
        <td class="reason" contenteditable="true">${reason}</td>
      </tr>`;
    })
    .join('');

  const ngCount = items.filter((it) => dim.isNg(it)).length;

  return `
  <section class="report-section" id="${dim.anchor}">
    <h3>${esc(dim.title)}</h3>
    <p class="desc">${esc(dim.desc)}　<span class="ng-count">NG該当: ${ngCount}件</span></p>
    <div class="chart-wrap">${chart}</div>
    <table class="data-table">
      <thead>
        <tr><th>案件名</th><th>テスト種類</th>${headCols}<th class="reason-h">原因説明 / コメント（編集可）</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="${dim.columns.length + 3}" class="muted">データなし</td></tr>`}</tbody>
    </table>
  </section>`;
}

export function buildMonthlyReportHtml(items: ReportItem[], meta: ReportMeta): string {
  const title = monthlyReportTitle(meta.systems, meta.monthKey);
  const createdAt = formatNow();

  // ── 全体概要の集計 ──
  const caseCount = items.length;
  const sumTest = items.reduce((s, it) => s + num(it.testCount), 0);
  const sumValidNg = items.reduce((s, it) => s + num(it.validNg), 0);
  const sumPlan = items.reduce((s, it) => s + num(it.planEffort), 0);
  const sumActual = items.reduce((s, it) => s + num(it.actualEffort), 0);
  const effItems = items.filter((it) => hasNum(it.efficiency));
  const avgEff = effItems.length ? effItems.reduce((s, it) => s + num(it.efficiency), 0) / effItems.length : 0;

  const dims = buildDimensions();
  const ngSummary = dims.map((d) => ({ title: d.title, count: items.filter((it) => d.isNg(it)).length }));

  const overviewCards = [
    { label: '案件数', value: String(caseCount) },
    { label: 'テスト総件数', value: String(sumTest) },
    { label: '有効NG総数', value: String(sumValidNg) },
    { label: '予定工数合計', value: parseFloat(sumPlan.toFixed(2)).toString() },
    { label: '実績工数合計', value: parseFloat(sumActual.toFixed(2)).toString() },
    { label: '平均効率', value: parseFloat(avgEff.toFixed(2)).toString() },
  ]
    .map((c) => `<div class="kpi"><span class="kpi-label">${esc(c.label)}</span><span class="kpi-value">${esc(c.value)}</span></div>`)
    .join('');

  const ngSummaryRows = ngSummary
    .map((s) => `<tr><td>${esc(s.title)}</td><td class="num ${s.count > 0 ? 'ng-text' : ''}">${s.count}</td></tr>`)
    .join('');

  const detailSections = dims.map((d) => dimensionSection(d, items)).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Yu Gothic","Meiryo",system-ui,sans-serif; color:#1f2937; margin:0; }
  .page { padding: 24mm 18mm; }
  .muted { color:#9ca3af; }
  .num { text-align:right; }
  /* 表紙 */
  .cover { min-height: 100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
  .cover .brand { color:#2563eb; font-weight:700; letter-spacing:2px; font-size:14px; }
  .cover h1 { font-size:30px; margin:20px 0 8px; line-height:1.4; }
  .cover .sub { color:#6b7280; font-size:14px; margin-top:24px; }
  .cover .line { width:80px; height:4px; background:#2563eb; margin:24px auto; border-radius:2px; }
  /* 目次（計画資料スタイル） */
  .toc-title { font-size:24px; font-weight:700; text-align:center; margin:0 0 28px; }
  .toc-list { list-style:none; padding:0; margin:0 auto; max-width:640px; }
  .toc-list > li { padding:12px 4px 12px 8px; border-bottom:1px dotted #cbd5e1; font-size:16px; line-height:1.5; }
  .toc-list > li:last-child { border-bottom:none; }
  .toc-list ol { list-style:none; padding:8px 0 2px 18px; margin:0; }
  .toc-list ol li { font-size:13px; color:#4b5563; padding:4px 0; border:none; }
  .toc-list a { color:#2563eb; text-decoration:none; }
  .toc-list a:hover { text-decoration:underline; }
  /* セクション */
  h2.sec-title { font-size:20px; color:#1e3a8a; border-bottom:2px solid #2563eb; padding-bottom:6px; margin-top:0; }
  .report-section { margin-top:28px; }
  .report-section h3 { font-size:16px; color:#1e3a8a; margin-bottom:4px; }
  .desc { color:#6b7280; font-size:12px; margin:2px 0 10px; }
  .ng-count { color:#dc2626; font-weight:600; }
  .ng-text { color:#dc2626; font-weight:700; }
  .kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
  .kpi { border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
  .kpi-label { font-size:11px; color:#6b7280; }
  .kpi-value { font-size:22px; font-weight:700; color:#111827; }
  .chart-wrap { margin:8px 0 12px; text-align:center; }
  .chart { display:block; margin:0 auto; width:100%; max-width:560px; height:auto; background:#fff; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
  th,td { border:1px solid #d1d5db; padding:5px 7px; text-align:left; vertical-align:top; }
  th { background:#f1f5f9; font-weight:600; }
  .data-table .reason-h { width:26%; }
  .data-table td.reason { background:#fffdf5; min-width:160px; white-space:pre-wrap; }
  tr.ng-row td { background:#fef2f2; }
  tr.ng-row td:first-child { box-shadow: inset 3px 0 0 #dc2626; }
  .incident-box { border:1px dashed #cbd5e1; border-radius:10px; background:#fafafa; min-height:140px; padding:14px; font-size:13px; white-space:pre-wrap; }
  @media print {
    .page { padding: 14mm; }
    .cover { min-height: auto; height: 247mm; }
    .page-break { page-break-before: always; }
    tr, .report-section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <!-- 表紙 -->
  <div class="page cover">
    <div class="brand">TEST CENTER</div>
    <h1>${esc(title)}</h1>
    <div class="line"></div>
    <div class="sub">
      対象: ${meta.year}年${meta.month}月 / ${esc(meta.systems.join('、'))}<br>
      対象案件数: ${caseCount} 件<br>
      作成日時: ${esc(createdAt)}
    </div>
  </div>

  <!-- 目次 -->
  <div class="page page-break toc-page">
    <h2 class="toc-title">目次</h2>
    <ol class="toc-list">
      <li><a href="#sec-overview">全体概要</a></li>
      <li><a href="#sec-incident">インシデント対応</a></li>
      <li><a href="#sec-detail">詳細分析</a>
        <ol>
          <li><a href="#sec-bug-leak">バグ流出率について</a></li>
          <li><a href="#sec-efficiency">テスト効率について</a></li>
          <li><a href="#sec-count-diff">テスト件数の実績が想定件数との差異について</a></li>
          <li><a href="#sec-ideal-case">理想ケース差について</a></li>
        </ol>
      </li>
    </ol>
  </div>

  <!-- 全体概要 -->
  <div class="page page-break" id="sec-overview">
    <h2 class="sec-title">1. 全体概要</h2>
    <div class="kpis">${overviewCards}</div>
    <h3>観点別 NG該当件数</h3>
    <table>
      <thead><tr><th>分析観点</th><th class="num">NG該当件数</th></tr></thead>
      <tbody>${ngSummaryRows}</tbody>
    </table>
  </div>

  <!-- インシデント対応 -->
  <div class="page page-break" id="sec-incident">
    <h2 class="sec-title">2. インシデント対応</h2>
    <p class="desc">本月のインシデント内容・対応状況を記入してください（編集可）。</p>
    <div class="incident-box" contenteditable="true">ここにインシデント対応の内容を入力してください。</div>
  </div>

  <!-- 詳細分析 -->
  <div class="page page-break" id="sec-detail">
    <h2 class="sec-title">3. 詳細分析</h2>
    ${detailSections}
  </div>
</body>
</html>`;
}
