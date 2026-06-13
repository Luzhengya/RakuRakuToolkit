// BUG一覧の検索結果を自己完結 HTML（A4横）で出力する。別ウィンドウで印刷/PDF保存。
import { type Lang } from '../i18n/testcenter';

export type BugPdfItem = {
  id: string;
  no: string;
  system: string;
  testCaseName: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  assignee: string;
  month: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  remarks: string;
  caseNumber: string;
};

export type BugPdfFilters = {
  keyword: string;
  system: string;
  month: string;
  judgments: string[];
  status: string;
};

// 印刷向けの淡色（背景色, 文字色）
const JUDGMENT_PRINT: Record<string, [string, string]> = {
  '確認OK': ['#ecfdf5', '#047857'],
  'NG': ['#fef2f2', '#b91c1c'],
  'NG確認要': ['#fffbeb', '#b45309'],
  '想定以外NG': ['#faf5ff', '#7e22ce'],
};
const STATUS_PRINT: Record<string, [string, string]> = {
  '対応待ち': ['#f3f4f6', '#4b5563'],
  '対応中': ['#eff6ff', '#1d4ed8'],
  '確認中': ['#fffbeb', '#b45309'],
  '対応不要': ['#f9fafb', '#6b7280'],
  '対応完了': ['#ecfdf5', '#047857'],
};

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pill(value: string, palette: Record<string, [string, string]>): string {
  if (!value) return '-';
  const [bg, fg] = palette[value] ?? ['#f3f4f6', '#4b5563'];
  return `<span class="pill" style="background:${bg};color:${fg};">${esc(value)}</span>`;
}

function fmtDate(value: string): string {
  return value ? value.slice(0, 10) : '-';
}

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function countBy(items: BugPdfItem[], key: (it: BugPdfItem) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it) || '-';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

