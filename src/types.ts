export interface UploadedFile {
  filename: string;
  originalName: string;
  type: 'excel' | 'pdf' | 'unknown';
  sheetNames?: string[];
  error?: string;
}

export interface UploadResponse {
  files: UploadedFile[];
}
