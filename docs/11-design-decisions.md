# 11. Design Decisions

The "why" document. Every entry follows the same shape: the context that created the decision, the options actually considered, what was chosen, the tradeoff knowingly accepted, and what would change the decision. Many of these are referenced from other docs by section number (e.g. "see 11.5") — this is the canonical, collected version of each.

## 11.1 Groq for chat, Gemini for embeddings

**Context:** every LLM call in this project needs a provider, and every RAG chunk/question needs an embedding provider — these don't have to be the same company.

**Options considered:** one provider for everything (all-Gemini, or all-OpenAI); Groq for chat + Gemini for embeddings (what was chosen); OpenAI for everything.

**Chosen:** Groq (Llama 3.3 70B) for every chat/agent/judge call; Gemini (`gemini-embedding-001`) for every embedding call.

**Why not all-Gemini:** would have worked technically — Gemini offers both chat and embeddings. The deciding factor was Groq's inference speed on its free tier, which matters directly for a live demo's perceived responsiveness (an agent pipeline making several sequential LLM calls is far more pleasant to watch complete in seconds than tens of seconds per call), plus Groq's free-tier reliability during this project's own development.

**Why not all-OpenAI:** OpenAI's free tier is far more limited for a project that needs to run repeated evaluation suites and live demo traffic without hitting a hard paywall quickly; Groq and Gemini's combined free tiers cover this project's actual usage pattern better.

**The tradeoff accepted:** two API keys to manage instead of one, and the (real, encountered — see [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits)) Groq daily token cap as a genuine operational constraint on how much live traffic (including eval runs) this project's chat calls can sustain in a day.

**What would change this decision:** moving to a paid tier of any single provider that offers both fast chat *and* embeddings at acceptable cost would remove the two-provider complexity — this was purely a free-tier-era tradeoff, not a belief that two providers is inherently the right architecture.

## 11.2 Llama 3.3 70B specifically

**Context:** Groq hosts several models; a specific one had to be picked for every chat call in this project.

**Options considered:** smaller/faster Groq-hosted models (lower latency, lower quality); Llama 3.3 70B (chosen); larger models where available.

**Chosen:** `llama-3.3-70b-versatile` — Groq's largest generally-available model at the time this project was built, used identically for agents, chains, RAG answers, and eval judges.

**Why:** the research pipeline's Writer/Critic stages and the RAG system's answer generation benefit meaningfully from a stronger model's reasoning and instruction-following — a smaller model would more frequently drift from the requested report structure ([5.4.2](./05-research-pipeline.md#542-why-the-required-structure)) or fail to follow the RAG grounding instruction ([2.5.5](./02-concepts-primer.md#255-what-grounding-means-and-how-the-prompt-enforces-it)) reliably. Using the *same* model for the eval judges as for the systems under test was a pragmatic choice (one provider relationship, one quota to manage) with a real, honestly-stated limitation — see [7.7](./07-evaluation-module.md#77-limitations).

