"""Run configured verify commands (test, lint, typecheck) and emit a JSON result.

Usage:
    python3 .claude/skills/code-review/scripts/baseline.py
    python3 .claude/skills/code-review/scripts/baseline.py --json
"""

import argparse
import json
import subprocess
import sys
import time
from typing import Any, Dict, List

from _common import PROJECT_ROOT, ensure_dirs, load_config


def run_cmd(name: str, cmd: str) -> Dict[str, Any]:
    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
        )
        ok = result.returncode == 0
        return {
            "name": name,
            "cmd": cmd,
            "ok": ok,
            "exit_code": result.returncode,
            "stdout_tail": result.stdout[-4000:] if result.stdout else "",
            "stderr_tail": result.stderr[-4000:] if result.stderr else "",
            "duration_s": round(time.time() - start, 2),
        }
    except subprocess.TimeoutExpired:
        return {
            "name": name,
            "cmd": cmd,
            "ok": False,
            "exit_code": None,
            "stdout_tail": "",
            "stderr_tail": "TIMEOUT after 600s",
            "duration_s": round(time.time() - start, 2),
        }
    except Exception as e:
        return {
            "name": name,
            "cmd": cmd,
            "ok": False,
            "exit_code": None,
            "stdout_tail": "",
            "stderr_tail": f"error: {e}",
            "duration_s": round(time.time() - start, 2),
        }


def run_baseline() -> Dict[str, Any]:
    ensure_dirs()
    cfg = load_config()
    verify = (cfg.get("verify") or {}) if cfg else {}

    jobs: List[Dict[str, Any]] = []
    for name in ("test", "lint", "typecheck"):
        cmd = verify.get(name)
        if cmd:
            jobs.append(run_cmd(name, cmd))

    for i, cmd in enumerate(verify.get("custom") or []):
        jobs.append(run_cmd(f"custom-{i+1}", cmd))

    all_ok = all(j["ok"] for j in jobs) if jobs else True
    return {
        "ok": all_ok,
        "ran": len(jobs),
        "failures": [j for j in jobs if not j["ok"]],
        "jobs": jobs,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="Emit full JSON")
    args = ap.parse_args()

    result = run_baseline()

    if args.json:
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["ok"] else 1)

    if result["ran"] == 0:
        print("No verify commands configured. Set .code-review/config.yml verify.{test,lint,typecheck}.")
        sys.exit(0)

    for job in result["jobs"]:
        status = "PASS" if job["ok"] else "FAIL"
        print(f"{status}  {job['name']:<10} {job['duration_s']:>6}s  {job['cmd']}")

    if not result["ok"]:
        print(f"\nBaseline broken: {len(result['failures'])} of {result['ran']} failed.")
        sys.exit(1)
    print(f"\nBaseline green ({result['ran']} jobs).")


if __name__ == "__main__":
    main()
