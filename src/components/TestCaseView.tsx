import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bug, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ExternalLink, Loader2, RefreshCw, X, Trash2, Pencil, Save } from 'lucide-react';
import BugTransferForm from './BugTransferForm';
import BugSummary from './BugSummary';
import UcCheckGrid from './UcCheckGrid';
import {
  HIGHLIGHT_FIELDS, LONG_TEXT_FIELDS, PRIMARY_FIELDS, RESULT_COLOR, RETEST_OPTIONS, SECONDARY_FIELDS,
  UC_CHECK_ITEMS, UC_EDITABLE_FIELDS, UC_HIGHLIGHT_FIELDS, UC_PRIMARY_FIELDS, UC_SECONDARY_FIELDS,
  effectiveResult, isUnivContents, tcLabel, ucCheckShort, type TcRow,
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
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', 'テスト内容',
] as const;
const UC_KEYWORD_FIELDS = ['CMDB番号', 'course_no', 'course_name', '備考'] as const;

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
  // ケース番号 → 移管済み BUG。BUG 表を引いて判定するので、BUG を削除すれば自動的に戻る
  const [transferred, setTransferred] = useState<Record<string, { id: string; no: string }>>({});
  // ダイアログの表示モード: 詳細 / BUG移管フォーム / 移管済み BUG の内容
  const [dialogMode, setDialogMode] = useState<'detail' | 'transfer' | 'bug'>('detail');

  // 絞り込み。月次はヘッダ側 (年度の右) に移動し、既定は全年
  const [fMonth, setFMonth] = useState('');
  const [fKeyword, setFKeyword] = useState('');
  const [fResult, setFResult] = useState('');
  const [fVersion, setFVersion] = useState('');
  const [fMajor, setFMajor] = useState('');
  const [fMiddle, setFMiddle] = useState('');
  const [fMinor, setFMinor] = useState('');

  // UnivContents はブラウザ検証リストの別テンプレートで表示する (関連処理は共通)
  const uc = isUnivContents(system);
  const listColumns: readonly string[] = uc ? UC_LIST_COLUMNS : LIST_COLUMNS;
  const keywordFields: readonly string[] = uc ? UC_KEYWORD_FIELDS : KEYWORD_FIELDS;
  const editableFields = uc ? UC_EDITABLE_FIELDS : EDITABLE_FIELDS;
  const primaryFields: readonly string[] = uc ? UC_PRIMARY_FIELDS : PRIMARY_FIELDS;
  const highlightFields: readonly string[] = uc ? UC_HIGHLIGHT_FIELDS : HIGHLIGHT_FIELDS;
  const secondaryFields: readonly string[] = uc ? UC_SECONDARY_FIELDS : SECONDARY_FIELDS;
  const subtitleField = uc ? 'course_name' : '機能名';

  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

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
      if (fResult && (r['テスト結果'] || '') !== fResult) return false;
      if (fVersion && (r['バージョン'] || '') !== fVersion) return false;
      if (fMajor && (r['大分類'] || '') !== fMajor) return false;
      if (fMiddle && (r['中分類'] || '') !== fMiddle) return false;
      if (fMinor && (r['小分類'] || '') !== fMinor) return false;
      if (keywords.length) {
        const haystack = keywordFields.map((f) => r[f] || '').join(' ').toLowerCase();
        if (!keywords.every((k) => haystack.includes(k))) return false;
      }
      return true;
    });
  }, [rows, fMonth, fKeyword, fResult, fVersion, fMajor, fMiddle, fMinor, keywordFields]);

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

  const hasFilter = fKeyword || fResult || fVersion || fMajor || fMiddle || fMinor;
  const clearFilters = () => {
    setFKeyword(''); setFResult(''); setFVersion(''); setFMajor(''); setFMiddle(''); setFMinor('');
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

  const selectCls =
    'rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none';
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || sorted.length === 0}
            title={`Excel出力（絞り込んだ ${sorted.length}件 / Testcase Format と同じ書式）`}
            className="inline-flex items-center justify-center p-2 rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
          >
            {exporting
              ? <Loader2 size={14} className="animate-spin" />
              : <Download size={14} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
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
            <p className="text-[10px] text-neutral-400 font-semibold tracking-wider truncate">{c.label}</p>
            <p className={`text-2xl font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 絞り込み */}
      <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-end gap-3 flex-wrap">
        <label className="space-y-1 flex-1 min-w-[260px]">
          <span className="block text-[11px] font-semibold text-neutral-500">キーワード</span>
          <input
            value={fKeyword}
            onChange={(e) => setFKeyword(e.target.value)}
            placeholder={uc ? 'CMDB番号・course_no・course_name・備考を検索 (空白区切りで AND)' : 'CMDB番号・分類・機能名・テスト内容を検索 (空白区切りで AND)'}
            className={selectCls + ' w-full'}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">{tcLabel('テスト結果', uc)}</span>
          <select value={fResult} onChange={(e) => setFResult(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('テスト結果').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">バージョン</span>
          <select value={fVersion} onChange={(e) => setFVersion(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('バージョン').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        {!uc && (<>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">大分類</span>
          <select value={fMajor} onChange={(e) => setFMajor(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('大分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">中分類</span>
          <select value={fMiddle} onChange={(e) => setFMiddle(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('中分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">小分類</span>
          <select value={fMinor} onChange={(e) => setFMinor(e.target.value)} className={selectCls}>
            <option value="">すべて</option>
            {optionsOf('小分類').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        </>)}
        {hasFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-neutral-500 hover:text-neutral-800 pb-2"
          >
            条件クリア
          </button>
        )}
      </div>

      {/* 明細テーブル */}
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
        <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {listColumns.map((c) => (
                  <th
                    key={c}
                    className={th0 + ' cursor-pointer hover:bg-neutral-50 select-none'}
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
                <tr key={r.id} className="hover:bg-neutral-50 cursor-pointer" onClick={() => openDetail(r)}>
                  {listColumns.map((c) => {
                    const v = r[c] || '';
                    if (c === 'テスト結果' || UC_CHECK_SET.has(c)) {
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
                          (red ? ' text-red-600 font-medium' : '')
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
                          title="移管済みの BUG を表示"
                          className="px-2 py-1 rounded border border-red-200 bg-red-50 text-xs text-red-600 hover:bg-red-100 whitespace-nowrap"
                        >
                          移管済み No.{transferred[(r['ケース番号'] || '').trim()].no || '-'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openDetail(r, 'transfer')}
                          title="このケースから BUG を作成"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-100 whitespace-nowrap"
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
                        className="p-1 rounded border border-neutral-200 text-neutral-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40"
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
          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
              <span className="text-xs text-neutral-400">{sorted.length} 件中 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sorted.length)} 件</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
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
                        className={`min-w-[28px] h-7 rounded text-xs font-medium ${currentPage === p ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100 text-neutral-600'}`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 gap-2">
          {/* 左右の送り。閉じずに前後のケースを見られる */}
          <button
            type="button"
            onClick={() => stepDetail(-1)}
            disabled={editing || detailIndex <= 0 || dialogMode !== 'detail'}
            title={editing ? '編集中は移動できません。保存またはキャンセルしてください' : '前のケース'}
            className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
            {/* ヘッダ: ケース番号はここだけに出す (本文では重複させない) */}
            <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-baseline gap-3 min-w-0">
                {dialogMode === 'bug' ? (
                  <h3 className="text-lg font-bold text-neutral-900 truncate shrink-0">
                    BUG No.{transferred[(detail['ケース番号'] || '').trim()]?.no || '-'}
                  </h3>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-neutral-900 truncate shrink-0">
                      NO.{detail['ケース番号'] || '-'}
                    </h3>
                    {detail[subtitleField] && (
                      <span className="text-sm text-neutral-400 truncate">{detail[subtitleField]}</span>
                    )}
                    {changedCount(detail.id) > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-600"
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
                  <span className="text-[11px] text-neutral-400 tabular-nums">
                    {detailIndex + 1} / {sorted.length}
                  </span>
                )}
                {dialogMode === 'bug' && (
                  <button
                    type="button"
                    onClick={() => setDialogMode('detail')}
                    className="px-2.5 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-600 hover:bg-neutral-50 whitespace-nowrap"
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
                      className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      移管済み No.{transferred[(detail['ケース番号'] || '').trim()].no || '-'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDialogMode('transfer')}
                      disabled={editing}
                      title={editing ? '編集中は移管できません。保存またはキャンセルしてください' : 'このケースから BUG を作成'}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
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
                        className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        保存
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                      <Pencil size={14} />
                      編集
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {dialogError && (
              <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-center gap-2 shrink-0">
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
                        className="text-[11px] text-red-500 hover:text-red-700"
                      >
                        関連付け解除
                      </button>
                      <a
                        href={`https://www.notion.so/${(transferred[(detail['ケース番号'] || '').trim()]?.id ?? '').replace(/-/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-800"
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
                        <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                          変更あり
                        </span>
                      )}
                    </p>
                    {editing && editableFields.has(f) ? (
                      <textarea
                        value={draft[f] ?? ''}
                        onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                        rows={f === 'テスト内容' ? 3 : 4}
                        className="w-full text-sm border border-neutral-300 rounded-lg p-2 focus:border-neutral-500 focus:outline-none"
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
                      <p className="text-[11px] font-semibold text-neutral-400">{tcLabel(f, uc)}</p>
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
                        ) : <span className="text-sm text-neutral-400">-</span>
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
                    <p className="text-[11px] font-semibold text-orange-500">再テスト</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <p className="text-[10px] text-neutral-400">再テスト結果</p>
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
                        <p className="text-[10px] text-neutral-400">再実施日</p>
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
                        <p className="text-[10px] text-neutral-400">再実施者</p>
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
                        <p className="text-[11px] text-neutral-400 w-20 shrink-0 pt-0.5">{f}</p>
                        {canEdit ? (
                          isLong ? (
                            <textarea
                              value={draft[f] ?? ''}
                              onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                              rows={2}
                              className="flex-1 text-sm border border-neutral-300 rounded p-1.5 focus:border-neutral-500 focus:outline-none"
                            />
                          ) : (
                            <input
                              value={draft[f] ?? ''}
                              onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                              className="flex-1 text-sm border border-neutral-300 rounded px-2 py-1 focus:border-neutral-500 focus:outline-none"
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
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
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
            className="shrink-0 p-2 rounded-full bg-white/90 text-neutral-600 shadow-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