**Tradeoff accepted:** the largest available model also consumes the most tokens per call against the shared daily quota ([11.1](#111-groq-for-chat-gemini-for-embeddings)) — a smaller model would stretch the same 100,000 TPD budget further, at some cost to output quality.

**What would change this decision:** if quota exhaustion became the dominant operational problem rather than an occasional annoyance, downgrading non-critical calls (e.g. the Search/Reader agent stages, which need less sophisticated reasoning than Writer/Critic) to a smaller/faster model would be a reasonable, differentiated response — not yet done, since this project's actual usage hasn't made that tradeoff clearly worth the added complexity of managing per-stage model configuration.

## 11.3 Polling over SSE/WebSockets

**Context:** the frontend needs to learn when a research run or RAG indexing job — both running as backend tasks that take tens of seconds — has progressed or finished.

**Options considered:** polling (repeatedly asking "are you done yet?"); Server-Sent Events (server pushes updates over a long-lived HTTP connection); WebSockets (full bidirectional persistent connection).

**Chosen:** polling, every 2 seconds, via `usePolling` ([9.3](./09-frontend-walkthrough.md#93-the-polling-hook-libusepollingjs)).

**Why:** SSE/WebSockets would reduce latency (near-instant updates vs. up to a 2-second poll delay) and reduce request overhead, but both require managing a persistent connection's lifecycle — reconnection after a drop, handling the connection surviving (or not) a backend restart, and behaving sanely through Render's free-tier sleep/wake cycle, which is a meaningfully less friendly environment for long-lived connections than for simple stateless request/response. Polling requires none of that: every poll is a completely independent, stateless HTTP request that either succeeds or fails on its own, with no connection state to reconcile.

**Tradeoff accepted:** up to ~2 seconds of added latency in reflecting a state change, and slightly more total HTTP request volume across a run's lifetime than a push-based approach would need — both judged acceptable given this project's actual traffic (one demo user at a time, not thousands of concurrent connections where the request overhead would start to matter).

**What would change this decision:** a genuinely real-time collaborative feature (multiple users watching the same run update live) or materially longer-running jobs (minutes, not tens of seconds) where 2-second polling latency actually degrades the experience would tip this toward SSE.

## 11.4 BackgroundTasks over Celery/RQ

**Context:** research runs and RAG indexing need to happen *after* the HTTP response returns, without blocking the request (see [3.4.1](./03-architecture.md#341-the-problem-3060s-pipeline-vs-http-timeouts)).

**Options considered:** FastAPI's built-in `BackgroundTasks` (in-process, no extra infrastructure); Celery or RQ (dedicated job queues, typically backed by Redis, running as separate worker processes).

**Chosen:** `BackgroundTasks`.

**Why:** a dedicated job queue earns its complexity when you need jobs to survive a web server crash/restart, run across multiple worker machines, retry automatically, or handle enough concurrent volume that a single process's background tasks would contend for resources. None of that describes this project's actual traffic. `BackgroundTasks` needs zero additional infrastructure — no Redis, no separate worker process to deploy, monitor, and pay for — which matters concretely on a free-tier hosting budget where a second service is a second thing to provision and (potentially) pay for.

**Tradeoff accepted:** a job is *not* durable across a server restart mid-flight — [4.1](./04-backend-walkthrough.md#41-mainpy)'s `recover_stuck_jobs()` startup hook exists specifically to clean up (mark failed) any job left `running`/`indexing` when the process died, rather than silently resuming or retrying it. There's also no true horizontal scaling story here — background tasks run on whatever single process handled the originating request.

**What would change this decision:** meaningful concurrent traffic (many simultaneous research runs contending for the same process's resources), a requirement that jobs survive a deploy/restart without being force-failed, or a move to multiple backend instances behind a load balancer (which `BackgroundTasks` doesn't coordinate across) would each independently justify the move to Celery/RQ.

## 11.5 SQLite over Postgres

**Context:** every structured record in this app (runs, sessions, queries, users) needs a database.

**Options considered:** SQLite (a single file, zero setup); Postgres (a real client-server RDBMS, industry-standard for production).

**Chosen:** SQLite.

**Why:** zero infrastructure to provision, configure, back up, or pay for — `DATABASE_URL=sqlite:///./researchmind.db` and the database is a file that exists the moment `Base.metadata.create_all()` runs. For this project's actual concurrency needs (a handful of requests at a time, not a production workload), SQLite's well-known single-writer limitation is a non-issue in practice.

**Tradeoff accepted:** no real concurrent-write scalability, no separate backup/replication story beyond "copy the file," and — concretely, on Render's free tier — the database doesn't even persist across a redeploy anyway (see [10.3.3](./10-deployment.md#1033-free-tier-constraints-512mb-ram-no-persistent-disk-15-min-sleep)), which somewhat blunts what a "real" database would have bought on that specific deployment target regardless.

**What would change this decision:** any actual production deployment with real users and data worth protecting — SQLite was never intended as this project's endpoint, just its adequate-for-now starting point. See [13.8](./13-extending-this-project.md#1338-migrating-sqlite--postgres) for the concrete migration path.

## 11.6 JSON column for step status over a separate steps table

Covered in full at [3.3.2](./03-architecture.md#332-the-steps-json-column--why-json-instead-of-a-separate-table). Summary: the four pipeline stages are a small, fixed, always-read-together set — a genuinely relational `research_run_steps` table would add joins and multi-row writes for data that's used as one cohesive unit everywhere it's read (`RunOut.steps: dict[str, StepStatus]`). The real cost is a SQLAlchemy-specific footgun — in-place mutation of the fetched dict isn't tracked, so every write path has to copy-modify-reassign the whole dict (`steps = dict(run.steps); ...; run.steps = steps`) rather than mutating a nested value directly.

## 11.7 MMR over plain similarity search

Covered in full at [2.6](./02-concepts-primer.md#26-retrieval-strategies) and [6.3.2](./06-rag-system.md#632-the-mmr-retriever-config-explained-with-a-worked-example). Summary: plain top-k similarity search on this project's actual test document (a technical paper that restates its central claims in the abstract, introduction, and conclusion) was observed to risk returning multiple near-duplicate chunks about the same narrow point, wasting retrieval budget on redundancy. MMR's diversity re-ranking (`lambda_mult=0.5`, balancing relevance against diversity) trades a small amount of pure-relevance ranking accuracy for broader coverage across the retrieved set. The tradeoff: MMR is a slightly more expensive retrieval operation (it fetches `fetch_k` candidates and re-ranks them, rather than just returning the top `k` directly) for a benefit that matters more on redundant/repetitive source documents than on tersely-written ones.

## 11.8 1000/200 chunk size and overlap

Covered in full at [2.5.4](./02-concepts-primer.md#254-why-this-project-uses-1000200-specifically) and [6.2.3](./06-rag-system.md#623-chunk-sizeoverlap-tradeoffs-with-concrete-examples). Summary: these are standard, widely-used starting values for `RecursiveCharacterTextSplitter`, not numbers empirically tuned against this project's own retrieval-quality metrics. 1000 characters balances "large enough to hold a complete idea" against "small enough that 4 retrieved chunks fit comfortably in the prompt alongside everything else"; 200 characters (20% overlap) catches most boundary-straddling ideas without excessively inflating the total chunk count. **What would change this decision:** the eval module's retrieval hit rate ([7.4.4](./07-evaluation-module.md#744-retrieval-hit-rate)) is the closest thing this project has to empirical grounds for revisiting these numbers — a systematically low hit rate across many questions, if observed at larger sample sizes than currently tested, would be the concrete signal to actually tune `chunk_size`/`chunk_overlap` rather than leave them at their defaults.

## 11.9 Per-session Chroma directories over one shared collection

Covered in full at [2.4.4](./02-concepts-primer.md#244-chromadb-specifically) and [6.2.5](./06-rag-system.md#625-persisting-to-a-per-session-chroma-directory--why-uuid-namespacing). Summary: a UUID-namespaced directory per RAG session (`backend/data/rag_indices/{session_id}/`) means complete physical isolation between sessions/documents — no shared collection to accidentally cross-contaminate, and deletion is a single `shutil.rmtree()`. The cost: this doesn't support "search across all your documents at once," which a single shared collection with a `session_id` metadata filter on every query would. **What would change this decision:** if this project grew a "persistent personal document library, ask questions across everything you've ever uploaded" feature (see [6.6](./06-rag-system.md#66-how-to-modify)'s multi-document note), the current one-directory-per-session model would need to become either a shared collection with metadata filtering, or an explicit cross-session query fan-out — the current isolation model doesn't naturally extend to that use case.

## 11.10 LLM-as-judge over embedding-similarity scoring

**Context:** the eval module needs to score subjective qualities of generated text (report depth, answer completeness) against some kind of reference, without a human reviewing every output.

**Options considered:** embedding-similarity scoring (embed the generated output and a reference answer, score by cosine similarity — a common, cheaper alternative); LLM-as-judge (a second LLM call scoring against an explicit rubric).

**Chosen:** LLM-as-judge, explicitly and deliberately over embedding-similarity — stated directly in this project's own eval-design instructions history as "LLM-as-judge, not embedding-similarity."

**Why:** embedding similarity measures *topical/semantic closeness* to a reference, not correctness, completeness, or structural quality — a report that's topically similar to a good reference but factually wrong, or poorly structured, or missing required sections, can still score highly on pure embedding similarity, because "sounds like it's about the same thing" and "is actually good" are different properties. An LLM judge, given an explicit rubric (see [7.3.1](./07-evaluation-module.md#731-the-rubrics-dissected)), can evaluate the specific dimensions this project actually cares about (does it have a sources section? is the answer faithful to retrieved context?) that a similarity score has no mechanism to check at all.

**Tradeoff accepted:** every judge call is itself an LLM call — costs real tokens/quota (competing directly with the systems under test for the same Groq daily budget — a real, encountered problem, see [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits)), and inherits the judge's own reliability ceiling (see [2.9.2](./02-concepts-primer.md#292-what-llm-as-judge-means-and-its-weaknesses)). Embedding similarity would have been near-free per call and infinitely more scalable, at the cost of measuring the wrong thing for this project's purposes.

## 11.11 Deterministic metrics computed in Python, not delegated to the judge

Covered in full at [2.9.3](./02-concepts-primer.md#293-deterministic-metrics-vs-judged-metrics) and [7.3.4](./07-evaluation-module.md#734-the-split-between-judged-subjective-and-computed-deterministic-metrics). Summary: `keyword_recall`, `retrieval_hit`, and `refused_correctly` are all exactly, mechanically computable from data already in hand (report text, retrieved page numbers, answer text) — asking the judge LLM to determine these instead would be strictly worse on every axis (slower, costs tokens, introduces a new possible source of error) for a question that has one unambiguous correct answer already checkable in code. This split is what makes any single metric in a scorecard either "exactly reproducible by anyone reading this code" or "necessarily the judge's subjective call" — never an ambiguous mix of both within one number.

## 11.12 Live-first eval with cached fallback

Covered in full at [7.5.1](./07-evaluation-module.md#751-live-first-with-cached-fallback) and [7.5.2](./07-evaluation-module.md#752-quota-detection-logic). Summary: a naive eval runner would show a wall of failed rows on `/evals` any time it happened to run during a Groq quota exhaustion window — which, given this project's real usage pattern, was observed to happen. The live-first-with-fallback design (try live, detect quota-specific failure via substring matching against known Groq error text, fall back to the most recent successfully-cached scorecard if ≥50% of items were quota-blocked) means the page a hiring manager might click always shows the most recent *genuine* result, honestly timestamped, rather than a snapshot of transient bad luck. The tradeoff: a cached scorecard can go stale if a real regression happens after the last successful live run — explicitly accepted as better than the alternative (a broken-looking page) and explicitly flagged as a real limitation in [7.7](./07-evaluation-module.md#77-limitations).

## 11.13 Removing torch/sentence-transformers

**Context:** this project originally used `sentence-transformers` for local, API-free embeddings. Render's free tier OOM-killed the backend container at its 512 MB RAM cap.

**Root-cause investigation:** `sentence-transformers` depends on `torch` (PyTorch) and `transformers`, both substantial packages — `torch`'s installed footprint alone (including, on some platforms, CUDA-related components pulled in as transitive dependencies even when no GPU is present or used) was the single largest contributor to both the Docker image size and the process's idle RAM footprint. Critically, **none of it was actually needed** — the live code paths use Groq (API-based chat) and Gemini (API-based embeddings) exclusively; nothing in the request-serving code ever loads or runs a local model. `sentence-transformers` was dead weight for the app's actual runtime behavior, present only because of how the RAG embedding step had been originally wired.

**Options considered:** upgrade to a paid Render tier with more RAM (removes the constraint without removing the dependency); optimize `torch`'s install (e.g. force a CPU-only build, smaller than the default) to reduce its footprint without removing it entirely; remove `sentence-transformers`/`torch`/`transformers` entirely, since the Gemini embeddings API this project already uses for indexing makes the local embedding model fully redundant.

**Chosen:** full removal.

**Why:** the paid-tier option doesn't fix the underlying problem (an unnecessary dependency), just buys headroom for it; a CPU-only `torch` build still leaves a genuinely large, genuinely unused dependency in the image. Since the RAG system already exclusively used Gemini's embeddings API (see [2.3.4](./02-concepts-primer.md#234-which-embedding-model-this-project-uses-and-why)) for its actual indexing/querying, `sentence-transformers` had no live call site left to justify keeping it — it was purely inherited weight.

**Measured result:** backend Docker image size dropped from **2.9 GB to 240 MB** (via `docker image inspect`, the accurate single-platform figure); idle container RAM dropped from roughly **800 MB to 160 MB** (via `docker stats`) — comfortably clearing the 512 MB Render free-tier ceiling with real margin.

**Tradeoff accepted:** none, functionally — every live code path already used the Gemini API exclusively, so this removal changed zero runtime behavior for any actual feature. The only real cost was deleting a few standalone, never-wired-in demo scripts (`backend/rag/retrievers/mmr.py`, `multiquery.py`, `arxiv.py`) that *did* reference `sentence-transformers`/local-embedding patterns, since they were exploratory code, not part of the live API, and had no reason to keep a heavy dependency alive on their behalf.

**What would change this decision:** a future feature that genuinely needs a local model (offline inference, no network dependency, or a model unavailable via any API) would need to reintroduce this class of dependency deliberately, ideally in a way that doesn't bloat the *default* deployed image — e.g. an optional extra, not a base requirement.

## 11.14 Auth built but not wired

Covered in full at [08-auth-system.md](./08-auth-system.md#82-why-its-not-wired-to-the-frontend). Summary: research/RAG shipped single-user first; a complete, working JWT auth system was built afterward as its own subsystem, but integrating it (adding `user_id` foreign keys, requiring auth on every route, filtering every query, building login UI) was deliberately deferred rather than half-done under time pressure. The reasoning: finishing every AI feature to a demonstrably working state was judged higher priority than partially wiring auth into a project where every remaining integration step is well-understood, mechanical work — not a research problem — that can be picked up cleanly later (see [8.7](./08-auth-system.md#87-how-to-wire-it-to-the-frontend-if-someone-wants-to) for the exact steps).

## 11.15 Docker single-stage backend, two-stage frontend

**Context:** both the backend and frontend needed Dockerfiles; they don't have to follow the same build-stage pattern.

**Chosen:** backend is single-stage (`python:3.12-slim`, install deps, copy code, run); frontend is two-stage (Node builder → nginx runtime — see [10.2.2](./10-deployment.md#1022-the-frontend-dockerfile--the-two-stage-build-explained)).

**Why the difference:** the backend's *runtime* environment (Python + all its installed packages) **is** what it needs to actually run the app — there's no separate "build artifact" smaller than the full dependency-installed environment; a multi-stage build wouldn't discard anything, since the running process needs `langchain`, `chromadb`, etc. present at runtime, not just at some earlier build step. The frontend's situation is structurally different: its *build* tooling (Node, `npm`, every dev dependency) is completely unnecessary once the static HTML/CSS/JS output exists — a two-stage build discards a large, genuinely unneeded build environment, which is exactly why the frontend's shipped image (tens of MB) is so much smaller than the backend's (hundreds of MB even after the `torch` removal in [11.13](#1113-removing-torchsentence-transformers), since ChromaDB/LangChain's remaining dependency tree is still substantial).

**Tradeoff accepted:** none really — a multi-stage backend build was explicitly considered and rejected as adding complexity with no size benefit, given the constraint above. This isn't a case of "should have been more sophisticated" so much as "the two services have genuinely different shapes, and each Dockerfile matches its own shape."

---

**Next:** [12-known-issues-and-gotchas.md](./12-known-issues-and-gotchas.md) — the honest list of what's actually gone wrong, and how to recognize it again.
