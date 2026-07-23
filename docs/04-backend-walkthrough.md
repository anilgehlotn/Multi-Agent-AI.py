# 4. Backend Walkthrough

A file-by-file tour of `backend/`. Where a file's behavior is already covered in depth elsewhere (the research pipeline, the RAG system, evals), this doc gives the short version and links out, rather than duplicating — the goal here is "what is this file responsible for and what would break if you touched it," not a second copy of [05](./05-research-pipeline.md)/[06](./06-rag-system.md)/[07](./07-evaluation-module.md).

## 4.1 `main.py`

**Responsible for:** the FastAPI app object itself — CORS configuration, wiring all four routers together, and four `@app.on_event("startup")` hooks that run once when the process boots.

```python
app = FastAPI(title="ResearchMind API")

cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(research_router)
app.include_router(rag_router)
app.include_router(evals_router)
```
`CORS_ORIGINS` is a comma-separated string in settings (not a JSON list) specifically so it can be set as one plain env var in the Render dashboard without needing JSON-list escaping — see [10.6](./10-deployment.md#106-environment-variables-complete-table).

The four startup hooks, in the order they're defined (FastAPI runs them in registration order):

1. **`validate_environment()`** — fails the process to start (`raise SystemExit(1)`) if `GROQ_API_KEY`, `GOOGLE_API_KEY`, or `TAVILY_API_KEY` is missing. Deliberately reads `GROQ_API_KEY` straight from `os.environ` rather than from `settings`, because it isn't a pydantic `Settings` field at all (see [4.2](#42-configpy)) — `ChatGroq` reads it directly from the process environment itself.
2. **`init_db()`** — `Base.metadata.create_all(bind=engine)`. No migration framework; this just creates any tables that don't exist yet, and does nothing to tables that already exist (including doing nothing useful if a column's *definition* changed — see [13](./13-extending-this-project.md#1338-migrating-sqlite--postgres) for what that means for schema changes).
3. **`ensure_data_dirs()`** — creates `backend/data/uploads/` and `backend/data/rag_indices/` if they don't exist, so the first PDF upload doesn't hit a `FileNotFoundError` on a fresh checkout/container.
4. **`recover_stuck_jobs()`** — queries for any `ResearchRun` still `status="running"` or `RagSession` still `status="indexing"` at boot time, and force-fails them with `error="server restarted"`. This exists because `BackgroundTasks` are in-process (see [3.4.2](./03-architecture.md#342-how-fastapi-backgroundtasks-work)) — if the server process dies mid-pipeline, nothing else will ever flip that row out of `"running"`, and without this hook it would stay there forever, showing as a permanently-spinning card in the UI on every future page load.

**What would break if you changed it:** removing a router's `include_router` call removes that entire API surface with no error at startup — routes just 404. Reordering the startup hooks matters only if you introduce a new hook with a dependency on an earlier one (e.g. a hypothetical hook needing the DB tables to already exist must come after `init_db()`).

## 4.2 `config.py`

**Responsible for:** loading `backend/.env` and exposing typed settings via a Pydantic `Settings` object.

```python
_ENV_PATH = os.path.join(_BACKEND_DIR, ".env")
load_dotenv(dotenv_path=_ENV_PATH)

class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    TAVILY_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    JWT_SECRET_KEY: str          # no default — see below
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7
    DATABASE_URL: str = "sqlite:///./researchmind.db"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    model_config = SettingsConfigDict(env_file=_ENV_PATH, env_file_encoding="utf-8", extra="ignore")

settings = Settings()
```
Two things worth calling out:

1. **The explicit `load_dotenv(dotenv_path=_ENV_PATH)` call, in addition to pydantic-settings' own `env_file` mechanism.** This is not redundant. Pydantic's `Settings` class only populates *its own declared fields* from the `.env` file — it never touches `os.environ` itself. But `GROQ_API_KEY` isn't a `Settings` field (see below), and libraries like `langchain-groq`/`langchain-google-genai`/the Tavily client read their API keys straight from `os.environ`, not from anything this project passes them explicitly. The manual `load_dotenv()` call is what actually makes those keys visible to those libraries. It's also pinned to `_ENV_PATH` (an absolute path derived from this file's own location) rather than a bare `load_dotenv()`, because a bare call searches upward from the process's current working directory, which differs depending on whether you ran `uvicorn main:app` from inside `backend/` or `uvicorn backend.main:app` from the repo root — pinning it removes that ambiguity entirely.
2. **`GROQ_API_KEY` is conspicuously absent from `Settings`.** This isn't an oversight — since nothing in this codebase ever reads `settings.GROQ_API_KEY`, there's no reason to declare it as a typed field; it's used exclusively via `os.environ` by `ChatGroq` itself and by `main.py`'s startup check. Adding it to `Settings` would be harmless but redundant.
3. **`JWT_SECRET_KEY` has no default.** Every other field either has a sensible default or is optional; this one is required, on purpose — instantiating `Settings()` raises a `pydantic.ValidationError` immediately if it's unset, which crashes the app at import time with a clear error rather than letting the app boot and silently sign tokens with a blank or guessable key.

**What would break if you changed it:** removing the explicit `load_dotenv()` call would silently break every LLM call in local dev (the API keys would never reach `os.environ`) while looking like it should work, since `settings.GOOGLE_API_KEY` etc. would still populate correctly from pydantic's own `env_file` handling — a genuinely confusing failure mode to debug, which is exactly why the comment above it is as detailed as it is.

## 4.3 `db/database.py`

**Responsible for:** the SQLAlchemy engine, session factory, declarative base, and the `get_db()` FastAPI dependency.

```python
def _resolve_database_url(url: str) -> str:
    prefix = "sqlite:///"
    if url.startswith(prefix) and not url.startswith("sqlite:////"):
        abs_path = os.path.normpath(os.path.join(_BACKEND_DIR, url[len(prefix):]))
        return f"sqlite:///{abs_path}"
    return url

DATABASE_URL = _resolve_database_url(settings.DATABASE_URL)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```
`_resolve_database_url` exists for the same "which directory was the process launched from" reason as `config.py`'s `load_dotenv` pinning: a relative `sqlite:///./researchmind.db` URL resolves against the process's CWD by default, and this project can be launched two different ways (`cd backend && uvicorn main:app` vs. `uvicorn backend.main:app` from the repo root) that have different CWDs. This function force-resolves any relative sqlite path against `backend/` specifically, so the DB file always lands in the same place regardless of launch method. (It deliberately does *not* touch `sqlite:////absolute/path` URLs — four slashes is SQLAlchemy's own syntax for "this is already absolute," and this function correctly leaves those alone.)

`check_same_thread: False` is required because SQLite, by default, refuses to let a connection be used from a different thread than the one that created it — but FastAPI's request handling (and this project's background tasks) can hand a session to different threads. This flag disables that check; it's safe here because this project doesn't share a single `Session` object across threads simultaneously — each request/task gets its own via `get_db()` / `SessionLocal()`.

**What would break if you changed it:** swapping `DATABASE_URL` to a Postgres URL just works, mechanically — `_resolve_database_url`'s early return handles any non-`sqlite:///` URL unchanged, and `connect_args` becomes `{}`. See [13.8](./13-extending-this-project.md#1338-migrating-sqlite--postgres) for what *else* would need to happen (there's no migration tooling yet, so `create_all()` would need to run against the new empty database, and any existing SQLite data would need a separate export/import).

## 4.4 `db/models.py`

Covered in full in [3.3](./03-architecture.md#33-the-data-model) — every table, every column, the `steps` JSON footgun, and the cascade-delete mechanics. Not re-duplicated here.

## 4.5 `agents/tools.py`

**Responsible for:** the two tool functions given to the Search and Reader agents.

```python
@tool
def web_search(query: str) -> str:
    """Search the web for recent and reliable information on a topic. Returns Titles, URLs and snippets."""
    results = tavily.search(query=query, max_results=5)
    out = []
    for r in results['results']:
        out.append(f"Title: {r['title']}\nURL: {r['url']}\nSnippet: {r['content'][:300]}\n")
    return "\n----\n".join(out)

@tool
def scrape_url(url: str) -> str:
    """Scrape and return clean text content from a given URL for deeper reading."""
    try:
        resp = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:3000]
    except Exception as e:
        return f"Could not scrape URL: {str(e)}"
```
Full reasoning for the specific numbers (`max_results=5`, `[:300]`, `[:3000]`, the stripped tags, the fake `User-Agent`) is in [5.2](./05-research-pipeline.md#22-the-web_search-tool) and [5.3.2](./05-research-pipeline.md#332-the-scrape_url-tool). The one thing worth flagging here specifically: `scrape_url`'s `except Exception` returns an error *string* rather than raising. This is deliberate — a tool result that comes back as readable text ("Could not scrape URL: ...") lets the calling agent see the failure and potentially react to it (e.g. mention the failure in its final answer), whereas a raised exception would propagate up and kill the entire agent loop over one bad URL.

**What would break if you changed it:** a tool's docstring is not documentation, it's the *only* information the LLM has about when to call this tool — a vague docstring measurably degrades tool-selection accuracy (see [2.7.2](./02-concepts-primer.md#272-tool-calling-mechanically)). Raising instead of returning a string from `scrape_url` would likely crash the Reader agent's entire run any time it picks a URL that happens to be unreachable, rather than degrading gracefully.

## 4.6 `agents/research_agents.py`

**Responsible for:** constructing the two agents and two chains — the model, the tools each agent gets, and the two prompt templates.

```python
llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)

def build_search_agent():
    return create_agent(model=llm, tools=[web_search])

def build_reader_agent():
    return create_agent(model=llm, tools=[scrape_url])

writer_chain = writer_prompt | llm | StrOutputParser()
critic_chain = critic_prompt | llm | StrOutputParser()
```
Every stage shares the exact same `llm` instance (one `ChatGroq(temperature=0)`, module-level) — there's no per-stage model configuration; if you wanted the Critic to run at a different temperature than the Writer, this file is where that split would need to happen (see [13.1](./13-extending-this-project.md#1331-adding-a-new-agent-to-the-research-pipeline) for the mechanics of adding a differently-configured stage).

`build_search_agent()` / `build_reader_agent()` are functions, called fresh each pipeline run (see `pipeline.py`, [4.7](#47-agentspipelinepy)), rather than being built once at module import time the way `writer_chain`/`critic_chain` are. This isn't purely stylistic — `create_agent()` builds a stateful execution graph; constructing it fresh per run avoids any possibility of state (like conversation history) leaking between unrelated research runs. The chains, by contrast, are stateless pipelines (each `.invoke()` call is independent), so building them once at import time is safe and avoids rebuilding an identical object on every request.

Full prompt-by-prompt breakdown of `writer_prompt`/`critic_prompt`: [2.2.4](./02-concepts-primer.md#224-walking-through-this-projects-actual-prompts) and [05-research-pipeline.md](./05-research-pipeline.md) sections 4–5.

**What would break if you changed it:** swapping `ChatGroq(...)` for a different provider's chat model class here changes the LLM for *every* stage of the research pipeline at once (all four stages import from this one `llm` binding) — see [13.3](./13-extending-this-project.md#1333-swapping-the-llm-provider) for the full swap procedure, including the RAG system's separate `ChatGroq` instantiation in `rag_api/service.py`, which is **not** shared with this file and would need its own change.

## 4.7 `agents/pipeline.py`

**Responsible for:** orchestrating the four stages in order, normalizing agent output, and exposing the callback hooks the router uses to update per-step DB status live.

```python
def _message_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part if isinstance(part, str) else part.get("text", "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        ]
        return "\n".join(p for p in parts if p)
    return str(content)
```
This function exists to fix a real, previously-encountered bug — see [12.2](./12-known-issues-and-gotchas.md#122-agent-message-content-can-be-a-list-of-dicts-not-a-string) for the full symptom/root-cause/fix writeup. Short version: LangChain agent responses can come back with `.content` as either a plain string *or* a list of `{"type": "text", "text": "..."}` dicts, depending on the provider and code path — writing a list directly into a SQLAlchemy `Text` column raises `sqlite3.InterfaceError: Error binding parameter: type 'list' is not supported`. Every place in this codebase that persists LLM/agent output to the database calls a version of this exact normalizer first (there are near-identical copies in `rag_api/service.py` and `evals/judges.py` — see [12.2](./12-known-issues-and-gotchas.md#122-agent-message-content-can-be-a-list-of-dicts-not-a-string) for why it's duplicated rather than shared).

```python
def run_research_pipeline_with_callback(
    topic: str,
    on_step_start: Optional[Callable[[str], None]] = None,
    on_step_complete: Optional[Callable[[str, dict], None]] = None,
) -> dict:
    on_step_start = on_step_start or (lambda step: None)
    on_step_complete = on_step_complete or (lambda step, result: None)
    ...
```
**Why callbacks default to no-ops:** this function is also directly runnable as a script (`if __name__ == "__main__":` at the bottom, for CLI testing — `python -m agents.pipeline`, prompts for a topic on stdin, prints the report). The CLI entry point calls `run_research_pipeline(topic)`, a thin wrapper that calls this function with no callbacks at all. Making the callbacks optional (defaulting to functions that do nothing) means the exact same orchestration code serves both the live-DB-updating FastAPI path and the no-database standalone CLI path, with zero duplication and zero `if running_from_cli` branching inside the pipeline logic itself.

Each stage follows the same shape: `on_step_start("search")` → do the work → `state[key] = _message_text(...)` → `on_step_complete("search", {...})`. The full per-stage breakdown (why search feeds into reader, why reader's input is truncated to 800 chars, why writer combines both into one string) is in [05-research-pipeline.md](./05-research-pipeline.md).

**What would break if you changed it:** removing `_message_text()`'s list-handling branch reintroduces the exact SQLite crash described in [12.2](./12-known-issues-and-gotchas.md#122-agent-message-content-can-be-a-list-of-dicts-not-a-string) — and because it doesn't happen on every call (only when a provider happens to return the list-shaped content for that particular response), it's the kind of regression that passes local testing and then fails intermittently in the field.

## 4.8 `research/schemas.py`

**Responsible for:** the Pydantic request/response models for the `/research/*` API.

```python
class RunCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    topic: str = Field(min_length=3, max_length=300)

class StepStatus(BaseModel):
    status: Literal["waiting", "running", "done", "failed"]
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

class RunOut(BaseModel):
    id: int
    topic: str
    status: str
    steps: dict[str, StepStatus]
    created_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class RunDetail(RunOut):
    search_results: Optional[str] = None
    scraped_content: Optional[str] = None
    report: Optional[str] = None
    feedback: Optional[str] = None

class RunListItem(BaseModel):
    id: int
    topic: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
```
Three different response shapes for the same underlying `ResearchRun` row, each sized for its call site: `RunListItem` (history list — no need to ship every run's full report text over the wire just to render a table row), `RunOut` (the poll target — steps + status, still no report body, since polling happens every 2 seconds and the report doesn't change until the run is done), `RunDetail` (extends `RunOut` with the actual content fields — fetched exactly once, after the run completes). `from_attributes=True` is what lets `RunOut.model_validate(sqlalchemy_run_object)` work directly against an ORM object instead of requiring a dict.

`Literal["waiting", "running", "done", "failed"]` on `StepStatus.status` means an unexpected value written to the `steps` JSON column (a typo in `mark_step()`, for instance) would fail Pydantic validation on the way *out* of the API — a real, if narrow, safety net against a category of bug.

**What would break if you changed it:** removing `min_length=3` from `RunCreate.topic` would let empty-ish topics reach the pipeline and waste an LLM call producing a report on nothing; this is enforced entirely at the schema layer, not in `service.py`.

## 4.9 `research/service.py`

**Responsible for:** every database operation for research runs — no FastAPI imports anywhere in this file.

```python
def create_run(db: Session, topic: str) -> ResearchRun: ...
def get_run(db: Session, run_id: int) -> ResearchRun | None: ...
def list_runs(db: Session, limit: int = 50, offset: int = 0) -> list[ResearchRun]: ...
def delete_run(db: Session, run_id: int) -> bool: ...
def mark_step(db: Session, run_id: int, step: str, status: str) -> ResearchRun | None: ...
def finalize_run(db: Session, run_id: int, results: dict) -> ResearchRun | None: ...
def fail_run(db: Session, run_id: int, error: str) -> ResearchRun | None: ...
```
**Why service functions never import FastAPI:** this is the router/service split, and it's consistent across `research/`, `rag_api/`, and (partially) `auth/`. A service function takes a plain SQLAlchemy `Session` and plain Python arguments, and returns plain Python objects — no `HTTPException`, no `Depends`, no request/response model coupling. This buys two things: the same function is callable from a non-HTTP context (the background task functions in `router.py` call these directly — they're not inside a request), and the business logic is unit-testable (in principle — this project has no test suite currently, see [12](./12-known-issues-and-gotchas.md)) without spinning up FastAPI at all. HTTP-specific concerns (404s, status codes, request validation) live exclusively in `router.py`, one layer up — a service function returning `None` for "not found" is the router's cue to raise `HTTPException(404, ...)`, not the service's job to know about HTTP at all.

`fail_run()`'s `db.rollback()` as its very first line is the fix for a real production-shaped bug — full writeup at [12.3](./12-known-issues-and-gotchas.md#123-the-swallowed-exception-bug). Short version: `fail_run` is the exception handler's cleanup path. If the exception being handled originated from a failed `db.commit()` earlier in the same session (e.g. inside `finalize_run`), that session is left in SQLAlchemy's "pending rollback" state, and *every* subsequent query on it — including the `get_run()` call inside `fail_run` itself — raises `PendingRollbackError` instead of doing anything useful. Calling `db.rollback()` unconditionally first clears that state; it's a no-op if there was nothing to roll back, so it's safe to call every time regardless of what actually went wrong.

**What would break if you changed it:** removing the `db.rollback()` from `fail_run()` reintroduces the exact hang described in [12.3](./12-known-issues-and-gotchas.md#123-the-swallowed-exception-bug) — a run that fails via a DB-commit-triggered exception gets stuck in `"running"` forever, because the code path meant to mark it `"failed"` itself throws and the *outer* `except Exception` in `router.py`'s `_execute_run()` has nothing left to catch it (it already caught the original exception; `fail_run` throwing inside that `except` block would propagate past the entire function, uncaught, and the background task just dies silently).

## 4.10 `research/router.py`

Covered end-to-end in the request-lifecycle walkthrough at [3.2.1](./03-architecture.md#321-user-submits-a-research-topic). The five routes:

| Route | Method | Purpose |
|---|---|---|
| `/research/run` | POST | Create a run row, schedule `_execute_run` as a background task, return `202` |
| `/research/history` | GET | Paginated list (`RunListItem[]`) |
| `/research/history/{id}` | GET | Full detail (`RunDetail`) |
| `/research/history/{id}/status` | GET | Poll target (`RunOut`) |
| `/research/history/{id}` | DELETE | Remove a run row |

**What would break if you changed it:** the background task function `_execute_run` is defined in this file, not `service.py` — it's HTTP-adjacent orchestration (it decides *when* to call `mark_step` via callbacks) rather than a pure DB operation, which is why it lives at the router layer despite not being a route handler itself. Moving it to `service.py` would blur the layer boundary described in [4.9](#49-researchservicepy) without breaking anything functionally, but would be inconsistent with the pattern `rag_api/router.py` also follows for its own `_index_session`.

## 4.11 `rag_api/schemas.py`

```python
class SessionOut(BaseModel):
    id: str
    pdf_filename: str
    num_chunks: Optional[int] = None
    status: str
    error: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class QueryCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=3, max_length=500)

class SourceChunk(BaseModel):
    page: Optional[int] = None
    snippet: str

class QueryOut(BaseModel):
    id: int
    question: str
    answer: Optional[str] = None
    sources: list[SourceChunk] = []
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class SessionDetail(SessionOut):
    queries: list[QueryOut] = []
```
Same list/detail split pattern as `research/schemas.py` (`SessionOut` vs. `SessionDetail`), for the same reason — the session list view doesn't need every past Q&A pulled along with it. `SourceChunk.page` is `Optional[int]` because `PyPDFLoader`'s page metadata could theoretically be absent for a malformed PDF, though in practice this project hasn't observed that.

## 4.12 `rag_api/service.py`

The RAG system's core logic — `build_index()` and `answer_question()` — is covered function-by-function, line-by-line, in [06-rag-system.md](./06-rag-system.md) (sections 2 and 3). This section covers the parts *not* already detailed there: the CRUD functions and the path-construction helpers.

```python
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_BACKEND_DIR, "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
RAG_INDICES_DIR = os.path.join(DATA_DIR, "rag_indices")

def upload_path(session_id: str) -> str:
    return os.path.join(UPLOADS_DIR, f"{session_id}.pdf")

def index_dir(session_id: str) -> str:
    return os.path.join(RAG_INDICES_DIR, session_id)
```
Both path helpers derive from the *session ID*, not from anything user-supplied (like the original filename) — this is a deliberate path-safety choice, since session IDs are server-generated UUID hex strings (`uuid.uuid4().hex` in `db/models.py`), never user input, so there's no path-traversal surface here even though the original uploaded filename (`pdf_filename`, stored for display only) is never sanitized or validated beyond the content-type/extension check in the router.

`delete_session()` cleans up all three places a session's data lives — the DB row (with cascading `RagQuery` deletion, see [3.3.3](./03-architecture.md#333-relationships-and-cascade-behavior)), the uploaded PDF file, and the Chroma index directory:
```python
def delete_session(db: Session, session_id: str) -> bool:
    session = get_session(db, session_id)
    if session is None:
        return False
    pdf_path = upload_path(session_id)
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    idx_dir = index_dir(session_id)
    if os.path.isdir(idx_dir):
        shutil.rmtree(idx_dir)
    db.delete(session)
    db.commit()
    return True
```
**What would break if you changed it:** if `index_dir()`/`upload_path()` ever started deriving from user-controllable input instead of the server-generated session ID, this would become a real path-traversal risk (`../../etc/passwd`-style session IDs) — this is exactly the kind of thing to double-check if extending the session-ID generation scheme (see [13.4](./13-extending-this-project.md#1334-swapping-the-vector-db) if that's part of a larger vector-DB change).

## 4.13 `rag_api/router.py`

Covered end-to-end in [3.2.2](./03-architecture.md#322-user-uploads-a-pdf-and-asks-a-question). One detail worth calling out specifically here: `ask_question()`'s exception handling distinguishes two failure shapes:
```python
try:
    answer, sources = service.answer_question(session_id, payload.question)
except FileNotFoundError as exc:
    raise HTTPException(status_code=400, detail=str(exc))
except Exception as exc:
    logger.exception("ask failed for session %s", session_id)
    raise HTTPException(status_code=502, detail=f"The AI provider failed to answer: {exc}")
```
`FileNotFoundError` (no Chroma index on disk for this session — shouldn't normally happen if `status == "ready"` was checked just above, but is a real possibility if the index directory was deleted out-of-band) maps to `400` (client's fault — asking about a session that isn't actually indexed). Everything else — Groq rate limits, Gemini embedding failures, any other upstream provider error — maps to `502 Bad Gateway`, which is the semantically correct code for "an upstream service this server depends on failed," and the message is prefixed `"The AI provider failed to answer: ..."` specifically so the frontend has something meaningful to display rather than a bare, unlabeled 500.

| Route | Method | Purpose |
|---|---|---|
| `/rag/upload` | POST | Validate + store the PDF, schedule `_index_session` as a background task |
| `/rag/sessions` | GET | List sessions |
| `/rag/sessions/{id}` | GET | Full detail incl. past Q&A |
| `/rag/sessions/{id}/status` | GET | Poll target |
| `/rag/sessions/{id}` | DELETE | Remove session + files + index |
| `/rag/sessions/{id}/ask` | POST | Ask a question (only once `status == "ready"`) |

## 4.14 `evals/router.py`

```python
def _load_with_timestamp(name: str) -> dict | None:
    cached = load_cached_result(name)
    if cached is None:
        return None
    path, payload = cached
    return {**payload, "timestamp": _iso(_parse_cache_timestamp(path))}

@router.get("/latest")
def get_latest() -> dict:
    return {"research": _load_with_timestamp("research"), "rag": _load_with_timestamp("rag")}

@router.get("/status")
def get_status() -> dict:
    ...
```
This router is deliberately the thinnest one in the codebase — both endpoints do file I/O only, never an LLM call, and both reuse `find_latest_cache()`/`load_cached_result()`/`_parse_cache_timestamp()` from `backend/evals/report.py` rather than re-implementing "find the newest timestamped file" logic here. Full detail on the eval system this exposes: [07-evaluation-module.md](./07-evaluation-module.md).

**What would break if you changed it:** this router has no DB dependency (`Depends(get_db)`) at all — it's the one router in this codebase that doesn't touch SQLite, since eval results live entirely as flat JSON files. Adding a DB-backed feature here (e.g. "let a user star a scorecard") would be the first thing to break this file's current statelessness.

## 4.15 `auth/*`

Full conceptual/security writeup: [08-auth-system.md](./08-auth-system.md). File responsibilities:

- **`auth/schemas.py`** — `UserCreate` (with a `field_validator` enforcing alphanumeric-plus-underscore usernames), `UserLogin` (accepts email *or* username in one field, `email_or_username`), `UserOut`, `Token`.
- **`auth/security.py`** — `hash_password()`/`verify_password()` (via `passlib`'s bcrypt `CryptContext`), `create_access_token()`/`decode_access_token()` (via `python-jose`). No FastAPI imports — same service-layer discipline as `research/service.py` and `rag_api/service.py`.
- **`auth/dependencies.py`** — `get_current_user()`, a FastAPI dependency that decodes the bearer token, loads the corresponding `User` row, and raises `401` if anything about that chain is invalid (bad signature, expired, user deleted, user deactivated). `get_current_active_user = get_current_user` is a bare alias, explicitly commented as a placeholder for a future distinct "is this account merely inactive vs. actively suspended" check that doesn't exist yet.
- **`auth/router.py`** — `/auth/signup`, `/auth/login`, `/auth/me`, `/auth/logout`. `signup()`'s pre-check-then-commit-with-`IntegrityError`-fallback pattern is worth internalizing:
  ```python
  if db.query(User).filter(User.email == payload.email).first():
      raise HTTPException(409, "Email already registered")
  ...
  try:
      db.commit()
  except IntegrityError:
      db.rollback()
      raise HTTPException(409, "Email or username already registered")
  ```
  The upfront `.filter(...).first()` checks give a fast, friendly error in the common case; the `try/except IntegrityError` around the actual commit closes the race condition where two signups for the same email land between the check and the commit (a TOCTOU — time-of-check to time-of-use — gap). Neither alone is sufficient: the check alone has the race; the `try/except` alone would give a less specific/friendly error and do more wasted work in the common (non-racing) rejection case.

**What's genuinely missing, stated plainly:** none of `research/router.py` or `rag_api/router.py` import `get_current_user` — every research run and RAG session is visible/mutable by anyone who can reach the API, regardless of who's "logged in." See [08-auth-system.md](./08-auth-system.md#82-why-its-not-wired-to-the-frontend) for why this is a stated scope decision, not an oversight, and [13.6](./13-extending-this-project.md#1336-wiring-the-auth-system-to-the-frontend) for exactly what wiring it up would involve.

---

**Next:** [05-research-pipeline.md](./05-research-pipeline.md) and [06-rag-system.md](./06-rag-system.md) go deeper on the two AI systems specifically; [08-auth-system.md](./08-auth-system.md) covers the auth system's security properties in full.
