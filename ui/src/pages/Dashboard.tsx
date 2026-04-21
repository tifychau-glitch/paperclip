// Dashboard — unified high-level overview of the business.
//
// Pulls together everything a non-technical operator needs to see at a glance:
// agent roster + status, month spend, pending approvals, 14-day run activity,
// success rate, spending by agent, and recent activity + failures.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Banknote,
  Bot,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { formatRelativeTime, formatTokens, formatUsd } from "../lib/format";
import type { Agent, HeartbeatRun } from "../lib/types";

// Friendly translations for Paperclip's audit-log action codes.
// Matches the list used in Activity.tsx so the two views feel consistent.
const ACTION_LABELS: Record<string, string> = {
  "agent.created": "Agent created",
  "agent.updated": "Agent updated",
  "agent.deleted": "Agent deleted",
  "agent.paused": "Agent paused",
  "agent.resumed": "Agent resumed",
  "heartbeat.invoked": "Task assigned",
  "heartbeat.started": "Task started",
  "heartbeat.completed": "Task completed",
  "heartbeat.failed": "Task failed",
  "company.created": "Company created",
  "company.updated": "Company settings changed",
  "hire_hook.succeeded": "Agent hired",
  "hire_hook.failed": "Agent hire failed",
  "hire_hook.error": "Agent hire errored",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function statusDot(status: Agent["status"]) {
  switch (status) {
    case "running":
      return "bg-green-500";
    case "active":
    case "idle":
      return "bg-blue-500";
    case "paused":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    case "pending_approval":
      return "bg-purple-500";
    default:
      return "bg-muted-foreground/50";
  }
}

export function DashboardPage() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;

  const agents = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => api.listAgents(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  const approvals = useQuery({
    queryKey: ["pendingApprovals", companyId],
    queryFn: () => api.listPendingApprovals(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const costsSummary = useQuery({
    queryKey: ["costs", "summary", companyId],
    queryFn: () => api.costsSummary(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const byAgent = useQuery({
    queryKey: ["costs", "byAgent", companyId],
    queryFn: () => api.costsByAgent(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const runs = useQuery({
    queryKey: ["runs", companyId],
    queryFn: () => api.listRuns(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  const activity = useQuery({
    queryKey: ["activity", companyId],
    queryFn: () => api.activity(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  // Agent counts by category
  const agentStats = useMemo(() => {
    const list = agents.data ?? [];
    let enabled = 0;
    let paused = 0;
    let pending = 0;
    let error = 0;
    for (const a of list) {
      if (a.status === "paused") paused++;
      else if (a.status === "pending_approval") pending++;
      else if (a.status === "error") error++;
      else enabled++;
    }
    return { total: list.length, enabled, paused, pending, error };
  }, [agents.data]);

  // Lifetime run + token totals
  const spendStats = useMemo(() => {
    const rows = byAgent.data ?? [];
    let tokens = 0;
    let runsTotal = 0;
    let subRuns = 0;
    let apiRuns = 0;
    for (const r of rows) {
      tokens +=
        r.inputTokens +
        r.cachedInputTokens +
        r.outputTokens +
        r.subscriptionInputTokens +
        r.subscriptionCachedInputTokens +
        r.subscriptionOutputTokens;
      subRuns += r.subscriptionRunCount;
      apiRuns += r.apiRunCount;
    }
    runsTotal = subRuns + apiRuns;
    return { tokens, runsTotal, subRuns, apiRuns };
  }, [byAgent.data]);

  // 14-day run activity (split by succeeded / failed) — uses the recent-runs feed
  const runActivity = useMemo(() => {
    return buildDailyActivity(runs.data ?? [], 14);
  }, [runs.data]);

  // Success rate across all fetched runs (snapshot of recent runs)
  const successRate = useMemo(() => {
    const list = runs.data ?? [];
    let ok = 0;
    let bad = 0;
    for (const r of list) {
      if (r.status === "succeeded") ok++;
      else if (r.status === "failed" || r.status === "cancelled") bad++;
    }
    const done = ok + bad;
    return { ok, bad, done, pct: done === 0 ? 0 : Math.round((ok / done) * 100) };
  }, [runs.data]);

  // Top 5 agents by total tokens (lifetime)
  const topSpenders = useMemo(() => {
    const rows = (byAgent.data ?? []).map((r) => ({
      ...r,
      totalTokens: r.inputTokens + r.cachedInputTokens + r.outputTokens,
    }));
    rows.sort((a, b) => b.totalTokens - a.totalTokens);
    return rows.slice(0, 5);
  }, [byAgent.data]);

  const recentActivity = (activity.data ?? []).slice(0, 8);

  const recentFailures = useMemo(() => {
    return (runs.data ?? [])
      .filter((r) => r.status === "failed")
      .slice(0, 5);
  }, [runs.data]);

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.data ?? []) m.set(a.id, a.name);
    return m;
  }, [agents.data]);

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

  const apiSpendUsd = (costsSummary.data?.spendCents ?? 0) / 100;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything happening across {company.data?.name ?? "your business"} at a glance.
        </p>
      </div>

      {/* Pending approvals banner — always surface these */}
      {(approvals.data ?? []).length > 0 && (
        <Link
          to="/agents"
          className="flex items-center justify-between gap-3 rounded-md border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200 hover:bg-purple-500/15"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="size-4 shrink-0" />
            <span>
              {approvals.data!.length} pending approval
              {approvals.data!.length === 1 ? "" : "s"} waiting for your review.
            </span>
          </div>
          <span className="text-xs underline underline-offset-2">Review →</span>
        </Link>
      )}

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Bot}
          label="Agents enabled"
          value={String(agentStats.enabled)}
          hint={
            agentStats.paused || agentStats.pending || agentStats.error
              ? `${agentStats.paused} paused · ${agentStats.pending} pending · ${agentStats.error} error`
              : `${agentStats.total} total`
          }
          to="/agents"
        />
        <KpiCard
          icon={ShieldCheck}
          label="Pending approvals"
          value={String((approvals.data ?? []).length)}
          hint={(approvals.data ?? []).length === 0 ? "All clear" : "Awaiting review"}
          to="/agents"
        />
        <KpiCard
          icon={Banknote}
          label="Month spend"
          value={formatUsd(apiSpendUsd)}
          hint={
            costsSummary.data?.budgetCents
              ? `${costsSummary.data.utilizationPercent}% of budget`
              : "No budget set"
          }
          to="/spending"
        />
        <KpiCard
          icon={ActivityIcon}
          label="Total runs"
          value={String(spendStats.runsTotal)}
          hint={`${spendStats.subRuns} sub · ${spendStats.apiRuns} API`}
          to="/tasks"
        />
      </section>

      {/* Charts: run activity + success rate */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Run activity" subtitle="Last 14 days" className="lg:col-span-2">
          {runActivity.total === 0 ? (
            <EmptyPanel text="No runs yet." />
          ) : (
            <RunActivityChart data={runActivity} />
          )}
        </Panel>
        <Panel title="Success rate" subtitle={`${successRate.done} recent runs`}>
          {successRate.done === 0 ? (
            <EmptyPanel text="No completed runs yet." />
          ) : (
            <SuccessDonut pct={successRate.pct} ok={successRate.ok} bad={successRate.bad} />
          )}
        </Panel>
      </section>

      {/* Agents overview + spending breakdown */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Agents" subtitle={`${agentStats.total} total`}>
          {agents.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : agents.data && agents.data.length > 0 ? (
            <ul className="divide-y divide-border">
              {agents.data
                .slice()
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/agents/${a.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 hover:text-primary"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`size-2 shrink-0 rounded-full ${statusDot(a.status)}`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.name}</div>
                          {a.title && (
                            <div className="truncate text-xs text-muted-foreground">
                              {a.title}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">
                        {a.status === "pending_approval" ? "pending" : a.status}
                        <span className="mx-1.5 opacity-40">·</span>
                        {formatRelativeTime(a.lastHeartbeatAt)}
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyPanel text="No agents yet." />
          )}
        </Panel>

        <Panel
          title="Top spenders"
          subtitle="Lifetime tokens"
          headerAction={
            <Link
              to="/spending"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All →
            </Link>
          }
        >
          {topSpenders.length === 0 ? (
            <EmptyPanel text="No token usage yet." />
          ) : (
            <ul className="space-y-3">
              {topSpenders.map((row) => {
                const max = topSpenders[0].totalTokens || 1;
                const pct = Math.max(2, Math.round((row.totalTokens / max) * 100));
                return (
                  <li key={row.agentId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link
                        to={`/agents/${row.agentId}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {row.agentName}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatTokens(row.totalTokens)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {row.subscriptionRunCount + row.apiRunCount} runs
                      </span>
                      <span>{formatUsd(row.costCents / 100)} API</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </section>

      {/* Recent activity + recent failures */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Recent activity"
          headerAction={
            <Link
              to="/activity"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All →
            </Link>
          }
        >
          {recentActivity.length === 0 ? (
            <EmptyPanel text="Nothing has happened yet." />
          ) : (
            <ul className="divide-y divide-border">
              {recentActivity.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-full bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
                      {actionLabel(e.action)}
                    </span>
                    {e.agentId && agentNameById.has(e.agentId) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {agentNameById.get(e.agentId)}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent failures"
          subtitle={recentFailures.length > 0 ? "Runs that errored" : "Nothing to worry about"}
        >
          {recentFailures.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-green-500" />
              No failures recently.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentFailures.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/agents/${r.agentId}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {agentNameById.get(r.agentId) ?? "Unknown agent"}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(r.finishedAt ?? r.startedAt ?? r.createdAt)}
                      </span>
                    </div>
                    {r.error && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.error}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ---------- Subcomponents ----------

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  to?: string;
}) {
  const inner = (
    <div className="rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function Panel({
  title,
  subtitle,
  children,
  className,
  headerAction,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <div className={`rounded-md border border-border bg-card p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{text}</div>;
}

// ---------- Charts (inline SVG — no library) ----------

type DailyBucket = {
  date: string; // YYYY-MM-DD
  label: string; // short label (e.g. "Tue")
  succeeded: number;
  failed: number;
  other: number;
};

type DailyActivity = {
  buckets: DailyBucket[];
  max: number;
  total: number;
};

function buildDailyActivity(runsIn: HeartbeatRun[], days: number): DailyActivity {
  const now = new Date();
  const buckets: DailyBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    buckets.push({
      date: key,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      succeeded: 0,
      failed: 0,
      other: 0,
    });
  }
  const byDate = new Map(buckets.map((b) => [b.date, b]));

  for (const run of runsIn) {
    const ts = run.startedAt ?? run.createdAt;
    if (!ts) continue;
    const key = new Date(ts).toISOString().slice(0, 10);
    const bucket = byDate.get(key);
    if (!bucket) continue;
    if (run.status === "succeeded") bucket.succeeded++;
    else if (run.status === "failed" || run.status === "cancelled") bucket.failed++;
    else bucket.other++;
  }

  let max = 0;
  let total = 0;
  for (const b of buckets) {
    const n = b.succeeded + b.failed + b.other;
    if (n > max) max = n;
    total += n;
  }
  return { buckets, max: Math.max(1, max), total };
}

function RunActivityChart({ data }: { data: DailyActivity }) {
  const { buckets, max } = data;
  const height = 120;
  return (
    <div>
      <div
        className="grid items-end gap-1"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, height }}
      >
        {buckets.map((b) => {
          const total = b.succeeded + b.failed + b.other;
          const hPct = total === 0 ? 0 : (total / max) * 100;
          const okH = total === 0 ? 0 : (b.succeeded / total) * hPct;
          const badH = total === 0 ? 0 : (b.failed / total) * hPct;
          const otherH = total === 0 ? 0 : (b.other / total) * hPct;
          return (
            <div
              key={b.date}
              className="group relative flex h-full w-full flex-col justify-end"
              title={`${b.date}: ${b.succeeded} ok · ${b.failed} failed · ${b.other} other`}
            >
              {total === 0 ? (
                <div className="h-[2px] w-full rounded-sm bg-muted/70" />
              ) : (
                <div className="flex h-full w-full flex-col-reverse overflow-hidden rounded-sm">
                  <div
                    className="w-full bg-green-500/80"
                    style={{ height: `${okH}%` }}
                  />
                  <div
                    className="w-full bg-red-500/80"
                    style={{ height: `${badH}%` }}
                  />
                  <div
                    className="w-full bg-muted-foreground/40"
                    style={{ height: `${otherH}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="mt-1 grid gap-1 text-[10px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
      >
        {buckets.map((b, i) => (
          <div key={b.date} className="text-center">
            {i % 2 === 0 ? b.label.slice(0, 2) : ""}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <Legend color="bg-green-500/80" label="succeeded" />
        <Legend color="bg-red-500/80" label="failed" />
        <Legend color="bg-muted-foreground/40" label="other" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function SuccessDonut({ pct, ok, bad }: { pct: number; ok: number; bad: number }) {
  const size = 140;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} className="shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-muted/60"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c / 4}
          strokeLinecap="round"
          className="text-green-500"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-foreground text-xl font-semibold"
        >
          {pct}%
        </text>
      </svg>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-green-500" />
          <span className="font-mono">{ok}</span>
          <span className="text-muted-foreground">succeeded</span>
        </div>
        <div className="flex items-center gap-2">
          <XCircle className="size-4 text-red-500" />
          <span className="font-mono">{bad}</span>
          <span className="text-muted-foreground">failed</span>
        </div>
      </div>
    </div>
  );
}
