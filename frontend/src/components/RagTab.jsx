import { useState } from 'react';
import PdfUploader from './PdfUploader';
import VectorDbBuilder from './VectorDbBuilder';
import QuestionAnswer from './QuestionAnswer';

export default function RagTab() {
  const [fileId, setFileId] = useState(null);
  const [fileName, setFileName] = useState('');
  const [indexReady, setIndexReady] = useState(false);

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

      {/* ── Centered workflow ──────────────────────────────────────────── */}
      <div className="max-w-xl mx-auto space-y-6">
        {/* Step 1: Upload */}
        <PdfUploader
          fileId={fileId}
          fileName={fileName}
          onUpload={(id, name) => {
            setFileId(id);
            setFileName(name);
            setIndexReady(false);
          }}
        />

        {/* Step 2: Build index */}
        <VectorDbBuilder
          fileId={fileId}
          disabled={!fileId}
          onSuccess={() => setIndexReady(true)}
        />

        {/* Step 3: Ask questions */}
        {indexReady && <QuestionAnswer />}
      </div>
    </div>
  );
}
