"""Post a Code Review scan result to the clipboard dashboard.

Placeholder integration. Uses the project's existing dashboard/update.py CLI if present.
Drops an activity log entry per critical/high finding; flips status to `blocked` if criticals exist.

Input: JSON on stdin:
  { "project_id": "...", "scan_id": "...", "scope": "...", "findings": [...], "report": "..." }

If project_id is null, the script no-ops — Code Review's hookup to a dashboard row is decided
later per the plan.
"""

import json
import subprocess
import sys
from typing import Any, Dict, List

from _common import PROJECT_ROOT

DASHBOARD_CLI = PROJECT_ROOT / "dashboard" / "update.py"


def run_dashboard(args: List[str]) -> int:
    if not DASHBOARD_CLI.exists():
        print(f"[code-review] dashboard CLI not found at {DASHBOARD_CLI}; skipping", file=sys.stderr)
        return 0
    result = subprocess.run(
        ["python3", str(DASHBOARD_CLI), *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        print(f"[code-review] dashboard update failed: {result.stderr}", file=sys.stderr)
    return result.returncode


def main():
    payload: Dict[str, Any] = json.loads(sys.stdin.read())
    project_id = payload.get("project_id")
    if not project_id:
        print("[code-review] no dashboard.project_id configured; skipping", file=sys.stderr)
        return

    findings = payload.get("findings", [])
    criticals = [f for f in findings if f.get("severity") == "critical"]
    highs = [f for f in findings if f.get("severity") == "high"]

    sev_counts = {"critical": len(criticals), "high": len(highs),
                  "medium": sum(1 for f in findings if f.get("severity") == "medium"),
                  "low": sum(1 for f in findings if f.get("severity") == "low")}

    summary = (
        f"Code Review scan {payload.get('scan_id','?')} on `{payload.get('scope','?')}` — "
        f"crit {sev_counts['critical']} high {sev_counts['high']} "
        f"med {sev_counts['medium']} low {sev_counts['low']}. "
        f"Report: {payload.get('report','')}"
    )
    run_dashboard(["log", project_id, summary])

    for f in criticals + highs:
        loc = f.get("file", "?")
        if f.get("line"):
            loc = f"{loc}:{f['line']}"
        line = f"[{f.get('severity','?').upper()}] {f.get('id','?')} {f.get('title','')} — {loc}"
        run_dashboard(["log", project_id, line])

    if criticals:
        run_dashboard(["status", project_id, "blocked"])


if __name__ == "__main__":
    main()
