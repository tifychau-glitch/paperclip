import {
  bigint,
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/**
 * Per-company Telegram integration config.
 *
 * One bot per company. The bot token is stored directly on this row for
 * operational simplicity — the long-poll loop reads it on every cycle and
 * the secrets indirection isn't worth the lookup overhead at v0. Postgres
 * at-rest encryption handles the storage layer; if/when we want rotation
 * UX or multi-token support, migrate to a `bot_token_secret_id` FK into
 * `company_secrets` and read through `secretService`.
 *
 * Long-poll cursor lives in `last_update_id` so the listener can resume
 * after a server restart without re-processing messages.
 */
export const telegramIntegrations = pgTable(
  "telegram_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    botToken: text("bot_token"),
    // Random per-integration secret used as the URL path segment for the
    // Telegram webhook (POST /api/telegram/webhook/:secret). Telegram is
    // the only entity that ever learns this value — we register the URL
    // with them via setWebhook, and they post inbound messages back to it.
    // Generated lazily the first time we switch a config into webhook mode.
    webhookSecret: text("webhook_secret"),
    defaultAgentId: uuid("default_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    // Telegram numeric user ids as strings (they fit in i64 but we keep
    // them stringy for safe JSON round-tripping in the UI).
    allowedUserIds: jsonb("allowed_user_ids")
      .notNull()
      .$type<string[]>()
      .default([]),
    // Telegram getUpdates cursor — bigint because update_ids grow without bound.
    lastUpdateId: bigint("last_update_id", { mode: "number" })
      .notNull()
      .default(0),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("telegram_integrations_company_unique_idx").on(
      table.companyId,
    ),
  }),
);
