"""Runs the RAG flow (via the live backend API) against a fixed test PDF and
a gold Q&A set, scoring retrieval + answer quality with an LLM judge."""
import json
import os
import sys
import time
from typing import Optional

import requests

from .judges import judge_rag_answer
from .research_eval import (  # shared, same backend contract
    BackendUnavailable,
    _check_backend,
    _is_quota_error,
    _quota_summary,
)

BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://127.0.0.1:8000")
POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 120
GROQ_CALL_DELAY_SECONDS = 1  # stay well under free-tier RPM

_DATASET_DIR = os.path.join(os.path.dirname(__file__), "datasets")
_QA_PATH = os.path.join(_DATASET_DIR, "rag_qa_pairs.json")
_PDF_PATH = os.path.join(_DATASET_DIR, "rag_test.pdf")


def load_qa_pairs(limit: Optional[int] = None) -> list[dict]:
    with open(_QA_PATH) as f:
        pairs = json.load(f)
    return pairs[:limit] if limit else pairs


class _UploadQuotaBlocked(Exception):
    """Raised when the upload/index step itself fails for a quota reason."""

    def __init__(self, error_text: str):
        self.error_text = error_text
        super().__init__(error_text)


def _upload_and_wait_ready() -> tuple[str, str]:
    with open(_PDF_PATH, "rb") as f:
        resp = requests.post(
            f"{BACKEND_BASE_URL}/rag/upload",
            files={"file": ("rag_test.pdf", f, "application/pdf")},
            timeout=30,
        )
    try:
        resp.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        if _is_quota_error(resp.text):
            raise _UploadQuotaBlocked(resp.text) from exc
        raise
    session_id = resp.json()["id"]

    status = "pending"
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while status in ("pending", "indexing") and time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_SECONDS)
        status_resp = requests.get(f"{BACKEND_BASE_URL}/rag/sessions/{session_id}/status", timeout=15)
        status_resp.raise_for_status()
        status = status_resp.json()["status"]

    return session_id, status


def _ask_one(session_id: str, qa_row: dict) -> dict:
    resp = requests.post(
        f"{BACKEND_BASE_URL}/rag/sessions/{session_id}/ask",
        json={"question": qa_row["question"]},
        timeout=60,
    )
    if not resp.ok:
        return {
            "qa_id": qa_row["id"],
            "question": qa_row["question"],
            "type": qa_row["type"],
            "model_answer": None,
            "sources": [],
            "error": resp.text,
            "scores": None,
        }

    data = resp.json()
    model_answer = data.get("answer")
    sources = data.get("sources") or []

    time.sleep(GROQ_CALL_DELAY_SECONDS)
    scores = judge_rag_answer(
        question=qa_row["question"],
        gold_answer=qa_row["gold_answer"],
        model_answer=model_answer,
        qtype=qa_row["type"],
        sources=sources,
        gold_page_hint=qa_row.get("gold_page_hint"),
    )

    return {
        "qa_id": qa_row["id"],
        "question": qa_row["question"],
        "type": qa_row["type"],
        "model_answer": model_answer,
        "sources": sources,
        "error": None,
        "scores": scores,
    }


def _mean(rows: list[dict], key: str) -> Optional[float]:
    vals = [r["scores"][key] for r in rows if r["scores"] and r["scores"].get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def run_rag_eval(limit: Optional[int] = None) -> dict:
    _check_backend()
    qa_pairs = load_qa_pairs(limit)

    print("[rag] uploading test PDF and waiting for the index to be ready...", file=sys.stderr)
    try:
        session_id, index_status = _upload_and_wait_ready()
    except _UploadQuotaBlocked as exc:
        return {
            "rows": [],
            "aggregate": {
                "total_count": 0,
                "total_wall_seconds": 0.0,
                "mean_correctness": None,
                "mean_faithfulness": None,
                "mean_completeness": None,
                "mean_overall": None,
                "retrieval_hit_rate": None,
                "adversarial_refusal_rate": None,
                "judge_failures": 0,
                "quota_blocked": True,
                "quota_blocked_count": 0,
            },
            "session_id": None,
            "error": exc.error_text,
        }
    if index_status != "ready":
        raise RuntimeError(f"RAG index never became ready (status={index_status}); aborting RAG eval")

    rows = []
    wall_start = time.monotonic()
    try:
        for i, qa_row in enumerate(qa_pairs, 1):
            print(f"[rag] ({i}/{len(qa_pairs)}) asking {qa_row['id']}: {qa_row['question']!r}", file=sys.stderr)
            rows.append(_ask_one(session_id, qa_row))
    finally:
        # Keep repeat runs tidy — also removes the PDF + Chroma index from disk.
        requests.delete(f"{BACKEND_BASE_URL}/rag/sessions/{session_id}", timeout=15)
    wall_time = time.monotonic() - wall_start

    scored = [r for r in rows if r["scores"]]
    non_adversarial = [r for r in scored if r["type"] != "adversarial"]
    adversarial = [r for r in scored if r["type"] == "adversarial"]

    retrieval_hits = [r["scores"]["retrieval_hit"] for r in non_adversarial if r["scores"].get("retrieval_hit") is not None]
    refusals = [r["scores"]["refused_correctly"] for r in adversarial if r["scores"].get("refused_correctly") is not None]
    quota_blocked, quota_related_count = _quota_summary(rows)

    aggregate = {
        "total_count": len(rows),
        "total_wall_seconds": wall_time,
        "mean_correctness": _mean(non_adversarial, "correctness"),
        "mean_faithfulness": _mean(non_adversarial, "faithfulness"),
        "mean_completeness": _mean(non_adversarial, "completeness"),
        "mean_overall": _mean(non_adversarial, "overall"),
        "retrieval_hit_rate": (sum(retrieval_hits) / len(retrieval_hits)) if retrieval_hits else None,
        "adversarial_refusal_rate": (sum(refusals) / len(refusals)) if refusals else None,
        "judge_failures": sum(1 for r in rows if r["scores"] and r["scores"].get("judge_failed")),
        "quota_blocked": quota_blocked,
        "quota_blocked_count": quota_related_count,
    }

    return {"rows": rows, "aggregate": aggregate, "session_id": session_id}
