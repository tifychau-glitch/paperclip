"""Triage a list of draft findings: assign IDs, sort by severity, dedupe against prior reports.

Input: JSON list of draft findings on stdin (no id, no scan_id required).
Output: JSON list of triaged findings on stdout.

Usage:
    cat drafts.json | python3 .claude/skills/code-review/scripts/triage.py --scan-id S-20260419-01
"""

import argparse
import json
import sys
from typing import Any, Dict, List

from _common import REPORTS_DIR, finding_id, next_finding_counter

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def load_prior_open_findings() -> List[Dict[str, Any]]:
    prior: List[Dict[str, Any]] = []
    if not REPORTS_DIR.exists():
        return prior
    for fp in sorted(REPORTS_DIR.glob("*.json")):
        try:
            data = json.loads(fp.read_text())
            for f in data.get("findings", []):
                if f.get("status") == "open":
                    prior.append(f)
        except Exception:
            continue
    return prior


def title_overlap(a: str, b: str) -> float:
    sa = {w.lower() for w in a.split() if len(w) > 3}
    sb = {w.lower() for w in b.split() if len(w) > 3}
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa), len(sb))


def is_duplicate(draft: Dict[str, Any], prior: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Return the matching prior finding if draft is a duplicate, else empty dict."""
    for p in prior:
        if p.get("file") != draft.get("file"):
            continue
        if p.get("category") != draft.get("category"):
            continue
        if title_overlap(p.get("title", ""), draft.get("title", "")) >= 0.5:
            return p
    return {}


def triage(drafts: List[Dict[str, Any]], scan_id: str) -> List[Dict[str, Any]]:
    prior = load_prior_open_findings()
    counter = next_finding_counter()
    out: List[Dict[str, Any]] = []

    for draft in drafts:
        dup = is_duplicate(draft, prior)
        if dup:
            # Keep the existing ID; update status/evidence if the draft has new info.
            draft["id"] = dup["id"]
            draft["status"] = draft.get("status", "open")
            draft["duplicate_of"] = dup["id"]
        else:
            draft["id"] = finding_id(counter)
            draft["status"] = draft.get("status", "open")
            counter += 1
        draft["scan_id"] = scan_id
        out.append(draft)

    out.sort(key=lambda f: (SEVERITY_ORDER.get(f.get("severity", "low"), 99), f.get("file", "")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan-id", required=True)
    args = ap.parse_args()

    raw = sys.stdin.read()
    if not raw.strip():
        print("[]")
        return
    drafts = json.loads(raw)
    triaged = triage(drafts, args.scan_id)
    print(json.dumps(triaged, indent=2))


if __name__ == "__main__":
    main()
