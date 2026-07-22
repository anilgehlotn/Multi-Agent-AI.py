import os
import shutil

from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy.orm import Session

from db.models import RagQuery, RagSession

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_BACKEND_DIR, "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
RAG_INDICES_DIR = os.path.join(DATA_DIR, "rag_indices")


def _message_text(content) -> str:
    # Gemini responses can come back as a list of content-part dicts instead
    # of a plain string — normalize to str so it's safe to persist as Text.
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


def upload_path(session_id: str) -> str:
    return os.path.join(UPLOADS_DIR, f"{session_id}.pdf")


def index_dir(session_id: str) -> str:
    return os.path.join(RAG_INDICES_DIR, session_id)


# ── DB-backed session/query CRUD ─────────────────────────────────────────


def create_session(db: Session, pdf_filename: str) -> RagSession:
    session = RagSession(pdf_filename=pdf_filename)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: str) -> RagSession | None:
    return db.get(RagSession, session_id)


def list_sessions(db: Session) -> list[RagSession]:
    return db.query(RagSession).order_by(RagSession.created_at.desc()).all()


def delete_session(db: Session, session_id: str) -> bool:
    session = get_session(db, session_id)
    if session is None:
        return False

    pdf_path = upload_path(session_id)
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    idx_dir = index_dir(session_id)
    if os.path.isdir(idx_dir):
        shutil.rmtree(idx_dir)

    # db.delete (not a bulk query) so the ORM-level cascade removes the
    # session's RagQuery rows too — SQLite won't enforce ON DELETE CASCADE
    # at the FK level on its own.
    db.delete(session)
    db.commit()
    return True


def mark_indexing(db: Session, session_id: str) -> None:
    session = get_session(db, session_id)
    if session is None:
        return
    session.status = "indexing"
    db.commit()


def mark_ready(db: Session, session_id: str, num_chunks: int) -> None:
    session = get_session(db, session_id)
    if session is None:
        return
    session.status = "ready"
    session.num_chunks = num_chunks
    db.commit()


def fail_session(db: Session, session_id: str, error: str) -> None:
    # Same rationale as research/service.py's fail_run: this is the
    # exception-handler path, so defensively clear any failed transaction
    # left over from an earlier commit on this session before querying again.
    db.rollback()

    session = get_session(db, session_id)
    if session is None:
        return
    session.status = "failed"
    session.error = error
    db.commit()


def save_query(db: Session, session_id: str, question: str, answer: str, sources: list[dict]) -> RagQuery:
    query = RagQuery(session_id=session_id, question=question, answer=answer, sources=sources)
    db.add(query)
    db.commit()
    db.refresh(query)
    return query


# ── Pure RAG functions (no DB access) ────────────────────────────────────


def build_index(session_id: str, pdf_path: str) -> int:
    loader = PyPDFLoader(pdf_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.split_documents(docs)

    embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")

    # Chroma's persist_directory writes aren't safe across concurrent
    # processes — fine for this single-process dev server, but a TODO for
    # anything multi-worker (would need a per-session write lock or a
    # dedicated vector DB service).
    Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=index_dir(session_id),
    )

    return len(chunks)


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


def answer_question(session_id: str, question: str) -> tuple[str, list[dict]]:
    idx_dir = index_dir(session_id)
    if not os.path.isdir(idx_dir):
        raise FileNotFoundError(f"No index found for session {session_id}")

    embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
    vectorstore = Chroma(persist_directory=idx_dir, embedding_function=embeddings)

    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 4, "fetch_k": 10, "lambda_mult": 0.5},
    )

    docs = retriever.invoke(question)
    context = "\n\n".join(doc.page_content for doc in docs)

    llm = ChatGoogleGenerativeAI(model="gemini-flash-latest", temperature=0)
    final_prompt = _RAG_PROMPT.invoke({"context": context, "question": question})
    response = llm.invoke(final_prompt)

    sources = [
        {"page": doc.metadata.get("page"), "snippet": doc.page_content[:200]}
        for doc in docs
    ]

    return _message_text(response.content), sources
