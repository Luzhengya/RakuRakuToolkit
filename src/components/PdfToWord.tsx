import { useState } from 'react';
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

export default function PdfToWord({ onBack }: { onBack: () => void }) {
  const [downloadPath, setDownloadPath] = useState<string>('');

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
    reset,
  } = useFileUpload({ accept: ['.pdf'], maxFiles: 10 });

  const handleConvert = async () => {
    if (files.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Re-send original File objects so the server doesn't depend on /tmp state
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      if (downloadPath) formData.append('downloadPath', downloadPath);

      const response = await fetch('/api/pdf-convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to convert files');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'converted_pdfs.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setSuccess(true);
      reset();
    } catch (err) {
      setError('文件转换失败，请重试');
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
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">PDF to Word</h2>
          <p className="text-neutral-500">上传 PDF 文件并将其转换为可编辑的 Word 文档</p>
        </div>

        <div className="space-y-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-xl p-10 transition-all duration-300
              ${isDragging ? 'border-red-500 bg-red-50 scale-[1.01]' : files.length > 0 ? 'border-red-400 bg-red-50' : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50'}
            `}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
              accept=".pdf"
              multiple
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${files.length > 0 || isDragging ? 'bg-red-100 text-red-600' : 'bg-white shadow-sm text-neutral-400'} group-hover:scale-110 transition-transform`}>
                {files.length > 0 ? <CheckCircle size={32} /> : <Upload size={32} />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-neutral-700">
                  {isDragging ? '松开鼠标以上传文件' : files.length > 0 ? `已选择 ${files.length} 个文件` : '点击或拖拽上传 PDF 文件'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">支持 .pdf 格式，最多 10 个，单文件最大 100MB</p>
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
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">下载路径（可自定义）</label>
                  <input
                    type="text"
                    value={downloadPath}
                    onChange={(e) => setDownloadPath(e.target.value)}
                    placeholder="默认download目录下"
                    className="w-full p-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-neutral-900 outline-none transition-all"
                  />
                </div>

                <button
                  onClick={handleConvert}
                  disabled={loading}
                  className="w-full py-4 bg-neutral-900 text-white rounded-lg font-bold shadow-lg hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      <FileText size={20} />
                      开始转换并下载
                    </>
                  )}
                </button>
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
              <p className="text-sm font-medium">转换成功！Word 文档已开始下载。</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
