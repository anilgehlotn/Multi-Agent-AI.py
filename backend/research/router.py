import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from agents.pipeline import run_research_pipeline_with_callback
from db.database import SessionLocal, get_db

from . import service
from .schemas import RunCreate, RunDetail, RunListItem, RunOut

router = APIRouter(prefix="/research", tags=["research"])
logger = logging.getLogger(__name__)


def _execute_run(run_id: int, topic: str) -> None:
    # BackgroundTasks run after the request-scoped `db` dependency has
    # already been closed, so this needs its own session.
    db = SessionLocal()
    try:
        def on_step_start(step: str) -> None:
            service.mark_step(db, run_id, step, "running")

        def on_step_complete(step: str, _result: dict) -> None:
            service.mark_step(db, run_id, step, "done")

        results = run_research_pipeline_with_callback(
            topic,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
        )
        service.finalize_run(db, run_id, results)
    except Exception as exc:
        logger.exception("research run %s failed", run_id)
        service.fail_run(db, run_id, str(exc))
    finally:
        db.close()


@router.post("/run", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def start_run(payload: RunCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> RunOut:
    run = service.create_run(db, payload.topic)
    background_tasks.add_task(_execute_run, run.id, run.topic)
    return RunOut.model_validate(run)


@router.get("/history", response_model=list[RunListItem])
def history(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)) -> list[RunListItem]:
    runs = service.list_runs(db, limit=limit, offset=offset)
    return [RunListItem.model_validate(r) for r in runs]


@router.get("/history/{run_id}", response_model=RunDetail)
def get_run_detail(run_id: int, db: Session = Depends(get_db)) -> RunDetail:
    run = service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Research run not found")
    return RunDetail.model_validate(run)


@router.get("/history/{run_id}/status", response_model=RunOut)
def get_run_status(run_id: int, db: Session = Depends(get_db)) -> RunOut:
    run = service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Research run not found")
    return RunOut.model_validate(run)


@router.delete("/history/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(run_id: int, db: Session = Depends(get_db)) -> None:
    deleted = service.delete_run(db, run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Research run not found")
