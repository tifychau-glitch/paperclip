import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { daemonDevices, daemonTasks, heartbeatRuns } from "@paperclipai/db";
import type { agents } from "@paperclipai/db";
import { composeDaemonPrompt, executeViaDaemon } from "../services/heartbeat.js";

type AgentRow = typeof agents.$inferSelect;

// Minimal agent fixture. Satisfies the shape that composeDaemonPrompt
// and executeViaDaemon read; irrelevant columns are stubbed.
function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Scout",
    role: "general",
    title: "research agent",
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: "Summarize documents",
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: {},
    lastHeartbeatAt: null,
    daemonDeviceKey: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("composeDaemonPrompt", () => {
  it("uses adapterConfig.promptTemplate when present and interpolates agent fields", () => {
    const agent = makeAgent({
      adapterConfig: {
        promptTemplate: "I am {{agent.name}} ({{agent.title}}).\nRole: {{agent.capabilities}}",
      },
    });
    const prompt = composeDaemonPrompt(agent, {}, { wakeReason: "ignored" }, "run-1");
    expect(prompt).toContain("I am Scout (research agent).");
    expect(prompt).toContain("Role: Summarize documents");
    // The fallback wake-reason text shouldn't leak in when a template handles it.
    expect(prompt).not.toContain("Task: ignored");
  });

  it("prefers runtimeConfig.promptTemplate over adapterConfig.promptTemplate", () => {
    const agent = makeAgent({
      adapterConfig: { promptTemplate: "ADAPTER: {{agent.name}}" },
    });
    const prompt = composeDaemonPrompt(
      agent,
      { promptTemplate: "RUNTIME: {{agent.name}}" },
      {},
      "run-2",
    );
    expect(prompt).toBe("RUNTIME: Scout");
  });

  it("prepends rendered bootstrapPromptTemplate when configured", () => {
    const agent = makeAgent({
      adapterConfig: {
        bootstrapPromptTemplate: "BOOT for {{agent.name}}",
        promptTemplate: "MAIN for {{agent.name}}",
      },
    });
    const prompt = composeDaemonPrompt(agent, {}, {}, "run-3");
    expect(prompt.indexOf("BOOT for Scout")).toBeLessThan(prompt.indexOf("MAIN for Scout"));
  });

  it("falls back to a hand-composed prompt when no promptTemplate is configured", () => {
    const agent = makeAgent({
      capabilities: "Handle incidents",
      metadata: { persona: "Direct and calm" },
    });
    const prompt = composeDaemonPrompt(agent, {}, { wakeReason: "Investigate pager" }, "run-4");
    expect(prompt).toContain("You are Scout, research agent.");
    expect(prompt).toContain("Role: Handle incidents");
    expect(prompt).toContain("How you behave: Direct and calm");
    expect(prompt).toContain("Task: Investigate pager");
  });

  it("fallback mode serializes payload when present", () => {
    const agent = makeAgent({ title: null });
    const prompt = composeDaemonPrompt(
      agent,
      {},
      { payload: { file: "report.md", priority: "high" } },
      "run-5",
    );
    expect(prompt).toContain('"file":"report.md"');
    expect(prompt).toContain('"priority":"high"');
  });
});

// --- executeViaDaemon tests --------------------------------------------

interface FakeDaemonTasksRow {
  id: string;
  deviceKey: string;
  agentId: string | null;
  runId: string | null;
  adapterType: string;
  prompt: string;
  status: "pending" | "in_flight" | "succeeded" | "failed" | "cancelled";
  cancelRequested: boolean;
  exitCode: number | null;
  output: string;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  pickedUpAt: Date | null;
  completedAt: Date | null;
}

interface FakeDeviceRow {
  id: string;
  deviceKey: string;
  deviceName: string;
  os: string;
  availableClis: string[];
  version: string | null;
  lastSeenAt: Date;
  registeredAt: Date;
}

interface FakeRunRow {
  id: string;
  status: string;
}