export function buildBugListPdfHtml(items: BugPdfItem[], filters: BugPdfFilters, lang: Lang): string {
  const L =
    lang === 'zh'
      ? {
          title: 'BUG一览', exportedAt: '导出时间', total: '总件数', cond: '检索条件',
          keyword: '关键字', system: '系统区分', month: '月份', judgment: '判定', status: '状态', all: '全部',
          byJudg: '判定别件数', byStatus: '状态别件数',
          colNo: 'NO', colSystem: '系统区分', colCase: '测试案件名', colDesc: 'BUG概要',
          colJudg: '判定', colStatus: '状态', colDate: '测试时间', colAssignee: '测试担当者', colMonth: '月份',
          detailTitle: '明细', reproSteps: '再现手顺', expected: '预定结果', actual: '实际结果', remarks: '备注', caseNo: '案例编号',
        }
      : {
          title: 'BUG一覧', exportedAt: '出力日時', total: '総件数', cond: '検索条件',
          keyword: 'キーワード', system: 'システム', month: '月次', judgment: '判定', status: 'ステータス', all: 'すべて',
          byJudg: '判定別件数', byStatus: 'ステータス別件数',
          colNo: 'NO', colSystem: 'システム', colCase: 'テスト案件名', colDesc: 'BUG説明',
          colJudg: '判定', colStatus: 'ステータス', colDate: '実施日', colAssignee: '担当者', colMonth: '月次',
          detailTitle: '明細', reproSteps: '再現ステップ', expected: '予定結果', actual: '実際結果', remarks: '備考欄', caseNo: 'ケース番号',
        };

  const condParts: string[] = [];
  condParts.push(`${L.month}: ${filters.month || L.all}`);
  condParts.push(`${L.system}: ${filters.system || L.all}`);
  condParts.push(`${L.judgment}: ${filters.judgments.length ? filters.judgments.join('、') : L.all}`);
  condParts.push(`${L.status}: ${filters.status || L.all}`);
  if (filters.keyword.trim()) condParts.push(`${L.keyword}: ${filters.keyword.trim()}`);

  const judgSummary = Array.from(countBy(items, (it) => it.judgment).entries())
    .map(([k, c]) => `${pill(k, JUDGMENT_PRINT)} <b>${c}</b>`)
    .join('　');
  const statusSummary = Array.from(countBy(items, (it) => it.status).entries())
    .map(([k, c]) => `${pill(k, STATUS_PRINT)} <b>${c}</b>`)
    .join('　');

  const rows = items
    .map(
      (it) => `
      <tr>
        <td class="nowrap">${esc(it.no || '-')}</td>
        <td class="nowrap">${esc(it.system || '-')}</td>
        <td>${esc(it.testCaseName || '-')}</td>
        <td class="desc">${esc(it.bugDesc || '-')}</td>
        <td class="nowrap">${pill(it.judgment, JUDGMENT_PRINT)}</td>
        <td class="nowrap">${pill(it.status, STATUS_PRINT)}</td>
        <td class="nowrap">${esc(fmtDate(it.execDate))}</td>
        <td class="nowrap">${esc(it.assignee || '-')}</td>
        <td class="nowrap">${esc(it.month || '-')}</td>
      </tr>`
    )
    .join('');

  // 明細：各 BUG の詳細カード（画面の展開内容に相当）
  const field = (label: string, value: string, full = false, pre = false) =>
    `<div class="f${full ? ' full' : ''}"><div class="f-label">${esc(label)}</div><div class="f-val${pre ? ' pre' : ''}">${esc(value || '-')}</div></div>`;

  const detailCards = items
    .map((it) => {
      const metaParts = [
        `${L.colAssignee}: ${it.assignee || '-'}`,
        `${L.colDate}: ${fmtDate(it.execDate)}`,
        `${L.colMonth}: ${it.month || '-'}`,
      ];
      if (it.caseNumber) metaParts.push(`${L.caseNo}: ${it.caseNumber}`);
      return `
      <div class="card">
        <div class="card-head">
          <span class="card-no">${esc(it.no || '-')}</span>
          ${pill(it.judgment, JUDGMENT_PRINT)}
          ${pill(it.status, STATUS_PRINT)}
          <span class="card-sys">${esc(it.system || '-')}</span>
          <span class="card-meta">${esc(metaParts.join('　·　'))}</span>
        </div>
        <div class="card-grid">
          ${field(L.colCase, it.testCaseName, true)}
          ${field(L.colDesc, it.bugDesc, true)}
          ${field(L.expected, it.expectedResult)}
          ${field(L.actual, it.actualResult)}
          ${field(L.reproSteps, it.reproSteps, true, true)}
          ${field(L.remarks, it.remarks, true)}
        </div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh' : 'ja'}">
<head>
<meta charset="utf-8" />
<title>${esc(L.title)}_${formatNow().slice(0, 10).replace(/\//g, '')}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Yu Gothic","Meiryo",system-ui,sans-serif; color:#1f2937; margin:0; padding:14px; }
  h1 { font-size:20px; margin:0 0 4px; border-bottom:3px solid #0f172a; padding-bottom:6px; }
  .meta { font-size:11px; color:#6b7280; margin-top:6px; line-height:1.7; }
  .meta b { color:#111827; }
  .summary { margin:10px 0 6px; font-size:12px; display:flex; flex-wrap:wrap; gap:18px; }
  .summary .label { color:#6b7280; margin-right:6px; }
  .pill { display:inline-block; border-radius:9999px; padding:1px 8px; font-size:11px; font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-top:8px; table-layout:fixed; }
  th,td { border:1px solid #d1d5db; padding:4px 6px; text-align:left; vertical-align:top; word-break:break-word; }
  th { background:#0f172a; color:#fff; font-weight:600; }
  td.nowrap { white-space:nowrap; }
  td.desc { font-size:10.5px; }
  col.c-no{width:48px;} col.c-sys{width:84px;} col.c-case{width:150px;} col.c-desc{width:auto;}
  col.c-judg{width:74px;} col.c-status{width:74px;} col.c-date{width:74px;} col.c-assi{width:70px;} col.c-month{width:56px;}
  tbody tr:nth-child(even){ background:#f8fafc; }
  /* 明細カード */
  .detail-title { font-size:15px; font-weight:700; margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid #0f172a; }
  .card { border:1px solid #d1d5db; border-radius:8px; margin-bottom:10px; overflow:hidden; }
  .card-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; padding:6px 10px; }
  .card-no { font-weight:700; font-size:13px; color:#0f172a; }
  .card-sys { font-size:11px; color:#475569; }
  .card-meta { font-size:10.5px; color:#6b7280; margin-left:auto; }
  .card-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; padding:10px 12px; }
  .f.full { grid-column:1 / -1; }
  .f-label { font-size:10px; color:#6b7280; font-weight:600; margin-bottom:2px; }
  .f-val { font-size:11.5px; color:#1f2937; word-break:break-word; }
  .f-val.pre { white-space:pre-wrap; }
  @media print {
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .card { page-break-inside: avoid; }
    .detail-title { page-break-before: always; }
  }
</style>
</head>
<body>
  <h1>${esc(L.title)}</h1>
  <div class="meta">
    <span><b>${L.exportedAt}:</b> ${esc(formatNow())}</span>　<span><b>${L.total}:</b> ${items.length}</span><br>
    <b>${L.cond}:</b> ${esc(condParts.join('　|　'))}
  </div>
  <div class="summary">
    <div><span class="label">${L.byJudg}:</span> ${judgSummary || '-'}</div>
    <div><span class="label">${L.byStatus}:</span> ${statusSummary || '-'}</div>
  </div>
  <table>
    <colgroup>
      <col class="c-no"/><col class="c-sys"/><col class="c-case"/><col class="c-desc"/>
      <col class="c-judg"/><col class="c-status"/><col class="c-date"/><col class="c-assi"/><col class="c-month"/>
    </colgroup>
    <thead>
      <tr>
        <th>${L.colNo}</th><th>${L.colSystem}</th><th>${L.colCase}</th><th>${L.colDesc}</th>
        <th>${L.colJudg}</th><th>${L.colStatus}</th><th>${L.colDate}</th><th>${L.colAssignee}</th><th>${L.colMonth}</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="9" style="text-align:center;color:#9ca3af;">-</td></tr>`}</tbody>
  </table>

  ${items.length ? `<div class="detail-title">${esc(L.detailTitle)}</div>${detailCards}` : ''}
</body>
</html>`;
}
