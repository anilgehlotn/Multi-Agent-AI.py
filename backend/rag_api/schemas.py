from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SessionOut(BaseModel):
    id: str
    pdf_filename: str
    num_chunks: Optional[int] = None
    status: str
    error: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QueryCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    question: str = Field(min_length=3, max_length=500)


class SourceChunk(BaseModel):
    page: Optional[int] = None
    snippet: str


class QueryOut(BaseModel):
    id: int
    question: str
    answer: Optional[str] = None
    sources: list[SourceChunk] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionDetail(SessionOut):
    queries: list[QueryOut] = []
