/**
 * Telegram integration — incoming messages → agent wakeups, with replies
 * threaded back to the original message and a typing indicator while the
 * agent thinks.
 *
 * Two ingest modes, decided at start() / reconcile() time:
 *
 *   POLLING (default, dev-friendly):
 *     One long-poll loop per enabled integration calls Telegram's
 *     getUpdates with a 25s timeout. The loop persists its cursor in
 *     telegram_integrations.last_update_id so it resumes cleanly across
 *     restarts. Average latency ~12s — fine for local dev, slow for prod.
 *
 *   WEBHOOK (prod, recommended on Railway):
 *     If TELEGRAM_PUBLIC_URL is set, every enabled integration registers
 *     a webhook with Telegram pointing at
 *     `${TELEGRAM_PUBLIC_URL}/api/telegram/webhook/:secret`. Telegram
 *     pushes updates to that URL as soon as a message arrives — latency
 *     is ~200ms instead of 0–25s. The :secret path segment is the
 *     integration's `webhook_secret` column (random per integration,
 *     generated lazily). Polling loops are torn down in webhook mode;
 *     only one ingest path can run at a time per bot token.
 *
 * Per-message flow (identical in both modes):
 *   1. Drop anything that isn't a text message in a private chat.
 *   2. Reject senders not in `allowed_user_ids`.
 *   3. Resolve the target agent — `default_agent_id` for v0.
 *   4. wakeup the agent. trigger_detail carries `telegram:CHATID:MSGID`
 *      so the post-run hook can find its way back to the right chat AND
 *      thread the reply to the original message.
 *   5. Send a "Working on it" ack as a *reply* to the inbound message.
 *   6. Start a typing indicator that pulses every ~4s until the run
 *      finishes. dispatchTelegramReply (called from heartbeat post-run)
 *      stops the typing loop and posts the agent's final answer, also
 *      threaded as a reply to the original message.
 *
 * Errors are logged + persisted to integrations.last_error; never thrown
 * out of this module — the heartbeat must never block on Telegram I/O.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns, telegramIntegrations } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "./heartbeat.js";

const TELEGRAM_API = "https://api.telegram.org";
const LONG_POLL_TIMEOUT_S = 25;
const ERROR_BACKOFF_MS = 10_000;
const CONFIG_RESCAN_MS = 30_000;
const MAX_REPLY_CHARS = 3800;
// Telegram's "typing" action expires after ~5s; refresh just under that.
const TYPING_REFRESH_MS = 4_000;
// Hard ceiling on a typing interval — even if the post-run hook never
// fires (server restart with the OS process surviving, missed callback,
// etc.), we don't want a "typing forever" indicator. 10 minutes is
// generous for any normal CEO run.
const TYPING_MAX_AGE_MS = 10 * 60 * 1_000;

// trigger_detail format: telegram:<chatId>:<replyToMessageId>
// Both ints, colon-delimited, parsed back out by dispatchTelegramReply.
export const TELEGRAM_TRIGGER_PREFIX = "telegram:";

// Module-level so dispatchTelegramReply (called from heartbeat) can stop
// the typing loop a wakeup started, even though the two run inside
// different service factory invocations. Each entry holds both the
// refresh interval AND the max-age safety timer so stopTypingLoop can
// clear both atomically.
const typingIntervals = new Map<string, { interval: NodeJS.Timeout; safety: NodeJS.Timeout }>();

type IntegrationRow = typeof telegramIntegrations.$inferSelect;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    voice?: unknown;
  };
}

interface PerCompanyLoop {
  companyId: string;
  cancel: () => void;
  done: Promise<void>;
}

// ─── Telegram HTTP helpers (top-level so the webhook route can reuse) ────

async function tgFetch<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { description?: string };
      detail = data.description ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`Telegram ${method} ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram ${method}: ${data.description ?? "unknown error"}`);
  }
  return data.result as T;
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  await tgFetch(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyToMessageId
      ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true }
      : {}),
  }).catch((err) => {
    logger.warn({ err, chatId }, "Failed to send Telegram message");
  });
}

async function sendChatAction(token: string, chatId: number, action: "typing"): Promise<void> {
  await tgFetch(token, "sendChatAction", { chat_id: chatId, action }).catch(() => {
    // Swallow — typing pings are advisory; if Telegram is grumpy we'd
    // still rather complete the run than fail the loop on this.
  });
}

function startTypingLoop(token: string, chatId: number, runId: string): void {
  // Defensive: kill any prior loop for this runId (shouldn't happen, but
  // ensures we never lose track of an old interval and leak it forever).
  stopTypingLoop(runId);
  // First action immediately so the user sees it before the next interval.
  void sendChatAction(token, chatId, "typing");
  const interval = setInterval(() => {
    void sendChatAction(token, chatId, "typing");
  }, TYPING_REFRESH_MS);
  // Backstop: even if dispatchTelegramReply never fires for this runId,
  // we stop pinging Telegram after TYPING_MAX_AGE_MS so the user never
  // sees a "typing forever" indicator.
  const safety = setTimeout(() => {
    logger.warn(
      { runId, chatId, ageMs: TYPING_MAX_AGE_MS },
      "Telegram typing loop hit max-age safety stop",
    );
    stopTypingLoop(runId);
  }, TYPING_MAX_AGE_MS);
  typingIntervals.set(runId, { interval, safety });
}

function stopTypingLoop(runId: string): void {
  const handles = typingIntervals.get(runId);
  if (handles) {
    clearInterval(handles.interval);
    clearTimeout(handles.safety);
    typingIntervals.delete(runId);
  }
}

function encodeTriggerDetail(chatId: number, messageId: number): string {
  return `${TELEGRAM_TRIGGER_PREFIX}${chatId}:${messageId}`;
}

interface ParsedTrigger {
  chatId: number;
  replyToMessageId: number | null;
}

function parseTriggerDetail(triggerDetail: string | null): ParsedTrigger | null {
  if (!triggerDetail || !triggerDetail.startsWith(TELEGRAM_TRIGGER_PREFIX)) return null;
  const rest = triggerDetail.slice(TELEGRAM_TRIGGER_PREFIX.length);
  const parts = rest.split(":");
  const chatId = Number(parts[0]);
  if (!Number.isFinite(chatId)) return null;
  const msgId = parts[1] != null ? Number(parts[1]) : NaN;
  return {
    chatId,
    replyToMessageId: Number.isFinite(msgId) ? msgId : null,
  };
}

// ─── DB helpers ──────────────────────────────────────────────────────────

async function recordError(db: Db, companyId: string, message: string | null): Promise<void> {
  await db
    .update(telegramIntegrations)
    .set({ lastError: message, lastPolledAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramIntegrations.companyId, companyId))
    .catch((err) => {
      logger.warn({ err, companyId }, "Failed to record telegram lastError");
    });
}

async function persistCursor(db: Db, companyId: string, lastUpdateId: number): Promise<void> {
  await db
    .update(telegramIntegrations)
    .set({
      lastUpdateId,
      lastPolledAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(telegramIntegrations.companyId, companyId))
    .catch((err) => {
      logger.warn({ err, companyId }, "Failed to persist telegram cursor");
    });
}

async function ensureWebhookSecret(db: Db, integration: IntegrationRow): Promise<string> {
  if (integration.webhookSecret) return integration.webhookSecret;
  const secret = randomUUID().replace(/-/g, "");
  await db
    .update(telegramIntegrations)
    .set({ webhookSecret: secret, updatedAt: new Date() })
    .where(eq(telegramIntegrations.id, integration.id));
  return secret;
}

// ─── Update processing (shared between polling + webhook ingest) ─────────

export async function processUpdate(
  db: Db,
  integration: IntegrationRow,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message || !message.from) return;
  if (message.chat.type !== "private") return;
  if (!message.text || message.text.trim().length === 0) {
    if (message.voice) {
      await sendMessage(
        integration.botToken!,
        message.chat.id,
        "Voice messages aren't supported yet — text only for now.",
        message.message_id,
      );
    }
    return;
  }

  const senderId = String(message.from.id);
  if (!integration.allowedUserIds.includes(senderId)) {
    logger.info(
      { companyId: integration.companyId, senderId, username: message.from.username },
      "Telegram message from non-allowlisted user ignored",
    );
    return;
  }

  if (!integration.defaultAgentId) {
    await sendMessage(
      integration.botToken!,
      message.chat.id,
      "No default agent is set. Open Clipboard → Settings → Integrations to pick one.",
      message.message_id,
    );
    return;
  }

  const agent = await db
    .select({ id: agents.id, name: agents.name, status: agents.status })
    .from(agents)
    .where(
      and(
        eq(agents.id, integration.defaultAgentId),
        eq(agents.companyId, integration.companyId),
      ),
    )
    .then((rows) => rows[0] ?? null);

  if (!agent) {
    await sendMessage(
      integration.botToken!,
      message.chat.id,
      "Default agent not found. Open Clipboard → Settings → Integrations to fix it.",
      message.message_id,
    );
    return;
  }

  const heartbeat = heartbeatService(db);
  try {
    const run = await heartbeat.wakeup(agent.id, {
      source: "on_demand",
      // chatId AND inbound message id travel through trigger_detail so the
      // post-run hook can both reach the right chat and thread the reply
      // to the original message. contextSnapshot would be cleaner but the
      // heartbeat scheduler rewrites it downstream.
      triggerDetail: encodeTriggerDetail(message.chat.id, message.message_id),
      reason: "Telegram message",
      payload: {
        prompt: message.text,
        source: "telegram",
        chatId: message.chat.id,
        messageId: message.message_id,
        senderId,
        senderUsername: message.from.username ?? null,
      },
      contextSnapshot: {
        triggeredBy: "telegram",
        telegramSenderId: senderId,
        telegramChatId: message.chat.id,
      },
    });
    const runId = run?.id ?? null;
    if (runId) {
      // No "working on it" ack — the typing indicator carries that signal
      // without saturating the chat. dispatchTelegramReply stops it when
      // the run finishes. Telegram expires "typing" after ~5s on its own
      // if we crash before the post-run hook fires.
      startTypingLoop(integration.botToken!, message.chat.id, runId);
    } else {
      // Edge case: wakeup returned no run (e.g. duplicate request collapsed
      // into an in-flight one). Surface it so the user isn't left guessing.
      await sendMessage(
        integration.botToken!,
        message.chat.id,
        `${agent.name}: already working on something — your message is queued.`,
        message.message_id,
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, companyId: integration.companyId, agentId: agent.id },
      "Telegram → wakeup failed",
    );
    await sendMessage(
      integration.botToken!,
      message.chat.id,
      `Failed to start ${agent.name}: ${detail}`,
      message.message_id,
    );
  }
}

// Webhook entry point — called from routes/telegram.ts after looking up
// the integration by webhookSecret.
export async function processWebhookUpdate(
  db: Db,
  integration: IntegrationRow,
  update: TelegramUpdate,
): Promise<void> {
  await processUpdate(db, integration, update).catch((err) => {
    logger.warn(
      { err, companyId: integration.companyId },
      "Telegram webhook processUpdate threw",
    );
  });
  // Touch lastPolledAt so the UI's "last check-in" stays fresh even when
  // we're not polling. Cursor has no meaning in webhook mode.
  await db
    .update(telegramIntegrations)
    .set({ lastPolledAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(telegramIntegrations.id, integration.id))
    .catch(() => undefined);
}

// ─── Webhook setup / teardown ────────────────────────────────────────────

function getPublicUrl(): string | null {
  const url = process.env.TELEGRAM_PUBLIC_URL?.trim();
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) {
    logger.warn({ url }, "TELEGRAM_PUBLIC_URL must start with https:// — ignoring");
    return null;
  }
  return url.replace(/\/+$/, "");
}

async function setupWebhook(db: Db, integration: IntegrationRow, baseUrl: string): Promise<void> {
  if (!integration.botToken) return;
  const secret = await ensureWebhookSecret(db, integration);
  const url = `${baseUrl}/api/telegram/webhook/${secret}`;
  try {
    await tgFetch(integration.botToken, "setWebhook", {
      url,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    logger.info(
      { companyId: integration.companyId, url },
      "Telegram webhook registered",
    );
    await db
      .update(telegramIntegrations)
      .set({ lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(telegramIntegrations.id, integration.id));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn({ err, companyId: integration.companyId }, "Telegram setWebhook failed");
    await recordError(db, integration.companyId, detail);
  }
}

async function tearDownWebhook(integration: IntegrationRow): Promise<void> {
  if (!integration.botToken) return;
  try {
    await tgFetch(integration.botToken, "deleteWebhook", { drop_pending_updates: false });
    logger.info({ companyId: integration.companyId }, "Telegram webhook deleted");
  } catch (err) {
    logger.warn({ err, companyId: integration.companyId }, "Telegram deleteWebhook failed");
  }
}

// ─── Service factory: polling loops + reconcile ──────────────────────────

export function telegramService(db: Db) {
  const loops = new Map<string, PerCompanyLoop>();
  let running = false;
  let scanTimer: NodeJS.Timeout | null = null;

  function startLoop(companyId: string): PerCompanyLoop {
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };

    const done = (async () => {
      logger.info({ companyId }, "Telegram polling loop started");
      while (!cancelled) {
        let integration: IntegrationRow | null = null;
        try {
          integration = await db
            .select()
            .from(telegramIntegrations)
            .where(eq(telegramIntegrations.companyId, companyId))
            .then((rows) => rows[0] ?? null);
        } catch (err) {
          logger.warn({ err, companyId }, "Telegram loop: config read failed");
          await sleep(ERROR_BACKOFF_MS, () => cancelled);
          continue;
        }

        if (!integration || !integration.enabled || !integration.botToken) {
          logger.info({ companyId }, "Telegram loop exiting (disabled or token missing)");
          break;
        }

        try {
          const updates = await tgFetch<TelegramUpdate[]>(
            integration.botToken,
            "getUpdates",
            {
              offset: integration.lastUpdateId + 1,
              timeout: LONG_POLL_TIMEOUT_S,
              allowed_updates: ["message"],
            },
          );

          if (updates.length > 0) {
            for (const update of updates) {
              await processUpdate(db, integration, update).catch((err) => {
                logger.warn({ err, companyId }, "Telegram processUpdate threw");
              });
            }
            const maxId = updates.reduce((m, u) => (u.update_id > m ? u.update_id : m), 0);
            await persistCursor(db, companyId, maxId);
          } else {
            await persistCursor(db, companyId, integration.lastUpdateId);
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          logger.warn({ err, companyId }, "Telegram getUpdates failed");
          await recordError(db, companyId, detail);
          await sleep(ERROR_BACKOFF_MS, () => cancelled);
        }
      }
      logger.info({ companyId }, "Telegram polling loop stopped");
    })();

    return { companyId, cancel, done };
  }

  async function reconcile(): Promise<void> {
    if (!running) return;
    const baseUrl = getPublicUrl();
    const useWebhooks = baseUrl !== null;

    let configs: IntegrationRow[];
    try {
      configs = await db.select().from(telegramIntegrations);
    } catch (err) {
      logger.warn({ err }, "Telegram reconcile: failed to read configs");
      return;
    }

    const desired = configs.filter((c) => c.enabled && c.botToken);
    const desiredIds = new Set(desired.map((c) => c.companyId));

    if (useWebhooks) {
      // Webhook mode: stop every polling loop, ensure webhook on each
      // desired config, tear down webhook on the rest.
      for (const [companyId, loop] of loops) {
        loop.cancel();
        loops.delete(companyId);
      }
      for (const integration of desired) {
        await setupWebhook(db, integration, baseUrl!);
      }
      for (const integration of configs) {
        if (!desiredIds.has(integration.companyId) && integration.webhookSecret) {
          await tearDownWebhook(integration);
        }
      }
    } else {
      // Polling mode: ensure no webhooks are set (otherwise Telegram
      // refuses getUpdates), then stop loops we shouldn't be running and
      // start the ones we should.
      for (const integration of configs) {
        if (integration.webhookSecret && integration.botToken) {
          await tearDownWebhook(integration);
        }
      }
      for (const [companyId, loop] of loops) {
        if (!desiredIds.has(companyId)) {
          loop.cancel();
          loops.delete(companyId);
        }
      }
      for (const companyId of desiredIds) {
        if (!loops.has(companyId)) {
          loops.set(companyId, startLoop(companyId));
        }
      }
    }
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    await reconcile();
    scanTimer = setInterval(() => {
      void reconcile();
    }, CONFIG_RESCAN_MS);
    const baseUrl = getPublicUrl();
    logger.info(
      { mode: baseUrl ? "webhook" : "polling", baseUrl, activeLoops: loops.size },
      "Telegram service started",
    );
  }

  async function stop(): Promise<void> {
    running = false;
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    const pending = [...loops.values()];
    for (const loop of pending) loop.cancel();
    loops.clear();
    await Promise.all(pending.map((l) => l.done.catch(() => undefined)));
    for (const handles of typingIntervals.values()) {
      clearInterval(handles.interval);
      clearTimeout(handles.safety);
    }
    typingIntervals.clear();
    logger.info("Telegram service stopped");
  }

  return { start, stop, reconcile };
}

// ─── Reply dispatch (called from heartbeat post-run) ─────────────────────

/**
 * Post-run hook: send the agent's final answer back to the Telegram chat
 * that triggered the run. Threaded as a reply to the original message,
 * stops the typing indicator. No-ops for non-Telegram runs. Never throws.
 */
