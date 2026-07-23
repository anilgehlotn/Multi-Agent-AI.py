# 9. Frontend Walkthrough

## 9.1 Structure and routing

```
frontend/src/
  main.jsx                 entry point — wraps <App /> in <BrowserRouter>
  App.jsx                  route table
  index.css                Tailwind v4 config + design tokens (--color-*, --radius-*, --shadow-*)
  lib/
    api.js                 all backend calls
    usePolling.js           generic polling hook
    format.js               date/time/byte formatting helpers
    storage.js               localStorage wrapper
  components/               reusable pieces + the two main feature tabs
  pages/                    top-level routed views
```
```javascript
// frontend/src/App.jsx
<Routes>
  <Route path="/" element={<Dashboard />} />
  <Route path="/history" element={<History />} />
  <Route path="/history/research/:id" element={<ResearchRunDetail />} />
  <Route path="/history/rag/:id" element={<RagSessionDetail />} />
  <Route path="/evals" element={<EvalsPage />} />
</Routes>
```
`Dashboard` itself isn't one page — it's a tab switcher between `ResearchTab` and `RagTab` (`frontend/src/pages/Dashboard.jsx`), so the actual research/RAG *features* live in `components/`, not `pages/`, while their detail/history views (which are genuinely separate routed pages, not tabs) live in `pages/`. This split — "the interactive tool" vs. "a page that displays one record by ID" — is consistent across both features (`ResearchTab.jsx` / `ResearchRunDetail.jsx`, `RagTab.jsx` / `RagSessionDetail.jsx`).

## 9.2 The API client (`lib/api.js`)

Every backend call in the app goes through one shared `apiFetch()` wrapper:
```javascript
const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function apiFetch(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? { ...options.headers } : { 'Content-Type': 'application/json', ...options.headers };

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
```
Three things worth understanding about this function specifically:

1. **`isFormData` detection skips the `Content-Type: application/json` header.** PDF uploads (`ragApi.upload`) pass a `FormData` body; setting `Content-Type: application/json` on a multipart request would be actively wrong (the browser needs to set its own `multipart/form-data; boundary=...` header for `FormData` bodies to be parsed correctly server-side) — this check exists specifically so `apiFetch` can serve both JSON and file-upload calls through one shared function.
2. **Two distinct error paths, both normalized to the same `Error` shape.** A network-level failure (`fetch` itself throwing — server unreachable, DNS failure, CORS rejection) becomes `err.status = 0` with a generic "is the backend running?" message. A server-returned error (any non-2xx HTTP response) becomes `err.status = <the real status code>` with `err.detail` pulled from the response body's `detail`/`message` field (matching FastAPI's `HTTPException(detail=...)` convention) if the body was JSON, falling back to the raw `statusText` if not. Every caller in this app can catch one `Error` type and read `.message` for display, regardless of which of these two very different failure modes actually happened.
3. **`204 No Content` responses return `null`, not an attempt to parse an empty body as JSON** — `res.json()` on a truly empty response body throws; the explicit `204` check (used by the two DELETE endpoints in this app) avoids that.

Every API call in the app is grouped into small per-feature objects — `researchApi`, `ragApi`, `evalsApi` — each just a set of one-line `apiFetch()` calls:
```javascript
export const researchApi = {
  run(topic) { return apiFetch('/research/run', { method: 'POST', body: JSON.stringify({ topic }) }); },
  list(limit = 50, offset = 0) { return apiFetch(`/research/history?limit=${limit}&offset=${offset}`); },
  get(id) { return apiFetch(`/research/history/${id}`); },
  status(id) { return apiFetch(`/research/history/${id}/status`); },
  remove(id) { return apiFetch(`/research/history/${id}`, { method: 'DELETE' }); },
};
```
No component ever calls `fetch()` directly — everything goes through one of these objects, which is what makes `apiFetch`'s error-normalization and `BASE`-URL logic apply uniformly everywhere without being repeated.

## 9.3 The polling hook (`lib/usePolling.js`)

