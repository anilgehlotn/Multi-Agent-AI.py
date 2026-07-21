/**
 * Centralized API layer — all backend calls go through here.
 * Uses VITE_API_BASE_URL env var (default: http://localhost:8000).
 */
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000, // 2 min — some LLM calls are slow
});

// ── Wrapper: returns { data, error } so components don't need try/catch ─────
async function safeCall(promise) {
  try {
    const res = await promise;
    return { data: res.data, error: null };
  } catch (err) {
    const message =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      err.message ||
      'Something went wrong';
    return { data: null, error: message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RESEARCH PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

export async function runResearch(topic) {
  return safeCall(api.post('/api/research/run', { topic }));
}

export async function getResearchStatus(jobId) {
  return safeCall(api.get(`/api/research/status/${jobId}`));
}

// ══════════════════════════════════════════════════════════════════════════════
// RAG PDF Q&A
// ══════════════════════════════════════════════════════════════════════════════

export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append('file', file);
  return safeCall(api.post('/api/rag/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }));
}

export async function buildIndex(fileId) {
  return safeCall(api.post('/api/rag/build-index', { file_id: fileId }));
}

export async function askQuestion(question) {
  return safeCall(api.post('/api/rag/ask', { question }));
}
