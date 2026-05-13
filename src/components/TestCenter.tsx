import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Eye,
  Globe2,
  History,
  Landmark,
  Loader2,
  FileText,
  School,
  Smartphone,
  BookOpen,
  Trash2,
  Users,
  Briefcase,
} from 'lucide-react';

type TestCenterProps = {
  onBack: () => void;
};

type AreaId = 'jmotto' | 'univ' | 'credit' | 'overseas' | 'jmotto-app' | 'univ-app' | 'univ-contents' | 'nayose' | 'gyoshu' | 'ros';

type ProgressItem = {
  id: string;
  month: string;
  projectName: string;
  status: string;
  estimateTotal: string;
  actualTotal: string;
  developmentEffort: string;
  tcStartDate: string;
  tcDesignCompleteDate: string;
  tcExecutionCompleteDate: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
  designEstimate: string;
  implementationEstimate: string;
  executionEstimate: string;
  reviewEstimate: string;
};

type ApiResponse = {
  area: AreaId;
  total: number;
  items: ProgressItem[];
};

type ResultDraft = {
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
};

type SaveNotice = {
  type: 'success' | 'error';
  message: string;
};

type AreaDocMeta = {
  releaseNameJa: string;
  planFileNamePrefix: string;
  svnPathSegment: string;
};

function getTargetMonthKeys(): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = 0; offset <= 2; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    keys.push(`${year}${month}`);
  }
  return keys;
}

function toMonthKey(value: string): string {
  const text = value.trim();
  if (!text) return '';

  const fullPattern = text.match(/(\d{4})[\-/.年](\d{1,2})/);
  if (fullPattern) {
    const year = fullPattern[1];
    const month = String(Number(fullPattern[2])).padStart(2, '0');
    return `${year}${month}`;
  }

  const monthOnlyPattern = text.match(/(\d{1,2})月/);
  if (monthOnlyPattern) {
    const now = new Date();
    const month = Number(monthOnlyPattern[1]);
    const candidates = getTargetMonthKeys();
    const matched = candidates.find((key) => Number(key.slice(4, 6)) === month);
    return matched ?? `${now.getFullYear()}${String(month).padStart(2, '0')}`;
  }

  const compactPattern = text.match(/^(\d{4})(\d{2})$/);
  if (compactPattern) {
    return `${compactPattern[1]}${compactPattern[2]}`;
  }

  const isoPattern = text.match(/^(\d{4})-(\d{2})/);
  if (isoPattern) {
    return `${isoPattern[1]}${isoPattern[2]}`;
  }

  return '';
}

function formatToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseNumber(value: string): number {
  const normalized = value.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

function addDays(dateText: string, days: number): string {
  const normalized = dateText.trim().slice(0, 10).replace(/\./g, '-').replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function safeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceToken(source: string, token: string, value: string): string {
  return source.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
}

function getDefaultTestEnvironmentHtml(areaId: AreaId): string {
  const byArea: Record<AreaId, string[]> = {
    jmotto: [
      '☑ [ブラウザ] Chrome（147.0.7727.102）',
      '☑ [ポータル] https://www1-v2stg100.j-motto.co.jp/web/doLogin',
      '☑ [ GW ] https://gws85.j-motto.co.jp/cgi-bin/',
      '□ [ポータル申込画面] https://www1-v2stg100.j-motto.co.jp/web2/entrRegist',
      '☑ [ J H ] http://172.18.3.205/login',
      '□ [ WPDL ] https://www1-v2stg101.j-motto.co.jp/00000000/wp/',
    ],
    univ: [
      '☑ [ブラウザ] Chrome (147.0.7727.102)',
      '☑ [ スマホ ] IOS26.1 ｜ android16',
      '☑ [ UNIV2 ] https://54.64.96.104/login',
      '☑ [内部システム] https://testweb3.cybaxuniv.com/admin/sys_login',
    ],
    credit: [
      '☑ [ブラウザ] Chrome (147.0.7727.102)',
      '☑ [利用者] https://test-alb.kigyo-joho.com/login/1DCCyG3Xe1',
      '☑ [管理者] http://10.240.14.166/login/',
    ],
    overseas: [
      '☑ [ChromeVersion] 147.0.7727.102',
      '☑ [管理] http://54.92.97.142/report/inner/index.html',
      '☑ [利墨] https://140.179.40.134/ssoLogin/login',
      '☑ [与信・RM] http://172.26.4.109:8080/rismon_ukeire/',
      '☑ [FNA] https://140.179.40.134/.mypage/fna_login',
    ],
    'jmotto-app': [
      '[本番環境]',
      '☑ IOS26.1.0（iphone13）',
      '☑ Android16（Pixel 6A）',
      '[テストアカウント]',
      '☑ JM0000017 / 00391 / test1234',
    ],
    'univ-app': [
      '[検証環境]',
      '☑ IOS26.1.0（iphone13）(safari)',
      '☑ Android16（Pixel 6A）(chrome)',
      '☑ [ UNIV２ ] https://18.178.87.210/',
      '☑ [内部システム] https://testweb3.cybaxuniv.com/admin/sys_login',
    ],
    'univ-contents': [
      '☑ [ブラウザ] Chrome (147.0.7727.102)',
      '☑ [ スマホ ] IOS26.1 ｜ android16',
      '☑ [ スマホ ] IOS18 ｜ android12（比較バージョン）',
      '☑ [ UNIVコンテンツ ] https://www.cybaxuniv.com/',
      '☑ [ UNIV２ ] https://54.64.96.104/login',
    ],
    'nayose': [
      '☑ [ブラウザ] Chrome（147.0.7727.102）',
      '☑ [URL] https://test-nayose.riskmonster.net/login',
      '☑ [URL] http://172.26.4.109:8080/rismon_ukeire/',
    ],
    'gyoshu': [
      '☑ Chrome（147.0.7727.102）',
      '☑ IOS26.1.0（iphone13）',
      '☑ Android16（Pixel 6A）',
      '☑ https://test-gyoushu.riskmonster.net/',
    ],
    'ros': [
      '☑ [ブラウザ] Chrome（147.0.7727.102）',
    ],
  };
  return byArea[areaId].map((line) => `<div>${safeHtml(line)}</div>`).join('');
}

const AREA_DOC_META: Record<AreaId, AreaDocMeta> = {
  jmotto: {
    releaseNameJa: 'jmottoポータル',
    planFileNamePrefix: 'jmottoポータル',
    svnPathSegment: 'J-motto(Web)'
  },
  univ: {
    releaseNameJa: 'UNIV',
    planFileNamePrefix: 'UNIV',
    svnPathSegment: 'Univ(Web)'
  },
  overseas: {
    releaseNameJa: '海外調書',
    planFileNamePrefix: '海外調書',
    svnPathSegment: '海外調書'
  },
  credit: {
    releaseNameJa: '企業信用情報',
    planFileNamePrefix: '企業信用情報',
    svnPathSegment: '企業調査WEB,SYS'
  },
  'jmotto-app': {
    releaseNameJa: 'jmottoアプリ',
    planFileNamePrefix: 'jmottoアプリ',
    svnPathSegment: 'J-motto(スマホ)',
  },
  'univ-app': {
    releaseNameJa: 'Univアプリ',
    planFileNamePrefix: 'Univアプリ',
    svnPathSegment: 'Univ(スマホ)',
  },
  'univ-contents': {
    releaseNameJa: 'UnivContents',
    planFileNamePrefix: 'Univコンテンツ',
    svnPathSegment: 'Univ(コンテンツ)',
  },
  'nayose': {
    releaseNameJa: '名寄せアプリ',
    planFileNamePrefix: '名寄せアプリ',
    svnPathSegment: '名寄せアプリ',
  },
  'gyoshu': {
    releaseNameJa: '業種別審査ノート',
    planFileNamePrefix: '業種別審査ノート',
    svnPathSegment: '業種別',
  },
  'ros': {
    releaseNameJa: '与信ROS',
    planFileNamePrefix: '与信ROS',
    svnPathSegment: '与信ROS',
  },
};

/** ブラウザ「名前を付けて PDF 保存」の初期ファイル名に使う（document.title と一致） */
function getPlanPdfFilename(monthKey: string, areaId: AreaId): string {
  const meta = AREA_DOC_META[areaId];
  if (monthKey.length >= 6) {
    const yyyy = monthKey.slice(0, 4);
    const mm = monthKey.slice(4, 6);
    return `海南テストセンター_${meta.planFileNamePrefix}${mm}月リリース計画書${yyyy}${mm}.pdf`;
  }
  return `海南テストセンター_${meta.planFileNamePrefix}計画書.pdf`;
}

function getReportPdfFilename(monthKey: string, areaId: AreaId): string {
  const meta = AREA_DOC_META[areaId];
  if (monthKey.length >= 6) {
    const yyyy = monthKey.slice(0, 4);
    const mm = monthKey.slice(4, 6);
    return `海南テストセンター_テスト結果報告書(${meta.planFileNamePrefix}${mm}月リリース)_${yyyy}${mm}.pdf`;
  }
  return `海南テストセンター_テスト結果報告書(${meta.planFileNamePrefix}).pdf`;
}

function buildPlanHtml(
  template: string,
  selectedItems: ProgressItem[],
  monthKey: string,
  areaId: AreaId
): string {
  if (selectedItems.length === 0) return template;

  const first = selectedItems[0];
  const yyyy = monthKey.slice(0, 4);
  const mm = monthKey.slice(4, 6);
  const areaMeta = AREA_DOC_META[areaId];

  const projectListHtml = selectedItems
    .map((item) => `<li>${safeHtml(item.projectName || '-')}</li>`)
    .join('\n');

  const workBlocksHtml = selectedItems
    .map(
      (item) => `
      <div class="work-block">
        <div class="work-title">${safeHtml(item.projectName || '-')}</div>
        <table class="work-table">
          <tbody>
            <tr><th>開発工数</th><td contenteditable="true">${safeHtml(item.developmentEffort || '')}</td></tr>
            <tr><th>テストセンターの見積工数</th><td contenteditable="true">${safeHtml(item.estimateTotal || '')}</td></tr>
            <tr><th>詳細内訳</th><td contenteditable="true">設計書作成: ${safeHtml(item.designEstimate || '')}<br>実装作成: ${safeHtml(item.implementationEstimate || '')}<br>テスト実施: ${safeHtml(item.executionEstimate || '')}<br>レビュー: ${safeHtml(item.reviewEstimate || '')}</td></tr>
          </tbody>
        </table>
      </div>`
    )
    .join('\n');

  const totalDevelopment = selectedItems.reduce((sum, item) => sum + parseNumber(item.developmentEffort), 0);
  const totalEstimate = selectedItems.reduce((sum, item) => sum + parseNumber(item.estimateTotal), 0);
  const tcDesign = first.tcDesignCompleteDate || '';
  const tcExec = first.tcExecutionCompleteDate || '';

  let html = template;
  html = replaceToken(html, '{{PROJECT_LIST}}', projectListHtml);
  html = replaceToken(html, '{{TEST_ENVIRONMENT_BLOCK}}', getDefaultTestEnvironmentHtml(areaId));
  html = replaceToken(html, '{{WORK_BLOCKS}}', workBlocksHtml);
  html = replaceToken(html, '{{Today}}', formatToday());
  html = replaceToken(html, '{{YYYY}}', yyyy);
  html = replaceToken(html, '{{MM}}', mm);
  html = replaceToken(html, '{{PDF_DOCUMENT_TITLE}}', getPlanPdfFilename(monthKey, areaId));
  html = replaceToken(html, '{{AREA_RELEASE_NAME}}', areaMeta.releaseNameJa);
  html = replaceToken(html, '{{SVN_PATH_SEGMENT}}', areaMeta.svnPathSegment);
  html = replaceToken(html, '{{開発工数総計}}', String(totalDevelopment));
  html = replaceToken(html, '{{見積工数総計}}', String(totalEstimate));
  html = replaceToken(html, '{{TC開始予定日}}', first.tcStartDate || '');
  html = replaceToken(html, '{{TC設計書完了予定日}}', tcDesign);
  html = replaceToken(html, '{{TC実施完了予定日}}', tcExec);
  html = replaceToken(html, '{{TC設計書完了予定日+1}}', addDays(tcDesign, 1));
  html = replaceToken(html, '{{TC設計書完了予定日+2}}', addDays(tcDesign, 2));
  html = replaceToken(html, '{{TC実施完了予定日+1}}', addDays(tcExec, 1));
  html = replaceToken(html, '{{TC実施完了予定日+2}}', addDays(tcExec, 2));
  html = replaceToken(html, '{{案件名}}', safeHtml(first.projectName || ''));
  html = replaceToken(html, '{{開発工数}}', safeHtml(first.developmentEffort || ''));
  html = replaceToken(html, '{{見積総}}', safeHtml(first.estimateTotal || ''));
  html = replaceToken(html, '{{実績総}}', safeHtml(first.actualTotal || ''));
  html = html.replace(/\{\{案件名\}\}\}/g, safeHtml(first.projectName || ''));
  return html;
}

function buildResultReportHtml(
  template: string,
  selectedItems: ProgressItem[],
  monthKey: string,
  areaId: AreaId
): string {
  if (selectedItems.length === 0) return template;

  const first = selectedItems[0];
  const yyyy = monthKey.slice(0, 4);
  const mm = monthKey.slice(4, 6);
  const areaMeta = AREA_DOC_META[areaId];
  const tcDesign = first.tcDesignCompleteDate || '';
  const tcExec = first.tcExecutionCompleteDate || '';

  const totalTestCount = selectedItems.reduce((sum, item) => sum + parseNumber(item.testTotalCount), 0);
  const totalBugCount = selectedItems.reduce((sum, item) => sum + parseNumber(item.bugCount), 0);
  const totalBlockedCount = selectedItems.reduce((sum, item) => sum + parseNumber(item.testBlockedCount), 0);
  const totalPendingCount = selectedItems.reduce((sum, item) => sum + parseNumber(item.pendingConfirmCount), 0);
  const totalEstimateEffort = selectedItems.reduce((sum, item) => sum + parseNumber(item.estimateTotal), 0);
  const totalActualEffort = selectedItems.reduce((sum, item) => sum + parseNumber(item.actualTotal), 0);
  const totalEffortDiff = parseFloat((totalActualEffort - totalEstimateEffort).toFixed(2));

  const projectListHtml = selectedItems
    .map((item) => `<li>${safeHtml(item.projectName || '-')}</li>`)
    .join('\n');

  const resultCardsHtml = selectedItems
    .map((item) => {
      const testTotal = parseNumber(item.testTotalCount);
      const bug = parseNumber(item.bugCount);
      const blocked = parseNumber(item.testBlockedCount);
      const pending = parseNumber(item.pendingConfirmCount);
      const pass = Math.max(0, testTotal - bug - blocked - pending);

      // stats-row 直下に条件付き説明行を追加（案件名ヘッダーなし）
      const explainRows: string[] = [];
      if (bug > 0) {
        explainRows.push(`
          <div class="supplement-item">
            <div class="supplement-label">NG説明</div>
            <div class="editable-note" contenteditable="true">ここにNGの詳細説明を記入してください。</div>
          </div>`);
      }
      if (blocked > 0) {
        explainRows.push(`
          <div class="supplement-item">
            <div class="supplement-label">テスト不可説明</div>
            <div class="editable-note" contenteditable="true">ここにテスト不可の理由・影響を記入してください。</div>
          </div>`);
      }
      if (pending > 0) {
        explainRows.push(`
          <div class="supplement-item">
            <div class="supplement-label">判断不可/想定外説明</div>
            <div class="editable-note" contenteditable="true">ここに判断不可/想定外事項の内容と対応方針を記入してください。</div>
          </div>`);
      }
      const explainHtml = explainRows.length > 0
        ? `<div class="supplement-items" style="border-top:1px solid #e2e8f0;">${explainRows.join('')}</div>`
        : '';

      return `
      <div class="task-block">
        <div class="task-header">${safeHtml(item.projectName || '-')}</div>
        <div class="stats-row">
          <div class="stat-item"><span class="stat-label">テスト総件数</span><span class="stat-number">${testTotal}</span></div>
          <div class="stat-item"><span class="stat-label">テストOK</span><span class="stat-number ok-badge">${pass}</span></div>
          <div class="stat-item"><span class="stat-label">テスト不可</span><span class="stat-number pending-badge">${blocked}</span></div>
          <div class="stat-item"><span class="stat-label">テストNG</span><span class="stat-number ng-badge">${bug}</span></div>
          <div class="stat-item"><span class="stat-label">判断不可/想定外</span><span class="stat-number pending-badge">${pending}</span></div>
        </div>
        ${explainHtml}
      </div>`;
    })
    .join('\n');

  const effortProjectBlocksHtml = selectedItems
    .map((item) => {
      const estimate = parseNumber(item.estimateTotal);
      const actual = parseNumber(item.actualTotal);
      const diff = parseFloat((actual - estimate).toFixed(2));

      // 工数差分 > 2 の場合のみ工数説明行を追加
      const effortNoteRow = diff > 2
        ? `<tr><th style="color:#b91c1c;">工数差分説明</th><td contenteditable="true" style="color:#b91c1c;min-width:200px;">差分が${diff}人日を超えています。理由を記入してください。</td></tr>`
        : '';

      return `
      <div class="effort-project-block">
        <div class="effort-project-title">${safeHtml(item.projectName || '-')}</div>
        <table class="effort-project-table">
          <tbody>
            <tr><th>開発工数</th><td>${safeHtml(item.developmentEffort || '0')}</td></tr>
            <tr><th>見積工数</th><td>${estimate}</td></tr>
            <tr><th>実績工数</th><td>${actual}</td></tr>
            ${effortNoteRow}
          </tbody>
        </table>
      </div>`;
    })
    .join('\n');

  const reportConclusion =
    totalBugCount + totalBlockedCount + totalPendingCount > 0
      ? '一部の案件でテスト不可・NG・判断不可/想定外が存在します。詳細は案件別結果をご確認ください。'
      : '全案件で重大な問題は確認されませんでした。';
  const isActualOverEstimate = totalActualEffort > totalEstimateEffort;
  const totalEffortDiffLabel = totalEffortDiff > 0 ? `+${totalEffortDiff}` : String(totalEffortDiff);

  let html = template;
  html = replaceToken(html, '{{REPORT_DOCUMENT_TITLE}}', getReportPdfFilename(monthKey, areaId));
  html = replaceToken(html, '{{Today}}', formatToday());
  html = replaceToken(html, '{{YYYY}}', yyyy);
  html = replaceToken(html, '{{MM}}', mm);
  html = replaceToken(html, '{{AREA_RELEASE_NAME}}', areaMeta.releaseNameJa);
  html = replaceToken(html, '{{PROJECT_LIST}}', projectListHtml);
  html = replaceToken(html, '{{TEST_ENVIRONMENT_BLOCK}}', getDefaultTestEnvironmentHtml(areaId));
  html = replaceToken(html, '{{TC開始予定日}}', first.tcStartDate || '');
  html = replaceToken(html, '{{TC設計書完了予定日}}', tcDesign);
  html = replaceToken(html, '{{TC実施完了予定日}}', tcExec);
  html = replaceToken(html, '{{TC設計書完了予定日+1}}', addDays(tcDesign, 1));
  html = replaceToken(html, '{{TC設計書完了予定日+2}}', addDays(tcDesign, 2));
  html = replaceToken(html, '{{TC実施完了予定日+1}}', addDays(tcExec, 1));
  html = replaceToken(html, '{{TC実施完了予定日+2}}', addDays(tcExec, 2));
  html = replaceToken(html, '{{TEST_TOTAL_COUNT}}', String(totalTestCount));
  html = replaceToken(html, '{{BUG_COUNT}}', String(totalBugCount));
  html = replaceToken(html, '{{TEST_BLOCKED_COUNT}}', String(totalBlockedCount));
  html = replaceToken(html, '{{PENDING_CONFIRM_COUNT}}', String(totalPendingCount));
  html = replaceToken(html, '{{ESTIMATE_TOTAL_EFFORT}}', String(totalEstimateEffort));
  html = replaceToken(html, '{{ACTUAL_TOTAL_EFFORT}}', String(totalActualEffort));
  html = replaceToken(html, '{{TOTAL_EFFORT_DIFF}}', totalEffortDiffLabel);
  html = replaceToken(
    html,
    '{{ACTUAL_EFFORT_EXTRA_CLASS}}',
    isActualOverEstimate ? ' effort-overrun' : ''
  );
  html = replaceToken(html, '{{EFFORT_PROJECT_BLOCKS}}', effortProjectBlocksHtml);
  html = replaceToken(html, '{{RESULT_CARDS}}', resultCardsHtml);
  html = replaceToken(html, '{{REPORT_CONCLUSION}}', reportConclusion);
  return html;
}

// ---- HTML 保存履歴 ----

type HtmlHistory = {
  id: string;
  type: 'plan' | 'report';
  areaId: string;
  monthKey: string;
  title: string;
  htmlContent: string;
  savedAt: string;
};

const HISTORY_STORAGE_KEY = 'testcenter-html-history';
const MAX_HISTORY_ITEMS = 30;

function loadHistory(): HtmlHistory[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HtmlHistory[]) : [];
  } catch {
    return [];
  }
}

