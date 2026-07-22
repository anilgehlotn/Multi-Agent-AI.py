import { useState, useCallback } from 'react';
import PdfUploader from './PdfUploader';
import VectorDbBuilder from './VectorDbBuilder';
import QuestionAnswer from './QuestionAnswer';
import ErrorBanner from './ErrorBanner';
import { ragApi } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { storage } from '../lib/storage';

const ACTIVE_STATUSES = new Set(['pending', 'indexing']);

export default function RagTab() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [sessionId, setSessionId] = useState(() => storage.getActiveSessionId());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const { data: session, error: pollError } = usePolling(
    () => ragApi.sessionStatus(sessionId),
    {
      intervalMs: 2000,
      enabled: !!sessionId,
      stopWhen: (result) => result && !ACTIVE_STATUSES.has(result.status),
    }
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile || uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      const created = await ragApi.upload(selectedFile);
      setSessionId(created.id);
      storage.setActiveSessionId(created.id);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }, [selectedFile, uploading]);

  const handleChangePdf = useCallback(() => {
    // Default: reset local state but keep the old session in History.
    setSelectedFile(null);
    setSessionId(null);
    setUploadError(null);
    storage.setActiveSessionId(null);

    // Alternative: also delete the previous session's data instead of just
    // forgetting it locally — uncomment for "change PDF" == "throw the old
    // one away" rather than "start a new one, old one stays in History":
    // if (sessionId) ragApi.removeSession(sessionId).catch(() => {});
  }, []);

  const isReady = session?.status === 'ready';
  const hasActiveSession = !!sessionId;

  return (
    <div className="animate-fade-in-up">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Book Q&A (RAG)
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Upload a PDF, build a vector index, then ask questions — answers come exclusively from the document.
        </p>
      </div>

      <div className="max-w-xl mx-auto space-y-6">
        {pollError && <ErrorBanner message={pollError.message} />}

        {!hasActiveSession && (
          <>
            <PdfUploader selectedFile={selectedFile} onSelect={setSelectedFile} />
            {selectedFile && (
              <VectorDbBuilder session={null} uploading={uploading} uploadError={uploadError} onUpload={handleUpload} />
            )}
          </>
        )}

        {hasActiveSession && (
          <>
            <VectorDbBuilder session={session} uploading={!session} uploadError={null} onUpload={() => {}} />

            <div className="flex justify-end">
              <button
                onClick={handleChangePdf}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                Change PDF
              </button>
            </div>

            <QuestionAnswer sessionId={sessionId} ready={isReady} />
          </>
        )}
      </div>
    </div>
  );
}
