"""
FastAPI backend — wraps the existing multi-agent research pipeline
and RAG PDF Q&A logic from the two Streamlit prototypes.

Run from project root:
  uvicorn backend.main:app --reload --port 8000
"""

import sys
import os
import uuid
import tempfile
import threading

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ── Make sure the project root is on sys.path so we can import agents/tools ──
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

# ── Import existing logic (untouched) ────────────────────────────────────────
from agents import build_search_agent, build_reader_agent, writer_chain, critic_chain

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_mistralai import ChatMistralAI
from langchain_core.prompts import ChatPromptTemplate


# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(title="ResearchMind + RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
# RESEARCH PIPELINE — background job pattern
# ══════════════════════════════════════════════════════════════════════════════

# In-memory job store  { job_id: { step, results, error } }
research_jobs: dict = {}


class ResearchRequest(BaseModel):
    topic: str


class ResearchRunResponse(BaseModel):
    job_id: str


def _run_research_pipeline(job_id: str, topic: str):
    """
    Background worker — runs the exact same 4-step pipeline from App 1.
    Updates research_jobs[job_id] after each step so the frontend can poll.
    """
    job = research_jobs[job_id]

    try:
        # ── Step 1: Search Agent ─────────────────────────────────────────
        job["step"] = "search"
        search_agent = build_search_agent()
        sr = search_agent.invoke({
            "messages": [("user", f"Find recent, reliable and detailed information about: {topic}")]
        })
        job["results"]["search"] = sr["messages"][-1].content

        # ── Step 2: Reader Agent ─────────────────────────────────────────
        job["step"] = "reader"
        reader_agent = build_reader_agent()
        rr = reader_agent.invoke({
            "messages": [("user",
                f"Based on the following search results about '{topic}', "
                f"pick the most relevant URL and scrape it for deeper content.\n\n"
                f"Search Results:\n{job['results']['search'][:800]}"
            )]
        })
        job["results"]["reader"] = rr["messages"][-1].content

        # ── Step 3: Writer Chain ─────────────────────────────────────────
        job["step"] = "writer"
        research_combined = (
            f"SEARCH RESULTS:\n{job['results']['search']}\n\n"
            f"DETAILED SCRAPED CONTENT:\n{job['results']['reader']}"
        )
        job["results"]["writer"] = writer_chain.invoke({
            "topic": topic,
            "research": research_combined,
        })

        # ── Step 4: Critic Chain ─────────────────────────────────────────
        job["step"] = "critic"
        job["results"]["critic"] = critic_chain.invoke({
            "report": job["results"]["writer"],
        })

        # ── Done ─────────────────────────────────────────────────────────
        job["step"] = "done"

    except Exception as e:
        job["error"] = str(e)
        job["step"] = "error"


@app.post("/api/research/run", response_model=ResearchRunResponse)
async def research_run(req: ResearchRequest):
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty")

    job_id = str(uuid.uuid4())
    research_jobs[job_id] = {
        "step": "queued",
        "results": {},
        "error": None,
    }

    thread = threading.Thread(
        target=_run_research_pipeline,
        args=(job_id, req.topic.strip()),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/research/status/{job_id}")
async def research_status(job_id: str):
    if job_id not in research_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = research_jobs[job_id]
    return {
        "step": job["step"],
        "results": job["results"],
        "error": job["error"],
    }


# ══════════════════════════════════════════════════════════════════════════════
# RAG PDF Q&A
# ══════════════════════════════════════════════════════════════════════════════

# Track uploaded files  { file_id: file_path }
uploaded_files: dict = {}

CHROMA_DIR = os.path.join(PROJECT_ROOT, "chroma_db")


@app.post("/api/rag/upload")
async def rag_upload(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Save to temp file — same pattern as original Streamlit app
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
        content = await file.read()
        tmp_file.write(content)
        file_path = tmp_file.name

    file_id = str(uuid.uuid4())
    uploaded_files[file_id] = file_path

    return {"success": True, "file_id": file_id, "filename": file.filename}


class BuildIndexRequest(BaseModel):
    file_id: str


@app.post("/api/rag/build-index")
async def rag_build_index(req: BuildIndexRequest):
    if req.file_id not in uploaded_files:
        raise HTTPException(status_code=400, detail="File not found. Upload a PDF first.")

    file_path = uploaded_files[req.file_id]

    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail="Uploaded file no longer exists on disk.")

    # ── Exact same logic from App 2 ──────────────────────────────────────
    loader = PyPDFLoader(file_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = splitter.split_documents(docs)

    embeddings = OpenAIEmbeddings()

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DIR,
    )
    vectorstore.persist()

    return {"success": True}


class AskRequest(BaseModel):
    question: str


@app.post("/api/rag/ask")
async def rag_ask(req: AskRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    if not os.path.exists(CHROMA_DIR):
        raise HTTPException(
            status_code=400,
            detail="No vector database found. Upload a PDF and build the index first.",
        )

    # ── Exact same logic from App 2 ──────────────────────────────────────
    embeddings = OpenAIEmbeddings()

    vectorstore = Chroma(
        persist_directory=CHROMA_DIR,
        embedding_function=embeddings,
    )

    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": 4,
            "fetch_k": 10,
            "lambda_mult": 0.5,
        },
    )

    llm = ChatMistralAI(model="mistral-small-2506")

    prompt = ChatPromptTemplate.from_messages([
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

    docs = retriever.invoke(req.question)

    context = "\n\n".join([doc.page_content for doc in docs])

    final_prompt = prompt.invoke({
        "context": context,
        "question": req.question,
    })

    response = llm.invoke(final_prompt)

    return {"answer": response.content}
