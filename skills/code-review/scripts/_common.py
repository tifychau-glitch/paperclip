"""Shared helpers for code-review scripts."""

import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import yaml


def find_project_root(start: Optional[Path] = None) -> Path:
    """Walk up until we find .env or CLAUDE.md."""
    path = (start or Path(__file__)).resolve().parent
    while path != path.parent:
        if (path / ".env").exists() or (path / "CLAUDE.md").exists():
            return path
        path = path.parent
    raise RuntimeError("Could not find project root")


PROJECT_ROOT = find_project_root()
REVIEW_DIR = PROJECT_ROOT / ".code-review"
REPORTS_DIR = REVIEW_DIR / "reports"
FIXES_DIR = REVIEW_DIR / "fixes"
PROGRESS_PATH = REVIEW_DIR / "progress.md"
CONFIG_PATH = REVIEW_DIR / "config.yml"
SKILL_DIR = Path(__file__).resolve().parent.parent
EXAMPLE_CONFIG_PATH = SKILL_DIR / "references" / "config_example.yml"


def load_config() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    if EXAMPLE_CONFIG_PATH.exists():
        with open(EXAMPLE_CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    return {}


def ensure_dirs() -> None:
    REVIEW_DIR.mkdir(exist_ok=True)
    REPORTS_DIR.mkdir(exist_ok=True)
    FIXES_DIR.mkdir(exist_ok=True)
    if not PROGRESS_PATH.exists():
        PROGRESS_PATH.write_text("# Code Review Progress Log\n\n")


def now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def today_compact() -> str:
    return datetime.now().strftime("%Y%m%d")


def scan_id(idx: int = 1) -> str:
    return f"S-{today_compact()}-{idx:02d}"


def finding_id(counter: int) -> str:
    return f"F-{today_compact()}-{counter:04d}"


def next_finding_counter() -> int:
    """Walk existing reports for today, return N+1."""
    today = today_compact()
    max_seen = 0
    if not REPORTS_DIR.exists():
        return 1
    for fp in REPORTS_DIR.glob("*.json"):
        try:
            import json
            data = json.loads(fp.read_text())
            for f in data.get("findings", []):
                fid = f.get("id", "")
                if fid.startswith(f"F-{today}-"):
                    n = int(fid.split("-")[-1])
                    if n > max_seen:
                        max_seen = n
        except Exception:
            continue
    return max_seen + 1
