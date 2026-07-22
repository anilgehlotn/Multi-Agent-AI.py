import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, AlertCircle, X } from 'lucide-react';
import { formatBytes } from '../lib/format';

export default function PdfUploader({ selectedFile, onSelect, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.');
      return;
    }
    setError(null);
    onSelect(file);
  }, [onSelect]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFile(e.dataTransfer?.files?.[0]);
  }, [handleFile, disabled]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onClickUpload = () => {
    if (!disabled) inputRef.current?.click();
  };

  const onFileChange = (e) => {
    handleFile(e.target.files?.[0]);
    e.target.value = '';
  };

  // ── File selected (not yet uploaded) ─────────────────────────────────
  if (selectedFile) {
    return (
      <div
        className="p-5 flex items-center gap-4"
        style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'white', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-accent-blue)' }}>
          <FileText size={18} style={{ color: '#3B82F6' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {selectedFile.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {formatBytes(selectedFile.size)} · ready to index
          </p>
        </div>
        {!disabled && (
          <button
            onClick={() => onSelect(null)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            aria-label="Remove file"
          >
            <X size={14} />
          </button>
        )}
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
        style={{ minHeight: '160px', opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
      >
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFileChange} />

        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--color-accent-blue)' }}>
          <Upload size={20} style={{ color: '#3B82F6' }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Drop your PDF here or <span style={{ color: '#3B82F6' }}>browse</span>
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          PDF files only
        </p>
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
