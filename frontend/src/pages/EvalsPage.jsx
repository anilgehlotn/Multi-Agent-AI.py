import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, BookOpen, AlertTriangle, Info, Terminal } from 'lucide-react';
import { evalsApi } from '../lib/api';
import StatusPill from '../components/StatusPill';
import ErrorBanner from '../components/ErrorBanner';
import { timeAgo } from '../lib/format';

// ── Helpers ──────────────────────────────────────────────────────────────

function scoreColor(value) {
  if (value == null) return { bg: '#F3F4F6', fg: 'var(--color-text-muted)' };
  if (value >= 4) return { bg: '#D1FAE5', fg: '#059669' };
  if (value >= 3) return { bg: '#FEF3C7', fg: '#D97706' };
  return { bg: '#FEE2E2', fg: '#DC2626' };
}

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtPct(fraction) {
  return fraction == null ? '—' : `${Math.round(fraction * 100)}%`;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function completedRowCount(rows) {
  return rows.filter((r) => r.scores).length;
}

// ── Small shared pieces ──────────────────────────────────────────────────

function ScoreBadge({ value, decimals = 0 }) {
  const { bg, fg } = scoreColor(value);
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold min-w-[28px] text-center"
      style={{ backgroundColor: bg, color: fg }}
    >
      {value == null ? '—' : value.toFixed(decimals)}
    </span>
  );
}

function ScorePill({ label, value, highlight = false }) {
  const { bg, fg } = scoreColor(value);
  const style = highlight
    ? { backgroundColor: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)' }
    : { backgroundColor: bg, color: fg };
  return (
    <div className="rounded-xl p-3 flex flex-col items-center justify-center gap-0.5 text-center" style={style}>
      <span className="text-xl font-bold leading-tight">
        {value != null ? value.toFixed(1) : '—'}
        <span className="text-xs font-medium opacity-60">/5</span>
      </span>
      <span
        className="text-[11px] font-medium"
        style={highlight ? { color: 'rgba(255,255,255,0.75)' } : { color: 'var(--color-text-secondary)' }}
      >
        {label}
      </span>
    </div>
  );
}

function RatePill({ label, value }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col items-center justify-center gap-0.5 text-center"
      style={{ backgroundColor: 'var(--color-accent-blue)', color: '#1D4ED8' }}
    >
      <span className="text-xl font-bold leading-tight">{fmtPct(value)}</span>
      <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
    </div>
  );
}

const TYPE_STYLES = {
  factual: { bg: 'var(--color-accent-blue)', fg: '#1D4ED8' },
  synthesis: { bg: 'var(--color-accent-lavender)', fg: '#6D28D9' },
  adversarial: { bg: 'var(--color-accent-peach)', fg: '#C2410C' },
};

function TypeBadge({ type }) {
  const s = TYPE_STYLES[type] || { bg: '#F3F4F6', fg: 'var(--color-text-muted)' };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {type}
    </span>
  );
}

function QuotaBanner({ completed, total }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium"
      style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
    >
      <AlertTriangle size={14} className="flex-shrink-0" />
      <span>
        This run was partially blocked by API quota. {completed} of {total} items completed.
      </span>
    </div>
  );
}

function CardShell({ children }) {
  return (
    <div
      className="bg-white overflow-hidden"
      style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </div>
  );
}

function NoModeResults({ icon: Icon, title }) {
  return (
    <CardShell>
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-border-light)' }}>
          <Icon size={15} style={{ color: 'var(--color-text-secondary)' }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</span>
      </div>
      <p className="text-sm text-center py-12 px-6" style={{ color: 'var(--color-text-muted)' }}>
        No cached results for this eval yet.
      </p>
    </CardShell>
  );
}

function SkeletonCard() {
  return (
    <CardShell>
      <div className="p-5 space-y-4">
        <div className="h-5 rounded animate-shimmer" style={{ width: '40%' }} />
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-shimmer" />
          ))}
        </div>
        <div className="space-y-2">
          <div className="h-4 rounded animate-shimmer" style={{ width: '100%' }} />
          <div className="h-4 rounded animate-shimmer" style={{ width: '90%' }} />
          <div className="h-4 rounded animate-shimmer" style={{ width: '95%' }} />
        </div>
      </div>
    </CardShell>
  );
}

