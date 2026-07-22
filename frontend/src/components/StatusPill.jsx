const CONFIG = {
  pending: { label: 'PENDING', bg: '#F3F4F6', color: 'var(--color-status-waiting)' },
  waiting: { label: 'WAITING', bg: '#F3F4F6', color: 'var(--color-status-waiting)' },
  indexing: { label: '● INDEXING', bg: '#FEF3C7', color: 'var(--color-status-running)' },
  running: { label: '● RUNNING', bg: '#FEF3C7', color: 'var(--color-status-running)' },
  ready: { label: '✓ READY', bg: '#D1FAE5', color: 'var(--color-status-done)' },
  completed: { label: '✓ COMPLETED', bg: '#D1FAE5', color: 'var(--color-status-done)' },
  done: { label: '✓ DONE', bg: '#D1FAE5', color: 'var(--color-status-done)' },
  failed: { label: '✕ FAILED', bg: '#FEE2E2', color: 'var(--color-status-error)' },
};

export default function StatusPill({ status }) {
  const config = CONFIG[status] || { label: status?.toUpperCase() || 'UNKNOWN', bg: '#F3F4F6', color: 'var(--color-text-muted)' };
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full inline-block"
      style={{
        backgroundColor: config.bg,
        color: config.color,
        ...(status === 'running' || status === 'indexing' ? { animation: 'pulse-soft 1.5s ease-in-out infinite' } : {}),
      }}
    >
      {config.label}
    </span>
  );
}
