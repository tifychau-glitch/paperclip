"""Fix-mode helper. Loads a finding and emits the fix protocol to stdout.

Code Review is the one who actually writes the test and applies the patch — this script
just scaffolds the plan and tracks attempts in .code-review/fixes/<id>.md.

Usage:
    python3 .claude/skills/code-review/scripts/fix.py --finding R-20260419-0001
    python3 .claude/skills/code-review/scripts/fix.py --finding R-20260419-0001 --log-attempt "baseline red after patch v1"
    python3 .claude/skills/code-review/scripts/fix.py --finding R-20260419-0001 --mark-fixed --commit a3f1c29
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from _common import FIXES_DIR, REPORTS_DIR, ensure_dirs, load_config


def find_finding(fid: str) -> Tuple[Optional[Path], Optional[Dict[str, Any]]]:
    for fp in sorted(REPORTS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(fp.read_text())
            for f in data.get("findings", []):
                if f.get("id") == fid:
                    return fp, f
        except Exception:
            continue
    return None, None


def fix_log_path(fid: str) -> Path:
    return FIXES_DIR / f"{fid}.md"


def init_log(fid: str, finding: Dict[str, Any]) -> None:
    p = fix_log_path(fid)
    if p.exists():
        return
    lines = [
        f"# Fix log for {fid}",
        "",
        f"- Title: {finding.get('title','')}",
        f"- Severity: {finding.get('severity','')}",
        f"- File: {finding.get('file','')}:{finding.get('line','')}",
        f"- Category: {finding.get('category','')}",
        f"- Reproduction: {finding.get('reproduction') or '(none)'}",
        "",
        "## Attempts",
        "",
    ]
    p.write_text("\n".join(lines) + "\n")


def append_attempt(fid: str, note: str) -> None:
    p = fix_log_path(fid)
    with p.open("a") as f:
        f.write(f"- {datetime.now().strftime('%Y-%m-%d %H:%M')} — {note}\n")


def count_attempts(fid: str) -> int:
    p = fix_log_path(fid)
    if not p.exists():
        return 0
    return sum(1 for ln in p.read_text().splitlines() if ln.startswith("- ") and " — " in ln and ln.startswith("- 2"))


def update_finding_status(fid: str, status: str, commit: Optional[str] = None) -> bool:
    for fp in sorted(REPORTS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(fp.read_text())
            changed = False
            for f in data.get("findings", []):
                if f.get("id") == fid:
                    f["status"] = status
                    if commit:
                        f["fix_commit"] = commit
                    changed = True
            if changed:
                fp.write_text(json.dumps(data, indent=2))
                return True
        except Exception:
            continue
    return False


def emit_protocol(finding: Dict[str, Any], max_retries: int, attempts_so_far: int) -> str:
    remaining = max(0, max_retries - attempts_so_far)
    lines = [
        f"FIX PROTOCOL — {finding['id']}",
        "",
        f"Title:       {finding.get('title','')}",
        f"Severity:    {finding.get('severity','')}",
        f"File:        {finding.get('file','')}:{finding.get('line','')}",
        f"Category:    {finding.get('category','')}",
        f"Reproduction:{finding.get('reproduction') or '(none; write one before patching)'}",
        f"Suggested:   {finding.get('suggested_fix') or '(none)'}",
        "",
        f"Attempts used: {attempts_so_far} / {max_retries} (remaining: {remaining})",
        "",
        "Steps:",
        " 1. If no reproduction test exists, write one. It must fail.",
        " 2. Apply the minimum patch.",
        " 3. Run baseline. If green, commit 'fix(code-review): <title> [<id>]'.",
        " 4. If red, log the attempt and try once more. If still red, abort and leave status open.",
        " 5. On success, call this script with --mark-fixed --commit <sha>.",
    ]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--finding", required=True, help="Finding ID, e.g. R-20260419-0001")
    ap.add_argument("--log-attempt", help="Append an attempt note to the fix log")
    ap.add_argument("--mark-fixed", action="store_true", help="Flip finding status to 'fixed'")
    ap.add_argument("--commit", help="Git commit SHA to record with the fix")
    args = ap.parse_args()

    ensure_dirs()

    fp, finding = find_finding(args.finding)
    if not finding:
        print(f"Finding not found: {args.finding}", file=sys.stderr)
        sys.exit(2)

    init_log(args.finding, finding)

    if args.log_attempt:
        append_attempt(args.finding, args.log_attempt)
        print(f"Logged attempt for {args.finding}")
        return

    if args.mark_fixed:
        ok = update_finding_status(args.finding, "fixed", args.commit)
        if not ok:
            print(f"Could not update status for {args.finding}", file=sys.stderr)
            sys.exit(2)
        append_attempt(args.finding, f"marked fixed (commit {args.commit or 'n/a'})")
        print(f"{args.finding} marked fixed.")
        return

    cfg = load_config().get("fix_mode", {}) or {}
    max_retries = int(cfg.get("max_retries_per_finding", 2))
    attempts = count_attempts(args.finding)

    print(emit_protocol(finding, max_retries, attempts))


if __name__ == "__main__":
    main()
