"""CLI entry point.

Usage (run from backend/, with the server already running):
    python -m evals.run research
    python -m evals.run rag
    python -m evals.run all
    python -m evals.run all --limit 2
    python -m evals.run all --live-only   # fail loudly on quota, no fallback
    python -m evals.run all --replay      # skip the API, render cached results
"""
import argparse
import sys
from typing import Callable

import requests
from rich.console import Console

from .rag_eval import run_rag_eval
from .report import dump_results, print_rag_report, print_research_report, render_from_json
from .research_eval import BACKEND_BASE_URL, BackendUnavailable, run_research_eval


def _run_mode(
    name: str,
    run_live: Callable[[], dict],
    print_report: Callable[[dict, object], None],
    console: Console,
    replay: bool,
    live_only: bool,
) -> None:
    if replay:
        console.print(f"[bold]Rendering cached {name} results (--replay)...[/bold]")
        if not render_from_json(name, console):
            sys.exit(1)
        console.print("")
        return

    console.print(f"[bold]Running {name} eval...[/bold]")
    result = run_live()
    agg = result["aggregate"]

    if agg.get("quota_blocked"):
        blocked_n, total_n = agg.get("quota_blocked_count", 0), agg.get("total_count", 0)
        if live_only:
            console.print(
                f"[bold red]Error:[/bold red] Live {name} eval blocked by API quota "
                f"({blocked_n}/{total_n} items failed with quota-related errors) and "
                f"--live-only was set — not falling back to cache."
            )
            sys.exit(1)

        console.print(
            f"[yellow]Live eval blocked by API quota[/yellow] "
            f"({blocked_n}/{total_n} items) — falling back to the most recent saved "
            f"run in evals/results/"
        )
        if not render_from_json(name, console):
            sys.exit(1)
        console.print("")
        return

    print_report(result, console)
    path = dump_results(name, result)
    console.print(f"[dim]Saved: {path}[/dim]\n")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m evals.run")
    parser.add_argument("mode", choices=["research", "rag", "all"])
    parser.add_argument("--limit", type=int, default=None, help="Limit number of topics/questions (smoke tests)")
    fallback_group = parser.add_mutually_exclusive_group()
    fallback_group.add_argument(
        "--live-only", action="store_true",
        help="Fail loudly on quota block instead of falling back to cached results",
    )
    fallback_group.add_argument(
        "--replay", action="store_true",
        help="Skip live API calls entirely; render the most recent cached results",
    )
    args = parser.parse_args()

    console = Console(width=140)

    try:
        if args.mode in ("research", "all"):
            _run_mode(
                "research",
                lambda: run_research_eval(limit=args.limit),
                print_research_report,
                console,
                args.replay,
                args.live_only,
            )

        if args.mode in ("rag", "all"):
            _run_mode(
                "rag",
                lambda: run_rag_eval(limit=args.limit),
                print_rag_report,
                console,
                args.replay,
                args.live_only,
            )

    except BackendUnavailable as exc:
        console.print(f"[bold red]Error:[/bold red] {exc}")
        sys.exit(1)
    except requests.exceptions.RequestException as exc:
        # Backend went away mid-run (e.g. killed while polling) rather than
        # never being up in the first place — same clear-message-not-a-
        # traceback treatment.
        console.print(
            f"[bold red]Error:[/bold red] Lost connection to the backend at "
            f"{BACKEND_BASE_URL} mid-run. Is it still running? ({exc})"
        )
        sys.exit(1)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/yellow]")
        sys.exit(130)


if __name__ == "__main__":
    main()
