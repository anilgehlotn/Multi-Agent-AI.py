import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, BookOpen, Eye, Trash2 } from 'lucide-react';
import { researchApi, ragApi } from '../lib/api';
import StatusPill from '../components/StatusPill';
import ConfirmModal from '../components/ConfirmModal';
import ErrorBanner from '../components/ErrorBanner';
import { timeAgo } from '../lib/format';

const TABS = [
  { id: 'research', label: 'Research Runs', icon: FlaskConical },
  { id: 'rag', label: 'Q&A Sessions', icon: BookOpen },
];

function EmptyState({ message }) {
  return (
    <p className="text-sm text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
      {message}
    </p>
  );
}

function ResearchRunsTable({ runs, onDelete }) {
  if (runs === null) return <EmptyState message="Loading…" />;
  if (runs.length === 0) return <EmptyState message="No research runs yet. Start one from the Dashboard." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
            <th className="pb-3 font-medium">Topic</th>
            <th className="pb-3 font-medium">Status</th>
            <th className="pb-3 font-medium">Created</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b" style={{ borderColor: 'var(--color-border-light)' }}>
              <td className="py-3 pr-4 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {run.topic}
              </td>
              <td className="py-3 pr-4">
                <StatusPill status={run.status} />
              </td>
              <td className="py-3 pr-4" style={{ color: 'var(--color-text-secondary)' }}>
                {timeAgo(run.created_at)}
              </td>
              <td className="py-3 text-right whitespace-nowrap">
                <Link
                  to={`/history/research/${run.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg mr-2"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  <Eye size={12} /> View
                </Link>
                <button
                  onClick={() => onDelete(run.id, run.topic)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer"
                  style={{ border: '1px solid #FECACA', color: '#DC2626' }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RagSessionsTable({ sessions, onDelete }) {
  if (sessions === null) return <EmptyState message="Loading…" />;
  if (sessions.length === 0) return <EmptyState message="No PDFs uploaded yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
            <th className="pb-3 font-medium">PDF</th>
            <th className="pb-3 font-medium">Status</th>
            <th className="pb-3 font-medium">Chunks</th>
            <th className="pb-3 font-medium">Created</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b" style={{ borderColor: 'var(--color-border-light)' }}>
              <td className="py-3 pr-4 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {s.pdf_filename}
              </td>
              <td className="py-3 pr-4">
                <StatusPill status={s.status} />
              </td>
              <td className="py-3 pr-4" style={{ color: 'var(--color-text-secondary)' }}>
                {s.num_chunks ?? '—'}
              </td>
              <td className="py-3 pr-4" style={{ color: 'var(--color-text-secondary)' }}>
                {timeAgo(s.created_at)}
              </td>
              <td className="py-3 text-right whitespace-nowrap">
                <Link
                  to={`/history/rag/${s.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg mr-2"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  <Eye size={12} /> View
                </Link>
                <button
                  onClick={() => onDelete(s.id, s.pdf_filename)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer"
                  style={{ border: '1px solid #FECACA', color: '#DC2626' }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function History() {
  const [activeTab, setActiveTab] = useState('research');
  const [runs, setRuns] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { type, id, label }

  const loadRuns = useCallback(() => {
    setError(null);
    researchApi.list().then(setRuns).catch((err) => setError(err.message));
  }, []);

  const loadSessions = useCallback(() => {
    setError(null);
    ragApi.listSessions().then(setSessions).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadRuns();
    loadSessions();
  }, [loadRuns, loadSessions]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.type === 'research') {
        await researchApi.remove(pendingDelete.id);
        loadRuns();
      } else {
        await ragApi.removeSession(pendingDelete.id);
        loadSessions();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div
      className="bg-white"
      style={{ borderRadius: 'var(--radius-panel)', boxShadow: 'var(--shadow-panel)', minHeight: 'calc(100vh - 140px)' }}
    >
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors cursor-pointer"
              style={{ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
            >
              <Icon size={16} />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: 'var(--color-text-primary)' }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="p-6 sm:p-8">
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} onRetry={activeTab === 'research' ? loadRuns : loadSessions} />
          </div>
        )}

        {activeTab === 'research' && (
          <ResearchRunsTable runs={runs} onDelete={(id, topic) => setPendingDelete({ type: 'research', id, label: `research run "${topic}"` })} />
        )}
        {activeTab === 'rag' && (
          <RagSessionsTable sessions={sessions} onDelete={(id, name) => setPendingDelete({ type: 'rag', id, label: `PDF "${name}"` })} />
        )}
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        title="Delete this?"
        message={pendingDelete ? `This will permanently delete ${pendingDelete.label}. This can't be undone.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
