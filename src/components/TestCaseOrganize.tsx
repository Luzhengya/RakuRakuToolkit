import { useState } from 'react';
import {
  Upload,
  ClipboardList,
  Download,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFileUpload } from '../hooks/useFileUpload';

type GroupStat = {
  label: string;
  total: number;
  ok: number;
  block: number;
  ng: number;
  un: number;
  shimateki: number;
  blockCases: string[];
  ngCases: string[];
  unCases: string[];
  shimatekiCases: string[];
  ngReasons: { no: string; remark: string }[];
  blockReasons: { no: string; remark: string }[];
  unReasons: { no: string; remark: string }[];
};

type FileResult = {
  inputName: string;
  outputName: string;
  groups: GroupStat[];
};

type NotionResult = { created: number; updated: number; skipped: number };

type FormatResponse = {
  results: FileResult[];
  downloadBase64: string;
  downloadName: string;
  downloadMime: string;
  notionResult?: NotionResult | null;
  notionError?: string | null;
};

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function TestCaseOrganize({ onBack }: { onBack: () => void }) {
  const [response, setResponse] = useState<FormatResponse | null>(null);
  // Notion 登録先の選択ダイアログ
  const [dialogOpen, setDialogOpen] = useState(false);
  const [systems, setSystems] = useState<string[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState('');
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);

  const {
    files,
    loading,
    error,
    isDragging,
    fileInputRef,
    handleFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setLoading,
    setError,
  } = useFileUpload({ accept: ['.csv'], maxFiles: 20, skipUpload: true });

  // 「整形と集計を開始」→ まず登録先(システム/年度)を選ぶダイアログを開く
  const openDialog = () => {
    if (files.length === 0) return;
    setDialogOpen(true);
    if (systems.length === 0) {
      setSystemsLoading(true);
      fetch('/api/testcase-format/systems')
        .then((res) => (res.ok ? res.json() : { systems: [] }))
        .then((d: any) => {
          const list = (d?.systems ?? []) as string[];
          setSystems(list);
          if (list.length > 0) setSelectedSystem((cur) => cur || list[0]);
        })
        .catch(() => setSystems([]))
        .finally(() => setSystemsLoading(false));
    }
  };

  // withNotion=false の場合は system を送らず、Notion 登録をスキップして整形のみ実行
  const handleFormat = async (withNotion: boolean) => {
    if (files.length === 0) return;
    setDialogOpen(false);
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      if (withNotion && selectedSystem) {
        formData.append('system', selectedSystem);
        formData.append('year', String(selectedYear));
        formData.append('month', String(selectedMonth));
      }

      const res = await fetch('/api/testcase-format', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || '整形に失敗しました。再試行してください');
      }
      const data = (await res.json()) as FormatResponse;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '整形に失敗しました。再試行してください');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!response) return;
    const blob = base64ToBlob(response.downloadBase64, response.downloadMime);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const breadcrumb = (
    <nav className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
      >
        ホーム
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      <span className="text-neutral-900 font-medium">Testcase Format</span>
    </nav>
  );

  const casesLine = (label: string, count: number, cases: string[]) => (
    <div className="text-sm text-neutral-700">
      <span>{label}: {count}</span>
      {cases.length > 0 && (
        <span className="text-xs text-neutral-400 ml-1">（{cases.join(', ')}）</span>
      )}
    </div>
  );

  // 案件別の原因 (備考=キーワード後段)。備考が空なら「未記入」表示
  const reasonBlock = (label: string, reasons: { no: string; remark: string }[]) => {
    if (reasons.length === 0) return null;
    return (
      <div>
        <p className="text-xs text-amber-700">{label}:</p>
        <div className="pl-4 space-y-0.5">
          {reasons.map((x, i) => (
            <p key={i} className="text-xs text-neutral-600">
              <span className="text-neutral-500">{x.no || '-'}:</span>{' '}
              {x.remark.trim() ? x.remark : <span className="text-neutral-400">（未記入）</span>}
            </p>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {breadcrumb}

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Testcase Format</h2>
          <p className="text-neutral-500">テストケース CSV をアップロードして、標準 Excel 形式に整形し、テスト結果を集計します</p>
        </div>

        <div className="space-y-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-xl p-10 transition-all duration-300
              ${isDragging ? 'border-sky-500 bg-sky-50 scale-[1.01]' : files.length > 0 ? 'border-sky-400 bg-sky-50' : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50'}
            `}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
              accept=".csv"
              multiple
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${files.length > 0 || isDragging ? 'bg-sky-100 text-sky-600' : 'bg-white shadow-sm text-neutral-400'} group-hover:scale-110 transition-transform`}>
                {files.length > 0 ? <CheckCircle size={32} /> : <Upload size={32} />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-neutral-700">
                  {isDragging ? 'ドロップしてアップロード' : files.length > 0 ? `${files.length} 個のファイルを選択済み` : 'クリックまたはドラッグして CSV ファイルをアップロード'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">.csv 形式、最大 20 個、1ファイル 50MB まで対応</p>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            loading ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {files.length} 個のファイルを整形中...
                  </span>
                </div>
                <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full w-1/3 bg-sky-400 rounded-full"
                    animate={{ x: ['-100%', '300%'] }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={openDialog}
                className="w-full py-4 bg-neutral-900 text-white rounded-lg font-bold shadow-lg hover:bg-neutral-800 transition-all flex items-center justify-center gap-2"
              >
                <ClipboardList size={20} />
                整形と集計を開始
              </button>
            )
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600"
            >
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          <AnimatePresence>
            {response && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <button
                  onClick={handleDownload}
                  className="w-full py-3 bg-sky-600 text-white rounded-lg font-bold shadow hover:bg-sky-700 transition-all flex items-center justify-center gap-2"
                >
                  <Download size={18} />
                  {response.downloadName} をダウンロード
                </button>

                {/* Notion 登録結果 */}
                {response.notionResult && (
                  <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
                    <p className="text-sm font-bold text-emerald-800 mb-1">Notion 登録結果</p>
                    <div className="flex flex-wrap gap-4 text-sm text-emerald-900">
                      <span>新規 <b className="tabular-nums">{response.notionResult.created}</b> 件</span>
                      <span>更新 <b className="tabular-nums">{response.notionResult.updated}</b> 件</span>
                      <span>スキップ <b className="tabular-nums">{response.notionResult.skipped}</b> 件</span>
                    </div>
                  </div>
                )}
                {response.notionError && (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-bold">Notion 登録に失敗しました</p>
                      <p className="text-xs mt-0.5">{response.notionError}</p>
                      <p className="text-xs mt-0.5 text-amber-700">Excel の整形結果は正常に出力されています。</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {response.results.map((r) => (
                    <div key={r.inputName} className="border border-neutral-200 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-bold text-neutral-900 break-all">
                        ファイル名：{r.inputName}
                      </p>
                      {r.groups.map((g, idx) => (
                        <div key={idx} className="pl-3 border-l-2 border-sky-200 space-y-1">
                          <p className="text-sm font-semibold text-neutral-700">
                            テストケース{idx + 1}：{g.label || '（空）'}
                          </p>
                          <div className="text-sm text-neutral-700">テスト件数総計: {g.total}</div>
                          <div className="text-sm text-neutral-700">テストOK: {g.ok}</div>
                          {casesLine('テスト不可', g.block, g.blockCases)}
                          {casesLine('テストNG', g.ng, g.ngCases)}
                          {casesLine('未実施', g.un, g.unCases)}
                          {casesLine('指摘対応', g.shimateki, g.shimatekiCases)}
                          {(g.ng > 0 || g.block > 0 || g.un > 0) && (
                            <div className="mt-1 space-y-1.5">
                              {reasonBlock('テストNGの原因', g.ngReasons)}
                              {reasonBlock('テスト不可の原因', g.blockReasons)}
                              {reasonBlock('未実施の原因', g.unReasons)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="pt-4 border-t border-neutral-200">
        {breadcrumb}
      </div>

      {/* Notion 登録先の選択ダイアログ */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 shadow-xl p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900">Notion 登録先の選択</h3>
              <p className="text-xs text-neutral-500 mt-1">
                選択したシステム・年度の表（{selectedSystem || 'システム'}{selectedYear}）にテストケースを登録します。表が無い場合は自動作成されます。
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-neutral-600">システム</span>
              {systemsLoading ? (
                <span className="flex items-center gap-2 text-sm text-neutral-400 py-2">
                  <Loader2 size={14} className="animate-spin" />
                  読み込み中...
                </span>
              ) : systems.length > 0 ? (
                <select
                  value={selectedSystem}
                  onChange={(e) => setSelectedSystem(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none"
                >
                  {systems.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input
                  value={selectedSystem}
                  onChange={(e) => setSelectedSystem(e.target.value)}
                  placeholder="システム名を入力"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
                />
              )}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-neutral-600">年度 (テーブル単位)</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none"
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-neutral-600">月次 (行の属性)</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 bg-white focus:border-neutral-500 focus:outline-none"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleFormat(false)}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
                title="Notionへは登録せず、整形と集計のみ実行します"
              >
                Notion登録せず実行
              </button>
              <button
                type="button"
                onClick={() => handleFormat(true)}
                disabled={!selectedSystem}
                className="px-4 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed"
              >
                登録して実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
