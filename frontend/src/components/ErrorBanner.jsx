import { AlertTriangle, RotateCw } from 'lucide-react';

export default function ErrorBanner({ message, onRetry }) {
  if (!message) return null;

  return (
    <div
      className="flex items-center gap-3 p-4 rounded-xl text-sm font-medium animate-fade-in-up"
      style={{
        backgroundColor: '#FEF2F2',
        color: '#DC2626',
        border: '1px solid #FECACA',
      }}
    >
      <AlertTriangle size={16} className="flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer flex-shrink-0"
          style={{ border: '1px solid #FECACA', color: '#DC2626' }}
        >
          <RotateCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
