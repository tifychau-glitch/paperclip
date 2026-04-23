"""Send a Code Review digest to Telegram. Called by write_report.py when outputs.telegram.enabled is true.

Input: JSON on stdin: { "findings": [...], "scan_id": "...", "scope": "...", "report": "..." }
Uses TELEGRAM_BOT_TOKEN from .env and chat_id from .code-review/config.yml (or TELEGRAM_CHAT_ID env var).
"""

import json
import os
import sys
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv

from _common import PROJECT_ROOT, load_config

load_dotenv(PROJECT_ROOT / ".env")

SEV_EMOJI_OFF = {"critical": "CRIT", "high": "HIGH", "medium": "MED ", "low": "LOW "}


def build_message(payload: Dict[str, Any]) -> str:
    findings: List[Dict[str, Any]] = payload.get("findings", [])
    scan_id = payload.get("scan_id", "?")
    scope = payload.get("scope", "(unspecified)")
    report = payload.get("report", "")

    counts: Dict[str, int] = {}
    for f in findings:
        counts[f.get("severity", "low")] = counts.get(f.get("severity", "low"), 0) + 1

    lines = [f"Code Review — {scan_id}", f"Scope: {scope}"]
    summary_bits = []
    for sev in ("critical", "high", "medium", "low"):
        if counts.get(sev):
            summary_bits.append(f"{sev} {counts[sev]}")
    if summary_bits:
        lines.append(" · ".join(summary_bits))
    lines.append("")

    for f in findings[:15]:
        loc = f.get("file", "?")
        if f.get("line"):
            loc = f"{loc}:{f['line']}"
        tag = SEV_EMOJI_OFF.get(f.get("severity", "low"), "    ")
        lines.append(f"{tag} {f.get('id','?')} {f.get('title','(untitled)')}")
        lines.append(f"     {loc}")

    if len(findings) > 15:
        lines.append(f"... and {len(findings) - 15} more")

    if report:
        lines.append("")
        lines.append(f"Report: {report}")

    return "\n".join(lines)


def send(chat_id: str, text: str) -> Dict[str, Any]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set in .env")
    r = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def main():
    payload = json.loads(sys.stdin.read())
    cfg = load_config()
    tg = (cfg.get("outputs", {}) or {}).get("telegram", {}) or {}

    chat_id = tg.get("chat_id") or os.getenv("TELEGRAM_CHAT_ID")
    if not chat_id:
        print("[code-review] telegram chat_id not configured; skipping send", file=sys.stderr)
        return

    text = build_message(payload)
    try:
        send(str(chat_id), text)
    except Exception as e:
        print(f"[code-review] telegram send failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
