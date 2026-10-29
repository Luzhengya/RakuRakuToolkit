// BUG 一覧からの新規作成・編集ダイアログ。
// 新規: 案件を選ぶと システム/月次 (rollup) と No が決まる。No の確定は保存時にサーバーで行う。
// 編集: No・テスト案件名・ケース番号 は読み取り専用。本文 (詳細説明・截图) は Notion で編集する。
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Save, X } from 'lucide-react';
import { ScreenshotButtons, ScreenshotThumbs, useBugScreenshots } from './BugScreenshots';

// 編集できる項目 (api の BUG_EDITABLE_FIELDS のキーと同じ)
export type BugEditableFields = {
  bugDesc: string;
  actualResult: string;
  reproSteps: string;
  expectedResult: string;
  module: string;
  judgment: string;
  status: string;
  priority: string;
  execDate: string;
  assignee: string;
  browserVersion: string;
  appVersion: string;
  remarks: string;
};

export type EditableBug = BugEditableFields & {
  id: string;
  no: string;
  system: string;
  testCaseName: string;
  caseNumber: string;
};

interface Candidate {
  id: string;
  projectName: string;
  month: string;
  system: string;
}

interface NewContext {
  candidates: Candidate[];
  fieldOptions: { judgment: string[]; status: string[]; priority: string[] };
  defaults: { judgment: string; status: string; execDate: string; browserVersion: string; appVersion: string };
}

const FIELD_KEYS: (keyof BugEditableFields)[] = [
  'bugDesc', 'actualResult', 'reproSteps', 'expectedResult', 'module', 'judgment', 'status',
  'priority', 'execDate', 'assignee', 'browserVersion', 'appVersion', 'remarks',
];

// 実施者はログイン情報が無いので、このブラウザで前回入れた値を既定にする
const ASSIGNEE_KEY = 'bugEdit.assignee';

function readAssignee(): string {
  try { return localStorage.getItem(ASSIGNEE_KEY) ?? ''; } catch { return ''; }
}

function saveAssignee(v: string): void {
  try { if (v.trim()) localStorage.setItem(ASSIGNEE_KEY, v.trim()); } catch { /* 保存できなくても動作には影響しない */ }
}

