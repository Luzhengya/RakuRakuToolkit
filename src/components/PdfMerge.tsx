import { useState, useEffect, type DragEvent } from 'react';
import {
  Upload,
  Download,
  AlertCircle,
  Loader2,
  ArrowLeft,
  GripVertical,
  X,
  FileText,
  Layers,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFileUpload } from '../hooks/useFileUpload';
import type { UploadedFile } from '../types';

export default function PdfMerge({ onBack }: { onBack: () => void }) {
  const {
    files,
    uploadedFiles,
    loading: uploading,
    error: uploadError,
    isDragging,
    fileInputRef,
    handleFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    reset: resetUpload,
  } = useFileUpload({ accept: ['.pdf'], maxFiles: 20 });

  // Accumulated ordered file list across multiple upload sessions
  const [orderedFiles, setOrderedFiles] = useState<UploadedFile[]>([]);
  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Merge state
  const [merging, setMerging] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [outputName, setOutputName] = useState('merged.pdf');

  // Append newly uploaded PDFs to the ordered list
  useEffect(() => {
    const pdfs = uploadedFiles.filter(f => f.type === 'pdf');
    if (pdfs.length > 0) {
      setOrderedFiles(prev => [...prev, ...pdfs]);
    }
  }, [uploadedFiles]);

  // ── File list manipulation ──────────────────────────────────────────
  const removeFile = (index: number) => {
    setOrderedFiles(prev => prev.filter((_, i) => i !== index));
    setMergeSuccess(false);
  };

  const moveFile = (index: number, dir: 'up' | 'down') => {
    const next = dir === 'up' ? index - 1 : index + 1;
    if (next < 0 || next >= orderedFiles.length) return;
    const arr = [...orderedFiles];
    [arr[index], arr[next]] = [arr[next], arr[index]];
    setOrderedFiles(arr);
    setMergeSuccess(false);
  };

  // ── Drag-to-reorder handlers (file list items) ─────────────────────
  const onItemDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.stopPropagation();
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag ghost
    const ghost = document.createElement('div');
    ghost.style.opacity = '0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const onItemDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(index);
    if (dragIndex === null || dragIndex === index) return;
    const arr = [...orderedFiles];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(index, 0, moved);
    setOrderedFiles(arr);
    setDragIndex(index);
  };

  const onItemDragEnd = (e: DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // ── Merge & download ───────────────────────────────────────────────
  const handleMerge = async () => {
    if (orderedFiles.length < 2) return;
    setMerging(true);
    setMergeError(null);
    setMergeSuccess(false);

    try {
      const name = outputName.trim() || 'merged.pdf';
      const finalName = name.endsWith('.pdf') ? name : `${name}.pdf`;

      // Re-send original File objects in the user-selected order.
      // orderedFiles[i].filename maps to uploadedFiles[j].filename → files[j]
      const formData = new FormData();
      for (const fileInfo of orderedFiles) {
        const idx = uploadedFiles.findIndex(uf => uf.filename === fileInfo.filename);
        if (idx !== -1 && files[idx]) {
          formData.append('files', files[idx]);
        }
      }
      formData.append('outputName', finalName);

      const response = await fetch('/api/pdf-merge', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '合并请求失败');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMergeSuccess(true);
      setOrderedFiles([]);
      resetUpload();
    } catch (err: any) {
      setMergeError(err.message || '合并失败，请重试');
    } finally {
      setMerging(false);
    }
  };

  const canMerge = orderedFiles.length >= 2 && !merging;

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
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">PDF 合并</h2>
          <p className="text-neutral-500">上传多个 PDF，调整合并顺序后一键下载</p>
        </div>

        <div className="space-y-6">

          {/* ── Upload zone ── */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              'relative group cursor-pointer border-2 border-dashed rounded-xl p-8 transition-all duration-300',
              isDragging
                ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
                : orderedFiles.length > 0
                  ? 'border-indigo-300 bg-indigo-50/40 hover:border-indigo-400'
                  : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50',
            ].join(' ')}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
              accept=".pdf"
              multiple
            />
            <div className="flex items-center gap-4">
              <div className={[
                'p-3 rounded-xl flex-shrink-0 transition-transform group-hover:scale-110',
                isDragging || orderedFiles.length > 0
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'bg-white shadow-sm text-neutral-400',
              ].join(' ')}>
                {uploading
                  ? <Loader2 size={24} className="animate-spin" />
                  : <Upload size={24} />
                }
              </div>
              <div>
                <p className="font-semibold text-neutral-700">
                  {isDragging
                    ? '松开鼠标以添加文件'
                    : orderedFiles.length > 0
                      ? '继续拖拽或点击添加更多 PDF'
                      : '点击或拖拽上传 PDF 文件'}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  支持 .pdf 格式，最多 20 个，单文件最大 100MB
                </p>
              </div>
            </div>
          </div>

          {/* Upload error */}
          {uploadError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600"
            >
              <AlertCircle size={15} />
              <p className="text-sm">{uploadError}</p>
            </motion.div>
          )}

          {/* ── File preview list ── */}
          <AnimatePresence>
            {orderedFiles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                {/* List header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                    合并顺序（{orderedFiles.length} 个文件）
                  </span>
                  <span className="text-xs text-neutral-400 flex items-center gap-1">
                    <GripVertical size={12} />
                    拖拽或使用箭头调整顺序
                  </span>
                </div>

                {/* File cards */}
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {orderedFiles.map((file, index) => (
                    <div
                      key={`${file.filename}-${index}`}
                      draggable
                      onDragStart={e => onItemDragStart(e, index)}
                      onDragOver={e => onItemDragOver(e, index)}
                      onDragEnd={onItemDragEnd}
                      className={[
                        'flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 select-none',
                        dragIndex === index
                          ? 'opacity-40 border-indigo-300 bg-indigo-50 scale-[0.97] shadow-inner'
                          : dragOverIndex === index && dragIndex !== null
                            ? 'border-indigo-400 bg-indigo-50 shadow-md'
                            : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm',
                      ].join(' ')}
                    >
                      {/* Drag handle */}
                      <div className="cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 flex-shrink-0 transition-colors">
                        <GripVertical size={16} />
                      </div>

                      {/* Order badge */}
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {index + 1}
                      </div>

                      {/* PDF icon */}
                      <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText size={16} className="text-red-500" />
                      </div>

                      {/* File name */}
                      <p
                        className="flex-1 text-sm text-neutral-700 font-medium truncate"
                        title={file.originalName}
                      >
                        {file.originalName}
                      </p>

                      {/* Up / Down arrows */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => moveFile(index, 'up')}
                          disabled={index === 0}
                          className="p-0.5 rounded text-neutral-300 hover:text-neutral-600 disabled:opacity-20 transition-colors"
                          title="上移"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveFile(index, 'down')}
                          disabled={index === orderedFiles.length - 1}
                          className="p-0.5 rounded text-neutral-300 hover:text-neutral-600 disabled:opacity-20 transition-colors"
                          title="下移"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={() => removeFile(index)}
                        className="flex-shrink-0 p-1.5 rounded-lg text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="移除"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Warning: need at least 2 files */}
                {orderedFiles.length === 1 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    请至少添加 2 个 PDF 文件才能合并
                  </p>
                )}

                {/* Output settings + merge button */}
                {orderedFiles.length >= 2 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 pt-2 border-t border-neutral-100"
                  >
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                        输出文件名
                      </label>
                      <input
                        type="text"
                        value={outputName}
                        onChange={e => setOutputName(e.target.value)}
                        placeholder="merged.pdf"
                        className="w-full p-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-neutral-900 outline-none transition-all text-sm"
                      />
                    </div>

                    <button
                      onClick={handleMerge}
                      disabled={!canMerge}
                      className="w-full py-4 bg-neutral-900 text-white rounded-lg font-bold shadow-lg hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                      {merging ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          合并中...
                        </>
                      ) : (
                        <>
                          <Layers size={20} />
                          合并 {orderedFiles.length} 个文件并下载
                        </>
                      )}
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Merge error */}
          {mergeError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600"
            >
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{mergeError}</p>
            </motion.div>
          )}

          {/* Merge success */}
          {mergeSuccess && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-green-50 border border-green-100 rounded-lg flex items-center gap-3 text-green-600"
            >
              <Download size={20} />
              <p className="text-sm font-medium">合并成功！PDF 已开始下载，可继续上传新文件。</p>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
