# 13. Extending This Project

Written for a contributor — human or AI — picking this codebase up cold, with no other context than this `docs/` folder and the code itself.

## 13.1 Repo conventions

- **Backend package layout is feature-based, not layer-based at the top level:** `research/`, `rag_api/`, `evals/`, `auth/` each own their own `schemas.py` (Pydantic models), `service.py` (DB/business logic, no FastAPI imports), and `router.py` (FastAPI routes, HTTP concerns only). `agents/` and `rag/` hold logic that's shared/deeper than a single feature's router. `db/` holds the shared SQLAlchemy setup every feature depends on. New backend features should follow this same three-file shape (see [13.2](#32-adding-a-new-api-endpoint-the-full-pattern) for the exact pattern).
- **Service functions never import FastAPI** — no `HTTPException`, no `Depends`, no request/response models. They take a `Session` and plain arguments, return plain objects or `None`. HTTP-specific translation (404s, status codes) happens one layer up, in the router. See [4.9](./04-backend-walkthrough.md#49-researchservicepy) for the reasoning.
- **Background tasks live in `router.py`, not `service.py`** — they're HTTP-adjacent orchestration (deciding when to call service functions, wiring up callbacks), not pure data operations.
- **Frontend: pages vs. components.** `pages/` are things reachable by a URL (`App.jsx`'s `<Route>` table). `components/` are everything else, including the two main interactive features (`ResearchTab`, `RagTab`) which are *rendered by* a page (`Dashboard.jsx`) rather than being pages themselves — see [9.1](./09-frontend-walkthrough.md#91-structure-and-routing) for why.
- **All API calls go through `lib/api.js`'s `apiFetch()` wrapper**, grouped into small per-feature objects (`researchApi`, `ragApi`, `evalsApi`). Never call `fetch()` directly from a component.
- **Styling uses inline `style={{ ... }}` referencing CSS custom properties** (`var(--color-text-primary)`, etc., defined in `index.css`'s `@theme` block) rather than Tailwind color utility classes for anything that needs to match the design system's exact palette — Tailwind utility classes (`flex`, `gap-2`, `rounded-lg`, spacing/layout) are used freely for everything else. This is a real, consistent pattern across every component — match it rather than introducing raw hex colors or new Tailwind color classes.
- **Truncation and token-budget guards are a running theme, not incidental.** Search snippets `[:300]`, scraped content `[:3000]`, search results fed to the Reader `[:800]`, report text fed to the judge `[:6000]`, source snippets `[:200]` — every one of these exists to manage LLM token cost/context limits deliberately (see [4.5](./04-backend-walkthrough.md#45-agentstoolspy), [5.3.2](./05-research-pipeline.md#332-the-scrape_url-tool)). If you're adding a new place where LLM-bound text gets built, think about whether it needs the same treatment.

## 13.2 Local dev loop: how to run, how to test a change

Full setup: [10.1](./10-deployment.md#101-local-development-setup). The practical loop for testing a backend change: `uvicorn main:app --reload` picks up file changes automatically; hit the relevant endpoint with `curl` or through the running frontend. For a frontend change: `npm run dev`'s Vite dev server hot-reloads on save. **There is no automated test suite in this project** (see [12](./12-known-issues-and-gotchas.md) generally, and [1.4](./01-project-overview.md#14-what-its-not)) — verifying a change means actually running the app and exercising the changed path by hand, or (for the eval module specifically) running `python -m evals.run <mode> --limit 1` as a cheap, fast smoke test before spending a full eval run's worth of quota on `--limit` unset.

## 13.3 Walkthroughs for common extensions

### 13.3.1 Adding a new agent to the research pipeline

Example: a second Reader pass that scrapes a *different* URL for a second perspective, between the existing Reader stage and the Writer stage.

1. **Add the step to the default state** — `backend/db/models.py`'s `_default_steps()`: add `"reader2": {"status": "waiting"}` (or similar) to the returned dict.
2. **Add the stage to the pipeline** — `backend/agents/pipeline.py`'s `run_research_pipeline_with_callback()`: after the existing Reader stage, add a new block following the same shape:
   ```python
   on_step_start("reader2")
   reader2_agent = build_reader_agent()  # or a differently-configured agent
   reader2_result = reader2_agent.invoke({"messages": [(...)]})
   state["scraped_content_2"] = _message_text(reader2_result["messages"][-1].content)
   on_step_complete("reader2", {"scraped_content_2": state["scraped_content_2"]})
   ```
3. **Feed the new content into the Writer stage** — update `research_combined` in the same file to include `state["scraped_content_2"]`.
4. **(If storing the new content permanently)** add a column to `ResearchRun` in `db/models.py` and thread it through `finalize_run()` in `research/service.py`, `RunDetail` in `research/schemas.py`, and `ResearchResults.jsx` on the frontend if it should be displayed.
5. **Add the frontend step card** — `frontend/src/components/PipelineSteps.jsx`'s `STEPS` array: a new entry with `key: 'reader2'` matching the backend's step key, an icon, and a description.
6. **Update the schema's allowed step keys if validated anywhere** — `research/schemas.py`'s `RunOut.steps: dict[str, StepStatus]` accepts any string key already, so no schema change needed there specifically, but double-check nothing else hardcodes the four-step assumption.

### 13.3.2 Adding a new API endpoint (schema → service → router → main.py → api.js → component)

The full six-step pattern, illustrated with a hypothetical "star a research run" feature:

1. **Schema** (`research/schemas.py`) — add any new request/response shape needed: `class StarRequest(BaseModel): starred: bool`.
2. **Service** (`research/service.py`) — add the DB operation, no FastAPI imports: `def set_starred(db: Session, run_id: int, starred: bool) -> ResearchRun | None: ...`.
3. **Router** (`research/router.py`) — add the route, translating `None` → `404`: `@router.patch("/history/{run_id}/star") def star_run(...): ...`.
4. **Wire into `main.py`** — only needed if this is an entirely *new* router (not the case for this example, since it extends the existing `research_router`); for a genuinely new feature area, add `from myfeature.router import router as myfeature_router` and `app.include_router(myfeature_router)`.
5. **Frontend API client** (`frontend/src/lib/api.js`) — add a method to `researchApi`: `star(id, starred) { return apiFetch(`/research/history/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }); }`.
6. **Component** — call it from wherever makes sense (e.g. a star icon button in `History.jsx`'s table row), following the existing `try { await x(); reload(); } catch (err) { setError(err.message); }` pattern used throughout.

### 13.3.3 Swapping the LLM provider

1. **Install the new provider's LangChain integration package** (e.g. `langchain-openai`) and add it to `requirements.txt`.
2. **Update every `ChatGroq(...)` instantiation** — there are three independent ones, not one shared instance: `backend/agents/research_agents.py` (module-level `llm`, used by all four pipeline stages), `backend/rag_api/service.py` (inside `answer_question()`), `backend/evals/judges.py` (`_get_judge_llm()`). Changing one does not change the others — decide deliberately whether you want one provider everywhere or a per-purpose split (mirroring this project's own Groq/Gemini split — see [11.1](./11-design-decisions.md#111-groq-for-chat-gemini-for-embeddings)).
3. **Update the env var and startup check** — `config.py` and `main.py`'s `validate_environment()` currently check `GROQ_API_KEY`/`os.environ` directly; update the variable name and add the new provider's key to `.env.example` (both `backend/.env.example` and the root `.env.example`).
4. **Re-verify prompt behavior** — different model families follow instructions differently; specifically re-check the judge prompts' "JSON only, no markdown fences" compliance ([7.3.3](./07-evaluation-module.md#733-why-json-output-and-how-parse-failures-are-handled)), since a new model that wraps JSON in more prose than expected will spike your `judge_failed` rate silently.

### 13.3.4 Swapping the vector DB

1. **Identify every `Chroma(...)` / `Chroma.from_documents(...)` call site** — `backend/rag_api/service.py` (`build_index()`, `answer_question()`) are the only two that matter for the live API; `backend/rag/vector_store.py` and `backend/rag/create_database.py` are standalone demo scripts, not wired into any route, and can be left alone or updated for consistency at your discretion.
2. **Swap the class and its constructor arguments** — e.g. FAISS's LangChain integration has a different persistence API (`.save_local()`/`.load_local()` rather than a `persist_directory` constructor argument) — this is not a drop-in swap; read the target vector store's actual LangChain integration docs for its specific persistence contract.
3. **Re-evaluate the per-session-directory pattern** — [11.9](./11-design-decisions.md#119-per-session-chroma-directories-over-one-shared-collection)'s UUID-namespaced-directory approach is somewhat Chroma-specific (it works because Chroma persists cleanly to an arbitrary directory); a managed service like Pinecone would instead use a single index with metadata filtering per session/namespace, which changes `index_dir()`/`upload_path()`'s role entirely.
4. **Always pass an explicit embedding function/model** to whatever constructor the new vector store uses — this project's own dependency-trimming pass ([11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)) specifically depended on every Chroma call site passing `embedding=`/`embedding_function=` explicitly, so the vector store never silently falls back to a default local embedding model. Verify the new vector store has an equivalent explicit-embedding requirement, or you risk silently reintroducing a local-model dependency.

### 13.3.5 Adding a new eval metric

Already covered at [7.8](./07-evaluation-module.md#78-how-to-modify) — repeated here for completeness. Deterministic metric: compute it in Python inside `judge_research_report()`/`judge_rag_answer()` in `evals/judges.py`, following the `keyword_recall` pattern (compute from data already available, never send to the judge). Judged metric: add a field to the relevant rubric's JSON shape in the prompt text in the same file, and extract it from the parsed response. Either way: add a column to `report.py`'s `print_research_report()`/`print_rag_report()`, and to `frontend/src/pages/EvalsPage.jsx`'s scorecard table rendering.

### 13.3.6 Wiring the auth system to the frontend

Full six-step walkthrough already at [8.7](./08-auth-system.md#87-how-to-wire-it-to-the-frontend-if-someone-wants-to) — not duplicated here.

### 13.3.7 Adding streaming responses

This project currently returns complete responses only (no token-by-token streaming) — see [11.3](./11-design-decisions.md#113-polling-over-ssewebsockets) for why polling was chosen over a push-based approach generally; streaming is a related but distinct question (it's about *how a single response* is delivered, not how job *status* is communicated).

1. **Backend:** FastAPI supports streaming via `StreamingResponse`. The relevant LLM call would need to switch from `.invoke(...)` to `.stream(...)` (both LangChain chains and raw chat models support this) and yield chunks as they arrive, rather than returning one complete string.
2. **This is most natural for the RAG `/ask` endpoint** (a single synchronous LLM call today — [3.2.2](./03-architecture.md#322-user-uploads-a-pdf-and-asks-a-question) step 7) — converting `ask_question()` to stream would mean the route handler yields chunks as `answer_question()`'s underlying `llm.stream(...)` produces them, rather than waiting for the full response before returning.
3. **The research pipeline is a worse fit** — its four stages already run as a background task specifically because the whole thing takes too long for one HTTP request/response cycle; streaming would only make sense *within* one stage's single LLM call, not across the whole multi-stage pipeline, which would still need the existing poll-based status mechanism regardless.
4. **Frontend:** would need to switch from `await ragApi.ask(...)` (one Promise, one final value) to consuming a stream — the browser's `fetch` API supports reading a `ReadableStream` response body incrementally; `QuestionAnswer.jsx`'s rendering would need to append incoming text chunks to the displayed answer as they arrive, rather than setting the whole answer at once on completion.

### 13.3.8 Migrating SQLite → Postgres

1. **Change `DATABASE_URL`** to a Postgres connection string (`postgresql://user:pass@host:port/dbname`) — `db/database.py`'s `_resolve_database_url()` only special-cases `sqlite:///` URLs; anything else passes through unchanged, and `connect_args` becomes `{}` (the SQLite-specific `check_same_thread` flag isn't needed for Postgres).
2. **Add a Postgres driver** to `requirements.txt` — SQLAlchemy needs a DBAPI driver installed to actually talk to Postgres (e.g. `psycopg` or `psycopg2-binary`); nothing about this is currently in the dependency list, since it's never been needed.
3. **Run `Base.metadata.create_all()` against the new, empty database** — this happens automatically via `main.py`'s `init_db()` startup hook the first time the app boots against the new `DATABASE_URL`, creating all tables fresh.
4. **There is no automated data migration** — any existing SQLite data (research run history, RAG sessions) would need a manual export/import (e.g. dump each table to CSV/JSON and write a one-off script to re-insert it via SQLAlchemy against the new database) if preserving it matters; this project has no Alembic or other migration framework set up at all, for either schema changes or data migration.
5. **Provision the actual Postgres instance** — a hosting decision, not a code change (Render, Supabase, Neon, a self-hosted instance, etc.) — set `DATABASE_URL` in the relevant environment (`.env` locally, Render's dashboard/`render.yaml` in production) accordingly.
6. **Reconsider the `steps` JSON column** — SQLite and Postgres both support a JSON column type, so [3.3.2](./03-architecture.md#332-the-steps-json-column--why-json-instead-of-a-separate-table)'s design doesn't *require* changing — but if you're already touching the schema, Postgres additionally offers `JSONB` (a binary, indexable JSON type) as a strictly-better option than plain `JSON` for this use case, worth switching to while you're in there.

## 13.4 What to be careful about — the sharp edges

- **LangChain package versions.** Pin versions deliberately when upgrading, and re-test the agent/chain construction paths specifically — `create_agent`, chain composition via `|`, and provider-specific integration packages have all moved between LangChain packages before (see [12.1](./12-known-issues-and-gotchas.md#121-langchain-version-churn)).
- **Chroma's `embedding_function` must always be explicit.** Every `Chroma(...)` / `Chroma.from_documents(...)` call in this codebase passes an explicit embedding model. This isn't stylistic — Chroma has a *default* embedding function that, if triggered (by omitting the argument), falls back to a local `sentence-transformers` model, silently reintroducing the exact heavy dependency this project deliberately removed ([11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)). Any new Chroma call site — including in a swapped-out vector store scenario ([13.3.4](#334-swapping-the-vector-db)) — must preserve this.
- **Background task session lifecycle.** Any new `BackgroundTasks`-scheduled function must open its *own* `SessionLocal()` and close it in a `finally` block — it cannot reuse the request-scoped `db` dependency, which is already closed by the time a background task runs (see [3.4.2](./03-architecture.md#342-how-fastapi-backgroundtasks-work)). Forgetting this raises a clear error immediately (a closed-session usage error), so it fails loudly rather than silently — but it's worth knowing the rule going in.
- **The `_message_text()` normalizer pattern.** Any new code path persisting LLM/agent `.content` directly into a database column or anywhere else with a fixed expected type needs this normalization first — see [12.2](./12-known-issues-and-gotchas.md#122-agent-message-content-can-be-a-list-of-dicts-not-a-string).
- **JSON column mutation.** Reading `run.steps["key"]["subkey"] = value` and expecting it to persist is a silent no-op with SQLAlchemy's plain `JSON` column type — always copy-modify-reassign the whole dict (see [3.3.2](./03-architecture.md#332-the-steps-json-column--why-json-instead-of-a-separate-table)).
- **Exception-handler functions that query the DB.** Any cleanup/failure-handling function's first action, if it queries the database, should be an unconditional `db.rollback()` first — see [12.3](./12-known-issues-and-gotchas.md#123-the-swallowed-exception-bug) for exactly what goes wrong without it.

## 13.5 A checklist for making a change safely

1. Read the relevant doc(s) in this folder for the area you're touching *before* changing code — the "why," not just the "what," usually changes what a safe implementation looks like.
2. Identify every call site of whatever you're changing (`grep`/search across the whole repo, not just the file you're looking at) — several patterns in this codebase (the `_message_text()` normalizer, the `Chroma(...)` embedding-function requirement, the DB-session-per-background-task rule) are duplicated across files by design, not centralized, so a change in one place doesn't automatically apply everywhere.
3. Run the app locally and actually exercise the changed path by hand — there's no test suite to catch a regression for you (see [13.2](#32-local-dev-loop-how-to-run-how-to-test-a-change)).
4. If the change touches a prompt, a retrieval parameter, or a model — run the relevant eval suite (`python -m evals.run <mode> --limit N` as a cheap smoke test) before and after, and actually compare the scorecards, not just "did it run without crashing."
5. If the change touches the database schema — remember there's no migration framework; decide explicitly whether existing local/deployed data needs to survive the change, and plan for that deliberately rather than assuming `create_all()` will handle it (it won't alter existing tables).
6. If the change touches a Dockerfile or `docker-compose.yml` — rebuild and actually run the full stack (`docker compose up --build`), not just the file you edited in isolation; see [12.12](./12-known-issues-and-gotchas.md#1212-docker-compose-healthcheck-still-references-curl-now-removed-from-the-image) for a concrete example of a change that looked complete in isolation but broke a different file's assumption.

---

**Next:** [14-glossary.md](./14-glossary.md) for quick term lookups, or back to [docs/README.md](./README.md) for the full index.
