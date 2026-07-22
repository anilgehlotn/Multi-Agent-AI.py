import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { researchApi } from '../lib/api';
import ResearchResults from '../components/ResearchResults';
import ErrorBanner from '../components/ErrorBanner';
import StatusPill from '../components/StatusPill';

export default function ResearchRunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    researchApi.get(id).then(setRun).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setRun(null);
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

      {!error && !run && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Loading…
        </p>
      )}

      {run && (
        <>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {run.topic}
            </h1>
            <StatusPill status={run.status} />
          </div>
          {run.status === 'failed' && run.error && (
            <div className="mt-4">
              <ErrorBanner message={run.error} />
            </div>
          )}
          <ResearchResults run={run} />
        </>
      )}
    </div>
  );
}
