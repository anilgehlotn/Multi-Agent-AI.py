# 5. Research Pipeline

## 5.1 The four-stage design, and why it's four stages

```
Topic → Search Agent → Reader Agent → Writer Chain → Critic Chain → Report + Feedback
```

Each stage exists to fix a specific weakness of the stage before it, rather than being an arbitrary pipeline depth:

- **Search alone** gives breadth (many sources' worth of snippets) but no depth — search results are, by nature, short summaries, not full context.
- **Reader** adds depth by going deep on one source, trading breadth for detail.
- **Writer** turns raw, messy search+scrape text into an organized, human-readable document — neither Search nor Reader output is meant to be read directly by a user.
- **Critic** adds a self-check step that a single-pass pipeline doesn't get "for free" — an independent (well, independently-*prompted*; same underlying model) pass whose only job is to find weaknesses in the Writer's output, surfaced to the user alongside the report rather than hidden.

Four stages, not three or five, because that's the minimum needed to cover "gather broadly → go deep once → synthesize → self-critique" without a stage that's redundant with another. See [5.7](#7-how-to-modify-adding-a-fifth-agent-changing-a-prompt-swapping-the-search-provider) for what adding a fifth stage (e.g. a second Reader pass on a different URL) would look like.

## 5.2 Stage 1: Search Agent

### 5.2.1 What it does

Given the user's topic, it decides what to search for and calls the `web_search` tool, then reports back what it found — titles, URLs, and short content snippets for up to 5 results.

### 5.2.2 The `web_search` tool

```python
# backend/agents/tools.py
@tool
def web_search(query: str) -> str:
    """Search the web for recent and reliable information on a topic. Returns Titles, URLs and snippets."""
    results = tavily.search(query=query, max_results=5)
    out = []
    for r in results['results']:
        out.append(f"Title: {r['title']}\nURL: {r['url']}\nSnippet: {r['content'][:300]}\n")
    return "\n----\n".join(out)
```
**Tavily** is a search API purpose-built for LLM applications — it returns clean, pre-summarized results (title/URL/content snippet) rather than raw search-engine HTML that would need its own parsing. `max_results=5` is a deliberate ceiling: enough results to give the Reader agent (next stage) a genuine choice of source, without ballooning the token count of what gets fed back into the pipeline — every result's snippet is also hard-truncated to 300 characters (`r['content'][:300]`) for the same reason: enough to judge relevance, not so much that five results' worth of snippets blows the context budget before the pipeline has even reached the writing stage.

### 5.2.3 Why this is an agent, not a chain

The Search stage needs to *decide* what search query to actually send `tavily.search()` — it isn't necessarily just the raw topic string verbatim; the model can (and does, based on its own judgment) reformulate the topic into a better search query. That's a tool-invocation decision (what arguments to call the tool with), which is exactly the boundary described in [2.7.5](./02-concepts-primer.md#275-agents-vs-chains--when-to-use-which-and-why-this-project-uses-both) — hence `create_agent(model=llm, tools=[web_search])` rather than a fixed chain.

## 5.3 Stage 2: Reader Agent

### 5.3.1 Why scraping after searching

Search gives breadth but only ~300-character snippets per source — nowhere near enough detail to write a substantive report from. The Reader stage exists specifically to go *deep* on one source: scrape the full page text of whichever URL looks most promising, giving the Writer stage something closer to a genuine source document rather than a pile of snippets.

### 5.3.2 The `scrape_url` tool

```python
# backend/agents/tools.py
@tool
def scrape_url(url: str) -> str:
    """Scrape and return clean text content from a given URL for deeper reading."""
    try:
        resp = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:3000]
    except Exception as e:
        return f"Could not scrape URL: {str(e)}"
```
- **`timeout=8`** — an 8-second cap on the HTTP request. Scraping an arbitrary URL found by a search API is inherently unpredictable (slow servers, hung connections); a hard timeout keeps one bad URL from stalling the whole pipeline for an unbounded amount of time.
- **`headers={"User-Agent": "Mozilla/5.0"}`** — some sites block requests that don't look like they're coming from a real browser (the default `requests` user-agent string is a well-known bot signature); this is a minimal, honest-enough spoof to avoid being trivially blocked, not an attempt at deep evasion.
- **`soup(["script", "style", "nav", "footer"])` → `.decompose()`** — strips script/style tags (never useful as "content" — it's code or CSS, not prose) and nav/footer (typically boilerplate — site navigation, copyright text — that dilutes the actual article content with noise).
- **`[:3000]`** — a hard character cap. This is the single biggest tradeoff in this stage: a genuinely long, information-dense article gets cut off mid-content, potentially losing the back half of an argument or a set of details that appeared later in the page. It exists for the same reason as every other truncation in this codebase — token budget. The Writer stage's prompt combines *both* the search results and this scraped content into one `research_combined` string (see [5.4.1](#541-the-prompt-dissected-clause-by-clause)); an unbounded scrape could dominate that combined context and risk exceeding the model's context window or blowing through the token budget for a single pipeline run. 3000 characters (~500-600 words) is enough for a solid, if not exhaustive, chunk of source material.
- **`except Exception as e: return f"Could not scrape URL: {str(e)}"`** — deliberately returns a string, not a raised exception (see [4.5](./04-backend-walkthrough.md#45-agentstoolspy)), so a single unreachable/blocked URL degrades gracefully into a message the agent (and ultimately the report) can acknowledge, rather than crashing the entire research run.

### 5.3.3 Why the agent picks the URL, not the code

`pipeline.py` doesn't parse Search's output to programmatically extract "the best URL" and pass it directly to `scrape_url()` — it hands the Reader agent the raw search results text and lets the *model* decide which URL is most relevant and worth scraping:
```python
# backend/agents/pipeline.py
reader_result = reader_agent.invoke({
    "messages": [("user",
        f"Based on the following search results about '{topic}', "
        f"pick the most relevant URL and scrape it for deeper content.\n\n"
        f"Search Results:\n{state['search_results'][:800]}"
    )]
})
```
This is a judgment call, not a mechanical one — "most relevant" depends on understanding what the topic actually needs, which is exactly the kind of decision agents (vs. hardcoded logic) are suited for. A hand-coded heuristic (e.g. "always pick the first result") would be simpler and cheaper, but would miss cases where, say, the third result is a primary source and the first is a low-quality aggregator — the tradeoff accepted here is one extra layer of LLM judgment for (hopefully) better source selection.

The `[:800]` truncation on `search_results` before it's handed to the Reader agent is, again, a token-budget guard — the Reader only needs enough of the search results to make a URL-selection decision, not the full un-truncated text.

## 5.4 Stage 3: Writer Chain

### 5.4.1 The prompt, dissected clause by clause

```python
# backend/agents/research_agents.py
writer_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an expert research writer. Write clear, structured and insightful reports."),
    ("human", """Write a detailed research report on the topic below.

Topic: {topic}

Research Gathered:
{research}

Structure the report as:
- Introduction
- Key Findings (minimum 3 well-explained points)
- Conclusion
- Sources (list all URLs found in the research)

Be detailed, factual and professional."""),
])
```
Already covered in depth at [2.2.4](./02-concepts-primer.md#224-walking-through-this-projects-actual-prompts) — the short version repeated here for locality: the explicit section list forces consistent structure across runs (unconstrained, LLM report length/shape varies wildly); "minimum 3" prevents a lazy one-bullet "Key Findings" section; "list all URLs found in the research" instructs extraction from the given context rather than invention. `{research}` here is `research_combined`, built in `pipeline.py`:
```python
research_combined = (
    f"SEARCH RESULTS:\n{state['search_results']}\n\n"
    f"DETAILED SCRAPED CONTENT:\n{state['scraped_content']}"
)
```
Note this uses the **full, untruncated** `search_results` (unlike the `[:800]` slice handed to the Reader agent) — by the time we reach the Writer stage, the pipeline wants everything it gathered available for synthesis, not just enough for a URL-picking decision.

### 5.4.2 Why the required structure

Covered in [5.4.1](#541-the-prompt-dissected-clause-by-clause) above and [2.2.4](./02-concepts-primer.md#224-walking-through-this-projects-actual-prompts) — repeating the core point because it's easy to underrate: this single design choice (an explicit, named section list) is most of what makes the Writer stage's output consistently *usable* as a report rather than an unpredictable blob of prose.

### 5.4.3 Why a chain, not an agent

The Writer stage always does exactly one thing in exactly one shape: take a topic + gathered research text, produce a report. There's no tool to call, no decision about *what to do next* — it's a single, fixed LLM call. Per [2.7.5](./02-concepts-primer.md#275-agents-vs-chains--when-to-use-which-and-why-this-project-uses-both), that's precisely the case a chain (`writer_prompt | llm | StrOutputParser()`) fits, and using an agent here would add tool-loop overhead (more calls, more tokens, more latency) for a task that never needs to call a tool.

## 5.5 Stage 4: Critic Chain

### 5.5.1 The prompt, dissected

```python
# backend/agents/research_agents.py
critic_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a sharp and constructive research critic. Be honest and specific."),
    ("human", """Review the research report below and evaluate it strictly.

Report:
{report}

Respond in this exact format:

Score: X/10

Strengths:
- ...
- ...

Areas to Improve:
- ...
- ...

One line verdict:
..."""),
])
```
"Be honest and specific" in the system message exists to counteract LLMs' well-documented tendency toward reflexively positive, hedge-everything feedback — without an explicit push toward criticism, "evaluate strictly" alone tends to still produce softened, non-committal output.

### 5.5.2 Why the exact output format is specified

The Critic's output is stored and displayed to the user **verbatim, as markdown** — `ResearchResults.jsx` renders `run.feedback` through `ReactMarkdown` with no parsing on the backend at all. The literal template (`Score: X/10`, `Strengths:` / `Areas to Improve:` / `One line verdict:`) is therefore doing the job of both a readability contract (the user sees this exact shape every time) and an implicit structure guarantee, even though — unlike the eval judges' JSON output (see [7.3.3](./07-evaluation-module.md#733-why-json-output-and-how-parse-failures-are-handled)) — nothing on the backend actually parses or validates that the model followed the format. If the model drifts from the template, the UI still renders whatever text came back; it just may look less consistent.

### 5.5.3 What self-critique buys you, and what it doesn't

What it buys: a second look at the report, from a differently-prompted pass of the same underlying model, surfaced directly to the user rather than hidden — genuine value in that a report's weaknesses (thin evidence on one point, missing counter-perspective) are called out explicitly instead of silently shipped.

What it doesn't buy: true independent verification. The Critic is *not* a differently-trained model, doesn't have access to any information the Writer didn't have, and shares whatever blind spots or biases the underlying model has. A hallucinated claim in the report that the model itself finds plausible is not reliably going to be caught by asking the same model to review it — self-critique catches structural/stylistic weaknesses and surface-level gaps far more reliably than it catches subtle factual errors. This is exactly the kind of thing the evaluation module (an *external*, rubric-driven, deterministic-metrics-backed check — [07-evaluation-module.md](./07-evaluation-module.md)) exists to measure more rigorously than a same-model self-critique ever could.

## 5.6 Orchestration

### 5.6.1 The callback design — `on_step_start` / `on_step_complete`

```python
# backend/agents/pipeline.py
def run_research_pipeline_with_callback(
    topic: str,
    on_step_start: Optional[Callable[[str], None]] = None,
    on_step_complete: Optional[Callable[[str, dict], None]] = None,
) -> dict:
```
Two hooks, fired immediately before and after each of the four stages. This is the entire mechanism behind the frontend's live-updating pipeline UI ([09-frontend-walkthrough.md](./09-frontend-walkthrough.md#95-the-pipeline-status-ui--how-backend-steps-json-maps-to-card-states)) — the router's `_execute_run()` passes closures that call `service.mark_step(db, run_id, step, "running" | "done")`, so every stage transition is written to the database the instant it happens, and the frontend's 2-second poll picks it up.

### 5.6.2 Why callbacks default to no-ops

```python
on_step_start = on_step_start or (lambda step: None)
on_step_complete = on_step_complete or (lambda step, result: None)
```
This function also has to work when called with *no* callbacks at all — from the CLI entry point at the bottom of the same file (`if __name__ == "__main__":`, used for standalone testing via `python -m agents.pipeline`), which has no database session and no run ID to update. Rather than branching pipeline logic on "am I running under FastAPI or standalone," every call site of `on_step_start`/`on_step_complete` is unconditional — it always fires, and it's the *default value* of the callback (a no-op) that makes that safe when there's nothing that needs to be notified.

### 5.6.3 The `_message_text()` normalizer

Already covered in [4.7](./04-backend-walkthrough.md#47-agentspipelinepy) and [12.2](./12-known-issues-and-gotchas.md#122-agent-message-content-can-be-a-list-of-dicts-not-a-string) — the short version, for locality: LangChain agent responses can return `.content` as either a plain string or a list of `{"type": "text", "text": "..."}` content-part dicts, and writing the list form directly into a SQLite `Text` column raises `sqlite3.InterfaceError: Error binding parameter: type 'list' is not supported`. `_message_text()` normalizes either shape to a plain string before it's ever stored.

### 5.6.4 Failure handling — why `fail_run()` calls `db.rollback()` first

Covered in full at [4.9](./04-backend-walkthrough.md#49-researchservicepy) and [12.3](./12-known-issues-and-gotchas.md#123-the-swallowed-exception-bug). The one-sentence version: `fail_run` is the exception-handler path, and if the exception it's handling came from an earlier failed `db.commit()` on the same session, every further query on that session (including the one inside `fail_run` itself) raises `PendingRollbackError` unless `db.rollback()` runs first — which is why it's the literal first line of the function.

## 5.7 How to modify: adding a fifth agent, changing a prompt, swapping the search provider

**Adding a fifth stage** — say, a second Reader pass that scrapes a *different* URL for a second perspective: add a new key to `_default_steps()` in `db/models.py`, add a new stage block in `run_research_pipeline_with_callback()` (with its own `on_step_start`/`on_step_complete` calls), update `writer_prompt`'s `{research}` construction to include the new content, and add a corresponding card to `STEPS` in `frontend/src/components/PipelineSteps.jsx`. Full numbered walkthrough: [13.1](./13-extending-this-project.md#1331-adding-a-new-agent-to-the-research-pipeline).

**Changing a prompt** — edit the relevant `ChatPromptTemplate` in `research_agents.py` directly. No other file needs to change *unless* you also change the output's expected shape (e.g. asking the Critic for a JSON score instead of the free-text template) — in that case, `ResearchResults.jsx`'s rendering (currently raw markdown) would also need updating to parse/display the new shape.

**Swapping the search provider** (Tavily → something else — SerpAPI, Bing, a different API): change `agents/tools.py`'s `web_search()` implementation to call the new provider's client instead of `tavily.search(...)`, keeping the same return shape (a string of `Title/URL/Snippet` blocks) so nothing downstream needs to change. Update `backend/.env.example` and `config.py`/`main.py`'s `validate_environment()` check if the new provider needs a different env var name than `TAVILY_API_KEY`.

---

**Next:** [06-rag-system.md](./06-rag-system.md) for the same depth of treatment on the PDF Q&A system.
