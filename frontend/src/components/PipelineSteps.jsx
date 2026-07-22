import { useEffect, useState } from 'react';
import { Search, FileText, PenTool, MessageSquare } from 'lucide-react';
import { elapsedMMSS } from '../lib/format';

const STEPS = [
  {
    key: 'search',
    num: '01',
    title: 'Search Agent',
    desc: 'Gathers recent web information',
    icon: Search,
    accentBg: 'var(--color-accent-blue)',
  },
  {
    key: 'reader',
    num: '02',
    title: 'Reader Agent',
    desc: 'Scrapes & extracts deep content',
    icon: FileText,
    accentBg: 'var(--color-accent-mint)',
  },
  {
    key: 'writer',
    num: '03',
    title: 'Writer Chain',
    desc: 'Drafts the full research report',
    icon: PenTool,
    accentBg: 'var(--color-accent-lavender)',
  },
  {
    key: 'critic',
    num: '04',
    title: 'Critic Chain',
    desc: 'Reviews & scores the report',
    icon: MessageSquare,
    accentBg: 'var(--color-accent-peach)',
  },
];

const STATUS_CONFIG = {
  waiting: { label: 'WAITING', color: 'var(--color-status-waiting)', bg: '#F3F4F6', bar: '#E5E7EB', border: 'var(--color-border)' },
  running: { label: '● RUNNING', color: 'var(--color-status-running)', bg: '#FEF3C7', bar: 'var(--color-status-running)', border: '#FDE68A' },
  done: { label: '✓ DONE', color: 'var(--color-status-done)', bg: '#D1FAE5', bar: 'var(--color-status-done)', border: '#A7F3D0' },
  failed: { label: '✕ FAILED', color: 'var(--color-status-error)', bg: '#FEE2E2', bar: 'var(--color-status-error)', border: '#FECACA' },
};

function ElapsedTicker({ since }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{elapsedMMSS(since)}</span>;
}

export default function PipelineSteps({ steps }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
        Pipeline
      </h2>
      <div className="space-y-3 stagger-children">
        {STEPS.map((step) => {
          const stepData = steps?.[step.key] || { status: 'waiting' };
          const status = STATUS_CONFIG[stepData.status] ? stepData.status : 'waiting';
          const config = STATUS_CONFIG[status];
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className="relative overflow-hidden flex items-center gap-4 p-4 bg-white transition-all"
              style={{
                borderRadius: 'var(--radius-card)',
                border: `1px solid ${config.border}`,
                boxShadow: status === 'running' ? '0 0 0 3px rgba(245,158,11,0.08)' : 'var(--shadow-card)',
              }}
            >
              {/* Left accent bar */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1 transition-colors"
                style={{
                  backgroundColor: config.bar,
                  borderRadius: 'var(--radius-card) 0 0 var(--radius-card)',
                }}
              />

              {/* Icon circle */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ml-2"
                style={{ backgroundColor: step.accentBg }}
              >
                <Icon size={18} style={{ color: 'var(--color-text-secondary)' }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {step.num}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {step.title}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {status === 'running' && stepData.started_at ? (
                    <ElapsedTicker since={stepData.started_at} />
                  ) : (
                    step.desc
                  )}
                </p>
              </div>

              {/* Status badge */}
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: config.bg,
                  color: config.color,
                  ...(status === 'running' ? { animation: 'pulse-soft 1.5s ease-in-out infinite' } : {}),
                }}
              >
                {config.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
