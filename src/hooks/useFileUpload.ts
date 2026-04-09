import { useState, useRef, useCallback, DragEvent, type RefObject } from 'react';
import type { UploadedFile } from '../types';

interface UseFileUploadOptions {
  accept: string[];
  maxFiles?: number;
}

interface UseFileUploadReturn {
  files: File[];
  uploadedFiles: UploadedFile[];
  loading: boolean;
  error: string | null;
  success: boolean;
  isDragging: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  handleFiles: (fileList: FileList | null) => Promise<void>;
  handleDragOver: (e: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: DragEvent<HTMLDivElement>) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setSuccess: (v: boolean) => void;
  reset: () => void;
}

export function useFileUpload({ accept, maxFiles = 10 }: UseFileUploadOptions): UseFileUploadReturn {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null!);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const selectedFiles = Array.from(fileList)
      .filter(f => accept.some(ext => f.name.toLowerCase().endsWith(ext)))
      .slice(0, maxFiles);

    if (selectedFiles.length === 0) {
      setError(`不支持的文件格式，请上传 ${accept.join('、')} 格式的文件`);
      return;
    }

    setFiles(selectedFiles);
    setLoading(true);
    setError(null);
    setSuccess(false);
    setUploadedFiles([]);

    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('files', f));

    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Failed to upload files');
      const data = await response.json();
      setUploadedFiles(data.files);
    } catch (err) {
      setError('文件上传失败，请重试');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [accept, maxFiles]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const reset = useCallback(() => {
    setFiles([]);
    setUploadedFiles([]);
    setError(null);
    setSuccess(false);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return {
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
  };
}
