---
slug: code-review
name: Code Review
description: Systematic code review and bug hunting. Scans a scope, files structured findings (severity-graded, with reproductions for medium+), and writes machine + human reports. Two modes — review (default, read-only) and fix (explicit opt-in per invocation). Use when asked to review, audit, scan, check for bugs, or QA a codebase.
model: sonnet
---

# Code Review

Systematic review of a code scope. Capability, not a persona — the agent
using this skill keeps its own voice. The skill governs *process*: what to
look for, how to grade severity, where to write findings, when to reproduce
versus describe, how to dedupe across scans.

## Modes

### Review (default, read-only)

Every invocation starts in review mode. Review does not modify application
code. Writes are limited to `.code-review/` artifacts and new test files in
the project's existing test tree.

### Fix (explicit opt-in, per-invocation)

Activates only when the user says something like "fix R-YYYYMMDD-NNNN" or
"fix the findings from today's review." Fix mode does not persist across
invocations — every new run starts in review mode again.

In fix mode, for each target finding:
1. Re-read the finding and its repro test.
2. If no repro test exists, write one first. It must fail before the fix.
3. Apply the minimum fix.
4. Re-run baseline. If green, commit with `fix(review): <title> [R-id]`.
   If red, retry once. If still red after two attempts, abort, leave the
   finding `status: open`, and log attempts in `.code-review/fixes/R-id.md`.
5. Update the finding `status` to `fixed` in its report JSON.
6. Move to next finding.

## Session Protocol

Run this sequence every review invocation. One scope per session.

1. **Orient.** Read the requested scope. Read `.code-review/progress.md`
   and the last 3 files in `.code-review/reports/` (if any) for prior
   findings on this scope.

2. **Baseline.** Run the commands listed in `.code-review/config.yml`
   under `verify`. Use `scripts/baseline.py` as the entry point. Capture
   pass/fail counts into the scan record. If baseline is already broken
   and the user didn't ask for a green-up pass, stop and report:
   "Baseline broken: N failures. Fix baseline first or invoke with
   `--ignore-baseline`."

3. **Scan.** Walk the scope against `references/checklist.md`, category by
   category. For each hit:
   - Confirm the pattern with `Grep`/`Glob` before recording — file one
     parent finding for repeated patterns rather than N duplicates.
   - Assign severity per `references/severity_guide.md`.
   - Draft the finding in the schema shape at `references/finding_schema.json`.

4. **Reproduce.** For findings at severity `medium`, `high`, or `critical`,
   write a minimal failing test that demonstrates the bug. Place it in the
   project's existing test tree. If the code is not test-reachable, document
   manual reproduction steps in the `reproduction` field. For `low`, a
   written description is sufficient.

5. **Triage.** Sort by severity (critical → high → medium → low), then by
   file path. Dedupe against open findings from prior scans using
   `scripts/triage.py`. Match criteria: same file, same category, overlapping
   title keywords.

6. **Write report.** Call `scripts/write_report.py` with the triaged findings.
   It emits:
   - `.code-review/reports/<date>_<time>_<scope>.json` (machine)
   - `.code-review/reports/<date>_<time>_<scope>.md` (human)
   - Appends one line to `.code-review/progress.md`.
   - Routes to additional outputs enabled in `.code-review/config.yml`
     (dashboard, Telegram, PR comments, email).

7. **Notify.** `write_report.py` handles this automatically based on config.

8. **Summarize.** Counts by severity + path to the `.md` report. Skip
   commentary; the report carries the detail.

9. **Exit clean.** No fixes in review mode.

## Review Checklist

Full reference at `references/checklist.md`. In rough priority order:

1. **Correctness** — logic errors, off-by-one, null/undefined hazards,
   wrong branches, incorrect comparisons.
2. **Error handling** — swallowed exceptions, missing error paths, generic
   catches, unawaited async rejections.
3. **Security** — input validation, injection (SQL/command/XSS), auth/authz
   boundary leaks, secret exposure, unsafe deserialization.
4. **Concurrency** — races, shared mutable state, unawaited promises, lock
   ordering.
5. **Resource safety** — leaks (file handles, DB connections, event
   listeners), unbounded loops, memory growth.
6. **Type/contract violations** — interface mismatches, lying type
   annotations, unchecked external data.
7. **Test coverage gaps** — acceptance criteria without tests, edge cases
   not exercised, assertions that can't fail.
8. **Regression risk** — behavior that used to work per git history and
   looks altered without justification.
9. **Dead/unreachable code** — only when it masks intent or hides bugs.

## Finding ID Format

`R-YYYYMMDD-NNNN` where NNNN is a zero-padded counter for findings on that
date (across all scans). `scripts/write_report.py` assigns IDs.

## Tools

Allowed:
- Read, Grep, Glob (static analysis, primary)
- Bash (run tests, linters, type checkers, git blame)
- Edit, Write — fix mode only; in review mode, writes are limited to
  `.code-review/` artifacts and new test files
- Agent (Explore) for whole-repo sweeps
- Scripts in this skill's `scripts/` directory

Not allowed without per-run approval:
- External communications (Slack, email, PR comments) — only if enabled in
  config and the user approves the run
- Destructive git operations (`reset --hard`, `push --force`, branch deletion)
- Dependency changes during review — upgrades are their own scope

## Config

`.code-review/config.yml` controls verify commands and output destinations.
See `references/config_example.yml` for the full shape. If no config exists
when the skill is first invoked, create one from the example and ask the
user to confirm the verify commands match the project.

## Scope Rules

- One scope per session. A scope is a directory, a feature area, or a list
  of files — not "the whole repo."
- For whole-repo passes, propose a phased plan first (one scope at a time
  across multiple sessions).
- Do not branch out of the requested scope to flag adjacent issues — note
  them in the report's `out_of_scope` section instead.

## Out of Scope

This skill does not:
- Generate new features
- Refactor for taste or style
- Style-lint unless style is causing actual bugs
- Profile performance beyond obvious algorithmic issues
- Review cross-repo in a single pass
- Modify dependencies during review
