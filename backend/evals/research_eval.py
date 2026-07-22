"""Runs the research pipeline (via the live backend API) on a set of hand-
picked topics and scores each output with an LLM judge."""
import json
import os
import sys
import time
from typing import Optional

import requests

from .judges import judge_research_report

BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://127.0.0.1:8000")
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600  # ceiling per run
GROQ_CALL_DELAY_SECONDS = 1  # stay well under free-tier RPM

_DATASET_PATH = os.path.join(os.path.dirname(__file__), "datasets", "research_topics.json")


class BackendUnavailable(Exception):
    pass


# Substrings seen in real Groq quota/rate-limit errors (429 responses, both the
# per-minute RPM flavor and the daily TPD token-budget flavor). Matched
# case-insensitively against whatever error text a row captured.
_QUOTA_ERROR_SUBSTRINGS = ("rate_limit_exceeded", "quota", "resource_exhausted", "tpd")

# Below this fraction of quota-related failures in a run, treat them as
# ordinary transient failures and keep the live (partial) results as-is.
_QUOTA_BLOCK_THRESHOLD = 0.5


def _is_quota_error(text: Optional[str]) -> bool:
    if not text:
        return False
    t = text.lower()
    return any(sub in t for sub in _QUOTA_ERROR_SUBSTRINGS)


def _row_is_quota_related(row: dict) -> bool:
    """True if a result row failed (outright or via the judge call) for a
    quota/rate-limit reason, as opposed to some other failure."""
    if row.get("status") == "failed" and _is_quota_error(row.get("error")):
        return True
    if row.get("error") and _is_quota_error(row.get("error")):
        return True
    scores = row.get("scores")
    if scores and scores.get("judge_failed") and _is_quota_error(scores.get("raw_judge_output")):
        return True
    return False


def _quota_summary(rows: list[dict]) -> tuple[bool, int]:
    """Returns (quota_blocked, quota_related_count) for a set of result rows."""
    if not rows:
        return False, 0
    quota_related = sum(1 for r in rows if _row_is_quota_related(r))
    return (quota_related / len(rows)) >= _QUOTA_BLOCK_THRESHOLD, quota_related


def _check_backend() -> None:
    try:
        resp = requests.get(f"{BACKEND_BASE_URL}/health", timeout=5)
        resp.raise_for_status()
    except requests.exceptions.RequestException as exc:
        raise BackendUnavailable(
            f"Could not reach the backend at {BACKEND_BASE_URL}. "
            f"Start it with `cd backend && uvicorn main:app --reload`. ({exc})"
        ) from exc


def load_topics(limit: Optional[int] = None) -> list[dict]:
    with open(_DATASET_PATH) as f:
        topics = json.load(f)
    return topics[:limit] if limit else topics


def _run_one_topic(topic_row: dict) -> dict:
    topic = topic_row["topic"]
    start = time.monotonic()

    try:
        resp = requests.post(f"{BACKEND_BASE_URL}/research/run", json={"topic": topic}, timeout=15)
        resp.raise_for_status()
        run_id = resp.json()["id"]

        status = "pending"
        deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
        while status in ("pending", "running") and time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_SECONDS)
            status_resp = requests.get(f"{BACKEND_BASE_URL}/research/history/{run_id}/status", timeout=15)
            status_resp.raise_for_status()
            status = status_resp.json()["status"]
    except requests.exceptions.HTTPError as exc:
        # A quota/rate-limit error can surface synchronously (e.g. the backend
        # rejects the run outright) rather than via a "failed" status after
        # polling. Only swallow it if it's actually quota-related — anything
        # else should still propagate as a real error.
        error_text = exc.response.text if exc.response is not None else str(exc)
        if not _is_quota_error(error_text):
            raise
        return {
            "topic_id": topic_row["id"],
            "topic": topic,
            "run_id": None,
            "status": "failed",
            "error": error_text,
            "report_text": None,
            "feedback_text": None,
            "scores": None,
            "timing_seconds": time.monotonic() - start,
        }

    elapsed = time.monotonic() - start

    detail_resp = requests.get(f"{BACKEND_BASE_URL}/research/history/{run_id}", timeout=15)
    detail_resp.raise_for_status()
    detail = detail_resp.json()

    if status != "completed":
        return {
            "topic_id": topic_row["id"],
            "topic": topic,
            "run_id": run_id,
            "status": status,
            "error": detail.get("error"),
            "report_text": None,
            "feedback_text": None,
            "scores": None,
            "timing_seconds": elapsed,
        }

    time.sleep(GROQ_CALL_DELAY_SECONDS)
    scores = judge_research_report(topic, topic_row.get("must_mention", []), detail.get("report") or "")

    return {
        "topic_id": topic_row["id"],
        "topic": topic,
        "run_id": run_id,
        "status": status,
        "error": None,
        "report_text": detail.get("report"),
        "feedback_text": detail.get("feedback"),
        "scores": scores,
        "timing_seconds": elapsed,
    }


def _mean(rows: list[dict], key: str) -> Optional[float]:
    vals = [r["scores"][key] for r in rows if r["scores"] and r["scores"].get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def run_research_eval(limit: Optional[int] = None) -> dict:
    _check_backend()
    topics = load_topics(limit)

    rows = []
    wall_start = time.monotonic()
    for i, topic_row in enumerate(topics, 1):
        print(f"[research] ({i}/{len(topics)}) running {topic_row['id']}: {topic_row['topic']!r}", file=sys.stderr)
        rows.append(_run_one_topic(topic_row))
    wall_time = time.monotonic() - wall_start

    completed = [r for r in rows if r["status"] == "completed"]
    quota_blocked, quota_related_count = _quota_summary(rows)

    aggregate = {
        "total_count": len(rows),
        "completed_count": len(completed),
        "success_rate": (len(completed) / len(rows)) if rows else 0.0,
        "total_wall_seconds": wall_time,
        "avg_pipeline_seconds": (sum(r["timing_seconds"] for r in rows) / len(rows)) if rows else 0.0,
        "mean_coverage": _mean(completed, "coverage"),
        "mean_depth": _mean(completed, "depth"),
        "mean_structure": _mean(completed, "structure"),
        "mean_citations": _mean(completed, "citations"),
        "mean_overall": _mean(completed, "overall"),
        "mean_keyword_recall": _mean(completed, "keyword_recall"),
        "judge_failures": sum(1 for r in completed if r["scores"] and r["scores"].get("judge_failed")),
        "quota_blocked": quota_blocked,
        "quota_blocked_count": quota_related_count,
    }

    return {"rows": rows, "aggregate": aggregate}
