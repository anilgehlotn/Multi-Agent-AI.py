"""
ResearchMind API — FastAPI entry point.

Run from the backend/ directory:
  cd backend && uvicorn main:app --reload

Or from the project root:
  uvicorn backend.main:app --reload
"""

import os
import sys
from datetime import datetime, timezone

# Make this file importable both as `backend.main` (run from the project root)
# and as a bare `main` module (run from inside backend/), so `config` resolves
# either way without needing the package installed.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import Base, SessionLocal, engine
from db.models import RagSession, ResearchRun
from auth.router import router as auth_router
from research.router import router as research_router
from research import service as research_service
from rag_api.router import router as rag_router
from rag_api import service as rag_service

app = FastAPI(title="ResearchMind API")

cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth endpoints exist (signup/login/me/logout) but aren't required by the
# routes below — this project ships single-user for now, see README.
app.include_router(auth_router)
app.include_router(research_router)
app.include_router(rag_router)


@app.on_event("startup")
async def validate_environment() -> None:
    required = {
        "GROQ_API_KEY": os.environ.get("GROQ_API_KEY", ""),
        "GOOGLE_API_KEY": settings.GOOGLE_API_KEY,
        "TAVILY_API_KEY": settings.TAVILY_API_KEY,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        print(
            f"ERROR: missing required environment variable(s): {', '.join(missing)}. "
            f"Copy backend/.env.example to backend/.env and fill them in.",
            file=sys.stderr,
        )
        raise SystemExit(1)


@app.on_event("startup")
def init_db() -> None:
    # No Alembic yet — create_all() is fine for local dev. Add real
    # migrations before this ever points at a production database.
    Base.metadata.create_all(bind=engine)


@app.on_event("startup")
def ensure_data_dirs() -> None:
    os.makedirs(rag_service.UPLOADS_DIR, exist_ok=True)
    os.makedirs(rag_service.RAG_INDICES_DIR, exist_ok=True)


@app.on_event("startup")
def recover_stuck_jobs() -> None:
    # BackgroundTasks are in-process — if the server restarts mid-run, that
    # run/session is stuck in "running"/"indexing" forever without this.
    db = SessionLocal()
    try:
        for run in db.query(ResearchRun).filter(ResearchRun.status == "running").all():
            research_service.fail_run(db, run.id, "server restarted")
        for session in db.query(RagSession).filter(RagSession.status == "indexing").all():
            rag_service.fail_session(db, session.id, "server restarted")
    finally:
        db.close()


@app.get("/")
async def root():
    return {"message": "ResearchMind API"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/warmup")
async def warmup():
    # Hit from the frontend on load to trigger a Render free-tier cold start
    # before the user's first real request. No work beyond responding.
    return {"status": "warm", "timestamp": datetime.now(timezone.utc).isoformat()}
