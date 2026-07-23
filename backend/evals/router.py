"""Read-only endpoints exposing cached eval results to the frontend.

Serves whatever's already on disk in evals/results/ — never triggers a live
eval run (that stays a manual `python -m evals.run` from the CLI).
"""
from fastapi import APIRouter

from .report import _parse_cache_timestamp, find_latest_cache, load_cached_result

router = APIRouter(prefix="/evals", tags=["evals"])


def _iso(dt) -> str | None:
    # Naive (no offset) UTC string, matching every other timestamp this API
    # returns (e.g. ResearchRun.created_at) — the frontend's timeAgo() helper
    # assumes this shape and appends "Z" itself.
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if dt else None


def _load_with_timestamp(name: str) -> dict | None:
    cached = load_cached_result(name)
    if cached is None:
        return None
    path, payload = cached
    return {**payload, "timestamp": _iso(_parse_cache_timestamp(path))}


@router.get("/latest")
def get_latest() -> dict:
    return {
        "research": _load_with_timestamp("research"),
        "rag": _load_with_timestamp("rag"),
    }


@router.get("/status")
def get_status() -> dict:
    research_path = find_latest_cache("research")
    rag_path = find_latest_cache("rag")
    return {
        "has_research": research_path is not None,
        "has_rag": rag_path is not None,
        "research_timestamp": _iso(_parse_cache_timestamp(research_path)) if research_path else None,
        "rag_timestamp": _iso(_parse_cache_timestamp(rag_path)) if rag_path else None,
    }
