# Code Review Severity Guide

Pick the highest severity that matches. When in doubt, err upward for security and data-integrity issues, downward for style-adjacent issues.

---

## critical

Something catastrophic can happen in a normal production path.

- Data loss on normal usage (dropped writes, silent corruption, irreversible mutation).
- Authentication bypass: an unauthenticated user can take authenticated actions.
- Authorization bypass: a user can access or modify another user's data.
- Remote code execution from user input.
- Secret exposure in logs, responses, or public artifacts.
- Crash in a hot path that takes the whole service down.
- Payment / financial logic error that miscounts money.

## high

Wrong result or exploitable condition under normal input, or a real regression.

- Returns incorrect answer for realistic inputs (not edge cases).
- Security issue that requires a specific precondition (e.g. admin flag flipped, unusual route).
- Unauthenticated endpoint missing rate limiting where abuse is realistic.
- Race condition reachable under expected concurrent load.
- Memory leak on the main request path.
- Regression of previously-working behavior documented in spec / README / CLAUDE.md.
- Unhandled exception on a common user path that shows an error page.

## medium

Wrong result under edge input, or missing handling with user-visible impact.

- Off-by-one, timezone, NaN, overflow bugs that only manifest on edge inputs.
- Missing error handling that gives the user a confusing but non-fatal experience.
- Input validation gap that doesn't immediately escalate to security, but could.
- Resource leak on a cold path.
- Test that doesn't actually assert the acceptance criterion it claims to.
- Concurrency issue only reachable under stress.
- Contract violation between modules that works today but is fragile.

## low

Robustness, subtle quality, or test gap with no immediate impact.

- Dead code that hides intent.
- Test gap for a low-risk branch.
- Error message missing context.
- Redundant computation.
- Minor contract drift from docs that nobody relies on.
- Style-adjacent issue only if it's causing confusion bugs.

---

## Tiebreakers

- **Reachable from user input?** Bump up one level.
- **Silent failure (no error, no log)?** Bump up one level.
- **Well-tested and isolated?** Bump down one level.
- **Would a reasonable reviewer block a PR on this?** If yes, floor is `medium`.
