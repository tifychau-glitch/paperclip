#!/usr/bin/env python3
"""
memory-writer.py — post-run memory appender for Clipboard agents.

Called after a heartbeat run completes. Fetches the run transcript from the
Paperclip REST API, asks the local `claude` CLI to summarize it in 3-5 bullet
points, and appends the summary to {cwd}/memory.md with a timestamp header.

When memory.md exceeds 8000 words, entries older than 30 days are compressed
into monthly "## Archive — YYYY-MM" sections.

Runs in the background from the server and should never raise to the caller.
All errors are printed to stderr and the script exits 0 so a broken writer
cannot break a run.

Usage:
  memory-writer.py --agent-id A --run-id R --agent-name "Name" --cwd /path

Environment:
  PAPERCLIP_API_BASE  base URL for the Paperclip REST API
                      (default: http://localhost:3100/api)
  CLAUDE_BIN          path to the claude CLI (default: "claude" on PATH)
  MEMORY_WORD_CAP     soft cap before compression (default: 8000)
  MEMORY_ARCHIVE_DAYS compression threshold in days (default: 30)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_BASE = os.environ.get("PAPERCLIP_API_BASE", "http://localhost:3100/api").rstrip("/")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
WORD_CAP = int(os.environ.get("MEMORY_WORD_CAP", "8000"))
ARCHIVE_DAYS = int(os.environ.get("MEMORY_ARCHIVE_DAYS", "30"))
SUMMARY_PROMPT = (
    "Summarize this agent run in 3-5 bullet points for future reference. "
    "Focus on: what task was done, key decisions made, output produced, "
    "anything that should be remembered for next time. Be concise. "
    "Return ONLY the bullet points, no preamble."
)
ENTRY_RE = re.compile(
    r"^## (?P<date>\d{4}-\d{2}-\d{2})(?:T[\d:\.Z+\-]+)? — (?P<title>.+)$",
    re.MULTILINE,
)


def log(msg: str) -> None:
    """Write a diagnostic line to stderr. Never raises."""
    try:
        sys.stderr.write(f"[memory-writer] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass


def fetch_run(run_id: str) -> dict[str, Any] | None:
    """Pull run detail from Paperclip's REST API. Returns None on any error."""
    url = f"{API_BASE}/heartbeat-runs/{run_id}"
    try:
        req = urllib.request.Request(url, headers={"accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
        return json.loads(body.decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
        log(f"fetch_run failed for {run_id}: {err}")
        return None


def extract_task_title(run: dict[str, Any]) -> str:
    """Best-effort short title for the run."""
    ctx = run.get("contextSnapshot") or {}
    for key in ("taskTitle", "title", "wakeReason"):
        val = ctx.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip().splitlines()[0][:120]
    # Fall through: pull the first line of the prompt from payload
    payload = (ctx.get("payload") or {}) if isinstance(ctx, dict) else {}
    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if isinstance(prompt, str) and prompt.strip():
        return prompt.strip().splitlines()[0][:120]
    # Last resort: run id
    return f"Run {run.get('id', '')[:8]}"


def build_transcript(run: dict[str, Any]) -> str:
    """Compose a text blob describing the run for Claude to summarize."""
    ctx = run.get("contextSnapshot") or {}
    result = run.get("resultJson") or {}
    pieces: list[str] = []

    payload = ctx.get("payload") if isinstance(ctx, dict) else None
    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if isinstance(prompt, str) and prompt.strip():
        pieces.append(f"## Task prompt\n{prompt.strip()}")

    wake = ctx.get("wakeReason") if isinstance(ctx, dict) else None
    if isinstance(wake, str) and wake.strip():
        pieces.append(f"## Wake reason\n{wake.strip()}")

    summary = result.get("summary") or result.get("result") if isinstance(result, dict) else None
    if isinstance(summary, str) and summary.strip():
        pieces.append(f"## Agent output\n{summary.strip()}")

    stdout = run.get("stdout") or run.get("stdoutExcerpt")
    if isinstance(stdout, str) and stdout.strip():
        pieces.append(f"## stdout (excerpt)\n{stdout.strip()[:4000]}")

    if run.get("error"):
        pieces.append(f"## Error\n{run['error']}")

    return "\n\n".join(pieces) if pieces else "(no transcript data available)"


def run_claude_summary(transcript: str) -> str | None:
    """Shell out to the `claude` CLI to get a 3-5 bullet summary."""
    prompt = f"{SUMMARY_PROMPT}\n\n---\n\n{transcript}"
    try:
        completed = subprocess.run(
            [CLAUDE_BIN, "-p", prompt],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except FileNotFoundError:
        log(f"claude CLI not found at '{CLAUDE_BIN}'")
        return None
    except subprocess.TimeoutExpired:
        log("claude CLI timed out after 120s")
        return None
    except OSError as err:
        log(f"claude CLI spawn failed: {err}")
        return None

    if completed.returncode != 0:
        log(
            f"claude CLI exited {completed.returncode}; "
            f"stderr={completed.stderr[:400] if completed.stderr else ''}"
        )
        return None
    out = (completed.stdout or "").strip()
    return out or None


def read_memory(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    except OSError as err:
        log(f"read_memory failed: {err}")
        return ""


def write_memory(path: Path, content: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic-ish: write to temp, then rename
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    except OSError as err:
        log(f"write_memory failed: {err}")


def count_words(text: str) -> int:
    return len(text.split())


def maybe_compress(content: str) -> str:
    """Collapse entries older than ARCHIVE_DAYS into monthly archive sections."""
    if count_words(content) <= WORD_CAP:
        return content

    now = datetime.now(timezone.utc)
    cutoff_ts = now.timestamp() - (ARCHIVE_DAYS * 86400)

    # Split by top-level "## " headings while preserving them.
    parts = re.split(r"(?m)(?=^## )", content)
    header_block = ""
    entries: list[str] = []
    for part in parts:
        if not part.strip():
            continue
        if ENTRY_RE.match(part) or part.startswith("## Archive"):
            entries.append(part)
        else:
            header_block += part

    kept: list[str] = []
    archive_entries: dict[str, list[str]] = {}
    preserved_archives: list[str] = []

    for entry in entries:
        if entry.startswith("## Archive"):
            preserved_archives.append(entry.rstrip() + "\n\n")
            continue
        m = ENTRY_RE.match(entry)
        if not m:
            kept.append(entry)
            continue
        try:
            d = datetime.strptime(m.group("date"), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            kept.append(entry)
            continue
        if d.timestamp() >= cutoff_ts:
            kept.append(entry)
        else:
            bucket = d.strftime("%Y-%m")
            archive_entries.setdefault(bucket, []).append(entry.strip())

    new_archives: list[str] = []
    for bucket, bucket_entries in sorted(archive_entries.items()):
        block = "\n\n".join(bucket_entries)
        new_archives.append(f"## Archive — {bucket}\n\n{block}\n\n")

    rebuilt = (header_block.rstrip() + "\n\n") if header_block.strip() else ""
    rebuilt += "".join(preserved_archives)
    rebuilt += "".join(new_archives)
    rebuilt += "\n".join(e.rstrip() for e in kept)
    if not rebuilt.endswith("\n"):
        rebuilt += "\n"
    return rebuilt


def ensure_header(content: str, agent_name: str) -> str:
    if content.strip():
        return content
    return (
        f"# Memory — {agent_name}\n\n"
        f"_Session summaries, newest first. Managed by Clipboard._\n\n"
    )


def append_entry(content: str, title: str, summary: str, when: datetime) -> str:
    safe_title = title.replace("\n", " ").strip()
    date_str = when.strftime("%Y-%m-%d")
    time_str = when.strftime("%H:%M %Z").strip()
    header = f"## {date_str} — Task: {safe_title}"
    if time_str:
        header += f"\n_{time_str}_"
    entry = f"{header}\n\n{summary.strip()}\n\n"
    # Newest on top, after the intro header block.
    lines = content.splitlines(keepends=True)
    insert_at = 0
    # Preserve top-of-file "# ..." block + blank lines.
    for idx, line in enumerate(lines):
        if line.startswith("## "):
            insert_at = idx
            break
        insert_at = idx + 1
    return "".join(lines[:insert_at]) + entry + "".join(lines[insert_at:])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--agent-name", required=True)
    parser.add_argument("--cwd", required=True, help="Agent working directory")
    args = parser.parse_args()

    cwd = Path(args.cwd).expanduser().resolve()
    if not cwd.exists():
        log(f"agent cwd does not exist: {cwd}")
        return 0  # never fail

    memory_path = cwd / "memory.md"

    run = fetch_run(args.run_id)
    if not run:
        return 0  # already logged

    # Only record succeeded runs — failures are noisy.
    if run.get("status") and run["status"] != "succeeded":
        log(f"skipping run {args.run_id} with status {run['status']}")
        return 0

    transcript = build_transcript(run)
    summary = run_claude_summary(transcript)
    if not summary:
        log(f"no summary produced for run {args.run_id}")
        return 0

    title = extract_task_title(run)
    now = datetime.now(timezone.utc)

    existing = read_memory(memory_path)
    existing = ensure_header(existing, args.agent_name)
    updated = append_entry(existing, title, summary, now)
    updated = maybe_compress(updated)
    write_memory(memory_path, updated)
    log(f"appended memory for run {args.run_id} → {memory_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:
        log(f"fatal: {err}")
        sys.exit(0)  # Never propagate failures
