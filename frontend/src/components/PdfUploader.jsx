import { useState, useCallback, useRef } from 'react';
import { Upload, FileCheck, AlertCircle } from 'lucide-react';
import { uploadPdf } from '../lib/api';

export default function PdfUploader({ fileId, fileName, onUpload }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.');
      return;
    }

    setError(null);
    setUploading(true);

    const { data, error: err } = await uploadPdf(file);
    setUploading(false);

    if (err) {
      setError(err);
      return;
    }

    onUpload(data.file_id, data.filename || file.name);
  }, [onUpload]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onClickUpload = () => {
    inputRef.current?.click();
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
  };

  // ── Already uploaded state ─────────────────────────────────────────
  if (fileId && fileName) {
    return (
      <div
        className="p-5 flex items-center gap-4"
        style={{
          borderRadius: 'var(--radius-card)',
          border: '1px solid #A7F3D0',
          backgroundColor: '#F0FDF4',
        }}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-accent-mint)' }}>
          <FileCheck size={18} style={{ color: '#059669' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {fileName}
          </p>
          <p className="text-xs" style={{ color: '#059669' }}>
            Uploaded successfully
          </p>
        </div>
        <button
          onClick={() => {
            onUpload(null, '');
            setError(null);
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`drop-zone p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${dragging ? 'drag-over' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickUpload}
        style={{ minHeight: '160px' }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={onFileChange}
        />

        {uploading ? (
          <>
            <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mb-3" />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Uploading…
            </p>
          </>
        ) : (
          <>
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ backgroundColor: 'var(--color-accent-blue)' }}
            >
              <Upload size={20} style={{ color: '#3B82F6' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Drop your PDF here or <span style={{ color: '#3B82F6' }}>browse</span>
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              PDF files only
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs font-medium" style={{ color: '#DC2626' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  );
}
