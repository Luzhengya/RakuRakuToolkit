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
};

type FileResult = {
  inputName: string;
  outputName: string;
  groups: GroupStat[];
};

type FormatResponse = {
  results: FileResult[];
  downloadBase64: string;
  downloadName: string;
  downloadMime: string;
};

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function TestCaseOrganize({ onBack }: { onBack: () => void }) {
  const [response, setResponse] = useState<FormatResponse | null>(null);

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

  const handleFormat = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/testcase-format', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || '整形失败，请重试');
      }
      const data = (await res.json()) as FormatResponse;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '整形失败，请重试');
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
        首页
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {breadcrumb}

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Testcase Format</h2>
          <p className="text-neutral-500">上传测试用例 CSV，整形为标准 Excel 格式并汇总测试结果</p>
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
                  {isDragging ? '松开鼠标以上传文件' : files.length > 0 ? `已选择 ${files.length} 个文件` : '点击或拖拽上传 CSV 文件'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">支持 .csv 格式，最多 20 个，单文件最大 50MB</p>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            loading ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    正在整形 {files.length} 个文件...
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
                onClick={handleFormat}
                className="w-full py-4 bg-neutral-900 text-white rounded-lg font-bold shadow-lg hover:bg-neutral-800 transition-all flex items-center justify-center gap-2"
              >
                <ClipboardList size={20} />
                开始整形并汇总
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
                  下载 {response.downloadName}
                </button>

                <div className="space-y-4">
                  {response.results.map((r) => (
                    <div key={r.inputName} className="border border-neutral-200 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-bold text-neutral-900 break-all">
                        文件名：{r.inputName}
                      </p>
                      {r.groups.map((g, idx) => (
                        <div key={idx} className="pl-3 border-l-2 border-sky-200 space-y-1">
                          <p className="text-sm font-semibold text-neutral-700">
                            用例{idx + 1}：{g.label || '（空）'}
                          </p>
                          <div className="text-sm text-neutral-700">テスト件数総計: {g.total}</div>
                          <div className="text-sm text-neutral-700">テストOK: {g.ok}</div>
                          {casesLine('テスト不可', g.block, g.blockCases)}
                          {casesLine('テストNG', g.ng, g.ngCases)}
                          {casesLine('未実施', g.un, g.unCases)}
                          {casesLine('指摘修正', g.shimateki, g.shimatekiCases)}
                          {(g.ng > 0 || g.block > 0 || g.un > 0) && (
                            <div className="mt-1 space-y-0.5">
                              {g.ng > 0 && (
                                <p className="text-xs text-amber-700">テストNGの原因:　関連するバグがあればバグIDもお知らせください。</p>
                              )}
                              {g.block > 0 && (
                                <p className="text-xs text-amber-700">テスト不可の原因:</p>
                              )}
                              {g.un > 0 && (
                                <p className="text-xs text-amber-700">未実施の原因:</p>
                              )}
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
    </div>
  );
}
