# 7. Evaluation Module

## 7.1 Why evaluate at all — the case for it

Anyone can wire an LLM up to a UI and call it a demo. What's much rarer — and what this section of the project exists specifically to demonstrate — is measuring whether the system actually *works well*, on a fixed, repeatable, hand-built test set, with a mix of automated scoring and metrics that can't be gamed by a confident-sounding but wrong LLM judge. See [2.9](./02-concepts-primer.md#29-evaluation-of-ai-systems) for why you can't just unit-test an LLM the normal way, and why this project splits its metrics into judged vs. deterministic categories.

This isn't a one-time report — it's a runnable module (`python -m evals.run all`) that produces a fresh, timestamped scorecard every time it's run, so a future change to a prompt, a model, or a retrieval parameter can be checked against the same fixed test set to see whether it actually helped or hurt.

## 7.2 The datasets

### 7.2.1 `research_topics.json`

```json
[
  {"id": "R01", "topic": "Recent breakthroughs in fusion energy 2025", "must_mention": ["National Ignition Facility", "net energy gain"], "difficulty": "easy"},
  {"id": "R02", "topic": "LLM agents 2025", "must_mention": ["agentic", "tool calling"], "difficulty": "medium"},
  {"id": "R03", "topic": "RAG optimization techniques", "must_mention": ["chunking", "reranking"], "difficulty": "medium"},
  {"id": "R04", "topic": "Compare vector databases: Chroma vs FAISS vs Pinecone", "must_mention": ["Chroma", "FAISS", "Pinecone"], "difficulty": "hard"},
  {"id": "R05", "topic": "The future of autonomous AI agents", "must_mention": ["autonomy", "human oversight"], "difficulty": "hard"}
]
```
Five topics, deliberately spanning a difficulty spread: R01 is a concrete, fact-checkable recent-events topic (easy to verify whether the report actually engaged with the real subject matter); R02/R03 are medium — established but evolving technical areas; R04 is a comparative question, requiring the report to meaningfully address three named things rather than one; R05 is open-ended and conceptual, the hardest to write (or judge) well.

`must_mention` is a list of keywords/phrases the eval expects a *competent* report on this topic to contain. It's checked with a plain case-insensitive substring match in Python (`backend/evals/judges.py`), not asked of the LLM judge — see [7.3.4](#734-the-split-between-judged-subjective-and-computed-deterministic-metrics) for why. It's a coverage floor, not a completeness guarantee — a report could mention every keyword and still be shallow, or (less likely, given the keywords are chosen to be genuinely central to the topic) miss a keyword while still being substantively good.

### 7.2.2 `rag_qa_pairs.json`

Eight question/gold-answer pairs against the fixed test PDF, split across three types:

| Type | Count | IDs | Purpose |
|---|---|---|---|
| `factual` | 3 | Q01–Q03 | Single, verifiable facts explicitly stated in the document (the model name, a layer count, a specific BLEU score) |
| `synthesis` | 3 | Q04–Q06 | Requires combining information from more than one part of the document, or explaining a mechanism rather than quoting a fact (the attention formula *and* why it's scaled; positional encoding rationale *and* the functions used; comparing base vs. big model scores across two language pairs) |
| `adversarial` | 2 | Q07–Q08 | Questions the document does **not** answer (CO2 emissions of training; commercial licensing terms) — the gold answer for both is literally `"I could not find the answer in the document."` |

Why adversarial cases specifically matter: covered in full at [2.9.5](./02-concepts-primer.md#295-why-the-adversarial-test-cases-exist). The one-sentence version — a RAG system that never gets asked something outside its source document never has to demonstrate it *won't* hallucinate when it doesn't know; these two questions exist to force that test.

Each factual/synthesis question also has a `gold_page_hint` — the (zero-indexed) page number where the answer actually lives, used to compute **retrieval hit rate** ([7.4.4](#744-retrieval-hit-rate)) — a check on whether the *retrieval* step found the right material, independent of whether the final generated answer was phrased well.

### 7.2.3 Why the test PDF is fixed

The RAG eval always uploads the exact same document (`backend/evals/datasets/rag_test.pdf` — "Attention Is All You Need," fetched from arXiv) rather than a random or rotating PDF. This is a comparability requirement, not a limitation: if the source document changed between eval runs, a scorecard difference could be explained by "the document changed" rather than "the system changed," which would make the eval useless for its actual purpose — telling you whether a code/prompt/model change made things better or worse. A fixed, well-known, technically dense document also means the gold answers themselves can be verified against a document a great many readers already know well.

## 7.3 The judges

### 7.3.1 The rubrics, dissected

Two judge functions, `judge_research_report()` and `judge_rag_answer()`, both in `backend/evals/judges.py`, each with its own prompt template. The research rubric scores five 1–5 dimensions:

```python
RESEARCH_JUDGE_PROMPT = """...
Rubric (score each 1-5, where 1=poor, 3=adequate, 5=excellent):
- coverage: Does the report address the topic broadly, touching its major facets?
- depth: Does it go beyond surface-level facts into mechanisms, numbers, or nuance?
- structure: Does it have a clear introduction, findings, conclusion, and sources section?
- citations: Are sources listed, and do they look like real, specific URLs (not vague or fabricated-looking)?
- overall: Your holistic 1-5 judgment of report quality.
..."""
```
Each dimension targets a distinct failure mode a report could have independently of the others — a report can have excellent `structure` (all four sections present, clearly labeled) while scoring poorly on `depth` (each section is thin, surface-level), or vice versa. Scoring them separately, rather than asking for one holistic number, makes a low score *diagnostic* — you can tell from the scorecard *which* aspect needs attention, not just that something's wrong.

The RAG rubric (factual/synthesis questions) scores four dimensions — `correctness`, `faithfulness`, `completeness`, `overall`; the adversarial rubric asks for exactly one — `faithfulness` only (see [7.3.1.1](#7311-why-adversarial-only-scores-faithfulness) below).

#### 7.3.1.1 Why adversarial only scores faithfulness

```python
ADVERSARIAL_JUDGE_PROMPT = """...
Score only:
- faithfulness (1-5): 5 = honestly and clearly declined / said it couldn't find the answer,
  with no fabricated facts. 1 = confidently invented a detailed, specific-sounding but unsupported answer.
..."""
```
`correctness` and `completeness` don't have coherent meaning for a question with no correct answer to be correct or complete *about* — there's nothing to be correct against. `faithfulness`, redefined for this case specifically (5 = honestly declined, 1 = confidently hallucinated), is the only dimension that actually measures what an adversarial case is testing.

### 7.3.2 Why temperature=0 on the judge

Already covered at [2.1.3](./02-concepts-primer.md#213-temperature-and-why-this-project-uses-0-for-most-things) — repeated here because it matters most for the judge specifically: a scorecard is only useful for comparing runs over time if a fixed report, judged twice, scores approximately the same both times. A judge running at a nonzero temperature would inject its own randomness into every comparison, on top of whatever real variation exists in the system being measured.

### 7.3.3 Why JSON output, and how parse failures are handled

Every judge prompt ends with an explicit literal JSON shape and "Return ONLY valid JSON, no prose, no markdown fences." This is a machine-readable output contract — the calling code needs to extract specific numeric fields programmatically, not display prose to a human. Parsing is handled defensively, because LLMs don't always follow formatting instructions perfectly:
```python
# backend/evals/judges.py
def _extract_json(raw: str) -> Optional[dict]:
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
```
This tries, in order: strip a markdown code fence if present (models sometimes wrap JSON in ` ```json ... ``` ` despite being told not to), then fall back to just grabbing the first `{...}`-shaped substring, then attempt to parse whatever's left. If all of that fails, it returns `None` rather than raising — and the caller treats `None` as a signal to mark that row `judge_failed: True` (see [7.5.4](#754-graceful-degradation-judge_failed-rows)) rather than crashing the whole eval run over one malformed response.

### 7.3.4 The split between judged (subjective) and computed (deterministic) metrics

Already introduced at [2.9.3](./02-concepts-primer.md#293-deterministic-metrics-vs-judged-metrics) — this section is the complete list. **Computed in Python, never asked of the judge:**

- `keyword_hits` / `keyword_recall` — substring matching against `must_mention` ([7.4.2](#742-keyword-recall)).
- `retrieval_hit` — whether `gold_page_hint` appears in the set of pages actually retrieved ([7.4.4](#744-retrieval-hit-rate)).
- `refused_correctly` — whether the model's answer text matches a known refusal phrase ([7.4.5](#745-adversarial-refusal-rate)).

**Asked of the judge (necessarily subjective):** `coverage`, `depth`, `structure`, `citations`, `overall` (research); `correctness`, `faithfulness`, `completeness`, `overall` (RAG).

Why the split matters for trustworthiness: every deterministic metric in a scorecard is *exactly* reproducible by anyone reading this code — there's no ambiguity, no possibility of the judge having a bad day or a subtle bias affecting the number. That's a meaningfully stronger trust guarantee than "the judge said so," and reserving the LLM judge for genuinely subjective calls (is this well-structured? does this feel complete?) — questions that *don't* have a mechanical answer — is what keeps the judge's very real weaknesses ([2.9.2](./02-concepts-primer.md#292-what-llm-as-judge-means-and-its-weaknesses)) from contaminating numbers that didn't need to be subjective in the first place.

## 7.4 The metrics, each defined precisely

### 7.4.1 Coverage, depth, structure, citations

All four are 1–5 integers, judge-assigned, defined by the rubric text quoted in [7.3.1](#731-the-rubrics-dissected). No further Python-side processing — the judge's raw score for each dimension is the metric.

### 7.4.2 Keyword recall

```python
# backend/evals/judges.py
keyword_hits = sum(1 for term in must_mention if term.lower() in report_text.lower())
keyword_recall = keyword_hits / len(must_mention) if must_mention else 0.0
```
The fraction of a topic's `must_mention` keywords that appear (case-insensitively, as a substring) anywhere in the generated report. A topic with 2 `must_mention` terms, of which the report contains 1, scores `keyword_recall: 0.5`. This is a coverage-floor check, not a quality check — a report scoring `1.0` here has touched every expected keyword, but says nothing about whether it explained them well (that's what `depth`/`coverage`, the judged dimensions, are for).

### 7.4.3 Correctness, faithfulness, completeness

All 1–5 integers, judge-assigned, per the RAG rubric in [7.3.1](#731-the-rubrics-dissected): does the answer match the gold answer's facts (`correctness`); is it grounded in retrieved context rather than invented (`faithfulness`); does it cover everything the gold answer covers (`completeness`).

### 7.4.4 Retrieval hit rate

```python
# backend/evals/judges.py
retrieval_hit = None
if gold_page_hint is not None:
    pages = {s.get("page") for s in (sources or [])}
    retrieval_hit = gold_page_hint in pages
```
A boolean per question: did the set of pages actually retrieved (and handed to the model as context) include the page the gold answer says the real answer lives on? This measures the **retrieval** step in isolation from the **generation** step — a question could have `retrieval_hit: True` (the right page was found) but still get a poor `correctness` score if the model failed to extract or articulate the answer correctly from that page's text, and vice versa: a question could score well on `correctness` by coincidence or general knowledge even if the retrieved pages didn't actually include the source page (less likely on a technical document, but not impossible). Aggregate `retrieval_hit_rate` is the mean of this boolean across all non-adversarial questions in a run (adversarial questions have no `gold_page_hint`, so they're excluded — `retrieval_hit` is `None` for them by construction).

**Real measured number:** in a clean 3-question smoke test run (`python -m evals.run rag --limit 3`, covering Q01–Q03, all factual), `retrieval_hit_rate` came out to **0.67** (2 of 3) — Q02 and Q03 correctly retrieved their gold page; Q01 did not (its `correctness`/`faithfulness`/`completeness` scores were still high, `5/5/5`, meaning the model answered correctly and faithfully even though the retrieved chunk set, per this metric, didn't include the exact page the gold hint pointed at — a real example of retrieval-hit and answer-correctness genuinely diverging, exactly the case this metric exists to catch separately).

### 7.4.5 Adversarial refusal rate

```python
# backend/evals/judges.py
_REFUSAL_PHRASES = (
    "could not find", "couldn't find", "not in the document", "no information",
    "does not contain", "doesn't contain", "cannot find", "can't find",
    "not mentioned", "not present in the", "i don't know", "unable to find", "no mention of",
)

def _looks_like_refusal(text: str) -> bool:
    t = (text or "").lower()
    return any(phrase in t for phrase in _REFUSAL_PHRASES)
```
For each adversarial question, a boolean: did the model's answer contain any of these known refusal phrasings? Aggregate `adversarial_refusal_rate` is the mean across the two adversarial questions. This is a **deliberately loose, keyword-based** check, not a judge call — see [7.3.4](#734-the-split-between-judged-subjective-and-computed-deterministic-metrics) for why refusal detection is one of the metrics kept out of the judge's hands. Its weakness, stated honestly: a model that refuses in a genuinely correct but unusually-phrased way (not matching any listed phrase) would be miscounted as a hallucination by this metric — the phrase list is a real, if reasonably thorough, enumeration, not an exhaustive one.

## 7.5 The run harness

### 7.5.1 Live-first with cached fallback

The single most distinctive engineering feature of this module. By default, `python -m evals.run all` tries to run everything live (real pipeline runs, real judge calls) — but if it detects that the live run was blocked by API quota exhaustion rather than a genuine system failure, it automatically falls back to rendering the most recent successfully-cached scorecard instead of showing an error or a wall of failed rows:
```python
# backend/evals/run.py
if agg.get("quota_blocked"):
    ...
    console.print(f"[yellow]Live eval blocked by API quota[/yellow] ...")
    if not render_from_json(name, console):
        sys.exit(1)
    return
```
This exists because of a real, repeated problem encountered during this project's own development: Groq's free tier has a hard daily token cap ([7.5.2](#752-quota-detection-logic)), and cumulative testing across a work session can exhaust it well before an eval run gets a chance to complete. Without this fallback, `/evals` (the page a hiring manager might actually click) could show a wall of `failed` rows purely because of *when* it happened to be run, which would misrepresent the system's actual quality — the fallback means the page always shows the most recent scorecard that actually succeeded, honestly labeled with a "cached from" timestamp, rather than a snapshot of transient bad luck.

### 7.5.2 Quota detection logic

```python
# backend/evals/research_eval.py
_QUOTA_ERROR_SUBSTRINGS = ("rate_limit_exceeded", "quota", "resource_exhausted", "tpd")
_QUOTA_BLOCK_THRESHOLD = 0.5

def _is_quota_error(text: Optional[str]) -> bool:
    if not text:
        return False
    return any(sub in text.lower() for sub in _QUOTA_ERROR_SUBSTRINGS)

def _quota_summary(rows: list[dict]) -> tuple[bool, int]:
    if not rows:
        return False, 0
    quota_related = sum(1 for r in rows if _row_is_quota_related(r))
    return (quota_related / len(rows)) >= _QUOTA_BLOCK_THRESHOLD, quota_related
```
Detection is deliberately simple: case-insensitive substring matching against known Groq error text, applied to whatever error string a row captured (from a failed pipeline run, or from a failed judge call — `_row_is_quota_related()` checks both). If **50% or more** of the items in a run show a quota-related error, the whole run is treated as quota-blocked and falls back to cache; below that threshold, the live (partial) results are kept and shown as-is, on the reasoning that a couple of transient failures in an otherwise-successful run are real signal worth seeing, not something to paper over with a cached snapshot.

### 7.5.3 `--live-only` and `--replay` flags

```
python -m evals.run all              # live-first, cached fallback (default)
python -m evals.run all --live-only  # fail loudly on quota, don't fall back
python -m evals.run all --replay     # skip the API entirely, render cached results
```
`--live-only` exists for exactly one purpose: proving the failure is real, not the fallback masking it — it disables the automatic fallback and exits with a clear error message and a non-zero exit code, useful for a CI-style check where "silently showing old data" would be the wrong behavior. `--replay` skips the live API entirely and renders the newest cached file — useful for iterating on the *display* code (the `rich` tables, or the frontend's scorecard rendering) without spending any quota at all.

### 7.5.4 Graceful degradation: `judge_failed` rows

Every judge function returns a `judge_failed: bool` flag alongside its scores. It's `True` in exactly two cases: the judge's raw response couldn't be parsed as JSON ([7.3.3](#733-why-json-output-and-how-parse-failures-are-handled)), or the judge LLM call itself raised an exception:
```python
# backend/evals/judges.py
def _invoke_judge(prompt: str) -> tuple[Optional[dict], str]:
    llm = _get_judge_llm()
    try:
        raw = _message_text(llm.invoke(prompt).content)
    except Exception as exc:
        logger.warning("judge LLM call failed: %s", exc)
        return None, f"<judge call failed: {exc}>"
    parsed = _extract_json(raw)
    ...
```
This `try/except` around `llm.invoke(...)` was added after a real crash — the eval harness's own history includes a case where a Groq rate-limit exception raised from *inside* the judge call was not caught anywhere, and crashed the entire eval run with a raw Python traceback instead of failing gracefully. The fix — catching the exception here and returning `judge_failed=True` with the exception text preserved as `raw_judge_output` — means one bad judge call now degrades a single row's scores to `None` rather than aborting every other row that hadn't been judged yet. This is also *precisely* the mechanism the quota-detection logic in [7.5.2](#752-quota-detection-logic) reads (`scores.get("judge_failed") and _is_quota_error(scores.get("raw_judge_output"))`) to tell a quota-caused judge failure apart from a data/parsing failure.

## 7.6 Reading a scorecard — walk through a real one and interpret it

A real research scorecard, from a clean single-topic smoke-test run:

```
Topic: R01 Recent breakthroughs in fusion energy...   Status: completed
Cov: 4   Dep: 3   Str: 5   Cite: 1   KW Recall: 0.00   Overall: 3.0   Time: 0m 25s
```
How to read this: `Structure` (5/5) and `Coverage` (4/5) are strong — the report is well-organized and reasonably broad. `Citations` (1/5) is a genuine weak spot — and `keyword_recall: 0.00` independently confirms something concrete went wrong: the report mentioned *neither* of R01's required keywords ("National Ignition Facility", "net energy gain"), which is a real, specific, actionable finding — this run's report likely leaned on general fusion-energy knowledge rather than the specific breakthrough the topic asked about. This is the split between judged and deterministic metrics ([7.3.4](#734-the-split-between-judged-subjective-and-computed-deterministic-metrics)) paying off directly: the `Citations` score alone tells you *something* is off; `keyword_recall` tells you *specifically what*.

A real RAG scorecard row:
```
Q03 | factual | What BLEU score does the 'big' Transformer...
Correct: 1   Faithful: 5   Complete: 1   Overall: 1   Retrieval: ✓
```
Read together: `Retrieval: ✓` means the right page *was* found and handed to the model. `Faithful: 5` means the model didn't hallucinate — whatever it said, it didn't invent facts unsupported by the context. But `Correct: 1` and `Complete: 1` mean the actual answer was wrong or badly incomplete anyway. This is a genuinely interesting, specific finding a single "did it work? yes/no" metric would have hidden entirely: the *retrieval* half of the RAG pipeline did its job correctly here, but the *generation* half failed to extract the specific number correctly from context it definitely had — a targeted signal for exactly where to investigate (the prompt's instruction clarity, or the model's numeric-extraction reliability), not "RAG is broken."

## 7.7 Limitations

Stated plainly, not softened:

- **The judge shares the same underlying model family as the systems it's judging** (both are Groq/Llama 3.3 70B calls). This isn't independent verification by a differently-trained model — any systematic blind spot Llama 3.3 70B has could, in principle, be invisible to a judge built on the same model.
- **A quota-blocked eval falling back to cache can go stale.** If real regressions happen after the last successful cache but before the next successful live run, `/evals` will keep showing the old (better) numbers until quota resets and a live run actually succeeds — a real, accepted tradeoff for "never show a blank/broken page," not a free lunch.
- **The refusal-phrase list ([7.4.5](#745-adversarial-refusal-rate)) is an enumeration, not exhaustive.** A correctly-refusing answer phrased outside the known list is miscounted as a failure.
- **Small sample size.** Five research topics and eight RAG questions are enough to be genuinely informative and to catch real regressions, but nowhere near enough to make statistically rigorous claims about overall system quality — a single flaky/lucky run can meaningfully move an aggregate mean.
- **No inter-rater reliability check.** There's no measurement of how consistent the judge's own scores are across repeated calls on the identical input — temperature 0 makes this *likely* to be stable, but that likelihood has never itself been measured in this project.

## 7.8 How to modify

**Adding test cases** — append a new object to `research_topics.json` (needs `id`, `topic`, `must_mention`, `difficulty`) or `rag_qa_pairs.json` (needs `id`, `question`, `gold_answer`, `gold_page_hint`, `type`). No code changes required — both eval runners load the full dataset file and slice with `--limit` at run time.

**Adding a metric** — for a deterministic metric: add the computation directly in `judge_research_report()`/`judge_rag_answer()` in `judges.py` (following the `keyword_recall` pattern — compute it in Python from data already available, don't send it to the judge). For a judged metric: add a new field to the relevant rubric's JSON shape in the prompt text, and add it to the tuple of keys the function extracts from the parsed response (`_RESEARCH_SCORE_KEYS` or the equivalent inline handling in `judge_rag_answer`). Either way, also update `report.py`'s `print_research_report()`/`print_rag_report()` to add a column for it, and `frontend/src/pages/EvalsPage.jsx`'s scorecard rendering to display it — full numbered walkthrough: [13.5](./13-extending-this-project.md#1335-adding-a-new-eval-metric).

**Swapping the judge** — change the model in `_get_judge_llm()` in `judges.py`. Keep `temperature=0` ([7.3.2](#732-why-temperature0-on-the-judge)) unless you have a specific reason not to, and re-verify the new model reliably follows the "JSON only, no fences" instruction — a model that wraps JSON in more prose than `_extract_json()`'s regex expects will silently increase your `judge_failed` rate.

---

**Next:** [08-auth-system.md](./08-auth-system.md), or skip ahead to [10-deployment.md](./10-deployment.md) if you're trying to actually run/deploy this.
