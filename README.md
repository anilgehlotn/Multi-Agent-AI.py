# ResearchMind

Multi-agent research pipeline + RAG PDF Q&A, with LLM-as-judge evaluation.
Built with FastAPI, LangChain, React, Groq, Gemini, ChromaDB.

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=061620)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## Live Demo

- **Frontend:** https://multi-agent-ai-py.vercel.app
- **API health check:** https://researchmind-backend-qv2t.onrender.com/health
- **Evaluations scorecard:** https://multi-agent-ai-py.vercel.app/evals

> Backend runs on Render's free tier — first request after ~15 minutes of inactivity takes ~30–60 seconds to wake up. Subsequent requests are instant.

## Screenshots

| Research Agent | Book Q&A (RAG) |
|---|---|
| ![Research tab with a completed run](./docs/screenshots/research-tab.png) | ![RAG tab with an answered question](./docs/screenshots/rag-tab.png) |

| Evaluations | History |
|---|---|
| ![Evals scorecards](./docs/screenshots/evals.png) | ![History page](./docs/screenshots/history.png) |

## Features

**Research Pipeline**
- 4-agent orchestration: Search → Reader → Writer → Critic
- Tavily web search + BeautifulSoup scraping
- Live polling of per-step status from a FastAPI BackgroundTask
- Full report + critic feedback stored per run

**RAG PDF Q&A**
- Upload any PDF, indexed with Gemini embeddings + ChromaDB (MMR retrieval)
- Grounded answers with source page + snippet
- Per-session Q&A history, cleanly namespaced on disk

**Evaluation Module**
- LLM-as-judge scoring on gold datasets (5 research topics, 8 Q&A pairs)
- Live-first with graceful fallback to cached results on API quota exhaustion (`python -m evals.run all`)
- Scorecards visible in the app at `/evals`

**Production concerns**
- Auth system (JWT, SQLite/SQLAlchemy) — implemented but not wired to the frontend yet
- Dockerized (backend + frontend + compose)
- Deployed on Render (backend) + Vercel (frontend), auto-deploy on push
- Configurable CORS, environment-var startup checks, health + warmup endpoints

## Architecture

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

A research request flows like this: the user submits a topic → FastAPI creates a `ResearchRun` row (`status=pending`) → a `BackgroundTask` runs the 4-agent chain, updating per-step statuses in a JSON column as it goes → the frontend polls `/research/history/{id}/status` every 2s → once status flips to `completed`, the UI fetches and renders the full markdown report. The RAG flow follows the same "create row → background job → poll → render" shape, just with PDF indexing instead of the agent chain.

| Layer      | Choice                                          |
|------------|--------------------------------------------------|
| Backend    | FastAPI, Python 3.12                            |
| LLM        | Groq (Llama 3.3 70B)                            |
| Embeddings | Google Gemini (`models/gemini-embedding-001`)   |
| Vector DB  | ChromaDB (per-session persist directories)      |
| Web search | Tavily                                          |
| Agents     | LangChain `create_agent` + prompt chains        |
| Auth       | SQLAlchemy + bcrypt + python-jose (JWT)         |
| Frontend   | React + Vite + react-router + react-markdown    |
| Deploy     | Docker, Render (backend), Vercel (frontend)     |

## Getting Started

Prereqs: Python 3.12, Node 20+, Docker (optional).

### Backend
```bash
cp .env.example .env
# fill in GROQ_API_KEY, GOOGLE_API_KEY, TAVILY_API_KEY, JWT_SECRET_KEY
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
# → http://localhost:8000
```
Note: `chromadb`'s dependency chain currently has no wheels for Python 3.14 — use Python 3.11–3.12 for the backend venv if `pip install chromadb` fails.

### Frontend
```bash
cd frontend
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev
# → http://localhost:5173
```

### Docker (both at once)
```bash
docker compose up --build
# frontend on :5173, backend on :8000
```

## Evaluation — how to run

```bash
cd backend
python -m evals.run all                     # both research + rag
python -m evals.run research --limit 2      # quick smoke test
python -m evals.run all --replay            # render latest cached scorecard, no live API calls
```