function addToHistory(entry: Omit<HtmlHistory, 'id' | 'savedAt'>): HtmlHistory[] {
  const history = loadHistory();
  const newEntry: HtmlHistory = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
  };
  const updated = [newEntry, ...history].slice(0, MAX_HISTORY_ITEMS);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    const trimmed = [newEntry, ...history].slice(0, 10);
    try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
    return trimmed;
  }
  return updated;
}

function deleteFromHistory(id: string): HtmlHistory[] {
  const history = loadHistory().filter((e) => e.id !== id);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch { /* ignore */ }
  return history;
}

const AREAS = [
  {
    id: 'jmotto' as AreaId,
    title: 'jmottoエリア',
    description: '用于 jmotto 相关测试项的统一管理。',
    icon: <School className="text-blue-600" size={22} />
  },
  {
    id: 'univ' as AreaId,
    title: 'UNIVエリア',
    description: '用于 UNIV 相关测试项的统一管理。',
    icon: <Landmark className="text-violet-600" size={22} />
  },
  {
    id: 'credit' as AreaId,
    title: '企業信用情報エリア',
    description: '用于企業信用情報测试任务的统一管理。',
    icon: <Building2 className="text-amber-600" size={22} />
  },
  {
    id: 'overseas' as AreaId,
    title: '海外調書エリア',
    description: '用于海外調書测试任务的统一管理。',
    icon: <Globe2 className="text-emerald-600" size={22} />
  },
  {
    id: 'jmotto-app' as AreaId,
    title: 'jmottoアプリエリア',
    description: 'jmottoアプリ関連のテスト項目を統一管理する。',
    icon: <Smartphone className="text-blue-500" size={22} />
  },
  {
    id: 'univ-app' as AreaId,
    title: 'Univアプリエリア',
    description: 'Univアプリ関連のテスト項目を統一管理する。',
    icon: <Smartphone className="text-violet-500" size={22} />
  },
  {
    id: 'univ-contents' as AreaId,
    title: 'UnivContentsエリア',
    description: 'UnivContents関連のテスト項目を統一管理する。',
    icon: <BookOpen className="text-teal-600" size={22} />
  },
  {
    id: 'nayose' as AreaId,
    title: '名寄せアプリエリア',
    description: '名寄せアプリ関連のテスト項目を統一管理する。',
    icon: <Users className="text-orange-500" size={22} />
  },
  {
    id: 'gyoshu' as AreaId,
    title: '業種別エリア',
    description: '業種別審査ノート関連のテスト項目を統一管理する。',
    icon: <Briefcase className="text-rose-500" size={22} />
  },
  {
    id: 'ros' as AreaId,
    title: '与信ROSエリア',
    description: '与信ROS関連のテスト項目を統一管理する。',
    icon: <FileText className="text-cyan-600" size={22} />
  },
];

