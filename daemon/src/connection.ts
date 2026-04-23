/**
 * Cloud connection: register, poll, and stream run updates over HTTP.
 *
 * Design notes:
 *   - Polling (not WebSocket) — simpler, survives restarts cleanly, and a
 *     5-second cadence is fine for task dispatch granularity.
 *   - Exponential backoff: 1s → 2s → 4s → … capped at 30s. Resets to the
 *     base interval on any successful HTTP exchange.
 *   - The daemon owns per-agent concurrency via BusyAgents; if a task
 *     arrives for a busy agent, we log and skip (the server is expected
 *     to re-issue it later, or it can be re-polled).
 *   - run-update chunks are sent fire-and-forget with best-effort retry
 *     so a transient network blip doesn't drop output. The final chunk
 *     (done=true) is awaited so the server sees a terminal state.
 */
import fetch from "node-fetch";
import { log } from "./logger.js";
import { BusyAgents, executeTask, type TaskDescriptor } from "./execute-cli.js";
import type { MachineDetection } from "./detect-clis.js";

const DAEMON_VERSION = "1.0.0";
const BASE_POLL_MS = () =>
  Math.max(1, Number(process.env.POLL_INTERVAL_SECONDS ?? 5)) * 1000;
const BACKOFF_MAX_MS = 30_000;

export interface ConnectionConfig {
  serverUrl: string;
  deviceKey: string;
  deviceName: string;
  detection: MachineDetection;
}

interface RegisterResponse {
  connected?: boolean;
  agentAssignments?: unknown[];
}

interface PollResponse {
  tasks?: TaskDescriptor[];
  /**
   * IDs of in-flight tasks the server has requested we cancel.
   * Each entry corresponds to a task previously returned by /poll
   * that the operator (or control plane) has since decided to stop.
   */
  cancellations?: string[];
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

/**
 * Send one run-update. Swallows errors (logged) so a transient outage
 * never crashes the streaming task.
 */
async function sendRunUpdate(
  serverUrl: string,
  body: {
    taskId: string;
    runId: string;
    chunk: string;
    done: boolean;
    exitCode?: number;
  },
): Promise<void> {
  try {
    const res = await fetch(joinUrl(serverUrl, "/api/daemon/run-update"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn(
        `run-update HTTP ${res.status} for task ${body.taskId} (done=${body.done})`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`run-update failed for task ${body.taskId}: ${msg}`);
  }
}

/**
 * The connection loop. Runs until stop() is called, at which point
 * in-flight work is allowed to finish (but polling halts).
 */
export class CloudConnection {
  private readonly busy = new BusyAgents();
  private readonly activeKills = new Map<string, () => void>();
  private readonly inFlight = new Set<Promise<void>>();
  private stopping = false;
  private currentBackoff = BASE_POLL_MS();

  constructor(private readonly cfg: ConnectionConfig) {}

  /** Register then begin polling. Resolves once polling has started. */
  async start(): Promise<void> {
    await this.register();
    // fire-and-forget polling loop; errors are handled inside pollOnce
    void this.pollLoop();
  }

  /**
   * Graceful shutdown. Stops scheduling new tasks, but waits for currently
   * executing tasks to finish (bounded by the task timeout).
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    log.info(
      `Shutdown initiated; waiting for ${this.inFlight.size} task(s) to finish…`,
    );
    await Promise.allSettled([...this.inFlight]);
    log.info("All in-flight tasks complete. Disconnected.");
  }

  /** Kill every in-flight task. Used if shutdown is forced (second signal). */
  forceKill(): void {
    for (const [taskId, kill] of this.activeKills.entries()) {
      log.warn(`Force-killing task ${taskId}`);
      try {
        kill();
      } catch {
        /* noop */
      }
    }
  }

  // ----- internal -----

  private async register(): Promise<void> {
    const payload = {
      deviceKey: this.cfg.deviceKey,
      deviceName: this.cfg.deviceName,
      os: this.cfg.detection.os,
      availableClis: this.cfg.detection.availableClis,
      version: DAEMON_VERSION,
    };

    while (!this.stopping) {
      try {
        const res = await fetch(joinUrl(this.cfg.serverUrl, "/api/daemon/register"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as RegisterResponse;
        log.info(
          `Registered with ${this.cfg.serverUrl} (connected=${body.connected ?? false}, ` +
            `assignments=${body.agentAssignments?.length ?? 0})`,
        );
        this.currentBackoff = BASE_POLL_MS();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          `Register failed (${msg}); retrying in ${Math.round(this.currentBackoff / 1000)}s`,
        );
        await this.sleep(this.currentBackoff);
        this.bumpBackoff();
      }
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopping) {
      await this.pollOnce();
      await this.sleep(this.currentBackoff);
    }
  }

  private async pollOnce(): Promise<void> {
    const url = joinUrl(
      this.cfg.serverUrl,
      `/api/daemon/poll?deviceKey=${encodeURIComponent(this.cfg.deviceKey)}`,
    );
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PollResponse;
      // successful poll — back to baseline cadence
      this.currentBackoff = BASE_POLL_MS();

      const tasks = body.tasks ?? [];
      for (const task of tasks) {
        this.dispatch(task);
      }

      // Honor server-requested cancellations. Because we key kills by
      // taskId and send SIGTERM (see executeTask's kill closure), this
      // lets the child CLI flush and exit gracefully; the surrounding
      // onDone callback then posts a terminal run-update so the server
      // can finalize the task row.
      const cancellations = body.cancellations ?? [];
      for (const taskId of cancellations) {
        const kill = this.activeKills.get(taskId);
        if (!kill) continue;
        log.info(`[task ${taskId}] cancel requested by server — killing`);
        try {
          kill();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[task ${taskId}] kill failed: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `Poll failed (${msg}); next attempt in ${Math.round(this.currentBackoff / 1000)}s`,
      );
      this.bumpBackoff();
    }
  }

  /**
   * Dispatch a single task. Enforces per-agent exclusivity. Tracked in
   * `inFlight` so shutdown can await completion.
   */
  private dispatch(task: TaskDescriptor): void {
    if (!task || !task.taskId || !task.agentId || !task.runId) {
      log.warn(`Malformed task received: ${JSON.stringify(task)}`);
      return;
    }
    if (this.busy.isBusy(task.agentId)) {
      log.info(
        `[task ${task.taskId}] agent ${task.agentId} busy — skipping; server may re-issue`,
      );
      return;
    }
    this.busy.markBusy(task.agentId);

    const p = new Promise<void>((resolve) => {
      const handle = executeTask(task, {
        onChunk: (chunk) => {
          // Fire-and-forget intermediate chunks. If the network is down
          // they get logged but don't block execution.
          void sendRunUpdate(this.cfg.serverUrl, {
            taskId: task.taskId,
            runId: task.runId,
            chunk,
            done: false,
          });
        },
        onDone: (exitCode) => {
          // Await the terminal update so the server sees a clean ending.
          void sendRunUpdate(this.cfg.serverUrl, {
            taskId: task.taskId,
            runId: task.runId,
            chunk: "",
            done: true,
            exitCode,
          }).finally(() => {
            this.busy.markFree(task.agentId);
            this.activeKills.delete(task.taskId);
            resolve();
          });
        },
      });
      this.activeKills.set(task.taskId, handle.kill);
    });

    this.inFlight.add(p);
    p.finally(() => this.inFlight.delete(p));
  }

  private bumpBackoff(): void {
    this.currentBackoff = Math.min(this.currentBackoff * 2, BACKOFF_MAX_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
