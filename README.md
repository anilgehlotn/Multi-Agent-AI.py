# Multi-Agent AI — Research Pipeline + RAG PDF Q&A

A FastAPI backend wrapping two AI systems: a 4-agent research pipeline that searches, scrapes, writes, and critiques reports on any topic, and a RAG-based PDF Q&A engine for grounded document question-answering.

## 🧱 Architecture

Two independent pipelines served through a single FastAPI app:

### 1. Research Pipeline (async, job-based)
```
Topic → Search Agent → Reader Agent → Writer Chain → Critic Chain → Report
```
Runs as a background thread per request; the frontend polls a job status endpoint until the pipeline completes.

### 2. RAG PDF Q&A
```
PDF Upload → Chunk & Embed → ChromaDB (persisted) → MMR Retrieval → LLM Answer
```

## 🤖 Agents & Chains

| Component | Role | Tool/Model |
|---|---|---|
| **Search Agent** | Finds recent, reliable info on the topic | `web_search` (Tavily API) + GPT-4o-mini |
| **Reader Agent** | Picks the most relevant URL, scrapes deeper content | `scrape_url` (BeautifulSoup) + GPT-4o-mini |
| **Writer Chain** | Drafts a structured report (Intro / Findings / Conclusion / Sources) | GPT-4o-mini |
| **Critic Chain** | Scores and critiques the report with strengths/improvements | GPT-4o-mini |
| **RAG Q&A** | Answers questions strictly from retrieved PDF context | Mistral (`mistral-small-2506`) |

## 🧰 Tech Stack

- **Language:** Python
- **Framework:** FastAPI
- **Agent Orchestration:** LangChain (`create_agent`, chains via `ChatPromptTemplate` + `StrOutputParser`)
- **LLMs:** OpenAI GPT-4o-mini (agents/chains), Mistral `mistral-small-2506` (RAG answers)
- **Vector Store:** ChromaDB (persisted to disk)
- **Embeddings:** OpenAI Embeddings
- **Search:** Tavily API
- **Web Scraping:** BeautifulSoup + Requests
- **PDF Processing:** PyPDFLoader + RecursiveCharacterTextSplitter

## 📁 Project Structure

```
├── agents.py              # build_search_agent, build_reader_agent, writer_chain, critic_chain
├── tools.py                # web_search (Tavily), scrape_url (BeautifulSoup)
├── main.py                  # CLI runner for the research pipeline
├── rag_qa.py                # CLI RAG Q&A loop (retriever + Mistral)
├── backend/
│   └── main.py               # FastAPI app — wraps both pipelines as HTTP APIs
├── chroma_db/               # persisted vector store (generated at runtime)
└── requirements.txt
```

## 🚀 Getting Started

### Install dependencies
```bash
pip install -r requirements.txt
```

### Environment variables
```
OPENAI_API_KEY=
TAVILY_API_KEY=
MISTRAL_API_KEY=
```

### Run the API
```bash
uvicorn backend.main:app --reload --port 8000
```

### Run standalone (CLI mode)
```bash
python main.py       # research pipeline
python rag_qa.py      # RAG Q&A loop
```

## 📡 API Endpoints

### Research Pipeline
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/research/run` | Start a research job for a topic → returns `job_id` |
| GET | `/api/research/status/{job_id}` | Poll job status/results (`step`, `results`, `error`) |

### RAG PDF Q&A
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/rag/upload` | Upload a PDF → returns `file_id` |
| POST | `/api/rag/build-index` | Chunk, embed, and index the uploaded PDF into ChromaDB |
| POST | `/api/rag/ask` | Ask a question, answered strictly from retrieved PDF context |

## ⚙️ Core Functionality

- **Background job pattern** — research jobs run on a daemon thread; status tracked in an in-memory dict, polled by the frontend until `step == "done"`
- **MMR retrieval** — RAG retriever uses Maximal Marginal Relevance (`k=4`, `fetch_k=10`, `lambda_mult=0.5`) to balance relevance and diversity in retrieved chunks
- **Grounded answers** — RAG prompt strictly instructs the LLM to answer only from context, falling back to "I could not find the answer in the document" otherwise
- **Persisted vector store** — ChromaDB index survives across requests via `persist_directory`

## 📄 License

Internal project — all rights reserved.
