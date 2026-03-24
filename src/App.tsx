/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, ChangeEvent } from 'react';
import { Upload, FileText, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('全部');
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to upload file');

      const data = await response.json();
      setSheetNames(data.sheetNames);
      setFilename(data.filename);
      setSelectedSheet('全部');
    } catch (err) {
      setError('Error uploading file. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!filename) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, sheetName: selectedSheet }),
      });

      if (!response.ok) throw new Error('Failed to convert file');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'conversion_result.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err) {
      setError('Error converting file. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl bg-white rounded-3xl shadow-xl p-8 border border-neutral-200"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">Excel to Markdown</h1>
          <p className="text-neutral-500 italic font-serif">Convert your spreadsheets with style</p>
        </div>

        <div className="space-y-6">
          {/* Upload Area */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-2xl p-10 transition-all duration-300
              ${file ? 'border-green-400 bg-green-50' : 'border-neutral-300 hover:border-neutral-400 bg-neutral-50'}
            `}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept=".xlsx,.xls"
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${file ? 'bg-green-100 text-green-600' : 'bg-neutral-100 text-neutral-400'} group-hover:scale-110 transition-transform`}>
                {file ? <CheckCircle size={32} /> : <Upload size={32} />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-neutral-700">
                  {file ? file.name : 'Click to upload Excel file'}
                </p>
                <p className="text-sm text-neutral-400 mt-1">Supports .xlsx and .xls</p>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {sheetNames.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-neutral-600 uppercase tracking-wider">Select Sheet</label>
                  <select 
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    className="w-full p-3 bg-white border border-neutral-200 rounded-xl shadow-sm focus:ring-2 focus:ring-neutral-900 outline-none transition-all"
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
                  className="w-full py-4 bg-neutral-900 text-white rounded-xl font-bold shadow-lg hover:bg-neutral-800 disabled:bg-neutral-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      <FileText size={20} className="group-hover:rotate-12 transition-transform" />
                      Convert to Markdown
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
              className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-600"
            >
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          {success && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }}
              className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-600"
            >
              <Download size={20} />
              <p className="text-sm font-medium">Conversion successful! Download started.</p>
            </motion.div>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-neutral-100 flex justify-between items-center">
          <span className="text-xs text-neutral-400 uppercase tracking-widest font-mono">v1.0.0</span>
          <div className="flex gap-4">
            <div className="w-2 h-2 rounded-full bg-neutral-200" />
            <div className="w-2 h-2 rounded-full bg-neutral-200" />
            <div className="w-2 h-2 rounded-full bg-neutral-200" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

