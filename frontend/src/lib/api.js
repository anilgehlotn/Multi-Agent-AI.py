/**
 * Centralized API layer — all backend calls go through here.
 * Uses VITE_API_BASE_URL env var (default: http://localhost:8000).
 */
const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function apiFetch(path, options = {}) {
  const isFormData = options.body instanceof FormData;

  const headers = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };

  // TODO: once auth is wired up, attach the bearer token here, e.g.
  // const token = localStorage.getItem('researchmind:token');
  // if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    const err = new Error('Could not reach the server. Is the backend running?');
    err.status = 0;
    throw err;
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch {
      // body wasn't JSON — fall back to statusText
    }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// Hits the backend's /warmup endpoint. Useful on Render's free tier, where
// the backend sleeps after 15min idle and the first real request eats a
// ~30s cold start — call this earlier (e.g. on app load) to absorb that.
// Not auto-invoked here; the caller decides when to fire it.
export function warmup() {
  return apiFetch('/warmup');
}

// ══════════════════════════════════════════════════════════════════════════
// RESEARCH PIPELINE
// ══════════════════════════════════════════════════════════════════════════

export const researchApi = {
  run(topic) {
    return apiFetch('/research/run', {
      method: 'POST',
      body: JSON.stringify({ topic }),
    });
  },
  list(limit = 50, offset = 0) {
    return apiFetch(`/research/history?limit=${limit}&offset=${offset}`);
  },
  get(id) {
    return apiFetch(`/research/history/${id}`);
  },
  status(id) {
    return apiFetch(`/research/history/${id}/status`);
  },
  remove(id) {
    return apiFetch(`/research/history/${id}`, { method: 'DELETE' });
  },
};

// ══════════════════════════════════════════════════════════════════════════
// RAG PDF Q&A
// ══════════════════════════════════════════════════════════════════════════

export const ragApi = {
  upload(file) {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch('/rag/upload', { method: 'POST', body: formData });
  },
  listSessions() {
    return apiFetch('/rag/sessions');
  },
  getSession(id) {
    return apiFetch(`/rag/sessions/${id}`);
  },
  sessionStatus(id) {
    return apiFetch(`/rag/sessions/${id}/status`);
  },
  ask(id, question) {
    return apiFetch(`/rag/sessions/${id}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  },
  removeSession(id) {
    return apiFetch(`/rag/sessions/${id}`, { method: 'DELETE' });
  },
};
