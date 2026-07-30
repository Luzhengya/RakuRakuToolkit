// 案件統計 報告書テンプレート。
// 前半(表紙/目次/全体概要/インシデント)は月次報告書と同一の体裁、
// 詳細分析は case-stats の 効率 / 品質 をシステム別に展開する。

export type EffAgg = { agg: number | null; counts: { high: number; mid: number; low: number } };

export type ReportCaseRow = {
  projectName: string;
  status: string;
  assignee: string;
  manager: string;
  estimate: number;
  actual: number;
  diff: number;
  designA: number;
  implA: number;
  execA: number;
  reviewA: number;
  designEff: number | null;
  execEff: number | null;
  reviewEff: number | null;
  testTotal: number;
  ng: number;
  ngRate: number | null;
  japanTest: number;
  hasJapanTest: boolean;
  japanNg: number;
  hasJapanNg: boolean;
  expectedCase: number;
  hasExpectedCase: boolean;
  caseDiff: number;
  expectedNg: number;
  sensen: number;
  hasExpectedNg: boolean;
  ngLeakRate: number | null;
  comment: string;
};

export type ReportSystemGroup = {
  system: string;
  count: number;
  totalEff: number | null;
  testSum: number;
  ngSum: number;
  ngRate: number | null;
  ngLeakRate: number | null;
  effStats: { total: EffAgg; design: EffAgg; exec: EffAgg; review: EffAgg };
  qualStats: {
    testSum: number;
    ngSum: number;
    ngRate: number | null;
    ngLeakRate: number | null;
    ngLeakCounts: { high: number; mid: number; low: number };
    caseDiffCounts: { high: number; mid: number; low: number };
    sensenCounts: { high: number; mid: number; low: number };
  };
  lowCases: { name: string; status: string; labels: string[] }[];
  attnCases: { name: string; status: string; labels: string[] }[];
  rows: ReportCaseRow[];
};

export type ConfirmCase = { name: string; system: string; labels: string[]; comment: string };

export type CaseStatsReportMeta = {
  monthKey: string;   // 月次=YYYYMM / 年度=YYYY
  periodType: 'month' | 'year';
  systems: string[];
  thresholds: {
    total: { high: number; mid: number };
    design: { high: number; mid: number };
    exec: { high: number; mid: number };
    review: { high: number; mid: number };
    ngLeak: { high: number; mid: number };
    caseDiff: { high: number; mid: number };
    sensen: { high: number; mid: number };
  };
  // 要確認案件 (効率・品質の確認要を案件単位で統合)
  confirmCases: ConfirmCase[];
  // 本月全体概要の統計パネル値
  overall: {
    caseCount: number;
    estimateSum: number;
    actualSum: number;
    diff: number;
    testSum: number;
    ngSum: number;
    ngRate: number | null;
    totalEff: number | null;
    attention: number;
  };
};

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}
function fmtEff(v: number | null): string {
  return v === null ? '-' : fmt(v);
}
function fmtPct(v: number | null): string {
  return v === null ? '-' : `${fmt(v)}%`;
}
function bandCls(v: number | null, t: { high: number; mid: number }): string {
  if (v === null) return 'muted';
  if (v >= t.high) return 'good';
  if (v >= t.mid) return '';
  return 'ng-text';
}

export function caseStatsReportTitle(systems: string[], periodKey: string, periodType: 'month' | 'year' = 'month'): string {
  const sys = systems.join('・');
  const period = periodType === 'year' ? `${periodKey}年度` : periodKey;
  return `TestCenter実績報告レポート_${sys}_${period}`;
}

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 効率サマリカード
function effCard(label: string, s: EffAgg): string {
  return `<div class="scard">
    <div class="scard-h"><span>${esc(label)}</span><b>${fmtEff(s.agg)}</b></div>
    <div class="scard-b"><span class="${s.counts.low > 0 ? 'ng-text' : 'muted'}">効率低 ${s.counts.low}</span><span>効率中 ${s.counts.mid}</span><span class="good">効率高 ${s.counts.high}</span></div>
  </div>`;
}

