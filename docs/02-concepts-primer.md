# 2. Concepts Primer

This is the file to read if you don't come from an AI/ML background. It assumes you can read Python but has never heard the words "embedding," "vector database," "RAG," or "agent" used in this context. Every concept follows the same four-part pattern: **what it is** (plain English), **why it exists** (what problem it solves), **how this project uses it** (real code), **what else exists** (alternatives and why they weren't picked).

Every term defined here also appears in [14-glossary.md](./14-glossary.md) for quick lookup later. Section numbers are stable — other docs refer back to this one as "see 2.5.4," etc.

---

## 2.1 Large Language Models

### 2.1.1 What an LLM actually is

A Large Language Model (LLM) is a program that has read an enormous amount of text and learned, statistically, what word (or word-fragment) is most likely to come next after any given sequence of words. That's the entire mechanism. When you ask an LLM a question, it isn't "looking up" an answer or "thinking" the way a person does — it's generating the most statistically plausible continuation of your text, one small chunk at a time, using patterns learned from its training data.

Concretely: you give it "The capital of France is", and it has learned from millions of documents that the word "Paris" follows that phrase far more often than "banana" does. It outputs "Paris." Then it treats "The capital of France is Paris" as the new input and predicts the next chunk after that. This repeats until the model decides it's done (it predicts a special "stop" token) or a length limit is hit.

This is why LLMs can write fluent, coherent, structured text on almost any topic — fluency is exactly what next-token prediction, done at massive scale, produces. It's also why LLMs can state confident-sounding falsehoods (see **hallucination**, [2.5.1](#251-the-problem-rag-solves)) — nothing in the mechanism distinguishes "statistically likely" from "true."

### 2.1.2 What a "token" is and why it matters

A **token** is the actual unit an LLM reads and generates — not quite a word, not quite a character. Common English words are often one token ("the", "cat"); longer or rarer words get split into pieces ("chunking" might become "chunk" + "ing"). As a rule of thumb, 1,000 tokens ≈ 750 English words.

Tokens matter for three practical reasons in this project:

1. **Cost/quota** — every provider bills (or rate-limits) by token count, not by request count. A short question costs little; pasting an entire PDF into a prompt costs a lot.
2. **Context limits** — every model has a maximum number of tokens it can consider at once (input + output combined). Exceed it and the request fails or gets silently truncated.
3. **The failure mode that actually hit this project** — Groq's free tier caps usage at **100,000 tokens per day (TPD)**, not per request. This project ran into that cap directly during evaluation runs (see [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits)). This is why prompts in this codebase are deliberately truncated — e.g. `report_text[:6000]` in `backend/evals/judges.py` before sending a report to the judge model, and `state['search_results'][:800]` in `backend/agents/pipeline.py` before handing search results to the Reader agent. Every character not sent is tokens not spent.

### 2.1.3 Temperature, and why this project uses 0 for most things

**Temperature** is a number (usually 0 to 2) that controls how "random" an LLM's next-token choice is. At temperature 0, the model always picks the single most likely next token — same input, same output, every time (in practice, "almost always the same," because some providers have tiny nondeterminism in how they batch requests on their servers). At higher temperatures, the model sometimes picks a less-likely token on purpose, producing more varied, more "creative," and less predictable output.

This project sets `temperature=0` everywhere an LLM is instantiated:

```python
# backend/agents/research_agents.py
llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
```
```python
# backend/evals/judges.py
_judge_llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
```

**Why:** two different reasons for two different uses. For the research/RAG pipeline, temperature 0 means a "how does the pipeline handle X" bug is reproducible — you can rerun the same topic and get essentially the same report, which makes debugging tractable. For the eval judges, temperature 0 is closer to a requirement than a preference: the whole point of an eval is to compare runs over time, and a judge that scores the same report differently each time it's asked would make the scores meaningless noise. The project's docs describe this as "deterministic-ish" rather than "deterministic" — provider-side nondeterminism at temp 0 is small but not strictly zero.

The alternative — a higher temperature for the Writer chain, to get more "interesting" prose — was considered and rejected for the same reproducibility reason: a portfolio project benefits more from "I can show you the same report twice" than from stylistic variety.

### 2.1.4 API-based LLM vs. a local model

An **API-based LLM** runs on someone else's servers (Groq, Google, OpenAI, etc.); your code sends a request over the network and gets a response back. A **local model** runs on your own machine or server — you download the model's weights (often several gigabytes to hundreds of gigabytes) and run inference yourself, using your own CPU/GPU.

|  | API-based | Local |
|---|---|---|
| Setup | An API key | Download weights, install a runtime (e.g. `transformers`, `torch`), provision GPU/CPU/RAM |
| Cost model | Pay (or free-tier quota) per token | Pay once for hardware, then "free" per call (electricity aside) |
| Latency | Network round-trip + provider queue | No network hop, but often slower per-token on modest hardware without a GPU |
| Data privacy | Your prompts leave your infrastructure | Nothing leaves your machine |
| Deployability | Trivial — any server with internet access | Needs enough RAM/VRAM to hold the model; often prohibitive on free-tier hosting |

