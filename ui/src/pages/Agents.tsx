import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { formatRelativeTime } from "../lib/format";
import type { Agent } from "../lib/types";
import { AddAgentDialog } from "../components/AddAgentDialog";

export function AgentsPage() {
  const company = useDefaultCompany();
  const [adding, setAdding] = useState(false);

  const agents = useQuery({
    queryKey: ["agents", company.data?.id],
    queryFn: () => api.listAgents(company.data!.id),
    enabled: !!company.data?.id,
    refetchInterval: 5_000,
  });

  const approvals = useQuery({
    queryKey: ["pendingApprovals", company.data?.id],
    queryFn: () => api.listPendingApprovals(company.data!.id),
    enabled: !!company.data?.id,
    refetchInterval: 10_000,
  });

  const pendingByAgentId = new Map<string, string>();
  for (const a of approvals.data ?? []) {
    if (a.type === "hire_agent" && typeof a.payload.agentId === "string") {
      pendingByAgentId.set(a.payload.agentId, a.id);
    }
  }

  if (company.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (company.error) {
    return (
      <div className="text-destructive">
        Could not reach the backend. Is it running?
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="size-4" /> Add Agent
        </button>
      </div>

      {agents.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading agents…
        </div>
      ) : agents.data && agents.data.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.data
            ?.slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                pendingApprovalId={pendingByAgentId.get(a.id) ?? null}
              />
            ))}
        </div>
      )}

      {adding && company.data && (
        <AddAgentDialog
          companyId={company.data.id}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-12 rounded-lg border border-dashed border-border p-12 text-center">
      <h2 className="text-lg font-medium">No agents yet</h2>
      <p className="mt-2 text-muted-foreground">
        Add your first Claude Code agent to get started.
      </p>
      <button
        onClick={onAdd}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="size-4" /> Add Agent
      </button>
    </div>
  );
}

function statusColor(status: Agent["status"]) {
  switch (status) {
    case "running":
      return "bg-green-500/20 text-green-400";
    case "active":
    case "idle":
      return "bg-blue-500/20 text-blue-400";
    case "paused":
      return "bg-yellow-500/20 text-yellow-400";
    case "error":
      return "bg-red-500/20 text-red-400";
    case "pending_approval":
      return "bg-purple-500/20 text-purple-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function AgentCard({
  agent,
  pendingApprovalId,
}: {
  agent: Agent;
  pendingApprovalId: string | null;
}) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["agents"] });
    qc.invalidateQueries({ queryKey: ["pendingApprovals"] });
  };

  const pause = useMutation({
    mutationFn: () => api.pauseAgent(agent.id),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => api.resumeAgent(agent.id),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAgent(agent.id),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: () => api.approveApproval(pendingApprovalId!),
    onSuccess: invalidate,
  });

  const model =
    (agent.adapterConfig?.model as string | undefined) ?? "default";
  const cwd = agent.adapterConfig?.cwd as string | undefined;
  const isPaused = agent.status === "paused";
  const isPendingApproval = agent.status === "pending_approval";

  return (
    <div className="group rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-primary/40">
      <Link to={`/agents/${agent.id}`} className="block p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-medium group-hover:text-primary">{agent.name}</div>
            {agent.title && (
              <div className="text-xs text-muted-foreground">{agent.title}</div>
            )}
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${statusColor(agent.status)}`}
          >
            {agent.status === "pending_approval" ? "pending" : agent.status}
          </span>
        </div>
        {agent.capabilities && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
            {agent.capabilities}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <dt className="opacity-70">Model</dt>
            <dd className="font-mono text-foreground">{model}</dd>
          </div>
          <div>
            <dt className="opacity-70">Last active</dt>
            <dd>{formatRelativeTime(agent.lastHeartbeatAt)}</dd>
          </div>
          {cwd && (
            <div className="col-span-2">
              <dt className="opacity-70">Working directory</dt>
              <dd className="truncate font-mono text-foreground">{cwd.replace(/\/Users\/[^/]+/, "~")}</dd>
            </div>
          )}
        </dl>
      </Link>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        {isPendingApproval ? (
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending || !pendingApprovalId}
            title={
              !pendingApprovalId
                ? "No pending approval record found for this agent."
                : undefined
            }
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1.5 text-xs text-green-400 hover:bg-green-500/20 disabled:opacity-50"
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
            disabled={resume.isPending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Play className="size-3.5" /> Resume
          </button>
        ) : (
          <button
            onClick={() => pause.mutate()}
            disabled={pause.isPending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Pause className="size-3.5" /> Pause
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Remove agent "${agent.name}"?`)) remove.mutate();
          }}
          disabled={remove.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
