// TestCase 画面のインポート。テンプレート (または TestCase 画面の Excel 出力) に記入した Excel を読み込み →
// 入力チェック・既存判定 (サーバー) → 既存ケースは上書き、それ以外は自動採番で追加する。
import { useState } from 'react';
import { AlertCircle, Download, Loader2, Upload, X } from 'lucide-react';

type ImportRow = { rowNo: number; values: Record<string, string> };
type Duplicate = { rowNo: number; caseNo: string; cmdbNo: string; system: string; existingContent: string };

// 1 リクエストで登録する行数の目安。Notion は約 3 req/s のため 50 行 ≒ 20 秒前後。
const IMPORT_BATCH_SIZE = 50;

export default function ImportTestcaseDialog({ year, onClose, onImported }: {
  year: number;
  onClose: () => void;
  onImported: (r: { created: number; updated: number }) => void;
}) {
  const [busy, setBusy] = useState<'' | 'template' | 'check' | 'import'>('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // 途中で失敗した場合の登録済み件数 (再実行時に合算して onImported へ渡す)
  const [doneCounts, setDoneCounts] = useState({ created: 0, updated: 0 });

  const downloadTemplate = async () => {
    setBusy('template');
    setError(null);
    try {
      const res = await fetch('/api/testcase/import-template');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || 'テンプレートの取得に失敗しました');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TestCaseインポートテンプレート.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'テンプレートの取得に失敗しました');
    } finally {
      setBusy('');
    }
  };

  const check = async (file: File) => {
    setBusy('check');
    setError(null);
    setFileName(file.name);
    setRows([]); setErrors([]); setDuplicates([]); setDoneCounts({ created: 0, updated: 0 });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('year', String(year));
      const res = await fetch('/api/testcase/import-check', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '読み込みに失敗しました');
      setRows(body.rows ?? []);
      setErrors(body.errors ?? []);
      setDuplicates(body.duplicates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setBusy('');
    }
  };

  // サーバー関数の実行時間上限 (Vercel maxDuration) を超えないよう分割して登録する。
  // 新規追加の行は採番が直前の登録結果に依存するため、同じ システム|CMDB番号 の新規行は同じバッチに入れる。
  const buildBatches = (): ImportRow[][] => {
    const dupRows = new Set(duplicates.map((d) => d.rowNo));
    const units: ImportRow[][] = [];
    const newGroups = new Map<string, ImportRow[]>();
    for (const r of rows) {
      if (dupRows.has(r.rowNo)) { units.push([r]); continue; }
      const key = `${r.values['システム'] ?? ''}|${r.values['CMDB番号'] ?? ''}`;
      const g = newGroups.get(key);
      if (g) g.push(r);
      else { const ng = [r]; newGroups.set(key, ng); units.push(ng); }
    }
    const batches: ImportRow[][] = [];
    let cur: ImportRow[] = [];
    for (const u of units) {
      if (cur.length > 0 && cur.length + u.length > IMPORT_BATCH_SIZE) { batches.push(cur); cur = []; }
      cur = cur.concat(u);
    }
    if (cur.length > 0) batches.push(cur);
    return batches;
  };

  const runImport = async () => {
    setBusy('import');
    setError(null);
    const batches = buildBatches();
    let { created, updated } = doneCounts;
    let done = 0;
    setProgress({ done: 0, total: rows.length });
    for (const batch of batches) {
      try {
        const res = await fetch('/api/testcase/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, rows: batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error || `登録に失敗しました（HTTP ${res.status}）`);
        created += (body as { created?: number }).created ?? 0;
        updated += (body as { updated?: number }).updated ?? 0;
        done += batch.length;
        setProgress({ done, total: rows.length });
      } catch (e) {
        // 登録済みのバッチは対象から外し、再度「登録」で残りだけを続行できるようにする
        const doneRowNos = new Set(batches.flat().slice(0, done).map((r) => r.rowNo));
        setRows(rows.filter((r) => !doneRowNos.has(r.rowNo)));
        setDuplicates(duplicates.filter((d) => !doneRowNos.has(d.rowNo)));
        setDoneCounts({ created, updated });
        setProgress(null);
        const msg = e instanceof Error ? e.message : '登録に失敗しました';
        setError(done > 0
          ? `${msg}\n${done}件は登録済みです。残り${rows.length - done}件は再度「登録」を押すと続行します。`
          : msg);
        setBusy('');
        return;
      }
    }
    onImported({ created, updated });
  };

  const canImport = rows.length > 0 && errors.length === 0 && !busy;
  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-xl border border-neutral-200 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-neutral-900">ケースインポート（登録先年度: {year}）</h3>
          <button type="button" onClick={onClose} disabled={busy === 'import'} className="text-neutral-400 hover:text-neutral-700 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm text-sky-800 space-y-1">
            <p>同じケース番号・CMDB番号の既存ケースがあれば上書きします（記入のある項目だけ更新・バージョン +1）。</p>
            <p>既存に無いケース番号・空欄の行は「CMDB番号-連番」で自動採番して追加します。</p>
            <p className="text-xs text-sky-700">TestCase 画面の「Excel出力」と同じ形式です。出力したファイルに結果を記入してそのまま取り込めます。</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={downloadTemplate} disabled={!!busy} className={btn}>
              {busy === 'template' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              ① テンプレートをダウンロード
            </button>
            <label className={btn + (busy ? ' opacity-40 pointer-events-none' : ' cursor-pointer')}>
              {busy === 'check' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              ② 記入したファイルを選択
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) check(f); }}
              />
            </label>
            {fileName && <span className="text-xs text-neutral-500 truncate">{fileName}</span>}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 flex items-start gap-2 text-sm whitespace-pre-wrap">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <p className="font-bold mb-1">エラーがあるため登録できません（{errors.length}件）。ファイルを修正して再度選択してください。</p>
              <ul className="list-disc pl-5 space-y-0.5 max-h-60 overflow-y-auto">
                {errors.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {rows.length > 0 && errors.length === 0 && (
            <p className="text-sm text-neutral-700">
              読み込み {rows.length}件
              （上書き {duplicates.length}件 / 新規追加 {rows.length - duplicates.length}件）
            </p>
          )}

          {errors.length === 0 && duplicates.length > 0 && (
            <div className="border border-amber-200 rounded-lg">
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-amber-800">上書きするケース</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-500 border-b border-neutral-200">
                    <th className="px-3 py-1.5">行</th>
                    <th className="px-3 py-1.5">システム</th>
                    <th className="px-3 py-1.5">ケース番号</th>
                    <th className="px-3 py-1.5">既存のテスト内容</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((d) => (
                    <tr key={d.rowNo} className="border-b border-neutral-100 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums">{d.rowNo}</td>
                      <td className="px-3 py-1.5">{d.system}</td>
                      <td className="px-3 py-1.5 tabular-nums">{d.caseNo}</td>
                      <td className="px-3 py-1.5 max-w-[280px] truncate" title={d.existingContent}>{d.existingContent || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-200 flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} disabled={busy === 'import'} className={btn}>キャンセル</button>
          <button
            type="button"
            onClick={runImport}
            disabled={!canImport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'import' && <Loader2 size={14} className="animate-spin" />}
            {busy === 'import' && progress ? `登録中 ${progress.done} / ${progress.total}件` : '登録'}
          </button>
        </div>
      </div>
    </div>
  );
}