// Builds a Db-shaped fake narrow enough to satisfy executeViaDaemon's
// drizzle chains. Only the operations the function calls are implemented;
// the test will cast to Db via `as unknown as Db`.
function makeFakeDb(state: {
  devices: FakeDeviceRow[];
  tasks: FakeDaemonTasksRow[];
  runs: FakeRunRow[];
}) {
  const tasks = state.tasks;
  const devices = state.devices;
  const runs = state.runs;

  function resolveForTable(table: unknown): unknown[] {
    if (table === daemonDevices) return devices;
    if (table === daemonTasks) return tasks;
    if (table === heartbeatRuns) return runs;
    throw new Error("fake db: unknown table");
  }

  function selectChain() {
    let rows: unknown[] = [];
    const chain = {
      from(table: unknown) {
        rows = resolveForTable(table);
        return chain;
      },
      where(_: unknown) {
        return chain;
      },
      orderBy(_: unknown) {
        return chain;
      },
      limit(_: unknown) {
        return chain;
      },
      then<T>(cb: (rows: unknown[]) => T) {
        return Promise.resolve(cb(rows));
      },
    };
    return chain;
  }

  function updateChain(table: unknown) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(_: unknown) {
            if (table === daemonTasks) {
              for (const t of tasks) Object.assign(t, patch);
            } else if (table === daemonDevices) {
              for (const d of devices) Object.assign(d, patch);
            } else if (table === heartbeatRuns) {
              for (const r of runs) Object.assign(r, patch);
            }
            return {
              catch(_: (err: unknown) => void) {
                return Promise.resolve(undefined);
              },
              then<T>(cb: (value: undefined) => T) {
                return Promise.resolve(cb(undefined));
              },
            };
          },
        };
      },
    };
  }

  function insertChain(table: unknown) {
    return {
      values(val: Record<string, unknown>) {
        let returned: unknown = undefined;
        if (table === daemonTasks) {
          const row: FakeDaemonTasksRow = {
            id: `task-${tasks.length + 1}`,
            deviceKey: String(val.deviceKey ?? ""),
            agentId: (val.agentId as string | null | undefined) ?? null,
            runId: (val.runId as string | null | undefined) ?? null,
            adapterType: String(val.adapterType ?? ""),
            prompt: String(val.prompt ?? ""),
            status: (val.status as FakeDaemonTasksRow["status"] | undefined) ?? "pending",
            cancelRequested: false,
            exitCode: null,
            output: "",
            metadata: (val.metadata as Record<string, unknown> | null | undefined) ?? null,
            createdBy: (val.createdBy as string | null | undefined) ?? null,
            createdAt: new Date(),
            pickedUpAt: null,
            completedAt: null,
          };
          tasks.push(row);
          returned = [{ id: row.id }];
        }
        return {
          returning(_: unknown) {
            return Promise.resolve(returned);
          },
        };
      },
    };
  }

  return {
    select: () => selectChain(),
    update: updateChain,
    insert: insertChain,
    _state: { devices, tasks, runs },
  };
}

