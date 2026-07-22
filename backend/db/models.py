import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


# ---------------------------------------------------------------------------
# ResearchRun / RagSession / RagQuery are deliberately NOT linked to User yet
# (portfolio-deadline pivot: research + RAG ship single-user, no auth
# wiring). When auth gets wired in a later step, add
# `user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)`
# to ResearchRun and RagSession.
# ---------------------------------------------------------------------------


def _default_steps() -> dict:
    return {
        "search": {"status": "waiting"},
        "reader": {"status": "waiting"},
        "writer": {"status": "waiting"},
        "critic": {"status": "waiting"},
    }


class ResearchRun(Base):
    __tablename__ = "research_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    topic: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    # Read-modify-write the whole dict when updating — SQLAlchemy's JSON type
    # doesn't track in-place mutation of a fetched dict on SQLite.
    steps: Mapped[dict] = mapped_column(JSON, default=_default_steps)
    search_results: Mapped[str | None] = mapped_column(Text, nullable=True)
    scraped_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    report: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RagSession(Base):
    __tablename__ = "rag_sessions"

    # uuid4 hex, not an autoincrement int — doubles as the on-disk vector
    # store dir name (backend/data/rag_indices/{id}/), collision-free.
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    pdf_filename: Mapped[str] = mapped_column(String, nullable=False)
    num_chunks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    queries: Mapped[list["RagQuery"]] = relationship(
        "RagQuery", back_populates="session", cascade="all, delete-orphan"
    )


class RagQuery(Base):
    __tablename__ = "rag_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # SQLite doesn't enforce ON DELETE CASCADE unless "PRAGMA foreign_keys=ON"
    # is set per-connection; deletion is instead handled by the ORM-level
    # cascade above, which requires going through db.delete(session_obj)
    # rather than a bulk `.delete()` query (see rag_api/service.py).
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("rag_sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["RagSession"] = relationship("RagSession", back_populates="queries")