Results are saved to `backend/evals/results/*.json`. The `/evals` page in the app renders the latest cached scorecard, with a live-first / cached-fallback strategy so it always shows real numbers even during a Groq quota exhaustion.

## Deploy

Backend on [Render](https://render.com) (free tier, Docker), frontend on [Vercel](https://vercel.com) (free tier, static). Both build from `main` via GitHub — point Render at `render.yaml` and Vercel at `frontend/vercel.json`.

> Render's free tier has no persistent disk and sleeps after 15 min idle — the SQLite DB resets on every redeploy/restart, and the first request after sleeping takes ~30–60s to wake up. Acceptable for a demo link; not for real data.

### Backend (Render)
1. Fork this repo
2. On Render: **New → Blueprint** → connect this repo → **Apply** (Render reads `render.yaml` from the project root and creates the service)
3. In the Render dashboard, fill in the env vars marked `sync: false`: `GROQ_API_KEY`, `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `MISTRAL_API_KEY` (optional), and later `CORS_ORIGINS`
4. Copy the `*.onrender.com` URL Render gives you once the service is live

### Frontend (Vercel)
1. On Vercel: **Add New → Project** → import this repo
2. Root directory: `frontend`
3. Framework: Vite (auto-detected via `vercel.json`)
4. Environment variables: `VITE_API_BASE_URL` = your Render backend URL from above
5. Deploy
6. Copy the `*.vercel.app` URL Vercel gives you

### After both are deployed
Go back to the Render dashboard and set `CORS_ORIGINS` on the backend service to your Vercel URL (e.g. `https://your-app.vercel.app`), then redeploy the backend. Until this step, the deployed frontend's requests will fail CORS even though both services are individually up.

## Project Structure

```
backend/
  main.py          FastAPI app
  config.py        env-var settings
  agents/          research pipeline (Search/Reader/Writer/Critic)
  rag/             document loaders + Chroma retrievers
  rag_api/         RAG upload/index/ask endpoints
  research/        research run/history endpoints
  evals/           LLM-as-judge evaluation (datasets, judges, runner)
  auth/            JWT signup/login (implemented, unwired)
  db/              SQLAlchemy models + session
frontend/
  src/
    pages/         Dashboard, History, EvalsPage, detail pages
    components/     Navbar, PipelineSteps, RagTab, ...
    lib/            api.js, usePolling, format, storage
render.yaml        Render Blueprint
docker-compose.yml local full-stack orchestration
```

## Design Decisions

- **Groq over Gemini for chat** — free-tier reliability + speed matters more than the marginal quality gap for a demo. Gemini kept for embeddings (Groq doesn't offer them).
- **Live-first eval with cached JSON fallback** — means the `/evals` page always shows real numbers even during API quota exhaustion, instead of an error or stale mock data.
- **BackgroundTasks + polling instead of SSE/WebSockets** — simpler, no connection-drop handling, cheaper on Render's free tier.
- **Per-session ChromaDB persist dirs (UUID-namespaced)** — trivial cleanup, no cross-session contamination.
- **LLM-as-judge with explicit rubric + deterministic sub-metrics** (keyword recall, retrieval hit rate) — don't let the judge score what code can already verify.
- **Dependency trimming** (removed `torch`/`sentence-transformers`, unused since the app only calls Groq/Gemini APIs, never a local model) — took the backend Docker image from 2.9GB → 240MB and idle RAM from ~800MB → 160MB, which is what actually fits Render's free-tier 512MB limit.
- **No fake progress bars** — the pipeline UI reflects real per-step DB state, not a simulated timer.

## What's Not Built Yet

- Auth endpoints exist but the frontend is single-user for now
- No streaming — polling only
- SQLite (fine for a demo; would swap for Postgres in production)
- No CI (GitHub Actions could run the evals as a check on PRs)
- No observability (would add Langfuse or similar in production)
- Free-tier limits apply: Render sleeps after 15 min idle, Groq has a daily token cap

## License & Credits

MIT — see [LICENSE](./LICENSE).

Built on top of [LangChain](https://www.langchain.com/), [Groq](https://groq.com/), [Google AI](https://ai.google.dev/) (Gemini), and [Tavily](https://tavily.com/).
