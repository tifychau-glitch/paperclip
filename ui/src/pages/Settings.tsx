import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  Check,
  Key,
  Loader2,
  LogOut,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import { useSession, useSignOut } from "../lib/auth";
import { formatRelativeTime, formatUsd } from "../lib/format";
import type { CompanySecret } from "../lib/types";

type TabId = "profile" | "api-keys" | "spend" | "integrations" | "notifications";

const TABS: Array<{ id: TabId; label: string; icon: typeof UserIcon }> = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "spend", label: "Spend Limits", icon: Wallet },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>("profile");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, API keys, and how Clipboard talks to the rest of your stack.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:w-48">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {tab === "profile" && <ProfileTab />}
          {tab === "api-keys" && <ApiKeysTab />}
          {tab === "spend" && <SpendLimitsTab />}
          {tab === "integrations" && <IntegrationsTab />}
          {tab === "notifications" && <ComingSoon
            title="Notifications"
            blurb="Choose what gets pushed to you (and where) when an agent finishes work, gets blocked, or hits a budget."
          />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const session = useSession();
  const signOut = useSignOut();
  const user = session.data?.user;

  if (session.isLoading) return <Loading />;
  if (!user) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Not signed in.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-4">
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground text-lg font-semibold">
            {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">{user.name || "—"}</div>
            <div className="text-sm text-muted-foreground truncate" title={user.email ?? undefined}>
              {user.email || "—"}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Profile editing is coming soon. For now, contact your instance admin to update your name or email.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Sign out</div>
            <div className="text-xs text-muted-foreground">End this session on this device.</div>
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent/50 disabled:opacity-50"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── API Keys ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;
  const qc = useQueryClient();

  const secrets = useQuery({
    queryKey: ["secrets", companyId],
    queryFn: () => api.listSecrets(companyId!),
    enabled: !!companyId,
  });

  const [adding, setAdding] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  const createSecret = useMutation({
    mutationFn: (body: { name: string; value: string; description?: string }) =>
      api.createSecret(companyId!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["secrets", companyId] });
      setAdding(false);
    },
  });

  const deleteSecret = useMutation({
    mutationFn: (id: string) => api.deleteSecret(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["secrets", companyId] }),
  });

  const rotateSecret = useMutation({
    mutationFn: (vars: { id: string; value: string }) =>
      api.rotateSecret(vars.id, { value: vars.value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["secrets", companyId] });
      setRotatingId(null);
    },
  });

  if (company.isLoading) return <Loading />;
  if (!companyId) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">API Keys & Credentials</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Stored encrypted at rest. Values are write-only — to change a key, rotate it.
              Reference these in agent configs by name.
            </div>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-4" /> Add key
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-4 border-t border-border pt-4">
            <SecretForm
              submitLabel="Save key"
              isPending={createSecret.isPending}
              error={createSecret.error?.message}
              onCancel={() => {
                setAdding(false);
                createSecret.reset();
              }}
              onSubmit={(vals) => createSecret.mutate(vals)}
            />
          </div>
        )}
      </Card>

      {secrets.isLoading ? (
        <Loading />
      ) : secrets.error ? (
        <Card>
          <ErrorBanner message={secrets.error.message} />
        </Card>
      ) : !secrets.data || secrets.data.length === 0 ? (
        <Card>
          <div className="py-6 text-center text-sm text-muted-foreground">
            No API keys yet. Add your first one above — common names are{" "}
            <code className="text-xs">ANTHROPIC_API_KEY</code>,{" "}
            <code className="text-xs">OPENAI_API_KEY</code>.
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium uppercase tracking-wide">Name</th>
                <th className="px-4 py-2 text-left font-medium uppercase tracking-wide">Description</th>
                <th className="px-4 py-2 text-right font-medium uppercase tracking-wide">Version</th>
                <th className="px-4 py-2 text-right font-medium uppercase tracking-wide">Updated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {secrets.data.map((s) => (
                <SecretRow
                  key={s.id}
                  secret={s}
                  rotating={rotatingId === s.id}
                  onStartRotate={() => setRotatingId(s.id)}
                  onCancelRotate={() => {
                    setRotatingId(null);
                    rotateSecret.reset();
                  }}
                  onRotate={(value) => rotateSecret.mutate({ id: s.id, value })}
                  rotatePending={rotateSecret.isPending}
                  rotateError={
                    rotatingId === s.id ? rotateSecret.error?.message : undefined
                  }
                  onDelete={() => {
                    if (confirm(`Delete "${s.name}"? Agents referencing it will break.`)) {
                      deleteSecret.mutate(s.id);
                    }
                  }}
                  deletePending={deleteSecret.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SecretRow({
  secret,
  rotating,
  onStartRotate,
  onCancelRotate,
  onRotate,
  rotatePending,
  rotateError,
  onDelete,
  deletePending,
}: {
  secret: CompanySecret;
  rotating: boolean;
  onStartRotate: () => void;
  onCancelRotate: () => void;
  onRotate: (value: string) => void;
  rotatePending: boolean;
  rotateError?: string;
  onDelete: () => void;
  deletePending: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-3 font-mono text-xs">{secret.name}</td>
        <td className="px-4 py-3 text-muted-foreground">
          {secret.description || <span className="text-muted-foreground/50">—</span>}
        </td>
        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
          v{secret.latestVersion}
        </td>
        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
          {formatRelativeTime(secret.updatedAt)}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onStartRotate}
              disabled={rotating}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
              title="Rotate value"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deletePending}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              title="Delete secret"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {rotating && (
        <tr className="border-b border-border last:border-0 bg-accent/20">
          <td colSpan={5} className="px-4 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim()) onRotate(value.trim());
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="password"
                autoFocus
                placeholder="New value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
              <button
                type="submit"
                disabled={!value.trim() || rotatePending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {rotatePending ? "Rotating…" : "Rotate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  onCancelRotate();
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
              >
                Cancel
              </button>
            </form>
            {rotateError && <ErrorBanner message={rotateError} className="mt-2" />}
          </td>
        </tr>
      )}
    </>
  );
}

function SecretForm({
  submitLabel,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  submitLabel: string;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (vals: { name: string; value: string; description?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit = name.trim().length > 0 && value.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          name: name.trim(),
          value: value.trim(),
          description: description.trim() || undefined,
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="e.g. ANTHROPIC_API_KEY">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MY_API_KEY"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="Value" hint="Stored encrypted. You won't see it again.">
          <input
            type="password"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-…"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
          />
        </Field>
      </div>
      <Field label="Description (optional)">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this used for?"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Spend Limits ─────────────────────────────────────────────────────────

function SpendLimitsTab() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;

  const agents = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => api.listAgents(companyId!),
    enabled: !!companyId,
  });

  const summary = useMemo(() => {
    const list = agents.data ?? [];
    const withBudget = list.filter((a) => a.budgetMonthlyCents != null && a.budgetMonthlyCents > 0);
    const totalBudget = withBudget.reduce((s, a) => s + (a.budgetMonthlyCents ?? 0), 0);
    const totalSpent = list.reduce((s, a) => s + (a.spentMonthlyCents ?? 0), 0);
    return {
      total: list.length,
      withBudget: withBudget.length,
      withoutBudget: list.length - withBudget.length,
      totalBudgetUsd: totalBudget / 100,
      totalSpentUsd: totalSpent / 100,
    };
  }, [agents.data]);

  if (company.isLoading || agents.isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-medium">Monthly spend at a glance</div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Agents" value={String(summary.total)} />
          <Stat label="With budget" value={String(summary.withBudget)} />
          <Stat label="No limit" value={String(summary.withoutBudget)} />
          <Stat
            label="Spent / Budgeted"
            value={`${formatUsd(summary.totalSpentUsd)} / ${formatUsd(summary.totalBudgetUsd)}`}
          />
        </div>
      </Card>

      <Card>
        <div className="text-sm font-medium">Where to set limits</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Spend limits are configured per agent. Open an agent and edit its monthly budget.
          Subscription-based agents (e.g. Claude Pro) don't accrue dollar cost — budgets
          only apply to API-keyed agents.
        </p>
        <div className="mt-3 flex gap-2">
          <Link
            to="/agents"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent/50"
          >
            Open Agents
          </Link>
          <Link
            to="/spending"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent/50"
          >
            View detailed spending
          </Link>
        </div>
      </Card>
    </div>
  );
}

// ─── Integrations / Telegram ──────────────────────────────────────────────

function IntegrationsTab() {
  const company = useDefaultCompany();
  const companyId = company.data?.id;
  const qc = useQueryClient();

  const config = useQuery({
    queryKey: ["telegram", companyId],
    queryFn: () => api.getTelegramConfig(companyId!),
    enabled: !!companyId,
  });

  const agents = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => api.listAgents(companyId!),
    enabled: !!companyId,
  });

  // Local form state — initialised from server config, edited freely until saved.
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState<string>("");
  const [allowedUserIds, setAllowedUserIds] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    | { kind: "ok"; username: string | null; name: string | null }
    | { kind: "error"; message: string }
    | null
  >(null);

  useEffect(() => {
    if (!config.data) return;
    setEnabled(config.data.enabled);
    setDefaultAgentId(config.data.defaultAgentId ?? "");
    setAllowedUserIds(config.data.allowedUserIds.join("\n"));
    // Don't reset botToken — user may be mid-typing a new value.
  }, [config.data]);

  const save = useMutation({
    mutationFn: (body: {
      enabled?: boolean;
      botToken?: string | null;
      defaultAgentId?: string | null;
      allowedUserIds?: string[];
    }) => api.updateTelegramConfig(companyId!, body),
    onSuccess: () => {
      setSaveError(null);
      setBotToken(""); // Clear input — token is now stored.
      qc.invalidateQueries({ queryKey: ["telegram", companyId] });
    },
    onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
  });

  const test = useMutation({
    mutationFn: (token: string | null) =>
      api.testTelegramBot(companyId!, token ? { botToken: token } : {}),
    onSuccess: (result) => {
      if (result.ok) {
        setTestResult({
          kind: "ok",
          username: result.botUsername,
          name: result.botName,
        });
      } else {
        setTestResult({ kind: "error", message: result.error });
      }
    },
    onError: (e) =>
      setTestResult({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      }),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteTelegramConfig(companyId!),
    onSuccess: () => {
      setEnabled(false);
      setBotToken("");
      setDefaultAgentId("");
      setAllowedUserIds("");
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ["telegram", companyId] });
    },
  });

  if (company.isLoading || config.isLoading) return <Loading />;
  if (!companyId) return null;

  const parsedUserIds = allowedUserIds
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const userIdsValid = parsedUserIds.every((id) => /^-?\d+$/.test(id));

  const onSave = () => {
    if (!userIdsValid) {
      setSaveError("Telegram IDs must be numbers only (one per line).");
      return;
    }
    const body: Parameters<typeof save.mutate>[0] = {
      enabled,
      defaultAgentId: defaultAgentId || null,
      allowedUserIds: parsedUserIds,
    };
    if (botToken.trim().length > 0) {
      body.botToken = botToken.trim();
    }
    save.mutate(body);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
            <Send className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Telegram</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Message your agents from your phone. Texts route to the default
              agent and the run shows up in Tasks. Voice messages and per-agent
              addressing come next.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          {/* Status row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <StatusPill config={config.data ?? null} />
            </div>
            {config.data?.lastPolledAt && (
              <span className="text-xs text-muted-foreground">
                Last check-in {formatRelativeTime(config.data.lastPolledAt)}
              </span>
            )}
          </div>

          {config.data?.lastError && (
            <ErrorBanner message={config.data.lastError} />
          )}

          {/* Enable toggle */}
          <Field
            label="Enabled"
            hint="When on, the server long-polls Telegram for messages and routes them to your agents."
          >
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-4 rounded border-border bg-background"
              />
              <span>{enabled ? "Listening for messages" : "Off"}</span>
            </label>
          </Field>

          {/* Bot token */}
          <Field
            label="Bot token"
            hint={
              config.data?.botTokenSet
                ? "A token is stored. Paste a new one to replace it, or leave blank to keep the current one."
                : "Get one from @BotFather on Telegram. Saved encrypted."
            }
          >
            <div className="flex gap-2">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  config.data?.botTokenSet
                    ? "•••••••••••• (configured)"
                    : "123456:ABC-DEF…"
                }
                className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                disabled={
                  test.isPending ||
                  (!botToken.trim() && !config.data?.botTokenSet)
                }
                onClick={() => test.mutate(botToken.trim() || null)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent/50 disabled:opacity-50"
              >
                {test.isPending ? "Testing…" : "Test"}
              </button>
            </div>
            {testResult?.kind === "ok" && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs text-green-400">
                <Check className="size-3.5" />
                Connected to{" "}
                <span className="font-mono">
                  @{testResult.username ?? "unknown"}
                </span>
                {testResult.name && (
                  <span className="text-muted-foreground">({testResult.name})</span>
                )}
              </div>
            )}
            {testResult?.kind === "error" && (
              <ErrorBanner message={testResult.message} className="mt-2" />
            )}
          </Field>

          {/* Default agent */}
          <Field
            label="Default agent"
            hint="Every message routes here unless you say otherwise. CEO is a good pick if you have one."
          >
            <select
              value={defaultAgentId}
              onChange={(e) => setDefaultAgentId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— pick an agent —</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.title ? ` (${a.title})` : ""}
                </option>
              ))}
            </select>
          </Field>

          {/* Allowed user IDs */}
          <Field
            label="Allowed Telegram user IDs"
            hint="One per line. Find yours by messaging @userinfobot. Anyone not on this list is silently ignored."
          >
            <textarea
              value={allowedUserIds}
              onChange={(e) => setAllowedUserIds(e.target.value)}
              rows={3}
              placeholder="123456789"
              className={`w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono ${
                userIdsValid ? "border-border" : "border-red-500/50"
              }`}
            />
            {!userIdsValid && (
              <div className="mt-1 text-xs text-red-400">
                Must be numbers only (one per line).
              </div>
            )}
          </Field>

          {saveError && <ErrorBanner message={saveError} />}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onSave}
              disabled={save.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "Disconnect Telegram? The bot will stop listening and your token will be removed.",
                  )
                ) {
                  remove.mutate();
                }
              }}
              disabled={remove.isPending || !config.data?.botTokenSet}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-medium">More integrations</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Webhooks, scheduled triggers, email-in. Coming as the agent fleet
          grows up.
        </p>
      </Card>
    </div>
  );
}

function StatusPill({ config }: { config: { enabled: boolean; botTokenSet: boolean; lastError: string | null } | null }) {
  if (!config || !config.botTokenSet) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
        Not configured
      </span>
    );
  }
  if (!config.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
        Off
      </span>
    );
  }
  if (config.lastError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-300">
      <span className="inline-block size-1.5 rounded-full bg-green-400" />
      Listening
    </span>
  );
}

// ─── Coming Soon ──────────────────────────────────────────────────────────

function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <Card>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
        Coming soon
      </div>
    </Card>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border bg-card p-4">{children}</div>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground/70">{hint}</div>}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading…
    </div>
  );
}

function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 ${
        className ?? ""
      }`}
    >
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <span className="break-words">{message}</span>
    </div>
  );
}