export default function TestCenter({ onBack }: TestCenterProps) {
  const [selectedAreaId, setSelectedAreaId] = useState<AreaId | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [activeMonthTab, setActiveMonthTab] = useState<string>('');
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [planHtml, setPlanHtml] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const planPreviewIframeRef = useRef<HTMLIFrameElement>(null);
  const reportPreviewIframeRef = useRef<HTMLIFrameElement>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [templateHtml, setTemplateHtml] = useState('');
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [reportHtml, setReportHtml] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportTemplateHtml, setReportTemplateHtml] = useState('');
  const [creatingReport, setCreatingReport] = useState(false);
  const [resultDraftMap, setResultDraftMap] = useState<Record<string, ResultDraft>>({});
  const [savingResultMap, setSavingResultMap] = useState<Record<string, boolean>>({});
  const [resultSaveNoticeMap, setResultSaveNoticeMap] = useState<Record<string, SaveNotice>>({});
  const [editingResultItemId, setEditingResultItemId] = useState<string | null>(null);
  const [htmlHistory, setHtmlHistory] = useState<HtmlHistory[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPreviewId, setHistoryPreviewId] = useState<string | null>(null);
  const targetMonthKeys = useMemo(() => getTargetMonthKeys(), []);
  const targetMonthKeySet = useMemo(() => new Set(targetMonthKeys), [targetMonthKeys]);

  const selectedArea = useMemo(
    () => AREAS.find((area) => area.id === selectedAreaId) ?? null,
    [selectedAreaId]
  );
  const isAreaSelected = !!selectedAreaId;

  const loadAreaData = async (areaId: AreaId) => {
    setSelectedAreaId(areaId);
    setLoading(true);
    setError(null);
    setItems([]);
    setActiveMonthTab('');
    setCheckedMap({});
    setPlanError(null);
    setReportError(null);
    setResultDraftMap({});
    setSavingResultMap({});
    setResultSaveNoticeMap({});
    setEditingResultItemId(null);

    try {
      const response = await fetch(`/api/test-center?area=${areaId}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '获取测试中心数据失败');
      }
      const data = (await response.json()) as ApiResponse;
      setItems(data.items ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取测试中心数据失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (label: string, value: string) => (
    <div className="space-y-1">
      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{label}</p>
      <p className="text-sm text-neutral-700 break-all">{value || '-'}</p>
    </div>
  );

  const monthGroups = useMemo(() => {
    if (!selectedAreaId) return [];
    const grouped = new Map<string, ProgressItem[]>();

    for (const item of items) {
      const key = toMonthKey(item.month);
      if (!targetMonthKeySet.has(key)) continue;
      const existing = grouped.get(key) ?? [];
      existing.push(item);
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, groupItems]) => ({
      month,
      items: groupItems,
    }));
  }, [items, selectedAreaId, targetMonthKeySet]);

  const currentItems = useMemo(() => {
    if (monthGroups.length === 0) {
      return items.filter((item) => targetMonthKeySet.has(toMonthKey(item.month)));
    }

    const currentMonth = activeMonthTab || monthGroups[0].month;
    return monthGroups.find((group) => group.month === currentMonth)?.items ?? [];
  }, [activeMonthTab, items, monthGroups, targetMonthKeySet]);

  useEffect(() => {
    if (currentItems.length === 0) return;
    setCheckedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of currentItems) {
        next[item.id] = prev[item.id] ?? true;
      }
      return next;
    });
  }, [currentItems]);

  useEffect(() => {
    if (!isAreaSelected) return;
    setResultDraftMap((prev) => {
      const next = { ...prev };
      for (const item of currentItems) {
        if (!next[item.id]) {
          next[item.id] = {
            testTotalCount: item.testTotalCount || '',
            bugCount: item.bugCount || '',
            testBlockedCount: item.testBlockedCount || '',
            pendingConfirmCount: item.pendingConfirmCount || '',
          };
        }
      }
      return next;
    });
  }, [currentItems, isAreaSelected]);

  const selectedItems = useMemo(
    () => currentItems.filter((item) => checkedMap[item.id]),
    [checkedMap, currentItems]
  );
  const editingResultItem = useMemo(
    () => items.find((item) => item.id === editingResultItemId) ?? null,
    [editingResultItemId, items]
  );

  const currentMonthKey = useMemo(() => {
    if (monthGroups.length > 0) {
      return activeMonthTab || monthGroups[0].month;
    }
    return targetMonthKeys[0];
  }, [activeMonthTab, monthGroups, targetMonthKeys]);

  const areaResultReady = useMemo(() => {
    if (!isAreaSelected || currentItems.length === 0) return false;
    return currentItems.every((item) =>
      hasValue(resultDraftMap[item.id]?.testTotalCount ?? item.testTotalCount) &&
      hasValue(resultDraftMap[item.id]?.bugCount ?? item.bugCount) &&
      hasValue(resultDraftMap[item.id]?.testBlockedCount ?? item.testBlockedCount) &&
      hasValue(resultDraftMap[item.id]?.pendingConfirmCount ?? item.pendingConfirmCount)
    );
  }, [currentItems, isAreaSelected, resultDraftMap]);

  const updateResultDraft = (itemId: string, key: keyof ResultDraft, value: string) => {
    setResultDraftMap((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? {
          testTotalCount: '',
          bugCount: '',
          testBlockedCount: '',
          pendingConfirmCount: '',
        }),
        [key]: value,
      },
    }));
    setResultSaveNoticeMap((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const getResultDraft = (item: ProgressItem): ResultDraft => ({
    testTotalCount: resultDraftMap[item.id]?.testTotalCount ?? item.testTotalCount ?? '',
    bugCount: resultDraftMap[item.id]?.bugCount ?? item.bugCount ?? '',
    testBlockedCount: resultDraftMap[item.id]?.testBlockedCount ?? item.testBlockedCount ?? '',
    pendingConfirmCount: resultDraftMap[item.id]?.pendingConfirmCount ?? item.pendingConfirmCount ?? '',
  });

  const isResultReady = (item: ProgressItem): boolean => {
    const draft = getResultDraft(item);
    return (
      hasValue(draft.testTotalCount) &&
      hasValue(draft.bugCount) &&
      hasValue(draft.testBlockedCount) &&
      hasValue(draft.pendingConfirmCount)
    );
  };

  const handleSaveResultToNotion = async (item: ProgressItem) => {
    const draft = resultDraftMap[item.id] ?? {
      testTotalCount: item.testTotalCount || '',
      bugCount: item.bugCount || '',
      testBlockedCount: item.testBlockedCount || '',
      pendingConfirmCount: item.pendingConfirmCount || '',
    };

    setSavingResultMap((prev) => ({ ...prev, [item.id]: true }));
    setResultSaveNoticeMap((prev) => ({
      ...prev,
      [item.id]: { type: 'success', message: '保存中...' },
    }));

    try {
      const response = await fetch('/api/test-center/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [
            {
              id: item.id,
              ...draft,
            },
          ],
        }),
      });
      const data = await response.json().catch(() => ({}));
      const result = Array.isArray(data.results) ? data.results[0] : null;
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || data.error || '保存到 Notion 失败');
      }

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                ...draft,
              }
            : row
        )
      );
      setResultSaveNoticeMap((prev) => ({
        ...prev,
        [item.id]: { type: 'success', message: '已保存到 Notion' },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存到 Notion 失败';
      setResultSaveNoticeMap((prev) => ({
        ...prev,
        [item.id]: { type: 'error', message },
      }));
    } finally {
      setSavingResultMap((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleCreatePlan = async () => {
    if (!selectedAreaId) return;
    if (selectedItems.length === 0) {
      setPlanError('请至少选择一条记录后再生成計画資料。');
      return;
    }

    setCreatingPlan(true);
    setPlanError(null);
    try {
      let template = templateHtml;
      if (!template) {
        const response = await fetch('/plan-template.html');
        if (!response.ok) throw new Error('读取模板失败');
        template = await response.text();
        setTemplateHtml(template);
      }

      const html = buildPlanHtml(template, selectedItems, currentMonthKey, selectedAreaId);
      setPlanHtml(html);
      setPlanOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成計画資料失败';
      setPlanError(message);
    } finally {
      setCreatingPlan(false);
    }
  };

  const handleSavePdf = () => {
    if (!selectedAreaId) return;
    const iframe = planPreviewIframeRef.current;
    const liveRoot = iframe?.contentDocument?.documentElement;
    const htmlToPrint = liveRoot
      ? `<!DOCTYPE html>\n${liveRoot.outerHTML}`
      : planHtml;
    const updated = addToHistory({
      type: 'plan',
      areaId: selectedAreaId,
      monthKey: currentMonthKey,
      title: getPlanPdfFilename(currentMonthKey, selectedAreaId),
      htmlContent: htmlToPrint,
    });
    setHtmlHistory(updated);
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setPlanError('浏览器阻止了弹窗，请允许后重试。');
      return;
    }
    previewWindow.document.open();
    previewWindow.document.write(htmlToPrint);
    previewWindow.document.close();
    previewWindow.document.title = getPlanPdfFilename(currentMonthKey, selectedAreaId);
    previewWindow.focus();
    previewWindow.print();
  };

  const handleCreateReport = async () => {
    if (!selectedAreaId) return;
    if (selectedItems.length === 0) {
      setReportError('请至少选择一条记录后再生成结果报告。');
      return;
    }

    setCreatingReport(true);
    setReportError(null);
    try {
      let template = reportTemplateHtml;
      if (!template) {
        const response = await fetch('/report-template.html');
        if (!response.ok) throw new Error('读取报告模板失败');
        template = await response.text();
        setReportTemplateHtml(template);
      }

      const html = buildResultReportHtml(template, selectedItems, currentMonthKey, selectedAreaId);
      setReportHtml(html);
      setReportOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成结果报告失败';
      setReportError(message);
    } finally {
      setCreatingReport(false);
    }
  };

  const handleSaveReportPdf = () => {
    if (!selectedAreaId) return;
    const iframe = reportPreviewIframeRef.current;
    const liveRoot = iframe?.contentDocument?.documentElement;
    const htmlToPrint = liveRoot
      ? `<!DOCTYPE html>\n${liveRoot.outerHTML}`
      : reportHtml;
    const updated = addToHistory({
      type: 'report',
      areaId: selectedAreaId,
      monthKey: currentMonthKey,
      title: getReportPdfFilename(currentMonthKey, selectedAreaId),
      htmlContent: htmlToPrint,
    });
    setHtmlHistory(updated);
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setReportError('浏览器阻止了弹窗，请允许后重试。');
      return;
    }
    previewWindow.document.open();
    previewWindow.document.write(htmlToPrint);
    previewWindow.document.close();
    previewWindow.document.title = getReportPdfFilename(currentMonthKey, selectedAreaId);
    previewWindow.focus();
    previewWindow.print();
  };

  const goToAreaList = () => {
    setSelectedAreaId(null);
    setItems([]);
    setError(null);
    setActiveMonthTab('');
    setCheckedMap({});
    setPlanError(null);
    setReportError(null);
    setResultDraftMap({});
    setSavingResultMap({});
    setResultSaveNoticeMap({});
    setEditingResultItemId(null);
  };

  return (
    <>
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
        >
          首页
        </button>
        <span className="text-neutral-400">{'>>'}</span>
        {selectedArea ? (
          <button
            type="button"
            onClick={goToAreaList}
            className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
          >
            测试中心
          </button>
        ) : (
          <span className="text-neutral-900 font-medium">测试中心</span>
        )}
        {selectedArea && (
          <>
            <span className="text-neutral-400">{'>>'}</span>
            {editingResultItem ? (
              <button
                type="button"
                onClick={() => setEditingResultItemId(null)}
                className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
              >
                {selectedArea.title.replace(/エリア$/, '')}
              </button>
            ) : (
              <span className="text-neutral-900 font-medium">
                {selectedArea.title.replace(/エリア$/, '')}
              </span>
            )}
          </>
        )}
        {editingResultItem && (
          <>
            <span className="text-neutral-400">{'>>'}</span>
            <span
              className="text-neutral-900 font-medium"
              title={editingResultItem.projectName || '-'}
            >
              {(() => {
                const name = editingResultItem.projectName || '-';
                return name.length > 8 ? `${name.slice(0, 8)}...` : name;
              })()}
            </span>
          </>
        )}
      </nav>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-neutral-900">
            {editingResultItem ? '案件詳細' : '测试中心管理画面'}
          </h2>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            <History size={15} />
            履歴
            {htmlHistory.length > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-neutral-900 text-white text-[10px] font-bold w-4 h-4">
                {htmlHistory.length > 9 ? '9+' : htmlHistory.length}
              </span>
            )}
          </button>
        </div>
        <p className="text-neutral-500">
          {editingResultItem
            ? editingResultItem.projectName || '-'
            : selectedArea
              ? `${selectedArea.title} - 进捗列表`
              : '请按区域进入对应测试管理模块。'}
        </p>
      </div>

      {selectedArea ? (
        <div className="space-y-4">
          {loading && (
            <div className="bg-white border border-neutral-200 rounded-xl p-8 flex items-center justify-center gap-2 text-neutral-500">
              <Loader2 size={18} className="animate-spin" />
              正在加载 Notion 数据...
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
              <AlertCircle size={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="bg-white border border-neutral-200 rounded-xl p-8 text-sm text-neutral-500">
              暂无符合条件的数据。
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            editingResultItem ? (
              <div className="space-y-4">
                <section className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-5">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">案件名</p>
                    <p className="text-base font-semibold text-neutral-900 mt-1">{editingResultItem.projectName || '-'}</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">Test総件数</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).testTotalCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'testTotalCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder="请输入"
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">NG数</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).bugCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'bugCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder="请输入"
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">Test不可</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).testBlockedCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'testBlockedCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder="请输入"
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">判断不可/想定外件数</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).pendingConfirmCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'pendingConfirmCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder="请输入"
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleSaveResultToNotion(editingResultItem)}
                      disabled={!!savingResultMap[editingResultItem.id]}
                      className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed"
                    >
                      {savingResultMap[editingResultItem.id] ? <Loader2 size={14} className="animate-spin" /> : null}
                      保存到Notion
                    </button>
                    {resultSaveNoticeMap[editingResultItem.id] && (
                      <span
                        className={`text-xs ${
                          resultSaveNoticeMap[editingResultItem.id].type === 'success' ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {resultSaveNoticeMap[editingResultItem.id].message}
                      </span>
                    )}
                  </div>
                </section>
              </div>
            ) : (
            <div className="space-y-4">
              {monthGroups.length > 0 && (
                <div className="bg-white border border-neutral-200 rounded-xl p-3 flex flex-wrap gap-2">
                  {monthGroups.map((group) => {
                    const isActive = (activeMonthTab || monthGroups[0].month) === group.month;
                    return (
                      <button
                        key={group.month}
                        type="button"
                        onClick={() => setActiveMonthTab(group.month)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                      >
                        {group.month}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-sm text-neutral-600">
                  件数：<span className="font-semibold text-neutral-900">{currentItems.length}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {areaResultReady && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      测试结果已出
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCreatePlan}
                    disabled={creatingPlan || selectedItems.length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingPlan ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    計画資料
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateReport}
                    disabled={creatingReport || selectedItems.length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingReport ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    结果报告
                  </button>
                </div>
              </div>

              {planError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span className="text-sm">{planError}</span>
                </div>
              )}

              {reportError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span className="text-sm">{reportError}</span>
                </div>
              )}

              {currentItems.map((item) => (
                <section
                  key={item.id}
                  className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={!!checkedMap[item.id]}
                      onChange={(e) =>
                        setCheckedMap((prev) => ({
                          ...prev,
                          [item.id]: e.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
                    />
                    <div className="grid flex-1 grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                      {renderField('月次', item.month)}
                      <div className="space-y-1">
                        <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">案件名</p>
                        <button
                          type="button"
                          onClick={() => setEditingResultItemId(item.id)}
                          className="text-sm text-left text-blue-600 hover:text-blue-700 hover:underline break-all"
                        >
                          {item.projectName || '-'}
                        </button>
                      </div>
                      {renderField('状態', item.status)}
                      {renderField('見積総', item.estimateTotal)}
                      {renderField('実績総', item.actualTotal)}
                    </div>
                  </div>
                </section>
              ))}
            </div>
            )
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {AREAS.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => loadAreaData(area.id)}
              className="bg-white border border-neutral-200 rounded-xl p-6 shadow-sm space-y-4 text-left hover:border-neutral-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center">
                  {area.icon}
                </div>
                <h3 className="text-lg font-bold text-neutral-900">{area.title}</h3>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">{area.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
    {planOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8">
        <div className="h-full max-w-7xl mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900">計画資料</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSavePdf}
                className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
              >
                保存为PDF
              </button>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <iframe
              ref={planPreviewIframeRef}
              title="plan-preview"
              srcDoc={planHtml}
              className="w-full flex-1 min-h-[260px] bg-white border-0"
            />
          </div>
        </div>
      </div>
    )}
    {reportOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8">
        <div className="h-full max-w-7xl mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900">结果报告</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveReportPdf}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500"
              >
                保存为PDF
              </button>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <iframe ref={reportPreviewIframeRef} title="report-preview" srcDoc={reportHtml} className="w-full h-full bg-white border-0" />
          </div>
        </div>
      </div>
    )}
    {historyOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8 flex items-start justify-center overflow-auto">
        <div className="w-full max-w-3xl bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={18} className="text-neutral-600" />
              <h3 className="text-base font-semibold text-neutral-900">HTML 保存履歴</h3>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              关闭
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {htmlHistory.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 text-sm">
                まだ履歴がありません。PDFを保存すると自動的に記録されます。
              </div>
            ) : (
              <div className="space-y-2">
                {htmlHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50"
                  >
                    <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      entry.type === 'plan'
                        ? 'bg-neutral-100 text-neutral-700 border border-neutral-300'
                        : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    }`}>
                      {entry.type === 'plan' ? '計画' : '報告'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-800 truncate">{entry.title}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {new Date(entry.savedAt).toLocaleString('ja-JP', {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setHistoryPreviewId(entry.id); setHistoryOpen(false); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-100 transition-colors"
                      >
                        <Eye size={13} />
                        プレビュー
                      </button>
                      <button
                        type="button"
                        onClick={() => setHtmlHistory(deleteFromHistory(entry.id))}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-100 text-xs text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    {historyPreviewId && (() => {
      const entry = htmlHistory.find((e) => e.id === historyPreviewId);
      if (!entry) return null;
      return (
        <div className="fixed inset-0 z-[60] bg-black/40 p-4 md:p-8">
          <div className="h-full max-w-7xl mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  entry.type === 'plan'
                    ? 'bg-neutral-100 text-neutral-700 border border-neutral-300'
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                }`}>
                  {entry.type === 'plan' ? '計画' : '報告'}
                </span>
                <p className="text-sm font-semibold text-neutral-800 truncate">{entry.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const win = window.open('', '_blank');
                    if (win) {
                      win.document.open();
                      win.document.write(entry.htmlContent);
                      win.document.close();
                      win.document.title = entry.title;
                      win.focus();
                      win.print();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
                >
                  再保存PDF
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryPreviewId(null); setHistoryOpen(true); }}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  戻る
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                title="history-preview"
                srcDoc={entry.htmlContent}
                className="w-full h-full bg-white border-0"
              />
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );
}
