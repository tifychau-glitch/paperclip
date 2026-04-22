import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@paperclipai/db";
import type { Config } from "../config.js";
import { resolvePaperclipInstanceId } from "../home-paths.js";
import { logger } from "../middleware/logger.js";
import {
  EmailNotConfiguredError,
  isEmailConfigured,
  renderResetPasswordHtml,
  sendEmail,
} from "./email.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;

const AUTH_COOKIE_PREFIX_FALLBACK = "default";
const AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE = /[^a-zA-Z0-9_-]+/g;

export function deriveAuthCookiePrefix(instanceId = resolvePaperclipInstanceId()): string {
  const scopedInstanceId = instanceId
    .trim()
    .replace(AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE, "-")
    .replace(/^-+|-+$/g, "") || AUTH_COOKIE_PREFIX_FALLBACK;
  return `paperclip-${scopedInstanceId}`;
}

export function buildBetterAuthAdvancedOptions(input: { disableSecureCookies: boolean }) {
  return {
    cookiePrefix: deriveAuthCookiePrefix(),
    ...(input.disableSecureCookies ? { useSecureCookies: false } : {}),
  };
}

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
    }
  }

  return Array.from(trustedOrigins);
}

/**
 * Parse INVITE_ALLOWLIST (comma-separated emails). Returns null when the
 * allowlist is disabled, or a lowercased Set of emails when enabled.
 * Kept in sync with ../middleware/invite-only.ts — both paths check the
 * same env var so the gate is consistent at sign-up and at API-call time.
 */
function parseInviteAllowlist(): Set<string> | null {
  const raw = process.env.INVITE_ALLOWLIST;
  if (!raw) return null;
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return emails.length > 0 ? new Set(emails) : null;
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins?: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET) must be set. " +
      "For local development, set BETTER_AUTH_SECRET=paperclip-dev-secret in your .env file.",
    );
  }
  const effectiveTrustedOrigins = trustedOrigins ?? deriveAuthTrustedOrigins(config);

  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? baseUrl;
  const isHttpOnly = publicUrl ? publicUrl.startsWith("http://") : false;

  // Google OAuth is enabled only when both env vars are set, so local-dev
  // (email/password) deployments don't accidentally advertise a broken
  // Google sign-in button. See DEPLOY.md for the Railway setup steps.
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const socialProviders =
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : undefined;

  // OAuth redirect URI sanity check. If Google sign-in is enabled, log
  // the exact callback URL that Better Auth will advertise so operators
  // can verify it matches the "Authorized redirect URI" in their Google
  // Cloud Console credential. Mismatches are the #1 cause of silent
  // Google sign-in failures (spinner → error page with redirect_uri_mismatch).
  if (socialProviders?.google) {
    if (!publicUrl) {
      logger.warn(
        "Google OAuth is configured but neither BETTER_AUTH_URL nor " +
          "PAPERCLIP_PUBLIC_URL is set. Better Auth will guess the callback " +
          "URL per-request from the Host header, which fails if Google's " +
          'configured "Authorized redirect URI" is static. Set ' +
          "BETTER_AUTH_URL to your public origin.",
      );
    } else {
      try {
        const origin = new URL(publicUrl).origin;
        const expectedCallback = `${origin}/api/auth/callback/google`;
        logger.info(
          { expectedCallback },
          "Google OAuth enabled — ensure this exact URL is registered " +
            'under "Authorized redirect URIs" in your Google Cloud ' +
            "Console OAuth client credential.",
        );
      } catch {
        logger.warn(
          { publicUrl },
          "Google OAuth is configured but BETTER_AUTH_URL / PAPERCLIP_PUBLIC_URL " +
            "could not be parsed as a URL. Redirect callback may be wrong.",
        );
      }
    }
  }

  // Sign-up gate: when INVITE_ALLOWLIST is set, reject any new account
  // whose email isn't on the list — including Google OAuth sign-ups. The
  // `databaseHooks.user.create.before` callback fires once, right before
  // Better Auth writes the user row, regardless of which provider was
  // used to authenticate. Throwing here prevents the account from being
  // created at all (vs. the request-time middleware, which can only
  // block API usage after an off-list account already exists).
  const inviteAllowlist = parseInviteAllowlist();
  const databaseHooks = inviteAllowlist
    ? {
        user: {
          create: {
            before: async (user: { email?: string | null }) => {
              const email = user.email?.trim().toLowerCase();
              if (!email || !inviteAllowlist.has(email)) {
                throw new Error(
                  "This email is not on the Clipboard invite allowlist.",
                );
              }
            },
          },
        },
      }
    : undefined;

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins: effectiveTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
      // Password reset via email. Better Auth generates a short-lived
      // token and hands us a complete reset URL; we just deliver it.
      // If Resend isn't configured, we log the URL server-side (for
      // small self-hosted setups where the operator can fish it out
      // of logs) and throw so the caller sees a clear error state
      // instead of a silent success.
      sendResetPassword: async (data: {
        user: { email: string; name?: string | null };
        url: string;
      }) => {
        try {
          await sendEmail({
            to: data.user.email,
            subject: "Reset your Clipboard password",
            html: renderResetPasswordHtml({
              userName: data.user.name ?? null,
              resetUrl: data.url,
            }),
            text: `Reset your Clipboard password: ${data.url}`,
          });
        } catch (err) {
          if (err instanceof EmailNotConfiguredError) {
            logger.warn(
              { to: data.user.email, resetUrl: data.url },
              "Password reset requested but email sending is not configured — " +
                "URL logged here; set RESEND_API_KEY and EMAIL_FROM to send " +
                "real emails. See DEPLOY.md.",
            );
          } else {
            logger.error(
              { err, to: data.user.email },
              "Failed to send password reset email",
            );
          }
          throw err;
        }
      },
    },
    ...(socialProviders ? { socialProviders } : {}),
    ...(databaseHooks ? { databaseHooks } : {}),
    advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies: isHttpOnly }),
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
