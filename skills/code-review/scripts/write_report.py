"""Emit a Code Review scan report as JSON + Markdown, then route to configured outputs.

Input: JSON payload on stdin matching:
  {
    "scan_id": "S-20260419-01",
    "scope": "src/auth/",
    "baseline": { ... from baseline.py ... },
    "findings": [ ... triaged findings ... ]
  }

Usage:
    cat payload.json | python3 .claude/skills/code-review/scripts/write_report.py
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from _common import (
    PROGRESS_PATH,
    PROJECT_ROOT,
    REPORTS_DIR,
    SKILL_DIR,
    ensure_dirs,
    load_config,
    now_stamp,
)

SEVERITY_ORDER = ["critical", "high", "medium", "low"]


def sev_counts(findings: List[Dict[str, Any]]) -> Dict[str, int]:
    c = {s: 0 for s in SEVERITY_ORDER}
    for f in findings:
        c[f.get("severity", "low")] = c.get(f.get("severity", "low"), 0) + 1
    return c


def slug(scope: str) -> str:
    s = scope.strip().replace("/", "-").replace(" ", "-").strip("-")
    return s[:40] or "scope"


def render_md(payload: Dict[str, Any]) -> str:
    scan_id = payload["scan_id"]
    scope = payload.get("scope", "(unspecified)")
    baseline = payload.get("baseline") or {}
    findings = payload.get("findings") or []
    counts = sev_counts(findings)
    when = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines: List[str] = []
    lines.append(f"# Code Review Scan {scan_id}")
    lines.append("")
    lines.append(f"- Scope: `{scope}`")
    lines.append(f"- When: {when}")
    if baseline:
        if baseline.get("ran", 0) == 0:
            lines.append("- Baseline: no verify commands configured")
        elif baseline.get("ok"):
            lines.append(f"- Baseline: green ({baseline.get('ran')} jobs)")
        else:
            lines.append(
                f"- Baseline: {len(baseline.get('failures', []))} of {baseline.get('ran')} failed"
            )
    lines.append(
        f"- Findings: critical {counts['critical']} · high {counts['high']} · "
        f"medium {counts['medium']} · low {counts['low']}"
    )
    lines.append("")

    if not findings:
        lines.append("No findings.")
        return "\n".join(lines) + "\n"

    for sev in SEVERITY_ORDER:
        bucket = [f for f in findings if f.get("severity") == sev]
        if not bucket:
            continue
        lines.append(f"## {sev.title()} ({len(bucket)})")
        lines.append("")
        for f in bucket:
            loc = f.get("file", "?")
            if f.get("line"):
                loc = f"{loc}:{f['line']}"
            lines.append(f"### {f['id']} — {f.get('title','(untitled)')}")
            lines.append("")
            lines.append(f"- Location: `{loc}`")
            lines.append(f"- Category: {f.get('category','?')}")
            if f.get("duplicate_of"):
                lines.append(f"- Duplicate of: {f['duplicate_of']}")
            lines.append(f"- Status: {f.get('status','open')}")
            if f.get("introduced_commit"):
                lines.append(f"- Introduced: {f['introduced_commit']}")
            lines.append("")
            lines.append("**Evidence**")
            lines.append("")
            lines.append(f.get("evidence", "(none)"))
            lines.append("")
            if f.get("reproduction"):
                lines.append("**Reproduction**")
                lines.append("")
                lines.append(f.get("reproduction"))
                lines.append("")
            if f.get("suggested_fix"):
                lines.append("**Suggested fix**")
                lines.append("")
                lines.append(f.get("suggested_fix"))
                lines.append("")
    return "\n".join(lines) + "\n"


def write_local(payload: Dict[str, Any]) -> Dict[str, Path]:
    ensure_dirs()
    stamp = now_stamp()
    scope = slug(payload.get("scope", "scope"))
    json_path = REPORTS_DIR / f"{stamp}_{scope}.json"
    md_path = REPORTS_DIR / f"{stamp}_{scope}.md"

    json_path.write_text(json.dumps(payload, indent=2))
    md_path.write_text(render_md(payload))

    # Append progress entry.
    counts = sev_counts(payload.get("findings") or [])
    with PROGRESS_PATH.open("a") as f:
        f.write(
            f"- {datetime.now().strftime('%Y-%m-%d %H:%M')} | {payload['scan_id']} | "
            f"scope `{payload.get('scope','?')}` | "
            f"crit {counts['critical']} high {counts['high']} "
            f"med {counts['medium']} low {counts['low']} | "
            f"[{md_path.name}](reports/{md_path.name})\n"
        )
    return {"json": json_path, "md": md_path}


def route_telegram(payload: Dict[str, Any], cfg_tg: Dict[str, Any], md_path: Path):
    if not cfg_tg.get("enabled"):
        return
    min_sev = cfg_tg.get("min_severity", "critical")
    threshold = SEVERITY_ORDER.index(min_sev) if min_sev in SEVERITY_ORDER else 0
    hits = [
        f for f in payload.get("findings", [])
        if SEVERITY_ORDER.index(f.get("severity", "low")) <= threshold
    ]
    if not hits:
        return
    script = SKILL_DIR / "scripts" / "notify_telegram.py"
    try:
        subprocess.run(
            ["python3", str(script), "--payload", str(md_path)],
            check=False,
            cwd=PROJECT_ROOT,
            input=json.dumps({"findings": hits, "scan_id": payload["scan_id"],
                              "scope": payload.get("scope"), "report": str(md_path)}),
            text=True,
            timeout=30,
        )
    except Exception as e:
        print(f"[code-review] telegram notify failed: {e}", file=sys.stderr)


def route_dashboard(payload: Dict[str, Any], cfg_dash: Dict[str, Any], md_path: Path):
    if not cfg_dash.get("enabled"):
        return
    script = SKILL_DIR / "scripts" / "notify_dashboard.py"
    try:
        subprocess.run(
            ["python3", str(script)],
            check=False,
            cwd=PROJECT_ROOT,
            input=json.dumps({
                "project_id": cfg_dash.get("project_id"),
                "scan_id": payload["scan_id"],
                "scope": payload.get("scope"),
                "findings": payload.get("findings", []),
                "report": str(md_path),
            }),
            text=True,
            timeout=30,
        )
    except Exception as e:
        print(f"[code-review] dashboard notify failed: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stdin-file", help="Read payload from file instead of stdin")
    args = ap.parse_args()

    raw = Path(args.stdin_file).read_text() if args.stdin_file else sys.stdin.read()
    payload = json.loads(raw)

    paths = write_local(payload)
    cfg = load_config().get("outputs", {}) or {}

    route_telegram(payload, cfg.get("telegram", {}) or {}, paths["md"])
    route_dashboard(payload, cfg.get("dashboard", {}) or {}, paths["md"])

    counts = sev_counts(payload.get("findings") or [])
    print(json.dumps({
        "json": str(paths["json"]),
        "md": str(paths["md"]),
        "counts": counts,
    }, indent=2))


if __name__ == "__main__":
    main()
