# 3. Architecture

## 3.1 The 10,000-foot view

```
┌─────────────┐      ┌──────────────────────┐      ┌────────────┐
│  React UI   │◄────►│  FastAPI (Docker)    │◄────►│   Groq     │
│  (Vercel)   │      │  ├─ research router  │      │  Gemini    │
│             │      │  ├─ rag router       │      │  Tavily    │
│             │      │  ├─ evals router     │      └────────────┘
│             │      │  └─ auth router      │
└─────────────┘      │       (Render)       │      ┌────────────┐
                      │                      │◄────►│  SQLite    │
                      │                      │      │  ChromaDB  │
                      └──────────────────────┘      └────────────┘
```

One React single-page app, one FastAPI process, four routers inside it (`research`, `rag`, `evals`, `auth`), three external AI APIs it calls out to, and two forms of local storage (a SQLite file for structured records, a ChromaDB directory tree for vector indexes). No message queue, no separate worker process, no cache layer — every "background" job in this system runs as a FastAPI `BackgroundTask` inside the same process that served the HTTP request that kicked it off. See [3.4](#4-why-asyncbackground-tasks) for why that's sufficient here.

## 3.2 Request lifecycle walkthroughs

### 3.2.1 "User submits a research topic"

Every hop, from browser click to rendered report:

1. **Frontend** — `TopicInput.jsx`'s "Run Research Pipeline" button calls `handleRun()` in `ResearchTab.jsx`, which calls `researchApi.run(topic)` (`frontend/src/lib/api.js`), a `POST /research/run` with `{"topic": "..."}`.
2. **Backend receives the request** — `start_run()` in `backend/research/router.py` runs. It calls `service.create_run(db, payload.topic)`, which does:
   ```python
   # backend/research/service.py
   def create_run(db: Session, topic: str) -> ResearchRun:
       run = ResearchRun(topic=topic)
       db.add(run)
       db.commit()
       db.refresh(run)
       return run
   ```
   This inserts a new row into the `research_runs` table with `status="pending"` and the default `steps` JSON (`{"search": {"status": "waiting"}, ...}` — all four stages waiting).
3. **The background task is scheduled, not run yet** — `background_tasks.add_task(_execute_run, run.id, run.topic)`. FastAPI's contract is: this function runs *after* the HTTP response has already been sent back to the browser.
4. **The response returns immediately** — `202 Accepted` with the fresh `RunOut` (id, topic, status="pending", all steps waiting). The frontend now has a `runId` and starts polling.
5. **The background task actually executes** — `_execute_run()` in `backend/research/router.py` opens its *own* new database session (`db = SessionLocal()` — see [3.4.2](#342-how-fastapi-backgroundtasks-work) for why it can't reuse the request's session) and calls `run_research_pipeline_with_callback()` from `backend/agents/pipeline.py`, passing two callbacks:
   ```python
   def on_step_start(step: str) -> None:
       service.mark_step(db, run_id, step, "running")

   def on_step_complete(step: str, _result: dict) -> None:
       service.mark_step(db, run_id, step, "done")
   ```
6. **Inside the pipeline**, for each of the four stages (search, reader, writer, critic — [05-research-pipeline.md](./05-research-pipeline.md) has the full per-stage detail): `on_step_start` fires, which calls `mark_step()`, which reads the run's `steps` JSON dict, sets that step's status to `"running"` with a `started_at` timestamp, and writes the *entire dict* back (see [3.3.2](#332-the-steps-json-column--why-json-instead-of-a-separate-table) for why the whole dict, not a targeted update). The step actually executes (an agent call or a chain call). `on_step_complete` fires, flipping that step to `"done"`.
7. **Meanwhile, the frontend is polling** — `usePolling` (`frontend/src/lib/usePolling.js`) calls `researchApi.status(runId)` — `GET /research/history/{id}/status` — every 2 seconds. Each response reflects whatever the `steps` JSON currently says, so the UI's `PipelineSteps.jsx` component visibly updates (waiting → running → done) as each stage completes, in near-real-time, purely from re-polling the same row.
8. **Pipeline finishes** — `run_research_pipeline_with_callback()` returns a dict with `search_results`, `scraped_content`, `report`, `feedback`. `_execute_run()` calls `service.finalize_run(db, run_id, results)`, which writes all four fields, sets `status="completed"`, and stamps `completed_at`.
9. **Frontend's poll loop sees the terminal status** — `stopWhen: (result) => result && !ACTIVE_STATUSES.has(result.status)` in `ResearchTab.jsx` stops the interval. A `useEffect` then fires a *one-time* `researchApi.get(runId)` (`GET /research/history/{id}`, the full detail including the actual report text — the status endpoint doesn't include it) and renders `ResearchResults.jsx` with the markdown report and critic feedback.
10. **If anything threw an exception anywhere in step 6** — `_execute_run()`'s `except Exception` catches it and calls `service.fail_run(db, run_id, str(exc))`, which (critically) calls `db.rollback()` *first* — see [12.3](./12-known-issues-and-gotchas.md#123-the-swallowed-exception-bug) for the real bug this defends against — then marks any step still `"running"` as `"failed"` and sets the run's overall `status="failed"`.

### 3.2.2 "User uploads a PDF and asks a question"

1. **Frontend** — `PdfUploader.jsx` collects a file; `RagTab.jsx`'s `handleUpload()` calls `ragApi.upload(selectedFile)` — a `multipart/form-data POST /rag/upload`.
2. **Backend validates and stores the file** — `upload_pdf()` in `backend/rag_api/router.py` checks the content-type/extension is actually a PDF, checks the size is under `MAX_UPLOAD_BYTES` (20 MB), then calls `service.create_session(db, filename)` — a new `rag_sessions` row, UUID primary key, `status="pending"` — and writes the raw bytes to `backend/data/uploads/{session_id}.pdf`.
3. **Indexing is scheduled as a background task** — `background_tasks.add_task(_index_session, session.id, pdf_path)`, and the response returns immediately (`202`) with the session's initial state.
4. **The background task indexes the PDF** — `_index_session()` opens its own DB session, calls `service.mark_indexing(db, session_id)` (flips status to `"indexing"`), then `service.build_index(session_id, pdf_path)`:
   ```python
   # backend/rag_api/service.py
   def build_index(session_id: str, pdf_path: str) -> int:
       loader = PyPDFLoader(pdf_path)
       docs = loader.load()
       splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
       chunks = splitter.split_documents(docs)
       embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
       Chroma.from_documents(documents=chunks, embedding=embeddings, persist_directory=index_dir(session_id))
       return len(chunks)
   ```
   This is stages 1–3 of the RAG loop ([2.5.2](./02-concepts-primer.md#252-the-rag-loop)) — see [06-rag-system.md](./06-rag-system.md#62-indexing) for the full breakdown. On success, `service.mark_ready(db, session_id, num_chunks)` sets `status="ready"` and stores the chunk count. On any exception, `service.fail_session()` sets `status="failed"` with the error text.
5. **Meanwhile, the frontend polls** `GET /rag/sessions/{id}/status` every 2 seconds (`VectorDbBuilder.jsx` reflects `pending`/`indexing`/`ready`/`failed`) until it sees a terminal status.
6. **User asks a question** — once `status === "ready"`, `QuestionAnswer.jsx`'s input unlocks. Submitting calls `ragApi.ask(sessionId, question)` — `POST /rag/sessions/{id}/ask`.
7. **Backend answers synchronously** (no background task this time — see [3.4.1](#341-the-problem-30-60s-pipeline-vs-http-timeouts) for why this step doesn't need one) — `ask_question()` in `backend/rag_api/router.py` calls `service.answer_question(session_id, question)`:
   ```python
   # backend/rag_api/service.py
   def answer_question(session_id: str, question: str) -> tuple[str, list[dict]]:
       embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
       vectorstore = Chroma(persist_directory=idx_dir, embedding_function=embeddings)
       retriever = vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 4, "fetch_k": 10, "lambda_mult": 0.5})
       docs = retriever.invoke(question)
       context = "\n\n".join(doc.page_content for doc in docs)
       llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
       final_prompt = _RAG_PROMPT.invoke({"context": context, "question": question})
       response = llm.invoke(final_prompt)
       sources = [{"page": doc.metadata.get("page"), "snippet": doc.page_content[:200]} for doc in docs]
       return _message_text(response.content), sources
   ```
   This is stages 4–6 of the RAG loop. The DB write happens back in the router: `service.save_query(db, session_id, question, answer, sources)` — a new `rag_queries` row.
8. **Response returns directly** (no polling for this step) — the frontend appends `{question, answer, sources}` to its local chat log and renders it, including clickable page-number source chips (`SourceChip` in `QuestionAnswer.jsx`).

### 3.2.3 "User opens the /evals page"

The simplest flow in the system — deliberately, since its entire purpose is to *avoid* triggering expensive live work on every page load:

1. **Frontend** — `EvalsPage.jsx` mounts, calls `evalsApi.latest()` — `GET /evals/latest` — once, on load.
2. **Backend reads files off disk, makes no LLM calls at all** — `get_latest()` in `backend/evals/router.py` calls `load_cached_result("research")` and `load_cached_result("rag")` (both from `backend/evals/report.py`), each of which just finds the newest timestamped JSON file in `backend/evals/results/` and reads it:
   ```python
   # backend/evals/report.py
   def find_latest_cache(name: str) -> Optional[str]:
       suffix = f"_{name}.json"
       candidates = sorted(f for f in os.listdir(_RESULTS_DIR) if f.endswith(suffix))
       return os.path.join(_RESULTS_DIR, candidates[-1]) if candidates else None
   ```
   A timestamp (parsed back out of the filename, since the JSON payload itself doesn't store one) is attached before returning: `{**payload, "timestamp": _iso(...)}`.
3. **Response returns immediately** — `{"research": {...} | null, "rag": {...} | null}`.
4. **Frontend renders** whatever it got — two scorecards (`ResearchScorecard`, `RagScorecard` in `EvalsPage.jsx`), or a centered empty-state card if both are `null` (no eval has ever been run), or an amber "partially blocked by API quota" banner if the cached result's `aggregate.quota_blocked` is `true`.

The actual expensive work — running the pipeline five times, running the RAG flow eight times, making dozens of LLM calls to score everything — only happens when a human deliberately runs `python -m evals.run all` from a terminal. The web page never triggers it. Full detail: [07-evaluation-module.md](./07-evaluation-module.md).

## 3.3 The data model

### 3.3.1 Every table, every column, why it exists

**`users`** (`backend/db/models.py`) — built and functional, not currently referenced by anything a normal user interacts with (see [08-auth-system.md](./08-auth-system.md#82-why-its-not-wired-to-the-frontend)):

| Column | Type | Why |
|---|---|---|
| `id` | int, PK | Standard surrogate key |
| `email` | str, unique | Login identifier option 1 |
| `username` | str, unique | Login identifier option 2 (`UserLogin.email_or_username` accepts either) |
| `hashed_password` | str | Never the plaintext password — see [8.3](./08-auth-system.md#83-password-hashing) |
| `created_at` | datetime | Audit/display |
| `is_active` | bool | A soft "account disabled" flag `get_current_user` checks, without needing to delete the row |

**`research_runs`**:

| Column | Type | Why |
|---|---|---|
| `id` | int, PK | Referenced directly in URLs (`/history/research/{id}`) |
| `topic` | str | The user's input, redisplayed everywhere this run appears |
| `status` | str | `pending` \| `running` \| `completed` \| `failed` — the single source of truth the frontend polls |
| `steps` | JSON | Per-stage status — see [3.3.2](#332-the-steps-json-column--why-json-instead-of-a-separate-table) |
| `search_results` | Text, nullable | Raw output of the Search agent — shown in a collapsible "Search Results" accordion |
| `scraped_content` | Text, nullable | Raw output of the Reader agent — shown similarly |
| `report` | Text, nullable | The Writer chain's final markdown report — the main deliverable |
| `feedback` | Text, nullable | The Critic chain's review of the report |
| `error` | Text, nullable | Populated only on failure, shown as an `ErrorBanner` |
| `created_at` / `completed_at` | datetime | Timing/display; `completed_at` is `null` until the run reaches a terminal state |

**`rag_sessions`**:

| Column | Type | Why |
|---|---|---|
| `id` | str (UUID hex), PK | Not an autoincrement int, deliberately — it doubles as the on-disk directory name for that session's Chroma index (`backend/data/rag_indices/{id}/`), so there's a single identifier for both the DB row and the filesystem artifact, with no separate mapping to keep in sync |
| `pdf_filename` | str | Original upload filename, for display |
| `num_chunks` | int, nullable | Set once indexing succeeds — also shown in the UI as "X chunks" |
| `status` | str | `pending` \| `indexing` \| `ready` \| `failed` |
| `error` | Text, nullable | Populated only on failure |
| `created_at` | datetime | Display |

**`rag_queries`**:

| Column | Type | Why |
|---|---|---|
| `id` | int, PK | — |
| `session_id` | str, FK → `rag_sessions.id`, `ondelete="CASCADE"` | Every question belongs to exactly one session |
| `question` / `answer` | Text | The Q&A pair itself |
| `sources` | JSON | List of `{page, snippet}` dicts — the retrieved chunks that grounded this specific answer |
| `created_at` | datetime | Ordering/display in the chat log |

### 3.3.2 The `steps` JSON column — why JSON instead of a separate table

`ResearchRun.steps` stores all four pipeline stages' status as one JSON blob:
```python
# backend/db/models.py
def _default_steps() -> dict:
    return {
        "search": {"status": "waiting"},
        "reader": {"status": "waiting"},
        "writer": {"status": "waiting"},
        "critic": {"status": "waiting"},
    }
```
A normalized alternative would be a `research_run_steps` table with one row per (run, step) pair. JSON was chosen instead because: the set of steps is small, fixed, and known at design time (four stages, always the same four, never added-to per-run); every read of this data (`RunOut.steps: dict[str, StepStatus]` in `backend/research/schemas.py`) wants *all four steps at once*, never one step in isolation — there's no query in this codebase that needs "just the writer step's status across all runs," which is the kind of access pattern that would justify a separate table with its own indexes. One JSON column means one read, one write, no joins, for data that's genuinely a single cohesive unit (this run's step progress) rather than a genuinely relational collection.

The real cost of this choice shows up in `mark_step()` (`backend/research/service.py`):
```python
# SQLAlchemy's JSON type can't see in-place mutation of a fetched dict
# on SQLite — read the whole dict, replace it, then reassign.
steps = dict(run.steps)
step_info = dict(steps.get(step, {}))
step_info["status"] = status
...
steps[step] = step_info
run.steps = steps
```
SQLAlchemy tracks changes to *attributes* (`run.steps = new_dict`), not to the internal contents of a mutable Python object sitting in that attribute. Calling `run.steps["search"]["status"] = "done"` directly would silently **not** persist — SQLAlchemy would never notice the dict changed, because the `steps` attribute itself was never reassigned. Every write path in this codebase (`mark_step`, `fail_run`) is careful to copy-modify-reassign the whole dict for exactly this reason. This is a real, non-obvious footgun of using a raw JSON column with SQLAlchemy — the alternative would be `MutableDict.as_mutable(JSON)` (SQLAlchemy's built-in wrapper for exactly this problem), which this project doesn't use; it just enforces the copy-and-reassign discipline manually at every call site instead.

### 3.3.3 Relationships and cascade behavior

The only foreign-key relationship in this schema is `RagQuery.session_id → RagSession.id`:
```python
# backend/db/models.py
class RagSession(Base):
    ...
    queries: Mapped[list["RagQuery"]] = relationship(
        "RagQuery", back_populates="session", cascade="all, delete-orphan"
    )

class RagQuery(Base):
    ...
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("rag_sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
```
Two cascade mechanisms are declared here, and only one of them actually fires in SQLite. `ondelete="CASCADE"` at the database level requires `PRAGMA foreign_keys=ON` to be set on every SQLite connection, which this project doesn't do — so the DB-level cascade is inert. The ORM-level `cascade="all, delete-orphan"` on the `relationship()` *does* work, but only when a session is deleted through the ORM's object-graph mechanism (`db.delete(session_obj)`), not through a bulk query (`db.query(RagSession).filter(...).delete()`). This is exactly why `delete_session()` in `backend/rag_api/service.py` is written the way it is:
```python
# db.delete (not a bulk query) so the ORM-level cascade removes the
# session's RagQuery rows too — SQLite won't enforce ON DELETE CASCADE
# at the FK level on its own.
db.delete(session)
db.commit()
```
There is no relationship at all between `User` and `ResearchRun`/`RagSession` — see the comment directly above `_default_steps()` in `db/models.py`, which documents this as a deliberate deferred-scope decision (auth shipped after research/RAG, single-user, not retrofitted onto the existing tables) rather than an oversight.

## 3.4 Why async/background tasks

### 3.4.1 The problem: 30–60s pipeline vs. HTTP timeouts

The research pipeline makes four sequential LLM/tool calls (search, scrape, write, critique) — end-to-end, this reliably takes somewhere in the 20–60 second range depending on topic and provider latency. A typical browser, reverse proxy, or load balancer has a default HTTP request timeout well under that (often 30s or less), and even where it doesn't, making a user's browser hang on a spinning request for a full minute with zero feedback is a bad experience regardless of whether it technically completes.

### 3.4.2 How FastAPI BackgroundTasks work

FastAPI's `BackgroundTasks` mechanism lets a route handler schedule a function to run *after* the HTTP response has already been sent to the client — the request/response cycle completes fast (just the DB insert), and the actual slow work happens afterward, in the same process, without blocking the client.

The critical, easy-to-miss consequence: by the time the background task runs, the *request* is over, and FastAPI's request-scoped dependencies (like the `db: Session = Depends(get_db)` used inside the route handler itself) have already been torn down/closed. A background task cannot reuse that session — it must open its own:
```python
# backend/research/router.py
def _execute_run(run_id: int, topic: str) -> None:
    # BackgroundTasks run after the request-scoped `db` dependency has
    # already been closed, so this needs its own session.
    db = SessionLocal()
    try:
        ...
    finally:
        db.close()
```
Every background task in this codebase (`_execute_run` in `research/router.py`, `_index_session` in `rag_api/router.py`) follows this same pattern: its own `SessionLocal()`, its own `try/finally: db.close()`.

### 3.4.3 The polling contract between frontend and backend

There's no formal API contract document for this — it's an implicit convention followed consistently across both AI systems: every "job" (a research run, a RAG indexing operation) has a `status` field with a small fixed set of values, one of which is terminal-success and one of which is terminal-failure; the frontend hits a `/status`-suffixed (or equivalent) endpoint on an interval (`usePolling`, every 2 seconds) and stops polling the moment it observes a status outside the "still going" set:
```javascript
// frontend/src/components/ResearchTab.jsx
const ACTIVE_STATUSES = new Set(['pending', 'running']);
...
stopWhen: (result) => result && !ACTIVE_STATUSES.has(result.status),
```
```javascript
// frontend/src/components/RagTab.jsx
const ACTIVE_STATUSES = new Set(['pending', 'indexing']);
```
This works because status transitions in this system are monotonic and one-directional (`pending → running → completed`, never backward) — polling can't "miss" a transition in a way that matters, because there's nothing to catch except the final state, and every intermediate state is safe to observe repeatedly.

### 3.4.4 Why not SSE/WebSockets/Celery — the tradeoffs

- **Server-Sent Events (SSE) or WebSockets** would let the backend *push* status updates the instant they happen, instead of the frontend asking every 2 seconds — lower latency, less wasted request overhead. Not used here because it adds real complexity this project's scope doesn't need: persistent connection lifecycle management, reconnection-on-drop handling, and — specifically relevant to this project's deployment target — Render's free tier is not the friendliest environment for long-lived connections (cold starts, sleep/wake cycles) compared to simple stateless polling requests that just work whenever the server happens to be awake.
- **Celery / RQ** (dedicated background job queues, usually backed by Redis) would decouple job execution from the web server process entirely — jobs could survive a web server restart, run on separate worker machines, retry automatically. Not used here because it means running (and paying for, and monitoring) a second service — a message broker — for a workload that, at this project's scale (one demo user, occasional runs), a single in-process `BackgroundTasks` call handles completely adequately. FastAPI's `BackgroundTasks` was judged the right amount of infrastructure for the actual traffic this system sees; see [11.4](./11-design-decisions.md#114-backgroundtasks-over-celeryrq) for the fuller tradeoff writeup, including what would force a reconsideration (multiple concurrent workers, jobs that need to survive a process restart mid-flight).

## 3.5 State management: where every piece of state lives, and why

| State | Lives in | Why there |
|---|---|---|
| Research run records, RAG session/query records, user accounts | SQLite (`backend/researchmind.db` locally, or a Render-ephemeral / Docker-volume-backed copy in deployment) | Structured, relational-enough data (foreign keys, filtering, ordering) that needs to survive a server restart (within the lifetime of the disk it's on) |
| PDF text embeddings, per-session | ChromaDB directories on disk (`backend/data/rag_indices/{session_id}/`) | Purpose-built for the "find nearest vectors" query pattern SQLite can't do natively (see [2.4.1](./02-concepts-primer.md#241-what-a-vector-db-is-and-why-a-normal-database-cant-do-this)) |
| Uploaded PDF files themselves | Plain files on disk (`backend/data/uploads/{session_id}.pdf`) | Needed at index-build time by `PyPDFLoader`, which reads from a file path; kept around for potential re-indexing, not currently re-read after the initial `build_index()` call |
| Cached eval scorecards | Timestamped JSON files (`backend/evals/results/*.json`) | Deliberately **not** in SQLite — these are point-in-time snapshots meant to be diffed/compared across runs and rendered by both a CLI tool (`rich` tables) and the web API; flat files are the simplest thing that serves both without adding a new DB table for what's fundamentally an offline batch-job artifact |
| In-flight UI state during a run (which run/session is "active" right now, the current topic text) | React component state (`useState` in `ResearchTab.jsx` / `RagTab.jsx`) | Ephemeral, per-browser-tab, doesn't need to survive anything |
| "Resume this run/session after a page refresh" | Browser `localStorage` (`frontend/src/lib/storage.js`) | React state alone is wiped by a page reload; `localStorage` survives it. This project stores only IDs (`activeRunId`, `activeSessionId`, `lastTopic`) — never the actual report/answer content, which is always re-fetched fresh from the backend by ID |

The `storage.js` wrapper is deliberately narrow — it exists to solve exactly one problem (a mid-run page refresh shouldn't lose your place) and stores exactly the three keys needed for that, not a general-purpose client-side cache:
```javascript
// frontend/src/lib/storage.js
const KEYS = {
  lastTopic: 'researchmind:lastTopic',
  activeRunId: 'researchmind:activeRunId',
  activeSessionId: 'researchmind:activeSessionId',
};
```

---

**Next:** [04-backend-walkthrough.md](./04-backend-walkthrough.md) for a file-by-file tour of the backend, or jump straight to [05-research-pipeline.md](./05-research-pipeline.md) / [06-rag-system.md](./06-rag-system.md) for deep dives on either AI system specifically.
