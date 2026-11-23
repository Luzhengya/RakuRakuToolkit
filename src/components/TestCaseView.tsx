import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bug, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, Download, ExternalLink, Loader2, Plus, RefreshCw, X, Trash2, Pencil, Save, Upload } from 'lucide-react';
import { MultiSelect } from './TestCaseLibrary';
import { ui } from './shared/uiClasses';
import { useEscapeKey } from '../hooks/useEscapeKey';
import BugTransferForm from './BugTransferForm';
import BugSummary from './BugSummary';
import NewTestcaseDialog from './NewTestcaseDialog';
import ImportTestcaseDialog from './ImportTestcaseDialog';
import UcCheckGrid from './UcCheckGrid';
import {
  HIGHLIGHT_FIELDS, LONG_TEXT_FIELDS, PRIMARY_FIELDS, RESULT_COLOR, RETEST_OPTIONS, SECONDARY_FIELDS,
  UC_CHECK_ITEMS, UC_EDITABLE_FIELDS, UC_HIGHLIGHT_FIELDS, UC_PRIMARY_FIELDS, UC_SECONDARY_FIELDS,
  TC_CATEGORY_OPTIONS, bugLinkColor, effectiveResult, isUnivContents, tcLabel, ucCheckShort, type TcRow,
} from './testcaseFields';

type ListResponse = {
  items: TcRow[];
  total: number;
  exists: boolean;
  dbTitle: string;
  /** ページID → アップロードで変更された項目名。Notion 側の赤字に対応する */
  changed?: Record<string, string[]>;
};

// 明細テーブルに出す列 (残りは詳細ダイアログで表示)
const LIST_COLUMNS = [
  'ケース番号',
  'CMDB番号',
  '大分類',
  '中分類',
  '小分類',
  '機能名',
  'テスト内容',
  'テスト結果',
  '再テスト結果',
  '優先級',
  'バージョン',
] as const;

// UnivContents (ブラウザ検証リスト) の明細列
const UC_LIST_COLUMNS = [
  'ケース番号', 'CMDB番号', 'course_no', 'course_name', 'CHROME',
  ...UC_CHECK_ITEMS,
  'テスト結果', '再テスト結果', '作業者', '作業日',
] as const;
const UC_CHECK_SET = new Set<string>(UC_CHECK_ITEMS);

// キーワード検索の対象。複数キーワードは空白区切りで AND 検索する
const KEYWORD_FIELDS = [
  'ケース番号', 'CMDB番号', '大分類', '中分類', '小分類', '機能名', 'テスト内容',
] as const;
const UC_KEYWORD_FIELDS = ['ケース番号', 'CMDB番号', 'course_no', 'course_name', '備考'] as const;

