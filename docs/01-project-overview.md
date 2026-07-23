# 1. Project Overview

## 1.1 What this project is, in plain English

ResearchMind is a web application with two independent AI-powered tools behind one login-free interface:

1. Type in any topic, and four AI agents cooperate to search the web, read the most promising source in depth, write a structured report, and critique their own work — all visible in real time as it happens.
2. Upload any PDF, and ask it questions in plain English — the answers come only from that document, with page references, not from the AI's general knowledge.

A third piece, less visible but arguably the most technically substantial part of the project, continuously *measures* how well both of those systems actually perform, using a second AI model as an automated grader against a fixed, hand-built test set — and displays the results in the app itself at `/evals`.

## 1.2 What problem each half solves

### 1.2.1 The research pipeline problem

Manually researching an unfamiliar topic — search, skim several sources, cross-reference, synthesize, write up findings — takes real time and requires you to already know how to judge source quality and structure a summary. The research pipeline automates that workflow end-to-end: given only a topic string, it finds current information, reads one source in depth, writes an organized report (introduction, findings, conclusion, sources), and then critiques its own report for quality — surfacing strengths and weaknesses the way a peer reviewer would, before you've spent any time reading it yourself.

### 1.2.2 The RAG PDF Q&A problem

Reading a long, dense PDF (a paper, a manual, a contract) to find one specific answer is slow, and plain-text search (`Ctrl+F`) only finds exact word matches — it's useless if you don't know the document's exact phrasing. The RAG system solves both problems: it indexes the document by *meaning* (not exact words, see [2.3](./02-concepts-primer.md#23-embeddings)), so a question can be answered even if it's phrased completely differently from the source text, and it answers *strictly* from that document's actual content — refusing to answer, rather than guessing, when the document doesn't cover something.

## 1.3 What you can actually do with it

