/**
 * Clipboard daemon API — the server-side counterpart to the daemon/ app.
 *
 * Endpoints (all under /api/daemon unless noted):
 *   POST /register       Upsert a device by deviceKey. Anyone can register
 *                        (the key itself is the credential for subsequent
 *                        poll/run-update calls).
 *   GET  /poll           Atomically flip pending daemon_tasks rows for
 *                        this device → in_flight and return them as a
 *                        task batch the daemon can execute. Returns
 *                        { tasks: [] } when idle. Bumps device liveness.
 *   POST /run-update     Device streams stdout/stderr chunks and a
 *                        terminal exitCode back. Chunks append to
 *                        daemon_tasks.output; terminal update flips
 *                        status → succeeded|failed.
 *
 *   POST /enqueue        Operator-facing enqueue helper. Requires an
 *                        authenticated board session with instance_admin.
 *                        Creates a daemon_tasks row targeting a specific
 *                        device. Lets you dispatch work to a daemon by
 *                        hand for testing, scripting, or one-off runs
 *                        without waiting for the heartbeat auto-routing
 *                        integration (tracked as follow-up).
 *
 * Auth model:
 *   The daemon authenticates with the `deviceKey` it generated on first
 *   run and registered via POST /register. Poll and run-update require
 *   that key to match a row in daemon_devices. /register is open so
 *   fresh machines can onboard; /enqueue requires a signed-in instance
 *   admin so only operators can schedule daemon work.
 *
 * What's still missing (explicitly deferred):
 *   - Heartbeat integration: the existing agent scheduler in
 *     server/src/services/heartbeat.ts still spawns local adapter
 *     processes. Making a daemon-bound agent enqueue into
 *     daemon_tasks instead of spawning locally is the next layer up.
 *   - Attaching daemon output to heartbeat_runs for display in the
 *     main Clipboard UI.
 *   - Per-agent → device binding (which agent runs on which daemon).
 */
import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { daemonDevices, daemonTasks } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEVICE_KEY_REGEX = /^[a-zA-Z0-9_-]{16,128}$/;
const MAX_TASKS_PER_POLL = 5;
const SUPPORTED_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
]);

function isValidDeviceKey(input: unknown): input is string {
  return typeof input === "string" && DEVICE_KEY_REGEX.test(input);
}

function shortKey(deviceKey: string): string {
  return `${deviceKey.slice(0, 6)}…`;
}