// 一覧と同じ月の比較キー (2026-09 / 2026/9 / 202609 → 202609)
function monthKeyOf(value: string): string {
  const m = (value ?? '').match(/(\d{4})[-/.年]?(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, '0')}` : '';
}

function errorOf(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export type BugSavedResult = {
  bugId: string;
  isNew: boolean;
  fields: Partial<BugEditableFields>;
  notice: string;
};

export default function BugEditDialog({
  bug, initialSystem = '', initialMonthKey = '', onClose, onSaved,
}: {
  /** 渡されれば編集、無ければ新規 */
  bug?: EditableBug;
  /** 新規時の案件候補の初期絞り込み (一覧の絞り込みを引き継ぐ) */
  initialSystem?: string;
  initialMonthKey?: string;
  onClose: () => void;
  onSaved: (r: BugSavedResult) => void;
}) {
  const isNew = !bug;
  const [ctx, setCtx] = useState<NewContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<BugEditableFields>(() => {
    const f = {} as BugEditableFields;
    for (const k of FIELD_KEYS) f[k] = bug ? bug[k] ?? '' : '';
    return f;
  });
  const set = (k: keyof BugEditableFields, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // 新規: 案件の選択と No の候補
  const [caseFilterSystem, setCaseFilterSystem] = useState(initialSystem);
  const [caseFilterMonth, setCaseFilterMonth] = useState(initialMonthKey);
  const [caseKeyword, setCaseKeyword] = useState('');
  const [selectedCase, setSelectedCase] = useState('');
  const [nextNo, setNextNo] = useState('');
  const [nextNoLoading, setNextNoLoading] = useState(false);
  const [detailDesc, setDetailDesc] = useState('');
  const shots = useBugScreenshots();

  // 編集: 本文は読み取り専用で見せる
  const [bodyHtml, setBodyHtml] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/test-center/bugs/new-context')
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || '取得に失敗しました');
        return res.json() as Promise<NewContext>;
      })
      .then((d) => {
        if (!alive) return;
        setCtx(d);
        if (isNew) {
          setForm((p) => ({
            ...p,
            judgment: d.defaults.judgment,
            status: d.defaults.status,
            execDate: d.defaults.execDate,
            browserVersion: d.defaults.browserVersion,
            appVersion: d.defaults.appVersion,
            assignee: readAssignee(),
          }));
        }
      })
      .catch((e) => { if (alive) setError(errorOf(e, '取得に失敗しました')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isNew]);

  useEffect(() => {
    if (!bug) return;
    let alive = true;
    fetch(`/api/test-center/bugs/${encodeURIComponent(bug.id)}/children`)
      .then((r) => (r.ok ? r.json() : { html: '' }))
      .then((d: { html?: string }) => { if (alive) setBodyHtml(d.html ?? ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, [bug]);

  // 案件を選んだら、そのシステムでの No 候補を出す (確定は保存時)
  useEffect(() => {
    setNextNo('');
    if (!selectedCase) return;
    let alive = true;
    setNextNoLoading(true);
    fetch(`/api/test-center/bugs/next-no?caseId=${encodeURIComponent(selectedCase)}`)
      .then((r) => (r.ok ? r.json() : { nextNo: '' }))
      .then((d: { nextNo?: string }) => { if (alive) setNextNo(d.nextNo ?? ''); })
      .catch(() => {})
      .finally(() => { if (alive) setNextNoLoading(false); });
    return () => { alive = false; };
  }, [selectedCase]);

  const candidateSystems = useMemo(
    () => Array.from(new Set((ctx?.candidates ?? []).map((c) => c.system).filter(Boolean))).sort(),
    [ctx],
  );
  const candidateMonths = useMemo(
    () => Array.from(new Set((ctx?.candidates ?? []).map((c) => monthKeyOf(c.month)).filter(Boolean))).sort().reverse(),
    [ctx],
  );
  const filteredCandidates = useMemo(() => {
    const kw = caseKeyword.trim().toLowerCase();
    return (ctx?.candidates ?? []).filter((c) =>
      (!caseFilterSystem || c.system === caseFilterSystem)
      && (!caseFilterMonth || monthKeyOf(c.month) === caseFilterMonth)
      && (!kw || c.projectName.toLowerCase().includes(kw)));
  }, [ctx, caseFilterSystem, caseFilterMonth, caseKeyword]);

  // 絞り込みで選択中の案件が候補から消えたら選び直してもらう
  useEffect(() => {
    if (selectedCase && !filteredCandidates.some((c) => c.id === selectedCase)) setSelectedCase('');
  }, [filteredCandidates, selectedCase]);

  // 必須項目の未入力 (保存ボタンの title にも出す)
  const missing: string[] = [];
  if (isNew && !selectedCase) missing.push('テスト案件');
  if (!form.bugDesc.trim()) missing.push('Bug説明');
  if (!form.actualResult.trim()) missing.push('実際結果');
  const canSave = missing.length === 0 && !saving && !loading && !shots.uploading;
  const saveTitle = missing.length ? `未入力の必須項目: ${missing.join('、')}`
    : shots.uploading ? '截图のアップロード中です' : '';

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const res = await fetch('/api/test-center/bugs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, caseId: selectedCase, no: nextNo, detailDesc, imageIds: shots.imageIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error || '作成に失敗しました');
        const r = body as { bugId: string; bugNo: string; requestedNo?: string; skipped?: string[]; childrenError?: string | null };
        saveAssignee(form.assignee);
        const notes: string[] = [];
        if (r.requestedNo && r.requestedNo !== r.bugNo) notes.push(`No.${r.requestedNo} は使用済みのため No.${r.bugNo} で登録しました`);
        if (r.skipped?.length) notes.push(`次の項目は表側が書き込み不可のため反映されていません: ${r.skipped.join('、')}`);
        if (r.childrenError) notes.push(`詳細説明・截图の追加に失敗しました: ${r.childrenError}`);
        onSaved({ bugId: r.bugId, isNew: true, fields: form, notice: notes.join('\n') });
      } else {
        // 変わった項目だけ送る
        const changed: Partial<BugEditableFields> = {};
        for (const k of FIELD_KEYS) if (form[k] !== (bug![k] ?? '')) changed[k] = form[k];
        if (Object.keys(changed).length === 0) { onClose(); return; }
        const res = await fetch(`/api/test-center/bugs/${encodeURIComponent(bug!.id)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changed),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error || '更新に失敗しました');
        if (changed.assignee !== undefined) saveAssignee(changed.assignee);
        onSaved({ bugId: bug!.id, isNew: false, fields: changed, notice: '' });
      }
    } catch (e) {
      setError(errorOf(e, '保存に失敗しました'));
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none';
  const labelCls = 'text-[11px] font-semibold text-neutral-500';
  const req = <span className="text-red-500">*</span>;
  const opts = ctx?.fieldOptions ?? { judgment: [], status: [], priority: [] };

  // 選択肢が取れない表でも値は失わないよう、現在値を候補に含める
  const selectWith = (k: keyof BugEditableFields, options: string[], allowEmpty: boolean) => {
    const list = form[k] && !options.includes(form[k]) ? [form[k], ...options] : options;
    return list.length > 0 ? (
      <select value={form[k]} onChange={(e) => set(k, e.target.value)} className={inputCls}>
        {(allowEmpty || !form[k]) && <option value="">-</option>}
        {list.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input type="text" value={form[k]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
    );
  };

  const textArea = (k: keyof BugEditableFields, label: string, rows: number, required = false, placeholder?: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-neutral-700">{label} {required && req}</span>
      <textarea value={form[k]} onChange={(e) => set(k, e.target.value)} rows={rows} placeholder={placeholder} className={inputCls} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-lg font-bold text-neutral-900 shrink-0">
              {isNew ? 'BUG 新規作成' : `BUG No.${bug!.no || '-'} 編集`}
            </h3>
            {!isNew && <span className="text-sm text-neutral-400 truncate">{bug!.system}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-neutral-400"><span className="text-red-500">*</span> は必須</span>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={saveTitle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
            <button type="button" onClick={onClose} disabled={saving} className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-40">
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2 shrink-0">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
        )}

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-neutral-500">
            <Loader2 size={16} className="animate-spin" /> 読み込み中...
          </div>
        ) : (
          <div className="p-5 overflow-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {textArea('bugDesc', 'Bug説明', 2, true, '一覧に表示される件名です')}
              {textArea('actualResult', '実際結果', 4, true, '実際に起きたことを記入してください')}

              {isNew ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-700">詳細説明</span>
                    <ScreenshotButtons shots={shots} />
                  </div>
                  <textarea
                    value={detailDesc}
                    onChange={(e) => setDetailDesc(e.target.value)}
                    onPaste={shots.handlePaste}
                    rows={3}
                    placeholder="詳細な説明（Ctrl+V で画像を貼り付け可）"
                    className={inputCls}
                  />
                  <ScreenshotThumbs shots={shots} />
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-700">詳細説明・截图</span>
                    <a
                      href={`https://www.notion.so/${bug!.id.replace(/-/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-800"
                    >
                      <ExternalLink size={12} />
                      Notion で開く（本文・画像の編集はこちら）
                    </a>
                  </div>
                  {bodyHtml.trim() ? (
                    <div
                      className="notion-content text-sm text-neutral-700 border border-neutral-200 rounded-lg p-3 bg-neutral-50 max-h-64 overflow-auto [&_img]:max-w-full [&_img]:max-h-[240px] [&_img]:rounded-lg [&_img]:object-contain [&_img]:my-2"
                      dangerouslySetInnerHTML={{ __html: bodyHtml }}
                    />
                  ) : (
                    <p className="text-sm text-neutral-400 border border-neutral-200 rounded-lg p-3 bg-neutral-50">なし</p>
                  )}
                </div>
              )}

              {textArea('reproSteps', '再現ステップ', 3)}
              {textArea('expectedResult', '予定結果', 3)}
              {textArea('remarks', '備考', 2)}
            </div>

            <div className="space-y-3">
              {isNew ? (
                <div className="border border-neutral-200 rounded-lg p-3 space-y-2">
                  <span className={labelCls}>テスト案件 {req}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={caseFilterSystem} onChange={(e) => setCaseFilterSystem(e.target.value)} className={inputCls}>
                      <option value="">全システム</option>
                      {candidateSystems.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={caseFilterMonth} onChange={(e) => setCaseFilterMonth(e.target.value)} className={inputCls}>
                      <option value="">全期間</option>
                      {candidateMonths.map((m) => <option key={m} value={m}>{`${m.slice(0, 4)}/${m.slice(4)}`}</option>)}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={caseKeyword}
                    onChange={(e) => setCaseKeyword(e.target.value)}
                    placeholder="案件名で絞り込み"
                    className={inputCls}
                  />
                  <select value={selectedCase} onChange={(e) => setSelectedCase(e.target.value)} className={inputCls}>
                    <option value="">選択してください（{filteredCandidates.length}件）</option>
                    {filteredCandidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.projectName}{c.month ? `（${c.month}）` : ''}</option>
                    ))}
                  </select>
                  <p className="text-xs text-neutral-500">
                    No：{nextNoLoading ? '採番中...' : nextNo ? <b className="tabular-nums text-neutral-800">{nextNo}</b> : '-'}
                    <span className="text-neutral-400">（自動採番。保存時に確定）</span>
                  </p>
                </div>
              ) : (
                <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 text-xs">
                  {[['No', bug!.no], ['テスト案件名', bug!.testCaseName], ['ケース番号', bug!.caseNumber]].map(([k, v]) => (
                    <div key={k} className="px-3 py-2 flex items-start gap-3">
                      <span className="text-neutral-400 w-20 shrink-0">{k}</span>
                      <span className="text-neutral-700 break-words min-w-0">{v || '-'}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className={labelCls}>判定</span>
                  {selectWith('judgment', opts.judgment, true)}
                </label>
                <label className="block space-y-1">
                  <span className={labelCls}>ステータス</span>
                  {selectWith('status', opts.status, true)}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className={labelCls}>優先度</span>
                  {selectWith('priority', opts.priority, true)}
                </label>
                <label className="block space-y-1">
                  <span className={labelCls}>モジュール</span>
                  <input type="text" value={form.module} onChange={(e) => set('module', e.target.value)} className={inputCls} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className={labelCls}>実施日</span>
                  <input type="date" value={form.execDate.slice(0, 10)} onChange={(e) => set('execDate', e.target.value)} className={inputCls} />
                </label>
                <label className="block space-y-1">
                  <span className={labelCls}>実施者</span>
                  <input type="text" value={form.assignee} onChange={(e) => set('assignee', e.target.value)} className={inputCls} />
                </label>
              </div>

              <label className="block space-y-1">
                <span className={labelCls}>ブラウザ / バージョン</span>
                <input type="text" value={form.browserVersion} onChange={(e) => set('browserVersion', e.target.value)} className={inputCls} />
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>アプリバージョン（複数は , 区切り）</span>
                <input type="text" value={form.appVersion} onChange={(e) => set('appVersion', e.target.value)} className={inputCls} />
              </label>
            </div>
          </div>
        )}
      </div>
      {shots.editor}
    </div>
  );
}
