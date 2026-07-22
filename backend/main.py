"""
ResearchMind API — FastAPI entry point.

Run from the backend/ directory:
  cd backend && uvicorn main:app --reload

Or from the project root:
  uvicorn backend.main:app --reload
"""

import os
import sys

# Make this file importable both as `backend.main` (run from the project root)
# and as a bare `main` module (run from inside backend/), so `config` resolves
# either way without needing the package installed.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings

app = FastAPI(title="ResearchMind API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def validate_environment() -> None:
    required = {
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


@app.get("/")
async def root():
    return {"message": "ResearchMind API"}


@app.get("/health")
async def health():
    return {"status": "ok"}
