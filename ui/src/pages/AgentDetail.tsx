import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
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

      <HeartbeatConfig agent={a} onSaved={invalidate} />
    </div>
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
              ? "User-installed skill — managed outside Paperclip"
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

const INTERVAL_OPTIONS = [
  { label: "Every 15 min", value: 900 },
  { label: "Every 30 min", value: 1800 },
  { label: "Every 1 hour", value: 3600 },
  { label: "Every 2 hours", value: 7200 },
  { label: "Every 6 hours", value: 21600 },
  { label: "Every 12 hours", value: 43200 },
  { label: "Every 24 hours", value: 86400 },
];

function HeartbeatConfig({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const hb = (agent.runtimeConfig?.heartbeat ?? {}) as Record<string, unknown>;
  const enabled = Boolean(hb.enabled);
  const intervalSec = (hb.intervalSec as number | undefined) ?? 3600;

  const save = useMutation({
    mutationFn: (patch: { enabled: boolean; intervalSec: number }) =>
      api.updateAgent(agent.id, {
        runtimeConfig: {
          ...(agent.runtimeConfig ?? {}),
          heartbeat: {
            ...(hb ?? {}),
            enabled: patch.enabled,
            intervalSec: patch.intervalSec,
            wakeOnDemand: true,
          },
        },
      }),
    onSuccess: onSaved,
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Autonomous schedule
      </h2>
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">
              {enabled ? "Running on schedule" : "Manual only"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {enabled
                ? `Wakes automatically ${INTERVAL_OPTIONS.find((o) => o.value === intervalSec)?.label.toLowerCase() ?? `every ${intervalSec}s`} to check for work and self-direct.`
                : "Only runs when you send a task manually."}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {enabled && (
              <select
                defaultValue={intervalSec}
                onChange={(e) =>
                  save.mutate({ enabled: true, intervalSec: Number(e.target.value) })
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => save.mutate({ enabled: !enabled, intervalSec })}
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
        </div>
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

  const statusTone =
    run.status === "running"
      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
      : run.status === "succeeded"
      ? "bg-green-500/10 text-green-400 border-green-500/30"
      : run.status === "failed"
      ? "bg-red-500/10 text-red-400 border-red-500/30"
      : "bg-muted/50 text-muted-foreground border-border";

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
          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone}`}>
            {run.status}
          </span>
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-green-500/20 text-green-400"
      : status === "active" || status === "idle"
      ? "bg-blue-500/20 text-blue-400"
      : status === "paused"
      ? "bg-yellow-500/20 text-yellow-400"
      : status === "error"
      ? "bg-red-500/20 text-red-400"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{status}</span>
  );
}
