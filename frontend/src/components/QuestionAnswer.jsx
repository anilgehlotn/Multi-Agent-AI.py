import { useState } from 'react';
import { Send, AlertCircle, MessageCircle, Bot, User, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ragApi } from '../lib/api';

function SourceChip({ source }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="inline-block">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors"
        style={{ backgroundColor: 'var(--color-border-light)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
      >
        <FileText size={11} />
        {source.page != null ? `p. ${source.page + 1}` : 'source'}
      </button>
      {expanded && (
        <div
          className="mt-1.5 p-3 text-xs leading-relaxed rounded-lg animate-fade-in-up"
          style={{ backgroundColor: '#F9FAFB', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
        >
          &ldquo;{source.snippet}&rdquo;
        </div>
      )}
    </div>
  );
}

// `sessionId` — the RAG session to ask against
// `ready` — whether the session's index is ready (gates the input)
// `initialQueries` — QueryOut[] to seed the log with (e.g. from history)
export default function QuestionAnswer({ sessionId, ready, initialQueries = [] }) {
  const [question, setQuestion] = useState('');
  const [log, setLog] = useState(initialQueries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading || !ready) return;

    setError(null);
    setLoading(true);

    try {
      const result = await ragApi.ask(sessionId, trimmed);
      setLog((prev) => [...prev, result]);
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* ── Chat log ──────────────────────────────────────────────────── */}
      {log.length > 0 && (
        <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
          {log.map((entry) => (
            <div key={entry.id ?? entry.question} className="space-y-2">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-accent-pink)' }}>
                  <User size={13} style={{ color: 'var(--color-text-secondary)' }} />
                </div>
                <p className="text-sm font-medium pt-1" style={{ color: 'var(--color-text-primary)' }}>
                  {entry.question}
                </p>
              </div>
              <div
                className="ml-9 p-4"
                style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'white', boxShadow: 'var(--shadow-card)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent-mint)' }}>
                    <Bot size={12} style={{ color: '#059669' }} />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                    AI Answer
                  </span>
                </div>
                <div className="markdown-content text-sm leading-relaxed">
                  <ReactMarkdown>{entry.answer || ''}</ReactMarkdown>
                </div>
                {entry.sources?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.sources.map((source, i) => (
                      <SourceChip key={i} source={source} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Question input ────────────────────────────────────────────── */}
      <div
        className="p-5"
        style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'white', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent-pink)' }}>
            <MessageCircle size={17} style={{ color: 'var(--color-text-secondary)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Ask a Question
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Answers are sourced exclusively from your uploaded PDF
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            id="question-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder={ready ? 'What does the document say about…' : 'Waiting for the index to be ready…'}
            disabled={loading || !ready}
            className="flex-1 px-4 py-2.5 text-sm rounded-lg outline-none transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: loading || !ready ? '#F9FAFB' : 'white' }}
          />
          <button
            id="ask-question-btn"
            onClick={handleAsk}
            disabled={!question.trim() || loading || !ready}
            className="flex items-center justify-center px-4 py-2.5 text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-btn-primary-bg)', borderRadius: 'var(--radius-btn)' }}
          >
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 text-xs font-medium p-3 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────────── */}
      {loading && (
        <div className="p-5" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'white', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Bot size={16} style={{ color: 'var(--color-text-muted)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              AI is thinking…
            </span>
          </div>
          <div className="space-y-2">
            <div className="h-4 rounded animate-shimmer" style={{ width: '90%' }} />
            <div className="h-4 rounded animate-shimmer" style={{ width: '75%' }} />
            <div className="h-4 rounded animate-shimmer" style={{ width: '60%' }} />
          </div>
        </div>
      )}
    </div>
  );
}
