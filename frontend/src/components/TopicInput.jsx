import { Zap } from 'lucide-react';

const EXAMPLES = ['LLM agents 2025', 'CRISPR gene editing', 'Fusion energy progress'];

export default function TopicInput({ topic, setTopic, onRun, isRunning }) {
  return (
    <div>
      {/* ── Input card ──────────────────────────────────────────────── */}
      <div
        className="p-6 bg-white"
        style={{
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <label
          htmlFor="topic-input"
          className="block text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Research Topic
        </label>
        <input
          id="topic-input"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isRunning && onRun()}
          placeholder="e.g. Quantum computing breakthroughs in 2025"
          disabled={isRunning}
          className="w-full px-4 py-3 text-sm rounded-lg transition-all outline-none"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            backgroundColor: isRunning ? '#F9FAFB' : 'white',
          }}
        />

        <button
          id="run-research-btn"
          onClick={onRun}
          disabled={isRunning || !topic.trim()}
          className="mt-4 w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
          {isRunning ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Zap size={15} />
              Run Research Pipeline
            </>
          )}
        </button>
      </div>

      {/* ── Example chips ───────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Try →
        </span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setTopic(ex)}
            disabled={isRunning}
            className="px-3 py-1.5 text-xs rounded-full transition-all cursor-pointer disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-border-light)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) {
                e.target.style.backgroundColor = '#E5E7EB';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'var(--color-border-light)';
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
