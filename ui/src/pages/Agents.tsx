import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Pause, Play, Plus, Trash2, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { formatRelativeTime } from "../lib/format";
import { isCeoAgent, isMeteredAgent, type Agent } from "../lib/types";
import { AddAgentDialog } from "../components/AddAgentDialog";
import { EmptyState } from "../components/EmptyState";
import { AgentCardSkeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";

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
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : agents.data && agents.data.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="size-6" strokeWidth={1.5} />}
          title="No agents yet"
          description="Add your first agent to get started."
          action={{ label: "Add agent", onClick: () => setAdding(true) }}
        />
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

function BudgetBar({ agent }: { agent: Agent }) {
  const budget = agent.budgetMonthlyCents;
  if (budget == null || budget === 0) return null;
  // Subscription agents don't accumulate costCents, so the bar would sit at
  // 0% forever and mislead the user. Hide it and let the AgentDetail page
  // explain the nuance.
  if (!isMeteredAgent(agent)) return null;
  const spent = agent.spentMonthlyCents ?? 0;
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const isAtLimit = pct >= 100;
  const isNear = pct >= 80 && !isAtLimit;
  const barColor = isAtLimit ? "bg-red-500" : isNear ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="mt-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {(isNear || isAtLimit) && (
        <div className={`mt-1 flex items-center gap-1 text-xs ${isAtLimit ? "text-red-400" : "text-amber-400"}`}>
          <AlertTriangle className="size-3" />
          {isAtLimit ? "Budget reached" : "Approaching limit"}
        </div>
      )}
    </div>
  );
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
  const isCeo = isCeoAgent(agent);

  return (
    <div className="group rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-primary/40">
      <Link to={`/agents/${agent.id}`} className="block p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium group-hover:text-primary">{agent.name}</div>
            {agent.title && (
              <div className="text-xs text-muted-foreground">{agent.title}</div>
            )}
            {isCeo && (
              <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                Receives tasks from owner
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isCeo && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                CEO
              </span>
            )}
            <StatusBadge status={agent.status} />
          </div>
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
        <BudgetBar agent={agent} />
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
