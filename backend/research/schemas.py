from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class RunCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    topic: str = Field(min_length=3, max_length=300)


class StepStatus(BaseModel):
    status: Literal["waiting", "running", "done", "failed"]
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class RunOut(BaseModel):
    id: int
    topic: str
    status: str
    steps: dict[str, StepStatus]
    created_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class RunDetail(RunOut):
    search_results: Optional[str] = None
    scraped_content: Optional[str] = None
    report: Optional[str] = None
    feedback: Optional[str] = None


class RunListItem(BaseModel):
    id: int
    topic: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
