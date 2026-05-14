import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite ?url import serves the worker from local node_modules — avoids CDN version mismatch
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Upload,
  Download,
  AlertCircle,
  Loader2,
  ArrowLeft,
  GripVertical,
  X,
  Layers,
  FileText,
  ZoomIn,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const THUMB_W = 132;

interface PageItem {
  id: string;
  fileIndex: number;
  pageIndex: number; // 0-based
  pageNumber: number; // 1-based, for display
  fileName: string;
  thumbnail: string; // data URL
}

async function renderThumbnail(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number // 1-based
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scale = THUMB_W / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scaled.width);
  canvas.height = Math.round(scaled.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: scaled }).promise;
  return canvas.toDataURL('image/jpeg', 0.75);
}

export default function PdfMerge({ onBack }: { onBack: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null!);

  // All accumulated File objects (never shrinks; fileIndex references into this)
  const [allFiles, setAllFiles] = useState<File[]>([]);
  // Ref keeps allFiles in sync so addPdfFiles never captures a stale length
  const allFilesRef = useRef<File[]>([]);
  // Ordered page list shown in the grid
  const [pages, setPages] = useState<PageItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Drag-to-reorder page cards
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Merge state
  const [merging, setMerging] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [outputName, setOutputName] = useState('merged.pdf');

  // Lightbox: double-click a thumbnail to view it at high resolution
  const [lightboxPage, setLightboxPage] = useState<PageItem | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string>('');
  const [lightboxLoading, setLightboxLoading] = useState(false);

  const openLightbox = useCallback(async (page: PageItem) => {
    setLightboxPage(page);
    setLightboxImage('');
    setLightboxLoading(true);
    try {
      const file = allFilesRef.current[page.fileIndex];
      if (!file) throw new Error('文件已被移除');
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pdfPage = await pdf.getPage(page.pageIndex + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      // Scale up to ~90% of viewport, capped to keep huge pages reasonable
      const targetW = Math.min(window.innerWidth * 0.85, 1600);
      const scale = Math.min(3, Math.max(1.2, targetW / base.width));
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({
        canvas,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      setLightboxImage(canvas.toDataURL('image/jpeg', 0.92));
    } catch (err) {
      console.error('lightbox render failed', err);
      setLightboxPage(null);
    } finally {
      setLightboxLoading(false);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxPage(null);
    setLightboxImage('');
  }, []);

  useEffect(() => {
    if (!lightboxPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxPage, closeLightbox]);

  // ── Load PDFs & render thumbnails ──────────────────────────────────
  const addPdfFiles = useCallback(async (newFiles: File[]) => {
    const pdfs = newFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setUploadError('请上传 .pdf 格式的文件');
      return;
    }
    setUploadError(null);
    setLoading(true);
    setMergeSuccess(false);
    setMergeError(null);

    try {
      const newPages: PageItem[] = [];
      // Read from ref to always get the live count, never a stale closure value
      const startIndex = allFilesRef.current.length;

      for (let fi = 0; fi < pdfs.length; fi++) {
        const file = pdfs[fi];
        const fileIndex = startIndex + fi;
        setLoadingMsg(`读取 ${file.name}（${fi + 1}/${pdfs.length}）...`);

        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        for (let pi = 0; pi < pdf.numPages; pi++) {
          setLoadingMsg(`渲染 ${file.name} 第 ${pi + 1}/${pdf.numPages} 页...`);
          const thumbnail = await renderThumbnail(pdf, pi + 1);
          newPages.push({
            id: `f${fileIndex}-p${pi}-${Date.now()}`,
            fileIndex,
            pageIndex: pi,
            pageNumber: pi + 1,
            fileName: file.name,
            thumbnail,
          });
        }
      }

      setAllFiles(prev => {
        const next = [...prev, ...pdfs];
        allFilesRef.current = next;
        return next;
      });
      setPages(prev => [...prev, ...newPages]);
    } catch (err) {
      console.error(err);
      setUploadError('PDF 读取失败，请确认文件未损坏');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }, []);

  const handleFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    addPdfFiles(files);
  }, [addPdfFiles]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    if (loading) return;
    addPdfFiles(Array.from(e.dataTransfer.files));
  }, [addPdfFiles, loading]);

  // ── Page card drag-to-reorder ──────────────────────────────────────
  const onCardDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.stopPropagation();
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.style.opacity = '0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const onCardDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverIndex(index);
    if (dragIndex === null || dragIndex === index) return;
    setPages(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(dragIndex, 1);
      arr.splice(index, 0, moved);
      return arr;
    });
    setDragIndex(index);
  };

  const onCardDragEnd = (e: DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const removePage = (index: number) => {
    setPages(prev => prev.filter((_, i) => i !== index));
    setMergeSuccess(false);
  };

  // ── Merge & download ───────────────────────────────────────────────
  const handleMerge = async () => {
    if (pages.length === 0 || merging) return;
    setMerging(true);
    setMergeError(null);
    setMergeSuccess(false);

    try {
      const name = outputName.trim() || 'merged.pdf';
      const finalName = name.endsWith('.pdf') ? name : `${name}.pdf`;

      const formData = new FormData();
      allFiles.forEach(f => formData.append('files', f));
      formData.append(
        'pages',
        JSON.stringify(pages.map(p => ({ fileIndex: p.fileIndex, pageIndex: p.pageIndex })))
      );
      formData.append('outputName', finalName);

      const response = await fetch('/api/pdf-merge', { method: 'POST', body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || '合并请求失败');
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
      setPages([]);
      setAllFiles([]);
      allFilesRef.current = [];
    } catch (err: unknown) {
      setMergeError(err instanceof Error ? err.message : '合并失败，请重试');
    } finally {
      setMerging(false);
    }
  };

  const totalPages = pages.length;
  const uniqueFiles = new Set(pages.map(p => p.fileIndex)).size;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 transition-colors mb-6 group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        返回首页
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">PDF 合并</h2>
          <p className="text-neutral-500">
            上传多个 PDF，按页显示后可调整每一页的顺序、删除不需要的页，最后合并下载
          </p>
        </div>

        <div className="space-y-6">

          {/* ── Upload zone ── */}
          <div
            onClick={() => !loading && fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              'relative group cursor-pointer border-2 border-dashed rounded-xl p-6 transition-all duration-300',
              loading
                ? 'cursor-not-allowed border-neutral-200 bg-neutral-50'
                : isDragging
                  ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
                  : pages.length > 0
                    ? 'border-indigo-300 bg-indigo-50/40 hover:border-indigo-400'
                    : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50',
            ].join(' ')}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInput}
              className="hidden"
              accept=".pdf"
              multiple
            />
            <div className="flex items-center gap-4">
              <div className={[
                'p-3 rounded-xl flex-shrink-0 transition-transform',
                loading ? 'bg-white shadow-sm text-neutral-400'
                  : isDragging || pages.length > 0
                    ? 'bg-indigo-100 text-indigo-600 group-hover:scale-110'
                    : 'bg-white shadow-sm text-neutral-400 group-hover:scale-110',
              ].join(' ')}>
                {loading
                  ? <Loader2 size={24} className="animate-spin" />
                  : <Upload size={24} />
                }
              </div>
              <div>
                {loading ? (
                  <>
                    <p className="font-semibold text-neutral-700">正在处理…</p>
                    <p className="text-xs text-neutral-400 mt-0.5">{loadingMsg}</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-neutral-700">
                      {isDragging
                        ? '松开以添加文件'
                        : pages.length > 0
                          ? '继续拖拽或点击添加更多 PDF'
                          : '点击或拖拽上传 PDF 文件'}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      支持 .pdf 格式，最多 20 个，单文件最大 50MB
                    </p>
                  </>
                )}
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

          {/* ── Page grid ── */}
          <AnimatePresence>
            {pages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                {/* Grid header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                      页面预览
                    </span>
                    <span className="text-xs text-neutral-400">
                      共 {totalPages} 页
                      {uniqueFiles > 1 ? `，来自 ${uniqueFiles} 个文件` : ''}
                    </span>
                  </div>
                  <span className="text-xs text-neutral-400 flex items-center gap-1">
                    <GripVertical size={12} />
                    拖拽页面卡片调整顺序
                  </span>
                </div>

                {/* Scrollable page grid */}
                <div className="max-h-[600px] overflow-y-auto rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W}px, 1fr))` }}
                  >
                    {pages.map((page, index) => (
                      <div
                        key={page.id}
                        draggable
                        onDragStart={e => onCardDragStart(e, index)}
                        onDragOver={e => onCardDragOver(e, index)}
                        onDragEnd={onCardDragEnd}
                        className={[
                          'relative group flex flex-col rounded-xl border overflow-hidden select-none transition-all duration-150 cursor-grab active:cursor-grabbing',
                          dragIndex === index
                            ? 'opacity-40 border-indigo-400 shadow-inner scale-95'
                            : dragOverIndex === index && dragIndex !== null
                              ? 'border-indigo-400 shadow-lg scale-[1.03]'
                              : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-md',
                        ].join(' ')}
                      >
                        {/* Thumbnail */}
                        <div
                          className="relative bg-neutral-100 flex items-center justify-center overflow-hidden"
                          style={{ minHeight: 100 }}
                          onDoubleClick={e => { e.stopPropagation(); openLightbox(page); }}
                          title="双击放大查看"
                        >
                          {page.thumbnail ? (
                            <img
                              src={page.thumbnail}
                              alt={`${page.fileName} 第 ${page.pageNumber} 页`}
                              className="w-full object-contain"
                              draggable={false}
                            />
                          ) : (
                            <FileText size={32} className="text-neutral-300" />
                          )}

                          {/* Order badge */}
                          <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shadow">
                            {index + 1}
                          </div>

                          {/* Zoom button (shows on hover, top-right next to delete) */}
                          <button
                            onClick={e => { e.stopPropagation(); openLightbox(page); }}
                            onMouseDown={e => e.stopPropagation()}
                            className="absolute top-1.5 right-8 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-indigo-500 transition-all"
                            title="放大查看（也可双击缩略图）"
                          >
                            <ZoomIn size={11} />
                          </button>

                          {/* Delete button (shows on hover) */}
                          <button
                            onClick={e => { e.stopPropagation(); removePage(index); }}
                            onMouseDown={e => e.stopPropagation()}
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                            title="删除此页"
                          >
                            <X size={11} />
                          </button>

                          {/* Drag handle overlay (top strip) */}
                          <div className="absolute inset-x-0 top-0 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <GripVertical size={14} className="text-white drop-shadow" />
                          </div>
                        </div>

                        {/* Info footer */}
                        <div className="px-1.5 py-1 bg-white border-t border-neutral-100">
                          <p className="text-[10px] font-semibold text-neutral-600 truncate" title={page.fileName}>
                            {page.fileName}
                          </p>
                          <p className="text-[10px] text-neutral-400">
                            第 {page.pageNumber} 页
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Output settings + merge button */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4 pt-4 border-t border-neutral-100"
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
                    disabled={pages.length === 0 || merging}
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
                        合并 {totalPages} 页并下载
                      </>
                    )}
                  </button>
                </motion.div>
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

      {/* Lightbox: high-res preview triggered by double-clicking a thumbnail */}
      <AnimatePresence>
        {lightboxPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6"
            onClick={closeLightbox}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={closeLightbox}
                className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-neutral-700 shadow-lg flex items-center justify-center hover:bg-neutral-100 transition-colors z-10"
                title="关闭 (ESC)"
                aria-label="关闭预览"
              >
                <X size={18} />
              </button>

              {lightboxLoading || !lightboxImage ? (
                <div className="flex flex-col items-center justify-center gap-3 bg-white rounded-lg p-12 min-w-[280px] min-h-[280px]">
                  <Loader2 size={28} className="animate-spin text-neutral-400" />
                  <p className="text-sm text-neutral-500">正在渲染高清预览...</p>
                </div>
              ) : (
                <>
                  <img
                    src={lightboxImage}
                    alt={`${lightboxPage.fileName} 第 ${lightboxPage.pageNumber} 页`}
                    className="max-w-[90vw] max-h-[90vh] object-contain shadow-2xl rounded"
                    draggable={false}
                  />
                  <div className="absolute bottom-2 left-2 text-white text-xs bg-black/55 px-2 py-1 rounded">
                    {lightboxPage.fileName} · 第 {lightboxPage.pageNumber} 页
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
