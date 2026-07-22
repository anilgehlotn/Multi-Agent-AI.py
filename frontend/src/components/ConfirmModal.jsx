import { AlertTriangle } from 'lucide-react';

export default function ConfirmModal({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(17,24,39,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white p-6 animate-fade-in-up"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#FEF2F2' }}
          >
            <AlertTriangle size={17} style={{ color: '#DC2626' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </span>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg cursor-pointer"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-white cursor-pointer"
            style={{ backgroundColor: '#DC2626' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
