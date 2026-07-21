import { useState } from 'react';
import { Database, CheckCircle, AlertCircle } from 'lucide-react';
import { buildIndex } from '../lib/api';

export default function VectorDbBuilder({ fileId, disabled, onSuccess }) {
  const [building, setBuilding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const handleBuild = async () => {
    if (!fileId || building) return;

    setError(null);
    setBuilding(true);
    setDone(false);

    const { error: err } = await buildIndex(fileId);
    setBuilding(false);

    if (err) {
      setError(err);
      return;
    }

    setDone(true);
    onSuccess();
  };

  return (
    <div
      className="p-5"
      style={{
        borderRadius: 'var(--radius-card)',
        border: `1px solid ${done ? '#A7F3D0' : 'var(--color-border)'}`,
        backgroundColor: done ? '#F0FDF4' : 'white',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: done ? 'var(--color-accent-mint)' : 'var(--color-accent-lavender)' }}
        >
          {done ? (
            <CheckCircle size={17} style={{ color: '#059669' }} />
          ) : (
            <Database size={17} style={{ color: 'var(--color-text-secondary)' }} />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Vector Database
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {done ? 'Index built successfully!' : 'Create embeddings from your PDF'}
          </p>
        </div>
      </div>

      {!done && (
        <button
          id="build-index-btn"
          onClick={handleBuild}
          disabled={disabled || building}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--color-btn-primary-bg)',
            borderRadius: 'var(--radius-btn)',
          }}
          onMouseEnter={(e) => {
            if (!e.target.disabled) e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
          }}
        >
          {building ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Building Index…
            </>
          ) : (
            <>
              <Database size={15} />
              Create Vector Database
            </>
          )}
        </button>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs font-medium" style={{ color: '#DC2626' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  );
}