This project uses API-based LLMs exclusively (Groq for chat, Gemini for embeddings). The deciding factor was the deployment target: Render's free tier caps a container at **512 MB RAM**. A local 70B-parameter model needs on the order of 40+ GB of RAM just to hold its weights — not remotely close. Even a "small" local embedding model (`sentence-transformers`, which this project used to have as a dependency) pulls in `torch` and pushed the Docker image and idle RAM footprint high enough to get OOM-killed on Render; removing it dropped the backend image from **2.9 GB to 240 MB** and idle RAM from roughly **800 MB to 160 MB** (see [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)). API-based was never really a choice against local here — local was never viable on the target infrastructure.

### 2.1.5 Which LLMs this project uses, and where

| Model | Provider | Used for | Where in the code |
|---|---|---|---|
| Llama 3.3 70B (`llama-3.3-70b-versatile`) | Groq | Search agent, Reader agent, Writer chain, Critic chain, RAG answer generation, eval judges | `backend/agents/research_agents.py`, `backend/rag_api/service.py`, `backend/evals/judges.py` |
| `models/gemini-embedding-001` | Google Gemini | Turning PDF text chunks into vectors for search (never generates chat text) | `backend/rag_api/service.py` |

Every chat/reasoning call in this project goes to Groq. Gemini is used for exactly one thing: embeddings. See [2.3.4](#234-which-embedding-model-this-project-uses-and-why) for why those are split across two providers instead of using one for both.

---

## 2.2 Prompts and prompt engineering

### 2.2.1 What a prompt is

A **prompt** is the text you send an LLM as input — the thing it's completing. Prompt engineering is the practice of writing that text carefully, because small wording changes measurably change output quality, format, and reliability. It sounds unscientific ("just ask nicely, but more precisely") because it largely is — there's no compiler checking a prompt for correctness, only trial, observation, and convention.

### 2.2.2 System prompt vs. human prompt

Most chat-style LLM APIs (including Groq's, via LangChain) accept a list of messages, each tagged with a role. This project uses two roles:

- **`system`** — sets the model's persona/behavior for the whole conversation. It's meta-instruction: "you are an expert research writer," not part of the actual task content.
- **`human`** (a.k.a. `user`) — the actual task/question/content for this turn.

Splitting these matters because models are trained to treat them differently — the system message tends to have a longer-lasting, more "identity-setting" effect, while the human message is the specific thing to respond to right now. Concretely, from `backend/agents/research_agents.py`:

```python
writer_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an expert research writer. Write clear, structured and insightful reports."),
    ("human", """Write a detailed research report on the topic below. ..."""),
])
```

The system message ("expert research writer") stays constant no matter what topic is passed in; only the human message's content changes per call. This separation is also why the RAG answer prompt (`backend/rag_api/service.py`) puts the grounding rule — "use ONLY the provided context" — in the `system` message rather than burying it in the human message alongside the actual question: it's a standing behavioral constraint, not part of this turn's specific ask.

### 2.2.3 Prompt templates, and why not just concatenate strings

A **prompt template** is a prompt with placeholders (`{topic}`, `{report}`) that get filled in at call time, instead of building the final string with Python f-strings or `.format()` calls scattered through business logic. LangChain's `ChatPromptTemplate.from_messages([...])` is this project's templating mechanism.

Why not just write `f"Write a report on {topic}"` inline? Two reasons visible in this codebase:

1. **Reuse as a pipeline stage.** A `ChatPromptTemplate` is itself an object that can be composed with `|` into a chain (see [2.8](#28-chains)) — `writer_prompt | llm | StrOutputParser()`. An f-string is just a string; it can't be piped into anything.
2. **Escaping and structure.** Templates handle multi-message structure (system + human, in order) and keep placeholder substitution separate from message structure, so a stray `{` or `}` inside actual content (like JSON examples in the judge prompts, see [2.2.4](#224-walking-through-this-projects-actual-prompts)) doesn't get misinterpreted as a template variable — which is exactly why those prompts double up braces (`{{` / `}}`) around literal JSON.

### 2.2.4 Walking through this project's actual prompts

Every prompt in this codebase was written with a specific failure mode in mind. Here's each one, and why it says what it says.

**Writer prompt** (`backend/agents/research_agents.py`):
```python
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
- The explicit structure list (Intro / Findings / Conclusion / Sources) exists because LLMs, left unconstrained, produce reports of wildly inconsistent shape and length — one run might be three paragraphs, another might be a bulleted outline. Naming the exact sections forces a consistent, skimmable document every time.
- "minimum 3 well-explained points" is there because without a floor, a lazy completion can satisfy "Key Findings" with a single bullet.
- "Sources (list all URLs found in the research)" is a deliberate instruction to *extract from the provided context*, not invent — it's telling the model to cite what's actually in `{research}`, which reduces (does not eliminate) the chance of fabricated URLs. See [7.7](./07-evaluation-module.md#77-limitations) for how the eval module measures whether this actually holds.

**Critic prompt** (`backend/agents/research_agents.py`):
```python
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
- "Respond in this exact format" with a literal template (`Score: X/10`, etc.) exists because this feedback is displayed to the user as-is (see `ResearchResults.jsx`) — there's no parsing of the critic's output on the backend, it's stored and rendered as raw markdown-ish text. The format instruction is doing double duty as both a readability constraint and a de facto output contract, even though nothing enforces it at the code level (contrast with the judge prompts below, which *are* parsed).
- "Be honest and specific" in the system message exists to counteract a well-documented LLM tendency toward uncritical, flattering feedback — asking for criticism without pushing against that tendency tends to produce weak, hedge-everything critiques.

**RAG answer prompt** (`backend/rag_api/service.py`):
```python
_RAG_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        """You are a helpful AI assistant.

Use ONLY the provided context to answer the question.

If the answer is not present in the context,
say: "I could not find the answer in the document."
""",
    ),
    (
        "human",
        """Context:
{context}

Question:
{question}
""",
    ),
])
```
- "Use ONLY the provided context" is the single most important line in this project's prompts — it's the entire mechanism behind **grounding** (see [2.5.5](#255-what-grounding-means-and-how-the-prompt-enforces-it)). Without it, the model will happily answer from its general training knowledge, silently ignoring your PDF, which defeats the purpose of RAG.
- The exact refusal phrase — `"I could not find the answer in the document."` — is specified verbatim, not just "say you don't know," because the eval module's deterministic refusal check (`_looks_like_refusal()` in `backend/evals/judges.py`) pattern-matches against a list of phrases including this one. A looser instruction risks the model phrasing its refusal in a way the eval can't detect automatically.

**Judge prompts** (`backend/evals/judges.py`) — covered in full in [7.3](./07-evaluation-module.md#73-the-judges), but the one design choice worth calling out here: every judge prompt ends with an explicit, literal JSON shape (`{{"coverage": <int 1-5>, ...}}`) and the instruction "Return ONLY valid JSON, no prose, no markdown fences." This is because the judge's output is *parsed* by `_extract_json()` — unlike the Critic chain's prose output, a malformed judge response is a hard failure the calling code has to handle (see [7.5.4](./07-evaluation-module.md#754-graceful-degradation-judge_failed-rows)), so the prompt is written to minimize the chance of the model wrapping its answer in explanatory text or markdown fences.

---

## 2.3 Embeddings

### 2.3.1 What an embedding is

An **embedding** is a list of numbers (a vector) that represents the *meaning* of a piece of text, produced by a specially-trained model. Two pieces of text with similar meaning get lists of numbers that are numerically close to each other; two pieces of text with unrelated meaning get lists of numbers that are numerically far apart.

Analogy: imagine plotting every word or sentence you've ever read as a point on a giant map, where the map is arranged so that similar ideas cluster near each other — "dog" near "puppy" and "canine," far from "stock market." An embedding model is the thing that decides where on that map a new piece of text lands. The "map" in a real embedding model isn't 2D like a physical map — it typically has hundreds or thousands of dimensions — but the intuition (nearness = similarity) carries over directly.

### 2.3.2 Why "similar meaning = close numbers" is useful

Because it turns "find text about roughly the same thing" — a fuzzy, human, semantic question — into "find the nearest points to this point," which is a well-understood, fast, purely mathematical operation. This is the entire trick that makes semantic search possible: you don't need the exact words to match (unlike a `Ctrl+F` or a SQL `LIKE` query), you need the *meaning* to match. A search for "how does the model handle position information" can find a chunk that talks about "positional encodings" even though no word in the query literally appears in the chunk — because the embeddings of both land near each other on the meaning-map.

### 2.3.3 What dimensionality means, practically

Each embedding is a vector of some fixed length — its **dimensionality**. Gemini's `models/gemini-embedding-001` (the model this project uses) produces high-dimensional vectors; the exact number is an implementation detail of the provider and isn't hardcoded anywhere in this codebase (LangChain's `GoogleGenerativeAIEmbeddings` wrapper handles it transparently). Practically, what matters is: higher dimensionality generally captures more nuance in meaning but costs more to store and search; it's not something this project tunes directly, since it's fixed by the choice of embedding model.

### 2.3.4 Which embedding model this project uses, and why

```python
# backend/rag_api/service.py
embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
```

This project uses Google's Gemini embedding API for every embedding call — both when indexing an uploaded PDF and when embedding a user's question at query time (the two vectors have to come from the same model, or "close" wouldn't mean anything consistent between them).

**Why Gemini and not Groq:** Groq does not offer an embeddings endpoint at all — it's a chat-completion-only API. So this project necessarily uses two providers: Groq for every chat/reasoning call, Gemini for every embedding call. See [11.1](./11-design-decisions.md#111-groq-for-chat-gemini-for-embeddings) for the full reasoning.

**Why an API-based embedding model and not a local one (`sentence-transformers`)**: this project originally used `sentence-transformers`, a Python library that runs embedding models locally, no API key required. It was removed. `sentence-transformers` depends on `torch` (PyTorch), which alone is several hundred megabytes to a few gigabytes depending on the build, and which — critically — pulled the backend's idle RAM footprint high enough to get OOM-killed on Render's 512 MB free tier. Switching every embedding call to the Gemini API (already a dependency, since it's also imaginable for chat in earlier iterations of this project) removed `torch`, `sentence-transformers`, and `transformers` entirely, taking the Docker image from **2.9 GB to 240 MB** and idle RAM from roughly **800 MB to 160 MB**. Full writeup: [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers).

---

## 2.4 Vector databases

### 2.4.1 What a vector DB is, and why a normal database can't do this

A **vector database** stores embeddings (see [2.3](#23-embeddings)) and answers a specific kind of question efficiently: "given this vector, which stored vectors are closest to it?" A normal relational database (SQLite, Postgres) is built to answer *exact-match* and *range* questions fast — `WHERE user_id = 5`, `WHERE created_at > '2026-01-01'` — using indexes like B-trees, which rely on values having a natural sort order.

"Closeness" in high-dimensional space doesn't have that kind of sort order — there's no meaningful way to `ORDER BY` a 700-dimensional vector such that nearby points end up adjacent in the ordering. A vector database uses different index structures (approximate nearest-neighbor algorithms) purpose-built for "find the K closest points in high-dimensional space, fast, even across millions of vectors." You could technically compute distances against every stored vector in a normal database with a stored procedure, but it wouldn't scale — that's a full table scan for every single query.

### 2.4.2 What "similarity search" means mechanically

Similarity search is exactly the operation described above: you provide a **query vector** (e.g. the embedding of a user's question), and the database returns the **k** stored vectors closest to it, typically along with the original text/metadata each vector was created from. "Closest" needs a precise distance definition — that's cosine similarity, next.

### 2.4.3 Cosine similarity, in plain English

**Cosine similarity** measures how similar two vectors are by comparing the *angle* between them, ignoring their length/magnitude. Two vectors pointing in almost the same direction score close to 1 (very similar); two pointing in completely unrelated directions score close to 0; two pointing in opposite directions score close to -1.

No linear algebra required to use it, but the intuition: imagine two arrows drawn from the same starting point. If they point almost the same way, the angle between them is small — cosine similarity is high. If they point in wildly different directions, the angle is large — cosine similarity is low. It deliberately ignores how *long* the arrows are, only the *direction*, because for text embeddings, direction is what encodes meaning; magnitude mostly reflects incidental factors like text length. This project doesn't compute cosine similarity directly anywhere in its own code — ChromaDB does it internally as part of the retriever's similarity search — but it's the mathematical operation underneath every "find relevant chunks" call this project makes.

### 2.4.4 ChromaDB specifically

**ChromaDB** ("Chroma") is the open-source vector database this project uses. Two properties matter here:

1. **It can persist to disk.** Rather than living only in memory for the duration of one process, Chroma can write its index to a directory and reload it later. This project uses that directly:
   ```python
   # backend/rag_api/service.py — indexing
   Chroma.from_documents(
       documents=chunks,
       embedding=embeddings,
       persist_directory=index_dir(session_id),
   )
   ```
   ```python
   # backend/rag_api/service.py — querying, later, possibly a different process
   vectorstore = Chroma(persist_directory=idx_dir, embedding_function=embeddings)
   ```
   `index_dir(session_id)` resolves to `backend/data/rag_indices/{session_id}/` — see [2.4.4.1](#one-directory-per-session) below.

2. **A "collection"** is Chroma's name for a named group of vectors + their metadata — roughly analogous to a table in a relational database. This project doesn't explicitly name collections (it uses Chroma's default collection inside each session's own directory), because it never needs to distinguish multiple collections *within* one persist directory — the directory boundary itself is the isolation mechanism.

#### One directory per session

Every RAG upload gets its own persist directory, named by a UUID (the session ID):
```python
# backend/rag_api/service.py
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_BACKEND_DIR, "data")
RAG_INDICES_DIR = os.path.join(DATA_DIR, "rag_indices")

def index_dir(session_id: str) -> str:
    return os.path.join(RAG_INDICES_DIR, session_id)
```
This means two different users' (or two different uploads') indexes can never collide or bleed into each other's search results — deleting a session is just `shutil.rmtree(idx_dir)` (see `delete_session()` in the same file), with nothing else to clean up. The tradeoff, and the alternative (one shared collection with metadata filtering), is discussed in [11.9](./11-design-decisions.md#119-per-session-chroma-directories-over-one-shared-collection).

### 2.4.5 Alternatives, and their tradeoffs

| Option | What it is | Why not chosen here |
|---|---|---|
| **FAISS** | A Facebook AI library for fast similarity search — extremely fast, but it's a library, not a database: no built-in persistence format, no metadata storage, you build that yourself | More setup work for no benefit at this project's scale (a handful of PDFs, not millions of documents) |
| **Pinecone** | A managed, cloud-hosted vector database (SaaS) | Requires an external account, an API key, and (for meaningful usage) a paid plan; adds a network dependency and cost for something ChromaDB does locally, for free, well enough at this scale |
| **pgvector** | A Postgres extension that adds vector similarity search to a normal Postgres database | Would require running Postgres at all — this project deliberately stays on SQLite (see [11.5](./11-design-decisions.md#115-sqlite-over-postgres)) to avoid a second stateful service to provision and pay for on free-tier hosting |

ChromaDB won because it needs zero external infrastructure — `pip install chromadb`, point it at a directory, done — which matches this project's "runs anywhere, deploys on free tiers" constraint better than any of the alternatives.

---

## 2.5 RAG (Retrieval-Augmented Generation)

### 2.5.1 The problem RAG solves

An LLM only "knows" what was in its training data, frozen at some cutoff date, and it has never seen *your* private documents — your PDF, your company's internal wiki, whatever. Ask it a direct question about your PDF and one of two things happens: it says it doesn't have access (if well-behaved), or it **hallucinates** — generates a fluent, confident-sounding, entirely fabricated answer, because (per [2.1.1](#211-what-an-llm-actually-is)) nothing in its mechanism distinguishes "I actually know this" from "this is a statistically plausible-sounding continuation."

**Retrieval-Augmented Generation (RAG)** solves this by not relying on the model's memory at all. Instead: find the actual relevant passages from your real documents, paste them directly into the prompt as context, and ask the model to answer using only that pasted-in text. The model is now doing reading comprehension on text it can literally see, not recalling from training.

### 2.5.2 The RAG loop

Six stages, always in this order:

```
chunk → embed → store → retrieve → stuff into prompt → generate
```

1. **Chunk** — split the source document into smaller pieces (a whole PDF is too long to embed meaningfully or fit in a prompt).
2. **Embed** — turn each chunk into a vector (see [2.3](#23-embeddings)).
3. **Store** — save the vectors (and their original text) in a vector database (see [2.4](#24-vector-databases)) — this is the "indexing" half of RAG, done once per document.
4. **Retrieve** — at question time, embed the *question*, then search the vector database for the chunks whose vectors are closest to it.
5. **Stuff into prompt** — concatenate the retrieved chunks' text into the LLM prompt as "context."
6. **Generate** — ask the LLM to answer the question using only that context.

This project's implementation of all six stages lives in `backend/rag_api/service.py`: `build_index()` does stages 1–3, `answer_question()` does stages 4–6. Full line-by-line walkthrough: [06-rag-system.md](./06-rag-system.md).

### 2.5.3 Why chunking matters, and what chunk_size/chunk_overlap actually do

You can't embed an entire 15-page PDF as one vector and expect it to usefully represent "the part about positional encodings" *and* "the part about BLEU scores" *and* everything else simultaneously — a single vector averages/blends everything it represents, and a document-sized chunk blends so much that fine-grained retrieval becomes impossible. So documents get split into smaller pieces first, each embedded separately.

`chunk_size` is the target length (in characters, in this project's configuration) of each piece. `chunk_overlap` is how many characters of overlap are shared between consecutive chunks. Overlap exists because a naive hard split can sever a sentence — or an idea — exactly in half, right at a chunk boundary, so that neither resulting chunk contains the complete thought. A little overlap means the end of chunk N and the start of chunk N+1 share some text, so an idea that straddles a boundary is very likely to be fully present in at least one chunk.

### 2.5.4 Why this project uses 1000/200 specifically

```python
# backend/rag_api/service.py
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
```

1000 characters (~150–200 words) is large enough to contain a complete paragraph or a self-contained idea most of the time, but small enough that four or five retrieved chunks (this project retrieves `k=4`, see [2.6.4](#264-why-this-project-chose-mmr-with-k4-fetch_k10-lambda_mult05)) still fit comfortably inside the LLM's context window alongside the question and system prompt. 200 characters of overlap is 20% of the chunk size — enough to catch most boundary-straddling ideas without meaningfully inflating the total number of chunks (and therefore embedding calls) needed to index a document. These are standard, widely-used starting values for this kind of splitter, not numbers tuned specifically for this project's documents — see [11.8](./11-design-decisions.md#118-1000200-chunk-size-and-overlap) for what would justify changing them.

### 2.5.5 What "grounding" means, and how the prompt enforces it

**Grounding** means an LLM's answer is derived from — traceable to — the specific source material it was given, rather than from its general training knowledge. A grounded RAG system that doesn't know something *says so*, instead of guessing.

This project enforces grounding entirely through prompt instruction — there's no code-level mechanism that verifies the model actually only used the provided context:
```python
# backend/rag_api/service.py — the system message
"""You are a helpful AI assistant.

Use ONLY the provided context to answer the question.

If the answer is not present in the context,
say: "I could not find the answer in the document."
"""
```
This is a real limitation, honestly stated: prompt-level grounding is a strong nudge, not a guarantee. The model *can* still ignore the instruction and answer from its training data — this is exactly why the eval module includes **adversarial test cases** (questions with no answer in the source document) that specifically check whether the model actually refuses rather than hallucinates. See [2.9.5](#295-why-the-adversarial-test-cases-exist) and [07-evaluation-module.md](./07-evaluation-module.md).

---

## 2.6 Retrieval strategies

### 2.6.1 Naive similarity search and its failure mode

The simplest retrieval strategy: embed the question, return the top-k closest chunks by cosine similarity, done. The failure mode this project specifically avoids: if a document repeats a point several times in slightly different wording (common in technical papers — an idea introduced in the abstract, restated in the introduction, restated again in the conclusion), naive top-k search can return four *near-duplicate* chunks, all about the same narrow point, because they're all genuinely the closest matches to the question. You've spent your entire retrieval budget on redundant information and left out anything else relevant.

### 2.6.2 MMR (Maximal Marginal Relevance), in plain English

**MMR** is a retrieval strategy that explicitly trades a little bit of pure relevance for diversity. Instead of "give me the k closest chunks," it does something closer to: "give me a relevant chunk, then give me the next chunk that's both relevant *and* meaningfully different from what I've already picked, and repeat." The result is a set of retrieved chunks that cover more distinct ground instead of saying the same thing four times.

### 2.6.3 What k, fetch_k, and lambda_mult mean, with a concrete example

```python
# backend/rag_api/service.py
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={"k": 4, "fetch_k": 10, "lambda_mult": 0.5},
)
```

- **`fetch_k`** — how many candidates to pull from the initial pure-similarity search before MMR does its diversity re-ranking. Here: pull the top 10 closest chunks first.
- **`k`** — how many chunks to actually return, after MMR re-ranks the `fetch_k` candidates for diversity. Here: return 4.
- **`lambda_mult`** — the relevance/diversity dial, from 0 to 1. `1.0` means "pure relevance, ignore diversity" (equivalent to naive top-k). `0.0` means "maximize diversity, almost ignore how relevant each pick is individually." `0.5` is a straight down-the-middle balance between the two.

Concrete example: imagine 10 candidate chunks come back from the initial search, and the top 4 by pure similarity are all restating "the Transformer uses attention instead of recurrence" in slightly different words (because the source paper says this in multiple places). Naive top-4 returns those four redundant chunks. MMR with `lambda_mult=0.5` picks the single best of those four, then — for its second pick — favors a chunk that's *still relevant* but *says something different* (e.g. one about positional encodings) over the third near-duplicate "attention instead of recurrence" chunk, even though that near-duplicate might individually score marginally higher on pure similarity.

### 2.6.4 Why this project chose MMR with k=4, fetch_k=10, lambda_mult=0.5

These specific numbers are the LangChain-documented, community-standard starting point for MMR — this project uses them as-is rather than having tuned them against its own retrieval quality metrics. `k=4` context chunks is enough breadth for most single-fact or two-fact questions without bloating the prompt; `fetch_k=10` (2.5× `k`) gives MMR a reasonable pool to pick a diverse 4 from without fetching so many candidates that irrelevant chunks start getting mixed in; `lambda_mult=0.5` is the "don't strongly favor either relevance or diversity" default. The eval module's retrieval-hit-rate metric ([7.4.4](./07-evaluation-module.md#744-retrieval-hit-rate)) is the closest thing this project has to empirical evidence about whether these values are actually working well — see that section's real measured number.

### 2.6.5 Other strategies that exist, and why they're not used here

- **Multi-query retrieval** — ask the LLM to rephrase the user's question several different ways, run retrieval for each rephrasing, and merge the results. Improves recall for ambiguously-worded questions, at the cost of extra LLM calls (more tokens, more latency) per question. This project has a standalone demo of this pattern that predates the current architecture (`backend/rag/retrievers/multiquery.py` — since deleted as part of a dependency cleanup, see [12](./12-known-issues-and-gotchas.md)), but it was never wired into the live `/rag/*` endpoints.
- **Reranking** — retrieve a larger candidate set with a cheap method (like plain similarity), then use a second, more expensive model (a "cross-encoder" reranker) to re-score and reorder that smaller set for final relevance. More accurate, but adds a whole extra model call per question, with the accompanying latency/cost/deployment-footprint cost this project has consistently traded away (see the whole `torch`/`sentence-transformers` removal story in [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)).
- **Hybrid search** — combine vector (semantic) search with traditional keyword search (like SQL full-text search or BM25), so exact terms/names/codes that embeddings sometimes under-weight still get found reliably. Not implemented here; MMR-over-embeddings alone was judged sufficient for this project's scope (one document at a time, general-purpose Q&A rather than needing exact term/code lookups).

None of these are wrong choices in general — they're standard techniques for scaling retrieval quality on larger, harder document sets. They weren't needed here because this project's RAG system handles one document per session, not a large corpus, which is exactly the regime where plain MMR retrieval is least likely to be the bottleneck.

---

## 2.7 AI Agents

### 2.7.1 What makes something an "agent" vs. a plain LLM call

A plain LLM call is a single request/response: you send a prompt, you get text back, done. An **agent** is an LLM given access to **tools** (external functions it can choose to invoke) and put in a loop where it can call those tools, see the results, and decide what to do next — including calling another tool, or several, before producing a final answer. The defining feature isn't "it uses an LLM" (a chain does that too) — it's that the *sequence of steps* isn't fixed in your code; the model itself decides which tool(s) to call, in what order, based on what it's trying to accomplish.

### 2.7.2 Tool calling, mechanically

**Tool calling** (also called "function calling") is the actual mechanism agents use to interact with the outside world. It works like this:

1. Your code registers one or more Python functions as "tools" the model is allowed to use, each with a description of what it does and what arguments it takes.
2. When the model decides a tool would help, instead of just generating prose, it outputs a *structured request* — "call `web_search` with `query="fusion energy 2025 breakthroughs"`" — in a format the LLM provider's API defines.
3. Your code (not the model) actually executes that function call, with real Python, against the real internet/database/filesystem.
4. The result is fed back into the conversation as if it were a message, and the model continues from there — possibly calling another tool, or producing its final text answer.

The model never runs any code itself. It only ever outputs text (in this special structured-request shape); your application is what turns that into an actual function call. This project's tools are plain Python functions decorated with LangChain's `@tool`:

```python
# backend/agents/tools.py
@tool
def web_search(query: str) -> str:
    """Search the web for recent and reliable information on a topic. Returns Titles, URLs and snippets."""
    results = tavily.search(query=query, max_results=5)
    ...

@tool
def scrape_url(url: str) -> str:
    """Scrape and return clean text content from a given URL for deeper reading."""
    ...
```
The docstring on each tool isn't decoration — it's what the LLM reads to decide *whether* and *when* to call that tool. A vague or missing docstring measurably degrades an agent's tool-selection accuracy.

### 2.7.3 The agent loop

Put together, an agent's execution looks like:

```
prompt → model decides: answer directly, or call a tool?
  → if tool: your code runs it → result fed back to the model → repeat
  → if answer: done, return the text
```

This can iterate multiple times before the model is satisfied it has enough information to respond. In this project, both agents (Search and Reader) are set up with exactly one available tool each, so in practice the loop is short: call the one tool, look at the result, respond. Nothing stops a differently-configured agent (with more tools, or a harder task) from looping many more times.

### 2.7.4 What LangChain's `create_agent` gives you

`create_agent` (from `langchain.agents`) is a factory function that wires up the entire agent loop described above — the tool-calling protocol, the "keep going until the model is done" loop, message history management — so this project's code doesn't implement any of that by hand:

```python
# backend/agents/research_agents.py
def build_search_agent():
    return create_agent(
        model=llm,
        tools=[web_search]
    )
```
Calling `.invoke({"messages": [...]})` on the returned agent runs the full loop and returns the final conversation state, including every message exchanged (tool calls and results included) — this project only reads the *last* message's content (`search_result["messages"][-1].content`) since that's the model's final answer after any tool use.

### 2.7.5 Agents vs. chains — when to use which, and why this project uses both

A **chain** (see [2.8](#28-chains)) is a fixed sequence of steps you define — prompt in, LLM call, parse output, done, no branching, no tool use. An agent is for when the *steps themselves* need to be decided dynamically based on what's found along the way.

This project deliberately uses agents for Search and Reader, and chains for Writer and Critic:

- **Search Agent** — needs to decide *whether and how* to search (what query to send `web_search`, based on the user's topic), and could in principle try multiple searches. That's a tool-use decision, hence an agent.
- **Reader Agent** — needs to pick *which URL* (out of several returned by search) to scrape, then call `scrape_url` with that specific URL. Again, a decision requiring tool use.
- **Writer Chain** — always does the same fixed thing: take a topic and gathered research text, produce a report. No decision about *what to do next* — it's one LLM call with a fixed prompt shape. A chain is simpler, faster (no agent-loop overhead), and sufficient.
- **Critic Chain** — same reasoning: always "take a report, produce a critique." Fixed shape, no tool use, no branching.

Using an agent where a chain would suffice adds unnecessary complexity and LLM-loop overhead (more calls, more tokens, more latency) for no benefit — the choice in this codebase tracks "does this step need to decide *what tool to use* based on intermediate results" fairly precisely.

---

## 2.8 Chains

### 2.8.1 What LCEL (the `|` pipe syntax) is doing

**LCEL** (LangChain Expression Language) is LangChain's syntax for composing pipeline stages with the `|` operator, the same way Unix shell pipes chain commands (`cat file | grep foo | wc -l`). Each stage takes the previous stage's output as its input:

```python
# backend/agents/research_agents.py
writer_chain = writer_prompt | llm | StrOutputParser()
```

This isn't Python's bitwise-or operating on these objects normally — LangChain's building-block classes (`ChatPromptTemplate`, `ChatGroq`, `StrOutputParser`) all implement Python's `__or__` operator (that's what makes `|` work on them) to mean "compose me with the next stage into a pipeline," returning a new object that represents the whole chain. Calling `.invoke(input)` on the resulting `writer_chain` runs all three stages in order, automatically passing each stage's output as the next stage's input.

### 2.8.2 `prompt | llm | StrOutputParser()` — what each stage does to the data

Walking through what actually happens to the data at each `|`, for `writer_chain.invoke({"topic": ..., "research": ...})`:

1. **`writer_prompt`** — a `ChatPromptTemplate`. Takes the input dict (`{"topic": ..., "research": ...}`), fills in the `{topic}` and `{research}` placeholders in the template strings, and produces a structured list of messages (system + human) ready to send to a model.
2. **`llm`** — a `ChatGroq` instance. Takes that list of messages, sends the actual API request to Groq, and returns a `ChatMessage`-like response object. Critically, this object is *not* a plain string — it's an object with a `.content` attribute (among others), which is why raw chain output needs a final parsing stage rather than being usable directly.
3. **`StrOutputParser()`** — takes that response object and extracts just the `.content` string, discarding everything else (metadata, token usage info, etc.). The final `.invoke()` call on the whole chain returns a plain Python string.

Every chain in this project (`writer_chain`, `critic_chain`) follows this exact three-stage shape. The RAG answer-generation code in `backend/rag_api/service.py` does the equivalent work *without* LCEL — it calls `_RAG_PROMPT.invoke(...)` then `llm.invoke(...)` as two separate steps rather than piping them together, because it needs to insert the retrieval step (fetching context chunks) in between building the prompt input and actually calling it — a linear `|` chain doesn't have a natural place to run arbitrary Python code partway through.

---

## 2.9 Evaluation of AI systems

### 2.9.1 Why you can't unit-test an LLM

A normal unit test asserts an exact expected output: `assert add(2, 2) == 4`. An LLM given the same prompt twice, even at temperature 0, isn't guaranteed to produce byte-identical text both times (see [2.1.3](#213-temperature-and-why-this-project-uses-0-for-most-things)) — and even if it were perfectly deterministic, "is this research report good?" doesn't have a single correct string to assert equality against the way `add(2, 2)` does. There's no `assert report == "the one correct report"` — quality is graded, not matched.

This is the core problem this project's `evals/` module exists to solve: you need a way to *score* AI output on a spectrum, repeatably, across many examples, so you can tell if a change made things better or worse — without a human manually reading every output every time.

### 2.9.2 What LLM-as-judge means, and its weaknesses

**LLM-as-judge** is exactly what it sounds like: use a second LLM call to *evaluate* the first LLM's output against a rubric, instead of (or in addition to) a human reviewer. This project's judge prompts (`backend/evals/judges.py`) ask the judge model to score a report or answer on several 1–5 dimensions and return the scores as JSON.

Its weaknesses, stated honestly (expanded further in [7.7](./07-evaluation-module.md#77-limitations)):
- The judge is itself an LLM, with the exact same reliability ceiling as the thing it's judging — it can be wrong, inconsistent, or fooled by confident-sounding but incorrect text.
- It can have systematic biases (e.g. documented tendencies in LLM judges to favor longer answers, or answers stylistically similar to their own writing).
- It's not free — every eval run costs real API calls and tokens, competing with the same quota as the system under test (a real, encountered problem in this project — see [12.8](./12-known-issues-and-gotchas.md#128-groq-daily-token-quota-100k-tpd-vs-per-minute-rate-limits)).

### 2.9.3 Deterministic metrics vs. judged metrics

Because of those weaknesses, this project draws a hard line: **anything that can be computed exactly in plain Python, is** — only genuinely subjective quality judgments (does this read well? is this complete? is this well-cited?) go to the LLM judge. Two concrete examples from `backend/evals/judges.py`:

```python
# Keyword recall — computed in Python, never asked of the judge
keyword_hits = sum(1 for term in must_mention if term.lower() in report_text.lower())
keyword_recall = keyword_hits / len(must_mention) if must_mention else 0.0
```
```python
# Retrieval hit — computed in Python, never asked of the judge
pages = {s.get("page") for s in (sources or [])}
retrieval_hit = gold_page_hint in pages
```

"Does this report mention National Ignition Facility?" is a simple substring check — asking an LLM to verify that would be strictly worse (slower, costs tokens, and introduces a new source of error) than just checking it in code. This split matters for trustworthiness: every number in a scorecard that *could* be gamed or misjudged by an unreliable LLM call, isn't — only the parts that genuinely require judgment (is this well-structured? is this faithful to the source?) are delegated to the judge, and those are clearly labeled as such in the results.

### 2.9.4 What a "gold dataset" is

A **gold dataset** is a set of test inputs paired with a known-correct (or known-expected) answer, used as a fixed benchmark to evaluate a system against, repeatably, over time. This project has two:

- `backend/evals/datasets/research_topics.json` — 5 research topics, each with a `must_mention` keyword list (see [7.2.1](./07-evaluation-module.md#721-research_topicsjson)).
- `backend/evals/datasets/rag_qa_pairs.json` — 8 question/gold-answer pairs against a fixed reference PDF (the "Attention Is All You Need" paper), see [7.2.2](./07-evaluation-module.md#722-rag_qa_pairsjson).

"Gold" here just means "the reference answer we trust" — not that it was generated by any special process; in this project both datasets were hand-written specifically for this eval suite.

### 2.9.5 Why the adversarial test cases exist

Two of the eight RAG questions are deliberately unanswerable from the source document — e.g. "What is the CO2 emissions... of training the Transformer model?" (the paper doesn't discuss this). These are called **adversarial** because they're specifically designed to try to trigger the failure mode this whole system is built to avoid: a model confidently making something up rather than admitting it doesn't know.

A RAG system that scores well on the six answerable questions but *also* confidently hallucinates plausible-sounding nonsense for the two unanswerable ones is not actually trustworthy — it just hasn't been tested on the case that matters most for real-world use, where users will eventually ask something the document genuinely doesn't cover. Measuring this directly (the **adversarial refusal rate**, see [7.4.5](./07-evaluation-module.md#745-adversarial-refusal-rate)) is what makes the difference between "the RAG demo works on the happy path" and "the RAG demo is honest about its limits."

---

**Next:** [03-architecture.md](./03-architecture.md) walks through how all of these pieces fit together into actual request flows, end to end.
