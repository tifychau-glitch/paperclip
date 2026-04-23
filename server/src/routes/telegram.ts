/**
 * Telegram integration config — per-company.
 *
 * GET    /companies/:id/telegram         Read config (token redacted; we
 *                                        return a `botTokenSet` boolean so
 *                                        the UI can show "Configured" vs
 *                                        prompt for a new value).
 * PATCH  /companies/:id/telegram         Upsert config. Any field omitted
 *                                        is left as-is. To clear the bot
 *                                        token, send `botToken: null`.
 * DELETE /companies/:id/telegram         Remove the row entirely. Listener
 *                                        scanner will tear down the loop on
 *                                        its next reconcile (≤30s).
 * POST   /companies/:id/telegram/test    Validate the supplied token by
 *                                        calling Telegram's /getMe. Used
 *                                        by the UI's "Test connection"
 *                                        button. Pass `botToken` to test a
 *                                        candidate value before saving;
 *                                        omit to test the stored one.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { telegramIntegrations } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";
import { processWebhookUpdate } from "../services/telegram.js";

const TELEGRAM_API = "https://api.telegram.org";

type IntegrationRow = typeof telegramIntegrations.$inferSelect;

interface PublicConfig {
  enabled: boolean;
  botTokenSet: boolean;
  defaultAgentId: string | null;
  allowedUserIds: string[];
  lastPolledAt: string | null;
  lastError: string | null;
}

function publish(row: IntegrationRow | null): PublicConfig {
  if (!row) {
    return {
      enabled: false,
      botTokenSet: false,
      defaultAgentId: null,
      allowedUserIds: [],
      lastPolledAt: null,
      lastError: null,
    };
  }
  return {
    enabled: row.enabled,
    botTokenSet: !!row.botToken,
    defaultAgentId: row.defaultAgentId,
    allowedUserIds: row.allowedUserIds ?? [],
    lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
    lastError: row.lastError,
  };
}

function normalizeUserIds(input: unknown): string[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const value of input) {
    if (typeof value === "number") {
      if (!Number.isInteger(value)) return null;
      out.push(String(value));
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      if (!/^-?\d+$/.test(trimmed)) return null;
      out.push(trimmed);
    } else {
      return null;
    }
  }
  return out;
}

export function telegramRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/telegram", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const row = await db
      .select()
      .from(telegramIntegrations)
      .where(eq(telegramIntegrations.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    res.json(publish(row));
  });

  router.patch("/companies/:companyId/telegram", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = req.body ?? {};

    const patch: Partial<typeof telegramIntegrations.$inferInsert> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.botToken === null) {
      patch.botToken = null;
    } else if (typeof body.botToken === "string" && body.botToken.trim().length > 0) {
      patch.botToken = body.botToken.trim();
    }
    if (body.defaultAgentId === null) {
      patch.defaultAgentId = null;
    } else if (typeof body.defaultAgentId === "string" && body.defaultAgentId.length > 0) {
      patch.defaultAgentId = body.defaultAgentId;
    }
    if (body.allowedUserIds !== undefined) {
      const ids = normalizeUserIds(body.allowedUserIds);
      if (ids === null) {
        res.status(400).json({
          error: "allowedUserIds must be an array of integer-valued strings",
        });
        return;
      }
      patch.allowedUserIds = ids;
    }

    const existing = await db
      .select()
      .from(telegramIntegrations)
      .where(eq(telegramIntegrations.companyId, companyId))
      .then((rows) => rows[0] ?? null);

    let row: IntegrationRow;
    if (existing) {
      const updated = await db
        .update(telegramIntegrations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(telegramIntegrations.id, existing.id))
        .returning();
      row = updated[0]!;
    } else {
      const inserted = await db
        .insert(telegramIntegrations)
        .values({ companyId, ...patch })
        .returning();
      row = inserted[0]!;
    }

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.type === "board" ? req.actor.userId ?? null : null,
      action: "telegram.config_updated",
      entityType: "telegram_integration",
      entityId: row.id,
      details: {
        enabled: row.enabled,
        defaultAgentSet: row.defaultAgentId !== null,
        allowedUserCount: (row.allowedUserIds ?? []).length,
        botTokenSet: !!row.botToken,
        changedKeys: Object.keys(patch).sort(),
      },
    }).catch((err) => {
      logger.warn({ err, companyId }, "Failed to log telegram.config_updated");
    });

    res.json(publish(row));
  });

  router.delete("/companies/:companyId/telegram", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await db
      .delete(telegramIntegrations)
      .where(eq(telegramIntegrations.companyId, companyId));

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.type === "board" ? req.actor.userId ?? null : null,
      action: "telegram.config_deleted",
      entityType: "telegram_integration",
      entityId: null,
      details: {},
    }).catch((err) => {
      logger.warn({ err, companyId }, "Failed to log telegram.config_deleted");
    });

    res.json({ ok: true });
  });

  // Webhook ingest from Telegram. UNAUTHENTICATED — the URL secret is the
  // credential. Returns 200 fast so Telegram doesn't retry. Any
  // processing error is logged but not surfaced to the caller.
  router.post("/telegram/webhook/:secret", async (req, res) => {
    const secret = req.params.secret as string;
    if (!secret || secret.length < 16) {
      res.status(404).json({ ok: false });
      return;
    }
    const integration = await db
      .select()
      .from(telegramIntegrations)
      .where(eq(telegramIntegrations.webhookSecret, secret))
      .then((rows) => rows[0] ?? null);
    if (!integration || !integration.enabled || !integration.botToken) {
      res.status(404).json({ ok: false });
      return;
    }
    // ACK immediately — Telegram will retry on non-2xx.
    res.status(200).json({ ok: true });
    void processWebhookUpdate(db, integration, req.body ?? {}).catch((err) => {
      logger.warn({ err, companyId: integration.companyId }, "Telegram webhook handler threw");
    });
  });

  router.post("/companies/:companyId/telegram/test", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const supplied = typeof req.body?.botToken === "string" ? req.body.botToken.trim() : null;
    let token = supplied;
    if (!token) {
      const stored = await db
        .select({ botToken: telegramIntegrations.botToken })
        .from(telegramIntegrations)
        .where(eq(telegramIntegrations.companyId, companyId))
        .then((rows) => rows[0] ?? null);
      token = stored?.botToken ?? null;
    }

    if (!token) {
      res.status(400).json({ ok: false, error: "No bot token supplied or stored" });
      return;
    }

    try {
      const tgRes = await fetch(`${TELEGRAM_API}/bot${token}/getMe`, {
        method: "POST",
      });
      const data = (await tgRes.json()) as {
        ok: boolean;
        result?: { id: number; username?: string; first_name?: string };
        description?: string;
      };
      if (!tgRes.ok || !data.ok) {
        res.status(400).json({
          ok: false,
          error: data.description ?? `Telegram returned ${tgRes.status}`,
        });
        return;
      }
      res.json({
        ok: true,
        botUsername: data.result?.username ?? null,
        botName: data.result?.first_name ?? null,
        botId: data.result?.id ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ ok: false, error: message });
    }
  });

  return router;
}
