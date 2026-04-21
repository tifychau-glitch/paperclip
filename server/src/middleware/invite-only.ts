/**
 * Invite-only gate for beta deployments.
 *
 * Behavior:
 *   - Reads INVITE_ALLOWLIST (comma-separated email addresses) at process start.
 *   - If unset or empty → no-op (open mode; useful for self-hosting and local dev).
 *   - If set → after auth resolution, any authenticated request whose actor's
 *     email is NOT in the allowlist gets a 403 with a clean HTML explainer.
 *
 * Ordering notes (see app.ts):
 *   - This must run AFTER actorMiddleware (which populates req.actor.userEmail).
 *   - It is mounted on the /api Router, so it never blocks /api/auth/* (OAuth
 *     callback, sign-in flow) — those live outside the gated router.
 *   - Unauthenticated requests (actor.type === "none") pass through so the
 *     server can return its usual 401 shape; we only act when an identity is
 *     present but off-list. This keeps health checks and session probes sane.
 *
 * The contact email defaults to the allowlist owner's environment-configured
 * address (CLIPBOARD_CONTACT_EMAIL); fallback text is rendered if unset.
 */
import type { RequestHandler } from "express";
import { logger } from "./logger.js";

function parseAllowlist(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (emails.length === 0) return null;
  return new Set(emails);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderForbiddenPage(contactEmail: string | undefined): string {
  const contactLine = contactEmail
    ? `If you'd like access, contact <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.`
    : "If you'd like access, contact the Clipboard operator.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Clipboard — invite only</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #0b0b0f;
        color: #e7e7ea;
      }
      .card {
        max-width: 440px;
        padding: 32px 28px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        background: #111116;
        text-align: center;
      }
      h1 { margin: 0 0 12px; font-size: 20px; font-weight: 600; }
      p { margin: 8px 0; line-height: 1.5; color: #c2c2c8; }
      a { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Clipboard is currently invite-only.</h1>
      <p>${contactLine}</p>
    </main>
  </body>
</html>`;
}

export interface InviteOnlyOptions {
  /** Override for tests; defaults to process.env.INVITE_ALLOWLIST */
  allowlist?: string;
  /** Override for tests; defaults to process.env.CLIPBOARD_CONTACT_EMAIL */
  contactEmail?: string;
}

export function inviteOnlyMiddleware(opts: InviteOnlyOptions = {}): RequestHandler {
  const allowlist = parseAllowlist(opts.allowlist ?? process.env.INVITE_ALLOWLIST);
  const contactEmail = (opts.contactEmail ?? process.env.CLIPBOARD_CONTACT_EMAIL)?.trim();

  if (!allowlist) {
    logger.info("Invite allowlist disabled (INVITE_ALLOWLIST unset) — open mode.");
    return (_req, _res, next) => next();
  }
  logger.info(`Invite allowlist enabled (${allowlist.size} address(es)).`);

  const forbiddenHtml = renderForbiddenPage(contactEmail);

  return (req, res, next) => {
    const actor = req.actor;
    // Gate only interactive human sessions. Agent JWTs, provisioned board
    // API keys, and the local_trusted implicit board actor are all
    // out-of-band access paths that the operator has already consented to.
    // Unauthenticated "none" actors also pass through so the server can
    // respond with its usual 401 shape for a missing session.
    if (!actor || actor.type !== "board" || actor.source !== "session") {
      return next();
    }

    const email = actor.userEmail?.trim().toLowerCase();
    if (email && allowlist.has(email)) return next();

    logger.warn(
      { userId: actor.userId, email: actor.userEmail ?? null, path: req.originalUrl },
      "Blocked request from user outside invite allowlist",
    );
    res.status(403).type("html").send(forbiddenHtml);
  };
}
