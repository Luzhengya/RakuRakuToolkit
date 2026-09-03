import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X, Trash2, Pencil, Save } from 'lucide-react';

// Notion の「{システム}{年度}」テーブル 1 行 (属性名をキーにした素の文字列)
type TcRow = Record<string, string> & { id: string };

type ListResponse = {
  items: TcRow[];
  total: number;
  exists: boolean;
  dbTitle: string;
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
  '優先級',
  'バージョン',
] as const;

// キーワード検索の対象。複数キーワードは空白区切りで AND 検索する
const KEYWORD_FIELDS = [
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', 'テスト内容',
] as const;

// 詳細ダイアログで大きく見せる項目
const PRIMARY_FIELDS = ['テスト内容', '前提条件', 'ステップ', '予期結果'] as const;
// 詳細ダイアログの右側に出す重要項目
const HIGHLIGHT_FIELDS = ['テスト結果', '優先級'] as const;
// 残りの項目 (ケース番号はヘッダに出すので重複させない)
const SECONDARY_FIELDS = [
  'システム', '月次', 'CMDB番号',
  '大分類', '中分類', '小分類',
  '機能名', '要件名',
  'ポイント', 'カテゴリ', '状態',
  '作成者', '作成日', '更新者', '更新日',
  'バージョン', '関連NO', '備考',
] as const;

// サーバー側で編集を許可している項目 (api の TESTCASE_EDITABLE_FIELDS と対応)
const EDITABLE_FIELDS = new Set<string>([
  'CMDB番号', '大分類', '中分類', '小分類', '機能名', '要件名',
  'テスト内容', '前提条件', 'ステップ', '予期結果',
  'ポイント', '優先級', 'カテゴリ', '状態', 'テスト結果', '関連NO', '備考',
]);

const RESULT_OPTIONS = ['', 'OK', 'NG', 'テスト不可', '未実施'];

const RESULT_COLOR: Record<string, string> = {
  OK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NG: 'bg-red-50 text-red-700 border-red-200',
  'テスト不可': 'bg-amber-50 text-amber-700 border-amber-200',
  '未実施': 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

// 長文はダイアログで改行を保持したいので pre-wrap 対象にする項目
const LONG_TEXT_FIELDS = new Set(['前提条件', 'ステップ', '予期結果', 'テスト内容', '備考']);

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

  // 詳細ダイアログの編集
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // 削除中の行 id
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 絞り込み。月次はヘッダ側 (年度の右) に移動し、既定は全年
  const [fMonth, setFMonth] = useState('');
  const [fKeyword, setFKeyword] = useState('');
  const [fResult, setFResult] = useState('');
  const [fVersion, setFVersion] = useState('');
  const [fMajor, setFMajor] = useState('');
  const [fMiddle, setFMiddle] = useState('');
  const [fMinor, setFMinor] = useState('');

  // システム候補 (Testcase Format と同じ、進捗管理表から取得)
  useEffect(() => {
    let alive = true;
    fetch('/api/testcase-format/systems')
      .then((res) => (res.ok ? res.json() : { systems: [] }))
      .then((d: any) => {
        if (!alive) return;
        const list = (d?.systems ?? []) as string[];
        setSystems(list);
        if (list.length > 0) setSystem((cur) => cur || list[0]);
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
        const haystack = KEYWORD_FIELDS.map((f) => r[f] || '').join(' ').toLowerCase();
        if (!keywords.every((k) => haystack.includes(k))) return false;
      }
      return true;
    });
  }, [rows, fMonth, fKeyword, fResult, fVersion, fMajor, fMiddle, fMinor]);

  // 統計 (絞り込み結果に連動)
  const stats = useMemo(() => {
    const total = filtered.length;
    const by = (v: string) => filtered.filter((r) => (r['テスト結果'] || '') === v).length;
    return { total, ok: by('OK'), un: by('未実施'), block: by('テスト不可'), ng: by('NG') };
  }, [filtered]);

  const hasFilter = fKeyword || fResult || fVersion || fMajor || fMiddle || fMinor;
  const clearFilters = () => {
    setFKeyword(''); setFResult(''); setFVersion(''); setFMajor(''); setFMiddle(''); setFMinor('');
  };

  const openDetail = (r: TcRow) => {
    setDetail(r);
    setEditing(false);
    setDraft({});
    setDialogError(null);
  };

  const startEdit = () => {
    if (!detail) return;
    const d: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) d[f] = detail[f] || '';
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
          {/* 月次は年度の右。未選択なら通年を対象にする */}
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={selectCls}>
            <option value="">通年</option>
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
            placeholder="CMDB番号・分類・機能名・テスト内容を検索 (空白区切りで AND)"
            className={selectCls + ' w-full'}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold text-neutral-500">テスト結果</span>
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
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400">
          {rows.length === 0 ? 'データがありません' : '条件に一致するデータがありません'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {LIST_COLUMNS.map((c) => <th key={c} className={th0}>{c}</th>)}
                <th className={th0}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  {LIST_COLUMNS.map((c) => {
                    const v = r[c] || '';
                    if (c === 'テスト結果') {
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
                    const wide = c === 'テスト内容' || c === '機能名';
                    return (
                      <td key={c} className={td0 + (wide ? ' max-w-[280px] truncate' : '')} title={wide ? v : undefined}>
                        {v || '-'}
                      </td>
                    );
                  })}
                  <td className={td0}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openDetail(r)}
                        className="px-2 py-1 rounded border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-100"
                      >
                        詳細
                      </button>
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
        </div>
      )}

      {/* 詳細ダイアログ (縦に伸ばさず横に広げる) */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
            {/* ヘッダ: ケース番号はここだけに出す (本文では重複させない) */}
            <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-[11px] font-semibold text-neutral-400 shrink-0">ケース番号</span>
                <h3 className="text-lg font-bold text-neutral-900 truncate">
                  {detail['ケース番号'] || '-'}
                </h3>
                {detail['機能名'] && (
                  <span className="text-sm text-neutral-400 truncate">{detail['機能名']}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editing ? (
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

            {/* 本文: 重点項目を左に大きく、その他を右に畳んで横幅を使う */}
            <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5 overflow-auto">
              <div className="lg:col-span-2 space-y-4">
                {PRIMARY_FIELDS.map((f) => (
                  <div key={f} className="space-y-1">
                    <p className="text-xs font-bold text-neutral-700">{f}</p>
                    {editing && EDITABLE_FIELDS.has(f) ? (
                      <textarea
                        value={draft[f] ?? ''}
                        onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                        rows={f === 'テスト内容' ? 3 : 4}
                        className="w-full text-sm border border-neutral-300 rounded-lg p-2 focus:border-neutral-500 focus:outline-none"
                      />
                    ) : (
                      <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3.5rem]">
                        {detail[f] || '-'}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                {/* テスト結果・優先級は目立たせる */}
                <div className="grid grid-cols-2 gap-3">
                  {HIGHLIGHT_FIELDS.map((f) => (
                    <div key={f} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
                      <p className="text-[11px] font-semibold text-neutral-400">{f}</p>
                      {editing && f === 'テスト結果' ? (
                        <select
                          value={draft[f] ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                          className={selectCls + ' w-full'}
                        >
                          {RESULT_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o || '(未設定)'}</option>
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
                        <p className="text-lg font-bold text-neutral-900">{detail[f] || '-'}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                  {SECONDARY_FIELDS.map((f) => {
                    const canEdit = editing && EDITABLE_FIELDS.has(f);
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
          </div>
        </div>
      )}
    </div>
  );
}
