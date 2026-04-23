import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send, X } from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { syncDelegationContext } from "../lib/delegation";
import type { Agent } from "../lib/types";
import { StatusBadge } from "../components/StatusBadge";

type TreeNode = { agent: Agent; children: TreeNode[] };

function buildForest(agents: Agent[]): TreeNode[] {
  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);

  const kids = new Map<string | null, Agent[]>();
  for (const a of agents) {
    // Missing/dangling parents are treated as roots so nothing gets hidden.
    const parent = a.reportsTo && byId.has(a.reportsTo) ? a.reportsTo : null;
    const list = kids.get(parent) ?? [];
    list.push(a);
    kids.set(parent, list);
  }

  const build = (a: Agent): TreeNode => ({
    agent: a,
    children: (kids.get(a.id) ?? []).map(build),
  });

  return (kids.get(null) ?? []).map(build);
}

function collectDescendants(node: TreeNode, into: Set<string>) {
  into.add(node.agent.id);
  for (const c of node.children) collectDescendants(c, into);
}

function findNode(forest: TreeNode[], id: string): TreeNode | null {
  for (const r of forest) {
    if (r.agent.id === id) return r;
    const f = findNode(r.children, id);
    if (f) return f;
  }
  return null;
}

export function OrgChartPage() {
  const company = useDefaultCompany();
  const qc = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState<string | "root" | null>(null);
  const [taskTarget, setTaskTarget] = useState<{ agent: Agent; from?: Agent } | null>(null);

  const agents = useQuery({
    queryKey: ["agents", company.data?.id],
    queryFn: () => api.listAgents(company.data!.id),
    enabled: !!company.data?.id,
    refetchInterval: 5_000,
  });

  // Sync delegation context whenever agent list changes (covers initial load too).
  useEffect(() => {
    if (agents.data && agents.data.length > 0) {
      syncDelegationContext(agents.data).catch(console.error);
    }
  }, [agents.data]);

  const reassign = useMutation({
    mutationFn: ({ agentId, newParent }: { agentId: string; newParent: string | null }) =>
      api.updateAgent(agentId, { reportsTo: newParent }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["agents"] });
      // Delegation context is re-synced by the useEffect above once the
      // query refetches with the updated reportsTo values.
    },
  });

  const forest = useMemo(
    () => (agents.data ? buildForest(agents.data) : []),
    [agents.data],
  );

  const forbiddenTargets = useMemo(() => {
    if (!draggingId) return new Set<string>();
    const src = findNode(forest, draggingId);
    if (!src) return new Set<string>();
    const set = new Set<string>();
    collectDescendants(src, set);
    return set;
  }, [draggingId, forest]);

  const handleDrop = (srcId: string, targetId: string | null) => {
    if (!srcId) return;
    if (srcId === targetId) return;
    if (targetId && forbiddenTargets.has(targetId)) return;
    reassign.mutate({ agentId: srcId, newParent: targetId });
  };

  if (company.isLoading || agents.isLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <div className="text-sm">Loading org chart…</div>
      </div>
    );
  }

  const empty = !agents.data || agents.data.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Org chart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag any agent onto another to change who they report to. Click an agent to assign them a task.
          </p>
        </div>
      </div>

      {empty ? (
        <div className="mt-12 rounded-lg border border-dashed border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
          No agents yet. Add some on the Agents tab.
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-lg border border-border bg-card p-8"
          onDragOver={(e) => {
            // Drop on the background = make root (no manager).
            if (draggingId) {
              e.preventDefault();
              setDropHover("root");
            }
          }}
          onDragLeave={() => setDropHover(null)}
          onDrop={(e) => {
            e.preventDefault();
            const src = e.dataTransfer.getData("text/plain");
            handleDrop(src, null);
            setDropHover(null);
            setDraggingId(null);
          }}
        >
          {dropHover === "root" && draggingId && (
            <div className="mb-4 rounded-md border border-dashed border-primary bg-primary/5 px-3 py-2 text-xs text-primary">
              Drop here to remove manager (become a root)
            </div>
          )}

          <div className="flex flex-wrap items-start justify-center gap-x-12 gap-y-16">
            {forest.map((root) => (
              <TreeNodeView
                key={root.agent.id}
                node={root}
                draggingId={draggingId}
                forbidden={forbiddenTargets}
                dropHover={dropHover}
                onDragStart={(id) => setDraggingId(id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropHover(null);
                }}
                onDragOverNode={(id) => setDropHover(id)}
                onDropNode={(srcId, targetId) => {
                  handleDrop(srcId, targetId);
                  setDropHover(null);
                  setDraggingId(null);
                }}
                onSelect={(a) => setTaskTarget({ agent: a })}
                onDelegate={(manager, report) =>
                  setTaskTarget({ agent: report, from: manager })
                }
              />
            ))}
          </div>
        </div>
      )}

      {taskTarget && (
        <AssignTaskModal
          target={taskTarget.agent}
          from={taskTarget.from}
          onClose={() => setTaskTarget(null)}
          onSent={() => {
            setTaskTarget(null);
            qc.invalidateQueries({ queryKey: ["runs"] });
          }}
        />
      )}
    </div>
  );
}

