import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ragApi } from '../lib/api';
import QuestionAnswer from '../components/QuestionAnswer';
import ErrorBanner from '../components/ErrorBanner';
import StatusPill from '../components/StatusPill';

export default function RagSessionDetail() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    ragApi.getSession(id).then(setSession).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setSession(null);
    load();
  }, [load]);

  return (
    <div
      className="bg-white p-6 sm:p-8"
      style={{ borderRadius: 'var(--radius-panel)', boxShadow: 'var(--shadow-panel)', minHeight: 'calc(100vh - 140px)' }}
    >
      <Link to="/history" className="inline-flex items-center gap-1.5 text-sm font-medium mb-6" style={{ color: 'var(--color-text-secondary)' }}>
        <ArrowLeft size={14} /> Back to History
      </Link>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!error && !session && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Loading…
        </p>
      )}

      {session && (
        <>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {session.pdf_filename}
            </h1>
            <StatusPill status={session.status} />
          </div>
          <p className="text-xs mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {session.num_chunks != null ? `${session.num_chunks} chunks · ` : ''}
            {session.queries.length} question{session.queries.length === 1 ? '' : 's'} asked
          </p>

          {session.status === 'failed' && session.error && (
            <div className="mb-6">
              <ErrorBanner message={session.error} />
            </div>
          )}

          <div className="max-w-xl">
            <QuestionAnswer sessionId={session.id} ready={session.status === 'ready'} initialQueries={session.queries} />
          </div>
        </>
      )}
    </div>
  );
}