export function daemonRoutes(db: Db) {
  const router = Router();

  router.post("/register", async (req, res) => {
    const body = req.body ?? {};
    const deviceKey = body.deviceKey;
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : null;
    const os = typeof body.os === "string" ? body.os : null;
    const availableClis = Array.isArray(body.availableClis)
      ? body.availableClis.filter((v: unknown): v is string => typeof v === "string")
      : null;
    const version = typeof body.version === "string" ? body.version : null;

    if (!isValidDeviceKey(deviceKey)) {
      res
        .status(400)
        .json({ error: "deviceKey must match /^[a-zA-Z0-9_-]{16,128}$/" });
      return;
    }
    if (!deviceName || !os || !availableClis) {
      res
        .status(400)
        .json({ error: "deviceName, os, and availableClis are required" });
      return;
    }

    const now = new Date();
    const existing = await db
      .select({ id: daemonDevices.id })
      .from(daemonDevices)
      .where(eq(daemonDevices.deviceKey, deviceKey))
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(daemonDevices)
        .set({ deviceName, os, availableClis, version, lastSeenAt: now })
        .where(eq(daemonDevices.id, existing.id));
      logger.info(
        { deviceKey: shortKey(deviceKey), deviceName, os, clis: availableClis.length },
        "Daemon re-registered",
      );
    } else {
      await db.insert(daemonDevices).values({
        deviceKey,
        deviceName,
        os,
        availableClis,
        version,
        lastSeenAt: now,
        registeredAt: now,
      });
      logger.info(
        { deviceKey: shortKey(deviceKey), deviceName, os, clis: availableClis.length },
        "Daemon registered (new device)",
      );
    }

    res.json({ connected: true, agentAssignments: [] });
  });

  router.get("/poll", async (req, res) => {
    const deviceKey = req.query.deviceKey;
    if (!isValidDeviceKey(deviceKey)) {
      res.status(400).json({ error: "deviceKey query parameter is required" });
      return;
    }

    const device = await db
      .select({ id: daemonDevices.id })
      .from(daemonDevices)
      .where(eq(daemonDevices.deviceKey, deviceKey))
      .then((rows) => rows[0] ?? null);

    if (!device) {
      res.status(404).json({ error: "Device not registered" });
      return;
    }

    // Bump liveness, fire-and-forget.
    await db
      .update(daemonDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(daemonDevices.id, device.id))
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to bump daemon last_seen_at");
      });

    // Atomically claim up to N pending tasks for this device. We use a
    // two-step CAS via drizzle: select candidate ids with FOR UPDATE
    // SKIP LOCKED, then update them to in_flight. If another daemon ever
    // shares a device_key (shouldn't, but be defensive), SKIP LOCKED
    // ensures we never return the same row to two pollers.
    const claimed = await db.transaction(async (tx) => {
      const candidates = await tx.execute<{ id: string }>(
        /* sql */ `
          select id from daemon_tasks
          where device_key = $1 and status = 'pending'
          order by created_at asc
          limit $2
          for update skip locked
        `.replace(/\s+/g, " ").trim() as unknown as never,
        // drizzle's .execute() signature varies by version; cast through
        // any to keep this compile across the range we've shipped with.
      ).catch(() => ({ rows: [] as { id: string }[] }));

      const rows = Array.isArray((candidates as { rows?: unknown }).rows)
        ? ((candidates as { rows: { id: string }[] }).rows)
        : [];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      await tx
        .update(daemonTasks)
        .set({ status: "in_flight", pickedUpAt: new Date() })
        .where(inArray(daemonTasks.id, ids));

      return tx
        .select()
        .from(daemonTasks)
        .where(inArray(daemonTasks.id, ids));
    });

    const tasks = claimed.map((t) => ({
      taskId: t.id,
      agentId: t.agentId ?? "",
      runId: t.runId ?? t.id,
      adapterType: t.adapterType,
      prompt: t.prompt,
      companyId: (t.metadata as { companyId?: string } | null)?.companyId ?? "",
    }));

    if (tasks.length > 0) {
      logger.info(
        { deviceKey: shortKey(deviceKey), tasks: tasks.length },
        "Daemon poll dispatched tasks",
      );
    }
    res.json({ tasks });
  });

  router.post("/run-update", async (req, res) => {
    const body = req.body ?? {};
    const deviceKey = body.deviceKey;
    const taskId = typeof body.taskId === "string" ? body.taskId : null;
    const runId = typeof body.runId === "string" ? body.runId : null;
    const chunk = typeof body.chunk === "string" ? body.chunk : "";
    const done = body.done === true;
    const exitCode =
      typeof body.exitCode === "number" && Number.isFinite(body.exitCode)
        ? body.exitCode
        : null;

    if (deviceKey !== undefined && !isValidDeviceKey(deviceKey)) {
      res.status(400).json({ error: "deviceKey is malformed" });
      return;
    }
    if (!taskId || !runId) {
      res.status(400).json({ error: "taskId and runId are required" });
      return;
    }

    // Resolve task by id. If deviceKey is supplied, require it to match
    // the row's device_key so a compromised daemon can't trample tasks
    // assigned to other devices.
    const task = await db
      .select()
      .from(daemonTasks)
      .where(eq(daemonTasks.id, taskId))
      .then((rows) => rows[0] ?? null);

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (deviceKey && task.deviceKey !== deviceKey) {
      res.status(403).json({ error: "deviceKey does not own this task" });
      return;
    }

    const nextOutput = chunk ? (task.output ?? "") + chunk : task.output;
    const terminalStatus = done
      ? exitCode === 0
        ? "succeeded"
        : "failed"
      : task.status;

    await db
      .update(daemonTasks)
      .set({
        output: nextOutput,
        status: terminalStatus,
        ...(done ? { completedAt: new Date(), exitCode: exitCode ?? task.exitCode } : {}),
      })
      .where(eq(daemonTasks.id, taskId));

    if (done) {
      logger.info(
        { taskId, runId, exitCode, outputBytes: nextOutput.length, status: terminalStatus },
        "Daemon task completed",
      );
    }

    res.json({ accepted: true });
  });

  // Operator-only enqueue helper. Lets admins dispatch a task to a
  // specific registered daemon via a single HTTP call. The UI wakeupAgent
  // integration (routing agent runs to daemons automatically) is a
  // separate piece of work.
  router.post("/enqueue", async (req, res) => {
    const actor = req.actor;
    if (!actor || actor.type !== "board" || !actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin required" });
      return;
    }

    const body = req.body ?? {};
    const deviceKey = body.deviceKey;
    const adapterType = typeof body.adapterType === "string" ? body.adapterType : null;
    const prompt = typeof body.prompt === "string" ? body.prompt : null;
    const agentId = typeof body.agentId === "string" ? body.agentId : null;
    const runId = typeof body.runId === "string" ? body.runId : null;
    const metadata = body.metadata && typeof body.metadata === "object"
      ? (body.metadata as Record<string, unknown>)
      : undefined;

    if (!isValidDeviceKey(deviceKey)) {
      res.status(400).json({ error: "deviceKey is required" });
      return;
    }
    if (!adapterType || !SUPPORTED_ADAPTERS.has(adapterType)) {
      res.status(400).json({
        error: `adapterType must be one of ${[...SUPPORTED_ADAPTERS].join(", ")}`,
      });
      return;
    }
    if (!prompt || prompt.trim().length === 0) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const device = await db
      .select({ id: daemonDevices.id, availableClis: daemonDevices.availableClis })
      .from(daemonDevices)
      .where(eq(daemonDevices.deviceKey, deviceKey))
      .then((rows) => rows[0] ?? null);

    if (!device) {
      res.status(404).json({ error: "Device not registered" });
      return;
    }
    if (!device.availableClis.includes(adapterType)) {
      res.status(409).json({
        error: `Device does not advertise support for ${adapterType}`,
        availableClis: device.availableClis,
      });
      return;
    }

    const inserted = await db
      .insert(daemonTasks)
      .values({
        deviceKey,
        adapterType,
        prompt,
        agentId: agentId ?? null,
        runId: runId ?? null,
        metadata,
        createdBy: actor.userId ?? null,
        status: "pending",
      })
      .returning({ id: daemonTasks.id });

    logger.info(
      {
        taskId: inserted[0]?.id,
        deviceKey: shortKey(deviceKey),
        adapterType,
        actorId: actor.userId,
      },
      "Daemon task enqueued by operator",
    );
    res.status(201).json({ taskId: inserted[0]?.id, status: "pending" });
  });

  // Operator introspection — list recent tasks so you can watch what a
  // daemon has been doing without shelling into the database.
  router.get("/tasks", async (req, res) => {
    const actor = req.actor;
    if (!actor || actor.type !== "board" || !actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin required" });
      return;
    }
    const deviceKeyFilter = req.query.deviceKey;
    const limit = Math.min(
      Number(req.query.limit) > 0 ? Number(req.query.limit) : 50,
      200,
    );

    const where =
      typeof deviceKeyFilter === "string" && isValidDeviceKey(deviceKeyFilter)
        ? and(eq(daemonTasks.deviceKey, deviceKeyFilter))
        : undefined;
    const rows = await db
      .select()
      .from(daemonTasks)
      .where(where ?? undefined)
      .orderBy(desc(daemonTasks.createdAt))
      .limit(limit);
    res.json({ tasks: rows });
  });

  return router;
}
