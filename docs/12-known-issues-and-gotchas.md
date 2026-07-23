# 12. Known Issues and Gotchas

Honest and specific, including the real ones hit during development. Each entry: symptom, root cause, fix or workaround, how to recognize it next time. A couple of entries are noted as lower-confidence (evidence is circumstantial rather than a directly-recorded incident) — flagged explicitly rather than presented as more certain than they are, per this doc set's own no-invented-details rule.

## 12.1 LangChain version churn

**Symptom (general category):** LangChain's package ecosystem has been reorganized multiple times — functionality has moved between `langchain`, `langchain-core`, `langchain-community`, and (more recently) a `langchain-classic` package for older/legacy patterns. An import that worked in one version can silently move or break in another.

**Evidence in this codebase:** `requirements.txt` pins `langchain-classic>=0.1.0` as a separate dependency alongside `langchain`/`langchain-core`/`langchain-community`, and the (since-removed) `backend/rag/retrievers/multiquery.py` demo imported `MultiQueryRetriever` specifically from `langchain_classic.retrievers.multi_query` rather than from `langchain` directly — a sign that this project's dependency tree was built against a LangChain version where that class had already migrated to the "classic" package.

**How to diagnose it:** an `ImportError` or `ModuleNotFoundError` for a class that "should" be in `langchain`/`langchain_community` per older tutorials/documentation is the typical symptom — check whether it's moved to `langchain-classic` or a provider-specific package (`langchain-google-genai`, `langchain-groq`, etc.) first, before assuming it's been removed entirely.

**Confidence note:** this is a well-documented, general characteristic of the LangChain ecosystem, and the `langchain-classic` dependency is concrete evidence this project navigated it — but no specific "here's the exact error message we hit" incident is preserved anywhere in this codebase's comments or history for this entry specifically.

## 12.2 Agent message content can be a list of dicts, not a string

**Symptom:** `sqlite3.InterfaceError: Error binding parameter: type 'list' is not supported` when trying to save an agent's or model's response text to the database.

**Root cause:** LangChain agent/chat responses expose their text via a `.content` attribute — but depending on the provider and code path, `.content` can come back as either a plain string *or* a list of content-part dicts (e.g. `[{"type": "text", "text": "..."}]`). Code that assumes it's always a string and passes it straight to a SQLAlchemy `Text` column crashes the moment a response happens to come back in the list shape.

**Fix:** a normalizer function, duplicated (not shared as a common import) in three places — `backend/agents/pipeline.py`, `backend/rag_api/service.py`, `backend/evals/judges.py` — each called `_message_text()`:
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
**Why duplicated rather than shared:** each of the three files is in a different subpackage (`agents/`, `rag_api/`, `evals/`) with no existing shared-utilities module they all import from — the function is small enough (a dozen lines) that three independent copies were judged simpler than introducing a new cross-cutting `utils` module for one helper. This is a real, deliberate simplicity-over-DRY tradeoff, not an oversight — worth knowing if you're about to "fix" the duplication, since consolidating it would mean picking (or creating) a shared module all three subpackages are comfortable depending on.

**How to recognize it next time:** any new code path that persists LLM/agent output directly into a database column, a JSON field, or anywhere else that requires a specific type, without going through one of these normalizers, is at risk of this exact crash — and because it doesn't happen on *every* call (only when a particular response happens to come back list-shaped), it can pass casual testing and then fail intermittently later.

## 12.3 The swallowed-exception bug

**Symptom:** a research run gets stuck showing `status: "running"` forever in the UI, never reaching `completed` or `failed`, even though the actual pipeline work has long since stopped.

**Root cause:** `fail_run()` (`backend/research/service.py`) is the exception-handler cleanup path, called from `_execute_run()`'s `except Exception` block. If the *original* exception being handled was itself caused by a failed `db.commit()` earlier in that same database session (e.g. inside `finalize_run()`), SQLAlchemy leaves that session in a "pending rollback" state — and every subsequent operation on it, including the `get_run()` query at the top of `fail_run()` itself, raises `PendingRollbackError` instead of doing anything useful. `fail_run` would itself throw, uncaught (the outer `except Exception` in `_execute_run` had already fired and moved into its handler block — there's no second layer to catch a failure *inside* the exception handler), and the background task would die silently, having never actually marked the run as failed.

