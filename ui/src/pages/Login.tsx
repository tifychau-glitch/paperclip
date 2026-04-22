/**
 * Sign-in / sign-up screen shown whenever the Better Auth session is empty.
 *
 * Renders a single form that toggles between two modes:
 *   - "signin": email + password
 *   - "signup": email + password + name (first user becomes instance_admin)
 *
 * Includes a "Continue with Google" button. If the server does not have
 * GOOGLE_CLIENT_ID/SECRET configured, clicking shows the server's error
 * inline rather than redirecting — no capabilities probe needed.
 */
import { useState, type FormEvent } from "react";
import { Clipboard, Loader2 } from "lucide-react";
import {
  startSocialSignIn,
  useAuthCapabilities,
  useForgotPassword,
  useSignIn,
  useSignUp,
} from "../lib/auth";

type Mode = "signin" | "signup" | "forgot";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [socialError, setSocialError] = useState<string | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);

  const signIn = useSignIn();
  const signUp = useSignUp();
  const forgot = useForgotPassword();
  const capabilities = useAuthCapabilities();

  const busy =
    signIn.isPending ||
    signUp.isPending ||
    forgot.isPending ||
    socialLoading;
  const error =
    socialError ??
    (signIn.error instanceof Error ? signIn.error.message : null) ??
    (signUp.error instanceof Error ? signUp.error.message : null) ??
    (forgot.error instanceof Error ? forgot.error.message : null);
  const forgotSent = forgot.isSuccess;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSocialError(null);
    if (mode === "signin") {
      signIn.mutate({ email, password });
    } else if (mode === "signup") {
      signUp.mutate({ email, password, name: name.trim() || email });
    } else {
      forgot.mutate({ email });
    }
  }

  async function handleGoogle() {
    setSocialError(null);
    setSocialLoading(true);
    try {
      await startSocialSignIn("google", window.location.origin + "/");
      // The function above performs a full-page redirect on success, so
      // control only returns here if it threw before redirecting.
    } catch (err) {
      setSocialError(
        err instanceof Error
          ? err.message
          : "Google sign-in is not available on this instance.",
      );
      setSocialLoading(false);
    }
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
          <h1 className="text-lg font-semibold mb-1">
            {mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create your account"
                : "Reset your password"}
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            {mode === "signin"
              ? "Welcome back."
              : mode === "signup"
                ? "The first person to sign up becomes the instance admin."
                : "Enter your email and we'll send you a reset link."}
          </p>

          {mode !== "forgot" && capabilities.data?.googleOAuth !== false && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent/40 disabled:opacity-50"
              >
                {socialLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GoogleGlyph className="size-4" />
                )}
                Continue with Google
              </button>

              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {mode === "forgot" && forgotSent ? (
            <div className="rounded-md border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
              If an account exists for <strong className="text-foreground">{email}</strong>,
              a reset link is on its way. Check your inbox (and spam folder).
              The link expires in one hour.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">
                    Name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    autoComplete="name"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  autoComplete="email"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              {mode !== "forgot" && (
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">
                    Password
                  </span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {mode === "signup" && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Minimum 8 characters.
                    </span>
                  )}
                </label>
              )}

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
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
              </button>
            </form>
          )}

          <div className="mt-4 text-center text-sm text-muted-foreground space-y-1">
            {mode === "signin" && (
              <>
                <div>
                  New here?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      signIn.reset();
                      setSocialError(null);
                      setMode("signup");
                    }}
                    className="text-primary hover:underline"
                  >
                    Create an account
                  </button>
                </div>
                {capabilities.data?.passwordReset && (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        signIn.reset();
                        setSocialError(null);
                        setMode("forgot");
                      }}
                      className="text-primary hover:underline"
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}
              </>
            )}
            {mode === "signup" && (
              <div>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    signUp.reset();
                    setSocialError(null);
                    setMode("signin");
                  }}
                  className="text-primary hover:underline"
                >
                  Sign in
                </button>
              </div>
            )}
            {mode === "forgot" && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    forgot.reset();
                    setSocialError(null);
                    setMode("signin");
                  }}
                  className="text-primary hover:underline"
                >
                  Back to sign in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Tiny inline Google G glyph so we don't pull a new icon dependency.
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.4-1.14 2.58-2.41 3.39v2.77h3.9c2.27-2.09 3.59-5.17 3.59-8.4z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.96-2.91l-3.9-2.77c-1.08.72-2.46 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.24v3.11C3.25 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.52a7.22 7.22 0 010-4.58V6.84H1.24a12 12 0 000 10.79l4.03-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.77 0 3.36.61 4.61 1.81l3.46-3.46C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.24 6.84l4.03 3.11C6.22 6.87 8.87 4.76 12 4.76z"
      />
    </svg>
  );
}