// ── Research scorecard ───────────────────────────────────────────────────

function ResearchScorecard({ data }) {
  if (!data) return <NoModeResults icon={FlaskConical} title="Research Pipeline Eval" />;

  const { rows, aggregate: agg, timestamp } = data;
  const quotaBlocked = !!agg.quota_blocked;

  return (
    <CardShell>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent-blue)' }}>
            <FlaskConical size={15} style={{ color: 'var(--color-text-secondary)' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Research Pipeline Eval</span>
        </div>
        {timestamp && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{timeAgo(timestamp)}</span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {quotaBlocked && <QuotaBanner completed={rows.length - agg.quota_blocked_count} total={rows.length} />}

        <div className="grid grid-cols-5 gap-2">
          <ScorePill label="Coverage" value={agg.mean_coverage} />
          <ScorePill label="Depth" value={agg.mean_depth} />
          <ScorePill label="Structure" value={agg.mean_structure} />
          <ScorePill label="Citations" value={agg.mean_citations} />
          <ScorePill label="Overall" value={agg.mean_overall} highlight />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '600px' }}>
            <thead>
              <tr className="text-left border-b sticky top-0 bg-white" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
                <th className="pb-2 pr-2 font-medium whitespace-nowrap">Topic</th>
                <th className="pb-2 pr-2 font-medium whitespace-nowrap">Status</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Cov</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Dep</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Str</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Cite</th>
                <th className="pb-2 pr-2 font-medium text-right whitespace-nowrap">KW Recall</th>
                <th className="pb-2 pr-2 font-medium text-right whitespace-nowrap">Overall</th>
                <th className="pb-2 font-medium text-right whitespace-nowrap">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const s = r.scores || {};
                return (
                  <tr key={r.topic_id} style={{ backgroundColor: i % 2 === 1 ? '#F9FAFB' : 'transparent' }}>
                    <td className="py-2 pr-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                      {r.topic_id} {truncate(r.topic, 30)}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap"><StatusPill status={r.status} /></td>
                    <td className="py-2 pr-1 text-right"><ScoreBadge value={s.coverage} /></td>
                    <td className="py-2 pr-1 text-right"><ScoreBadge value={s.depth} /></td>
                    <td className="py-2 pr-1 text-right"><ScoreBadge value={s.structure} /></td>
                    <td className="py-2 pr-1 text-right"><ScoreBadge value={s.citations} /></td>
                    <td className="py-2 pr-2 text-right" style={{ color: 'var(--color-text-secondary)' }}>{fmtPct(s.keyword_recall)}</td>
                    <td className="py-2 pr-2 text-right"><ScoreBadge value={s.overall} decimals={1} /></td>
                    <td className="py-2 text-right whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtDuration(r.timing_seconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs pt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Success rate: {agg.completed_count}/{agg.total_count} · Judge failures: {agg.judge_failures} · Total time: {fmtDuration(agg.total_wall_seconds)}
        </p>
      </div>
    </CardShell>
  );
}

// ── RAG scorecard ────────────────────────────────────────────────────────

function RagScorecard({ data }) {
  if (!data) return <NoModeResults icon={BookOpen} title="RAG Q&A Eval" />;

  const { rows, aggregate: agg, timestamp } = data;
  const quotaBlocked = !!agg.quota_blocked;

  return (
    <CardShell>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent-mint)' }}>
            <BookOpen size={15} style={{ color: 'var(--color-text-secondary)' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>RAG Q&A Eval</span>
        </div>
        {timestamp && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{timeAgo(timestamp)}</span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {quotaBlocked && <QuotaBanner completed={rows.length - agg.quota_blocked_count} total={rows.length} />}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <ScorePill label="Correctness" value={agg.mean_correctness} />
          <ScorePill label="Faithfulness" value={agg.mean_faithfulness} />
          <ScorePill label="Completeness" value={agg.mean_completeness} />
          <ScorePill label="Overall" value={agg.mean_overall} highlight />
          <RatePill label="Retrieval Hit" value={agg.retrieval_hit_rate} />
          <RatePill label="Refusal Rate" value={agg.adversarial_refusal_rate} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '680px' }}>
            <thead>
              <tr className="text-left border-b sticky top-0 bg-white" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
                <th className="pb-2 pr-2 font-medium whitespace-nowrap">Q</th>
                <th className="pb-2 pr-2 font-medium whitespace-nowrap">Type</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Correct</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Faithful</th>
                <th className="pb-2 pr-1 font-medium text-right whitespace-nowrap">Complete</th>
                <th className="pb-2 pr-2 font-medium text-right whitespace-nowrap">Overall</th>
                <th className="pb-2 pr-2 font-medium text-center whitespace-nowrap">Retrieval</th>
                <th className="pb-2 font-medium text-center whitespace-nowrap">Refused OK</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const s = r.scores || {};
                const isAdv = r.type === 'adversarial';
                const hit = s.retrieval_hit;
                return (
                  <tr key={r.qa_id} style={{ backgroundColor: i % 2 === 1 ? '#F9FAFB' : 'transparent' }}>
                    <td className="py-2 pr-2" style={{ color: 'var(--color-text-primary)' }}>
                      <span className="font-medium whitespace-nowrap">{r.qa_id}</span>{' '}
                      <span style={{ color: 'var(--color-text-secondary)' }}>{truncate(r.question, 42)}</span>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap"><TypeBadge type={r.type} /></td>
                    <td className="py-2 pr-1 text-right whitespace-nowrap">{isAdv ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : <ScoreBadge value={s.correctness} />}</td>
                    <td className="py-2 pr-1 text-right whitespace-nowrap"><ScoreBadge value={s.faithfulness} /></td>
                    <td className="py-2 pr-1 text-right whitespace-nowrap">{isAdv ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : <ScoreBadge value={s.completeness} />}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">{isAdv ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : <ScoreBadge value={s.overall} />}</td>
                    <td className="py-2 pr-2 text-center whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {isAdv ? '—' : hit == null ? '—' : hit ? '✓' : '✗'}
                    </td>
                    <td className="py-2 text-center whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {isAdv ? (s.refused_correctly ? '✓' : '✗') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs pt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Items: {completedRowCount(rows)}/{agg.total_count} · Judge failures: {agg.judge_failures} · Total time: {fmtDuration(agg.total_wall_seconds)}
        </p>
      </div>
    </CardShell>
  );
}

// ── Empty state (both modes missing) ────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex justify-center py-16">
      <CardShell>
        <div className="px-8 py-10 flex flex-col items-center gap-3 text-center max-w-md">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-border-light)' }}>
            <Terminal size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            No evaluation results available yet.
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Run the eval suite locally to generate a scorecard.
          </p>
          <code
            className="text-xs px-3 py-2 rounded-lg mt-1"
            style={{ backgroundColor: '#F3F4F6', color: 'var(--color-text-primary)', fontFamily: 'ui-monospace, monospace' }}
          >
            python -m evals.run all
          </code>
        </div>
      </CardShell>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function EvalsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    evalsApi
      .latest()
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isEmpty = data && !data.research && !data.rag;

  return (
    <div
      className="bg-white p-6 sm:p-8"
      style={{ borderRadius: 'var(--radius-panel)', boxShadow: 'var(--shadow-panel)', minHeight: 'calc(100vh - 140px)' }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Evaluations</h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--color-text-secondary)' }}>
          LLM-as-judge scoring against gold datasets for both the research pipeline and the RAG Q&A system.
          Results shown are from the most recent offline eval run.
        </p>
        <div
          className="flex items-start gap-2 mt-4 px-4 py-2.5 rounded-lg text-xs"
          style={{ backgroundColor: 'var(--color-accent-blue)', color: '#1D4ED8' }}
        >
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Evals are run offline via <code style={{ fontFamily: 'ui-monospace, monospace' }}>python -m evals.run all</code> — this page
            displays the cached results to avoid burning API quota on every page load.
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && !error && isEmpty && <EmptyState />}

        {!loading && !error && !isEmpty && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <ResearchScorecard data={data.research} />
            <RagScorecard data={data.rag} />
          </div>
        )}
      </div>
    </div>
  );
}
