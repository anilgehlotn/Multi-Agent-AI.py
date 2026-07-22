# ResearchMind — Multi-Agent Research + RAG PDF Q&A

A FastAPI backend wrapping two AI systems — a 4-agent research pipeline that searches, scrapes, writes, and critiques reports on any topic, and a RAG-based PDF Q&A engine for grounded document question-answering — with a React frontend on top.

## 🧱 Architecture

Two independent pipelines served through a single FastAPI app, backed by SQLite:

### 1. Research Pipeline (async, DB-backed)
```
Topic → Search Agent → Reader Agent → Writer Chain → Critic Chain → Report
```
Runs as a FastAPI `BackgroundTask`; each run is a `research_runs` row the frontend polls until it reaches `completed`/`failed`.

### 2. RAG PDF Q&A (async, session-based)
```
PDF Upload → Chunk & Embed (Gemini) → ChromaDB (persisted per session) → MMR Retrieval → LLM Answer
```
Each upload creates a `rag_sessions` row and its own on-disk Chroma index; questions and answers are logged to `rag_queries`.

## 🤖 Agents & Chains

| Component | Role | Model |
|---|---|---|
| **Search Agent** | Finds recent, reliable info on the topic | `web_search` (Tavily API) + Gemini |
| **Reader Agent** | Picks the most relevant URL, scrapes deeper content | `scrape_url` (BeautifulSoup) + Gemini |
| **Writer Chain** | Drafts a structured report (Intro / Findings / Conclusion / Sources) | Gemini |
| **Critic Chain** | Scores and critiques the report with strengths/improvements | Gemini |
| **RAG Q&A** | Answers questions strictly from retrieved PDF context | Gemini |

`backend/rag/retrievers/multiquery.py` and `mmr.py` are standalone retrieval demos kept on Mistral/HuggingFace — not part of the live API.

## 🧰 Tech Stack

**Backend:** FastAPI, SQLAlchemy 2.x + SQLite, LangChain (`create_agent`, chains via `ChatPromptTemplate` + `StrOutputParser`), `langchain-google-genai` (Gemini chat + embeddings), ChromaDB, Tavily, BeautifulSoup, PyPDFLoader.

**Frontend:** React 19 + Vite, Tailwind CSS v4, `react-router-dom`, `react-markdown`.

**Auth:** A full JWT auth system (signup/login/me/logout, bcrypt, SQLAlchemy `User` model) is implemented in `backend/auth/` and mounted at `/auth/*`, but it is **not wired into the research/RAG routes** — the app currently runs single-user with those endpoints unprotected. Wiring it up (per-user history, protected routes) is a planned next step.

## 📁 Project Structure

```
backend/
  main.py                    # FastAPI app entry
  config.py                  # env vars via pydantic-settings
  db/                        # SQLAlchemy engine/session + models (User, ResearchRun, RagSession, RagQuery)
  auth/                      # JWT auth (implemented, not wired into research/RAG routes)
  agents/                    # research_agents.py, pipeline.py, tools.py
  research/                  # research schemas/service/router (/research/*)
  rag_api/                   # RAG schemas/service/router (/rag/*)
  rag/                       # retrieval demos (multiquery, mmr, arxiv) + standalone create_database.py
  data/                      # uploaded PDFs + per-session Chroma indices (gitignored)
frontend/
  src/
    components/              # Navbar, Research + RAG tab components, shared UI (ErrorBanner, ConfirmModal, StatusPill)
    pages/                   # Dashboard, History, ResearchRunDetail, RagSessionDetail
    lib/                     # api.js, usePolling.js, format.js, storage.js
```

## 🚀 Getting Started

### Backend
```bash
cd backend
uv venv && uv pip install -r requirements.txt   # or pip install -r requirements.txt
cp .env.example .env   # fill in GOOGLE_API_KEY, TAVILY_API_KEY, JWT_SECRET_KEY
uvicorn main:app --reload --port 8000
```
Note: `chromadb`'s dependency chain currently has no wheels for Python 3.14 — use Python 3.11–3.12 for the backend venv if `pip install chromadb` fails.

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # defaults to http://localhost:8000, override if needed
npm run dev
```

## 📡 API Endpoints

### Research
| Method | Endpoint | Description |
|---|---|---|
| POST | `/research/run` | Start a run for a topic → `202` + run (steps all `waiting`) |
| GET | `/research/history` | List runs, newest first |
| GET | `/research/history/{id}` | Full run detail (report, feedback, etc.) |
| GET | `/research/history/{id}/status` | Poll target — status + per-step progress |
| DELETE | `/research/history/{id}` | Delete a run |

### RAG
| Method | Endpoint | Description |
|---|---|---|
| POST | `/rag/upload` | Upload a PDF (multipart) → `202` + session (indexing starts in the background) |
| GET | `/rag/sessions` | List sessions |
| GET | `/rag/sessions/{id}` | Session detail + past Q&A |
| GET | `/rag/sessions/{id}/status` | Poll target — indexing status |
| POST | `/rag/sessions/{id}/ask` | Ask a question (only once status is `ready`) |
| DELETE | `/rag/sessions/{id}` | Delete a session (also removes the PDF + Chroma index from disk) |

### Auth (implemented, unused by the app today)
`POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`

## ⚙️ Core Functionality

- **Background task pattern** — research runs and RAG indexing execute via FastAPI `BackgroundTasks`, each opening its own DB session; the frontend polls a status endpoint until the job reaches a terminal state
- **MMR retrieval** — RAG retriever uses Maximal Marginal Relevance (`k=4`, `fetch_k=10`, `lambda_mult=0.5`) to balance relevance and diversity in retrieved chunks
- **Grounded answers** — RAG prompt strictly instructs the LLM to answer only from context, falling back to "I could not find the answer in the document" otherwise
- **Persisted, per-session vector stores** — each PDF gets its own Chroma index under `backend/data/rag_indices/{session_id}/`, so sessions don't share or overwrite each other's embeddings
- **Startup recovery** — runs/sessions left `running`/`indexing` from a server restart are marked `failed` on the next boot rather than staying stuck forever

## 📄 License

Internal project — all rights reserved.