describe("executeViaDaemon", () => {
  it("returns a structured failure when the device is not registered", async () => {
    const db = makeFakeDb({ devices: [], tasks: [], runs: [{ id: "run-1", status: "running" }] });
    const result = await executeViaDaemon({
      db: db as unknown as Db,
      deviceKey: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      agent: makeAgent({ daemonDeviceKey: "aaaaaaaaaaaaaaaa" }),
      adapterType: "claude_local",
      runtimeConfig: {},
      context: {},
      onLog: async () => {},
    });
    expect(result.errorCode).toBe("daemon_unregistered");
    expect(result.exitCode).toBeNull();
    expect(db._state.tasks.length).toBe(0); // nothing enqueued
  });

  it("returns adapter_unsupported when the device does not advertise the adapter", async () => {
    const db = makeFakeDb({
      devices: [
        {
          id: "dev-1",
          deviceKey: "aaaaaaaaaaaaaaaa",
          deviceName: "bench",
          os: "linux",
          availableClis: ["codex_local"],
          version: null,
          lastSeenAt: new Date(),
          registeredAt: new Date(),
        },
      ],
      tasks: [],
      runs: [{ id: "run-1", status: "running" }],
    });
    const result = await executeViaDaemon({
      db: db as unknown as Db,
      deviceKey: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      agent: makeAgent({ daemonDeviceKey: "aaaaaaaaaaaaaaaa" }),
      adapterType: "claude_local",
      runtimeConfig: {},
      context: {},
      onLog: async () => {},
    });
    expect(result.errorCode).toBe("daemon_adapter_unsupported");
    expect(db._state.tasks.length).toBe(0);
  });

  it("enqueues a daemon task, streams output deltas, and resolves with the daemon's exit code", async () => {
    const db = makeFakeDb({
      devices: [
        {
          id: "dev-1",
          deviceKey: "aaaaaaaaaaaaaaaa",
          deviceName: "bench",
          os: "linux",
          availableClis: ["claude_local"],
          version: null,
          lastSeenAt: new Date(),
          registeredAt: new Date(),
        },
      ],
      tasks: [],
      runs: [{ id: "run-1", status: "running" }],
    });
    const chunks: Array<{ stream: string; chunk: string }> = [];
    const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
      chunks.push({ stream, chunk });
      // After the first read, simulate the daemon completing.
      if (db._state.tasks.length > 0 && db._state.tasks[0].status === "in_flight") {
        db._state.tasks[0].status = "succeeded";
        db._state.tasks[0].exitCode = 0;
      }
    };

    // Kick off executeViaDaemon; simulate the daemon writing output
    // asynchronously on the next tick.
    const promise = executeViaDaemon({
      db: db as unknown as Db,
      deviceKey: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      agent: makeAgent({ daemonDeviceKey: "aaaaaaaaaaaaaaaa" }),
      adapterType: "claude_local",
      runtimeConfig: { promptTemplate: "Go: {{agent.name}}" },
      context: {},
      onLog,
    });

    // Let the first poll iteration insert the row, then mutate it to
    // look like the daemon streamed output + started running.
    await new Promise((r) => setTimeout(r, 20));
    const enqueued = db._state.tasks[0];
    expect(enqueued).toBeDefined();
    expect(enqueued.prompt).toBe("Go: Scout");
    expect(enqueued.runId).toBe("run-1");
    expect(enqueued.agentId).toBe("agent-1");
    enqueued.status = "in_flight";
    enqueued.output = "hello from daemon";

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toBeNull();
    expect(chunks.some((c) => c.chunk.includes("hello from daemon"))).toBe(true);
  }, 10_000);

  it("propagates run cancellation by flagging cancel_requested and returning cancelled", async () => {
    const db = makeFakeDb({
      devices: [
        {
          id: "dev-1",
          deviceKey: "aaaaaaaaaaaaaaaa",
          deviceName: "bench",
          os: "linux",
          availableClis: ["claude_local"],
          version: null,
          lastSeenAt: new Date(),
          registeredAt: new Date(),
        },
      ],
      tasks: [],
      runs: [{ id: "run-1", status: "running" }],
    });

    const promise = executeViaDaemon({
      db: db as unknown as Db,
      deviceKey: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      agent: makeAgent({ daemonDeviceKey: "aaaaaaaaaaaaaaaa" }),
      adapterType: "claude_local",
      runtimeConfig: {},
      context: {},
      onLog: async () => {},
    });

    await new Promise((r) => setTimeout(r, 20));
    // Simulate control-plane cancellation of the heartbeat run.
    db._state.runs[0].status = "cancelled";
    // And let the daemon report back with a cancelled status after
    // seeing cancel_requested=true.
    await new Promise((r) => setTimeout(r, 2_100));
    db._state.tasks[0].status = "cancelled";
    db._state.tasks[0].exitCode = -1;

    const result = await promise;
    expect(result.errorCode).toBe("cancelled");
    expect(db._state.tasks[0].cancelRequested).toBe(true);
  }, 15_000);
});