```javascript
export function usePolling(fn, { intervalMs = 2000, enabled = true, stopWhen = () => false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const stopWhenRef = useRef(stopWhen);
  stopWhenRef.current = stopWhen;
  const intervalRef = useRef(null);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!enabled) { stop(); return; }
    let cancelled = false;
    setIsPolling(true);

    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        if (stopWhenRef.current(result)) stop();
      } catch (err) {
        if (cancelled) return;
        setError(err);
        stop();
      }
    };

    tick();
    intervalRef.current = setInterval(tick, intervalMs);
    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, stop]);

  return { data, error, isPolling };
}
```
**How it works:** call the given function immediately (`tick()` before `setInterval`, so the UI doesn't wait a full `intervalMs` before its first data), then again every `intervalMs`, until `stopWhen(result)` returns `true` or the caller flips `enabled` to `false`.

**Why `fnRef`/`stopWhenRef` instead of just using `fn`/`stopWhen` directly inside the effect:** the effect's dependency array is `[enabled, intervalMs, stop]` — deliberately *not* including `fn` or `stopWhen`. Both of those are typically inline arrow functions passed fresh on every render (`() => researchApi.status(runId)`), so including them in the dependency array would tear down and restart the polling interval on every single render — including ones that have nothing to do with polling. Storing the latest `fn`/`stopWhen` in a ref, updated on every render (`fnRef.current = fn`) but *read* from inside the stable interval callback, means the polling loop keeps running continuously across re-renders while always calling the *current* version of `fn` — new closures don't restart the timer.

**Cleanup on unmount:** the effect's return function sets `cancelled = true` and calls `stop()`. `cancelled` guards against a race where an in-flight request resolves *after* the component has already unmounted (or `enabled` flipped false) — without that flag, a `setData()` call on an unmounted component would either throw a React warning or, worse, silently update state nobody's reading anymore.

**Stop conditions**, per feature:
```javascript
// ResearchTab.jsx
const ACTIVE_STATUSES = new Set(['pending', 'running']);
stopWhen: (result) => result && !ACTIVE_STATUSES.has(result.status),
```
```javascript
// RagTab.jsx
const ACTIVE_STATUSES = new Set(['pending', 'indexing']);
```
Both follow the same shape — poll while the status is in the "still working" set, stop the instant it's anything else (`completed`/`failed` for research, `ready`/`failed` for RAG).

## 9.4 Component by component

| Component | Renders | Owns state | Fetches |
|---|---|---|---|
| `ResearchTab.jsx` | Topic input + live pipeline steps + final report, once done | `topic`, `runId`, `runDetail`, errors | `researchApi.run`, polls `.status`, fetches `.get` once terminal |
| `TopicInput.jsx` | The topic text field, run button, example topic chips | none (fully controlled by props) | none |
| `PipelineSteps.jsx` | The four stage cards (waiting/running/done/failed) | none | none — purely renders the `steps` prop it's given |
| `ResearchResults.jsx` | Collapsible search-results/scraped-content accordions + the final report + critic feedback | which accordion is open (local to `Accordion`) | none — renders the `run` prop |
| `RagTab.jsx` | PDF uploader → vector-DB-build status → Q&A, in sequence | `selectedFile`, `sessionId`, upload state/errors | `ragApi.upload`, polls `.sessionStatus` |
| `PdfUploader.jsx` | Drag-and-drop / click-to-browse file picker | drag-over visual state, local file-type error | none |
| `VectorDbBuilder.jsx` | "Create Vector Database" button → indexing status | none (fully controlled by props) | none |
| `QuestionAnswer.jsx` | Chat-style Q&A log + input box | `question`, `log` (the chat history), loading/error | `ragApi.ask` |
| `Navbar.jsx` | Top nav bar, logo, links (Dashboard/History/Evaluations/Settings-disabled) | none | none |
| `StatusPill.jsx` | A colored status badge (shared across research/RAG/history) | none | none |
| `ErrorBanner.jsx` | A red error box with an optional retry button | none | none |
| `ConfirmModal.jsx` | A generic "are you sure?" delete-confirmation modal | none (controlled by `open` prop) | none |
| `Dashboard.jsx` (page) | Tab switcher between `ResearchTab`/`RagTab` | `activeTab` | none |
| `History.jsx` (page) | Tab switcher between research-runs table / RAG-sessions table, with delete | `activeTab`, `runs`, `sessions`, `pendingDelete` | `researchApi.list`, `ragApi.listSessions`, delete calls |
| `ResearchRunDetail.jsx` (page) | One run's full detail, by URL `:id` | `run`, error | `researchApi.get` |
| `RagSessionDetail.jsx` (page) | One session's full detail + Q&A history, by URL `:id` | `session`, error | `ragApi.getSession` |
| `EvalsPage.jsx` (page) | Both eval scorecards, empty state, or loading skeletons | `data`, `loading`, `error` | `evalsApi.latest` |

## 9.5 The pipeline status UI — how backend `steps` JSON maps to card states

`PipelineSteps.jsx` receives the `steps` object straight off the polled `RunOut` response — `{"search": {"status": "running", "started_at": "..."}, "reader": {"status": "waiting"}, ...}` — and maps each of its four hardcoded `STEPS` entries (search/reader/writer/critic, each with an icon and description) to a `STATUS_CONFIG` entry (waiting/running/done/failed → label, color, background):
```javascript
const stepData = steps?.[step.key] || { status: 'waiting' };
const status = STATUS_CONFIG[stepData.status] ? stepData.status : 'waiting';
```
The `STATUS_CONFIG[stepData.status] ? ... : 'waiting'` fallback means an unrecognized or missing status value (e.g. `steps` is `undefined` before the first poll response arrives) degrades safely to the "waiting" visual, rather than crashing on an undefined lookup. While a step is `running`, an `ElapsedTicker` sub-component renders a live-updating `MM:SS` timer computed from that step's `started_at` timestamp:
```javascript
function ElapsedTicker({ since }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{elapsedMMSS(since)}</span>;
}
```
This ticker is a second, independent 1-second interval, layered on top of the 2-second backend poll — it doesn't make any network request, it just recomputes `Date.now() - since` every second from data already in hand, so the elapsed-time display feels smooth between the (coarser) 2-second polls actually refreshing `started_at`/`status` from the server.

## 9.6 localStorage usage and why

```javascript
// frontend/src/lib/storage.js
const KEYS = {
  lastTopic: 'researchmind:lastTopic',
  activeRunId: 'researchmind:activeRunId',
  activeSessionId: 'researchmind:activeSessionId',
};
```
Three keys, each solving the same specific problem: React component state (`useState`) is wiped by a page refresh. If a user is mid-run (a research pipeline actively working, or a PDF actively indexing) and refreshes the page — by accident, or because they navigated away and came back — plain React state would lose all memory of "there's an active run in progress," and the UI would show an empty, "nothing happening" state despite the backend still working on it in the background. `storage.js` persists just enough (the *ID*, never the actual content) to `localStorage` so that on mount, `ResearchTab`/`RagTab` can initialize their `runId`/`sessionId` state from the persisted value and resume polling exactly where they left off:
```javascript
// ResearchTab.jsx
const [runId, setRunId] = useState(() => storage.getActiveRunId());
```
The `get`/`set` wrapper functions swallow any `localStorage` access errors silently (`try { ... } catch { /* degrade silently */ }`) — private/incognito browsing modes, or `localStorage` being disabled entirely, would otherwise throw and crash the app on every read/write; degrading to "resume-on-refresh just doesn't work" is an acceptable fallback for a non-essential convenience feature, much better than a hard crash.

## 9.7 Error and loading states — the pattern used throughout

Consistent across every page/component in this app:

- **Loading (no data yet):** either a plain `"Loading…"` text (the simpler pages — `ResearchRunDetail.jsx`, `RagSessionDetail.jsx`) or a `.animate-shimmer` skeleton block (`QuestionAnswer.jsx`'s "AI is thinking…" state, `EvalsPage.jsx`'s scorecard skeletons) — shimmer skeletons are used specifically where the *shape* of the incoming content is predictable enough to fake convincingly (a chat answer, a scorecard table), plain text where it isn't.
- **Error (a request failed):** the shared `ErrorBanner` component — a red box with the error message and an optional "Retry" button that re-invokes whatever load function failed:
  ```javascript
  {error && <ErrorBanner message={error} onRetry={load} />}
  ```
- **Empty (request succeeded, there's just nothing there):** page-specific, plain centered text — `"No research runs yet. Start one from the Dashboard."` in `History.jsx`, or a full custom `EmptyState` card with a code-styled CLI command in `EvalsPage.jsx` — distinct from both loading and error, and deliberately never conflated with either (a `null` "no data yet, still loading" state and an empty-array "loaded, and it's genuinely empty" state are checked separately everywhere in this codebase, e.g. `History.jsx`'s `if (runs === null) return <EmptyState message="Loading…" />; if (runs.length === 0) return <EmptyState message="No research runs yet..." />;`).

## 9.8 How to modify

**Adding a page** — create the component in `frontend/src/pages/`, add a `<Route>` in `App.jsx`, add a nav link in `Navbar.jsx` if it should be reachable from the top nav (see `EvalsPage`'s addition as a recent, complete example of this exact pattern).

**Adding an API call** — add a one-line method to the relevant object in `lib/api.js` (or a new object, following the `researchApi`/`ragApi`/`evalsApi` pattern, if it's a new feature area) — every call should go through `apiFetch()`, never a raw `fetch()`, to keep error handling and the `BASE` URL consistent.

**Changing the polling interval** — it's a plain option passed to `usePolling(fn, { intervalMs: 2000, ... })` at each call site (`ResearchTab.jsx`, `RagTab.jsx`) — there's no global polling-interval constant; each feature's poll rate is independent and can be tuned separately if, say, research polling should be slower/faster than RAG-indexing polling.

---

**Next:** [10-deployment.md](./10-deployment.md) for how all of this actually gets built, containerized, and put on the internet.
