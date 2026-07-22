import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronUp, Download, Search, FileText, PenTool, MessageSquare } from 'lucide-react';

function Accordion({ title, icon: Icon, iconBg, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="bg-white overflow-hidden transition-all"
      style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer transition-colors hover:bg-gray-50"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={15} style={{ color: 'var(--color-text-secondary)' }} />
        </div>
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        {open ? (
          <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 animate-fade-in-up">
          {children}
        </div>
      )}
    </div>
  );
}

// `run` is a RunDetail: { topic, report, feedback, search_results, scraped_content, ... }
export default function ResearchResults({ run }) {
  const handleDownload = () => {
    if (!run?.report) return;
    const blob = new Blob([run.report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research_report_${run.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!run) return null;

  return (
    <div className="mt-8 space-y-4 animate-fade-in-up">
      <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
        Results
      </h2>

      {/* ── Raw Search Results ─────────────────────────────────────── */}
      {run.search_results && (
        <Accordion title="Search Results" icon={Search} iconBg="var(--color-accent-blue)">
          <div
            className="text-sm whitespace-pre-wrap leading-relaxed p-4 rounded-lg"
            style={{ backgroundColor: '#F9FAFB', color: 'var(--color-text-secondary)', maxHeight: '400px', overflowY: 'auto' }}
          >
            {run.search_results}
          </div>
        </Accordion>
      )}

      {/* ── Scraped Content ────────────────────────────────────────── */}
      {run.scraped_content && (
        <Accordion title="Scraped Content" icon={FileText} iconBg="var(--color-accent-mint)">
          <div
            className="text-sm whitespace-pre-wrap leading-relaxed p-4 rounded-lg"
            style={{ backgroundColor: '#F9FAFB', color: 'var(--color-text-secondary)', maxHeight: '400px', overflowY: 'auto' }}
          >
            {run.scraped_content}
          </div>
        </Accordion>
      )}

      {/* ── Final Research Report ──────────────────────────────────── */}
      {run.report && (
        <div
          className="bg-white overflow-hidden"
          style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent-lavender)' }}>
                <PenTool size={15} style={{ color: 'var(--color-text-secondary)' }} />
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Final Research Report
              </span>
            </div>
            <button
              id="download-report-btn"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'white' }}
            >
              <Download size={13} />
              Download .md
            </button>
          </div>
          <div className="px-5 py-5 markdown-content">
            <ReactMarkdown>{run.report}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* ── Critic Feedback (collapsible) ──────────────────────────── */}
      {run.feedback && (
        <Accordion title="Critic Feedback" icon={MessageSquare} iconBg="var(--color-accent-peach)" defaultOpen>
          <div className="markdown-content text-sm leading-relaxed">
            <ReactMarkdown>{run.feedback}</ReactMarkdown>
          </div>
        </Accordion>
      )}
    </div>
  );
}
