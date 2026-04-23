# Code Review Review Checklist

Walk each category. For a hit, confirm the pattern with Grep/Glob across the scope before recording. File a parent finding for repeated patterns rather than one per instance.

---

## 1. Correctness

- Off-by-one in loops, slicing, pagination, range boundaries.
- Null/undefined access without guard. Optional-chain overuse hiding real nulls.
- Wrong branch in conditional — negated condition, flipped comparison.
- Float equality. NaN propagation. Integer overflow in typed languages.
- Comparing values of different types (`==` vs `===`, loose equality in JS/Python).
- String/number coercion bugs. `"0"` truthy in JS, `bool("False")` truthy in Python.
- Time zone / date math errors. UTC vs local. DST jumps. Month=0 in JS Date.
- Default mutable arguments (Python `def f(x=[])`).
- Copy vs reference confusion. Shallow vs deep copy.
- Incorrect early return skipping cleanup or side effects.
- Loop index misuse (closures capturing the wrong value).
- Wrong operator: `|` vs `||`, `&` vs `&&`, `=` vs `==`.
- Misordered arguments to a function (especially positional booleans).

## 2. Error Handling

- Swallowed exceptions (`except: pass`, empty catch blocks).
- Generic catch-all that hides specific errors (`except Exception`, `catch (e)`).
- Errors logged but not returned / propagated.
- Async function without try/catch around awaited calls.
- Unawaited promises / fire-and-forget async calls that should be awaited.
- Promise rejections without `.catch` or a global handler.
- Errors raised with too little context (no message, no stack).
- Error types conflated — throwing a string, throwing a plain object.
- Retry loops without backoff. Infinite retry on non-retryable errors.
- Cleanup missing on error paths (file handles, locks, transactions).

## 3. Security

- User input reaching SQL without parameterization.
- User input reaching shell commands without escaping / allowlisting.
- User input reaching HTML without escaping (XSS).
- User input reaching `eval`, `exec`, `Function()`, `subprocess shell=True`.
- Path traversal: user-supplied filenames concatenated into filesystem paths.
- Auth/authz checks missing on an endpoint. Authz check on client only.
- Secrets in code, logs, error messages, or test fixtures.
- Tokens/keys written to memory files, daily logs, or mem0.
- Insecure deserialization (`pickle.loads` on untrusted input, `yaml.load`).
- Weak crypto: MD5/SHA1 for security, hardcoded IVs, rolled-your-own.
- CSRF on state-changing endpoints without token check.
- CORS wildcards on authenticated endpoints.
- JWT without signature verification, or verified with `none` algorithm.
- Timing attacks: `==` comparison of secrets instead of constant-time compare.
- SSRF: user-supplied URLs fetched without allowlist.
- Open redirect in login / auth flows.
- Regex DoS (catastrophic backtracking on user input).

## 4. Concurrency

- Shared mutable state without synchronization.
- Check-then-act races (TOCTOU): `if exists: open` patterns.
- Unawaited async calls inside a loop that must complete sequentially.
- Concurrent DB writes without transaction / row lock.
- Lock acquired in inconsistent order across call sites (deadlock risk).
- Lock held during I/O or across await (lock contention).
- Event handler re-entrancy without guards.
- Cancellation not propagated to child tasks.
- Race between cleanup and in-flight requests (the auth example from the plan).

## 5. Resource Safety

- File handles opened without `with` / `using` / try-finally close.
- DB connections not returned to pool on error path.
- Event listeners added without removal on unmount / teardown.
- Timers / intervals not cleared.
- Subscriptions / observers not unsubscribed.
- Unbounded caches — map that only ever grows.
- Unbounded recursion on user-controlled input.
- Unbounded loops reading external data without a cap.
- Large buffers allocated per-request without reuse.
- Memory held by closures that capture large scope.
- Temp files / directories not cleaned up.

## 6. Type / Contract Violations

- Type annotation lies about actual runtime type.
- External data (API response, JSON from disk, user input) trusted without validation.
- Optional/nullable field treated as required.
- Enum value compared against string literal not in the enum.
- Function signature doesn't match caller assumptions.
- Return type narrower than actual returned values (missing branches).
- `any` / `unknown` / `Dict[str, Any]` hiding a real shape mismatch.
- Interface implementation missing a method — discovered at runtime only.
- Contract in docstring/comment contradicts code behavior.

## 7. Test Coverage Gaps

- Acceptance criteria from spec not covered by any test.
- Branch in code with no test exercising it.
- Assertion that cannot fail (`assert true`, `expect(x).toBeDefined()` on a literal).
- Test that passes because the assertion is never reached (early return, skipped).
- Test uses mocks that don't match real API behavior.
- Integration boundary not tested (DB, HTTP, filesystem).
- Error paths not tested.
- Concurrency / race code without a stress test.
- Security-sensitive code without a negative test (unauth'd request, malformed input).
- Regression test missing for a previously-fixed bug.

## 8. Regression Risk

- Behavior documented in `CLAUDE.md`, README, or spec that code no longer matches.
- Git blame shows a recent change to a function that altered an invariant without updating callers.
- Removed validation that prior commits added deliberately.
- Public API signature changed without a migration note.
- Config default changed silently.
- Dependency upgrade that shifted behavior (if upgrade is in scope).

## 9. Dead / Unreachable Code

Only flag if it masks intent or hides bugs. Skip if it's harmless.

- Branches after an unconditional return / throw.
- `if (false)` or variables never read.
- Functions defined but never called (confirm across the whole repo, not just the scope).
- Duplicate implementations of the same logic in two places (divergence risk).
- TODOs older than 6 months that reference fixed issues.

---

## Anti-Checklist (do NOT file these as findings)

- Style preferences (quote type, import order, line length) — unless a style tool is configured and failing.
- Naming disagreements without a correctness implication.
- Architectural opinions ("this should be a class") without a concrete bug.
- "Could be more readable" without a specific proposal and severity.
- Performance speculation without a measurement.
