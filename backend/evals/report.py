"""Rich-table scorecard printer + JSON result dumps."""
import json
import os
from datetime import datetime, timezone
from typing import Optional

from rich.console import Console
from rich.table import Table

_RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")


def _fmt(x, nd: int = 1) -> str:
    return f"{x:.{nd}f}" if isinstance(x, (int, float)) else "—"


def _fmt_seconds(s: Optional[float]) -> str:
    if s is None:
        return "—"
    m, sec = divmod(int(s), 60)
    return f"{m}m {sec:02d}s"


def print_research_report(result: dict, console: Optional[Console] = None) -> None:
    console = console or Console()
    rows, agg = result["rows"], result["aggregate"]

    table = Table(title="Research Eval")
    table.add_column("Topic")
    table.add_column("Status")
    table.add_column("Cov", justify="right")
    table.add_column("Dep", justify="right")
    table.add_column("Str", justify="right")
    table.add_column("Cite", justify="right")
    table.add_column("KW Recall", justify="right")
    table.add_column("Overall", justify="right")
    table.add_column("Time", justify="right")

    for r in rows:
        s = r["scores"] or {}
        label = r["topic"] if len(r["topic"]) <= 32 else r["topic"][:29] + "..."
        table.add_row(
            f"{r['topic_id']} {label}",
            r["status"],
            _fmt(s.get("coverage"), 0),
            _fmt(s.get("depth"), 0),
            _fmt(s.get("structure"), 0),
            _fmt(s.get("citations"), 0),
            _fmt(s.get("keyword_recall"), 2),
            _fmt(s.get("overall"), 1),
            _fmt_seconds(r["timing_seconds"]),
        )

    table.add_section()
    table.add_row(
        "AVERAGE",
        "",
        _fmt(agg["mean_coverage"]),
        _fmt(agg["mean_depth"]),
        _fmt(agg["mean_structure"]),
        _fmt(agg["mean_citations"]),
        _fmt(agg["mean_keyword_recall"], 2),
        _fmt(agg["mean_overall"]),
        _fmt_seconds(agg["avg_pipeline_seconds"]),
    )

    console.print(table)
    console.print(
        f"Success rate: {agg['completed_count']}/{agg['total_count']}   "
        f"Total time: {_fmt_seconds(agg['total_wall_seconds'])}   "
        f"Judge failures: {agg['judge_failures']}"
    )


def print_rag_report(result: dict, console: Optional[Console] = None) -> None:
    console = console or Console()
    rows, agg = result["rows"], result["aggregate"]

    table = Table(title="RAG Eval")
    table.add_column("Q")
    table.add_column("Type")
    table.add_column("Question")
    table.add_column("Correct", justify="right")
    table.add_column("Faithful", justify="right")
    table.add_column("Complete", justify="right")
    table.add_column("Overall", justify="right")
    table.add_column("Retrieval")
    table.add_column("Refused OK")

    for r in rows:
        s = r["scores"] or {}
        is_adv = r["type"] == "adversarial"
        q_label = r["question"] if len(r["question"]) <= 40 else r["question"][:37] + "..."
        hit = s.get("retrieval_hit")
        table.add_row(
            r["qa_id"],
            r["type"],
            q_label,
            "—" if is_adv else _fmt(s.get("correctness"), 0),
            _fmt(s.get("faithfulness"), 0),
            "—" if is_adv else _fmt(s.get("completeness"), 0),
            "—" if is_adv else _fmt(s.get("overall"), 0),
            "—" if is_adv else ("✓" if hit else "✗" if hit is not None else "—"),
            ("✓" if s.get("refused_correctly") else "✗") if is_adv else "—",
        )

    console.print(table)
    console.print(
        f"Mean correctness: {_fmt(agg['mean_correctness'])}   "
        f"Mean faithfulness: {_fmt(agg['mean_faithfulness'])}   "
        f"Mean completeness: {_fmt(agg['mean_completeness'])}   "
        f"Mean overall: {_fmt(agg['mean_overall'])}"
    )
    console.print(
        f"Retrieval hit rate: {_fmt(agg['retrieval_hit_rate'], 2)}   "
        f"Adversarial refusal rate: {_fmt(agg['adversarial_refusal_rate'], 2)}   "
        f"Judge failures: {agg['judge_failures']}   "
        f"Total time: {_fmt_seconds(agg['total_wall_seconds'])}"
    )


def dump_results(name: str, payload: dict) -> str:
    os.makedirs(_RESULTS_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(_RESULTS_DIR, f"{ts}_{name}.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    return path


def _parse_cache_timestamp(path: str) -> Optional[datetime]:
    ts_part = os.path.basename(path).split("_", 1)[0]
    try:
        return datetime.strptime(ts_part, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def find_latest_cache(name: str) -> Optional[str]:
    """Newest saved results file for `name` ('research' or 'rag'), or None."""
    if not os.path.isdir(_RESULTS_DIR):
        return None
    suffix = f"_{name}.json"
    # Timestamp-prefixed filenames (YYYYMMDDThhmmssZ) sort chronologically.
    candidates = sorted(f for f in os.listdir(_RESULTS_DIR) if f.endswith(suffix))
    if not candidates:
        return None
    return os.path.join(_RESULTS_DIR, candidates[-1])


def load_cached_result(name: str) -> Optional[tuple[str, dict]]:
    path = find_latest_cache(name)
    if path is None:
        return None
    with open(path) as f:
        return path, json.load(f)


def print_cache_banner(path: str, console: Console) -> None:
    dt = _parse_cache_timestamp(path)
    when = dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "an unknown date"
    console.print(f"[bold yellow]Showing cached results from {when}[/bold yellow] [dim]({os.path.basename(path)})[/dim]")


def render_from_json(name: str, console: Optional[Console] = None) -> bool:
    """Load and print the newest cached results for `name`, banner included.

    Returns False (having already printed a message) if no cache exists.
    """
    console = console or Console()
    cached = load_cached_result(name)
    if cached is None:
        console.print("[bold red]No cached results available.[/bold red]")
        return False
    path, payload = cached
    print_cache_banner(path, console)
    if name == "research":
        print_research_report(payload, console)
    else:
        print_rag_report(payload, console)
    return True
