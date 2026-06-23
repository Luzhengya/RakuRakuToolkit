import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Building2,
  ChevronDown,
  Eye,
  Globe2,
  History,
  Landmark,
  Loader2,
  FileText,
  RefreshCw,
  School,
  Smartphone,
  BookOpen,
  Trash2,
  Users,
  Briefcase,
  Calendar,
  Languages,
  ArrowLeft,
  ArrowRight,
  Cloud,
} from 'lucide-react';
import { type Lang, createT } from '../i18n/testcenter';
import MonthlyReport from './MonthlyReport';
import BugList from './BugList';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';

type TestCenterProps = {
  onBack: () => void;
};

type AreaId = 'jmotto' | 'univ' | 'credit' | 'overseas' | 'jmotto-app' | 'univ-app' | 'univ-contents' | 'nayose' | 'gyoshu' | 'ros' | 'meikancho';

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
  actualStartDate: string;
  actualDesignCompleteDate: string;
  actualExecutionCompleteDate: string;
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

type OverviewItem = {
  id: string;
  areaId: AreaId;
  month: string;
  status: string;
  projectName: string;
  bugCount: string;
  testTotalCount: string;
};

const OVERVIEW_CACHE_KEY = 'testcenter:overview:v1';

type OverviewCache = {
  items: OverviewItem[];
  updatedAt: number;
};

function loadOverviewCache(): OverviewCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.updatedAt !== 'number') return null;
    return parsed as OverviewCache;
  } catch {
    return null;
  }
}

function saveOverviewCache(cache: OverviewCache) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage 不可用时静默失败，保留内存状态
  }
}

const AREA_CACHE_KEY_PREFIX = 'testcenter:area:';
const AREA_CACHE_KEY_SUFFIX = ':v1';

type AreaCache = {
  items: ProgressItem[];
  updatedAt: number;
};

function loadAreaCache(areaId: AreaId): AreaCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${AREA_CACHE_KEY_PREFIX}${areaId}${AREA_CACHE_KEY_SUFFIX}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.updatedAt !== 'number') return null;
    return parsed as AreaCache;
  } catch {
    return null;
  }
}

function saveAreaCache(areaId: AreaId, cache: AreaCache) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${AREA_CACHE_KEY_PREFIX}${areaId}${AREA_CACHE_KEY_SUFFIX}`, JSON.stringify(cache));
  } catch {
    // 配额满/隐私模式静默失败
  }
}

function formatUpdatedAt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}

function replaceToken(source: string, token: string, value: string): string {
  return source.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
}

function getDefaultTestEnvironmentHtml(areaId: AreaId): string {
  const byArea: Record<AreaId, string[]> = {
    jmotto: [
      '☑ [ブラウザ] Chrome（149.0.7827.156）',
      '☑ [ポータル] https://www1-v2stg100.j-motto.co.jp/web/doLogin',
      '☑ [ GW ] https://gws85.j-motto.co.jp/cgi-bin/',
      '□ [ポータル申込画面] https://www1-v2stg100.j-motto.co.jp/web2/entrRegist',
      '☑ [ J H ] http://172.18.3.205/login',
      '□ [ WPDL ] https://www1-v2stg101.j-motto.co.jp/00000000/wp/',
    ],
    univ: [
      '☑ [ブラウザ] Chrome (149.0.7827.156)',
      '☑ [ スマホ ] IOS26.1 ｜ android16',
      '☑ [ UNIV2 ] https://54.64.96.104/login',
      '☑ [内部システム] https://testweb3.cybaxuniv.com/admin/sys_login',
    ],
    credit: [
      '☑ [ブラウザ] Chrome (149.0.7827.156)',
      '☑ [利用者] https://test-alb.kigyo-joho.com/login/1DCCyG3Xe1',
      '☑ [管理者] http://10.240.14.166/login/',
    ],
    overseas: [
      '☑ [ChromeVersion] 149.0.7827.156',
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
      '☑ [ブラウザ] Chrome (149.0.7827.156)',
      '☑ [ スマホ ] IOS26.1 ｜ android16',
      '☑ [ スマホ ] IOS18 ｜ android12（比較バージョン）',
      '☑ [ UNIVコンテンツ ] https://www.cybaxuniv.com/',
      '☑ [ UNIV２ ] https://54.64.96.104/login',
    ],
    'nayose': [
      '☑ [ブラウザ] Chrome（149.0.7827.156）',
      '☑ [URL] https://test-nayose.riskmonster.net/login',
      '☑ [URL] http://172.26.4.109:8080/rismon_ukeire/',
    ],
    'gyoshu': [
      '☑ Chrome（149.0.7827.156）',
      '☑ IOS26.1.0（iphone13）',
      '☑ Android16（Pixel 6A）',
      '☑ https://test-gyoushu.riskmonster.net/',
    ],
    'ros': [
      '☑ [ブラウザ] Chrome（149.0.7827.156）',
      '☑ [URL] http://10.240.14.201:8080/mkt/login.html',
    ],
    'meikancho': [
      '☑ [ブラウザ] Chrome（149.0.7827.156）',
      '☑ [URL] （名館長クラウドのテストURLを入力してください）',
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
  'meikancho': {
    releaseNameJa: '名館長クラウド',
    planFileNamePrefix: '名館長クラウド',
    svnPathSegment: '名館長クラウド',
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
  html = replaceToken(html, '{{開発工数総計}}', fmtNum(totalDevelopment));
  html = replaceToken(html, '{{見積工数総計}}', fmtNum(totalEstimate));
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

  const completedItems = selectedItems.filter(item => item.status === '予定通り完了');
  const inProgressItems = selectedItems.filter(item => item.status !== '予定通り完了');

  const first = selectedItems[0];
  const yyyy = monthKey.slice(0, 4);
  const mm = monthKey.slice(4, 6);
  const areaMeta = AREA_DOC_META[areaId];
  const tcDesign = first.tcDesignCompleteDate || '';
  const tcExec = first.tcExecutionCompleteDate || '';

  const totalTestCount = completedItems.reduce((sum, item) => sum + parseNumber(item.testTotalCount), 0);
  const totalBugCount = completedItems.reduce((sum, item) => sum + parseNumber(item.bugCount), 0);
  const totalBlockedCount = completedItems.reduce((sum, item) => sum + parseNumber(item.testBlockedCount), 0);
  const totalPendingCount = completedItems.reduce((sum, item) => sum + parseNumber(item.pendingConfirmCount), 0);
  const totalEstimateEffort = completedItems.reduce((sum, item) => sum + parseNumber(item.estimateTotal), 0);
  const totalActualEffort = completedItems.reduce((sum, item) => sum + parseNumber(item.actualTotal), 0);
  const totalEffortDiff = parseFloat((totalActualEffort - totalEstimateEffort).toFixed(2));
  const totalEstimateEffortStr = fmtNum(totalEstimateEffort);
  const totalActualEffortStr = fmtNum(totalActualEffort);

  const projectListHtml = selectedItems
    .map((item) => {
      const badge = item.status !== '予定通り完了'
        ? ' <span style="background:#fef3c7;color:#b45309;font-size:11px;font-weight:600;padding:1px 8px;border-radius:9999px;margin-left:6px;">実施中</span>'
        : '';
      return `<li>${safeHtml(item.projectName || '-')}${badge}</li>`;
    })
    .join('\n');

  const resultCardsHtml = completedItems
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

  const effortProjectBlocksHtml = completedItems
    .map((item) => {
      const estimate = parseNumber(item.estimateTotal);
      const actual = parseNumber(item.actualTotal);
      const diff = parseFloat((actual - estimate).toFixed(2));

      // 工数差分 > 2 の場合のみ工数説明行を追加
      const effortNoteRow = diff > 2
        ? `<tr><th style="color:#b91c1c;">工数差分説明</th><td contenteditable="true" style="color:#b91c1c;min-width:200px;">差分が${fmtNum(diff)}人日を超えています。理由を記入してください。</td></tr>`
        : '';

      return `
      <div class="effort-project-block">
        <div class="effort-project-title">${safeHtml(item.projectName || '-')}</div>
        <table class="effort-project-table">
          <tbody>
            <tr><th>開発工数</th><td>${safeHtml(item.developmentEffort || '0')}</td></tr>
            <tr><th>見積工数</th><td>${fmtNum(estimate)}</td></tr>
            <tr><th>実績工数</th><td>${fmtNum(actual)}</td></tr>
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
  const totalEffortDiffLabel = totalEffortDiff > 0 ? `+${fmtNum(totalEffortDiff)}` : fmtNum(totalEffortDiff);

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
  html = replaceToken(html, '{{ESTIMATE_TOTAL_EFFORT}}', totalEstimateEffortStr);
  html = replaceToken(html, '{{ACTUAL_TOTAL_EFFORT}}', totalActualEffortStr);
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

