import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bug, Camera, Image, Link2, Loader2, Plus, Send, X } from 'lucide-react';
import { captureScreen } from '../utils/captureScreen';
import ScreenshotEditor from './ScreenshotEditor';

interface Candidate {
  id: string;
  projectName: string;
  month: string;
  system: string;
}

interface BugContext {
  candidates: Candidate[];
  nextNo: string;
  defaults: {
    bugDesc: string;
    judgment: string;
    status: string;
    module: string;
    reproSteps: string;
    expectedResult: string;
    priority: string;
    caseNumber: string;
    execDate: string;
    assignee: string;
    browserVersion: string;
    appVersion: string;
  };
  fieldOptions: { judgment: string[]; status: string[]; priority: string[] };
}

interface LinkableBug {
  id: string;
  no: string;
  bugDesc: string;
  caseNumbers: string[];
  month: string;
}

interface ScreenshotItem {
  file: File;
  preview: string;
  dataUrl: string;
  uploading: boolean;
  fileUploadId: string | null;
  error: string | null;
}

function pickDefault(options: string[], preferred: string): string {
  if (options.length === 0) return preferred;
  return options.includes(preferred) ? preferred : '';
}

type Mode = 'create' | 'link';

export default function BugTransferForm({
  caseId, year, onDone, onCancel,
}: {
  caseId: string;
  year: number;
  onDone: (bugId: string, bugNo: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>('create');

  // -- 共有 state --
  const [ctx, setCtx] = useState<BugContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // -- 新規作成 state --
  const [selectedCase, setSelectedCase] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [detailDesc, setDetailDesc] = useState('');
  const [bugDesc, setBugDesc] = useState('');
  const [judgment, setJudgment] = useState('NG');
  const [status, setStatus] = useState('対応待ち');
  const [moduleVal, setModuleVal] = useState('');
  const [priorityVal, setPriorityVal] = useState('');
  const [execDate, setExecDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [browserVersion, setBrowserVersion] = useState('');
  const [appVersion, setAppVersion] = useState('');

  // -- 截图 state --
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editorImage, setEditorImage] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // -- 関連付け state --
  const [linkableBugs, setLinkableBugs] = useState<LinkableBug[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [selectedBugId, setSelectedBugId] = useState('');
  const [linkFilter, setLinkFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/testcase/${encodeURIComponent(caseId)}/bug-context?year=${year}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<BugContext>;
      })
      .then((d) => {
        if (!alive) return;
        setCtx(d);
        setBugDesc(d.defaults.bugDesc);
        setJudgment(pickDefault(d.fieldOptions.judgment, d.defaults.judgment));
        setStatus(pickDefault(d.fieldOptions.status, d.defaults.status));
        setPriorityVal(pickDefault(d.fieldOptions.priority, d.defaults.priority));
        setModuleVal(d.defaults.module);
        setExecDate(d.defaults.execDate);
        setAssignee(d.defaults.assignee);
        setBrowserVersion(d.defaults.browserVersion);
        setAppVersion(d.defaults.appVersion);
        if (d.candidates.length === 1) setSelectedCase(d.candidates[0].id);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [caseId, year]);

  const loadLinkableBugs = () => {
    setLinkLoading(true);
    setError(null);
    fetch(`/api/testcase/${encodeURIComponent(caseId)}/linkable-bugs?year=${year}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<{ items: LinkableBug[] }>;
      })
      .then((d) => setLinkableBugs(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
      .finally(() => setLinkLoading(false));
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSelectedBugId('');
    setLinkFilter('');
    if (m === 'link' && linkableBugs.length === 0) loadLinkableBugs();
  };

  const dataUrlToFile = (dataUrl: string, name: string): File => {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  };

  const uploadScreenshot = async (file: File, dataUrl?: string) => {
    const preview = URL.createObjectURL(file);
    const du = dataUrl ?? await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    const item: ScreenshotItem = { file, preview, dataUrl: du, uploading: true, fileUploadId: null, error: null };
    setScreenshots((prev) => [...prev, item]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/testcase/upload-bug-image', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || 'アップロード失敗');
      const fid = (body as { fileUploadId: string }).fileUploadId;
      setScreenshots((prev) =>
        prev.map((s) => (s.preview === preview ? { ...s, uploading: false, fileUploadId: fid } : s)),
      );
    } catch (e) {
      setScreenshots((prev) =>
        prev.map((s) =>
          s.preview === preview ? { ...s, uploading: false, error: e instanceof Error ? e.message : 'アップロード失敗' } : s,
        ),
      );
    }
  };

  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) uploadScreenshot(f);
    }
  };

  const removeScreenshot = (preview: string) => {
    setScreenshots((prev) => {
      const removed = prev.filter((s) => s.preview !== preview);
      URL.revokeObjectURL(preview);
      return removed;
    });
  };

  const handlePaste = (e: { clipboardData: DataTransfer | null; preventDefault: () => void }) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  };

  const startCapture = async () => {
    const dataUrl = await captureScreen();
    if (dataUrl) setEditorImage(dataUrl);
  };

  const onEditorDone = (editedDataUrl: string) => {
    if (editingIndex !== null) {
      // re-edit existing screenshot: replace it
      const old = screenshots[editingIndex];
      URL.revokeObjectURL(old.preview);
      const file = dataUrlToFile(editedDataUrl, `screenshot-${Date.now()}.png`);
      const preview = URL.createObjectURL(file);
      const item: ScreenshotItem = { file, preview, dataUrl: editedDataUrl, uploading: true, fileUploadId: null, error: null };
      setScreenshots((prev) => prev.map((s, i) => i === editingIndex ? item : s));
      setEditingIndex(null);
      setEditorImage(null);
      // upload
      const fd = new FormData();
      fd.append('file', file);
      fetch('/api/testcase/upload-bug-image', { method: 'POST', body: fd })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((body as { error?: string }).error || 'アップロード失敗');
          const fid = (body as { fileUploadId: string }).fileUploadId;
          setScreenshots((prev) => prev.map((s) => s.preview === preview ? { ...s, uploading: false, fileUploadId: fid } : s));
        })
        .catch((e) => {
          setScreenshots((prev) => prev.map((s) => s.preview === preview ? { ...s, uploading: false, error: e instanceof Error ? e.message : 'アップロード失敗' } : s));
        });
    } else {
      // new screenshot from capture
      const file = dataUrlToFile(editedDataUrl, `screenshot-${Date.now()}.png`);
      uploadScreenshot(file, editedDataUrl);
      setEditorImage(null);
    }
  };

  const onEditorCancel = () => {
    setEditorImage(null);
    setEditingIndex(null);
  };

  const openEditor = (index: number) => {
    const s = screenshots[index];
    setEditingIndex(index);
    setEditorImage(s.dataUrl);
  };

  const submitCreate = async () => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/testcase/${encodeURIComponent(caseId)}/transfer-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: selectedCase,
          no: ctx.nextNo,
          bugDesc,
          actualResult,
          detailDesc,
          judgment,
          status,
          module: moduleVal,
          reproSteps: ctx.defaults.reproSteps,
          expectedResult: ctx.defaults.expectedResult,
          priority: priorityVal,
          caseNumber: ctx.defaults.caseNumber,
          execDate,
          assignee,
          browserVersion,
          appVersion,
          imageIds: screenshots.filter((s) => s.fileUploadId).map((s) => s.fileUploadId),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '移管に失敗しました');
      const r = body as { bugId: string; bugNo: string; resultUpdated?: boolean; resultError?: string };
      if (r.resultUpdated === false) {
        setError(`BUG は作成しましたが、テスト結果を NG にできませんでした: ${r.resultError ?? ''}`);
        setSaving(false);
        return;
      }
      onDone(r.bugId, r.bugNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : '移管に失敗しました');
      setSaving(false);
    }
  };

  const submitLink = async () => {
    if (!selectedBugId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/testcase/${encodeURIComponent(caseId)}/link-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bugId: selectedBugId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '関連付けに失敗しました');
      const r = body as { bugId: string; bugNo: string; resultUpdated?: boolean; resultError?: string };
      if (r.resultUpdated === false) {
        setError(`関連付けは完了しましたが、テスト結果を NG にできませんでした: ${r.resultError ?? ''}`);
        setSaving(false);
        return;
      }
      onDone(r.bugId, r.bugNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : '関連付けに失敗しました');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none';
  const labelCls = 'text-[11px] font-semibold text-neutral-500';

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500 py-4">
        <Loader2 size={15} className="animate-spin" />
        移管情報を読み込み中...
      </div>
    );
  }

  const noCandidate = !ctx || ctx.candidates.length === 0;
  const screenshotUploading = screenshots.some((s) => s.uploading);
  const canSubmitCreate = !!selectedCase && !!actualResult.trim() && !!judgment && !!status && !saving && !screenshotUploading;
  const canSubmitLink = !!selectedBugId && !saving;

  const filteredBugs = linkFilter.trim()
    ? linkableBugs.filter((b) => {
        const q = linkFilter.trim().toLowerCase();
        return b.no.toLowerCase().includes(q)
          || b.bugDesc.toLowerCase().includes(q)
          || b.caseNumbers.some((cn) => cn.includes(q));
      })
    : linkableBugs;

  // 月次でグループ化（API は月次降順で返すのでそのまま）
  const bugsByMonth: { month: string; bugs: LinkableBug[] }[] = [];
  for (const b of filteredBugs) {
    const m = b.month || '不明';
    const last = bugsByMonth[bugsByMonth.length - 1];
    if (last && last.month === m) last.bugs.push(b);
    else bugsByMonth.push({ month: m, bugs: [b] });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Bug size={15} className="text-red-500" />
          <h4 className="text-sm font-bold text-neutral-800">BUG移管</h4>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[11px] text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>

      {/* モード切替 */}
      <div className="bg-neutral-100 rounded-lg p-1 inline-flex gap-1">
        <button
          type="button"
          onClick={() => switchMode('create')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === 'create' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Plus size={14} />
          新規作成
        </button>
        <button
          type="button"
          onClick={() => switchMode('link')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === 'link' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Link2 size={14} />
          既存BUGに関連付け
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {mode === 'create' ? (
        /* ── 新規作成モード ── */
        noCandidate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
            対応するテスト案件が見つかりませんでした。BUG のシステム・月次は案件から
            決まるため、案件を特定できないと移管できません。
            <span className="block mt-1 text-[11px]">
              案件名の先頭が CMDB番号 になっているか、進捗管理表に該当案件があるか確認してください。
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-neutral-700">
                  実際結果 <span className="text-red-500">*</span>
                </span>
                <textarea
                  value={actualResult}
                  onChange={(e) => setActualResult(e.target.value)}
                  rows={4}
                  placeholder="実際に起きたことを記入してください"
                  className={inputCls}
                />
              </label>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-neutral-700">詳細説明</span>
                  <button
                    type="button"
                    onClick={startCapture}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700"
                  >
                    <Camera size={12} />
                    截图
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700"
                  >
                    <Image size={12} />
                    ファイル
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                  />
                </div>
                <textarea
                  value={detailDesc}
                  onChange={(e) => setDetailDesc(e.target.value)}
                  onPaste={handlePaste}
                  rows={3}
                  placeholder="詳細な説明（Ctrl+V で画像を貼り付け可）"
                  className={inputCls}
                />
                {screenshots.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {screenshots.map((s, idx) => (
                      <div key={s.preview} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50 cursor-pointer"
                        onClick={() => !s.uploading && openEditor(idx)}>
                        <img src={s.preview} alt="" className="w-full h-full object-cover" />
                        {s.uploading && (
                          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                            <Loader2 size={16} className="animate-spin text-neutral-500" />
                          </div>
                        )}
                        {s.error && (
                          <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                            <AlertCircle size={16} className="text-red-600" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeScreenshot(s.preview); }}
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/50 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-neutral-700">Bug説明</span>
                <textarea
                  value={bugDesc}
                  onChange={(e) => setBugDesc(e.target.value)}
                  rows={3}
                  className={inputCls}
                />
              </label>

              {[['再現ステップ', ctx!.defaults.reproSteps], ['予定結果', ctx!.defaults.expectedResult]].map(([k, v]) => (
                <div key={k} className="space-y-1">
                  <p className="text-xs font-bold text-neutral-700">{k}</p>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3rem]">
                    {v || '-'}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className={labelCls}>
                  テスト案件 <span className="text-red-500">*</span>
                </span>
                <select
                  value={selectedCase}
                  onChange={(e) => setSelectedCase(e.target.value)}
                  className={inputCls}
                >
                  <option value="">選択してください</option>
                  {ctx!.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.projectName}{c.month ? `（${c.month}）` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className={labelCls}>
                    判定 <span className="text-red-500">*</span>
                  </span>
                  <select value={judgment} onChange={(e) => setJudgment(e.target.value)} className={inputCls}>
                    {!judgment && <option value="">選択してください</option>}
                    {(ctx!.fieldOptions.judgment.length ? ctx!.fieldOptions.judgment : ['NG']).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className={labelCls}>
                    ステータス <span className="text-red-500">*</span>
                  </span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                    {!status && <option value="">選択してください</option>}
                    {(ctx!.fieldOptions.status.length ? ctx!.fieldOptions.status : ['対応待ち']).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="px-3 py-1.5 flex items-center gap-3 border border-neutral-200 rounded-lg text-xs">
                <span className="text-neutral-400 w-20 shrink-0">ケース番号</span>
                <span className="text-neutral-700">{ctx!.defaults.caseNumber || '-'}</span>
              </div>

              <label className="block space-y-1">
                <span className={labelCls}>モジュール</span>
                <input type="text" value={moduleVal} onChange={(e) => setModuleVal(e.target.value)} className={inputCls} />
              </label>

              <label className="block space-y-1">
                <span className={labelCls}>優先度</span>
                {ctx!.fieldOptions.priority.length > 0 ? (
                  <select value={priorityVal} onChange={(e) => setPriorityVal(e.target.value)} className={inputCls}>
                    <option value="">-</option>
                    {ctx!.fieldOptions.priority.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={priorityVal} onChange={(e) => setPriorityVal(e.target.value)} className={inputCls} />
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className={labelCls}>実施日</span>
                  <input type="date" value={execDate} onChange={(e) => setExecDate(e.target.value)} className={inputCls} />
                </label>
                <label className="block space-y-1">
                  <span className={labelCls}>実施者</span>
                  <input type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls} />
                </label>
              </div>

              <label className="block space-y-1">
                <span className={labelCls}>ブラウザ</span>
                <input type="text" value={browserVersion} onChange={(e) => setBrowserVersion(e.target.value)} className={inputCls} />
              </label>

              <label className="block space-y-1">
                <span className={labelCls}>アプリ</span>
                <input type="text" value={appVersion} onChange={(e) => setAppVersion(e.target.value)} className={inputCls} />
              </label>

              <button
                type="button"
                onClick={submitCreate}
                disabled={!canSubmitCreate}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                BUG を作成
              </button>
            </div>
          </div>
        )
      ) : (
        /* ── 既存BUG関連付けモード ── */
        <div className="space-y-3">
          {linkLoading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500 py-4">
              <Loader2 size={15} className="animate-spin" />
              既存BUGを読み込み中...
            </div>
          ) : linkableBugs.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
              同じシステムの既存 BUG が見つかりませんでした。
            </div>
          ) : (
            <>
              <input
                type="text"
                value={linkFilter}
                onChange={(e) => setLinkFilter(e.target.value)}
                placeholder="No / 説明 / ケース番号で絞り込み..."
                className={inputCls}
              />
              <div className="max-h-[20rem] overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {bugsByMonth.map((group) => (
                  <div key={group.month}>
                    <div className="px-3 py-1.5 bg-neutral-50 text-[11px] font-semibold text-neutral-500 sticky top-0">
                      {group.month}
                    </div>
                    {group.bugs.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBugId(b.id === selectedBugId ? '' : b.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                          selectedBugId === b.id
                            ? 'bg-red-50 border-l-2 border-l-red-500'
                            : 'hover:bg-neutral-50'
                        }`}
                      >
                        <span className="shrink-0 rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums mt-0.5">
                          #{b.no}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-neutral-800 line-clamp-2">{b.bugDesc || '（説明なし）'}</p>
                          {b.caseNumbers.length > 0 && (
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              関連ケース: {b.caseNumbers.join(', ')}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
                {filteredBugs.length === 0 && (
                  <p className="px-3 py-4 text-sm text-neutral-400 text-center">
                    該当する BUG がありません
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={submitLink}
                disabled={!canSubmitLink}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                BUG に関連付け
              </button>
            </>
          )}
        </div>
      )}
      {editorImage && (
        <ScreenshotEditor
          imageDataUrl={editorImage}
          onDone={onEditorDone}
          onCancel={onEditorCancel}
        />
      )}
    </div>
  );
}