export async function dispatchTelegramReply(db: Db, runId: string): Promise<void> {
  // Stop typing first regardless — if anything below fails, we don't
  // want a "typing forever" indicator.
  stopTypingLoop(runId);

  try {
    const run = await db
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        error: heartbeatRuns.error,
        triggerDetail: heartbeatRuns.triggerDetail,
        resultJson: heartbeatRuns.resultJson,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);

    if (!run) return;
    const trigger = parseTriggerDetail(run.triggerDetail);
    if (!trigger) return;

    const integration = await db
      .select({ botToken: telegramIntegrations.botToken })
      .from(telegramIntegrations)
      .where(eq(telegramIntegrations.companyId, run.companyId))
      .then((rows) => rows[0] ?? null);
    if (!integration?.botToken) {
      logger.info({ runId, companyId: run.companyId }, "Telegram reply: no bot token configured");
      return;
    }

    const agent = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .then((rows) => rows[0] ?? null);
    const agentName = agent?.name ?? "Agent";

    const text = formatReplyText(agentName, run.status, run.error, run.resultJson);

    await sendMessage(
      integration.botToken,
      trigger.chatId,
      text,
      trigger.replyToMessageId ?? undefined,
    );
  } catch (err) {
    logger.warn({ err, runId }, "Telegram reply dispatch threw");
  }
}

function formatReplyText(
  agentName: string,
  status: string,
  error: string | null,
  resultJson: Record<string, unknown> | null,
): string {
  const isSuccess = status === "succeeded";
  let body: string;
  if (isSuccess) {
    const result = resultJson?.result;
    const summary = resultJson?.summary;
    body = typeof result === "string" && result.trim().length > 0
      ? result.trim()
      : typeof summary === "string" && summary.trim().length > 0
        ? summary.trim()
        : "Done.";
  } else if (status === "cancelled") {
    body = "(cancelled)";
  } else {
    const detail = (error ?? "").trim();
    body = detail.length > 0 ? `failed — ${detail}` : "failed.";
  }
  const prefix = `${agentName}: `;
  const room = MAX_REPLY_CHARS - prefix.length;
  const truncated = body.length > room ? body.slice(0, room - 14).trimEnd() + "\n\n…(truncated)" : body;
  return prefix + truncated;
}

function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = 250;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += tick;
      if (elapsed >= ms || isCancelled()) {
        clearInterval(id);
        resolve();
      }
    }, tick);
  });
}