function attnList(title: string, cases: { name: string; status: string; labels: string[] }[]): string {
  if (cases.length === 0) return '';
  const items = cases
    .map(
      (c) =>
        `<li><span>${esc(c.name)}</span><span><b class="${c.status === '確認要' ? 'ng-text' : 'caution'}">${esc(c.status)}</b> <span class="muted">${esc(c.labels.join(' / '))}</span></span></li>`
    )
    .join('');
  return `<div class="attn"><p class="attn-h">${esc(title)} ${cases.length}件</p><ul>${items}</ul></div>`;
}

function effSection(g: ReportSystemGroup, th: CaseStatsReportMeta['thresholds']): string {
  const cards =
    effCard('総効率', g.effStats.total) +
    effCard('設計効率', g.effStats.design) +
    effCard('実施効率', g.effStats.exec) +
    effCard('レビュー効率', g.effStats.review);
  const rows = g.rows
    .map(
      (r) => `<tr>
      <td>${esc(r.projectName)}</td>
      <td>${esc(r.status)}</td>
      <td class="num">${fmt(r.estimate)}</td>
      <td class="num">${fmt(r.designA)}</td>
      <td class="num">${fmt(r.implA)}</td>
      <td class="num">${fmt(r.execA)}</td>
      <td class="num">${fmt(r.reviewA)}</td>
      <td class="num">${fmt(r.actual)}</td>
      <td class="num${r.diff > 0 ? ' ng-text' : ''}">${(r.diff > 0 ? '+' : '') + fmt(r.diff)}</td>
      <td class="num ${bandCls(r.designEff, th.design)}">${fmtEff(r.designEff)}</td>
      <td class="num ${bandCls(r.execEff, th.exec)}">${fmtEff(r.execEff)}</td>
      <td class="num ${bandCls(r.reviewEff, th.review)}">${fmtEff(r.reviewEff)}</td>
      <td class="cmt" contenteditable="true">${esc(r.comment)}</td>
      <td>${esc(r.assignee)}</td>
      <td>${esc(r.manager)}</td>
    </tr>`
    )
    .join('');
  return `<div class="sys-block">
    <h4>${esc(g.system)} <span class="muted">総効率 ${fmtEff(g.totalEff)} / 案件 ${g.count}</span></h4>
    <div class="scards">${cards}</div>
    ${attnList('確認要・注意', g.lowCases)}
    <table class="data-table">
      <thead><tr>
        <th>案件名</th><th>状態</th><th class="num">見積</th>
        <th class="num">実績(設計)</th><th class="num">実績(実装)</th><th class="num">実績(実施)</th><th class="num">実績(review)</th>
        <th class="num">実績総</th><th class="num">差分</th>
        <th class="num">設計効率</th><th class="num">実施効率</th><th class="num">レビュー効率</th>
        <th>備考</th><th>担当者</th><th>管理者</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function qualSection(g: ReportSystemGroup, th: CaseStatsReportMeta['thresholds']): string {
  const qs = g.qualStats;
  const qcard = (label: string, aggText: string, c: { high: number; mid: number; low: number }) =>
    `<div class="scard">
      <div class="scard-h"><span>${esc(label)}</span><b>${aggText}</b></div>
      <div class="scard-b">
        <span class="${c.high > 0 ? 'ng-text' : 'muted'}">品質低 ${c.high}</span><span>品質中 ${c.mid}</span><span class="good">品質高 ${c.low}</span>
      </div>
    </div>`;
  const summary = `<div class="scards q">
    <div class="scard">
      <div class="scard-h"><span>NG率(総)</span><b>${fmtPct(qs.ngRate)}</b></div>
      <div class="scard-b"><span class="muted">総テスト ${fmt(qs.testSum)} / NG ${fmt(qs.ngSum)}</span></div>
    </div>
    ${qcard('NG流出率', fmtPct(qs.ngLeakRate), qs.ngLeakCounts)}
    ${qcard('想定ケース差', '', qs.caseDiffCounts)}
    ${qcard('潜在見逃し', '', qs.sensenCounts)}
  </div>`;
  const rows = g.rows
    .map(
      (r) => `<tr>
      <td>${esc(r.projectName)}</td>
      <td>${esc(r.status)}</td>
      <td class="num">${fmt(r.testTotal)}</td>
      <td class="num">${fmt(r.ng)}</td>
      <td class="num">${r.hasJapanTest ? fmt(r.japanTest) : '-'}</td>
      <td class="num">${r.hasJapanNg ? fmt(r.japanNg) : '-'}</td>
      <td class="num${r.hasExpectedCase && r.caseDiff >= th.caseDiff.high ? ' ng-cell' : ''}">${r.hasExpectedCase ? fmt(r.expectedCase) : '-'}</td>
      <td class="num">${r.hasExpectedNg ? fmt(r.expectedNg) : '-'}</td>
      <td class="num">${fmtPct(r.ngRate)}</td>
      <td class="num${r.ngLeakRate !== null && r.ngLeakRate >= th.ngLeak.high ? ' ng-cell' : ''}">${fmtPct(r.ngLeakRate)}</td>
      <td class="num${r.hasExpectedNg && r.sensen >= th.sensen.high ? ' ng-cell' : ''}">${r.hasExpectedNg ? fmt(r.sensen) : '-'}</td>
      <td class="cmt" contenteditable="true">${esc(r.comment)}</td>
      <td>${esc(r.assignee)}</td>
      <td>${esc(r.manager)}</td>
    </tr>`
    )
    .join('');
  return `<div class="sys-block">
    <h4>${esc(g.system)} <span class="muted">NG率 ${fmtPct(g.ngRate)} / 案件 ${g.count}</span></h4>
    ${summary}
    ${attnList('確認要・注意', g.attnCases)}
    <table class="data-table">
      <thead><tr>
        <th>案件名</th><th>状態</th><th class="num">テスト数</th><th class="num">NG</th>
        <th class="num">日本テスト件数</th><th class="num">日本NG件数</th><th class="num">想定ケース</th><th class="num">想定NG数</th>
        <th class="num">NG率</th><th class="num">NG流出率</th><th class="num">潜在見逃し</th>
        <th>備考</th><th>担当者</th><th>管理者</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function buildCaseStatsReportHtml(groups: ReportSystemGroup[], meta: CaseStatsReportMeta): string {
  const isYear = meta.periodType === 'year';
  const title = caseStatsReportTitle(meta.systems, meta.monthKey, meta.periodType);
  const createdAt = formatNow();
  const y = meta.monthKey.slice(0, 4);
  const m = meta.monthKey.slice(4, 6);
  const periodLabel = isYear ? `${y}年度` : `${y}年${Number(m)}月`;
  const overviewTitle = isYear ? '本年度全体概要' : '本月全体概要';
  const o = meta.overall;
  const caseTotal = o.caseCount;

  // 要確認案件サマリー (原因・コメント理由付き)
  const confirmRows = meta.confirmCases
    .map(
      (c) => `<tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.system)}</td>
      <td class="ng-text">${esc(c.labels.join(' / '))}</td>
      <td class="cmt" contenteditable="true">${esc(c.comment)}</td>
    </tr>`
    )
    .join('');
  const confirmTable = meta.confirmCases.length
    ? `<table class="data-table">
      <thead><tr><th>案件名</th><th>システム</th><th>問題原因</th><th>理由(コメント)</th></tr></thead>
      <tbody>${confirmRows}</tbody>
    </table>`
    : '<p class="muted" style="font-size:12px;">要確認案件はありません。</p>';

  // 本月全体概要 KPIパネル
  const kpiCards = [
    { label: '要確認件数', value: fmt(o.attention), tone: o.attention > 0 ? 'alert' : 'ok' },
    { label: '工数差分(総)', value: (o.diff > 0 ? '+' : '') + fmt(o.diff), tone: o.diff > 0 ? 'alert' : 'ok' },
    { label: 'NG率(総)', value: fmtPct(o.ngRate), tone: 'neutral' },
    { label: '案件数(総)', value: fmt(o.caseCount), tone: 'neutral' },
    { label: '見積工数(総)', value: fmt(o.estimateSum), tone: 'neutral' },
    { label: '実績工数(総)', value: fmt(o.actualSum), tone: 'neutral' },
    { label: '用例件数(総)', value: fmt(o.testSum), tone: 'neutral' },
    { label: 'NG件数(総)', value: fmt(o.ngSum), tone: 'neutral' },
    { label: '効率(総)', value: fmtEff(o.totalEff), tone: 'neutral' },
  ]
    .map(
      (c) =>
        `<div class="kpi ${c.tone}"><span class="kpi-label">${esc(c.label)}</span><span class="kpi-value">${esc(c.value)}</span></div>`
    )
    .join('');

  const effSections = groups.map((g) => effSection(g, meta.thresholds)).join('');
  const qualSections = groups.map((g) => qualSection(g, meta.thresholds)).join('');

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
  .good { color:#15803d; }
  .ng-text { color:#dc2626; font-weight:700; }
  .caution { color:#b45309; font-weight:700; }
  .kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:12px 0; }
  .kpi { border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
  .kpi.alert { background:#fef2f2; border-color:#fecaca; }
  .kpi.ok { background:#ecfdf5; border-color:#a7f3d0; }
  .kpi-label { font-size:11px; color:#6b7280; font-weight:600; }
  .kpi-value { font-size:22px; font-weight:700; color:#111827; }
  .cover { min-height: 100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
  .cover .brand { color:#2563eb; font-weight:700; letter-spacing:2px; font-size:14px; }
  .cover h1 { font-size:30px; margin:20px 0 8px; line-height:1.4; }
  .cover .sub { color:#6b7280; font-size:14px; margin-top:24px; }
  .cover .line { width:80px; height:4px; background:#2563eb; margin:24px auto; border-radius:2px; }
  .toc-title { font-size:24px; font-weight:700; text-align:center; margin:0 0 28px; }
  .toc-list { list-style:none; padding:0; margin:0 auto; max-width:640px; }
  .toc-list > li { padding:12px 4px 12px 8px; border-bottom:1px dotted #cbd5e1; font-size:16px; }
  .toc-list ol { list-style:none; padding:8px 0 2px 18px; margin:0; }
  .toc-list ol li { font-size:13px; color:#4b5563; padding:4px 0; border:none; }
  .toc-list a { color:#2563eb; text-decoration:none; }
  h2.sec-title { font-size:20px; color:#1e3a8a; border-bottom:2px solid #2563eb; padding-bottom:6px; margin-top:0; }
  h3.sub-title { font-size:16px; color:#1e3a8a; margin:22px 0 8px; }
  .sys-block { margin:14px 0 22px; }
  .sys-block h4 { font-size:14px; margin:0 0 8px; color:#111827; border-left:4px solid #2563eb; padding-left:8px; }
  .sys-block h4 .muted { font-weight:400; font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-top:6px; }
  th,td { border:1px solid #d1d5db; padding:4px 6px; text-align:left; vertical-align:top; }
  th { background:#f1f5f9; font-weight:600; }
  td.ng-cell { background:#fef2f2; color:#dc2626; font-weight:700; }
  td.cmt { background:#fffdf5; min-width:120px; }
  td.cmt:focus { outline:2px solid #93c5fd; background:#fff; }
  @media print { td.cmt { background:#fff; } }
  tr.total-row td { background:#eef2ff; font-weight:700; }
  .scards { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:8px 0; }
  .scards.q { grid-template-columns:repeat(4,1fr); }
  .scard { border:1px solid #e5e7eb; border-radius:8px; padding:8px 10px; font-size:11px; }
  .scard-h { display:flex; justify-content:space-between; align-items:baseline; font-weight:600; color:#374151; }
  .scard-h b { font-size:16px; color:#111827; }
  .scard-b { display:flex; gap:10px; margin-top:4px; font-size:10px; }
  .scard-lines { margin-top:4px; line-height:1.6; }
  .attn { border:1px solid #fecaca; background:#fef2f2; border-radius:8px; padding:8px 10px; margin:8px 0; }
  .attn-h { color:#b91c1c; font-weight:700; font-size:12px; margin:0 0 6px; }
  .attn ul { list-style:none; margin:0; padding:0; }
  .attn li { display:flex; justify-content:space-between; gap:12px; font-size:11px; padding:1px 0; }
  .incident-box { border:1px dashed #cbd5e1; border-radius:10px; background:#fafafa; min-height:140px; padding:14px; font-size:13px; white-space:pre-wrap; }
  .summary-box { border:1px dashed #cbd5e1; border-radius:10px; background:#fafafa; min-height:80px; padding:14px; font-size:13px; white-space:pre-wrap; margin-bottom:8px; }
  .summary-box:focus { outline:2px solid #93c5fd; background:#fff; }
  @media print {
    .page { padding: 14mm; }
    .cover { min-height: auto; height: 247mm; }
    .page-break { page-break-before: always; }
    tr, .sys-block, .scard { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="page cover">
    <div class="brand">TEST CENTER</div>
    <h1>${esc(title)}</h1>
    <div class="line"></div>
    <div class="sub">
      対象: ${periodLabel} / ${esc(meta.systems.join('、'))}<br>
      対象案件数: ${caseTotal} 件<br>
      作成日時: ${esc(createdAt)}
    </div>
  </div>

  <div class="page page-break">
    <h2 class="toc-title">目次</h2>
    <ol class="toc-list">
      <li><a href="#sec-overview">${esc(overviewTitle)}</a></li>
      <li><a href="#sec-incident">インシデント対応</a></li>
      <li><a href="#sec-detail">詳細分析</a>
        <ol>
          <li><a href="#sec-eff">効率</a></li>
          <li><a href="#sec-qual">品質</a></li>
        </ol>
      </li>
    </ol>
  </div>

  <div class="page page-break" id="sec-overview">
    <h2 class="sec-title">1. ${esc(overviewTitle)}</h2>
    <div class="kpis">${kpiCards}</div>
    <h3 class="sub-title">サマリー</h3>
    <div class="summary-box" contenteditable="true">ここに全体の総括を記入してください（編集可）。</div>
    <h3 class="sub-title">要確認案件 ${meta.confirmCases.length}件</h3>
    <p class="muted" style="font-size:12px;margin:0 0 6px;">効率・品質で「確認要」と判定された案件です。問題原因と理由(コメント)をご確認ください。</p>
    ${confirmTable}
  </div>

  <div class="page page-break" id="sec-incident">
    <h2 class="sec-title">2. インシデント対応</h2>
    <p class="muted" style="font-size:12px;">本月のインシデント内容・対応状況を記入してください（編集可）。</p>
    <div class="incident-box" contenteditable="true">ここにインシデント対応の内容を入力してください。</div>
  </div>

  <div class="page page-break" id="sec-detail">
    <h2 class="sec-title">3. 詳細分析</h2>
    <h3 class="sub-title" id="sec-eff">3.1 効率</h3>
    ${effSections || '<p class="muted">対象データがありません。</p>'}
    <h3 class="sub-title" id="sec-qual">3.2 品質</h3>
    ${qualSections || '<p class="muted">対象データがありません。</p>'}
  </div>
</body>
</html>`;
}