- Submit a research topic and watch four pipeline stages (Search → Reader → Writer → Critic) update live, then read the final report and the AI's self-critique of it.
- Browse a history of every past research run, revisit any completed report.
- Upload a PDF, wait for it to index, then have a back-and-forth Q&A conversation with it — each answer shows which page(s) it drew from, with an expandable snippet.
- Browse a history of every uploaded PDF and its past Q&A log.
- Visit `/evals` and see real, current scorecards for both systems — not a marketing claim, an actual measured scorecard from the last time the eval suite ran, including honest "this failed" rows when things failed.
- (Built, not exposed in the UI) Sign up, log in, and get a JWT — see [1.4](#14-what-it-is-not) and [08-auth-system.md](./08-auth-system.md) for why this exists but isn't wired up yet.

## 1.4 What it's NOT

Being upfront about scope, so expectations are set correctly:

- **Not multi-user in practice.** Every research run and every RAG session is visible to anyone who opens the app — there's no per-user data isolation today, even though the auth system that *could* provide it is fully implemented (see [08-auth-system.md](./08-auth-system.md)).
- **Not a production system.** SQLite, no database migrations, no rate limiting, no CI, no monitoring/alerting. It's built to demonstrate the underlying AI engineering clearly, not to survive real production traffic or real adversarial users.
- **Not persistent on the live demo.** The hosted backend (Render free tier) has no persistent disk — every redeploy wipes the database and any uploaded PDFs. Fine for a demo link; not a place to store anything you care about.
- **Not real-time/streaming.** Both AI systems respond via polling (the frontend asks "are you done yet?" every couple of seconds), not token-by-token streaming — see [4](./03-architecture.md#34-why-asyncbackground-tasks) for why.
- **Not multi-document RAG.** Each RAG session is exactly one PDF; there's no cross-document search or a persistent personal document library.
- **Not perfectly grounded.** The RAG system is instructed, via its prompt, to answer only from the provided document — it is not code-level guaranteed to do so. The eval module exists specifically to *measure* how well that instruction holds up (see [2.9.5](./02-concepts-primer.md#295-why-the-adversarial-test-cases-exist)), not to assert it's flawless.

## 1.5 The complete tech stack, and why each piece was chosen

| Piece | Choice | One-line reason |
|---|---|---|
| Backend framework | FastAPI | Async-native, automatic request/response validation via Pydantic, and generates its own OpenAPI docs for free |
| Backend language | Python 3.12 | Required by the AI/ML ecosystem this project depends on (LangChain, ChromaDB); 3.12 specifically because `chromadb`'s dependency chain has no wheels for 3.14 yet (see [12.10](./12-known-issues-and-gotchas.md#1210-chromadb-has-no-wheels-for-python-314)) |
| Database | SQLite + SQLAlchemy | Zero setup, a single file, more than sufficient at this project's scale — see [11.5](./11-design-decisions.md#115-sqlite-over-postgres) |
| Chat LLM | Groq (Llama 3.3 70B) | Free tier that's fast and reliable enough for a live demo — see [11.1](./11-design-decisions.md#111-groq-for-chat-gemini-for-embeddings) |
| Embeddings | Google Gemini (`gemini-embedding-001`) | Groq has no embeddings API at all; Gemini's is free-tier accessible and avoids the RAM cost of a local embedding model — see [2.3.4](./02-concepts-primer.md#234-which-embedding-model-this-project-uses-and-why) |
| Agent/chain orchestration | LangChain (`create_agent`, LCEL chains) | Standard tool-calling agent loop and prompt-composition syntax, so this project doesn't hand-roll either — see [2.7.4](./02-concepts-primer.md#274-what-langchains-create_agent-gives-you) |
| Vector database | ChromaDB | Zero external infrastructure — persists straight to a local directory, no server to run or pay for — see [2.4.5](./02-concepts-primer.md#245-alternatives-and-their-tradeoffs) |
| Web search | Tavily | An API purpose-built for LLM-agent web search (returns clean titles/URLs/snippets, not raw HTML) |
| Web scraping | BeautifulSoup + `requests` | Simple, dependency-light HTML-to-text extraction; no JS-rendering needed for this project's use case |
| PDF parsing | `pypdf` (via LangChain's `PyPDFLoader`) | Straightforward text + page-number extraction, which is exactly what page-cited RAG answers need |
| Auth | SQLAlchemy `User` model + `passlib`(bcrypt) + `python-jose` (JWT) | Standard, well-understood building blocks for password hashing and stateless token auth — see [08-auth-system.md](./08-auth-system.md) |
| Frontend framework | React 19 + Vite | Fast dev server, standard component model, wide ecosystem familiarity |
| Frontend routing | `react-router-dom` | Client-side routing for a single-page app with several distinct views |
| Frontend markdown | `react-markdown` | Research reports and RAG answers come back as markdown-ish text; needs rendering, not raw display |
| Styling | Tailwind CSS v4 | Utility-first styling, fast iteration, no separate CSS-file sprawl |
| Containerization | Docker (single-stage backend, two-stage frontend) | Consistent local/deploy environments; the frontend's two-stage build keeps the shipped image to just static files + nginx — see [10.2](./10-deployment.md#102-docker) |
| Backend hosting | Render (free tier) | Docker-native, git-push deploys, a real (if sleepy) always-on-ish URL for a resume link — see [10.3](./10-deployment.md#103-render-deployment) |
| Frontend hosting | Vercel (free tier) | Effectively the industry-standard for static/Vite frontend hosting; instant deploys |

## 1.6 How long it took to build, and what the constraints were

This project was built by directing an AI coding assistant (Claude Code) across a series of focused work sessions, each covering one coherent slice of the system — the core research and RAG APIs, then the frontend, then auth, then the evaluation module, then containerization, then cloud deployment, then dependency/cost trimming, then these docs. The exact wall-clock time isn't tracked anywhere in the repo, so it isn't stated here as a number — see the rule against invented numbers in this doc set's own writing standard.

The two constraints that shaped the most decisions, repeatedly, across the whole build:

- **Free-tier hosting limits.** Render's free tier caps a container at 512 MB RAM with no persistent disk and a 15-minute sleep timer. This single constraint is directly responsible for: choosing API-based embeddings over a local model ([2.3.4](./02-concepts-primer.md#234-which-embedding-model-this-project-uses-and-why)), the entire dependency-trimming pass that removed `torch`/`sentence-transformers` ([11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)), and the decision to accept that the live demo's data doesn't survive a redeploy ([1.4](#14-what-it-is-not)).
- **Groq's free-tier daily token quota (100,000 TPD).** This directly shaped the evaluation module's most distinctive engineering feature — a live-first eval runner that automatically falls back to the last successfully cached scorecard when the API quota is exhausted, so `/evals` never shows a blank error page just because a quota reset hasn't happened yet (see [7.5.1](./07-evaluation-module.md#751-live-first-with-cached-fallback)).

---

**Next:** [02-concepts-primer.md](./02-concepts-primer.md) if you need the underlying AI concepts explained from scratch, or [03-architecture.md](./03-architecture.md) if you're already comfortable with them and want to see how the system fits together.
