import { useState, useEffect, useCallback, useRef } from 'react';
import TopicInput from './TopicInput';
import PipelineSteps from './PipelineSteps';
import ResearchResults from './ResearchResults';
import ErrorBanner from './ErrorBanner';
import { researchApi } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { storage } from '../lib/storage';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

export default function ResearchTab() {
  const [topic, setTopic] = useState(() => storage.getLastTopic());
  const [runId, setRunId] = useState(() => storage.getActiveRunId());
  const [startError, setStartError] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const fetchedDetailFor = useRef(null);

  const { data: run, error: pollError } = usePolling(
    () => researchApi.status(runId),
    {
      intervalMs: 2000,
      enabled: !!runId,
      stopWhen: (result) => result && !ACTIVE_STATUSES.has(result.status),
    }
  );

  const isRunning = !!runId && (!run || ACTIVE_STATUSES.has(run.status));

  // Once the run reaches a terminal state, drop it from "resume on refresh"
  // storage and fetch the full report/feedback once.
  useEffect(() => {
    if (!run || !runId) return;
    if (ACTIVE_STATUSES.has(run.status)) return;

    storage.setActiveRunId(null);

    if (run.status === 'completed' && fetchedDetailFor.current !== runId) {
      fetchedDetailFor.current = runId;
      setDetailError(null);
      researchApi
        .get(runId)
        .then(setRunDetail)
        .catch((err) => setDetailError(err.message));
    }
  }, [run, runId]);

  const handleRun = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;

    setStartError(null);
    setRunDetail(null);
    fetchedDetailFor.current = null;
    storage.setLastTopic(trimmed);

    try {
      const created = await researchApi.run(trimmed);
      setRunId(created.id);
      storage.setActiveRunId(created.id);
    } catch (err) {
      setStartError(err.message);
    }
  }, [topic]);

  const activeError = run?.status === 'failed' ? run.error : pollError?.message || startError;

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
        <div className="lg:col-span-2">
          <TopicInput topic={topic} setTopic={setTopic} onRun={handleRun} isRunning={isRunning} />
        </div>

        <div className="lg:col-span-3">
          <PipelineSteps steps={run?.steps} />
        </div>
      </div>

      {/* ── Error display ──────────────────────────────────────────────── */}
      {activeError && (
        <div className="mt-6">
          <ErrorBanner message={activeError} />
        </div>
      )}
      {detailError && (
        <div className="mt-6">
          <ErrorBanner message={`Run completed, but the report failed to load: ${detailError}`} onRetry={() => researchApi.get(runId).then(setRunDetail).catch((err) => setDetailError(err.message))} />
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────── */}
      {run?.status === 'completed' && runDetail && <ResearchResults run={runDetail} />}
    </div>
  );
}
