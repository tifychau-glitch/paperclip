"""Scan orchestrator. Runs baseline, prints a scan prep envelope for Code Review to fill.

Code Review (the agent) is what actually walks the code and produces findings. This script:
  1. Ensures .code-review/ exists.
  2. Runs baseline.py.
  3. Prints a JSON envelope that Code Review fills with `findings`, then pipes back to write_report.py.

Usage:
    python3 .claude/skills/code-review/scripts/scan.py --scope src/auth/
    python3 .claude/skills/code-review/scripts/scan.py --scope src/auth/ --ignore-baseline
"""

import argparse
import json
import sys
from datetime import datetime

from _common import ensure_dirs, scan_id, today_compact
from baseline import run_baseline


def next_scan_idx() -> int:
    from _common import REPORTS_DIR
    today = today_compact()
    max_seen = 0
    if not REPORTS_DIR.exists():
        return 1
    import json as _json
    for fp in REPORTS_DIR.glob("*.json"):
        try:
            data = _json.loads(fp.read_text())
            sid = data.get("scan_id", "")
            if sid.startswith(f"S-{today}-"):
                n = int(sid.split("-")[-1])
                if n > max_seen:
                    max_seen = n
        except Exception:
            continue
    return max_seen + 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", required=True, help="File, directory, or label, e.g. 'src/auth/'")
    ap.add_argument("--ignore-baseline", action="store_true",
                    help="Proceed even if baseline is already broken")
    args = ap.parse_args()

    ensure_dirs()

    baseline = run_baseline()
    if baseline["ran"] > 0 and not baseline["ok"] and not args.ignore_baseline:
        print(json.dumps({
            "status": "baseline_broken",
            "message": (
                f"Baseline broken: {len(baseline['failures'])} of {baseline['ran']} "
                "jobs failed. Fix baseline first or re-run with --ignore-baseline."
            ),
            "baseline": baseline,
        }, indent=2))
        sys.exit(1)

    sid = scan_id(next_scan_idx())
    envelope = {
        "scan_id": sid,
        "scope": args.scope,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "baseline": baseline,
        "findings": [],
    }
    print(json.dumps(envelope, indent=2))


if __name__ == "__main__":
    main()
