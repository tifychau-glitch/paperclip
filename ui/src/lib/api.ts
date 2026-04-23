// Thin fetch wrappers around Paperclip's REST API.
// The Node server runs at /api on the same origin (Vite proxies /api -> :3100 in dev).

import type {
  ActivityRow,
  AdapterInfo,
  AdapterModel,
  AdapterSkillSnapshot,
  Agent,
  Company,
  CompanySecret,
  CompanySkillDetail,
  CompanySkillFileDetail,
  CompanySkillListItem,
  CostsByAgentRow,
  CostsSummary,
  HeartbeatRun,
  SecretProvider,
  SecretProviderDescriptor,
  TelegramConfig,
  TelegramTestResult,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? JSON.stringify(body);
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Adapters
  listAdapters: () => request<AdapterInfo[]>("/adapters"),
  listAdapterModels: (companyId: string, type: string) =>
    request<AdapterModel[]>(
      `/companies/${companyId}/adapters/${type}/models`,
    ).catch(() => [] as AdapterModel[]),

  // Companies
  listCompanies: () => request<Company[]>("/companies"),
  createCompany: (body: { name: string; description?: string }) =>
    request<Company>("/companies", { method: "POST", body: JSON.stringify(body) }),

  // First-signup bootstrap. Safe to call on every sign-in — the server
  // responds 200/409 idempotently. See server/src/routes/bootstrap.ts.
  claimInstanceAdmin: () =>
    request<{
      promoted: boolean;
      alreadyAdmin?: boolean;
      firstClaim?: boolean;
      reason?: string;
    }>("/bootstrap/claim-instance-admin", { method: "POST", body: "{}" }),

  // Agents
  listAgents: (companyId: string) =>
    request<Agent[]>(`/companies/${companyId}/agents`),
  createAgent: (companyId: string, body: Record<string, unknown>) =>
    request<Agent>(`/companies/${companyId}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getAgent: (agentId: string) => request<Agent>(`/agents/${agentId}`),
  updateAgent: (agentId: string, patch: Record<string, unknown>) =>
    request<Agent>(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteAgent: (agentId: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}`, { method: "DELETE" }),
  pauseAgent: (agentId: string, reason?: string) =>
    request<Agent>(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paused", pauseReason: reason ?? null }),
    }),
  resumeAgent: (agentId: string) =>
    request<Agent>(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", pauseReason: null }),
    }),

  // Heartbeats / runs (ad-hoc tasks)
  wakeupAgent: (
    agentId: string,
    body: {
      reason?: string;
      payload?: Record<string, unknown>;
      forceFreshSession?: boolean;
      source?: "on_demand";
    },
  ) =>
    request<{ id: string; status: string }>(`/agents/${agentId}/wakeup`, {
      method: "POST",
      body: JSON.stringify({ source: "on_demand", ...body }),
    }),
  listRuns: (companyId: string, agentId?: string) => {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    return request<HeartbeatRun[]>(`/companies/${companyId}/heartbeat-runs${qs}`);
  },
  getRun: (runId: string) =>
    request<HeartbeatRun & { stdout?: string; stderr?: string; resultJson?: unknown }>(
      `/heartbeat-runs/${runId}`,
    ),

  // Costs
  costsSummary: (companyId: string) =>
    request<CostsSummary>(`/companies/${companyId}/costs/summary`),
  costsByAgent: (companyId: string) =>
    request<CostsByAgentRow[]>(`/companies/${companyId}/costs/by-agent`),

  // Activity (audit log of system events)
  activity: (companyId: string) =>
    request<ActivityRow[]>(`/companies/${companyId}/activity`),

  // Skills: company library
  listCompanySkills: (companyId: string) =>
    request<CompanySkillListItem[]>(`/companies/${companyId}/skills`),
  getCompanySkill: (companyId: string, skillId: string) =>
    request<CompanySkillDetail>(`/companies/${companyId}/skills/${skillId}`),
  createCompanySkill: (
    companyId: string,
    body: { name: string; slug?: string; description?: string; markdown?: string },
  ) =>
    request<CompanySkillDetail>(`/companies/${companyId}/skills`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importCompanySkills: (companyId: string, source: string) =>
    request<{ imported: Array<{ id: string; slug: string }>; warnings: string[] }>(
      `/companies/${companyId}/skills/import`,
      { method: "POST", body: JSON.stringify({ source }) },
    ),
  scanCompanySkills: (companyId: string) =>
    request<{
      scannedProjects: number;
      scannedWorkspaces: number;
      discovered: number;
      imported: Array<{ id: string; slug: string }>;
      updated: Array<{ id: string; slug: string }>;
      warnings: string[];
    }>(`/companies/${companyId}/skills/scan-projects`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deleteCompanySkill: (companyId: string, skillId: string) =>
    request<{ id: string }>(`/companies/${companyId}/skills/${skillId}`, {
      method: "DELETE",
    }),
  getCompanySkillFile: (
    companyId: string,
    skillId: string,
    path = "SKILL.md",
  ) =>
    request<CompanySkillFileDetail>(
      `/companies/${companyId}/skills/${skillId}/files?path=${encodeURIComponent(path)}`,
    ),
  updateCompanySkillFile: (
    companyId: string,
    skillId: string,
    path: string,
    content: string,
  ) =>
    request<CompanySkillFileDetail>(
      `/companies/${companyId}/skills/${skillId}/files`,
      { method: "PATCH", body: JSON.stringify({ path, content }) },
    ),

  // Approvals (for activating pending_approval agents)
  listPendingApprovals: (companyId: string) =>
    request<
      Array<{
        id: string;
        type: string;
        status: string;
        payload: { agentId?: string; name?: string } & Record<string, unknown>;
        createdAt: string;
      }>
    >(`/companies/${companyId}/approvals?status=pending`),
  approveApproval: (approvalId: string, decisionNote?: string) =>
    request<{ id: string; status: string }>(`/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({ decisionNote: decisionNote ?? null }),
    }),
  rejectApproval: (approvalId: string, decisionNote?: string) =>
    request<{ id: string; status: string }>(`/approvals/${approvalId}/reject`, {
      method: "POST",
      body: JSON.stringify({ decisionNote: decisionNote ?? null }),
    }),

  // Skills: per-agent assignment
  listAgentSkills: (agentId: string) =>
    request<AdapterSkillSnapshot>(`/agents/${agentId}/skills`),
  syncAgentSkills: (agentId: string, desiredSkills: string[]) =>
    request<AdapterSkillSnapshot>(`/agents/${agentId}/skills/sync`, {
      method: "POST",
      body: JSON.stringify({ desiredSkills }),
    }),

  // Daemon (Clipboard daemon devices — admin-only list)
  listDaemonDevices: () =>
    request<{
      devices: Array<{
        id: string;
        deviceName: string;
        os: string;
        availableClis: string[];
        version: string | null;
        lastSeenAt: string;
        registeredAt: string;
        deviceKey: string;
        deviceKeyFingerprint: string;
      }>;
    }>("/daemon/devices").catch(() => ({ devices: [] as Array<{
      id: string;
      deviceName: string;
      os: string;
      availableClis: string[];
      version: string | null;
      lastSeenAt: string;
      registeredAt: string;
      deviceKey: string;
      deviceKeyFingerprint: string;
    }> })),

  // Memory (Clipboard session memory stored at {cwd}/memory.md)
  getAgentMemory: (agentId: string) =>
    request<{
      path: string | null;
      exists: boolean;
      content: string;
      reason?: string;
    }>(`/agents/${agentId}/memory`),
  clearAgentMemory: (agentId: string) =>
    request<{ ok: boolean; path: string }>(`/agents/${agentId}/memory`, {
      method: "DELETE",
    }),

  // Secrets (per-company API keys / credentials)
  listSecretProviders: (companyId: string) =>
    request<SecretProviderDescriptor[]>(
      `/companies/${companyId}/secret-providers`,
    ),
  listSecrets: (companyId: string) =>
    request<CompanySecret[]>(`/companies/${companyId}/secrets`),
  createSecret: (
    companyId: string,
    body: {
      name: string;
      value: string;
      provider?: SecretProvider;
      description?: string;
      externalRef?: string;
    },
  ) =>
    request<CompanySecret>(`/companies/${companyId}/secrets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rotateSecret: (id: string, body: { value: string; externalRef?: string }) =>
    request<CompanySecret>(`/secrets/${id}/rotate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSecret: (
    id: string,
    body: { name?: string; description?: string; externalRef?: string },
  ) =>
    request<CompanySecret>(`/secrets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSecret: (id: string) =>
    request<{ ok: boolean }>(`/secrets/${id}`, { method: "DELETE" }),

  // Telegram integration (per-company)
  getTelegramConfig: (companyId: string) =>
    request<TelegramConfig>(`/companies/${companyId}/telegram`),
  updateTelegramConfig: (
    companyId: string,
    body: {
      enabled?: boolean;
      botToken?: string | null;
      defaultAgentId?: string | null;
      allowedUserIds?: string[];
    },
  ) =>
    request<TelegramConfig>(`/companies/${companyId}/telegram`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTelegramConfig: (companyId: string) =>
    request<{ ok: boolean }>(`/companies/${companyId}/telegram`, {
      method: "DELETE",
    }),
  testTelegramBot: (companyId: string, body: { botToken?: string }) =>
    request<TelegramTestResult>(`/companies/${companyId}/telegram/test`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
