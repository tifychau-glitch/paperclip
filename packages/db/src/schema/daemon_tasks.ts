import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Queue of work assigned to registered Clipboard daemons.
 *
 * Lifecycle:
 *   status=pending     Created by an enqueue call. Waiting for a
 *                      daemon to pick it up via /api/daemon/poll.
 *   status=in_flight   A daemon's poll call atomically flipped
 *                      pending → in_flight and received this row
 *                      as part of its task list. Claimed by
 *                      picked_up_at; the specific daemon is
 *                      identified by device_key.
 *   status=succeeded   Final status. Daemon sent a terminal
 *                      run-update (done=true, exitCode=0).
 *   status=failed      Final. Daemon sent done=true with a non-zero
 *                      exit code, OR something upstream decided the
 *                      task should be abandoned.
 *
 * Output chunks stream into `output` as a concatenated text blob as
 * run-update calls arrive. Keeping them inline rather than a separate
 * chunks table is fine for MVP — when/if we need chunk-by-chunk
 * replay for the UI, revisit.
 */
export const daemonTasks = pgTable(
  "daemon_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceKey: text("device_key").notNull(),
    agentId: uuid("agent_id"),
    runId: uuid("run_id"),
    adapterType: text("adapter_type").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull().default("pending"),
    exitCode: integer("exit_code"),
    output: text("output").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    deviceKeyStatusIdx: index("daemon_tasks_device_key_status_idx").on(
      table.deviceKey,
      table.status,
    ),
    statusIdx: index("daemon_tasks_status_idx").on(table.status),
    createdAtIdx: index("daemon_tasks_created_at_idx").on(table.createdAt),
  }),
);
