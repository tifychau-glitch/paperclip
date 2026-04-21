import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { formatTokens, formatUsd } from "../lib/format";
import { isMeteredAgent, type Agent } from "../lib/types";

export function SpendingPage() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;

  const summary = useQuery({
    queryKey: ["costs", "summary", companyId],
    queryFn: () => api.costsSummary(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  const byAgent = useQuery({
    queryKey: ["costs", "byAgent", companyId],
    queryFn: () => api.costsByAgent(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  const agents = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => api.listAgents(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  // Map agentId → agent for budget lookup
  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents.data ?? []) m.set(a.id, a);
    return m;
  }, [agents.data]);

  const totals = useMemo(() => {
    if (!byAgent.data) return null;
    let inputTokens = 0,
      cachedInputTokens = 0,
      outputTokens = 0,
      apiRunCount = 0,
      subscriptionRunCount = 0;
    for (const row of byAgent.data) {
      inputTokens += row.inputTokens;
      cachedInputTokens += row.cachedInputTokens;
      outputTokens += row.outputTokens;
      apiRunCount += row.apiRunCount;
      subscriptionRunCount += row.subscriptionRunCount;
    }
    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + cachedInputTokens + outputTokens,
      runs: apiRunCount + subscriptionRunCount,
      apiRunCount,
      subscriptionRunCount,
    };
  }, [byAgent.data]);

  // Count agents paused because of budget exhaustion. Only metered agents
  // can be auto-paused by budget — subscription agents' costCents never
  // increments, so a paused subscription agent was paused for other reasons.
  const agentsAtLimit = useMemo(() => {
    return (agents.data ?? []).filter(
      (a) =>
        a.status === "paused" &&
        a.budgetMonthlyCents != null &&
        a.budgetMonthlyCents > 0 &&
        isMeteredAgent(a),
    ).length;
  }, [agents.data]);

  if (company.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const apiSpendUsd = (summary.data?.spendCents ?? 0) / 100;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Spending</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscription runs are covered by your Claude plan. API runs incur real dollars.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total tokens"
          value={formatTokens(totals?.totalTokens)}
          hint={`${formatTokens(totals?.outputTokens)} output`}
        />
        <Stat
          label="Total runs"
          value={String(totals?.runs ?? 0)}
          hint={`${totals?.subscriptionRunCount ?? 0} sub, ${totals?.apiRunCount ?? 0} API`}
        />
        <Stat
          label="API spend"
          value={formatUsd(apiSpendUsd)}
          hint={apiSpendUsd === 0 ? "All on subscription" : "From API-key agents"}
        />
        <Stat
          label="Agents at limit"
          value={String(agentsAtLimit)}
          hint={agentsAtLimit === 0 ? "All within budget" : "Auto-paused by budget"}
          alert={agentsAtLimit > 0}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Per agent (lifetime)
        </h2>
        {byAgent.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : !byAgent.data || byAgent.data.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No agents yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <Th>Agent</Th>
                  <Th align="right">Runs</Th>
                  <Th align="right">Input</Th>
                  <Th align="right">Cached</Th>
                  <Th align="right">Output</Th>
                  <Th align="right">API spend</Th>
                  <Th align="right">Budget</Th>
                </tr>
              </thead>
              <tbody>
                {byAgent.data.map((row) => {
                  const subRuns = row.subscriptionRunCount;
                  const apiRuns = row.apiRunCount;
                  const agent = agentMap.get(row.agentId);
                  const metered = agent ? isMeteredAgent(agent) : false;
                  const budget = agent?.budgetMonthlyCents ?? null;
                  const spent = agent?.spentMonthlyCents ?? 0;
                  const pct =
                    budget && metered
                      ? Math.min(100, Math.round((spent / budget) * 100))
                      : null;
                  const budgetColor =
                    pct == null
                      ? ""
                      : pct >= 100
                      ? "text-red-400"
                      : pct >= 80
                      ? "text-amber-400"
                      : "text-muted-foreground";

                  return (
                    <tr key={row.agentId} className="border-b border-border last:border-0">
                      <Td>
                        <Link
                          to={`/agents/${row.agentId}`}
                          className="font-medium hover:text-primary"
                        >
                          {row.agentName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{row.agentStatus}</div>
                      </Td>
                      <Td align="right">
                        <div>{subRuns + apiRuns}</div>
                        {(subRuns > 0 || apiRuns > 0) && (
                          <div className="text-xs text-muted-foreground">
                            {subRuns} sub · {apiRuns} API
                          </div>
                        )}
                      </Td>
                      <Td align="right" mono>{formatTokens(row.inputTokens)}</Td>
                      <Td align="right" mono>{formatTokens(row.cachedInputTokens)}</Td>
                      <Td align="right" mono>{formatTokens(row.outputTokens)}</Td>
                      <Td align="right" mono>
                        {formatUsd(row.costCents / 100)}
                      </Td>
                      <Td align="right">
                        {!metered ? (
                          <span
                            className="text-muted-foreground/70"
                            title="Subscription agents don't incur per-dollar cost. Budget is inactive."
                          >
                            Subscription
                          </span>
                        ) : budget == null ? (
                          <span className="text-muted-foreground/60">No limit</span>
                        ) : (
                          <span className={budgetColor}>
                            {formatUsd(spent / 100)} / {formatUsd(budget / 100)}
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-md border bg-card p-4 ${alert ? "border-red-500/40" : "border-border"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${alert ? "text-red-400" : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-4 py-2 font-medium uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  mono,
}: {
  children: React.ReactNode;
  align?: "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : ""} ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}
