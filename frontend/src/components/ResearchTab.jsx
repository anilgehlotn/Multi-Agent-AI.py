import { useState, useEffect, useCallback, useRef } from 'react';
import TopicInput from './TopicInput';
import PipelineSteps from './PipelineSteps';
import ResearchResults from './ResearchResults';
import { runResearch, getResearchStatus } from '../lib/api';

export default function ResearchTab() {
  const [topic, setTopic] = useState('');
  const [jobId, setJobId] = useState(null);
  const [currentStep, setCurrentStep] = useState(null); // null | search | reader | writer | critic | done | error
  const [results, setResults] = useState({});
  const [error, setError] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const pollRef = useRef(null);

  // ── Poll for status updates ────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const { data, error: err } = await getResearchStatus(id);
      if (err) {
        setError(err);
        setIsRunning(false);
        stopPolling();
        return;
      }
      if (data) {
        setCurrentStep(data.step);
        setResults(data.results || {});
        if (data.error) {
          setError(data.error);
          setIsRunning(false);
          stopPolling();
        } else if (data.step === 'done') {
          setIsRunning(false);
          stopPolling();
        }
      }
    }, 1500);
  }, [stopPolling]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // ── Start research ─────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!topic.trim()) return;

    setError(null);
    setResults({});
    setCurrentStep('queued');
    setIsRunning(true);

    const { data, error: err } = await runResearch(topic.trim());
    if (err) {
      setError(err);
      setIsRunning(false);
      setCurrentStep(null);
      return;
    }

    setJobId(data.job_id);
    startPolling(data.job_id);
  };

  return (
    <div className="animate-fade-in-up">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Research Agent
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Four AI agents collaborate — searching, scraping, writing, and critiquing — to deliver a polished research report.
        </p>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Input */}
        <div className="lg:col-span-2">
          <TopicInput
            topic={topic}
            setTopic={setTopic}
            onRun={handleRun}
            isRunning={isRunning}
          />
        </div>

        {/* Right: Pipeline steps */}
        <div className="lg:col-span-3">
          <PipelineSteps currentStep={currentStep} results={results} />
        </div>
      </div>

      {/* ── Error display ──────────────────────────────────────────────── */}
      {error && (
        <div
          className="mt-6 p-4 rounded-xl text-sm font-medium animate-fade-in-up"
          style={{
            backgroundColor: '#FEF2F2',
            color: '#DC2626',
            border: '1px solid #FECACA',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* ── Results (full width, below) ────────────────────────────────── */}
      {currentStep === 'done' && Object.keys(results).length > 0 && (
        <ResearchResults results={results} topic={topic} />
      )}
    </div>
  );
}
