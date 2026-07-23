# 14. Glossary

Every technical term used anywhere in this project or these docs, alphabetical, one or two plain sentences each. See the linked section for the full explanation where one exists.

**Agent** — an LLM given access to tools it can choose to call, in a loop, so the sequence of steps isn't fixed in advance the way a chain's is. See [2.7](./02-concepts-primer.md#27-ai-agents).

**API key** — a secret string that authenticates your application to a third-party service (Groq, Gemini, Tavily) instead of a username/password — whoever holds it can make requests billed/attributed to that account, so it's kept in `.env` files and environment variables, never committed to source control.

**Background task** — work scheduled to run after an HTTP response has already been sent, in the same server process, so a slow operation doesn't block the client waiting for a reply. This project uses FastAPI's `BackgroundTasks` specifically — see [3.4](./03-architecture.md#34-why-asyncbackground-tasks).

**bcrypt** — a slow-by-design password-hashing algorithm, used here (via `passlib`) to store passwords irreversibly. See [8.3](./08-auth-system.md#83-password-hashing).

**Bearer token** — an access token (here, a JWT) sent in an HTTP `Authorization: Bearer <token>` header to prove a request is authenticated — "bearer" because possessing the token alone is enough to use it, no additional proof required.

**Cascade delete** — when deleting one database row automatically deletes related rows in another table (e.g. deleting a `RagSession` deletes its `RagQuery` rows). See [3.3.3](./03-architecture.md#333-relationships-and-cascade-behavior) for why this project's cascade only works through the ORM, not the raw database.

**Chain** — a fixed, predetermined sequence of steps (typically prompt → LLM → output parser) with no branching or tool use, as opposed to an agent. See [2.8](./02-concepts-primer.md#28-chains).

**ChromaDB (Chroma)** — the open-source vector database this project uses, chosen for needing zero external infrastructure (persists straight to a local directory). See [2.4.4](./02-concepts-primer.md#244-chromadb-specifically).

**Chunk** — one piece of a document after it's been split up for embedding/retrieval — small enough to embed meaningfully and fit in a prompt, large enough to contain a coherent idea.

**Chunking** — the act of splitting a document into chunks; see [2.5.3](./02-concepts-primer.md#253-why-chunking-matters-and-what-chunk_sizechunk_overlap-actually-do).

**Cold start** — the delay before a sleeping/scaled-to-zero server can respond to a request, because the platform has to actually boot the container first. This project's Render backend experiences a ~30–60s cold start after 15 minutes of inactivity.

**Collection** — Chroma's name for a named group of vectors + metadata, roughly analogous to a database table. See [2.4.4](./02-concepts-primer.md#244-chromadb-specifically).

**CORS (Cross-Origin Resource Sharing)** — a browser security mechanism that blocks a webpage from one origin (domain) from making requests to a different origin unless that origin's server explicitly allows it. See [10.5](./10-deployment.md#105-the-cors-handshake-between-the-two--why-its-a-separate-step).

**Cosine similarity** — a measure of how similar two vectors are, based on the angle between them rather than their length. See [2.4.3](./02-concepts-primer.md#243-cosine-similarity-in-plain-english).

**Dependency injection** — a pattern where a function declares what it needs (e.g. a database session) as a parameter, and a framework (FastAPI's `Depends(...)`) supplies it automatically at call time, rather than the function constructing it itself.

**Docker** — a tool for packaging an application and everything it needs to run (dependencies, runtime, config) into a single portable "image," so it runs identically regardless of the host machine. See [10.2](./10-deployment.md#102-docker).

**Embedding** — a list of numbers produced by a model that represents a piece of text's meaning, such that similar-meaning text produces numerically close lists. See [2.3](./02-concepts-primer.md#23-embeddings).

**Endpoint** — a specific URL path + HTTP method combination a server responds to (e.g. `POST /research/run`).

**FastAPI** — the Python web framework this project's backend is built on; async-native, validates requests/responses automatically via Pydantic.

**fetch_k** — in MMR retrieval, how many candidate chunks to pull via plain similarity search before re-ranking for diversity. See [2.6.3](./02-concepts-primer.md#263-what-k-fetch_k-and-lambda_mult-mean-with-a-concrete-example).

**Foreign key** — a column in one database table that references another table's primary key, establishing a relationship between rows (e.g. `RagQuery.session_id` references `RagSession.id`).

**Gold dataset** — a set of test inputs paired with known-correct/expected answers, used as a fixed benchmark. See [2.9.4](./02-concepts-primer.md#294-what-a-gold-dataset-is).

**Grounding** — an LLM's answer being derived from specific provided source material rather than its general training knowledge. See [2.5.5](./02-concepts-primer.md#255-what-grounding-means-and-how-the-prompt-enforces-it).

**Hallucination** — an LLM generating fluent, confident-sounding, but false or fabricated content, because nothing in its mechanism distinguishes "statistically plausible" from "true." See [2.1.1](./02-concepts-primer.md#211-what-an-llm-actually-is).

**HMAC** — a keyed hash function used to produce a JWT's signature, proving the token's contents haven't been tampered with by anyone lacking the signing secret. See [8.4](./08-auth-system.md#84-jwt--what-a-token-actually-contains-how-signing-works-why-stateless-auth-means-logout-is-a-no-op).

**JSON (JavaScript Object Notation)** — a text format for structured data (`{"key": "value"}`), used throughout this project for API payloads, the `steps` database column, and the eval judges' output format.

**JWT (JSON Web Token)** — a signed, stateless token format used for authentication — three base64-encoded parts (header, payload, signature) joined by dots. See [8.4](./08-auth-system.md#84-jwt--what-a-token-actually-contains-how-signing-works-why-stateless-auth-means-logout-is-a-no-op).

**k** — in retrieval, how many chunks to actually return to the LLM as context, after any re-ranking (e.g. MMR). See [2.6.3](./02-concepts-primer.md#263-what-k-fetch_k-and-lambda_mult-mean-with-a-concrete-example).

**Judge (LLM-as-judge)** — a second LLM call used to score another LLM's output against a rubric. See [2.9.2](./02-concepts-primer.md#292-what-llm-as-judge-means-and-its-weaknesses).

**lambda_mult** — MMR's relevance/diversity balance dial, 0 to 1 (1 = pure relevance, 0 = maximize diversity). See [2.6.3](./02-concepts-primer.md#263-what-k-fetch_k-and-lambda_mult-mean-with-a-concrete-example).

**LangChain** — the Python framework this project uses for LLM orchestration — agent construction (`create_agent`), prompt templating, chain composition (LCEL), and provider-agnostic model/embedding wrappers.

**LCEL (LangChain Expression Language)** — LangChain's `|`-based syntax for composing pipeline stages (prompt, model, parser) into a chain. See [2.8.1](./02-concepts-primer.md#281-what-lcel-the--pipe-syntax-is-doing).

**LLM (Large Language Model)** — a model trained to predict the next token in a sequence of text, at a scale that produces fluent, general-purpose text generation. See [2.1.1](./02-concepts-primer.md#211-what-an-llm-actually-is).

**Migration (database)** — a versioned, incremental change to a database schema, typically managed by a tool like Alembic. This project has none — schema changes rely on `create_all()`, which only creates missing tables, never alters existing ones.

**MMR (Maximal Marginal Relevance)** — a retrieval strategy that re-ranks candidate results for diversity, not just pure relevance, to avoid returning several near-duplicate chunks. See [2.6.2](./02-concepts-primer.md#262-mmr-maximal-marginal-relevance-in-plain-english).

**OAuth2PasswordBearer** — a FastAPI security utility that extracts a bearer token from an incoming request's `Authorization` header, used here as part of `get_current_user`. See [8.5](./08-auth-system.md#5-the-get_current_user-dependency-pattern).

**OOM (Out Of Memory)** — when a process is force-killed by the operating system (or a hosting platform) for exceeding its allowed memory. See [12.5](./12-known-issues-and-gotchas.md#125-render-free-tier-oom-at-512mb).

**ORM (Object-Relational Mapper)** — a library (SQLAlchemy, here) that lets you interact with a database using Python objects/classes instead of writing raw SQL directly.

**Persist directory** — the on-disk folder path where a Chroma vector index is written and can be reloaded from later. See [2.4.4](./02-concepts-primer.md#244-chromadb-specifically).

**Polling** — repeatedly asking a server "has anything changed?" on a fixed interval, as opposed to the server pushing updates. See [3.4.3](./03-architecture.md#343-the-polling-contract-between-frontend-and-backend).

**Prompt** — the text sent as input to an LLM. See [2.2.1](./02-concepts-primer.md#221-what-a-prompt-is).

**Prompt template** — a prompt with placeholders filled in at call time, rather than being built with ad hoc string concatenation. See [2.2.3](./02-concepts-primer.md#223-prompt-templates-and-why-not-just-concatenate-strings).

**Pydantic** — the Python data-validation library FastAPI uses for request/response schemas — declares expected shapes as classes, validates/parses incoming data against them automatically.

**Quota** — a usage cap imposed by an API provider (e.g. Groq's 100,000-tokens-per-day free-tier limit) — distinct from a rate limit in that it resets on a longer, fixed cycle (daily) rather than a rolling short window. See [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits).

**RAG (Retrieval-Augmented Generation)** — answering questions by retrieving relevant source material and pasting it into the prompt as context, rather than relying on an LLM's trained-in knowledge. See [2.5](./02-concepts-primer.md#25-rag-retrieval-augmented-generation).

**Rate limit** — a cap on how many requests/tokens can be used in a short, typically rolling, time window (e.g. per minute) — as distinct from a longer-cycle quota. See [2.1.2](./02-concepts-primer.md#212-what-a-token-is-and-why-it-matters).

**Reranking** — retrieving a larger candidate set cheaply, then using a second, more accurate (and more expensive) model to re-score and reorder it. See [2.6.5](./02-concepts-primer.md#265-other-strategies-that-exist-and-why-theyre-not-used-here).

**Retrieval** — the act of searching a vector database for the chunks most relevant to a query.

**Retriever** — the object/interface responsible for performing retrieval, configured with a strategy (e.g. `search_type="mmr"`) and parameters (`k`, `fetch_k`, `lambda_mult`).

**Salt** — random data mixed into a password before hashing, unique per password, so identical passwords don't produce identical hashes. See [8.3](./08-auth-system.md#83-password-hashing).

**Semantic search** — search based on meaning (via embeddings) rather than exact keyword matching.

**SPA (Single-Page Application)** — a web app that loads one HTML shell and then handles all navigation client-side via JavaScript (here, `react-router-dom`), rather than requesting a new page from the server on every navigation. See [10.4.1](./10-deployment.md#1041-verceljson-the-spa-rewrite-and-why-its-needed-for-react-router).

**SSE (Server-Sent Events)** — a protocol for a server to push updates to a browser over a long-lived HTTP connection, one-directional (server → client only). Considered and not used in this project — see [11.3](./11-design-decisions.md#113-polling-over-ssewebsockets).

**SQLAlchemy** — the Python ORM this project uses to define database models (`db/models.py`) and interact with SQLite.

**System prompt** — the message that sets an LLM's persona/behavior for a whole conversation, as distinct from the specific per-turn human/user message. See [2.2.2](./02-concepts-primer.md#222-system-prompt-vs-human-prompt).

**Temperature** — a parameter controlling how random an LLM's token choices are; 0 means always pick the most likely token. See [2.1.3](./02-concepts-primer.md#213-temperature-and-why-this-project-uses-0-for-most-things).

**Token** — the actual unit of text an LLM reads/generates — roughly a word or word-fragment, not a whole word or a single character. See [2.1.2](./02-concepts-primer.md#212-what-a-token-is-and-why-it-matters).

**Tool calling** — the mechanism by which an LLM requests that a specific function be executed with specific arguments, which your code then actually runs. See [2.7.2](./02-concepts-primer.md#272-tool-calling-mechanically).

**TPD (Tokens Per Day)** — Groq's daily token usage cap on its free tier (100,000), distinct from and in addition to any per-minute rate limit. See [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits).

**Vector** — a list of numbers; in this project, always the output of an embedding model representing a piece of text's meaning.

**Vector database** — a database purpose-built for storing vectors and answering "which stored vectors are closest to this one?" efficiently. See [2.4](./02-concepts-primer.md#24-vector-databases).

**WebSocket** — a protocol for a persistent, bidirectional connection between browser and server. Considered and not used in this project — see [11.3](./11-design-decisions.md#113-polling-over-ssewebsockets).

---

**Back to:** [docs/README.md](./README.md) for the full documentation index.
