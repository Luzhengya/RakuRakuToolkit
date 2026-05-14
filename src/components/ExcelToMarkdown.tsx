import { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  FileText,
  Download,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFileUpload } from '../hooks/useFileUpload';

export default function ExcelToMarkdown({ onBack }: { onBack: () => void }) {
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  const {
    files,
    uploadedFiles,
    loading,
    error,
    success,
    isDragging,
    fileInputRef,
    handleFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setLoading,
    setError,
    setSuccess,
  } = useFileUpload({ accept: ['.xlsx', '.xls'], maxFiles: 10 });

  // For multiple files, only offer sheet names common to ALL files (intersection).
  // This avoids ambiguity when files share some sheet names but not others.
  const sheetNames = useMemo(() => {
    if (uploadedFiles.length === 0) return [];
    const perFile = uploadedFiles.map(f => new Set(f.sheetNames ?? []));
    const [first, ...rest] = perFile;
    return Array.from(first).filter(name => rest.every(s => s.has(name)));
  }, [uploadedFiles]);

  // When file set changes, default selection = all available sheets.
  // Keeps any prior selection that still exists.
  useEffect(() => {
    setSelectedSheets(prev => {
      const stillValid = prev.filter(n => sheetNames.includes(n));
      return stillValid.length ? stillValid : sheetNames;
    });
  }, [sheetNames]);

  const allSelected = selectedSheets.length === sheetNames.length && sheetNames.length > 0;
  const toggleAll = () => setSelectedSheets(allSelected ? [] : sheetNames);
  const toggleSheet = (name: string) => {
    setSelectedSheets(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name],
    );
  };

  const filenameFromContentDisposition = (header: string | null): string | null => {
    if (!header) return null;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
    const plain = /filename="([^"]+)"/i.exec(header);
    return plain ? plain[1] : null;
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    if (selectedSheets.length === 0) {
      setError('请至少选择一个工作表');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      // Send selected sheets as JSON. Empty array means "all sheets" on the server.
      const payload = allSelected ? [] : selectedSheets;
      formData.append('sheetNames', JSON.stringify(payload));

      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || '文件转换失败，请重试');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fallback = files.length === 1
        ? files[0].name.replace(/\.(xlsx|xls)$/i, '.md')
        : 'excel_conversions.zip';
      a.download = filenameFromContentDisposition(response.headers.get('Content-Disposition')) || fallback;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件转换失败，请重试');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 transition-colors mb-6 group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        返回首页
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Excel to Markdown</h2>
          <p className="text-neutral-500">上传 Excel 文件并将其转换为精简的 Markdown 格式</p>
        </div>

        <div className="space-y-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-xl p-10 transition-all duration-300
              ${isDragging ? 'border-green-500 bg-green-50 scale-[1.01]' : files.length > 0 ? 'border-green-400 bg-green-50' : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50'}
            `}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
              accept=".xlsx,.xls"
              multiple
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${files.length > 0 || isDragging ? 'bg-green-100 text-green-600' : 'bg-white shadow-sm text-neutral-400'} group-hover:scale-110 transition-transform`}>
                {files.length > 0 ? <CheckCircle size={32} /> : <Upload size={32} />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-neutral-700">
                  {isDragging ? '松开鼠标以上传文件' : files.length > 0 ? `已选择 ${files.length} 个文件` : '点击或拖拽上传 Excel 文件'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">支持 .xlsx 和 .xls 格式，最多 10 个，单文件最大 50MB</p>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {uploadedFiles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">选择工作表（Sheet）</label>
                    <span className="text-xs text-neutral-400">
                      已选 {selectedSheets.length} / {sheetNames.length}
                    </span>
                  </div>
                  {uploadedFiles.length > 1 && (
                    <p className="text-xs text-neutral-400 -mt-1">
                      多文件场景下仅显示所有文件共有的工作表名
                    </p>
                  )}
                  <div className="bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden">
                    <label className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100 bg-neutral-50 cursor-pointer hover:bg-neutral-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="w-4 h-4 accent-neutral-900 cursor-pointer"
                      />
                      <span className="text-sm font-semibold text-neutral-700">全选 / 取消全选</span>
                    </label>
                    <div className="max-h-48 overflow-y-auto">
                      {sheetNames.length === 0 ? (
                        <p className="p-3 text-xs text-neutral-400">未识别到工作表</p>
                      ) : (
                        sheetNames.map((name) => (
                          <label
                            key={name}
                            className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-neutral-50 cursor-pointer hover:bg-neutral-50 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSheets.includes(name)}
                              onChange={() => toggleSheet(name)}
                              className="w-4 h-4 accent-neutral-900 cursor-pointer"
                            />
                            <span className="text-sm text-neutral-700 truncate">{name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-neutral-400">
                    多个 Sheet 会按勾选顺序合并到同一份 Markdown 中
                  </p>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-600 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        正在转换 {files.length} 个文件...
                      </span>
                    </div>
                    <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full w-1/3 bg-green-400 rounded-full"
                        animate={{ x: ['−100%', '300%'] }}
                        transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleConvert}
                    disabled={selectedSheets.length === 0}
                    className="w-full py-4 bg-neutral-900 text-white rounded-lg font-bold shadow-lg hover:bg-neutral-800 transition-all flex items-center justify-center gap-2 disabled:bg-neutral-300 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <FileText size={20} />
                    {selectedSheets.length === 0 ? '请选择至少一个 Sheet' : '开始转换并下载'}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

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

          {success && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-green-50 border border-green-100 rounded-lg flex items-center gap-3 text-green-600"
            >
              <Download size={20} />
              <p className="text-sm font-medium">转换成功！文件已开始下载。</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
