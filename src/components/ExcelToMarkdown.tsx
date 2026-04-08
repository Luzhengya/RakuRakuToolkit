import { useState, useRef, ChangeEvent } from 'react';
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

export default function ExcelToMarkdown({ onBack }: { onBack: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('全部');
  const [downloadPath, setDownloadPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []).slice(0, 10) as File[];
    if (selectedFiles.length === 0) return;

    setFiles(selectedFiles);
    setLoading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('files', f));

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to upload files');

      const data = await response.json();
      setUploadedFiles(data.files);
      
      const allSheets = new Set<string>();
      data.files.forEach((f: any) => {
        if (f.sheetNames) f.sheetNames.forEach((s: string) => allSheets.add(s));
      });
      setSheetNames(Array.from(allSheets));
      setSelectedSheet('全部');
    } catch (err) {
      setError('Error uploading files. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = async () => {
    if (uploadedFiles.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          files: uploadedFiles, 
          sheetName: selectedSheet,
          downloadPath 
        }),
      });

      if (!response.ok) throw new Error('Failed to convert files');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'excel_conversions.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err) {
      setError('Error converting files. Please try again.');
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
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-xl p-10 transition-all duration-300
              ${files.length > 0 ? 'border-green-400 bg-green-50' : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50'}
            `}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept=".xlsx,.xls"
              multiple
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${files.length > 0 ? 'bg-green-100 text-green-600' : 'bg-white shadow-sm text-neutral-400'} group-hover:scale-110 transition-transform`}>
                {files.length > 0 ? <CheckCircle size={32} /> : <Upload size={32} />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-neutral-700">
                  {files.length > 0 ? `已选择 ${files.length} 个文件` : '点击或拖拽上传 Excel 文件'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">支持 .xlsx 和 .xls 格式，最多10个</p>
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
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">下载路径 (可自定义)</label>
                  <input 
                    type="text"
                    value={downloadPath}
                    onChange={(e) => setDownloadPath(e.target.value)}
                    placeholder="默认为：C:\Users\xx\Downloads"
                    className="w-full p-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-neutral-900 outline-none transition-all"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">选择工作表 (Sheet)</label>
                  <select 
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    className="w-full p-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-neutral-900 outline-none appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1em' }}
                  >
                    <option value="全部">全部 (All Sheets)</option>
                    {sheetNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
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
              <p className="text-sm font-medium">转换成功！正在开始下载结果包。</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