// テスト結果が空の行を絞り込むための表示値 (Notion には無い値)
const RESULT_EMPTY = '未実施';
// ポイントにこの文字を含む行を「指摘対応」として絞り込む (api の SHIMATEKI_MARK と同じ)
const SHIMATEKI_MARK = '指摘対応';
// 明細の列の表示/非表示 (ブラウザごとに保存。UnivContents は列が違うので別キー)
const HIDDEN_COLS_KEY = 'testcaseView.hiddenColumns';
const hiddenColsKey = (uc: boolean) => `${HIDDEN_COLS_KEY}.${uc ? 'uc' : 'std'}`;
function loadHiddenCols(uc: boolean): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(hiddenColsKey(uc)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function saveHiddenCols(uc: boolean, cols: string[]) {
  try { localStorage.setItem(hiddenColsKey(uc), JSON.stringify(cols)); } catch { /* 保存できなくても表示には影響しない */ }
}

// サーバー側で編集を許可している項目 (api の TESTCASE_EDITABLE_FIELDS と対応)
const EDITABLE_FIELDS = new Set<string>([
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', '要件名',
  'テスト内容', '前提条件', 'ステップ', '予期結果',
  'ポイント', '優先級', 'カテゴリ', '状態', 'テスト結果',
  '再テスト結果', '再実施日', '再実施者', '関連NO', '備考',
]);

// 空欄 = 未実施。Notion の選択肢に「未実施」は無いので、選ばせると
// Notion 側に新しい選択肢が作られてしまう
const RESULT_OPTIONS = ['', 'OK', 'NG', 'テスト不可'];
const UC_RESULT_OPTIONS = ['', 'OK', 'NG'];


export default function TestCaseView({ onBack }: { onBack: () => void }) {
  const [systems, setSystems] = useState<string[]>([]);
  const [system, setSystem] = useState('');
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [rows, setRows] = useState<TcRow[]>([]);
  const [dbTitle, setDbTitle] = useState('');
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TcRow | null>(null);
  // ページID → アップロードで変更された項目名 (Notion 側の赤字に対応)
  const [changedMap, setChangedMap] = useState<Record<string, string[]>>({});

  // 詳細ダイアログの編集
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // 削除中の行 id
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // ケース新規作成 (ライブラリに無いケースを1件追加)
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // ケース番号 → 移管済み BUG。BUG 表を引いて判定するので、BUG を削除すれば自動的に戻る
  const [transferred, setTransferred] = useState<Record<string, { id: string; no: string; status?: string }>>({});
  // ダイアログの表示モード: 詳細 / BUG移管フォーム / 移管済み BUG の内容
  const [dialogMode, setDialogMode] = useState<'detail' | 'transfer' | 'bug'>('detail');
  // Esc で詳細を閉じる。編集中・保存中・BUG 移管の入力中は入力が消えるので閉じない
  useEscapeKey(() => setDetail(null), !!detail && !editing && !saving && dialogMode !== 'transfer');

  // 絞り込み。月次はヘッダ側 (年度の右) に移動し、既定は全年
  const [fMonth, setFMonth] = useState('');
  const [fKeyword, setFKeyword] = useState('');
  // 複数選択 (空 = すべて)。テスト結果の空欄は RESULT_EMPTY で選ぶ
  const [fResults, setFResults] = useState<string[]>([]);
  const [fShimateki, setFShimateki] = useState(false);
  const [fCategories, setFCategories] = useState<string[]>([]);
  const [fVersion, setFVersion] = useState('');
  const [fMajor, setFMajor] = useState('');
  const [fMiddle, setFMiddle] = useState('');
  const [fMinor, setFMinor] = useState('');
  // 備考: '' = すべて / 'filled' = 記入あり (空白のみは空扱い)
  const [fNote, setFNote] = useState('');
  const [fNormal, setFNormal] = useState('');
  // 詳細条件 (2行目) の開閉。既定は閉じる
  const [detailOpen, setDetailOpen] = useState(false);

  // UnivContents はブラウザ検証リストの別テンプレートで表示する (関連処理は共通)
  const uc = isUnivContents(system);
  const listColumns: readonly string[] = uc ? UC_LIST_COLUMNS : LIST_COLUMNS;
  const keywordFields: readonly string[] = uc ? UC_KEYWORD_FIELDS : KEYWORD_FIELDS;
  const editableFields = uc ? UC_EDITABLE_FIELDS : EDITABLE_FIELDS;
  const primaryFields: readonly string[] = uc ? UC_PRIMARY_FIELDS : PRIMARY_FIELDS;
  const highlightFields: readonly string[] = uc ? UC_HIGHLIGHT_FIELDS : HIGHLIGHT_FIELDS;
  const secondaryFields: readonly string[] = uc ? UC_SECONDARY_FIELDS : SECONDARY_FIELDS;
  const subtitleField = uc ? 'course_name' : '機能名';

  // 列の表示/非表示。先頭列 (ケース番号) は左に固定し、隠せない
  const fixedColumn = listColumns[0];
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => loadHiddenCols(uc));
  useEffect(() => { setHiddenCols(loadHiddenCols(uc)); }, [uc]);
  const updateHiddenCols = (cols: string[]) => { setHiddenCols(cols); saveHiddenCols(uc, cols); };
  const visibleColumns = listColumns.filter((c) => c === fixedColumn || !hiddenCols.includes(c));

  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  // システム候補 (Testcase Format と同じ、進捗管理表から取得)
  useEffect(() => {
    let alive = true;
    fetch('/api/testcase-format/systems')
      .then((res) => (res.ok ? res.json() : { systems: [] }))
      .then((d: any) => {
        if (!alive) return;
        const EXCLUDE = new Set(['全体システム', '脆弱性診断']);
        const list = ((d?.systems ?? []) as string[]).filter(
          (s) => !s.includes('改善') && !EXCLUDE.has(s),
        );
        setSystems(list);
      })
      .catch(() => { /* 取得できなければ手入力にフォールバック */ });
    return () => { alive = false; };
  }, []);

  const fetchList = () => {
    if (!system) return;
    setLoading(true);
    setError(null);
    fetch(`/api/testcase/list?system=${encodeURIComponent(system)}&year=${year}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<ListResponse>;
      })
      .then((d) => {
        setRows(d.items ?? []);
        setDbTitle(d.dbTitle ?? '');
        setExists(!!d.exists);
        setChangedMap(d.changed ?? {});
        reloadTransferred();
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '取得に失敗しました');
        setRows([]);
      })
      .finally(() => setLoading(false));
  };

  // システム・年度が決まったら自動取得
  useEffect(() => {
    if (system) fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system, year]);

  // 絞り込み候補 (取得済みデータから動的に生成)
  const optionsOf = (key: string): string[] =>
    Array.from(new Set<string>(rows.map((r) => (r[key] || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filtered = useMemo(() => {
    // 全角/半角どちらの空白でも区切る。すべてのキーワードを含む行だけ残す
    const keywords = fKeyword.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
    return rows.filter((r) => {
      if (fMonth && (r['月次'] || '') !== fMonth) return false;
      if (fResults.length && !fResults.includes((r['テスト結果'] || '').trim() || RESULT_EMPTY)) return false;
      // 指摘対応・カテゴリ・正常/異常 は UnivContents では出さないので効かせない
      if (!uc && fShimateki && !(r['ポイント'] || '').includes(SHIMATEKI_MARK)) return false;
      if (!uc && fCategories.length && !fCategories.includes((r['カテゴリ'] || '').trim())) return false;
      if (fVersion && (r['バージョン'] || '') !== fVersion) return false;
      if (fMajor && (r['大分類'] || '') !== fMajor) return false;
      if (fMiddle && (r['中分類'] || '') !== fMiddle) return false;
      if (fMinor && (r['小分類'] || '') !== fMinor) return false;
      if (fNote === 'filled' && !(r['備考'] || '').trim()) return false;
      if (!uc && fNormal && (r['正常/異常'] || '').trim() !== fNormal) return false;
      if (keywords.length) {
        const haystack = keywordFields.map((f) => r[f] || '').join(' ').toLowerCase();
        if (!keywords.every((k) => haystack.includes(k))) return false;
      }
      return true;
    });
  }, [rows, fMonth, fKeyword, fResults, fShimateki, fCategories, fVersion, fMajor, fMiddle, fMinor, fNote, fNormal, keywordFields, uc]);

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = (a[sortCol] || '').trim();
      const vb = (b[sortCol] || '').trim();
      return dir * va.localeCompare(vb, undefined, { numeric: true });
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, currentPage]);

  useEffect(() => { setCurrentPage(1); }, [filtered, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc'); }
    else if (sortDir === 'asc') { setSortDir('desc'); }
    else { setSortCol(''); setSortDir(null); }
  };

  // 統計 (絞り込み結果に連動)
  // 再確認OK は OK として、再確認NG/空 は NG として集計
  const stats = useMemo(() => {
    const total = filtered.length;
    let ok = 0, ng = 0, block = 0, un = 0;
    for (const r of filtered) {
      const eff = effectiveResult(r);
      if (eff === 'OK') ok++;
      else if (eff === 'NG') ng++;
      else if (eff === 'テスト不可') block++;
      else un++;
    }
    return { total, ok, un, block, ng };
  }, [filtered]);

  // 詳細条件 (閉じていても効く) の件数。閉じたときに見落とさないよう開閉ボタンに出す
  const detailFilterCount = [fMajor, fMiddle, fMinor, fVersion, fNote, uc ? '' : fNormal].filter(Boolean).length;
  const hasFilter = !!(fKeyword || fResults.length || fShimateki || fCategories.length) || detailFilterCount > 0;
  const clearFilters = () => {
    setFKeyword(''); setFResults([]); setFShimateki(false); setFCategories([]);
    setFVersion(''); setFMajor(''); setFMiddle(''); setFMinor(''); setFNote(''); setFNormal('');
  };

  const openDetail = (r: TcRow, mode: 'detail' | 'transfer' | 'bug' = 'detail') => {
    setDetail(r);
    setEditing(false);
    setDraft({});
    setDialogError(null);
    setDialogMode(mode);
  };

  // ダイアログを開いたまま前後のケースへ移る。
  // 絞り込み結果の並び順をそのまま辿る。
  // 編集中の下書きと表示モードは必ず捨てる。持ち越すと別のケースに
  // 前のケースの入力を保存してしまう。
  const detailIndex = detail ? sorted.findIndex((r) => r.id === detail.id) : -1;
  const stepDetail = (delta: number) => {
    if (detailIndex < 0) return;
    const next = sorted[detailIndex + delta];
    if (next) openDetail(next);
  };

  // 移管済み状況を取り直す。BUG 表を引いて判定しているので、
  // Notion 側で BUG を消せば移管ボタンが戻る
  const reloadTransferred = () => {
    fetch(`/api/testcase/bug-status?system=${encodeURIComponent(system)}&year=${year}`)
      .then((r) => (r.ok ? r.json() : { transferred: {} }))
      .then((d: any) => setTransferred(d?.transferred ?? {}))
      .catch(() => { /* 一覧自体は使えるので握りつぶす */ });
  };

  const startEdit = () => {
    if (!detail) return;
    const d: Record<string, string> = {};
    for (const f of editableFields) d[f] = detail[f] || '';
    setDraft(d);
    setEditing(true);
    setDialogError(null);
  };

  const saveEdit = async () => {
    if (!detail) return;
    // 変更があった項目だけ送る
    const changed: Record<string, string> = {};
    for (const k of Object.keys(draft)) {
      const v = draft[k];
      if (v !== (detail[k] || '')) changed[k] = v;
    }
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/testcase/${encodeURIComponent(detail.id)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: changed }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || '更新に失敗しました');
      }
      // 画面側も更新して、閉じずに結果が見えるようにする
      const updated = { ...detail, ...changed } as TcRow;
      setRows((prev) => prev.map((r) => (r.id === detail.id ? updated : r)));
      setDetail(updated);
      setEditing(false);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 絞り込み結果をそのまま Excel にする。
  // 画面で見えているものが出るよう、条件ではなく行データを送る。
  const exportExcel = async () => {
    if (sorted.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/testcase/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: sorted, title: dbTitle || `${system}${year}`, system }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || '出力に失敗しました');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${uc ? '【ブラウザ検証リスト】' : '【試験仕様書TestCenter】'}${dbTitle || `${system}${year}`}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '出力に失敗しました');
    } finally {
      setExporting(false);
    }
  };

  const removeRow = async (r: TcRow) => {
    const label = r['ケース番号'] || r.id;
    if (!window.confirm(`ケース「${label}」を削除します。元に戻せません。よろしいですか？`)) return;
    setDeletingId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/testcase/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || '削除に失敗しました');
      }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      if (detail?.id === r.id) setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setDeletingId(null);
    }
  };

  // アップロードで変更された項目か (Notion 側で赤字になっているもの)
  const isChanged = (rowId: string, field: string) => !!changedMap[rowId]?.includes(field);
  const changedCount = (rowId: string) => changedMap[rowId]?.length ?? 0;

  const selectCls = ui.input;
  const th0 = 'px-3 py-2 text-xs font-semibold text-neutral-500 whitespace-nowrap text-left border-b border-neutral-200';
  const td0 = 'px-3 py-2 text-xs text-neutral-700 whitespace-nowrap border-b border-neutral-100';

  return (
    <div className="max-w-[96rem] mx-auto space-y-5">
      {/* パンくず */}
      <nav className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onBack} className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors">
          ホーム
        </button>
        <span className="text-neutral-400">{'>>'}</span>
        <span className="text-neutral-900 font-medium">TestCase</span>
      </nav>

      {/* タイトル + テーブル選択 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-neutral-900">TestCase</h2>
          {dbTitle && <span className="text-sm text-neutral-400">{dbTitle}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {systems.length > 0 ? (
            <select value={system} onChange={(e) => setSystem(e.target.value)} className={selectCls}>
              <option value="">すべて</option>
              {systems.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="システム名"
              className={selectCls}
            />
          )}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('月次').map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button
            type="button"
            onClick={fetchList}
            disabled={loading || !system}
            className={ui.btnSecondary}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || sorted.length === 0}
            title={`Excel出力（絞り込んだ ${sorted.length}件 / Testcase Format と同じ書式）`}
            className={ui.btnIcon}
          >
            {exporting
              ? <Loader2 size={14} className="animate-spin" />
              : <Download size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            title="テンプレート Excel からケースを一括登録"
            className={ui.btnSecondary}
          >
            <Upload size={14} />
            インポート
          </button>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className={ui.btnPrimary}
          >
            <Plus size={14} />
            新規ケース
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-700 flex items-center gap-2 text-sm">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} title="閉じる" aria-label="閉じる" className={`text-emerald-600 hover:text-emerald-800 rounded ${ui.focusRing}`}><X size={14} /></button>
        </div>
      )}

      {newOpen && (
        <NewTestcaseDialog
          initialSystem={system}
          onClose={() => setNewOpen(false)}
          onCreated={(r) => {
            setNewOpen(false);
            setNotice(`ケース ${r.caseNo} を ${r.system}${r.year} に作成しました`);
            // 作成先の表を表示する。表示中と同じ表なら取り直す
            if (r.system === system && r.year === year) fetchList();
            else { setSystem(r.system); setYear(r.year); }
          }}
        />
      )}

      {importOpen && (
        <ImportTestcaseDialog
          year={year}
          onClose={() => setImportOpen(false)}
          onImported={(r) => {
            setImportOpen(false);
            setNotice(`インポートしました（新規 ${r.created}件 / 上書き ${r.updated}件）`);
            fetchList();
            reloadTransferred();
          }}
        />
      )}

      {!error && !exists && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm">
          テーブル「{dbTitle}」はまだ作成されていません。Testcase Format からテストケースを登録してください。
        </div>
      )}

      {/* 統計パネル (絞り込みに連動) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'テスト総件数', value: stats.total, cls: 'text-neutral-900' },
          { label: 'テストOK', value: stats.ok, cls: 'text-emerald-600' },
          { label: '未実施', value: stats.un, cls: 'text-neutral-500' },
          { label: 'テスト不可', value: stats.block, cls: 'text-amber-600' },
          { label: 'テストNG', value: stats.ng, cls: 'text-red-600' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-neutral-200 rounded-xl px-4 py-3">
            <p className="text-xs text-neutral-500 font-semibold tracking-wider truncate">{c.label}</p>
            <p className={`text-2xl font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 絞り込み: 1行目 = よく使う条件 / 2行目 = 詳細条件 (既定は閉じる。閉じていても条件は効く) */}
      <div className={`${ui.card} px-4 py-3 space-y-3`}>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="space-y-1 flex-1 min-w-[260px]">
            <span className={ui.label}>キーワード</span>
            <input
              value={fKeyword}
              onChange={(e) => setFKeyword(e.target.value)}
              placeholder={uc ? 'course_id・CMDB番号・course_no・course_name・備考を検索 (空白区切りで AND)' : 'ケース番号・CMDB番号・画面名(中分類)・分類・機能名・テスト内容を検索 (空白区切りで AND)'}
              className={selectCls + ' w-full'}
            />
          </label>
          <div className="space-y-1 w-40">
            <span className={ui.label}>{tcLabel('テスト結果', uc)}</span>
            <MultiSelect
              options={[RESULT_EMPTY, ...optionsOf('テスト結果').filter((v) => v !== RESULT_EMPTY)]}
              value={fResults}
              onChange={setFResults}
            />
          </div>
          {!uc && (<>
            <div className="space-y-1 w-56">
              <span className={ui.label}>カテゴリ</span>
              {/* 候補はケーステンプレートのカテゴリ (データに無い値も選べる) */}
              <MultiSelect options={[...TC_CATEGORY_OPTIONS]} value={fCategories} onChange={setFCategories} />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-sm text-neutral-700 cursor-pointer select-none" title="ポイントに「指摘対応」を含むケースだけを表示">
              <input type="checkbox" checked={fShimateki} onChange={(e) => setFShimateki(e.target.checked)} />
              指摘対応
            </label>
          </>)}
        </div>

        {/* 詳細条件の開閉と条件クリアは別の行に置く */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            className={`inline-flex items-center gap-1 ${ui.btnText} text-neutral-600`}
          >
            {detailOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            詳細条件{detailFilterCount > 0 && <span className="font-semibold text-neutral-900">（{detailFilterCount}）</span>}
          </button>
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className={ui.btnText}
            >
              条件クリア
            </button>
          )}
        </div>

        {detailOpen && (
          <div className="border-t border-neutral-100 pt-3 space-y-3">
            {!uc && (
              // 候補の文字が長くても 1 行に収まるよう 3 等分の幅に固定する
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1 min-w-0">
                  <span className={ui.label}>大分類</span>
                  <select value={fMajor} onChange={(e) => setFMajor(e.target.value)} className={selectCls + ' w-full'}>
                    <option value="">すべて</option>
                    {optionsOf('大分類').map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1 min-w-0">
                  <span className={ui.label}>中分類</span>
                  <select value={fMiddle} onChange={(e) => setFMiddle(e.target.value)} className={selectCls + ' w-full'}>
                    <option value="">すべて</option>
                    {optionsOf('中分類').map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1 min-w-0">
                  <span className={ui.label}>小分類</span>
                  <select value={fMinor} onChange={(e) => setFMinor(e.target.value)} className={selectCls + ' w-full'}>
                    <option value="">すべて</option>
                    {optionsOf('小分類').map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap">
              <label className="space-y-1">
                <span className={ui.label}>バージョン</span>
                <select value={fVersion} onChange={(e) => setFVersion(e.target.value)} className={selectCls}>
                  <option value="">すべて</option>
                  {optionsOf('バージョン').map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className={ui.label}>備考</span>
                <select value={fNote} onChange={(e) => setFNote(e.target.value)} className={selectCls}>
                  <option value="">すべて</option>
                  <option value="filled">記入あり</option>
                </select>
              </label>
              {!uc && (
                <label className="space-y-1" title="TestCase Library から取り込んだケースのみ値あり">
                  <span className={ui.label}>正常/異常</span>
                  <select value={fNormal} onChange={(e) => setFNormal(e.target.value)} className={selectCls}>
                    <option value="">すべて</option>
                    {optionsOf('正常/異常').map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 明細テーブル */}
      <div className="flex justify-end">
        <ColumnMenu
          columns={listColumns}
          fixed={fixedColumn}
          hidden={hiddenCols}
          labelOf={(c) => (UC_CHECK_SET.has(c) ? c : tcLabel(c, uc))}
          onChange={updateHiddenCols}
        />
      </div>
      {loading ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 flex items-center justify-center gap-2 text-neutral-500">
          <Loader2 size={18} className="animate-spin" />
          読み込み中...
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400">
          {rows.length === 0 ? 'データがありません' : '条件に一致するデータがありません'}
        </div>
      ) : (
        // 縦スクロールも枠内で行い、見出し行を sticky で固定する (overflow-x だけだと sticky が効かない)。
        // ページ送りはスクロール枠の外に置く (枠内の sticky だと固定列や横スクロールバーと重なってケースが隠れるため)
        <div className={`${ui.card} overflow-hidden`}>
        <div className="overflow-auto max-h-[calc(100vh-240px)]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e5e5e5]">
              <tr>
                {visibleColumns.map((c) => (
                  <th
                    key={c}
                    className={th0 + ' cursor-pointer hover:bg-neutral-50 select-none' + (c === fixedColumn ? ' sticky left-0 z-20 bg-white' : '')}
                    onClick={() => toggleSort(c)}
                    title={UC_CHECK_SET.has(c) ? c : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {UC_CHECK_SET.has(c) ? ucCheckShort(c) : tcLabel(c, uc)}
                      {sortCol === c && sortDir === 'asc' && <ChevronUp size={12} />}
                      {sortCol === c && sortDir === 'desc' && <ChevronDown size={12} />}
                    </span>
                  </th>
                ))}
                <th className={th0}></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                // 結果が OK (NG→再確認OK を含む) の行は薄いグレーにして、対応が要る行と見分ける
                <tr
                  key={r.id}
                  className={`cursor-pointer ${effectiveResult(r) === 'OK' ? 'bg-neutral-100 hover:bg-neutral-200' : 'bg-white hover:bg-neutral-50'}`}
                  onClick={() => openDetail(r)}
                >
                  {visibleColumns.map((c) => {
                    const v = r[c] || '';
                    if (c === 'テスト結果' || UC_CHECK_SET.has(c)) {
                      return (
                        <td key={c} className={td0}>
                          {v ? (
                            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[v] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                              {v}
                            </span>
                          ) : c === 'テスト結果' ? <span className="text-xs text-neutral-500">未実施</span> : '-'}
                        </td>
                      );
                    }
                    if (c === '再テスト結果') {
                      if ((r['テスト結果'] || '').trim() !== 'NG') return <td key={c} className={td0}>-</td>;
                      return (
                        <td key={c} className={td0}>
                          {v ? (
                            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[v] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                              {v}
                            </span>
                          ) : '-'}
                        </td>
                      );
                    }
                    const wide = c === 'テスト内容' || c === '機能名' || c === 'course_name';
                    // Notion 側で赤字になっている項目は画面でも赤字にする
                    const red = isChanged(r.id, c);
                    return (
                      <td
                        key={c}
                        className={
                          td0 + (wide ? ' max-w-[280px] truncate' : '') +
                          (red ? ' text-red-600 font-medium' : '') +
                          // 先頭列は横スクロールしても左に残す。背景は行の色をそのまま使う
                          (c === fixedColumn ? ' sticky left-0 z-[1] bg-inherit' : '')
                        }
                        title={red ? `${v}（前回アップロードで変更）` : wide ? v : undefined}
                      >
                        {v || '-'}
                      </td>
                    );
                  })}
                  <td className={td0} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {transferred[(r['ケース番号'] || '').trim()] ? (
                        <button
                          type="button"
                          onClick={() => openDetail(r, 'bug')}
                          title={`移管済みの BUG を表示（${transferred[(r['ケース番号'] || '').trim()].status || '状態未設定'}）`}
                          className={`px-2 py-1 rounded-lg border text-xs whitespace-nowrap ${ui.focusRing} ${bugLinkColor(transferred[(r['ケース番号'] || '').trim()].status)}`}
                        >
                          移管済み No.{transferred[(r['ケース番号'] || '').trim()].no || '-'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openDetail(r, 'transfer')}
                          title="このケースから BUG を作成"
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-600 hover:bg-neutral-100 whitespace-nowrap ${ui.focusRing}`}
                        >
                          <Bug size={12} />
                          BUG移管
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(r)}
                        disabled={deletingId === r.id}
                        title="削除"
                        aria-label="削除"
                        className={`p-1 rounded-lg border border-neutral-300 bg-white text-neutral-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 disabled:cursor-not-allowed ${ui.focusRing}`}
                      >
                        {deletingId === r.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="bg-white flex items-center justify-between px-4 py-3 border-t border-neutral-200">
              <span className="text-xs text-neutral-400">{sorted.length} 件中 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sorted.length)} 件</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={`p-1 rounded-lg hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed ${ui.focusRing}`}
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                  .reduce<(number | 'dots')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('dots');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === 'dots' ? (
                      <span key={`d${i}`} className="px-1 text-xs text-neutral-300">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`min-w-[28px] h-7 rounded-lg text-xs font-medium ${ui.focusRing} ${currentPage === p ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100 text-neutral-600'}`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className={`p-1 rounded-lg hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed ${ui.focusRing}`}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 詳細ダイアログ (縦に伸ばさず横に広げる) */}
      {detail && (
        <div className={`${ui.dialogOverlay} gap-2`}>
          {/* 左右の送り。閉じずに前後のケースを見られる */}
          <button
            type="button"
            onClick={() => stepDetail(-1)}
            disabled={editing || detailIndex <= 0 || dialogMode !== 'detail'}
            title={editing ? '編集中は移動できません。保存またはキャンセルしてください' : '前のケース'}
            className={ui.dialogNav}
          >
            <ChevronLeft size={20} />
          </button>

          <div className={`${ui.dialogPanel} max-w-6xl`}>
            {/* ヘッダ: ケース番号はここだけに出す (本文では重複させない) */}
            <div className={ui.dialogHeader}>
              <div className="flex items-baseline gap-3 min-w-0">
                {dialogMode === 'bug' ? (
                  <h3 className={`${ui.dialogTitle} shrink-0`}>
                    BUG No.{transferred[(detail['ケース番号'] || '').trim()]?.no || '-'}
                  </h3>
                ) : (
                  <>
                    <h3 className={`${ui.dialogTitle} shrink-0`}>
                      NO.{detail['ケース番号'] || '-'}
                    </h3>
                    {detail[subtitleField] && (
                      <span className="text-sm text-neutral-400 truncate">{detail[subtitleField]}</span>
                    )}
                    {changedCount(detail.id) > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-bold text-red-600"
                        title="前回のアップロードで値が変わった項目です"
                      >
                        変更 {changedCount(detail.id)}項目
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* 何件目か。送りボタンで移動したときに位置が分かる */}
                {detailIndex >= 0 && sorted.length > 1 && (
                  <span className="text-xs text-neutral-500 tabular-nums">
                    {detailIndex + 1} / {sorted.length}
                  </span>
                )}
                {dialogMode === 'bug' && (
                  <button
                    type="button"
                    onClick={() => setDialogMode('detail')}
                    className={ui.btnSecondary}
                  >
                    ケース詳細に戻る
                  </button>
                )}
                {dialogMode === 'detail' && (
                  transferred[(detail['ケース番号'] || '').trim()] ? (
                    <button
                      type="button"
                      onClick={() => setDialogMode('bug')}
                      disabled={editing}
                      title={editing ? '編集中は操作できません。保存またはキャンセルしてください' : '移管済みの BUG を表示'}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${ui.focusRing} ${bugLinkColor(transferred[(detail['ケース番号'] || '').trim()].status)}`}
                    >
                      移管済み No.{transferred[(detail['ケース番号'] || '').trim()].no || '-'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDialogMode('transfer')}
                      disabled={editing}
                      title={editing ? '編集中は移管できません。保存またはキャンセルしてください' : 'このケースから BUG を作成'}
                      className={ui.btnSecondary}
                    >
                      <Bug size={14} />
                      BUG移管
                    </button>
                  )
                )}
                {dialogMode === 'detail' && (
                  editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { setEditing(false); setDialogError(null); }}
                        disabled={saving}
                        className={ui.btnSecondary}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={saving}
                        className={ui.btnPrimary}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        保存
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={startEdit}
                      className={ui.btnSecondary}
                    >
                      <Pencil size={14} />
                      編集
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  title="閉じる"
                  aria-label="閉じる"
                  className={ui.dialogClose}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {dialogError && (
              <div className={`mx-5 mt-3 shrink-0 ${ui.errorBox}`}>
                <AlertCircle size={15} />
                {dialogError}
              </div>
            )}

            <div className="p-5 space-y-5 overflow-auto">
              {dialogMode === 'bug' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-neutral-800">移管済み BUG</h4>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          const caseNo = (detail['ケース番号'] || '').trim();
                          const bug = transferred[caseNo];
                          if (!bug || !detail) return;
                          if (!confirm(`BUG #${bug.no} との関連付けを解除しますか？\nテスト結果は変更されません。`)) return;
                          try {
                            const res = await fetch(`/api/testcase/${encodeURIComponent(detail.id)}/unlink-bug`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bugId: bug.id }),
                            });
                            if (!res.ok) {
                              const b = await res.json().catch(() => ({}));
                              throw new Error((b as { error?: string }).error || '解除に失敗しました');
                            }
                            setTransferred((prev) => {
                              const next = { ...prev };
                              delete next[caseNo];
                              return next;
                            });
                            setDialogMode('detail');
                          } catch (e) {
                            alert(e instanceof Error ? e.message : '解除に失敗しました');
                          }
                        }}
                        className={`text-xs text-red-500 hover:text-red-700 rounded ${ui.focusRing}`}
                      >
                        関連付け解除
                      </button>
                      <a
                        href={`https://www.notion.so/${(transferred[(detail['ケース番号'] || '').trim()]?.id ?? '').replace(/-/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 rounded ${ui.focusRing}`}
                      >
                        <ExternalLink size={12} />
                        Notion で開く（画像の添付や編集はこちら）
                      </a>
                    </div>
                  </div>
                  <BugSummary bugId={transferred[(detail['ケース番号'] || '').trim()]?.id ?? ''} />
                </div>
              ) : dialogMode === 'transfer' ? (
                <BugTransferForm
                  caseId={detail.id}
                  year={year}
                  onCancel={() => setDialogMode('detail')}
                  onDone={(bugId, bugNo) => {
                    const caseNo = (detail['ケース番号'] || '').trim();
                    setTransferred((prev) => ({ ...prev, [caseNo]: { id: bugId, no: bugNo } }));
                    const updated = { ...detail, 'テスト結果': 'NG' } as TcRow;
                    setRows((prev) => prev.map((x) => (x.id === detail.id ? updated : x)));
                    setDetail(updated);
                    setDialogMode('bug');
                  }}
                />
              ) : (
              <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 space-y-4">
                {primaryFields.map((f) => (
                  <div key={f} className="space-y-1">
                    <p className="text-xs font-bold text-neutral-700 flex items-center gap-2">
                      {f}
                      {isChanged(detail.id, f) && (
                        <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-xs font-medium text-red-600">
                          変更あり
                        </span>
                      )}
                    </p>
                    {editing && editableFields.has(f) ? (
                      <textarea
                        value={draft[f] ?? ''}
                        onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                        rows={f === 'テスト内容' ? 3 : 4}
                        className={`${ui.input} w-full p-2`}
                      />
                    ) : (
                      <p className={`text-sm whitespace-pre-wrap border rounded-lg p-3 min-h-[3.5rem] ${
                        isChanged(detail.id, f)
                          ? 'text-red-600 border-red-200 bg-red-50'
                          : 'text-neutral-800 border-neutral-200 bg-neutral-50'
                      }`}>
                        {detail[f] || '-'}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {highlightFields.map((f) => (
                    <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-neutral-500">{tcLabel(f, uc)}</p>
                      {editing && f === 'テスト結果' ? (
                        <select
                          value={draft[f] ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                          className={selectCls + ' w-full'}
                        >
                          {(uc ? UC_RESULT_OPTIONS : RESULT_OPTIONS).map((o) => (
                            <option key={o} value={o}>{o || '未実施'}</option>
                          ))}
                        </select>
                      ) : editing ? (
                        <input
                          value={draft[f] ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                          className={selectCls + ' w-full'}
                        />
                      ) : f === 'テスト結果' ? (
                        detail[f] ? (
                          <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${RESULT_COLOR[detail[f]] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                            {detail[f]}
                          </span>
                        ) : <span className="text-sm text-neutral-500">未実施</span>
                      ) : (
                        <p className={`font-bold text-neutral-900 ${uc ? 'text-sm break-words' : 'text-lg'}`}>{detail[f] || '-'}</p>
                      )}
                    </div>
                  ))}
                </div>

                {uc && (
                  <UcCheckGrid
                    row={detail}
                    draft={draft}
                    editing={editing}
                    onChange={(f, v) => setDraft((p) => ({ ...p, [f]: v }))}
                  />
                )}

                {(editing ? (draft['テスト結果'] || '') : (detail['テスト結果'] || '')).trim() === 'NG' && (
                  <div className="border border-orange-200 rounded-lg p-3 bg-orange-50/40 space-y-3">
                    <p className="text-xs font-semibold text-orange-600">再テスト</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-neutral-500">再テスト結果</p>
                        {editing ? (
                          <select
                            value={draft['再テスト結果'] ?? ''}
                            onChange={(e) => setDraft((p) => ({ ...p, '再テスト結果': e.target.value }))}
                            className={selectCls + ' w-full'}
                          >
                            {RETEST_OPTIONS.map((o) => (
                              <option key={o} value={o}>{o || '—'}</option>
                            ))}
                          </select>
                        ) : (
                          detail['再テスト結果'] ? (
                            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESULT_COLOR[detail['再テスト結果']] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                              {detail['再テスト結果']}
                            </span>
                          ) : <span className="text-sm text-neutral-400">—</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-neutral-500">再実施日</p>
                        {editing ? (
                          <input
                            type="date"
                            value={draft['再実施日'] ?? ''}
                            onChange={(e) => setDraft((p) => ({ ...p, '再実施日': e.target.value }))}
                            className={selectCls + ' w-full'}
                          />
                        ) : (
                          <p className="text-sm text-neutral-800">{detail['再実施日'] || '—'}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-neutral-500">再実施者</p>
                        {editing ? (
                          <input
                            value={draft['再実施者'] ?? ''}
                            onChange={(e) => setDraft((p) => ({ ...p, '再実施者': e.target.value }))}
                            className={selectCls + ' w-full'}
                          />
                        ) : (
                          <p className="text-sm text-neutral-800">{detail['再実施者'] || '—'}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                  {secondaryFields.map((f) => {
                    const canEdit = editing && editableFields.has(f);
                    const isLong = LONG_TEXT_FIELDS.has(f);
                    return (
                      <div key={f} className="px-3 py-2 flex items-start gap-3">
                        <p className="text-xs text-neutral-500 w-20 shrink-0 pt-0.5">{f}</p>
                        {canEdit ? (
                          isLong ? (
                            <textarea
                              value={draft[f] ?? ''}
                              onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                              rows={2}
                              className={`${ui.input} flex-1 min-w-0`}
                            />
                          ) : (
                            <input
                              value={draft[f] ?? ''}
                              onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                              className={`${ui.input} flex-1 min-w-0`}
                            />
                          )
                        ) : (
                          <p className={`flex-1 text-sm text-neutral-700 min-w-0 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`} title={detail[f] || ''}>
                            {detail[f] || '-'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(detail)}
                  disabled={deletingId === detail.id}
                  className={`${ui.btnDanger} w-full py-2`}
                >
                  {deletingId === detail.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />}
                  このケースを削除
                </button>
                </div>
              </div>
              </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => stepDetail(1)}
            disabled={editing || detailIndex < 0 || detailIndex >= sorted.length - 1 || dialogMode !== 'detail'}
            title={editing ? '編集中は移動できません。保存またはキャンセルしてください' : '次のケース'}
            className={ui.dialogNav}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

// 明細の列の表示/非表示メニュー。固定列は外せない
function ColumnMenu({ columns, fixed, hidden, labelOf, onChange }: {
  columns: readonly string[];
  fixed: string;
  hidden: string[];
  labelOf: (c: string) => string;
  onChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // 今の列定義に無い (古い保存値の) 列は数えない
  const hiddenCount = columns.filter((c) => c !== fixed && hidden.includes(c)).length;
  const toggle = (c: string) => onChange(hidden.includes(c) ? hidden.filter((x) => x !== c) : [...hidden, c]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={ui.btnSecondary}
      >
        <Columns3 size={14} />
        列表示{hiddenCount > 0 && <span className="text-xs font-normal text-neutral-500">（{hiddenCount}列 非表示）</span>}
        <ChevronDown size={14} className="text-neutral-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 max-h-96 overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-lg py-1">
          {columns.map((c) => (
            <label
              key={c}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm ${c === fixed ? 'text-neutral-400 cursor-not-allowed' : 'text-neutral-700 hover:bg-neutral-50 cursor-pointer'}`}
            >
              <input type="checkbox" checked={c === fixed || !hidden.includes(c)} disabled={c === fixed} onChange={() => toggle(c)} />
              <span className="truncate" title={labelOf(c)}>{labelOf(c)}{c === fixed && '（固定）'}</span>
            </label>
          ))}
          <div className="border-t border-neutral-100 mt-1 pt-1">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={hiddenCount === 0}
              className={`w-full text-left px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:text-neutral-300 disabled:hover:bg-transparent disabled:cursor-not-allowed ${ui.focusRing}`}
            >
              初期表示に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