type NodeHandlers = {
  draggingId: string | null;
  forbidden: Set<string>;
  dropHover: string | "root" | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverNode: (id: string) => void;
  onDropNode: (srcId: string, targetId: string) => void;
  onSelect: (a: Agent) => void;
  onDelegate: (manager: Agent, report: Agent) => void;
};

function TreeNodeView({ node, ...h }: { node: TreeNode } & NodeHandlers) {
  return (
    <div className="flex flex-col items-center">
      <AgentBox node={node} {...h} />
      {node.children.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          {node.children.length > 1 && (
            <div
              className="h-px bg-border"
              style={{ width: `calc(${node.children.length} * 200px + ${(node.children.length - 1) * 32}px)` }}
            />
          )}
          <div className="flex items-start gap-8">
            {node.children.map((child) => (
              <div key={child.agent.id} className="flex flex-col items-center" style={{ minWidth: 200 }}>
                {node.children.length > 0 && <div className="h-6 w-px bg-border" />}
                <TreeNodeView node={child} {...h} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentBox({
  node,
  draggingId,
  forbidden,
  dropHover,
  onDragStart,
  onDragEnd,
  onDragOverNode,
  onDropNode,
  onSelect,
  onDelegate,
}: { node: TreeNode } & NodeHandlers) {
  const agent = node.agent;
  const isDragging = draggingId === agent.id;
  const isInvalidTarget = draggingId && (forbidden.has(agent.id) || draggingId === agent.id);
  const isDropTarget = dropHover === agent.id && draggingId && !isInvalidTarget;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", agent.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(agent.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!draggingId || isInvalidTarget) return;
        e.preventDefault();
        e.stopPropagation();
        onDragOverNode(agent.id);
      }}
      onDrop={(e) => {
        if (isInvalidTarget) return;
        e.preventDefault();
        e.stopPropagation();
        const src = e.dataTransfer.getData("text/plain");
        if (src && src !== agent.id) onDropNode(src, agent.id);
      }}
      onClick={(e) => {
        // Don't fire click when a drag just ended.
        if (draggingId) return;
        e.stopPropagation();
        onSelect(agent);
      }}
      className={`relative w-[200px] cursor-grab rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all active:cursor-grabbing hover:border-primary/60 hover:shadow-md ${
        isDragging ? "opacity-40" : ""
      } ${
        isDropTarget ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-border"
      } ${
        isInvalidTarget ? "opacity-30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{agent.name}</div>
          {agent.title && (
            <div className="truncate text-xs text-muted-foreground">{agent.title}</div>
          )}
        </div>
        <StatusBadge status={agent.status} compact className="mt-1" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono truncate">
          {(agent.adapterConfig?.model as string | undefined) ?? "default"}
        </span>
        {node.children.length > 0 && (
          <span className="rounded-full bg-muted/50 px-1.5 py-0.5">
            {node.children.length} {node.children.length === 1 ? "report" : "reports"}
          </span>
        )}
      </div>

      {node.children.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
          {node.children.slice(0, 3).map((c) => (
            <button
              key={c.agent.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelegate(agent, c.agent);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title={`Delegate a task from ${agent.name} to ${c.agent.name}`}
            >
              <ArrowRight className="size-2.5" />
              {c.agent.name}
            </button>
          ))}
          {node.children.length > 3 && (
            <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{node.children.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AssignTaskModal({
  target,
  from,
  onClose,
  onSent,
}: {
  target: Agent;
  from?: Agent;
  onClose: () => void;
  onSent: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const trimmed = prompt.trim();
      if (!trimmed) throw new Error("Enter a prompt");
      // If it's a delegation, prepend the manager context to the task so the
      // report agent knows who routed this to them.
      const finalPrompt = from
        ? `Task delegated by ${from.name}${from.title ? ` (${from.title})` : ""}:\n\n${trimmed}`
        : trimmed;
      return api.wakeupAgent(target.id, {
        reason: from
          ? `Delegated from ${from.name} to ${target.name} via org chart`
          : `Task from org chart to ${target.name}`,
        payload: { prompt: finalPrompt, delegatedBy: from?.id ?? null },
        forceFreshSession: true,
      });
    },
    onSuccess: onSent,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (target.status === "paused") {
      setError(`${target.name} is paused. Resume them first.`);
      return;
    }
    send.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {from ? "Delegate task" : "Assign task"}
            </h2>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {from ? (
                <>
                  <span className="font-medium text-foreground">{from.name}</span>
                  <ArrowRight className="mx-1 inline size-3" />
                  <span className="font-medium text-foreground">{target.name}</span>
                  {target.title ? ` · ${target.title}` : ""}
                </>
              ) : (
                <>
                  To{" "}
                  <Link
                    to={`/agents/${target.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {target.name}
                  </Link>
                  {target.title ? ` · ${target.title}` : ""}
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder={
              from
                ? `What should ${target.name} do on ${from.name}'s behalf?`
                : `Tell ${target.name} what to do…`
            }
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {from
                ? "The report will see the delegation context in the task."
                : "Task starts fresh. Output appears in Tasks and Activity."}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={send.isPending || !prompt.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
