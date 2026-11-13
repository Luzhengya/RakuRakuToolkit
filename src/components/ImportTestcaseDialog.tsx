// TestCase 画面のインポート。テンプレートをダウンロード → 記入した Excel を読み込み →
// 入力チェック・重複判定 (サーバー) → 重複行ごとに 新規追加/上書き を選んで登録する。
import { useState } from 'react';
import { AlertCircle, Download, Loader2, Upload, X } from 'lucide-react';

type ImportRow = { rowNo: number; values: Record<string, string> };
type Duplicate = { rowNo: number; caseNo: string; cmdbNo: string; system: string; existingContent: string };

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
  // 上書きする行番号。含まれない重複行は新しい番号で追加する
  const [overwrite, setOverwrite] = useState<Set<number>>(new Set());

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
    setRows([]); setErrors([]); setDuplicates([]); setOverwrite(new Set());
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

  const runImport = async () => {
    setBusy('import');
    setError(null);
    try {
      const res = await fetch('/api/testcase/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, rows, overwrite: [...overwrite] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '登録に失敗しました');
      onImported(body as { created: number; updated: number });
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
      setBusy('');
    }
  };

  const toggle = (rowNo: number, on: boolean) => setOverwrite((prev) => {
    const next = new Set(prev);
    if (on) next.add(rowNo); else next.delete(rowNo);
    return next;
  });

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
            <p>ケース番号を空欄にすると「CMDB番号-連番」で自動採番して登録します。</p>
            <p>ケース番号を記入した場合は、同じケース番号・CMDB番号の既存ケースがあるか重複判定します。</p>
            <p className="text-xs text-sky-700">重複した行は「新規追加（新しい番号で登録）」か「上書き（空欄の項目は既存値を保持）」を選択できます。</p>
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
              {duplicates.length > 0 && <>（うち重複 {duplicates.length}件: 上書き {overwrite.size} / 新規追加 {duplicates.length - overwrite.size}）</>}
            </p>
          )}

          {errors.length === 0 && duplicates.length > 0 && (
            <div className="border border-amber-200 rounded-lg">
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-amber-800">重複ケース</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setOverwrite(new Set())} className="text-amber-700 hover:underline">すべて新規追加</button>
                  <button type="button" onClick={() => setOverwrite(new Set(duplicates.map((d) => d.rowNo)))} className="text-amber-700 hover:underline">すべて上書き</button>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-500 border-b border-neutral-200">
                    <th className="px-3 py-1.5">行</th>
                    <th className="px-3 py-1.5">システム</th>
                    <th className="px-3 py-1.5">ケース番号</th>
                    <th className="px-3 py-1.5">既存のテスト内容</th>
                    <th className="px-3 py-1.5">処理</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((d) => (
                    <tr key={d.rowNo} className="border-b border-neutral-100 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums">{d.rowNo}</td>
                      <td className="px-3 py-1.5">{d.system}</td>
                      <td className="px-3 py-1.5 tabular-nums">{d.caseNo}</td>
                      <td className="px-3 py-1.5 max-w-[280px] truncate" title={d.existingContent}>{d.existingContent || '-'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <label className="mr-3"><input type="radio" checked={!overwrite.has(d.rowNo)} onChange={() => toggle(d.rowNo, false)} /> 新規追加</label>
                        <label><input type="radio" checked={overwrite.has(d.rowNo)} onChange={() => toggle(d.rowNo, true)} /> 上書き</label>
                      </td>
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
            登録
          </button>
        </div>
      </div>
    </div>
  );
}
