from datetime import datetime

from sqlalchemy.orm import Session

from db.models import ResearchRun


def create_run(db: Session, topic: str) -> ResearchRun:
    run = ResearchRun(topic=topic)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_run(db: Session, run_id: int) -> ResearchRun | None:
    return db.get(ResearchRun, run_id)


def list_runs(db: Session, limit: int = 50, offset: int = 0) -> list[ResearchRun]:
    return (
        db.query(ResearchRun)
        .order_by(ResearchRun.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def delete_run(db: Session, run_id: int) -> bool:
    run = get_run(db, run_id)
    if run is None:
        return False
    db.delete(run)
    db.commit()
    return True


def mark_step(db: Session, run_id: int, step: str, status: str) -> ResearchRun | None:
    run = get_run(db, run_id)
    if run is None:
        return None

    # SQLAlchemy's JSON type can't see in-place mutation of a fetched dict
    # on SQLite — read the whole dict, replace it, then reassign.
    steps = dict(run.steps)
    step_info = dict(steps.get(step, {}))
    step_info["status"] = status
    now = datetime.utcnow().isoformat()
    if status == "running":
        step_info["started_at"] = now
    elif status in ("done", "failed"):
        step_info["completed_at"] = now
    steps[step] = step_info
    run.steps = steps

    if run.status == "pending":
        run.status = "running"

    db.commit()
    db.refresh(run)
    return run


def finalize_run(db: Session, run_id: int, results: dict) -> ResearchRun | None:
    run = get_run(db, run_id)
    if run is None:
        return None
    run.search_results = results.get("search_results")
    run.scraped_content = results.get("scraped_content")
    run.report = results.get("report")
    run.feedback = results.get("feedback")
    run.status = "completed"
    run.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def fail_run(db: Session, run_id: int, error: str) -> ResearchRun | None:
    # fail_run is the exception-handler path — if it's reached because an
    # earlier commit on this same session (e.g. in finalize_run) already
    # failed, the session is left in "pending rollback" and every further
    # query on it raises PendingRollbackError until this runs. Rolling back
    # unconditionally is a harmless no-op when there's nothing to undo.
    db.rollback()

    run = get_run(db, run_id)
    if run is None:
        return None

    # Don't leave the in-flight step stuck at "running" in the UI when the
    # whole run has failed.
    steps = dict(run.steps)
    now = datetime.utcnow().isoformat()
    for name, info in steps.items():
        if info.get("status") == "running":
            info = dict(info)
            info["status"] = "failed"
            info["completed_at"] = now
            steps[name] = info
    run.steps = steps

    run.status = "failed"
    run.error = error
    run.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run
