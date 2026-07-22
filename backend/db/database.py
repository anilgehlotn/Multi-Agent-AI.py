import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve_database_url(url: str) -> str:
    # A relative sqlite:/// path resolves against the process's CWD, which
    # differs depending on how the app was launched (cd backend && uvicorn
    # main:app vs. uvicorn backend.main:app from the project root) — pin it
    # to backend/ so the DB file always lands in the same place either way.
    prefix = "sqlite:///"
    if url.startswith(prefix) and not url.startswith("sqlite:////"):
        abs_path = os.path.normpath(os.path.join(_BACKEND_DIR, url[len(prefix):]))
        return f"sqlite:///{abs_path}"
    return url


DATABASE_URL = _resolve_database_url(settings.DATABASE_URL)

# SQLite needs this when the same connection is touched from different
# threads, which FastAPI's request handling does. Harmless for other DBs.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
