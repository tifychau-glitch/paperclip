import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { formatRelativeTime } from "../lib/format";
import type { ActivityRow, Agent } from "../lib/types";
import { EmptyState } from "../components/EmptyState";

// Friendly translations for Paperclip's audit-log action codes.
const ACTION_LABELS: Record<string, string> = {
  "agent.created": "Agent created",
  "agent.updated": "Agent updated",
  "agent.deleted": "Agent deleted",
  "agent.paused": "Agent paused",
  "agent.resumed": "Agent resumed",
  "agent.key_created": "Agent API key created",
  "agent.key_deleted": "Agent API key deleted",
  "heartbeat.invoked": "Task assigned",
  "heartbeat.started": "Task started",
  "heartbeat.completed": "Task completed",
  "heartbeat.failed": "Task failed",
  "company.created": "Company created",
  "company.updated": "Company settings changed",
  "hire_hook.succeeded": "Agent hire succeeded",
  "hire_hook.failed": "Agent hire failed",
  "hire_hook.error": "Agent hire errored",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

export function ActivityPage() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;

  const events = useQuery({
    queryKey: ["activity", companyId],
    queryFn: () => api.activity(companyId!),
    enabled: !!companyId,
    refetchInterval: 5_000,
  });

  const agents = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => api.listAgents(companyId!),
    enabled: !!companyId,
  });

  const agentLookup = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents.data ?? []) m.set(a.id, a);
    return m;
  }, [agents.data]);

  const [actionFilter, setActionFilter] = useState<string>("");

  const filtered = useMemo(() => {
    if (!events.data) return [];
    if (!actionFilter) return events.data;
    return events.data.filter((e) => e.action === actionFilter);
  }, [events.data, actionFilter]);

  const distinctActions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events.data ?? []) set.add(e.action);
    return Array.from(set).sort();
  }, [events.data]);

  if (company.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything that happens across your agents — system events, hires, tasks.
          </p>
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All actions</option>
          {distinctActions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
      </div>

      {events.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        actionFilter ? (
          <div className="mt-8 rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No events match this filter.
          </div>
        ) : (
          <EmptyState
            icon={<ActivityIcon className="size-6" strokeWidth={1.5} />}
            title="Nothing yet"
            description="Agent activity will appear here as your team works."
          />
        )
      ) : (
        <ol className="mt-6 space-y-2">
          {filtered.map((e) => (
            <ActivityItem key={e.id} event={e} agent={e.agentId ? agentLookup.get(e.agentId) ?? null : null} />
          ))}
        </ol>
      )}
    </div>
  );
}

function ActivityItem({ event, agent }: { event: ActivityRow; agent: Agent | null }) {
  const detail = describeDetails(event.details);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="rounded-full bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
          {actionLabel(event.action)}
        </span>
        {agent && (
          <Link
            to={`/agents/${agent.id}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {agent.name}
          </Link>
        )}
        {detail && <span className="truncate text-muted-foreground">{detail}</span>}
      </div>
      <span className="text-xs text-muted-foreground">{formatRelativeTime(event.createdAt)}</span>
    </li>
  );
}

function describeDetails(details: Record<string, unknown> | null): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  // Cherry-pick a few common fields; fall back to a compact JSON-ish summary.
  const name = (details as { name?: unknown }).name;
  if (typeof name === "string" && name.trim()) return name;
  const agentId = (details as { agentId?: unknown }).agentId;
  if (typeof agentId === "string") return `agent ${agentId.slice(0, 8)}…`;
  const reason = (details as { reason?: unknown }).reason;
  if (typeof reason === "string") return reason;
  const keys = Object.keys(details).slice(0, 3).join(", ");
  return keys || null;
}
