// Minimal types matching the subset of Paperclip's API we consume.
// Source of truth is Paperclip's DB schema; we only declare what we read.

export type Company = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  createdAt: string;
};

export type AgentStatus =
  | "active"
  | "idle"
  | "running"
  | "paused"
  | "error"
  | "pending_approval";

export type AdapterModel = { id: string; label: string };

export type AdapterInfo = {
  type: string;
  label: string;
  source: string;
  modelsCount: number;
  loaded: boolean;
  disabled: boolean;
};

export type Agent = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: AgentStatus;
  reportsTo: string | null;
  capabilities: string | null;
  metadata: { persona?: string; delegationContext?: string | null } | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown> | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  pauseReason: string | null;
  pausedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  urlKey: string;
};

export type HeartbeatRunUsage = {
  model?: string;
  biller?: string;
  provider?: string;
  billingType?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  freshSession?: boolean;
  sessionReused?: boolean;
  persistedSessionId?: string;
};

export type HeartbeatRun = {
  id: string;
  companyId: string;
  agentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  errorCode: string | null;
  exitCode: number | null;
  usageJson: HeartbeatRunUsage | null;
  contextSnapshot: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  createdAt: string;
  updatedAt: string;
};

// Convenience accessors — the API's shape buries these under usageJson
// and contextSnapshot, and duration is implied by start/finish timestamps.
export function runTokens(run: HeartbeatRun): {
  input: number;
  output: number;
  cached: number;
  total: number;
} {
  const u = run.usageJson ?? {};
  const input = u.inputTokens ?? 0;
  const output = u.outputTokens ?? 0;
  const cached = u.cachedInputTokens ?? 0;
  return { input, output, cached, total: input + output };
}

export function runCostUsd(run: HeartbeatRun): number | null {
  return run.usageJson?.costUsd ?? null;
}

// Whether this run was covered by a Claude subscription (no real $ spent)
// or billed to an API key (real $ spent).
export function runBilling(run: HeartbeatRun):
  | { kind: "subscription"; apiEquivalentUsd: number | null }
  | { kind: "api"; usd: number | null }
  | { kind: "unknown" } {
  const bt = run.usageJson?.billingType;
  if (!bt) return { kind: "unknown" };
  if (bt.includes("subscription")) {
    return { kind: "subscription", apiEquivalentUsd: runCostUsd(run) };
  }
  if (bt === "api" || bt === "metered_api") {
    return { kind: "api", usd: runCostUsd(run) };
  }
  return { kind: "unknown" };
}

export function runModel(run: HeartbeatRun): string | null {
  return run.usageJson?.model ?? null;
}

export function runDurationMs(run: HeartbeatRun): number | null {
  if (!run.startedAt) return null;
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  return end - new Date(run.startedAt).getTime();
}

export function runWakeReason(run: HeartbeatRun): string | null {
  const ctx = run.contextSnapshot;
  if (!ctx) return null;
  const reason = (ctx as { wakeReason?: unknown }).wakeReason;
  return typeof reason === "string" ? reason : null;
}

export function runSummary(run: HeartbeatRun): string | null {
  const r = run.resultJson;
  if (!r) return null;
  const result = (r as { result?: unknown; summary?: unknown }).result;
  if (typeof result === "string") return result;
  const summary = (r as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : null;
}

export type ActivityEvent = {
  id: string;
  companyId: string;
  agentId: string | null;
  kind: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export type CostsSummary = {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
};

export type CostsByAgentRow = {
  agentId: string;
  agentName: string;
  agentStatus: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionInputTokens: number;
  subscriptionCachedInputTokens: number;
  subscriptionOutputTokens: number;
};

// -------- Skills --------

export type CompanySkillSourceType =
  | "local_path"
  | "github"
  | "url"
  | "catalog"
  | "skills_sh";

export type CompanySkillSourceBadge =
  | "paperclip"
  | "github"
  | "local"
  | "url"
  | "catalog"
  | "skills_sh";

export type CompanySkillFileInventoryEntry = {
  path: string;
  kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other";
};

export type CompanySkillListItem = {
  id: string;
  companyId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: CompanySkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  fileInventory: CompanySkillFileInventoryEntry[];
  attachedAgentCount: number;
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: CompanySkillSourceBadge;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanySkillDetail = CompanySkillListItem & {
  markdown: string;
  usedByAgents: Array<{
    id: string;
    name: string;
    urlKey: string;
    adapterType: string;
    desired: boolean;
    actualState: string | null;
  }>;
};

export type CompanySkillFileDetail = {
  skillId: string;
  path: string;
  kind: CompanySkillFileInventoryEntry["kind"];
  content: string;
  language: string | null;
  markdown: boolean;
  editable: boolean;
};

export type AdapterSkillEntry = {
  key: string;
  runtimeName: string | null;
  desired: boolean;
  managed: boolean;
  required?: boolean;
  requiredReason?: string | null;
  state: "configured" | "available" | "external" | "missing" | string;
  origin?:
    | "company_managed"
    | "paperclip_required"
    | "user_installed"
    | "external_unknown";
  originLabel?: string | null;
  locationLabel?: string | null;
  readOnly?: boolean;
  sourcePath?: string | null;
  targetPath?: string | null;
  detail?: string | null;
};

export type AdapterSkillSnapshot = {
  adapterType: string;
  supported: boolean;
  mode: string;
  desiredSkills: string[];
  entries: AdapterSkillEntry[];
  warnings: string[];
};

export type ActivityRow = {
  id: string;
  companyId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};