**Fix:** `fail_run()`'s literal first line is an unconditional `db.rollback()`:
```python
def fail_run(db: Session, run_id: int, error: str) -> ResearchRun | None:
    # fail_run is the exception-handler path — if it's reached because an
    # earlier commit on this same session (e.g. in finalize_run) already
    # failed, the session is left in "pending rollback" and every further
    # query on it raises PendingRollbackError until this runs. Rolling back
    # unconditionally is a harmless no-op when there's nothing to undo.
    db.rollback()
    ...
```
Safe to call every time regardless of whether there was actually anything to roll back — a rollback on a clean session is a no-op.

**How to recognize it next time:** any exception-handling/cleanup function that queries the database as its *first* action, on a session that might have already had a failed write earlier in the same request/task, is at risk of this same failure shape — the fix pattern (unconditional `rollback()` before the first query in any exception-handler path) generalizes directly; `rag_api/service.py`'s `fail_session()` follows the identical pattern for exactly this reason.

## 12.4 Render `$PORT` binding

**Symptom:** the Docker container builds successfully and runs without crashing (visible in Render's logs — `Uvicorn running on http://0.0.0.0:8000`), but Render's deploy reports the service as unhealthy/timed out, and the live URL never serves traffic.

**Root cause:** Render assigns each service a dynamic port via the `$PORT` environment variable and expects the app to bind to it; its platform-level health/port scan checks whether something is actually listening on that assigned port. The Dockerfile's `CMD` originally used exec-form JSON-array syntax with a hardcoded port:
```dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```
Exec-form doesn't invoke a shell, so `${PORT}` — if it had even been written into that array — would never have been expanded; the app was bound to a fixed `8000` regardless of what Render actually assigned.

**Fix:** switch to shell-form `CMD` (no JSON array), letting the shell perform variable expansion before `uvicorn` starts:
```dockerfile
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```
`${PORT:-8000}` falls back to `8000` when `$PORT` isn't set at all (local `docker compose`, which explicitly maps `8000:8000`), so the same image works correctly in both environments.

**How to recognize it next time:** "container logs show the app started fine, but the platform says it's unhealthy/unreachable" is the generic symptom of a port-binding mismatch on any PaaS that assigns dynamic ports — always verify the actual bound port against what the platform expects, and specifically check whether your `CMD`/entrypoint is exec-form (no shell, no env var expansion) or shell-form (has a shell, expands `${VAR}`) if a port variable is involved.

## 12.5 Render free-tier OOM at 512MB

**Symptom:** the container starts, and then dies/restarts under real usage, without an obvious application-level crash in the logs — consistent with the platform force-killing the process for exceeding its memory allocation.

**Root cause:** `sentence-transformers` (an unused, inherited dependency — see [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)) pulled in `torch`, whose installed footprint pushed both the Docker image size and the process's idle RAM usage well past Render's free-tier 512 MB cap.

**Fix:** removed `sentence-transformers`/`torch`/`transformers` from `requirements.txt` entirely, since every live embedding call already went through the Gemini API, not a local model. Measured result: Docker image 2.9 GB → 240 MB; idle RAM ~800 MB → ~160 MB.

**How to recognize it next time:** an unexplained container restart on a memory-capped platform, with no corresponding application error, is the classic OOM-kill signature — check `docker stats`/the platform's memory metrics against the plan's stated cap before assuming it's an application bug, and audit `requirements.txt`/`package.json` for large ML/data-science dependencies that might be present but never actually invoked by any live code path (a `grep` for the import, across the whole live codebase, settles it quickly).

## 12.6 Docker `HEALTHCHECK` vs. Render's assigned port

**Symptom:** distinct from [12.4](#124-render-port-binding) — this one specifically involves the Dockerfile's own `HEALTHCHECK` instruction, which (before it was removed) was hardcoded to check `http://localhost:8000/health`, i.e. the *fallback* port, not whatever `$PORT` Render actually assigned.

**Root cause:** Docker's `HEALTHCHECK` runs *inside* the container and reports a health status Docker itself tracks — it's unrelated to (and doesn't influence) Render's own platform-level `healthCheckPath` check (`render.yaml`'s `healthCheckPath: /health`, which Render performs externally, against whatever port it actually assigned). A `HEALTHCHECK` hardcoded to port 8000 would report unhealthy on Render (since the app is actually listening on whatever `$PORT` was assigned, not necessarily 8000), even after the `$PORT` binding fix in [12.4](#124-render-port-binding) was in place — a second, related-but-distinct issue layered on top of the first.

**Fix:** the `HEALTHCHECK` instruction was removed from `backend/Dockerfile` entirely, along with the `curl` package it depended on (see [12.12](#1212-docker-compose-healthcheck-still-references-curl-now-removed-from-the-image) for the consequence this created elsewhere). Render's own `healthCheckPath` in `render.yaml` is the health check that actually matters for the Render deployment; Docker's own internal `HEALTHCHECK` was redundant with it in production and simplest to remove rather than keep correctly parameterized against a variable port.

**How to recognize it next time:** if a container reports "unhealthy" from Docker's own perspective (`docker ps` showing `(unhealthy)`) while the platform it's deployed to reports something different (or the app is demonstrably reachable), suspect a `HEALTHCHECK` instruction checking the wrong port, or depending on a binary (`curl`, in this case) that may not actually be present in the image.

## 12.7 Gemini model-name churn and "not available to new users" errors

**Symptom (general category):** Google's Gemini model lineup and naming has changed over time (preview models, versioned model names, deprecations), and specific model identifiers can become unavailable or restricted to certain account types/regions without much warning.

**Confidence note — flagged honestly:** unlike every other entry in this document, this one has **no direct evidence** recoverable from this codebase or this session's history — no comment, error message, or commit trail describing a specific incident of this kind was found while writing these docs. The only concrete artifact is that `backend/rag_api/service.py` and `backend/rag/vector_store.py`/`create_database.py` consistently pin the same specific model string, `models/gemini-embedding-001`, everywhere embeddings are used — which is *consistent with* having settled on a specific, working model name after some amount of trial, but isn't proof of it. This entry is included because it was requested as a category worth documenting, but it should be read as general ecosystem-awareness guidance rather than a recorded incident: **if** a Gemini model name in this codebase starts returning an "unavailable" or "not found" error, check Google AI Studio / the Gemini API docs for the current valid model identifiers before assuming the code is broken — provider-side model renames are a real, recurring category of failure for any project pinning a specific model string, independent of whether it's happened in this project's own history yet.

## 12.8 Groq daily token quota (100k TPD) vs. per-minute rate limits

**Symptom:** eval runs (and, less frequently, live pipeline/RAG requests) failing with a `429` error, even when requests are well-spaced and clearly not exceeding any *per-minute* rate limit.

**Root cause:** Groq's free tier enforces (at least) two independent limits — a per-minute request/token rate limit (RPM/TPM), and a **separate daily token budget (100,000 TPD — tokens per day)**. Code written to be polite about the per-minute limit (e.g. a `time.sleep(1)` between calls) does nothing to help once the *daily* budget is exhausted — that's a different axis entirely, and no amount of inter-call pacing fixes it. The actual error text makes the distinction clear once you know to look for it:
```
Error code: 429 - {'error': {'message': 'Rate limit reached for model `llama-3.3-70b-versatile`
in organization `...` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 99779,
Requested 585. Please try again in 5m14.496s. ...', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
```
**Fix/mitigation:** the eval module's quota-detection logic ([7.5.2](./07-evaluation-module.md#752-quota-detection-logic)) matches on substrings including `"tpd"` specifically (alongside `"rate_limit_exceeded"`, `"quota"`, `"resource_exhausted"`) so a daily-budget exhaustion is correctly distinguished from other failure types and triggers the cached-fallback behavior ([7.5.1](./07-evaluation-module.md#751-live-first-with-cached-fallback)) rather than being treated as a generic, retryable transient error. There is no code-level fix for the underlying constraint itself — it resets on Groq's own daily cycle, or requires a paid tier.

**How to recognize it next time:** a `429` whose message explicitly says "tokens per day (TPD)" (as opposed to a per-minute framing) is this specific limit — check the `Used` / `Limit` numbers in the error text directly; `time.sleep()`-based pacing fixes per-minute limits, not this one.

## 12.9 numpy 2.x vs. torch incompatibility

**Symptom (category):** a broad class of Python ML-ecosystem packages, historically including `torch`, have had compatibility constraints against numpy's major-version-2 release (numpy 2.0 introduced breaking changes some packages hadn't yet adapted to at the time).

**Evidence in this codebase:** `requirements.txt` pins `numpy<2` explicitly (rather than an unbounded `numpy>=1.26.0`), a constraint that was kept in place even *after* `torch` itself was removed from the dependency tree in the [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers) cleanup — a conservative choice to avoid introducing a new, untested numpy-2.x compatibility question across the remaining dependency tree (`chromadb`, `pandas`, `langchain`'s own dependencies) at the same time as a large dependency removal, rather than a currently-active `torch`-specific requirement.

**How to recognize it next time:** if a future dependency addition needs numpy 2.x specifically, re-verify the rest of the dependency tree (`chromadb` and its transitive dependencies especially) actually supports it before lifting this pin — it was left in place defensively, not because every remaining package has been confirmed to require it.

## 12.10 chromadb has no wheels for Python 3.14

**Symptom:** `pip install chromadb` (or a full `pip install -r requirements.txt`) fails outright on a Python 3.14 interpreter, with pip falling back to trying to build from source and failing, or failing to find a compatible distribution at all.

**Root cause:** `chromadb`'s dependency chain (including `onnxruntime`) ships prebuilt binary wheels for specific Python versions; as of this project's development, those wheels covered Python 3.11–3.12 but not yet 3.14.

**Fix/workaround:** use Python 3.11 or 3.12 specifically for the backend virtual environment — documented directly in the root README's Getting Started section and repeated in [10.1](./10-deployment.md#101-local-development-setup) of this doc set. The Dockerfile sidesteps this entirely by pinning `FROM python:3.12-slim`, so it's only a concern for local, non-Docker development environments where a developer's system Python might default to something newer.

**How to recognize it next time:** any `pip install` failure specifically on `chromadb` or `onnxruntime`, especially manifesting as "no matching distribution found" or a from-source build attempt that then fails, is worth checking against the interpreter version first — this exact category of "the ML dependency ecosystem lags behind the newest Python release" issue recurs across many packages, not just this one.

## 12.11 The `langchain_community` Chroma deprecation warning

**Symptom:** a warning (not an error — the code still works) printed to logs during any RAG indexing or querying operation:
```
LangChainDeprecationWarning: The class `Chroma` was deprecated in LangChain 0.2.9 and will be removed
in 1.0. An updated version of the class exists in the `langchain-chroma` package and should be used
instead. To use it run `pip install -U langchain-chroma` and import as `from langchain_chroma import Chroma`.
```
**Root cause:** this project imports `Chroma` from `langchain_community.vectorstores` (the original location); LangChain has since split vector-store integrations out into their own dedicated packages (`langchain-chroma`, in this case) as part of a broader effort to decouple the core `langchain` packages from every possible integration's dependencies.

**Fix:** none applied — this is a real, currently-unaddressed deprecation, observed directly during RAG smoke testing, not a functional bug. Migrating means adding `langchain-chroma` to `requirements.txt` and changing the import in `backend/rag_api/service.py` (and the demo scripts `rag/vector_store.py`/`rag/create_database.py`, if kept in sync) from `from langchain_community.vectorstores import Chroma` to `from langchain_chroma import Chroma`.

**How to recognize it next time:** any `LangChainDeprecationWarning` in the logs is exactly this pattern — LangChain's own deprecation warnings are generally specific and actionable (they name the replacement package/import directly), so treat them as a to-do list rather than noise, even though they don't block current functionality.

## 12.12 docker-compose healthcheck still references curl (now removed from the image)

**Symptom:** running the full stack via `docker compose up` (not just the backend alone), the frontend container never starts — `docker compose ps` shows the backend stuck at `(unhealthy)` indefinitely, and `depends_on: condition: service_healthy` blocks the frontend from ever being created.

**Root cause:** `docker-compose.yml`'s backend healthcheck is:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
```
This runs `curl` *inside* the backend container. `curl` was removed from `backend/Dockerfile` as part of the same cleanup that removed the Dockerfile's own `HEALTHCHECK` instruction ([12.6](#126-docker-healthcheck-vs-renders-assigned-port)) — but `docker-compose.yml` was (deliberately, at the time — the instruction explicitly scoped the change to the Dockerfile only) not updated to match, since editing it was out of scope for that particular change.

**Status: known, unfixed, documented here on purpose.** The backend itself is completely healthy in this scenario — a direct `curl http://localhost:8000/health` from the *host* machine succeeds — it's specifically Compose's internal healthcheck, run from inside a container that no longer has `curl` installed, that fails every single time with `exec: "curl": executable file not found in $PATH`.

**Fix, not yet applied:** swap the healthcheck's `test` to something that doesn't require `curl` — Python is already guaranteed present in the image, so a one-liner via `python3 -c "..."` (using `urllib.request`) would work without reintroducing `curl` as a dependency solely for this check.

**How to recognize it next time:** `docker compose ps` showing a service stuck `(unhealthy)` while the same service responds correctly to a direct `curl` from the host is a strong signal the healthcheck command itself is broken (missing binary, wrong port, wrong path) — `docker inspect <container> --format '{{json .State.Health}}'` shows the actual healthcheck command's output/error, which immediately reveals a "command not found" vs. a genuine connectivity failure.

## 12.13 Free-tier limits table: what breaks, when, and what it costs to fix

| Limit | Platform | What breaks | When | Fix |
|---|---|---|---|---|
| 512 MB RAM | Render (backend) | Container OOM-killed, service crash-loops | Any time resident memory exceeds the cap | Trim dependencies ([11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)), or upgrade plan |
| No persistent disk | Render (backend) | SQLite DB + uploaded PDFs + Chroma indexes wiped | Every redeploy/restart | Accept it for a demo ([1.4](./01-project-overview.md#14-what-its-not)); attach a real persistent disk (paid) or an external DB for anything real |
| 15-minute sleep | Render (backend) | First request after idle takes ~30–60s | Any time the service has had zero traffic for 15 min | `/warmup` endpoint exists (not yet called proactively by the frontend — see [10.3.3](./10-deployment.md#1033-free-tier-constraints-512mb-ram-no-persistent-disk-15-min-sleep)); upgrade plan for always-on |
| 100,000 TPD | Groq (chat/judge calls) | `429` errors on pipeline runs, RAG answers, and eval judge calls | Cumulative token usage across the whole day, across every feature sharing the same key | Eval module's live-first/cached-fallback design ([7.5.1](./07-evaluation-module.md#751-live-first-with-cached-fallback)) absorbs this for `/evals`; live pipeline/RAG requests during exhaustion just fail with a clear `502`/error message — no fallback exists for those paths today |
| Free-tier Gemini embedding quota | Google Gemini | Indexing/query embedding calls fail | High-volume PDF indexing in a short window | No specific mitigation implemented; would need the same kind of quota-awareness the Groq path has, extended to embedding calls, if this became a recurring problem |

---

**Next:** [13-extending-this-project.md](./13-extending-this-project.md) — concrete, numbered steps for the most common ways someone (human or AI) would want to extend this codebase.
