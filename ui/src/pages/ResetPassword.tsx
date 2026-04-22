/**
 * Reset-password form reached via the link in the password-reset email.
 * Better Auth puts the token in the query string (?token=xxx); we POST
 * /api/auth/reset-password with that plus the new password, then send
 * the user to the sign-in screen.
 *
 * Rendered at /reset-password, which is reachable pre-session — the
 * App.tsx auth gate routes here explicitly when the URL matches so the
 * normal "render Login or dashboard" branching doesn't swallow the token.
 */
import { useMemo, useState, type FormEvent } from "react";
import { Clipboard, Loader2 } from "lucide-react";
import { useResetPassword } from "../lib/auth";

export function ResetPasswordPage() {
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") ?? "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = useResetPassword();

  const mismatch = confirm.length > 0 && confirm !== password;
  const busy = reset.isPending;
  const serverError = reset.error instanceof Error ? reset.error.message : null;
  const error = localError ?? serverError;
  const done = reset.isSuccess;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!token) {
      setLocalError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setLocalError("Passwords do not match.");
      return;
    }
    reset.mutate({ token, newPassword: password });
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 justify-center">
          <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Clipboard className="size-5" />
          </span>
          <span className="text-lg font-semibold">Clipboard</span>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold mb-1">Choose a new password</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {done
              ? "Password updated. Sign in to continue."
              : "Pick something you'll remember. At least 8 characters."}
          </p>

          {done ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Continue to sign in
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  New password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Confirm password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  autoComplete="new-password"
                  className={`mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    mismatch ? "border-destructive/60" : "border-border"
                  }`}
                />
                {mismatch && (
                  <span className="mt-1 block text-xs text-destructive">
                    Passwords do not match.
                  </span>
                )}
              </label>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Set new password
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/";
                }}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