// ---- HTML 保存履歴 (Notion 后端持久化) ----

type HtmlHistory = {
  id: string;
  type: 'plan' | 'report';
  areaId: string;
  monthKey: string;
  title: string;
  htmlContent?: string; // 列表接口不返回；预览/打印前按需懒加载
  savedAt: string;
};

// 旧版本本地存储 key，仅用于一次性迁移到后端
const LEGACY_HISTORY_STORAGE_KEY = 'testcenter-html-history';

function loadLegacyLocalHistory(): HtmlHistory[] {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HtmlHistory[]) : [];
  } catch {
    return [];
  }
}

function clearLegacyLocalHistory(): void {
  try { localStorage.removeItem(LEGACY_HISTORY_STORAGE_KEY); } catch { /* ignore */ }
}

async function apiFetchHistory(): Promise<HtmlHistory[]> {
  const res = await fetch('/api/test-center/history');
  if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
  const data = await res.json();
  return (data.items ?? []) as HtmlHistory[];
}

async function apiFetchHistoryEntry(id: string): Promise<HtmlHistory> {
  const res = await fetch(`/api/test-center/history/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load entry (${res.status})`);
  return (await res.json()) as HtmlHistory;
}

async function apiCreateHistory(entry: HtmlHistory): Promise<void> {
  const res = await fetch('/api/test-center/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Failed to save history (${res.status})`);
}

async function apiDeleteHistory(id: string): Promise<void> {
  const res = await fetch(`/api/test-center/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete history (${res.status})`);
}

function newEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function KpiInline({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <span className="text-base font-bold text-neutral-900">
        {value.toLocaleString()}{suffix ? <span className="text-xs font-normal text-neutral-500 ml-0.5">{suffix}</span> : null}
      </span>
    </div>
  );
}

function DashboardCard({ title, iconColor, badge, children, onClick, actionHint }: { title: string; iconColor: string; badge?: string; children: ReactNode; onClick?: () => void; actionHint?: string }) {
  return (
    <section
      onClick={onClick}
      className={`bg-white border border-neutral-200 rounded-xl p-4 shadow-sm ${onClick ? 'cursor-pointer hover:border-neutral-300 hover:shadow-md transition-all' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-sm ${iconColor}`} />
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        </div>
        {actionHint ? (
          <span className="text-[11px] text-blue-500 font-medium">{actionHint}</span>
        ) : (
          badge && <span className="text-[11px] text-neutral-400 font-medium">{badge}</span>
        )}
      </div>
      {children}
    </section>
  );
}

const STATUS_PALETTE: Record<string, string> = {
  '完了': '#10b981',
  '進行中': '#3b82f6',
  'ブロック': '#ef4444',
  '未着手': '#cbd5e1',
};

function getStatusColor(status: string, fallbackIdx: number): string {
  if (STATUS_PALETTE[status]) return STATUS_PALETTE[status];
  const fallback = ['#a855f7', '#f59e0b', '#14b8a6', '#f43f5e', '#64748b'];
  return fallback[fallbackIdx % fallback.length];
}

function StatusDonut({ data, noDataLabel, caseLabel }: { data: { status: string; count: number }[]; noDataLabel: string; caseLabel: string }) {
  const total = data.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) {
    return <p className="text-xs text-neutral-400 py-10 text-center">{noDataLabel}</p>;
  }
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-28 h-28 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius={36}
              outerRadius={52}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
            >
              {data.map((row, idx) => (
                <Cell key={row.status} fill={getStatusColor(row.status, idx)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-neutral-900 leading-none">{total}</span>
          <span className="text-[10px] text-neutral-400 mt-0.5">{caseLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 text-xs">
        {data.map((row, idx) => (
          <div key={row.status} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getStatusColor(row.status, idx) }} />
            <span className="text-neutral-600 flex-1 truncate">{row.status}</span>
            <span className="font-semibold text-neutral-800">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Gantt Chart View ──

type GanttViewProps = {
  lang: Lang;
  onBack: () => void;
  onHome: () => void;
  loadAreaCache: (id: AreaId) => { items: ProgressItem[] } | null;
  fetchArea: (id: AreaId) => Promise<ProgressItem[]>;
  targetMonthKeySet: Set<string>;
};

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type GanttRow = ProgressItem & { _areaId: AreaId; _areaLabel: string };

function GanttView({ lang, onBack, onHome, loadAreaCache, fetchArea, targetMonthKeySet }: GanttViewProps) {
  const [allItems, setAllItems] = useState<GanttRow[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useMemo(() => createT(lang), [lang]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results: GanttRow[] = [];
      await Promise.all(AREAS.map(async (area) => {
        const cache = loadAreaCache(area.id);
        let items: ProgressItem[];
        if (cache) {
          items = cache.items;
        } else {
          try { items = await fetchArea(area.id); } catch { items = []; }
        }
        const label = area.title[lang].replace(/エリア$|区域$/, '');
        for (const it of items) {
          results.push({ ...it, _areaId: area.id, _areaLabel: label });
        }
      }));
      if (!cancelled) {
        setAllItems(results);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  const filtered = useMemo(
    () => allItems.filter((it) => targetMonthKeySet.has(toMonthKey(it.month))),
    [allItems, targetMonthKeySet]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { areaId: AreaId; label: string; items: GanttRow[] }>();
    for (const it of filtered) {
      let group = map.get(it._areaId);
      if (!group) { group = { areaId: it._areaId, label: it._areaLabel, items: [] }; map.set(it._areaId, group); }
      group.items.push(it);
    }
    return Array.from(map.values());
  }, [filtered]);

  const { minDate, maxDate } = useMemo(() => {
    const allDates: Date[] = [];
    for (const it of filtered) {
      for (const f of [it.tcStartDate, it.tcDesignCompleteDate, it.tcExecutionCompleteDate, it.actualStartDate, it.actualDesignCompleteDate, it.actualExecutionCompleteDate]) {
        const d = parseDate(f);
        if (d) allDates.push(d);
      }
    }
    if (allDates.length === 0) {
      const now = new Date();
      return { minDate: now, maxDate: new Date(now.getTime() + 30 * 86400000) };
    }
    const sorted = allDates.sort((a, b) => a.getTime() - b.getTime());
    return { minDate: new Date(sorted[0].getTime() - 3 * 86400000), maxDate: new Date(sorted[sorted.length - 1].getTime() + 3 * 86400000) };
  }, [filtered]);

  const toPct = useCallback((d: Date) => {
    const range = maxDate.getTime() - minDate.getTime();
    if (range <= 0) return 50;
    return ((d.getTime() - minDate.getTime()) / range) * 100;
  }, [minDate, maxDate]);

  const monthTicks = useMemo(() => {
    const ticks: { date: Date; label: string }[] = [];
    const cur = new Date(minDate);
    cur.setDate(1);
    if (cur < minDate) cur.setMonth(cur.getMonth() + 1);
    while (cur <= maxDate) {
      ticks.push({ date: new Date(cur), label: `${cur.getMonth() + 1}月` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return ticks;
  }, [minDate, maxDate]);

  const renderSegments = (startStr: string, midStr: string, endStr: string, color1: string, color2: string, labelPrefix: string) => {
    const s = parseDate(startStr);
    const m = parseDate(midStr);
    const e = parseDate(endStr);
    if (!s && !m && !e) return null;
    const segments: ReactNode[] = [];
    const effectiveEnd = e || m || s;
    const effectiveStart = s || m || e;
    if (effectiveStart && effectiveEnd) {
      if (m) {
        const left = Math.max(0, toPct(effectiveStart));
        const right = Math.min(100, toPct(m));
        if (right > left) {
          segments.push(
            <div key="design" className="absolute top-0.5 h-4 rounded-l" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.3)}%`, backgroundColor: color1, minWidth: '3px' }} title={`${labelPrefix}(設計): ${fmtShortDate(effectiveStart)} ~ ${fmtShortDate(m)}`} />
          );
        }
        if (e) {
          const left2 = Math.max(0, toPct(m));
          const right2 = Math.min(100, toPct(e));
          if (right2 > left2) {
            segments.push(
              <div key="exec" className="absolute top-0.5 h-4 rounded-r" style={{ left: `${left2}%`, width: `${Math.max(right2 - left2, 0.3)}%`, backgroundColor: color2, minWidth: '3px' }} title={`${labelPrefix}(実施): ${fmtShortDate(m)} ~ ${fmtShortDate(e)}`} />
            );
          }
        }
      } else {
        const left = Math.max(0, toPct(effectiveStart));
        const right = Math.min(100, toPct(effectiveEnd));
        if (right > left || (s && e)) {
          segments.push(
            <div key="full" className="absolute top-0.5 h-4 rounded" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.3)}%`, backgroundColor: color2, minWidth: '3px' }} title={`${labelPrefix}: ${fmtShortDate(effectiveStart)} ~ ${fmtShortDate(effectiveEnd)}`} />
          );
        }
      }
    }
    return segments.length > 0 ? <div className="relative h-5">{segments}</div> : null;
  };

  const todayPct = toPct(new Date());

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-sm text-neutral-500">
        <button type="button" onClick={onHome} className="hover:text-neutral-900">{lang === 'zh' ? '首页' : 'ホーム'}</button>
        <span>&gt;&gt;</span>
        <button type="button" onClick={onBack} className="hover:text-neutral-900">TestCenter</button>
        <span>&gt;&gt;</span>
        <span className="text-neutral-900 font-medium">{lang === 'zh' ? '案件进度甘特图' : '案件スケジュール'}</span>
      </nav>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-xl font-bold text-neutral-900">{lang === 'zh' ? '案件进度甘特图' : '案件スケジュール'}</h2>
        <span className="text-sm text-neutral-400">({filtered.length} {lang === 'zh' ? '件' : '件'})</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-neutral-400" size={28} /></div>
      ) : filtered.length === 0 ? (
        <p className="text-neutral-400 text-center py-16">{t('noData')}</p>
      ) : (
        <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto">
            <div style={{ minWidth: '900px' }}>
              {/* Header */}
              <div className="flex border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                <div className="w-52 shrink-0 px-4 py-2.5 border-r border-neutral-200">{lang === 'zh' ? '案件名' : '案件名'}</div>
                <div className="w-16 shrink-0 px-2 py-2.5 border-r border-neutral-200 text-center">{lang === 'zh' ? '区分' : '区分'}</div>
                <div className="w-16 shrink-0 px-2 py-2.5 border-r border-neutral-200 text-right">{lang === 'zh' ? '工数' : '工数'}</div>
                <div className="flex-1 relative py-2.5 px-2">
                  <div className="flex justify-between text-[10px] text-neutral-400">
                    {monthTicks.map((tick, i) => (
                      <span key={i} style={{ position: 'absolute', left: `${toPct(tick.date)}%`, transform: 'translateX(-50%)' }}>{tick.label}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Groups */}
              {grouped.map((group) => (
                <div key={group.areaId}>
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-neutral-100 border-b border-neutral-200">
                    <span className="text-[12px] font-bold text-neutral-700">{group.label}</span>
                    <span className="text-[11px] text-neutral-400">({group.items.length}{lang === 'zh' ? '件' : '件'})</span>
                  </div>
                  {group.items.map((it, idx) => (
                    <div key={it.id} className={`flex border-b border-neutral-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'}`}>
                      <div className="w-52 shrink-0 px-4 py-2 border-r border-neutral-100 text-[13px] text-neutral-800 font-medium truncate" title={it.projectName}>
                        {it.projectName || '-'}
                      </div>
                      <div className="w-16 shrink-0 border-r border-neutral-100">
                        <div className="px-1 py-0.5 text-[10px] text-blue-600 text-center">予定</div>
                        <div className="px-1 py-0.5 text-[10px] text-emerald-600 text-center">実績</div>
                      </div>
                      <div className="w-16 shrink-0 border-r border-neutral-100 text-right">
                        <div className="px-2 py-0.5 text-[11px] text-neutral-600">{fmtNum(parseNumber(it.estimateTotal))}</div>
                        <div className="px-2 py-0.5 text-[11px] text-neutral-600">{fmtNum(parseNumber(it.actualTotal))}</div>
                      </div>
                      <div className="flex-1 relative px-1 py-0.5">
                        {monthTicks.map((tick, i) => (
                          <div key={i} className="absolute top-0 bottom-0 border-l border-neutral-100" style={{ left: `${toPct(tick.date)}%` }} />
                        ))}
                        {todayPct >= 0 && todayPct <= 100 && (
                          <div className="absolute top-0 bottom-0 border-l-2 border-red-400 z-10" style={{ left: `${todayPct}%` }} title={lang === 'zh' ? '今日' : '今日'} />
                        )}
                        {renderSegments(it.tcStartDate, it.tcDesignCompleteDate, it.tcExecutionCompleteDate, '#93c5fd', '#3b82f6', '予定') || <div className="h-5 flex items-center text-[10px] text-neutral-300">-</div>}
                        {renderSegments(it.actualStartDate, it.actualDesignCompleteDate, it.actualExecutionCompleteDate, '#86efac', '#22c55e', '実績') || <div className="h-5 flex items-center text-[10px] text-neutral-300">-</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 px-4 py-3 border-t border-neutral-200 bg-neutral-50 text-[11px] text-neutral-500">
            <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: '#93c5fd' }} />予定(設計)</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />予定(実施)</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: '#86efac' }} />実績(設計)</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} />実績(実施)</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-red-400" />{lang === 'zh' ? '今日' : '今日'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const AREAS = [
  {
    id: 'jmotto' as AreaId,
    title: { zh: 'jmotto区域', ja: 'jmottoエリア' },
    description: { zh: '用于 jmotto 相关测试项的统一管理。', ja: 'jmotto関連テスト項目の統一管理。' },
    icon: <School className="text-blue-600" size={22} />
  },
  {
    id: 'univ' as AreaId,
    title: { zh: 'UNIV区域', ja: 'UNIVエリア' },
    description: { zh: '用于 UNIV 相关测试项的统一管理。', ja: 'UNIV関連テスト項目の統一管理。' },
    icon: <Landmark className="text-violet-600" size={22} />
  },
  {
    id: 'credit' as AreaId,
    title: { zh: '企業信用情報区域', ja: '企業信用情報エリア' },
    description: { zh: '用于企業信用情報测试任务的统一管理。', ja: '企業信用情報関連テスト項目の統一管理。' },
    icon: <Building2 className="text-amber-600" size={22} />
  },
  {
    id: 'overseas' as AreaId,
    title: { zh: '海外調書区域', ja: '海外調書エリア' },
    description: { zh: '用于海外調書测试任务的统一管理。', ja: '海外調書関連テスト項目の統一管理。' },
    icon: <Globe2 className="text-emerald-600" size={22} />
  },
  {
    id: 'jmotto-app' as AreaId,
    title: { zh: 'jmottoアプリ区域', ja: 'jmottoアプリエリア' },
    description: { zh: 'jmottoアプリ相关测试项的统一管理。', ja: 'jmottoアプリ関連のテスト項目を統一管理する。' },
    icon: <Smartphone className="text-blue-500" size={22} />
  },
  {
    id: 'univ-app' as AreaId,
    title: { zh: 'Univアプリ区域', ja: 'Univアプリエリア' },
    description: { zh: 'Univアプリ相关测试项的统一管理。', ja: 'Univアプリ関連のテスト項目を統一管理する。' },
    icon: <Smartphone className="text-violet-500" size={22} />
  },
  {
    id: 'univ-contents' as AreaId,
    title: { zh: 'UnivContents区域', ja: 'UnivContentsエリア' },
    description: { zh: 'UnivContents相关测试项的统一管理。', ja: 'UnivContents関連のテスト項目を統一管理する。' },
    icon: <BookOpen className="text-teal-600" size={22} />
  },
  {
    id: 'nayose' as AreaId,
    title: { zh: '名寄せアプリ区域', ja: '名寄せアプリエリア' },
    description: { zh: '名寄せアプリ相关测试项的统一管理。', ja: '名寄せアプリ関連のテスト項目を統一管理する。' },
    icon: <Users className="text-orange-500" size={22} />
  },
  {
    id: 'gyoshu' as AreaId,
    title: { zh: '業種別区域', ja: '業種別エリア' },
    description: { zh: '業種別審査ノート相关测试项的统一管理。', ja: '業種別審査ノート関連のテスト項目を統一管理する。' },
    icon: <Briefcase className="text-rose-500" size={22} />
  },
  {
    id: 'ros' as AreaId,
    title: { zh: '与信ROS区域', ja: '与信ROSエリア' },
    description: { zh: '与信ROS相关测试项的统一管理。', ja: '与信ROS関連のテスト項目を統一管理する。' },
    icon: <FileText className="text-cyan-600" size={22} />
  },
  {
    id: 'meikancho' as AreaId,
    title: { zh: '名館長クラウド区域', ja: '名館長クラウドエリア' },
    description: { zh: '名館長クラウド相关测试项的统一管理。', ja: '名館長クラウド関連のテスト項目を統一管理する。' },
    icon: <Cloud className="text-sky-600" size={22} />
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
  const historyPreviewIframeRef = useRef<HTMLIFrameElement>(null);
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
  const [htmlHistory, setHtmlHistory] = useState<HtmlHistory[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [historyPreviewId, setHistoryPreviewId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  // 仅在挂载时检查一次本地是否还有旧履历（迁移按钮的可见条件）
  const [hasLegacyHistory, setHasLegacyHistory] = useState<boolean>(() => loadLegacyLocalHistory().length > 0);
  const initialOverview = useMemo(() => loadOverviewCache(), []);
  const [overviewItems, setOverviewItems] = useState<OverviewItem[]>(initialOverview?.items ?? []);
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<number | null>(initialOverview?.updatedAt ?? null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const initialAreaUpdatedAtMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    const allAreaIds: AreaId[] = ['jmotto', 'univ', 'credit', 'overseas', 'jmotto-app', 'univ-app', 'univ-contents', 'nayose', 'gyoshu', 'ros', 'meikancho'];
    for (const id of allAreaIds) {
      const cache = loadAreaCache(id);
      if (cache) map[id] = cache.updatedAt;
    }
    return map;
  }, []);
  const [areaUpdatedAtMap, setAreaUpdatedAtMap] = useState<Record<string, number>>(initialAreaUpdatedAtMap);
  const [filterYear, setFilterYear] = useState<number>(() => new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<'all' | number>(() => new Date().getMonth() + 1);
  const [lang, setLang] = useState<Lang>('zh');
  const [monthlyReportOpen, setMonthlyReportOpen] = useState(false);
  const [bugListOpen, setBugListOpen] = useState(false);
  const [bugListInitialMonth, setBugListInitialMonth] = useState('');
  const [ganttOpen, setGanttOpen] = useState(false);
  const t = useMemo(() => createT(lang), [lang]);
  const targetMonthKeys = useMemo(() => getTargetMonthKeys(), []);
  const targetMonthKeySet = useMemo(() => new Set(targetMonthKeys), [targetMonthKeys]);

  // 結果報告の左側に表示する：このエリアの最新の計画資料HTML
  const latestPlanEntry = useMemo(
    () => htmlHistory.find((e) => e.type === 'plan' && e.areaId === selectedAreaId) ?? null,
    [htmlHistory, selectedAreaId]
  );

  // 履歴の HTML 本体を必要なタイミングで懶加载
  useEffect(() => {
    if (latestPlanEntry && latestPlanEntry.htmlContent === undefined) {
      ensureHistoryBody(latestPlanEntry.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPlanEntry?.id]);

  useEffect(() => {
    if (historyPreviewId) {
      ensureHistoryBody(historyPreviewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPreviewId]);

  // 履歴モーダル用フィルタ済みリスト
  const filteredHistory = useMemo(
    () => (historyShowAll || !selectedAreaId)
      ? htmlHistory
      : htmlHistory.filter((e) => e.areaId === selectedAreaId),
    [htmlHistory, historyShowAll, selectedAreaId]
  );

  const selectedArea = useMemo(
    () => AREAS.find((area) => area.id === selectedAreaId) ?? null,
    [selectedAreaId]
  );
  const isAreaSelected = !!selectedAreaId;

  const fetchAreaFromNotion = async (areaId: AreaId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/test-center?area=${areaId}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t('fetchFailed'));
      }
      const data = (await response.json()) as ApiResponse;
      const fetchedItems = data.items ?? [];
      const updatedAt = Date.now();
      setItems(fetchedItems);
      saveAreaCache(areaId, { items: fetchedItems, updatedAt });
      setAreaUpdatedAtMap((prev) => ({ ...prev, [areaId]: updatedAt }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('fetchFailed');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadAreaData = async (areaId: AreaId) => {
    setSelectedAreaId(areaId);
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

    const cache = loadAreaCache(areaId);
    if (cache) {
      setItems(cache.items);
      // 缓存里的 updatedAt 已经在 initialAreaUpdatedAtMap 里，无需再同步
      return;
    }

    await fetchAreaFromNotion(areaId);
  };

  const reloadAreaData = async () => {
    if (!selectedAreaId) return;
    await fetchAreaFromNotion(selectedAreaId);
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

  const fetchOverview = async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await fetch('/api/test-center/overview');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `${t('requestFailed')} (${response.status})`);
      }
      const data: { items: OverviewItem[] } = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const updatedAt = Date.now();
      setOverviewItems(items);
      setOverviewUpdatedAt(updatedAt);
      saveOverviewCache({ items, updatedAt });
    } catch (err) {
      setOverviewError((err as Error)?.message ?? t('overviewFetchFailed'));
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    // 首次进入：若 localStorage 已有缓存，直接用；否则才拉
    if (overviewUpdatedAt !== null) return;
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 履歴：首次挂载时从后端拉取元数据列表
  const loadHistoryList = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const items = await apiFetchHistory();
      setHtmlHistory(items);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistoryList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 履歴：懒加载某条记录的 HTML body（用于预览/打印/参考面板）
  const ensureHistoryBody = async (entryId: string) => {
    const target = htmlHistory.find((e) => e.id === entryId);
    if (!target || target.htmlContent !== undefined) return;
    try {
      const full = await apiFetchHistoryEntry(entryId);
      setHtmlHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, htmlContent: full.htmlContent ?? '' } : e)));
    } catch (err) {
      console.error('Failed to load history body:', err);
    }
  };

  // 履歴：把旧版本 localStorage 履历一次性上传到云端
  const handleMigrateLocalHistory = async () => {
    const legacy = loadLegacyLocalHistory();
    if (legacy.length === 0) {
      alert(t('migrateNothingToDo'));
      return;
    }
    setMigrating(true);
    try {
      for (const entry of legacy) {
        await apiCreateHistory({
          id: entry.id || newEntryId(),
          type: entry.type,
          areaId: entry.areaId,
          monthKey: entry.monthKey,
          title: entry.title,
          htmlContent: entry.htmlContent ?? '',
          savedAt: entry.savedAt || new Date().toISOString(),
        });
      }
      clearLegacyLocalHistory();
      setHasLegacyHistory(false);
      await loadHistoryList();
      alert(t('migrateSuccess'));
    } catch (err) {
      console.error('Migration failed:', err);
      alert(t('migrateFailed'));
    } finally {
      setMigrating(false);
    }
  };

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const item of overviewItems) {
      const key = toMonthKey(item.month);
      if (key) years.add(Number(key.slice(0, 4)));
    }
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [overviewItems]);

  const filteredOverview = useMemo(() => {
    return overviewItems.filter((item) => {
      const key = toMonthKey(item.month);
      if (!key) return false;
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(4, 6));
      if (y !== filterYear) return false;
      if (filterMonth !== 'all' && m !== filterMonth) return false;
      return true;
    });
  }, [overviewItems, filterYear, filterMonth]);

  const overviewKpi = useMemo(() => {
    const caseCount = filteredOverview.length;
    const bugTotal = filteredOverview.reduce((sum, item) => sum + parseNumber(item.bugCount), 0);
    const systemSet = new Set(filteredOverview.map((item) => item.areaId));
    return { caseCount, bugTotal, systemCount: systemSet.size };
  }, [filteredOverview]);

  const monthlyBugSeries = useMemo(() => {
    const buckets = new Map<number, number>();
    for (let m = 1; m <= 12; m++) buckets.set(m, 0);
    for (const item of overviewItems) {
      const key = toMonthKey(item.month);
      if (!key) continue;
      const y = Number(key.slice(0, 4));
      if (y !== filterYear) continue;
      const m = Number(key.slice(4, 6));
      buckets.set(m, (buckets.get(m) ?? 0) + parseNumber(item.bugCount));
    }
    return Array.from(buckets.entries()).map(([month, bug]) => ({ month, bug }));
  }, [overviewItems, filterYear]);

  const systemDistribution = useMemo(() => {
    const counts = new Map<AreaId, number>();
    for (const item of filteredOverview) counts.set(item.areaId, (counts.get(item.areaId) ?? 0) + 1);
    return AREAS
      .map((area) => ({
        areaId: area.id,
        label: area.title[lang].replace(/エリア$|区域$/, ''),
        count: counts.get(area.id) ?? 0,
      }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filteredOverview, lang]);

  const statusDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredOverview) {
      const status = (item.status || '未着手').trim() || '未着手';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
  }, [filteredOverview]);

  const areaStats = useMemo(() => {
    const map = new Map<AreaId, { caseCount: number; bugTotal: number; series: number[]; bugSeries: number[] }>();
    for (const area of AREAS) {
      map.set(area.id, { caseCount: 0, bugTotal: 0, series: Array(12).fill(0), bugSeries: Array(12).fill(0) });
    }
    for (const item of overviewItems) {
      const key = toMonthKey(item.month);
      if (!key) continue;
      const y = Number(key.slice(0, 4));
      if (y !== filterYear) continue;
      const m = Number(key.slice(4, 6));
      const slot = map.get(item.areaId);
      if (!slot) continue;
      const bug = parseNumber(item.bugCount);
      if (filterMonth === 'all' || m === filterMonth) {
        slot.caseCount += 1;
        slot.bugTotal += bug;
      }
      slot.series[m - 1] += 1;
      slot.bugSeries[m - 1] += bug;
    }
    return map;
  }, [overviewItems, filterYear, filterMonth]);

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

  // 履歴ボタンのバッジ件数：エリア + 月次で絞り込み（未選択時は全件）
  const historyBadgeCount = useMemo(() => {
    if (!selectedAreaId) return htmlHistory.length;
    return htmlHistory.filter(
      (e) => e.areaId === selectedAreaId && e.monthKey === currentMonthKey
    ).length;
  }, [htmlHistory, selectedAreaId, currentMonthKey]);

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
      [item.id]: { type: 'success', message: t('saving') },
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
        throw new Error(result?.error || data.error || t('saveToNotionFailed'));
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
        [item.id]: { type: 'success', message: t('savedToNotion') },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('saveToNotionFailed');
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
      setPlanError(t('planSelectRequired'));
      return;
    }

    setCreatingPlan(true);
    setPlanError(null);
    try {
      let template = templateHtml;
      if (!template) {
        const response = await fetch('/plan-template.html');
        if (!response.ok) throw new Error(t('templateReadFailed'));
        template = await response.text();
        setTemplateHtml(template);
      }

      const html = buildPlanHtml(template, selectedItems, currentMonthKey, selectedAreaId);
      setPlanHtml(html);
      setPlanOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : t('planGenerateFailed');
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
    const newEntry: HtmlHistory = {
      id: newEntryId(),
      type: 'plan',
      areaId: selectedAreaId,
      monthKey: currentMonthKey,
      title: getPlanPdfFilename(currentMonthKey, selectedAreaId),
      htmlContent: htmlToPrint,
      savedAt: new Date().toISOString(),
    };
    setHtmlHistory((prev) => [newEntry, ...prev]);
    apiCreateHistory(newEntry).catch((err) => {
      console.error('Save plan history failed:', err);
      setPlanError(err instanceof Error ? err.message : 'Save failed');
    });
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setPlanError(t('popupBlocked'));
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
      setReportError(t('reportSelectRequired'));
      return;
    }

    setCreatingReport(true);
    setReportError(null);
    try {
      let template = reportTemplateHtml;
      if (!template) {
        const response = await fetch('/report-template.html');
        if (!response.ok) throw new Error(t('reportTemplateReadFailed'));
        template = await response.text();
        setReportTemplateHtml(template);
      }

      const html = buildResultReportHtml(template, selectedItems, currentMonthKey, selectedAreaId);
      setReportHtml(html);
      setReportOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : t('reportGenerateFailed');
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
    const newEntry: HtmlHistory = {
      id: newEntryId(),
      type: 'report',
      areaId: selectedAreaId,
      monthKey: currentMonthKey,
      title: getReportPdfFilename(currentMonthKey, selectedAreaId),
      htmlContent: htmlToPrint,
      savedAt: new Date().toISOString(),
    };
    setHtmlHistory((prev) => [newEntry, ...prev]);
    apiCreateHistory(newEntry).catch((err) => {
      console.error('Save report history failed:', err);
      setReportError(err instanceof Error ? err.message : 'Save failed');
    });
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setReportError(t('popupBlocked'));
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

  const breadcrumb = (
    <nav className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
      >
        {t('home')}
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      {selectedArea ? (
        <button
          type="button"
          onClick={goToAreaList}
          className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
        >
          TestCenter
        </button>
      ) : (
        <span className="text-neutral-900 font-medium">TestCenter</span>
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
              {selectedArea.title[lang].replace(/エリア$|区域$/, '')}
            </button>
          ) : (
            <span className="text-neutral-900 font-medium">
              {selectedArea.title[lang].replace(/エリア$|区域$/, '')}
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
  );

  if (monthlyReportOpen) {
    return (
      <MonthlyReport
        lang={lang}
        onHome={onBack}
        onBack={() => setMonthlyReportOpen(false)}
      />
    );
  }

  if (bugListOpen) {
    return (
      <BugList
        lang={lang}
        onHome={onBack}
        onBack={() => { setBugListOpen(false); setBugListInitialMonth(''); }}
        initialMonth={bugListInitialMonth}
      />
    );
  }

  if (ganttOpen) {
    return (
      <GanttView
        lang={lang}
        onBack={() => setGanttOpen(false)}
        onHome={onBack}
        loadAreaCache={loadAreaCache}
        fetchArea={async (id: AreaId) => {
          const res = await fetch(`/api/test-center?area=${id}`);
          if (!res.ok) throw new Error('Failed to fetch');
          const data = (await res.json()) as ApiResponse;
          return data.items ?? [];
        }}
        targetMonthKeySet={targetMonthKeySet}
      />
    );
  }

  return (
    <>
    <div className="space-y-6">
      {breadcrumb}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-neutral-900">
            {editingResultItem ? t('caseDetail') : t('pageTitle')}
          </h2>
          <div className="flex items-center gap-2">
            {/* 语言切换 */}
            <button
              type="button"
              onClick={() => setLang((l) => l === 'zh' ? 'ja' : 'zh')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors select-none"
              title={lang === 'zh' ? '日本語に切替' : '切换为中文'}
            >
              <Languages size={13} />
              {lang === 'zh' ? '日本語' : '中文'}
            </button>
            {selectedAreaId && (
              <>
                {areaUpdatedAtMap[selectedAreaId] && (
                  <span className="text-[11px] text-neutral-400 leading-tight">
                    {t('lastUpdated')}<br />{formatUpdatedAt(areaUpdatedAtMap[selectedAreaId])}
                  </span>
                )}
                <button
                  type="button"
                  onClick={reloadAreaData}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={lang === 'zh' ? '从 Notion 重新拉取最新数据' : 'Notionから最新データを再取得'}
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  {t('update')}
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryShowAll(false); setHistoryOpen(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
                >
                  <History size={15} />
                  {t('btnHistory')}
                  {historyBadgeCount > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-neutral-900 text-white text-[10px] font-bold w-4 h-4">
                      {historyBadgeCount > 9 ? '9+' : historyBadgeCount}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-neutral-500">
          {editingResultItem
            ? editingResultItem.projectName || '-'
            : selectedArea
              ? `${selectedArea.title[lang]} - ${t('progressList')}`
              : t('pageSubtitle')}
        </p>
      </div>

      {selectedArea ? (
        <div className="space-y-4">
          {loading && (
            <div className="bg-white border border-neutral-200 rounded-xl p-8 flex items-center justify-center gap-2 text-neutral-500">
              <Loader2 size={18} className="animate-spin" />
              {t('loadingNotion')}
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
              {t('noMatchingData')}
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            editingResultItem ? (
              <div className="space-y-4">
                <section className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-5">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">{t('fieldCaseName')}</p>
                    <p className="text-base font-semibold text-neutral-900 mt-1">{editingResultItem.projectName || '-'}</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{t('fieldTestTotal')}</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).testTotalCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'testTotalCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder={t('inputPlaceholder')}
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{t('fieldNgCount')}</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).bugCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'bugCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder={t('inputPlaceholder')}
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{t('fieldTestBlocked')}</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).testBlockedCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'testBlockedCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder={t('inputPlaceholder')}
                      />
                    </label>
                    <label className="space-y-1">
                      <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{t('fieldPendingCount')}</p>
                      <input
                        type="text"
                        value={getResultDraft(editingResultItem).pendingConfirmCount}
                        onChange={(e) => updateResultDraft(editingResultItem.id, 'pendingConfirmCount', e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                        placeholder={t('inputPlaceholder')}
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
                      {t('btnSaveToNotion')}
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
                  {t('caseCount')}<span className="font-semibold text-neutral-900">{currentItems.length}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {areaResultReady && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      {t('resultReady')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCreatePlan}
                    disabled={creatingPlan || selectedItems.length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingPlan ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    {t('btnPlanDoc')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateReport}
                    disabled={creatingReport || selectedItems.length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingReport ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    {t('btnResultReport')}
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
                      {renderField(t('fieldMonth'), item.month)}
                      <div className="space-y-1">
                        <p className="text-[11px] tracking-wider uppercase text-neutral-400 font-semibold">{t('fieldCaseName')}</p>
                        <button
                          type="button"
                          onClick={() => setEditingResultItemId(item.id)}
                          className="text-sm text-left text-blue-600 hover:text-blue-700 hover:underline break-all"
                        >
                          {item.projectName || '-'}
                        </button>
                      </div>
                      {renderField(t('fieldStatus'), item.status)}
                      {renderField(t('fieldEstTotal'), item.estimateTotal)}
                      {renderField(t('fieldActTotal'), item.actualTotal)}
                    </div>
                  </div>
                </section>
              ))}
            </div>
            )
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 顶部筛选 + KPI */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(Number(e.target.value))}
                  className="appearance-none bg-white border border-neutral-200 rounded-lg pl-9 pr-8 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
                <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select
                  value={filterMonth === 'all' ? 'all' : String(filterMonth)}
                  onChange={(e) => setFilterMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="appearance-none bg-white border border-neutral-200 rounded-lg px-3 pr-8 py-1.5 text-sm font-medium text-neutral-700 focus:outline-none focus:border-neutral-400"
                >
                  <option value="all">{t('filterAllMonth')}</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </div>
            </div>
            <button
              type="button"
              onClick={fetchOverview}
              disabled={overviewLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={overviewUpdatedAt ? `${t('lastUpdated')}：${formatUpdatedAt(overviewUpdatedAt)}` : (lang === 'zh' ? '从 Notion 拉取最新数据' : 'Notionから最新データを取得')}
            >
              <RefreshCw size={14} className={overviewLoading ? 'animate-spin' : ''} />
              {t('update')}
            </button>
            {overviewUpdatedAt && (
              <span className="text-[11px] text-neutral-400 leading-tight">
                {t('lastUpdated')}<br />{formatUpdatedAt(overviewUpdatedAt)}
              </span>
            )}
            <div className="flex items-center gap-4 pl-4 border-l border-neutral-200">
              <KpiInline label={t('kpiCaseCount')} value={overviewKpi.caseCount} />
              <KpiInline label={t('kpiBugTotal')} value={overviewKpi.bugTotal} />
              <KpiInline label={t('kpiSystemClass')} value={overviewKpi.systemCount} suffix={t('kpiSystemSuffix')} />
            </div>
          </div>

          {overviewError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
              <AlertCircle size={16} />
              {overviewError}
            </div>
          )}

          {/* 3 つのダッシュボードカード */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <DashboardCard title={t('chartMonthlyBug')} iconColor="bg-neutral-900">
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyBugSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis hide />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }} />
                    <Bar
                      dataKey="bug"
                      fill="#0f172a"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                      cursor="pointer"
                      onClick={(data: any) => {
                        if (data?.month) {
                          const monthStr = `${filterYear}${String(data.month).padStart(2, '0')}`;
                          setBugListInitialMonth(monthStr);
                          setBugListOpen(true);
                        }
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>

            <DashboardCard title={t('chartSystemDist')} iconColor="bg-blue-500" badge={`FY ${filterYear}`} onClick={() => setGanttOpen(true)} actionHint={lang === 'zh' ? '查看甘特图' : 'ガントチャート'}>
              <div className="space-y-2.5 pt-1">
                {systemDistribution.slice(0, 6).map((row, idx) => {
                  const max = systemDistribution[0]?.count || 1;
                  const palette = ['#f97316', '#3b82f6', '#8b5cf6', '#06b6d4', '#0ea5e9', '#ec4899'];
                  return (
                    <div key={row.areaId} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-neutral-600 truncate" title={row.label}>{row.label}</span>
                      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(row.count / max) * 100}%`, backgroundColor: palette[idx % palette.length] }} />
                      </div>
                      <span className="w-7 text-right font-semibold text-neutral-700">{row.count}</span>
                    </div>
                  );
                })}
                {systemDistribution.length === 0 && (
                  <p className="text-xs text-neutral-400 py-6 text-center">{t('noData')}</p>
                )}
              </div>
            </DashboardCard>

            <DashboardCard title={t('chartStatus')} iconColor="bg-emerald-500">
              <StatusDonut data={statusDistribution} noDataLabel={t('noData')} caseLabel={t('caseLabel')} />
            </DashboardCard>
          </div>

          {/* 月次報告 入口バナー */}
          <button
            type="button"
            onClick={() => setMonthlyReportOpen(true)}
            className="w-full flex items-center justify-between gap-4 rounded-2xl bg-neutral-900 px-6 py-5 text-left text-white shadow-sm hover:bg-neutral-800 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                <FileText size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold">{t('monthlyReportTitle')}</h3>
                <p className="text-sm text-neutral-300 mt-0.5">{t('monthlyReportDesc')}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium whitespace-nowrap">
              {t('monthlyReportEnter')}
              <ArrowRight size={16} />
            </span>
          </button>

          {/* エリアカード（含 sparkline + 月环比） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {AREAS.map((area) => {
              const stats = areaStats.get(area.id);
              const caseSeries = stats?.series ?? [];
              const bugSeries = stats?.bugSeries ?? [];
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => loadAreaData(area.id)}
                  className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-3 text-left hover:border-neutral-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center">
                      {area.icon}
                    </div>
                    <h3 className="text-lg font-bold text-neutral-900">{area.title[lang]}</h3>
                  </div>
                  <p className="text-sm text-neutral-500 leading-relaxed">{area.description[lang]}</p>
                  <div className="h-10 -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={caseSeries.map((v, i) => ({ m: i + 1, v }))} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <Line type="monotone" dataKey="v" stroke="#6366f1" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-12 -mx-1 -mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={bugSeries.map((v, i) => ({ m: i + 1, v }))} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={0} height={14} />
                        <Line type="monotone" dataKey="v" stroke="#cbd5e1" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-neutral-500">
                    <span>{t('caseLabel')} <span className="font-bold text-neutral-900 text-sm">{stats?.caseCount ?? 0}</span></span>
                    <span className="text-neutral-300">•</span>
                    <span>{t('bugLabel')} <span className="font-bold text-neutral-900 text-sm">{stats?.bugTotal ?? 0}</span></span>
                  </div>
                </button>
              );
            })}
          </div>

          {overviewLoading && overviewItems.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-neutral-500 text-sm py-4">
              <Loader2 size={16} className="animate-spin" />
              {t('loadingOverview')}
            </div>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
        {breadcrumb}
      </div>
    </div>
    {planOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 p-4 md:p-8">
        <div className="h-full max-w-7xl mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900">{t('btnPlanDoc')}</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSavePdf}
                className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
              >
                {t('btnSavePdf')}
              </button>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {t('close')}
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
        <div className="h-full max-w-[96rem] mx-auto bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900">{t('reportEdit')}</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveReportPdf}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500"
              >
                {t('btnSaveReportPdf')}
              </button>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {t('close')}
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex">
            {/* 左側：計画資料（参考） */}
            <div className="w-2/5 border-r border-neutral-200 flex flex-col min-w-0">
              <div className="px-3 py-1.5 bg-neutral-50 border-b border-neutral-200 flex items-center gap-2">
                <span className="text-xs font-medium text-neutral-500">{t('planRef')}</span>
                {latestPlanEntry && (
                  <span className="text-[10px] text-neutral-400 truncate">
                    {new Date(latestPlanEntry.savedAt).toLocaleString('ja-JP', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                {latestPlanEntry ? (
                  <iframe
                    title="plan-reference"
                    srcDoc={latestPlanEntry.htmlContent ?? ''}
                    className="w-full h-full bg-white border-0"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-400">
                    <FileText size={28} className="opacity-30" />
                    <p className="text-sm">{t('noPlanHistory')}</p>
                    <p className="text-xs">{t('noPlanHistoryHint')}</p>
                  </div>
                )}
              </div>
            </div>
            {/* 右側：結果報告（編集・印刷対象） */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
                <span className="text-xs font-medium text-indigo-600">{t('reportEdit')}</span>
                <span className="text-[10px] text-indigo-400">{t('reportEditHint')}</span>
              </div>
              <div className="flex-1 min-h-0">
                <iframe
                  ref={reportPreviewIframeRef}
                  title="report-preview"
                  srcDoc={reportHtml}
                  className="w-full h-full bg-white border-0"
                />
              </div>
            </div>
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
              <h3 className="text-base font-semibold text-neutral-900">{t('historyTitle')}</h3>
              {selectedAreaId && (
                <span className="text-xs text-neutral-400">
                  {historyShowAll
                    ? `（${lang === 'zh' ? '全部区域' : '全エリア'}）`
                    : `（${selectedArea ? selectedArea.title[lang] : selectedAreaId}）`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasLegacyHistory && (
                <button
                  type="button"
                  onClick={handleMigrateLocalHistory}
                  disabled={migrating}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  {migrating ? t('migrating') : t('migrateLocal')}
                </button>
              )}
              {selectedAreaId && (
                <button
                  type="button"
                  onClick={() => setHistoryShowAll((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    historyShowAll
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {historyShowAll ? t('btnAllAreasActive') : t('btnAllAreas')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {t('close')}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {historyLoading && htmlHistory.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 text-sm">
                {t('historyLoading')}
              </div>
            ) : historyError ? (
              <div className="text-center py-12 text-red-500 text-sm">
                {t('historyLoadError')}: {historyError}
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 text-sm">
                {htmlHistory.length === 0
                  ? t('historyEmpty')
                  : t('historyAreaEmpty')}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHistory.map((entry) => {
                  const entryArea = AREAS.find((a) => a.id === entry.areaId);
                  const entryAreaTitle = entryArea ? entryArea.title[lang] : entry.areaId;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50"
                    >
                      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        entry.type === 'plan'
                          ? 'bg-neutral-100 text-neutral-700 border border-neutral-300'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      }`}>
                        {entry.type === 'plan' ? t('historyTypePlan') : t('historyTypeReport')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-neutral-800 truncate">{entry.title}</p>
                          {historyShowAll && (
                            <span className="shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-neutral-50 border border-neutral-200 text-neutral-500">
                              {entryAreaTitle.replace(/エリア$|区域$/, '')}
                            </span>
                          )}
                        </div>
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
                          {t('btnPreview')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHtmlHistory((prev) => prev.filter((e) => e.id !== entry.id));
                            apiDeleteHistory(entry.id).catch((err) => console.error('Delete history failed:', err));
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-100 text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                  {entry.type === 'plan' ? t('historyTypePlan') : t('historyTypeReport')}
                </span>
                <p className="text-sm font-semibold text-neutral-800 truncate">{entry.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const liveRoot = historyPreviewIframeRef.current?.contentDocument?.documentElement;
                    const htmlToPrint = liveRoot
                      ? `<!DOCTYPE html>\n${liveRoot.outerHTML}`
                      : (entry.htmlContent ?? '');
                    const win = window.open('', '_blank');
                    if (win) {
                      win.document.open();
                      win.document.write(htmlToPrint);
                      win.document.close();
                      win.document.title = entry.title;
                      win.focus();
                      win.print();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
                >
                  {t('btnReSavePdf')}
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryPreviewId(null); setHistoryOpen(true); }}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {t('btnBack')}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                ref={historyPreviewIframeRef}
                title="history-preview"
                srcDoc={entry.htmlContent ?? ''}
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
