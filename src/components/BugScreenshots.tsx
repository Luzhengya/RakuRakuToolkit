// BUG の截图 (画面キャプチャ / ファイル / 貼り付け) を Notion にアップロードして持つ。
// BUG 移管フォームと BUG 一覧の新規作成で共用する。
import { useRef, useState } from 'react';
import { AlertCircle, Camera, Image, Loader2, X } from 'lucide-react';
import { captureScreen } from '../utils/captureScreen';
import ScreenshotEditor from './ScreenshotEditor';

interface ScreenshotItem {
  id: string;
  file: File;
  preview: string;
  dataUrl: string;
  uploading: boolean;
  fileUploadId: string | null;
  error: string | null;
}

let screenshotSeq = 0;

function safeBlobUrl(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  return '';
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/testcase/upload-bug-image', { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'アップロード失敗');
  return (body as { fileUploadId: string }).fileUploadId;
}

export function useBugScreenshots() {
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editorImage, setEditorImage] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 1枚分をアップロードして、結果を同じ id の行へ書き戻す
  const upload = (id: string, file: File) => {
    uploadImage(file)
      .then((fid) => setScreenshots((prev) => prev.map((s) => (s.id === id ? { ...s, uploading: false, fileUploadId: fid } : s))))
      .catch((e) => setScreenshots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, uploading: false, error: e instanceof Error ? e.message : 'アップロード失敗' } : s))));
  };

  const addScreenshot = async (file: File, dataUrl?: string) => {
    const preview = URL.createObjectURL(file);
    const id = `ss-${++screenshotSeq}`;
    const du = dataUrl ?? await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    setScreenshots((prev) => [...prev, { id, file, preview, dataUrl: du, uploading: true, fileUploadId: null, error: null }]);
    upload(id, file);
  };

  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) addScreenshot(f);
    }
  };

  const removeScreenshot = (id: string) => {
    setScreenshots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((s) => s.id !== id);
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
    const file = dataUrlToFile(editedDataUrl, `screenshot-${Date.now()}.png`);
    if (editingIndex !== null) {
      // 既存の1枚を描き直した場合は、同じ位置で差し替えてアップロードし直す
      const old = screenshots[editingIndex];
      URL.revokeObjectURL(old.preview);
      const id = old.id;
      const preview = URL.createObjectURL(file);
      setScreenshots((prev) => prev.map((s) => s.id === id
        ? { id, file, preview, dataUrl: editedDataUrl, uploading: true, fileUploadId: null, error: null }
        : s));
      setEditingIndex(null);
      setEditorImage(null);
      upload(id, file);
    } else {
      addScreenshot(file, editedDataUrl);
      setEditorImage(null);
    }
  };

  const onEditorCancel = () => {
    setEditorImage(null);
    setEditingIndex(null);
  };

  const openEditor = (index: number) => {
    setEditingIndex(index);
    setEditorImage(screenshots[index].dataUrl);
  };

  return {
    screenshots,
    uploading: screenshots.some((s) => s.uploading),
    imageIds: screenshots.filter((s) => s.fileUploadId).map((s) => s.fileUploadId as string),
    fileInputRef,
    addFiles,
    handlePaste,
    startCapture,
    removeScreenshot,
    openEditor,
    editor: editorImage
      ? <ScreenshotEditor imageDataUrl={editorImage} onDone={onEditorDone} onCancel={onEditorCancel} />
      : null,
  };
}

type Shots = ReturnType<typeof useBugScreenshots>;

// 「截图」「ファイル」ボタン (詳細説明の見出しの横に置く)
export function ScreenshotButtons({ shots }: { shots: Shots }) {
  return (
    <>
      <button
        type="button"
        onClick={shots.startCapture}
        className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700"
      >
        <Camera size={12} />
        截图
      </button>
      <button
        type="button"
        onClick={() => shots.fileInputRef.current?.click()}
        className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700"
      >
        <Image size={12} />
        ファイル
      </button>
      <input
        ref={shots.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) shots.addFiles(e.target.files); e.target.value = ''; }}
      />
    </>
  );
}

// アップロード済み・中の截图のサムネイル。クリックで描き込み、× で外す
export function ScreenshotThumbs({ shots }: { shots: Shots }) {
  if (shots.screenshots.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {shots.screenshots.map((s, idx) => (
        <div key={s.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50 cursor-pointer"
          onClick={() => !s.uploading && shots.openEditor(idx)}>
          <img src={safeBlobUrl(s.preview)} alt="" className="w-full h-full object-cover" />
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
            onClick={(e) => { e.stopPropagation(); shots.removeScreenshot(s.id); }}
            className="absolute top-0.5 right-0.5 rounded-full bg-black/50 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
