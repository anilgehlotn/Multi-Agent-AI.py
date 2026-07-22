import { Database, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const STATUS_LABEL = {
  pending: 'Uploading…',
  indexing: 'Indexing…',
  ready: 'Ready',
  failed: 'Failed',
};

// Purely presentational — RagTab owns the upload call and the status poll
// (a single source of truth), this just renders whatever state it's given.
export default function VectorDbBuilder({ session, uploading, uploadError, onUpload }) {
  const status = uploading ? 'pending' : session?.status;
  const isActive = uploading || (session && (session.status === 'pending' || session.status === 'indexing'));
  const isReady = session?.status === 'ready';
  const isFailed = session?.status === 'failed';

  return (
    <div
      className="p-5"
      style={{
        borderRadius: 'var(--radius-card)',
        border: `1px solid ${isReady ? '#A7F3D0' : isFailed ? '#FECACA' : 'var(--color-border)'}`,
        backgroundColor: isReady ? '#F0FDF4' : isFailed ? '#FEF2F2' : 'white',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: isReady ? 'var(--color-accent-mint)' : 'var(--color-accent-lavender)' }}
        >
          {isReady ? (
            <CheckCircle size={17} style={{ color: '#059669' }} />
          ) : isActive ? (
            <Loader2 size={17} className="animate-spin" style={{ color: 'var(--color-text-secondary)' }} />
          ) : (
            <Database size={17} style={{ color: 'var(--color-text-secondary)' }} />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Vector Database
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {status && STATUS_LABEL[status]
              ? STATUS_LABEL[status] + (isReady && session?.num_chunks ? ` · ${session.num_chunks} chunks` : '')
              : 'Create embeddings from your PDF'}
          </p>
        </div>
      </div>

      {!session && (
        <button
          id="build-index-btn"
          onClick={onUpload}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-btn-primary-bg)', borderRadius: 'var(--radius-btn)' }}
        >
          {uploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Database size={15} />
              Create Vector Database
            </>
          )}
        </button>
      )}

      {(uploadError || (isFailed && session?.error)) && (
        <div className="mt-3 flex items-center gap-2 text-xs font-medium" style={{ color: '#DC2626' }}>
          <AlertCircle size={14} />
          {uploadError || session.error}
        </div>
      )}
    </div>
  );
}
