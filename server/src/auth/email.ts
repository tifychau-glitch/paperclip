/**
 * Tiny email-sender. Talks to Resend's HTTP API directly with global
 * `fetch` so we don't drag in a new runtime dependency.
 *
 * Configuration:
 *   RESEND_API_KEY  Required. Get from resend.com dashboard.
 *   EMAIL_FROM      Required. Must be a verified sender on your Resend
 *                   account — e.g. `Clipboard <noreply@yourdomain.com>`.
 *                   For first-run testing Resend allows
 *                   `onboarding@resend.dev`, but anything production
 *                   needs domain verification.
 *
 * If either var is missing, `sendEmail` rejects with a recognizable
 * error so callers can degrade gracefully instead of crashing.
 */
import { logger } from "../middleware/logger.js";

export class EmailNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Email provider not configured — missing env vars: ${missing.join(", ")}`,
    );
    this.name = "EmailNotConfiguredError";
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from) missing.push("EMAIL_FROM");
  if (missing.length > 0) throw new EmailNotConfiguredError(missing);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  logger.info(
    { to: input.to, subject: input.subject },
    "Email sent via Resend",
  );
}

/**
 * Whether email sending is currently available. Useful for letting the
 * UI conditionally render "Forgot password?" without pre-flighting a
 * network call.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}

export function renderResetPasswordHtml(opts: {
  userName: string | null;
  resetUrl: string;
}): string {
  const greeting = opts.userName ? `Hi ${opts.userName},` : "Hi,";
  // Using inline styles because email clients strip <style>/<link>.
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f6f8; margin: 0; padding: 32px;">
  <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px; border: 1px solid #eaeaea;">
    <h1 style="margin: 0 0 16px; font-size: 18px; color: #111;">Reset your Clipboard password</h1>
    <p style="color: #444; line-height: 1.6;">${greeting}</p>
    <p style="color: #444; line-height: 1.6;">
      Click the button below to pick a new password. This link expires in one hour.
    </p>
    <p style="margin: 24px 0;">
      <a href="${opts.resetUrl}"
         style="display: inline-block; background: #111; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 500;">
        Reset password
      </a>
    </p>
    <p style="color: #888; font-size: 12px; line-height: 1.6;">
      If you didn't request this, you can safely ignore this email.
      The link only works once and expires automatically.
    </p>
    <p style="color: #888; font-size: 12px; word-break: break-all;">
      Button not working? Paste this URL into your browser:<br>${opts.resetUrl}
    </p>
  </div>
</body></html>`;
}
