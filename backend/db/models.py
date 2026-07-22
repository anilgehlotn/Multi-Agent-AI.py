from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

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
# TODO (later steps): ResearchRun and RagSession models go here. Both will
# have a user_id FK back to User, e.g.:
#
# from sqlalchemy import ForeignKey
#
# class ResearchRun(Base):
#     __tablename__ = "research_runs"
#     id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
#     user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
#     topic: Mapped[str] = mapped_column(String)
#     created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
#
# class RagSession(Base):
#     __tablename__ = "rag_sessions"
#     id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
#     user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
#     created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
# ---------------------------------------------------------------------------
