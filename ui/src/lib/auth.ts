// Thin wrapper around Better Auth's HTTP API + a react-query hook for
// session state. The Clipboard UI is custom and does not bundle
// `better-auth/react` — these hand-rolled fetch calls are deliberately
// small so there's less surface area to maintain.
//
// Endpoints (defined by Better Auth):
//   GET  /api/auth/get-session          → { session, user } | null
//   POST /api/auth/sign-in/email        → body { email, password }
//   POST /api/auth/sign-up/email        → body { email, password, name }
//   POST /api/auth/sign-out             → no body
//   POST /api/auth/sign-in/social       → body { provider, callbackURL }

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface AuthSession {
  id: string;
  userId: string;
}

export interface SessionState {
  session: AuthSession | null;
  user: AuthUser | null;
}

const SESSION_KEY = ["auth", "session"] as const;

/**
 * Call Better Auth with credentials included so the session cookie is set.
 * Throws Error(message) on non-2xx so callers can render the server's
 * validation message directly.
 */
async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Better Auth returns structured JSON errors like { message, code }
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message ?? body?.error ?? message;
    } catch {
      /* keep statusText */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  // Better Auth sometimes returns {} for 200 — handle both
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

/**
 * Read the current session. Resolves to { session: null, user: null }
 * when the user is not signed in — a 401 here is not exceptional,
 * it's the normal "logged out" state.
 */
async function getSession(): Promise<SessionState> {
  try {
    const data = await authFetch<SessionState | null>("/get-session", {
      method: "GET",
    });
    if (!data || !data.session || !data.user) {
      return { session: null, user: null };
    }
    return data;
  } catch {
    return { session: null, user: null };
  }
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: getSession,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      authFetch<unknown>("/sign-in/email", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string; name: string }) =>
      authFetch<unknown>("/sign-up/email", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      authFetch<unknown>("/sign-out", { method: "POST" }),
    onSuccess: () => {
      // Wipe the whole query cache so no stale per-user data leaks to the
      // sign-in screen behind the auth gate.
      qc.clear();
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

/**
 * Kick off a social OAuth flow. Better Auth responds with a `url` to
 * navigate to; we perform a full-page redirect so the cookie set by
 * the provider's callback applies cleanly.
 */
export async function startSocialSignIn(
  provider: "google",
  callbackURL = "/",
): Promise<void> {
  const body = await authFetch<{ url?: string; redirect?: boolean }>(
    "/sign-in/social",
    {
      method: "POST",
      body: JSON.stringify({ provider, callbackURL }),
    },
  );
  if (body?.url) {
    window.location.href = body.url;
    return;
  }
  throw new Error("Social sign-in did not return a redirect URL");
}

export interface AuthCapabilities {
  passwordReset: boolean;
  googleOAuth: boolean;
}

export function useAuthCapabilities() {
  return useQuery({
    queryKey: ["auth", "capabilities"],
    queryFn: async (): Promise<AuthCapabilities> => {
      const res = await fetch("/api/auth/capabilities");
      if (!res.ok) return { passwordReset: false, googleOAuth: false };
      return (await res.json()) as AuthCapabilities;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (vars: { email: string; redirectTo?: string }) =>
      authFetch<unknown>("/forget-password", {
        method: "POST",
        body: JSON.stringify({
          email: vars.email,
          redirectTo:
            vars.redirectTo ?? `${window.location.origin}/reset-password`,
        }),
      }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { token: string; newPassword: string }) =>
      authFetch<unknown>("/reset-password", {
        method: "POST",
        body: JSON.stringify({
          newPassword: vars.newPassword,
          token: vars.token,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
}
