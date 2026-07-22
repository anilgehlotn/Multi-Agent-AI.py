import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from db.database import SessionLocal, get_db

from . import service
from .schemas import QueryCreate, QueryOut, SessionDetail, SessionOut

router = APIRouter(prefix="/rag", tags=["rag"])
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


def _index_session(session_id: str, pdf_path: str) -> None:
    db = SessionLocal()
    try:
        service.mark_indexing(db, session_id)
        num_chunks = service.build_index(session_id, pdf_path)
        service.mark_ready(db, session_id, num_chunks)
    except Exception as exc:
        logger.exception("indexing failed for session %s", session_id)
        service.fail_session(db, session_id, str(exc))
    finally:
        db.close()


@router.post("/upload", response_model=SessionOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SessionOut:
    is_pdf = (file.content_type == "application/pdf") or (file.filename or "").lower().endswith(".pdf")
    if not is_pdf:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    session = service.create_session(db, file.filename or "upload.pdf")

    pdf_path = service.upload_path(session.id)
    with open(pdf_path, "wb") as f:
        f.write(content)

    background_tasks.add_task(_index_session, session.id, pdf_path)

    return SessionOut.model_validate(session)


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(db: Session = Depends(get_db)) -> list[SessionOut]:
    return [SessionOut.model_validate(s) for s in service.list_sessions(db)]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session_detail(session_id: str, db: Session = Depends(get_db)) -> SessionDetail:
    session = service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="RAG session not found")
    return SessionDetail.model_validate(session)


@router.get("/sessions/{session_id}/status", response_model=SessionOut)
def get_session_status(session_id: str, db: Session = Depends(get_db)) -> SessionOut:
    session = service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="RAG session not found")
    return SessionOut.model_validate(session)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, db: Session = Depends(get_db)) -> None:
    deleted = service.delete_session(db, session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="RAG session not found")


@router.post("/sessions/{session_id}/ask", response_model=QueryOut)
def ask_question(session_id: str, payload: QueryCreate, db: Session = Depends(get_db)) -> QueryOut:
    session = service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="RAG session not found")
    if session.status != "ready":
        raise HTTPException(status_code=400, detail=f"Session is not ready (status={session.status})")

    try:
        answer, sources = service.answer_question(session_id, payload.question)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    query = service.save_query(db, session_id, payload.question, answer, sources)
    return QueryOut.model_validate(query)
