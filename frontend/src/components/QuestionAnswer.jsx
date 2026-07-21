import { useState } from 'react';
import { Send, AlertCircle, MessageCircle, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { askQuestion } from '../lib/api';

export default function QuestionAnswer() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAsk = async () => {
    if (!question.trim() || loading) return;

    setError(null);
    setAnswer(null);
    setLoading(true);

    const { data, error: err } = await askQuestion(question.trim());
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    setAnswer(data.answer);
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* ── Question input ────────────────────────────────────────────── */}
      <div
        className="p-5"
        style={{
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          backgroundColor: 'white',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-accent-pink)' }}
          >
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
            placeholder="What does the document say about…"
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm rounded-lg outline-none transition-all"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              backgroundColor: loading ? '#F9FAFB' : 'white',
            }}
          />
          <button
            id="ask-question-btn"
            onClick={handleAsk}
            disabled={!question.trim() || loading}
            className="flex items-center justify-center px-4 py-2.5 text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-btn-primary-bg)',
              borderRadius: 'var(--radius-btn)',
            }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
            }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send size={15} />
            )}
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
        <div
          className="p-5"
          style={{
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'white',
            boxShadow: 'var(--shadow-card)',
          }}
        >
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

      {/* ── Answer ────────────────────────────────────────────────────── */}
      {answer && !loading && (
        <div
          className="p-5 animate-fade-in-up"
          style={{
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'white',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent-mint)' }}
            >
              <Bot size={14} style={{ color: '#059669' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              AI Answer
            </span>
          </div>
          <div className="markdown-content text-sm leading-relaxed">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
