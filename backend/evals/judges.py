"""LLM-as-judge scoring for both eval flows.

Deterministic pieces (keyword matching, refusal detection, retrieval-hit
checks) are computed in Python. The judge LLM is only asked for the
subjective 1-5 scores and a one-line verdict.
"""
import json
import logging
import re
from typing import Optional

from langchain_groq import ChatGroq

# The eval CLI is invoked standalone (`python -m evals.run`), so it never
# goes through main.py's import chain — importing config here is what
# actually loads backend/.env into os.environ (config.py's load_dotenv side
# effect), which ChatGroq needs for GROQ_API_KEY.
import config  # noqa: F401

logger = logging.getLogger(__name__)

_judge_llm: Optional[ChatGroq] = None


def _get_judge_llm() -> ChatGroq:
    global _judge_llm
    if _judge_llm is None:
        _judge_llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
    return _judge_llm


def _message_text(content) -> str:
    # Defensive normalization — some providers return a list of content-part
    # dicts instead of a plain string.
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part if isinstance(part, str) else part.get("text", "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        ]
        return "\n".join(p for p in parts if p)
    return str(content)


def _extract_json(raw: str) -> Optional[dict]:
    """Best-effort JSON extraction from an LLM response that may be wrapped
    in prose or markdown code fences."""
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    else:
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            text = brace_match.group(0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _invoke_judge(prompt: str) -> tuple[Optional[dict], str]:
    llm = _get_judge_llm()
    try:
        raw = _message_text(llm.invoke(prompt).content)
    except Exception as exc:
        # Rate limits / provider outages on the judge call itself — don't
        # crash the whole eval run over one bad judge call, same as a JSON
        # parse failure.
        logger.warning("judge LLM call failed: %s", exc)
        return None, f"<judge call failed: {exc}>"
    parsed = _extract_json(raw)
    if parsed is None:
        logger.warning("judge output failed to parse as JSON. Raw output:\n%s", raw)
    return parsed, raw


# ── Research report judge ────────────────────────────────────────────────

RESEARCH_JUDGE_PROMPT = """You are a strict, expert research-report evaluator.

Score the report below against this exact rubric. Return ONLY valid JSON, no
prose, no markdown fences — just the raw JSON object.

Topic: {topic}

Report:
{report}

Rubric (score each 1-5, where 1=poor, 3=adequate, 5=excellent):
- coverage: Does the report address the topic broadly, touching its major facets?
- depth: Does it go beyond surface-level facts into mechanisms, numbers, or nuance?
- structure: Does it have a clear introduction, findings, conclusion, and sources section?
- citations: Are sources listed, and do they look like real, specific URLs (not vague or fabricated-looking)?
- overall: Your holistic 1-5 judgment of report quality.

Return exactly this JSON shape:
{{
  "coverage": <int 1-5>,
  "depth": <int 1-5>,
  "structure": <int 1-5>,
  "citations": <int 1-5>,
  "overall": <int 1-5>,
  "one_line_verdict": "<one sentence>"
}}
"""

_RESEARCH_SCORE_KEYS = ("coverage", "depth", "structure", "citations", "overall")


def judge_research_report(topic: str, must_mention: list[str], report: str) -> dict:
    report_text = report or ""
    keyword_hits = sum(1 for term in must_mention if term.lower() in report_text.lower())
    keyword_recall = keyword_hits / len(must_mention) if must_mention else 0.0

    prompt = RESEARCH_JUDGE_PROMPT.format(topic=topic, report=report_text[:6000])
    parsed, raw = _invoke_judge(prompt)

    if parsed is None:
        return {
            **{k: None for k in _RESEARCH_SCORE_KEYS},
            "one_line_verdict": None,
            "keyword_hits": keyword_hits,
            "keyword_recall": keyword_recall,
            "judge_failed": True,
            "raw_judge_output": raw,
        }

    return {
        **{k: parsed.get(k) for k in _RESEARCH_SCORE_KEYS},
        "one_line_verdict": parsed.get("one_line_verdict"),
        "keyword_hits": keyword_hits,
        "keyword_recall": keyword_recall,
        "judge_failed": False,
        "raw_judge_output": raw,
    }


# ── RAG answer judge ─────────────────────────────────────────────────────

FACTUAL_JUDGE_PROMPT = """You are a strict, expert evaluator judging a RAG \
(retrieval-augmented generation) system's answer to a question about a \
technical document.

Question: {question}

Gold (reference) answer: {gold_answer}

Model's answer: {model_answer}

Score the model's answer against this exact rubric (1-5, where 1=poor, \
3=adequate, 5=excellent):
- correctness: Does it match the factual content of the gold answer?
- faithfulness: Is it grounded in retrieved context, or does it show signs \
  of hallucination / invented facts not supported by a document like this?
- completeness: Does it fully answer the question, or leave out key parts \
  of the gold answer?
- overall: Your holistic 1-5 judgment.

Return ONLY valid JSON, no prose, no markdown fences:
{{
  "correctness": <int 1-5>,
  "faithfulness": <int 1-5>,
  "completeness": <int 1-5>,
  "overall": <int 1-5>,
  "one_line_verdict": "<one sentence>"
}}
"""

ADVERSARIAL_JUDGE_PROMPT = """You are a strict, expert evaluator judging a \
RAG system's answer to a question whose correct answer is that the document \
does NOT contain this information — the ideal response honestly declines \
rather than inventing an answer.

Question: {question}

Model's answer: {model_answer}

Score only:
- faithfulness (1-5): 5 = honestly and clearly declined / said it couldn't \
  find the answer, with no fabricated facts. 1 = confidently invented a \
  detailed, specific-sounding but unsupported answer.

Return ONLY valid JSON, no prose, no markdown fences:
{{
  "faithfulness": <int 1-5>,
  "one_line_verdict": "<one sentence>"
}}
"""

_REFUSAL_PHRASES = (
    "could not find",
    "couldn't find",
    "not in the document",
    "no information",
    "does not contain",
    "doesn't contain",
    "cannot find",
    "can't find",
    "not mentioned",
    "not present in the",
    "i don't know",
    "unable to find",
    "no mention of",
)


def _looks_like_refusal(text: str) -> bool:
    t = (text or "").lower()
    return any(phrase in t for phrase in _REFUSAL_PHRASES)


def judge_rag_answer(
    question: str,
    gold_answer: str,
    model_answer: Optional[str],
    qtype: str,
    sources: list[dict],
    gold_page_hint: Optional[int] = None,
) -> dict:
    num_sources = len(sources or [])
    answer_length = len(model_answer or "")

    if qtype == "adversarial":
        refused_correctly = _looks_like_refusal(model_answer)
        prompt = ADVERSARIAL_JUDGE_PROMPT.format(question=question, model_answer=model_answer or "")
        parsed, raw = _invoke_judge(prompt)

        base = {
            "refused_correctly": refused_correctly,
            "retrieval_hit": None,
            "num_sources": num_sources,
            "answer_length": answer_length,
        }
        if parsed is None:
            return {
                **base,
                "correctness": None,
                "faithfulness": None,
                "completeness": None,
                "overall": None,
                "one_line_verdict": None,
                "judge_failed": True,
                "raw_judge_output": raw,
            }
        return {
            **base,
            "correctness": None,
            "faithfulness": parsed.get("faithfulness"),
            "completeness": None,
            "overall": None,
            "one_line_verdict": parsed.get("one_line_verdict"),
            "judge_failed": False,
            "raw_judge_output": raw,
        }

    retrieval_hit = None
    if gold_page_hint is not None:
        pages = {s.get("page") for s in (sources or [])}
        retrieval_hit = gold_page_hint in pages

    prompt = FACTUAL_JUDGE_PROMPT.format(question=question, gold_answer=gold_answer, model_answer=model_answer or "")
    parsed, raw = _invoke_judge(prompt)

    base = {
        "refused_correctly": None,
        "retrieval_hit": retrieval_hit,
        "num_sources": num_sources,
        "answer_length": answer_length,
    }
    if parsed is None:
        return {
            **base,
            "correctness": None,
            "faithfulness": None,
            "completeness": None,
            "overall": None,
            "one_line_verdict": None,
            "judge_failed": True,
            "raw_judge_output": raw,
        }
    return {
        **base,
        "correctness": parsed.get("correctness"),
        "faithfulness": parsed.get("faithfulness"),
        "completeness": parsed.get("completeness"),
        "overall": parsed.get("overall"),
        "one_line_verdict": parsed.get("one_line_verdict"),
        "judge_failed": False,
        "raw_judge_output": raw,
    }
