import { type Lang } from '../i18n/testcenter';

export type BugPdfItem = {
  id: string;
  no: string;
  system: string;
  module: string;
  priority: string;
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
  browserVersion: string;
  appVersion: string;
};

export type BugPdfFilters = {
  keyword: string;
  system: string;
  month: string;
  judgments: string[];
  status: string;
};

const JUDGMENT_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  'NG':        { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  'NG確認要':   { bg: '#fffbeb', fg: '#d97706', border: '#fde68a' },
  '想定以外NG': { bg: '#faf5ff', fg: '#7c3aed', border: '#ddd6fe' },
  '確認OK':     { bg: '#ecfdf5', fg: '#059669', border: '#a7f3d0' },
};

const STATUS_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  '対応待ち': { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  '対応中':   { bg: '#fffbeb', fg: '#d97706', border: '#fde68a' },
  '確認中':   { bg: '#eff6ff', fg: '#2563eb', border: '#bfdbfe' },
  '対応不要': { bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db' },
  '対応完了': { bg: '#ecfdf5', fg: '#059669', border: '#a7f3d0' },
};

const PRIORITY_DONUT_COLOR: Record<string, string> = {
  '高': '#dc2626',
  '中': '#f59e0b',
  '低': '#22c55e',
};

const PRIORITY_PILL_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  '高': { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  '中': { bg: '#fffbeb', fg: '#d97706', border: '#fde68a' },
  '低': { bg: '#f0fdf4', fg: '#16a34a', border: '#bbf7d0' },
};

const FALLBACK_PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48'];

function priorityColor(key: string, index: number): string {
  return PRIORITY_DONUT_COLOR[key] || FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function judgPill(value: string): string {
  if (!value) return '-';
  const c = JUDGMENT_COLOR[value] ?? { bg: '#f3f4f6', fg: '#4b5563', border: '#d1d5db' };
  return `<span class="tag-pill" style="background:${c.bg};color:${c.fg};border-color:${c.border};">${esc(value)}</span>`;
}

function statusPill(value: string): string {
  if (!value) return '-';
  const c = STATUS_COLOR[value] ?? { bg: '#f3f4f6', fg: '#4b5563', border: '#d1d5db' };
  return `<span class="tag-pill" style="background:${c.bg};color:${c.fg};border-color:${c.border};">${esc(value)}</span>`;
}

function priorityPill(value: string): string {
  if (!value) return '-';
  const c = PRIORITY_PILL_COLOR[value] ?? { bg: '#f3f4f6', fg: '#4b5563', border: '#d1d5db' };
  return `<span class="tag-pill" style="background:${c.bg};color:${c.fg};border-color:${c.border};">${esc(value)}</span>`;
}

function fmtDate(value: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
    return value;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
}

function fmtNowCompact(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function fmtMonth(m: string): string {
  if (!m) return '';
  const match = m.match(/^(\d{4})(\d{2})$/);
  if (match) return `${match[1]}年${Number(match[2])}月`;
  return m;
}

function countBy(items: BugPdfItem[], key: (it: BugPdfItem) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it) || '-';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function parseSteps(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text.split(/\n/).map(l => l.replace(/^\s*\d+[\.\)、）]\s*/, '').trim()).filter(Boolean);
}

function buildDonutSvg(counts: Map<string, number>, total: number, colorMap: Record<string, string>): string {
  if (total === 0) return '<svg viewBox="0 0 140 140" width="140" height="140"></svg>';
  const r = 52;
  const cx = 70, cy = 70;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const segments: string[] = [];
  const entries = Array.from(counts.entries()).sort(([, a], [, b]) => b - a);

  for (const [key, count] of entries) {
    const len = (count / total) * C;
    const color = colorMap[key] || '#94a3b8';
    segments.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`);
    offset += len;
  }

  return `<svg viewBox="0 0 140 140" width="140" height="140">
    <g transform="rotate(-90 ${cx} ${cy})">${segments.join('')}</g>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="central" font-size="28" font-weight="700" fill="#1f2937">${total}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" dominant-baseline="central" font-size="11" fill="#6b7280">件</text>
  </svg>`;
}

function fmtEnvVersion(it: BugPdfItem): string {
  const parts: string[] = [];
  if (it.browserVersion) parts.push(it.browserVersion);
  if (it.appVersion) parts.push(it.appVersion);
  return parts.join(' / ') || '-';
}

export function buildBugListHtml(
  items: BugPdfItem[],
  filters: BugPdfFilters,
  lang: Lang,
  childContentMap: Record<string, string> = {}
): string {
  const L =
    lang === 'zh'
      ? {
          reportTitle: '【TestCenter】BUG报告',
          period: '对象期间', project: '项目', createdAt: '创建日', assignee: '负责人',
          total: '总件数', pending: '未对应', inProgress: '对应中', resolved: '已解决',
          moduleCounts: 'モジュール別 件数', priorityBreakdown: '優先度 内訳',
          bugList: 'BUG一览', expandAll: '全部展开', collapseAll: '全部收起',
          caseName: '案件名', module: 'モジュール', envVersion: '環境 / バージョン', execDate: '実施日',
          bugDesc: 'BUG概要', reproSteps: '再现手顺', expected: '期待结果', actual: '实际结果',
          screenshots: '详细截图', noChild: '无子页面内容',
          all: '全部', count: '件',
        }
      : {
          reportTitle: '【TestCenter】不具合レポート',
          period: '対象期間', project: 'プロジェクト', createdAt: '作成日', assignee: '担当',
          total: '総件数', pending: '未対応', inProgress: '対応中', resolved: '解決済',
          moduleCounts: 'モジュール別 件数', priorityBreakdown: '優先度 内訳',
          bugList: '不具合一覧', expandAll: 'すべて展開', collapseAll: 'すべて閉じる',
          caseName: '案件名', module: 'モジュール', envVersion: '環境 / バージョン', execDate: '実施日',
          bugDesc: 'BUG概要', reproSteps: '再現手順', expected: '期待結果', actual: '実際の結果',
          screenshots: '詳細スクリーンショット', noChild: '子ページの内容はありません',
          all: 'すべて', count: '件',
        };

  const total = items.length;
  const pendingCount = items.filter(b => b.status === '対応待ち').length;
  const inProgressCount = items.filter(b => b.status === '対応中' || b.status === '確認中').length;
  const resolvedCount = items.filter(b => b.status === '対応完了').length;

  const moduleCounts = countBy(items, it => it.module);
  const priorityCounts = countBy(items, it => it.priority);

  const maxModuleCount = Math.max(...Array.from(moduleCounts.values()), 1);
  const moduleBarHtml = Array.from(moduleCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([mod, cnt]) => {
      const pct = (cnt / maxModuleCount) * 100;
      return `<div class="bar-row"><span class="bar-label">${esc(mod)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div><span class="bar-count">${cnt}</span></div>`;
    }).join('');

  const priorityEntries = Array.from(priorityCounts.entries()).sort(([, a], [, b]) => b - a);
  const dynamicColorMap: Record<string, string> = {};
  priorityEntries.forEach(([k], i) => { dynamicColorMap[k] = priorityColor(k, i); });

  const donutSvg = buildDonutSvg(priorityCounts, total, dynamicColorMap);
  const legendHtml = priorityEntries
    .map(([k, c]) => {
      const color = dynamicColorMap[k];
      return `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span><span class="legend-label">${esc(k)}</span><span class="legend-count">${c}</span></div>`;
    }).join('');

  const priorityFilterBtns = priorityEntries
    .map(([k]) => {
      const color = dynamicColorMap[k];
      return `<button class="filter-btn active" data-priority="${esc(k)}" onclick="togglePriority(this)" style="--dot-color:${color}"><span class="filter-dot" style="background:${color}"></span>${esc(k)}</button>`;
    }).join('');

  const bugItems = items.map((it) => {
    const steps = parseSteps(it.reproSteps);
    const stepsHtml = steps.length > 0
      ? `<ol class="steps-list">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
      : `<p class="text-muted">-</p>`;

    const childRaw = childContentMap[it.id] ?? '';
    const childSection = childRaw.trim()
      ? `<div class="detail-section"><h5>${esc(L.screenshots)}</h5><div class="child-body">${childRaw}</div></div>`
      : `<div class="detail-section"><h5>${esc(L.screenshots)}</h5><p class="text-muted">${esc(L.noChild)}</p></div>`;

    return `
    <details class="bug-item" id="bug-${esc(it.no || it.id)}" data-priority="${esc(it.priority || '-')}">
      <summary class="bug-row">
        <span class="bug-id">${esc(it.no || '-')}</span>
        <span class="bug-desc">${esc(it.bugDesc || it.testCaseName || '-')}</span>
        <span class="bug-tags">
          ${judgPill(it.judgment)}
          ${statusPill(it.status)}
          ${priorityPill(it.priority)}
        </span>
        <span class="bug-arrow">›</span>
      </summary>
      <div class="bug-detail">
        <h4 class="detail-title">${esc(L.caseName)}</h4>
        <p class="detail-case-name">${esc(it.testCaseName || it.bugDesc || '-')}</p>

        <div class="detail-meta">
          <div class="dm"><span class="dm-label">${esc(L.module)}</span><span class="dm-value">${esc(it.module || '-')}</span></div>
          <div class="dm"><span class="dm-label">${esc(L.envVersion)}</span><span class="dm-value">${esc(fmtEnvVersion(it))}</span></div>
          <div class="dm dm-last"><span class="dm-label">${esc(L.execDate)}</span><span class="dm-value">${esc(fmtDate(it.execDate))}</span></div>
        </div>

        <div class="detail-section">
          <h5>${esc(L.bugDesc)}</h5>
          <p>${esc(it.bugDesc || '-')}</p>
        </div>

        <div class="detail-section">
          <h5>${esc(L.reproSteps)}</h5>
          ${stepsHtml}
        </div>

        <div class="result-grid">
          <div class="result-card expected">
            <h5><span class="result-dot green"></span>${esc(L.expected)}</h5>
            <p>${esc(it.expectedResult || '-')}</p>
          </div>
          <div class="result-card actual">
            <h5><span class="result-dot red"></span>${esc(L.actual)}</h5>
            <p>${esc(it.actualResult || '-')}</p>
          </div>
        </div>

        ${childSection}
      </div>
    </details>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh' : 'ja'}">
<head>
<meta charset="utf-8" />
<title>${esc(L.reportTitle)}_${fmtNowCompact()}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Yu Gothic","Meiryo","Hiragino Sans","Microsoft YaHei",system-ui,sans-serif; color:#1f2937; background:#fff; line-height:1.6; }

  .report { max-width:1060px; margin:0 auto; padding:48px 40px 32px; }

  /* ── Header ── */
  .report-header { margin-bottom:36px; }
  .report-title { font-size:26px; font-weight:800; color:#111827; letter-spacing:-0.5px; margin-bottom:16px; }
  .meta-row { display:flex; gap:40px; border-bottom:1px solid #e5e7eb; padding-bottom:16px; }
  .meta-item { display:flex; flex-direction:column; gap:2px; }
  .meta-label { font-size:11px; color:#9ca3af; font-weight:500; }
  .meta-value { font-size:14px; color:#111827; font-weight:500; }

  /* ── Summary Cards ── */
  .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:32px; }
  .summary-card { border:1px solid #e5e7eb; border-radius:10px; padding:16px 20px; }
  .summary-card .card-label { font-size:12px; color:#6b7280; font-weight:500; margin-bottom:4px; }
  .summary-card .card-value { font-size:32px; font-weight:800; line-height:1.1; }
  .summary-card .card-unit { font-size:14px; font-weight:400; color:#9ca3af; margin-left:4px; }
  .card-black .card-value { color:#111827; }
  .card-red .card-value { color:#dc2626; }
  .card-amber .card-value { color:#d97706; }
  .card-green .card-value { color:#059669; }

  /* ── Statistics ── */
  .stats-row { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:40px; }
  .stat-panel { border:1px solid #e5e7eb; border-radius:10px; padding:20px 24px; }
  .stat-panel h3 { font-size:14px; font-weight:700; color:#111827; margin-bottom:16px; }

  /* Bar chart */
  .bar-row { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  .bar-row:last-child { margin-bottom:0; }
  .bar-label { font-size:13px; color:#374151; min-width:90px; text-align:right; flex-shrink:0; }
  .bar-track { flex:1; height:10px; background:#eef2ff; border-radius:5px; overflow:hidden; }
  .bar-fill { height:100%; background:#6366f1; border-radius:5px; }
  .bar-count { font-size:13px; color:#6b7280; min-width:24px; text-align:right; }

  /* Donut chart */
  .donut-wrap { display:flex; align-items:center; gap:32px; }
  .legend { display:flex; flex-direction:column; gap:8px; }
  .legend-item { display:flex; align-items:center; gap:8px; font-size:13px; }
  .legend-dot { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
  .legend-label { color:#374151; min-width:70px; }
  .legend-count { color:#111827; font-weight:600; }

  /* ── Bug List ── */
  .list-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
  .list-header h3 { font-size:16px; font-weight:700; color:#111827; }
  .list-header h3 span { font-weight:400; color:#6b7280; margin-left:6px; font-size:14px; }
  .list-header-actions { display:flex; align-items:center; gap:12px; }
  .priority-filters { display:flex; gap:6px; }
  .filter-btn { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; font-size:12px; font-weight:500; border:1px solid #d1d5db; border-radius:9999px; background:#fff; color:#6b7280; cursor:pointer; transition:all 0.15s; }
  .filter-btn:hover { background:#f9fafb; }
  .filter-btn.active { background:#111827; color:#fff; border-color:#111827; }
  .filter-dot { width:8px; height:8px; border-radius:3px; flex-shrink:0; }
  .filter-btn.active .filter-dot { opacity:0.7; background:#fff !important; }
  .toggle-btn { padding:6px 16px; font-size:12px; font-weight:500; border:1px solid #d1d5db; border-radius:6px; background:#fff; color:#374151; cursor:pointer; }
  .toggle-btn:hover { background:#f9fafb; }

  /* Bug row */
  .bug-item { border:1px solid #e5e7eb; border-radius:8px; margin-bottom:8px; overflow:hidden; background:#fff; }
  .bug-item[open] { border-color:#d1d5db; }
  .bug-row { display:flex; align-items:center; gap:12px; padding:12px 16px; cursor:pointer; list-style:none; user-select:none; font-size:14px; }
  .bug-row::-webkit-details-marker { display:none; }
  .bug-row:hover { background:#fafbfc; }
  .bug-id { font-size:13px; font-weight:600; color:#2563eb; min-width:36px; }
  .bug-desc { flex:1; color:#374151; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bug-tags { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .tag-pill { display:inline-block; font-size:11px; font-weight:600; padding:2px 10px; border-radius:9999px; border:1px solid; }
  .bug-arrow { font-size:18px; color:#d1d5db; transition:transform 0.2s; flex-shrink:0; }
  .bug-item[open] .bug-arrow { transform:rotate(90deg); }

  /* Bug detail */
  .bug-detail { border-top:1px solid #e5e7eb; padding:20px 24px; background:#fafbfc; }
  .detail-title { font-size:12px; color:#9ca3af; font-weight:500; margin-bottom:4px; }
  .detail-case-name { font-size:16px; font-weight:700; color:#111827; margin-bottom:20px; }

  .detail-meta { display:grid; grid-template-columns:repeat(3,1fr); gap:0; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; margin-bottom:24px; background:#fff; }
  .dm { padding:12px 16px; border-right:1px solid #e5e7eb; }
  .dm.dm-last { border-right:none; }
  .dm-label { display:block; font-size:11px; color:#9ca3af; font-weight:500; margin-bottom:4px; }
  .dm-value { display:block; font-size:13px; color:#111827; font-weight:500; }

  .detail-section { margin-bottom:20px; }
  .detail-section h5 { font-size:13px; font-weight:700; color:#374151; margin-bottom:8px; }
  .detail-section p { font-size:14px; color:#4b5563; line-height:1.7; }
  .text-muted { color:#9ca3af; font-style:italic; }

  /* Steps */
  .steps-list { list-style:none; padding:0; counter-reset:step; }
  .steps-list li { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; font-size:14px; color:#4b5563; }
  .steps-list li::before { counter-increment:step; content:counter(step); display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; background:#eff6ff; color:#2563eb; font-size:12px; font-weight:700; flex-shrink:0; }

  /* Expected / Actual */
  .result-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
  .result-card { border-radius:10px; padding:16px 20px; }
  .result-card h5 { font-size:13px; font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
  .result-card p { font-size:14px; line-height:1.6; }
  .result-dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0; }
  .result-dot.green { background:#059669; }
  .result-dot.red { background:#dc2626; }
  .result-card.expected { background:#f0fdf4; border-left:3px solid #22c55e; }
  .result-card.expected h5 { color:#059669; }
  .result-card.expected p { color:#374151; }
  .result-card.actual { background:#fef2f2; border-left:3px solid #ef4444; }
  .result-card.actual h5 { color:#dc2626; }
  .result-card.actual p { color:#374151; }

  /* Child content / Screenshots */
  .child-body { font-size:13px; color:#374151; display:flex; flex-wrap:wrap; gap:12px; }
  .child-body img { width:480px; height:auto; border-radius:6px; border:1px solid #e5e7eb; cursor:pointer; transition:opacity 0.2s; }
  .child-body img:hover { opacity:0.85; }

  /* Lightbox */
  .lightbox-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); z-index:9999; justify-content:center; align-items:center; cursor:zoom-out; }
  .lightbox-overlay.active { display:flex; }
  .lightbox-overlay img { max-width:92vw; max-height:92vh; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.3); }

  /* ── Footer ── */
  .report-footer { display:flex; justify-content:space-between; align-items:center; padding:24px 0 0; margin-top:40px; border-top:1px solid #e5e7eb; font-size:12px; color:#9ca3af; }

  /* ── Print ── */
  @media print {
    body { background:#fff; }
    .report { padding:20px; }
    .toggle-btn { display:none; }
    .bug-item { page-break-inside:avoid; }
    .bug-row:hover { background:transparent; }
    .child-body img { width:400px; }
    .lightbox-overlay { display:none !important; }
  }

  /* ── Responsive ── */
  @media (max-width:768px) {
    .report { padding:24px 16px; }
    .meta-row { flex-wrap:wrap; gap:16px; }
    .summary-grid { grid-template-columns:repeat(2,1fr); }
    .stats-row { grid-template-columns:1fr; }
    .detail-meta { grid-template-columns:1fr; }
    .dm { border-right:none; border-bottom:1px solid #e5e7eb; }
    .dm.dm-last { border-bottom:none; }
    .result-grid { grid-template-columns:1fr; }
    .child-body img { width:100%; }
  }
</style>
</head>
<body>
  <div class="report">
    <!-- Header -->
    <header class="report-header">
      <h1 class="report-title">${esc(L.reportTitle)}</h1>
      <div class="meta-row">
        <div class="meta-item"><span class="meta-label">${esc(L.period)}</span><span class="meta-value">${esc(fmtMonth(filters.month) || L.all)}</span></div>
        <div class="meta-item"><span class="meta-label">${esc(L.project)}</span><span class="meta-value">${esc(filters.system || L.all)}</span></div>
        <div class="meta-item"><span class="meta-label">${esc(L.createdAt)}</span><span class="meta-value">${esc(fmtNow())}</span></div>
        <div class="meta-item"><span class="meta-label">${esc(L.assignee)}</span><span class="meta-value">TestCenter</span></div>
      </div>
    </header>

    <!-- Summary Cards -->
    <div class="summary-grid">
      <div class="summary-card card-black"><div class="card-label">${esc(L.total)}</div><div class="card-value">${total}<span class="card-unit">${esc(L.count)}</span></div></div>
      <div class="summary-card card-red"><div class="card-label">${esc(L.pending)}</div><div class="card-value">${pendingCount}<span class="card-unit">${esc(L.count)}</span></div></div>
      <div class="summary-card card-amber"><div class="card-label">${esc(L.inProgress)}</div><div class="card-value">${inProgressCount}<span class="card-unit">${esc(L.count)}</span></div></div>
      <div class="summary-card card-green"><div class="card-label">${esc(L.resolved)}</div><div class="card-value">${resolvedCount}<span class="card-unit">${esc(L.count)}</span></div></div>
    </div>

    <!-- Statistics -->
    <div class="stats-row">
      <div class="stat-panel">
        <h3>${esc(L.moduleCounts)}</h3>
        ${moduleBarHtml}
      </div>
      <div class="stat-panel">
        <h3>${esc(L.priorityBreakdown)}</h3>
        <div class="donut-wrap">
          ${donutSvg}
          <div class="legend">${legendHtml}</div>
        </div>
      </div>
    </div>

    <!-- Bug List -->
    <section>
      <div class="list-header">
        <h3>${esc(L.bugList)}<span>（${total}${esc(L.count)}）</span></h3>
        <div class="list-header-actions">
          <div class="priority-filters">${priorityFilterBtns}</div>
          <button class="toggle-btn" onclick="(function(){var ds=document.querySelectorAll('details.bug-item');var allOpen=Array.from(ds).every(function(d){return d.open&&d.style.display!=='none'});ds.forEach(function(d){if(d.style.display!=='none')d.open=!allOpen});this.textContent=allOpen?'${esc(L.expandAll)}':'${esc(L.collapseAll)}';}).call(this)">${esc(L.expandAll)}</button>
        </div>
      </div>
      ${bugItems}
    </section>

    <!-- Footer -->
    <footer class="report-footer">
      <span>TestCenter-${lang === 'zh' ? 'BUG报告' : '不具合レポート'} ${fmtNowCompact()}</span>
      <span>version1.0</span>
    </footer>
  </div>

  <!-- Lightbox for image zoom -->
  <div class="lightbox-overlay" id="lightbox" onclick="this.classList.remove('active')">
    <img id="lightbox-img" src="" alt="" />
  </div>
  <script>
    document.querySelectorAll('.child-body img').forEach(function(img) {
      img.addEventListener('dblclick', function() {
        var lb = document.getElementById('lightbox');
        document.getElementById('lightbox-img').src = this.src;
        lb.classList.add('active');
      });
    });
    function togglePriority(btn) {
      btn.classList.toggle('active');
      var activeSet = new Set();
      document.querySelectorAll('.filter-btn').forEach(function(b) {
        if (b.classList.contains('active')) activeSet.add(b.getAttribute('data-priority'));
      });
      var allInactive = activeSet.size === 0;
      document.querySelectorAll('details.bug-item').forEach(function(d) {
        var p = d.getAttribute('data-priority') || '-';
        d.style.display = (allInactive || activeSet.has(p)) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}
