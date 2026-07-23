# 6. RAG System

## 6.1 The end-to-end flow, with a concrete example

Upload a 15-page paper (this project's own eval suite uses "Attention Is All You Need," a well-known machine learning paper, as its fixed test document — see [7.2.3](./07-evaluation-module.md#723-why-the-test-pdf-is-fixed)) and ask "What is the main architecture proposed in the paper?"

1. The PDF is saved to `backend/data/uploads/{session_id}.pdf` and a `rag_sessions` row is created with `status="pending"`.
2. In the background: the PDF is loaded and split into roughly 50 chunks (`num_chunks` was observed at 52 for this specific paper in real testing), each chunk is embedded via the Gemini API, and all 52 vectors are written to a Chroma index at `backend/data/rag_indices/{session_id}/`. `status` flips to `"ready"`.
3. You ask your question. It's embedded with the same Gemini model, Chroma returns the 4 most relevant (and mutually diverse — see [6.3.2](#632-the-mmr-retriever-config-explained-with-a-worked-example)) chunks, those 4 chunks' text is pasted into a prompt as "context," and Groq's Llama 3.3 70B is asked to answer using only that context.
4. In real testing, this question returned: *"The main architecture proposed in the paper is the Transformer, a model that relies entirely on an attention mechanism to draw global dependencies between input and output, and uses stacked self-attention and point-wise, fully connected layers for both the encoder and decoder,"* with sources citing pages 1 and 2 of the document — an accurate answer, correctly grounded, with page numbers you could go verify yourself.

The rest of this doc walks through exactly how each of those four steps works, and — just as importantly — where it can go wrong.

## 6.2 Indexing

### 6.2.1 `PyPDFLoader` — what it extracts, what it loses

```python
# backend/rag_api/service.py
loader = PyPDFLoader(pdf_path)
docs = loader.load()
```
`PyPDFLoader` (from `langchain_community.document_loaders`, built on the `pypdf` library) extracts the **text layer** of a PDF, one LangChain `Document` object per page, each with `page_content` (the extracted text) and `metadata` (including `page`, a zero-indexed page number — worth remembering, since it means "page 0" in metadata is "page 1" to a human reader; the frontend's `SourceChip` component adds 1 back when displaying it: `p. ${source.page + 1}`).

What it loses: **layout** (multi-column text can be extracted in a scrambled reading order; tables often extract as a jumble of cell text with no structure), and **images** (figures, charts, and diagrams are invisible to this extraction — if a paper's key result is only in a chart, this system cannot see it). It also, critically, extracts **nothing** from a scanned PDF with no underlying text layer — see [6.5.3](#653-scanned-pdfs-with-no-text-layer).

### 6.2.2 `RecursiveCharacterTextSplitter` — how it actually splits

```python
# backend/rag_api/service.py
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
chunks = splitter.split_documents(docs)
```
"Recursive" describes the splitting *strategy*, not a literal recursive function call pattern you'd notice from the outside. The splitter has an ordered list of separators it prefers, roughly `["\n\n", "\n", " ", ""]` (paragraph breaks, then line breaks, then spaces, then — as an absolute last resort — mid-word character splits). It tries to split on the *first* separator in that list that gets it under `chunk_size`; only if paragraph-level splitting still produces chunks too large does it fall back to the next, finer-grained separator. This means the splitter prefers to break at natural document boundaries (paragraphs) and only breaks more aggressively (mid-sentence, mid-word) when it has no other choice — which is why it consistently produces more readable, semantically coherent chunks than a naive "cut every N characters" splitter would.

### 6.2.3 Chunk size/overlap tradeoffs, with concrete examples

Concretely, with `chunk_size=1000, chunk_overlap=200`: imagine a paragraph reads *"...the model uses six identical layers. Each layer has two sub-layers: a multi-head self-attention mechanism, and a position-wise fully connected feed-forward network..."* and the 1000-character boundary happens to fall right after "sub-layers:". Without overlap, chunk N ends with "...has two sub-layers:" (the promise of a list, with no list), and chunk N+1 begins with "a multi-head self-attention..." (a list, with no context for what it's a list *of*). With 200 characters of overlap, chunk N+1 actually starts about 200 characters *before* that cut point — likely re-including "Each layer has two sub-layers:" — so the complete idea is intact in at least one of the two chunks.

The tradeoff: larger `chunk_size` means fewer, more context-rich chunks, but each retrieved chunk "wastes" more of the prompt's context budget on potentially-irrelevant surrounding text. Smaller `chunk_size` means more precise retrieval (a chunk is more likely to be *entirely* about the thing you searched for) but risks splitting a single idea across multiple chunks, none of which alone fully answers the question. More `chunk_overlap` reduces boundary-splitting risk but increases the total number of chunks (and therefore embedding API calls, and stored vectors) needed to cover the same document, since consecutive chunks now duplicate some content.

### 6.2.4 Embedding the chunks

```python
embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
Chroma.from_documents(documents=chunks, embedding=embeddings, persist_directory=index_dir(session_id))
```
`Chroma.from_documents(...)` handles the embed-and-store steps together: for each chunk, it calls the Gemini embeddings API to get a vector, then writes that vector (plus the chunk's original text and metadata) into the Chroma index at `persist_directory`. This project doesn't batch these calls manually or apply its own rate limiting — it relies on the LangChain/Chroma integration's default behavior and whatever the Gemini API's own throughput limits are. For a document producing ~50 chunks, this is dozens of embedding API calls per upload; there's no explicit cost/latency optimization here (e.g. batching multiple chunks into one API call, if the provider supports it) — a known, accepted simplicity-over-efficiency tradeoff at this project's scale.

### 6.2.5 Persisting to a per-session Chroma directory — why UUID namespacing

```python
def index_dir(session_id: str) -> str:
    return os.path.join(RAG_INDICES_DIR, session_id)
```
`session_id` is a `uuid.uuid4().hex` string (from `RagSession.id`'s default in `db/models.py`) — effectively guaranteed unique, generated server-side, never user input. Using it directly as the directory name means every session's vectors live in complete physical isolation from every other session's — there's no shared collection to accidentally query across, no metadata filter that could have a bug and leak one session's chunks into another's search results, and cleanup is a single `shutil.rmtree()` with nothing else to reconcile. The cost — and it's a real one — is that this doesn't scale to "search across all your documents at once," which a shared, metadata-filtered collection would support. See [11.9](./11-design-decisions.md#119-per-session-chroma-directories-over-one-shared-collection) for the full tradeoff writeup and what would change this decision.

## 6.3 Querying

### 6.3.1 Loading the persisted index

```python
# backend/rag_api/service.py
embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
vectorstore = Chroma(persist_directory=idx_dir, embedding_function=embeddings)
```
This is a *new* `Chroma(...)` instantiation, separate from the one used during indexing (`Chroma.from_documents(...)`) — this call doesn't create new vectors, it opens the existing on-disk index at `idx_dir` for reading. It must be given the same embedding model used at index time (`embedding_function=embeddings`), because it needs to embed the *incoming question* using a model whose vector space is directly comparable to the vectors already stored — embedding a question with a different model than the one that indexed the document would produce vectors that aren't meaningfully comparable, and similarity search would return effectively random results.

### 6.3.2 The MMR retriever config, explained with a worked example

```python
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={"k": 4, "fetch_k": 10, "lambda_mult": 0.5},
)
docs = retriever.invoke(question)
```
Full conceptual explanation of MMR and these three parameters: [2.6](./02-concepts-primer.md#26-retrieval-strategies). The worked example, specific to this project's actual test document: the "Attention Is All You Need" paper restates its central claim — "the Transformer relies entirely on attention, no recurrence or convolution" — in the abstract, the introduction, and the conclusion. A naive top-4 similarity search against "what is the main architecture" would very plausibly return four chunks all making close variations of that same claim, none of them covering, say, the actual attention formula or the training setup. With `fetch_k=10, lambda_mult=0.5`, MMR pulls the top 10 candidates first, picks the single best one, and then for each subsequent pick favors a chunk that's still relevant but meaningfully different from what's already been chosen — in practice, this is what let the real test query in [6.1](#61-the-end-to-end-flow-with-a-concrete-example) return sources spanning pages 1, 2, and 11 rather than four near-identical restatements of the same sentence.

### 6.3.3 Building the context string from retrieved docs

```python
context = "\n\n".join(doc.page_content for doc in docs)
```
The four retrieved chunks' raw text, joined with blank lines between them, becomes the `{context}` value in the RAG prompt. No summarization, no reranking of the four chunks relative to each other, no deduplication beyond what MMR already provided — the model sees the four chunks essentially as-is and has to synthesize across them itself.

### 6.3.4 The grounding prompt

```python
_RAG_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a helpful AI assistant.

Use ONLY the provided context to answer the question.

If the answer is not present in the context,
say: "I could not find the answer in the document."
"""),
    ("human", """Context:
{context}

Question:
{question}
"""),
])
```
Already covered at [2.5.5](./02-concepts-primer.md#255-what-grounding-means-and-how-the-prompt-enforces-it) and [2.2.4](./02-concepts-primer.md#224-walking-through-this-projects-actual-prompts). Two points worth restating for this doc specifically: **"Use ONLY the provided context"** is the entire grounding mechanism — there is no code-level check that the model actually complied, only prompt instruction. And the refusal phrase is specified **verbatim**, not left to the model's own words, because the eval module's automated refusal-detection (`_looks_like_refusal()` in `backend/evals/judges.py`) pattern-matches against known refusal phrasings — a model that "refuses" in some other wording the pattern list doesn't recognize would be miscounted as a hallucination by the eval's deterministic check, even if it behaved correctly.

### 6.3.5 Extracting source metadata

```python
sources = [
    {"page": doc.metadata.get("page"), "snippet": doc.page_content[:200]}
    for doc in docs
]
```
Every retrieved chunk becomes a `{page, snippet}` entry, independent of whether the model's final answer actually drew on that specific chunk or not — this is "what was *available* to the model," not "what the model actually *used*." (There's no mechanism in this codebase that verifies or traces which specific input chunks influenced which specific output sentences — that would require a fundamentally different technique, like asking the model to cite inline, which this project doesn't do.) The 200-character snippet cap keeps the `sources` payload compact for display — `frontend/src/components/QuestionAnswer.jsx`'s `SourceChip` shows it in a small expandable popover, not a full page render.

## 6.4 Session lifecycle: pending → indexing → ready → (failed)

```
pending  →  indexing  →  ready
                      ↘        
                        failed
```
- **`pending`** — the DB row exists, the PDF file has been written to disk, but the background indexing task hasn't started running yet (or is between the upload response returning and the background task actually beginning execution).
- **`indexing`** — `build_index()` is actively running: loading, chunking, embedding, and writing to Chroma.
- **`ready`** — indexing succeeded; `num_chunks` is set; `/ask` requests are now accepted.
- **`failed`** — something in `build_index()` raised (an exception is the only path here — see [6.5](#65-failure-modes-and-how-theyre-handled) for what typically causes it); `error` holds the exception text; `/ask` requests are rejected with `400 Session is not ready`.

`ask_question()` in the router explicitly checks `session.status != "ready"` before calling `answer_question()` at all — there's no attempt to answer against a partial or absent index.

## 6.5 Failure modes and how they're handled

### 6.5.1 Corrupt / non-PDF upload

Caught at two layers. First, the router checks content-type/extension before even reading the file body:
```python
# backend/rag_api/router.py
is_pdf = (file.content_type == "application/pdf") or (file.filename or "").lower().endswith(".pdf")
if not is_pdf:
    raise HTTPException(status_code=400, detail="Only PDF files are accepted")
```
This is a shallow check — it trusts the browser-supplied content-type or the filename extension, neither of which guarantees the *content* is actually a valid PDF (a renamed `.txt` file passes this check). A file that passes this shallow check but is genuinely corrupt/malformed will fail later, inside `build_index()`, when `PyPDFLoader` tries to actually parse it — that exception is caught by `_index_session()`'s `except Exception`, which calls `fail_session()`, landing the session in `status="failed"` with the parser's error message as `error`.

### 6.5.2 Encrypted PDFs

Not explicitly handled — `PyPDFLoader`/`pypdf` will raise on a password-protected PDF it can't open, which flows through the exact same generic `except Exception` → `fail_session()` path as any other parse failure above. The session ends up `failed`, with whatever error message `pypdf` produces, surfaced to the user via the session's `error` field. There's no special-cased "this looks encrypted, ask for a password" UX — it's just a failed session like any other.

### 6.5.3 Scanned PDFs with no text layer

This is the failure mode most worth understanding, because it doesn't produce an error at all. `PyPDFLoader` extracts whatever text layer a PDF has; a **scanned** PDF (a PDF that's really just images of pages, common for older documents or physical-document scans with no OCR applied) has *no* text layer to extract. `loader.load()` succeeds, returns `Document` objects with empty (or near-empty) `page_content`, the splitter runs against essentially nothing, and `build_index()` produces **zero (or near-zero) chunks** — the session reaches `status="ready"` with `num_chunks` at or near 0, no error raised anywhere. Ask it a question, and the retriever has nothing meaningful to return, and the model will (correctly, per its grounding instruction) say it can't find the answer — for *every* question, regardless of what's actually in the document, because nothing about the document's actual content ever made it into the index.

**What you'd do about it:** this project has no OCR step. Fixing it would mean adding an OCR library (e.g. `pytesseract`, or a cloud OCR API) as a fallback when `PyPDFLoader` returns suspiciously little text per page, before splitting/embedding — a real feature gap, not a bug, since the system was never scoped to handle this case, and it's flagged here specifically because it's the kind of failure that looks like success (a "ready" session, no error banner) until you ask a question and get uniformly unhelpful answers.

### 6.5.4 Very large PDFs and the size cap

```python
# backend/rag_api/router.py
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
...
content = await file.read()
if len(content) > MAX_UPLOAD_BYTES:
    raise HTTPException(status_code=413, detail="File too large (max 20 MB)")
```
A flat 20 MB cap, checked *after* reading the full upload into memory (`await file.read()` loads the entire file before the size check runs — for a 20 MB cap this is a non-issue, but it means the check isn't a true streaming/early-rejection guard; a much larger malicious upload would still be read into memory in full before being rejected). Beyond the byte cap, there's no limit on *page count* or *chunk count* — a dense, text-heavy 20 MB PDF could still produce a very large number of chunks and a correspondingly large number of embedding API calls during indexing, with no explicit cap or warning.

## 6.6 How to modify

**Swapping the embedding model** — change the `GoogleGenerativeAIEmbeddings(model="...")` instantiation in *both* `build_index()` and `answer_question()` (they must match — see [6.3.1](#631-loading-the-persisted-index)). Any existing indexed sessions were embedded with the old model and would need to be re-indexed (deleted and re-uploaded) — there's no migration path for "re-embed existing vectors with a new model" in this codebase. Full swap procedure: [13.4](./13-extending-this-project.md#1334-swapping-the-vector-db) covers the closely related vector-DB swap; an embedding-model swap is a strict subset of that same exercise.

**Changing chunk strategy** — edit `chunk_size`/`chunk_overlap` in `build_index()` directly, or swap `RecursiveCharacterTextSplitter` for a different LangChain splitter (e.g. a markdown-aware or token-count-aware splitter). Same re-indexing caveat as above applies to any already-uploaded documents.

**Adding reranking** — insert a reranking model call between `retriever.invoke(question)` and building the `context` string in `answer_question()`: retrieve a larger candidate set (bump `fetch_k`/`k` up), score all candidates with a cross-encoder reranker, keep only the top few post-rerank. This adds a new model dependency and an extra inference call per question — weigh against this project's deliberate "keep the deployed footprint small" constraint (see [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)) before picking a reranker that pulls in `torch` again.

**Supporting multiple documents per session** — the biggest structural change on this list. Today, `index_dir(session_id)` and the 1:1 `RagSession` → one-PDF-one-Chroma-directory relationship assume a single document. Multi-document support would mean either (a) one Chroma collection per session but multiple documents' chunks inside it, tagged with a `source_document` metadata field so retrieval/citation can still distinguish which document a chunk came from, or (b) a schema change adding a `RagDocument` table (session → many documents) with its own upload/indexing lifecycle per document. Either path also needs `SourceChunk`'s schema (`rag_api/schemas.py`) extended to include which document a source came from, and the frontend's source-chip rendering updated to show it.

---

**Next:** [07-evaluation-module.md](./07-evaluation-module.md) — how this system (and the research pipeline) are actually measured, not just described.
