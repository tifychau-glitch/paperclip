import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  Loader2,
  Lock,
  Pause,
  Pencil,
  Play,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { formatDuration, formatRelativeTime, formatTokens, formatUsd } from "../lib/format";
import {
  isMeteredAgent,
  runBilling,
  runDurationMs,
  runModel,
  runSummary,
  runTokens,
  runWakeReason,
  type AdapterSkillEntry,
  type Agent,
  type HeartbeatRun,
} from "../lib/types";
import { StatusBadge } from "../components/StatusBadge";

export function AgentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const agent = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.getAgent(id),
    enabled: !!id,
  });

  const runs = useQuery({
    queryKey: ["runs", agent.data?.companyId, id],
    queryFn: () => api.listRuns(agent.data!.companyId, id),
    enabled: !!agent.data?.companyId,
    refetchInterval: 3_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["agent", id] });
    qc.invalidateQueries({ queryKey: ["agents"] });
  };

  const pause = useMutation({ mutationFn: () => api.pauseAgent(id), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: () => api.resumeAgent(id), onSuccess: invalidate });
  const remove = useMutation({
    mutationFn: () => api.deleteAgent(id),
    onSuccess: () => {
      invalidate();
      navigate("/agents");
    },
  });

  const approvals = useQuery({
    queryKey: ["pendingApprovals", agent.data?.companyId],
    queryFn: () => api.listPendingApprovals(agent.data!.companyId),
    enabled:
      !!agent.data?.companyId && agent.data?.status === "pending_approval",
  });
  const pendingApprovalId =
    approvals.data?.find(
      (a) => a.type === "hire_agent" && a.payload.agentId === id,
    )?.id ?? null;
  const approve = useMutation({
    mutationFn: () => api.approveApproval(pendingApprovalId!),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["pendingApprovals"] });
    },
  });

  if (agent.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (agent.error || !agent.data) {
    return (
      <div>
        <Link to="/agents" className="text-muted-foreground hover:text-foreground">
          ← Back to Agents
        </Link>
        <div className="mt-6 text-destructive">Agent not found.</div>
      </div>
    );
  }

  const a = agent.data;
  const persona = a.metadata?.persona ?? "";
  const isPaused = a.status === "paused";
  const isPendingApproval = a.status === "pending_approval";

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/agents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All agents
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{a.name}</h1>
          {a.title && <div className="mt-1 text-muted-foreground">{a.title}</div>}
          <div className="mt-3 flex items-center gap-2">
            <StatusBadge status={a.status} />
            <span className="text-xs text-muted-foreground">
              Last active {formatRelativeTime(a.lastHeartbeatAt)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          {isPendingApproval ? (
            <button
              onClick={() => approve.mutate()}
              disabled={approve.isPending || !pendingApprovalId}
              title={
                !pendingApprovalId
                  ? "No pending approval record found for this agent."
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-sm text-green-400 hover:bg-green-500/20 disabled:opacity-50"
            >
              {approve.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Approve
            </button>
          ) : isPaused ? (
            <button
              onClick={() => resume.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Play className="size-3.5" /> Resume
            </button>
          ) : (
            <button
              onClick={() => pause.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Pause className="size-3.5" /> Pause
            </button>
          )}
          <button
            onClick={() => {
              if (confirm(`Remove agent "${a.name}"?`)) remove.mutate();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      </header>

      {editing && (
        <EditAgentForm
          agent={a}
          onClose={() => setEditing(false)}
          onSaved={() => { invalidate(); setEditing(false); }}
        />
      )}

      <TaskInput agent={a} onSent={() => runs.refetch()} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Recent tasks
        </h2>
        {runs.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : runs.data && runs.data.length > 0 ? (
          <div className="space-y-2">
            {runs.data.slice(0, 20).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No tasks yet. Send one above to see it appear here.
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Role
        </h2>
        <div className="whitespace-pre-wrap rounded-md border border-border bg-card p-4 text-sm">
          {a.capabilities || (
            <span className="text-muted-foreground italic">No role description set.</span>
          )}
        </div>
      </section>

      {persona && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Personality & style
          </h2>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-card p-4 text-sm">
            {persona}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Configuration
        </h2>
        <dl className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Model</dt>
            <dd className="font-mono">
              {(a.adapterConfig?.model as string | undefined) ?? "default"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Working directory</dt>
            <dd className="break-all font-mono text-xs">
              {(a.adapterConfig?.cwd as string | undefined) ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Adapter</dt>
            <dd className="font-mono">{a.adapterType}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd>{new Date(a.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </section>

      <AgentSkillsSection agentId={a.id} />

      <MemorySection agent={a} onSaved={invalidate} />

      <DaemonBindingSection agent={a} onSaved={invalidate} />

      <BudgetSection agent={a} onSaved={invalidate} />

      <WakeConditionsSection agent={a} onSaved={invalidate} />

      <PermissionsSection agent={a} onSaved={invalidate} />
    </div>
  );
}

// Dropdown to bind this agent to a registered Clipboard daemon. When
// set, the heartbeat scheduler enqueues runs into daemon_tasks instead
// of spawning locally (see server/src/services/heartbeat.ts
// executeViaDaemon). Unset means "run locally" — the default.
//
// Devices that don't advertise this agent's adapterType are greyed out
// so the operator doesn't silently bind an agent to a machine that
// can't execute it.
function DaemonBindingSection({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: ["daemonDevices"],
    queryFn: () => api.listDaemonDevices(),
    staleTime: 15_000,
  });
  const save = useMutation({
    mutationFn: (nextKey: string | null) =>
      api.updateAgent(agent.id, { daemonDeviceKey: nextKey }),
    onSuccess: () => { setError(null); onSaved(); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const deviceList = devices.data?.devices ?? [];
  const currentKey = agent.daemonDeviceKey ?? "";
  const hasDevices = deviceList.length > 0;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Execution location
      </h2>
      <div className="space-y-3 rounded-md border border-border bg-card p-4 text-sm">
        <div className="text-muted-foreground">
          Where should this agent's runs execute? Default is on this server.
          Bind to a daemon to run the agent on a different machine — the
          daemon polls for work and streams output back.
        </div>
        {!hasDevices && !devices.isLoading && (
          <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            No daemons registered yet. Start the daemon on a machine and it
            will appear here after its first poll.
          </div>
        )}
        <label className="block">
          <div className="mb-1.5 text-sm font-medium">Run on</div>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
            value={currentKey}
            disabled={save.isPending}
            onChange={(event) => {
              const value = event.target.value;
              save.mutate(value === "" ? null : value);
            }}
          >
            <option value="">This server (local)</option>
            {deviceList.map((device) => {
              const supported = device.availableClis.includes(agent.adapterType);
              return (
                <option
                  key={device.id}
                  value={device.deviceKey}
                  disabled={!supported}
                >
                  {device.deviceName} ({device.os})
                  {supported ? "" : ` — no ${agent.adapterType}`}
                </option>
              );
            })}
          </select>
        </label>
        {currentKey && !deviceList.some((d) => d.deviceKey === currentKey) && !devices.isLoading && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This agent is bound to a daemon that's no longer registered. Its
              next wakeup will fail until you pick a live daemon or switch
              back to local.
            </span>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

function AgentSkillsSection({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const snapshot = useQuery({
    queryKey: ["agentSkills", agentId],
    queryFn: () => api.listAgentSkills(agentId),
  });

  const sync = useMutation({
    mutationFn: (desiredSkills: string[]) => api.syncAgentSkills(agentId, desiredSkills),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agentSkills", agentId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const snap = snapshot.data;
  const toggle = (entry: AdapterSkillEntry) => {
    if (!snap) return;
    if (entry.required || entry.readOnly) return;
    const current = new Set(snap.desiredSkills);
    if (current.has(entry.key)) current.delete(entry.key);
    else current.add(entry.key);
    sync.mutate(Array.from(current));
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Skills
        </h2>
        <Link
          to="/skills"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Manage library →
        </Link>
      </div>

      <div className="rounded-md border border-border bg-card">
        {snapshot.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : !snap?.supported ? (
          <div className="p-4 text-sm text-muted-foreground">
            This adapter doesn't support skills.
          </div>
        ) : snap.entries.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No skills available yet. Create one in the{" "}
            <Link to="/skills" className="underline">
              Skills
            </Link>{" "}
            tab.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {snap.entries.map((entry) => (
              <SkillRow
                key={entry.key}
                entry={entry}
                onToggle={() => toggle(entry)}
                busy={sync.isPending}
              />
            ))}
          </ul>
        )}
        {error && (
          <div className="border-t border-border px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {snap && snap.warnings.length > 0 && (
          <div className="border-t border-border px-4 py-2 text-xs text-amber-500">
            {snap.warnings.join(" · ")}
          </div>
        )}
      </div>
    </section>
  );
}

function SkillRow({
  entry,
  onToggle,
  busy,
}: {
  entry: AdapterSkillEntry;
  onToggle: () => void;
  busy: boolean;
}) {
  const locked = Boolean(entry.required) || Boolean(entry.readOnly);
  const label = entry.originLabel ?? entry.origin ?? "";
  const tone =
    entry.state === "configured"
      ? "text-green-400"
      : entry.state === "missing"
      ? "text-red-400"
      : "text-muted-foreground";

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm">
            {entry.runtimeName ?? entry.key}
          </span>
          {entry.required && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Lock className="size-3" /> required
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
          {label && (
            <span className="text-muted-foreground">{label}</span>
          )}
          <span className={tone}>· {entry.state}</span>
          {entry.detail && (
            <span className="text-muted-foreground/70">· {entry.detail}</span>
          )}
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={locked || busy}
        title={
          locked
            ? entry.readOnly
              ? "User-installed skill — managed outside Clipboard"
              : (entry.requiredReason ?? "Required skill")
            : undefined
        }
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-40 ${
          entry.desired ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            entry.desired ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </li>
  );
}

// Markdown body for the auto-created "clipboard-memory" company skill. Mirrors
// skills/clipboard-memory/SKILL.md in the repo. Inlined so the UI can seed the
// company library without depending on a filesystem path the server can read.
const CLIPBOARD_MEMORY_SKILL_MARKDOWN = `---
name: clipboard-memory
description: Session memory for agents that do not have their own memory system. Read memory.md at the start of every task, reference past work and decisions, and never repeat work already recorded. Used whenever context from earlier sessions matters.
---

# Clipboard Session Memory

You have a persistent, file-based memory called \`memory.md\`. After each of your
runs, a short summary is appended to this file automatically. Use it to remember
what you have already done so you can build on it instead of starting fresh.

## At the start of every task

1. Check whether \`memory.md\` exists in your working directory.
2. If it exists, read it before doing anything else.
3. Treat the entries as background context — past tasks, decisions, output,
   and anything flagged for next time.

## How to use it

- Do not repeat work that is already recorded as done.
- Cite past decisions when relevant.
- Pick up threads when the current task is open-ended.
- Respect the archive — \`## Archive — YYYY-MM\` sections are older, compressed.

## What NOT to do

- Do not edit \`memory.md\` yourself; it is managed by Clipboard.
- Do not treat memory as authoritative over the user.
- Do not surface memory to the user unless they ask.
`;

const MEMORY_SKILL_SLUG = "clipboard-memory";

function MemorySection({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const qc = useQueryClient();
  const enabled = agent.metadata?.memory_enabled === true;
  const cwd = (agent.adapterConfig?.cwd as string | undefined) ?? null;
  const [showViewer, setShowViewer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companySkills = useQuery({
    queryKey: ["skills", agent.companyId],
    queryFn: () => api.listCompanySkills(agent.companyId),
  });

  const agentSkills = useQuery({
    queryKey: ["agentSkills", agent.id],
    queryFn: () => api.listAgentSkills(agent.id),
  });

  const findMemorySkillKey = (): string | null => {
    const fromLibrary = (companySkills.data ?? []).find(
      (s) => s.slug === MEMORY_SKILL_SLUG || s.key === MEMORY_SKILL_SLUG,
    );
    if (fromLibrary) return fromLibrary.key;
    const entry = (agentSkills.data?.entries ?? []).find(
      (e) => e.key === MEMORY_SKILL_SLUG || e.runtimeName === MEMORY_SKILL_SLUG,
    );
    return entry?.key ?? null;
  };

  const toggle = useMutation({
    mutationFn: async () => {
      const turnOn = !enabled;

      if (turnOn) {
        // 1. Ensure the skill exists in the company library.
        let key = findMemorySkillKey();
        if (!key) {
          const created = await api.createCompanySkill(agent.companyId, {
            name: "Session memory",
            slug: MEMORY_SKILL_SLUG,
            description:
              "Persistent memory stored in memory.md in the agent's working directory.",
            markdown: CLIPBOARD_MEMORY_SKILL_MARKDOWN,
          });
          key = created.key;
        }

        // 2. Add the skill to this agent's desired skills.
        const current = new Set(agentSkills.data?.desiredSkills ?? []);
        current.add(key);
        await api.syncAgentSkills(agent.id, Array.from(current));

        // 3. Flip the flag in metadata so the post-run hook knows to record.
        await api.updateAgent(agent.id, {
          metadata: { ...(agent.metadata ?? {}), memory_enabled: true },
        });
      } else {
        // 1. Remove the skill from desired skills (leave it in the library).
        const key = findMemorySkillKey();
        const remaining = (agentSkills.data?.desiredSkills ?? []).filter(
          (k) => k !== key && k !== MEMORY_SKILL_SLUG,
        );
        await api.syncAgentSkills(agent.id, remaining);

        // 2. Flip the flag off.
        await api.updateAgent(agent.id, {
          metadata: { ...(agent.metadata ?? {}), memory_enabled: false },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agent.id] });
      qc.invalidateQueries({ queryKey: ["agentSkills", agent.id] });
      qc.invalidateQueries({ queryKey: ["skills", agent.companyId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const clear = useMutation({
    mutationFn: () => api.clearAgentMemory(agent.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agentMemory", agent.id] });
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const canEnable = Boolean(cwd);

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Memory
      </h2>
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Brain className="size-4" />
              Enable session memory
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              After every successful task, Clipboard summarizes the run and
              appends it to <code className="font-mono">memory.md</code> in the
              agent's working directory. The agent reads it on the next run to
              pick up where it left off.
            </div>
            {!canEnable && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="size-3" />
                Set a working directory first — memory is stored in that folder.
              </div>
            )}
          </div>
          <button
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending || !canEnable}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-40 ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
            title={
              !canEnable
                ? "Set a working directory on the agent to enable memory."
                : undefined
            }
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {enabled && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              onClick={() => setShowViewer(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              <BookOpen className="size-3.5" /> View memory
            </button>
            <button
              onClick={() => {
                if (
                  confirm(
                    "Clear memory for this agent? This wipes memory.md and cannot be undone.",
                  )
                ) {
                  clear.mutate();
                }
              }}
              disabled={clear.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {clear.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Clear memory
            </button>
            {cwd && (
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">
                  {cwd.replace(/\/Users\/[^/]+/, "~")}/memory.md
                </span>
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      {showViewer && (
        <MemoryViewerModal agentId={agent.id} onClose={() => setShowViewer(false)} />
      )}
    </section>
  );
}

function MemoryViewerModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const memory = useQuery({
    queryKey: ["agentMemory", agentId],
    queryFn: () => api.getAgentMemory(agentId),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl max-h-[85vh] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">memory.md</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {memory.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : memory.error ? (
            <div className="text-destructive">
              {memory.error instanceof Error ? memory.error.message : String(memory.error)}
            </div>
          ) : !memory.data?.exists ? (
            <div className="text-sm text-muted-foreground">
              No memory yet. It will appear here after the agent's next
              successful task.
            </div>
          ) : (
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs">
              {memory.data.content}
            </pre>
          )}
          {memory.data?.path && (
            <div className="mt-3 text-xs text-muted-foreground font-mono">
              {memory.data.path}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetSection({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const currentBudget = agent.budgetMonthlyCents != null
    ? String(agent.budgetMonthlyCents / 100)
    : "";
  const [input, setInput] = useState(currentBudget);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const trimmed = input.trim();
      const cents = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100);
      if (cents !== null && (isNaN(cents) || cents < 0)) {
        throw new Error("Enter a valid dollar amount, or leave blank for no limit.");
      }
      return api.updateAgent(agent.id, { budgetMonthlyCents: cents });
    },
    onSuccess: () => { setError(null); onSaved(); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const budget = agent.budgetMonthlyCents;
  const spent = agent.spentMonthlyCents ?? 0;
  const hasBudget = budget != null && budget > 0;
  const metered = isMeteredAgent(agent);
  const pct = hasBudget ? Math.min(100, Math.round((spent / budget!) * 100)) : 0;
  const isNearLimit = hasBudget && metered && pct >= 80 && pct < 100;
  const isAtLimit = hasBudget && metered && pct >= 100;
  const budgetPaused = agent.status === "paused" && hasBudget && metered;

  const barColor = pct >= 100
    ? "bg-red-500"
    : pct >= 80
    ? "bg-amber-500"
    : "bg-green-500";

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Budget
      </h2>
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        {!metered && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <div className="mt-0.5 size-4 shrink-0 rounded-full bg-blue-500/20" />
            <div className="text-muted-foreground">
              <span className="text-foreground">Subscription — no dollar cap.</span>{" "}
              This agent runs under your Claude plan, so its runs don't incur
              per-dollar charges and budgets don't track usage. Budget caps
              only enforce on agents authenticating with their own API key.
            </div>
          </div>
        )}

        {budgetPaused && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Agent auto-paused — monthly budget reached. Resume will reset for next billing cycle.
            </span>
          </div>
        )}

        {hasBudget && metered && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatUsd(spent / 100)} spent</span>
              <span className={isAtLimit ? "text-red-400" : isNearLimit ? "text-amber-400" : ""}>
                {pct}% of {formatUsd(budget! / 100)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {isNearLimit && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="size-3" /> Approaching monthly limit
              </div>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <label className="flex-1 block">
            <div className="mb-1.5 text-sm font-medium">
              Monthly budget
              {!metered && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (inactive while on subscription)
                </span>
              )}
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground text-sm">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="No limit"
                className="w-full rounded-md border border-border bg-background py-2 pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metered
                ? "Leave blank for no limit. Clipboard auto-pauses the agent at 100%."
                : "Any cap you set here activates automatically if you switch this agent to API-key auth."}
            </div>
          </label>
          <button
            onClick={() => { setError(null); save.mutate(); }}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </button>
        </div>
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}
      </div>
    </section>
  );
}

const INTERVAL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Every 30 seconds", value: 30 },
  { label: "Every 5 minutes", value: 300 },
  { label: "Every 15 minutes", value: 900 },
  { label: "Every 30 minutes", value: 1800 },
  { label: "Every 1 hour", value: 3600 },
  { label: "Every 4 hours", value: 14400 },
  { label: "Every 12 hours", value: 43200 },
  { label: "Every 24 hours", value: 86400 },
];

function WakeConditionsSection({
  agent,
  onSaved,
}: {
  agent: Agent;
  onSaved: () => void;
}) {
  const hb = (agent.runtimeConfig?.heartbeat ?? {}) as Record<string, unknown>;
  const savedEnabled = Boolean(hb.enabled);
  const savedInterval =
    (hb.intervalSec as number | undefined) ??
    (hb.intervalSeconds as number | undefined) ??
    3600;

  const [enabled, setEnabled] = useState(savedEnabled);
  const [interval, setInterval] = useState<number>(savedInterval);

  const save = useMutation({
    mutationFn: () =>
      api.updateAgent(agent.id, {
        runtimeConfig: {
          ...(agent.runtimeConfig ?? {}),
          heartbeat: {
            ...(hb ?? {}),
            enabled,
            intervalSec: interval,
            intervalSeconds: interval,
            wakeOnDemand: true,
          },
        },
      }),
    onSuccess: onSaved,
  });

  const dirty = enabled !== savedEnabled || interval !== savedInterval;

  const summary = enabled
    ? INTERVAL_OPTIONS.find((o) => o.value === interval)?.label.toLowerCase() ??
      `every ${interval}s`
    : "Manual + when tasks are assigned";

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Wake conditions
      </h2>

      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">
          Current: <span className="text-foreground">{summary}</span>
        </div>

        {/* Scheduled wake */}
        <div className="space-y-3 rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Wake on a schedule</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Checks in automatically at a regular interval to look for work.
              </div>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              disabled={save.isPending}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
                enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {enabled && (
            <label className="block">
              <div className="mb-1 text-xs text-muted-foreground">Check in every…</div>
              <select
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Always-on triggers (built into the backend — informational only) */}
        <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Always on</div>
          This agent also wakes automatically when a task is assigned to them,
          regardless of the schedule above.
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {dirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save wake conditions
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Permissions ─────────────────────────────────────────────────────────
//
// Two operator-facing toggles:
//
//   Can hire other agents (canCreateAgents)
//     Persisted in agents.permissions.canCreateAgents via the dedicated
//     PATCH /agents/:id/permissions endpoint. Lets this agent draft new
//     agent configs and submit hire requests; new hires still land in
//     pending_approval until the operator approves.
//
//   Require approval before sending external messages (metadata flag)
//     v0 is a *prompt-level* gate: when on, we (a) set
//     metadata.requireApprovalForExternalMessages = true and (b) inject
//     a marked instruction block into the agent's promptTemplate telling
//     it to draft + ask for approval before any outbound send. Block is
//     idempotent — toggling off strips it. Real action-level interception
//     is v1 (an approvals queue + Telegram approve/reject UX).
const APPROVAL_GATE_OPEN = "<!-- CLIPBOARD_APPROVAL_GATE -->";
const APPROVAL_GATE_CLOSE = "<!-- /CLIPBOARD_APPROVAL_GATE -->";
const APPROVAL_GATE_TEXT = `${APPROVAL_GATE_OPEN}
APPROVAL GATE — IMPORTANT
You must NOT send any external message (Telegram, email, Slack, webhook, social
post, SMS, or any outbound channel) without explicit human approval.
Before any external send, reply to the user with:
  DRAFT: <the message you intend to send>
  CHANNEL: <where it would go>
Then wait for the user to reply with "approve" (or to edit/cancel) before
actually sending. If they don't approve, do not send.
${APPROVAL_GATE_CLOSE}`;

function ensureApprovalGateInPrompt(promptTemplate: string): string {
  if (promptTemplate.includes(APPROVAL_GATE_OPEN)) return promptTemplate;
  return `${promptTemplate.trimEnd()}\n\n${APPROVAL_GATE_TEXT}\n`;
}

function stripApprovalGateFromPrompt(promptTemplate: string): string {
  // Remove the marked block plus any surrounding blank lines so toggling
  // on/off repeatedly doesn't leave drift.
  const re = new RegExp(
    `\\n*${APPROVAL_GATE_OPEN}[\\s\\S]*?${APPROVAL_GATE_CLOSE}\\n*`,
    "g",
  );
  return promptTemplate.replace(re, "\n").trimEnd() + "\n";
}

function PermissionsSection({
  agent,
  onSaved,
}: {
  agent: Agent;
  onSaved: () => void;
}) {
  const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const promptTemplate =
    typeof adapterCfg.promptTemplate === "string" ? adapterCfg.promptTemplate : "";
  const md = (agent.metadata ?? {}) as Record<string, unknown>;

  const savedCanHire = Boolean(agent.permissions?.canCreateAgents);
  const savedApprovalGate = Boolean(md.requireApprovalForExternalMessages);

  const [canHire, setCanHire] = useState(savedCanHire);
  const [approvalGate, setApprovalGate] = useState(savedApprovalGate);
  const [error, setError] = useState<string | null>(null);

  const saveHire = useMutation({
    mutationFn: (next: boolean) =>
      api.updateAgentPermissions(agent.id, { canCreateAgents: next }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const saveApprovalGate = useMutation({
    mutationFn: (next: boolean) => {
      const nextPrompt = next
        ? ensureApprovalGateInPrompt(promptTemplate)
        : stripApprovalGateFromPrompt(promptTemplate);
      const promptChanged = nextPrompt !== promptTemplate;
      return api.updateAgent(agent.id, {
        metadata: {
          ...md,
          requireApprovalForExternalMessages: next,
        },
        ...(promptChanged
          ? {
              adapterConfig: {
                ...adapterCfg,
                promptTemplate: nextPrompt,
              },
            }
          : {}),
      });
    },
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const onToggleHire = () => {
    const next = !canHire;
    setCanHire(next);
    saveHire.mutate(next);
  };

  const onToggleApprovalGate = () => {
    const next = !approvalGate;
    setApprovalGate(next);
    saveApprovalGate.mutate(next);
  };

  const pending = saveHire.isPending || saveApprovalGate.isPending;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Permissions
      </h2>

      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        {/* Can hire agents */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Can hire new agents</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              When on, this agent can draft new agent configs and submit hire
              requests. New hires land in <span className="font-mono">pending_approval</span>{" "}
              and wait for you to approve them.
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleHire}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
              canHire ? "bg-primary" : "bg-muted"
            }`}
            aria-pressed={canHire}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                canHire ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Approval gate before external sends */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Require my approval before sending external messages
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              When on, the agent must show you a draft and wait for explicit
              approval before any outbound send (Telegram, email, Slack,
              webhook, posts). Today this is enforced at the prompt level —
              best for agents that follow instructions carefully. Action-level
              blocking comes later when the org chart adds human-in-the-loop
              roles.
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleApprovalGate}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
              approvalGate ? "bg-primary" : "bg-muted"
            }`}
            aria-pressed={approvalGate}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                approvalGate ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskInput({ agent, onSent }: { agent: Agent; onSent: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const trimmed = prompt.trim();
      if (!trimmed) throw new Error("Enter a prompt");
      return api.wakeupAgent(agent.id, {
        reason: "Ad-hoc task from Mission Control",
        payload: { prompt: trimmed },
        forceFreshSession: true,
      });
    },
    onSuccess: () => {
      setPrompt("");
      setError(null);
      onSent();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const disabled = agent.status === "paused" || send.isPending;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Send a task
      </h2>
      <div className="rounded-md border border-border bg-card p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
          rows={3}
          placeholder={
            agent.status === "paused"
              ? "Agent is paused — resume it first."
              : `Tell ${agent.name} what to do…`
          }
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {error && (
          <div className="mt-2 text-sm text-destructive">{error}</div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Each task starts fresh. Output appears below.
          </div>
          <button
            onClick={() => send.mutate()}
            disabled={disabled || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

function RunCard({ run }: { run: HeartbeatRun }) {
  const [expanded, setExpanded] = useState(false);

  const tokens = runTokens(run);
  const billing = runBilling(run);
  const model = runModel(run);
  const duration = runDurationMs(run);
  const summary = runSummary(run) ?? runWakeReason(run) ?? "(no summary yet)";

  const costDisplay =
    billing.kind === "subscription"
      ? "Subscription"
      : billing.kind === "api"
      ? formatUsd(billing.usd)
      : "—";

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <StatusBadge status={run.status} />
          <span className="truncate text-sm">{summary}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatDuration(duration)}</span>
          <span>{formatTokens(tokens.total)} tokens</span>
          <span
            title={
              billing.kind === "subscription"
                ? `Covered by your Claude subscription. API-equivalent cost would be ${formatUsd(
                    billing.apiEquivalentUsd,
                  )}.`
                : undefined
            }
            className={billing.kind === "subscription" ? "text-muted-foreground/70" : undefined}
          >
            {costDisplay}
          </span>
          <span>{formatRelativeTime(run.startedAt)}</span>
        </div>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          {run.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap">
              {run.error}
            </div>
          )}
          {runSummary(run) && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Output</div>
              <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs">
                {runSummary(run)}
              </div>
            </div>
          )}
          <dl className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="Input" value={formatTokens(tokens.input)} />
            <Stat label="Cached" value={formatTokens(tokens.cached)} />
            <Stat label="Output" value={formatTokens(tokens.output)} />
            <Stat label="Model" value={model ?? "—"} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function EditAgentForm({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [title, setTitle] = useState(agent.title ?? "");
  const [capabilities, setCapabilities] = useState(agent.capabilities ?? "");
  const [persona, setPersona] = useState(agent.metadata?.persona ?? "");
  const [cwd, setCwd] = useState((agent.adapterConfig?.cwd as string | undefined) ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.updateAgent(agent.id, {
        name: name.trim(),
        title: title.trim() || null,
        capabilities: capabilities.trim() || null,
        metadata: persona.trim() ? { persona: persona.trim() } : null,
        adapterConfig: {
          ...agent.adapterConfig,
          ...(cwd.trim() ? { cwd: cwd.trim() } : { cwd: undefined }),
        },
      }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h2 className="text-base font-semibold">Edit Agent</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Job title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">What this agent does</div>
            <textarea
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Personality & style</div>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Working directory</div>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/Users/you/Projects/my-project"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !name.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

