# Clipboard — Project Handoff

## What This Is

**Clipboard** is a custom mission-control UI for running multiple Claude Code
agents, built on top of the open-source [Paperclip](https://github.com/paperclipai/paperclip)
backend. Tiffany wanted a clean, simple dashboard to manage AI agents —
Paperclip's backend is excellent (handles Claude CLI execution, session
management, cost tracking, scheduling) but its original UI is too complex. So
we replaced the UI entirely while keeping the backend mostly untouched. The
only backend edits are small, clearly-marked additive hooks for features the
UI needed (memory writer hook, memory read/clear routes, PATCH for renaming
skills).

There is also a second repo, **Paperclip Copy**, which is the original
Paperclip UI running unmodified on port 3101 — kept for reference.

---

## Repo Locations

| Project | Path | Port | Instance ID |
|---------|------|------|-------------|
| Clipboard (our custom UI + lightly-extended backend) | `~/Downloads/paperclip-claude/` | 3100 backend / 5173 or 5180 UI | `default` |
| Paperclip Copy (original UI) | `~/Downloads/paperclip-copy/` | 3101 | `paperclip-copy` |
| AIOS (Iris accountability system) | `~/Downloads/AIOS/` | — | n/a |

### How to start Clipboard

```bash
cd ~/Downloads/paperclip-claude && pnpm dev
# Open http://localhost:5173 (or :5180 if Iris dashboard is grabbing 5173)
```

If `:5173` is busy (Iris dashboard often binds it first), Claude Preview has a
`clipboard-ui` entry in `.claude/launch.json` that serves the UI on `:5180`.

### How to start Paperclip Copy

```bash
cd ~/Downloads/paperclip-copy && PORT=3101 PAPERCLIP_INSTANCE_ID=paperclip-copy pnpm dev
```

---

## Architecture

```
Browser (localhost:5173 or :5180)
  └─ React + Vite + Tailwind (our custom UI)
       └─ fetch /api/* → proxied to localhost:3100
            └─ Paperclip Node server (lightly extended)
                 ├─ Embedded PostgreSQL (~/.paperclip/instances/default/)
                 ├─ Heartbeat scheduler
                 ├─ claude_local adapter → claude CLI → Claude subscription or API key
                 └─ Clipboard-only additions (see "Backend extensions" below)
```

The UI calls Paperclip's existing REST API — we just show less and lay it out
differently. The DB schema and adapter layer are untouched. The only backend
code we've added lives inside clearly commented blocks.

---

## UI File Structure

```
ui/src/
  main.tsx                    React entry point (QueryClient, BrowserRouter)
  App.tsx                     Layout, 7-tab nav + CompanySwitcher, routes
  lib/
    api.ts                    All fetch wrappers for Paperclip REST API
    types.ts                  TypeScript types + helpers:
                              - runTokens/runBilling/runModel/runSummary/runWakeReason
                              - isMeteredAgent(agent)  — API-key vs subscription
                              - isCeoAgent(agent) / findCeoAgent(agents)
    format.ts                 formatTokens, formatUsd, formatDuration, formatRelativeTime
    company.ts                useDefaultCompany(), useCompanies(), useActiveCompanyId(),
                              setActiveCompanyId() — persists selected company to localStorage
    templates.ts              10 built-in agent role templates (CEO template is the
                              long 4-step delegation playbook; others are concise)
    delegation.ts             syncDelegationContext() — auto-injects delegation context
                              into every manager's system prompt.
                              Uses VITE_CLIPBOARD_ROOT env var (or hardcoded default)
                              to resolve the delegate.py path portably.
  pages/
    Dashboard.tsx             Unified high-level overview of the business
    Agents.tsx                Agent grid, Add Agent button, pause/delete/approve,
                              budget indicator, CEO badge, skeleton loading
    AgentDetail.tsx           Per-agent detail — see "AgentDetail Page" below
    OrgChart.tsx              Interactive org chart with drag-to-reparent + delegate chips
    Tasks.tsx                 Tell-your-CEO composer (Mode A default) + direct send (Mode B),
                              merged recent-runs feed from ALL agents
    Activity.tsx              Audit log feed with friendly labels and action filter
    Spending.tsx              Token/cost breakdown per agent, subscription-aware budget column,
                              "Agents at limit" summary
    Skills.tsx                Skills library: list/create/import/scan/edit/delete
  components/
    AddAgentDialog.tsx        Create agent modal: 10 templates, adapter selector, auth toggle
    CompanySwitcher.tsx       Header dropdown: switch businesses, create new business
    StatusBadge.tsx           Unified status pill (agent + run statuses) with pulse for "Working"
    EmptyState.tsx            Reusable empty state block (icon + heading + subtext + CTA)
    Skeleton.tsx              Shimmer primitive + AgentCardSkeleton + RunRowSkeleton
scripts/
  delegate.py                 Agent-to-agent delegation (CEO uses this)
  memory-writer.py            Post-run memory summariser (called by heartbeat hook)
  delegation_audit.log        Auto-created when delegations are made
skills/
  clipboard-core/             Core Paperclip-API skill, renamed from "paperclip"
  clipboard-create-agent/     Agent creation skill, renamed from "paperclip-create-agent"
  clipboard-memory/           Session-memory read/use instructions (injected when
                              memory is enabled on an agent)
  para-memory-files/          PARA-style memory files skill (untouched)
```

---

## The 7 Tabs

### Dashboard
High-level business overview — agent roster + status, month spend, pending
approvals, 14-day run activity, success rate, spending by agent, recent
activity + failures. Entry page for operators.

### Agents
- Grid of all agents with status badge, CEO badge (if applicable), model, last-active, working directory
- Sorted by creation date — pausing/resuming no longer jumps cards
- Clicking a card opens AgentDetail
- Add Agent button opens dialog with 10 role templates + custom option
- Each card has context-sensitive footer action:
  - **Pending approval** → green Approve button
  - **Paused** → Resume
  - **Active / Idle / Working / Error** → Pause
  - Delete is always present
- **Budget indicator** at the bottom of the card — thin green/amber/red bar + optional warning label. Hidden for subscription agents (they don't accumulate `costCents`).
- **Skeleton placeholders** shown while the agents list loads (3 cards)
- Empty state: UserPlus icon + "No agents yet" + "Add agent" CTA

### Org
- Visual org chart tree (CEO at top, branches down)
- Drag any agent card onto another to change who they report to (cycle prevention enforced)
- Drop on background to remove a manager (become root)
- Click any card → "Assign task" modal for that agent
- Small arrow chips inside manager cards → "Delegate task" modal
- On every load and every drag-drop, `syncDelegationContext()` runs automatically, injecting each manager's direct reports + `delegate.py` path + instructions into their system prompt
- Loading state: centered spinner + "Loading org chart…"
- Compact `StatusBadge` dot on each card (same palette as the full pills)

### Tasks
- **Mode A — "Tell your CEO"** (default): prominent composer, routes directly to the CEO agent via `POST /agents/:id/wakeup`. Has an "Ask for a plan before starting" checkbox that prepends a pre-approval prompt. Shows an amber warning if no CEO agent exists in the active company.
- **Mode B — "Send directly to an agent"**: original composer (agent dropdown + prompt + Send). Reached via a muted link under Mode A. Always returns to Mode A on page load.
- Recent tasks feed: merged runs from ALL agents, sorted by date, unified StatusBadge on each row
- Skeleton placeholders (3 rows) while the feed loads
- Empty state: ListChecks icon + "No tasks yet" (no CTA — the composer is already above)

### Skills
- Grid of every skill in the active company's library
- **New skill** — inline SKILL.md editor with a template
- **Import** — paste a GitHub URL, skills.sh link, or local path
- **Scan my projects** — auto-discovers SKILL.md files in connected project workspaces
- Click any skill card → view/edit SKILL.md, see which agents use it, delete
- Empty state: BookOpen icon + "New skill" CTA
- Current roster: `clipboard-core`, `clipboard-create-agent`, `clipboard-memory`, `para-memory-files` (the three former `paperclip-*` slugs were renamed or deleted — see "Skills library cleanup" below)

### Activity
- Audit log from Paperclip's `/companies/:id/activity` endpoint
- Friendly action labels (e.g. `heartbeat.completed` → "Task completed")
- Filter dropdown by action type
- Filter-matches-nothing state keeps a small dashed box; the true empty state (no events at all) uses Activity pulse icon + "Nothing yet"

### Spending
- Summary cards: total tokens, total runs, API spend, **Agents at limit** (red/highlighted if any metered agent is auto-paused by budget)
- Per-agent table: input/cached/output tokens, subscription vs API run counts, real $, **Budget column** that shows `$X / $Y` for metered agents or "Subscription" for subscription agents

---

## Company Switcher (Multi-Business)

Header dropdown to the right of the Clipboard logo.
- Lists every company in the Paperclip instance
- Check mark on the active one
- **"+ New business"** opens a create dialog (name + optional description)
- Active company ID persisted in `localStorage` (`clipboard.activeCompanyId`)
- Each business has completely separate agents, org chart, tasks, skills, and activity

Implemented in: `ui/src/lib/company.ts` + `ui/src/components/CompanySwitcher.tsx`

---

## AgentDetail Page (`/agents/:id`)

Sections, top to bottom:

- **Header** — name, title, CEO badge (if applicable), StatusBadge, last-active, Edit / Approve / Pause or Resume / Delete buttons
- **Send a task** — textarea + Send button (wakeupAgent)
- **Recent tasks** — expandable run cards with StatusBadge, summary, tokens, cost
- **Role** — capabilities text
- **Personality & style** — persona text
- **Skills** — toggle list of every skill available for this agent. Company-managed skills are toggleable; required/user-installed skills are locked. Toggling saves immediately via `POST /agents/:id/skills/sync`
- **Memory** — opt-in toggle. Disabled unless the agent has a `cwd`. When enabled: **View memory** opens a modal with the current `memory.md` content; **Clear memory** wipes the file. See "Memory system" below.
- **Budget** — `$` input for `budgetMonthlyCents`. For **metered agents** (API-key auth) shows the full progress bar (green → amber at 80% → red at 100%) + "Approaching monthly limit" warning at ≥80% + auto-pause banner at 100%. For **subscription agents** shows a blue info block explaining "Subscription — no dollar cap" and makes the input advisory (applies automatically if the agent switches to API-key auth later)
- **Wake conditions** — toggle "Wake on a schedule" + interval dropdown (30s, 5m, 15m, 30m, 1h, 4h, 12h, 24h). Plus an info block: "Always on — this agent also wakes automatically when a task is assigned." No fake event-trigger checkboxes — see "Verified constraints" below.
- **Configuration panel** — model, cwd, adapter, created date

---

## Agent System Prompt Structure

Every agent created through Clipboard gets this `promptTemplate` in `adapterConfig`:

```handlebars
You are {{agent.name}}{{#agent.title}}, {{agent.title}}{{/agent.title}}.

ROLE
{{agent.capabilities}}

HOW YOU BEHAVE
{{agent.metadata.persona}}

{{#agent.metadata.delegationContext}}
{{agent.metadata.delegationContext}}

{{/agent.metadata.delegationContext}}
Follow the task instructions that follow.
```

- `agent.capabilities` — role description
- `agent.metadata.persona` — personality/style text
- `agent.metadata.delegationContext` — auto-generated by `syncDelegationContext()` on org changes; contains direct-reports list, `delegate.py` path, command usage, and examples

The CEO agent template's `capabilities` field contains a full **4-step delegation playbook**
(ASSESS → PLAN → DELEGATE → REPORT BACK) with clear rules: coordinate, don't execute; only delegate to direct reports; flag missing skills to the owner.

---

## Tell-Your-CEO Flow (core product experience)

1. Owner types a goal into the Tasks tab → "Send to CEO →"
2. UI finds the CEO agent via `findCeoAgent(agents)` (matches `role === "ceo"` OR title contains "chief executive")
3. `POST /agents/:ceoId/wakeup` with `wakeReason: "Owner directive via Tell your CEO"`
4. CEO runs, reads its 4-step playbook + injected delegation context
5. CEO invokes `python3 <delegate.py path> --from "CEO" --to "<Report>" --task "<ctx>"` for each subtask
6. Reports execute their work; CEO summarizes back to owner

Optional: checkbox "Ask for a plan before starting" prepends
`"Before delegating any work, show me your delegation plan and wait for my approval."`
to the prompt, so the CEO replies with its plan instead of immediately delegating.

---

## Memory System (opt-in per agent)

**Purpose:** for agents that don't have their own memory (unlike Iris, who has
AIOS). After every successful run, Clipboard asks the `claude` CLI to summarize
the run in 3–5 bullets and appends it to `{cwd}/memory.md`. On the next run,
the `clipboard-memory` skill injects instructions telling the agent to read
`memory.md` first.

### Pieces

- **`scripts/memory-writer.py`** — standalone, resilient Python script. Accepts `--agent-id --run-id --agent-name --cwd`. Fetches the run transcript from `/api/heartbeat-runs/:id`, calls `claude -p <prompt>` with a concise summarize prompt, appends a timestamped entry to `memory.md`. If the file exceeds 8000 words, compresses entries older than 30 days into `## Archive — YYYY-MM` sections. Every error exits 0 and logs to stderr — **never blocks or fails a run.**
- **`skills/clipboard-memory/SKILL.md`** — YAML-frontmatter skill instructing the agent to read `memory.md` at session start, not repeat recorded work, cite past decisions, respect the archive, and not edit the file themselves.
- **Post-run hook in `server/src/services/heartbeat.ts`** — two additive helpers (`isMemoryEnabled`, `triggerMemoryWriter`) plus a 13-line block right after `finalizeAgentStatus(agent.id, outcome)`. Spawns the Python script detached/unref'd. Only fires when `outcome === "succeeded"` AND `agent.metadata.memory_enabled === true` AND the agent has a `cwd`.
- **Two additive backend routes** in `server/src/routes/agents.ts`:
  - `GET /api/agents/:id/memory` → `{ path, exists, content }`
  - `DELETE /api/agents/:id/memory` → wipes `{cwd}/memory.md`
- **UI Memory section on AgentDetail** — toggle flips `metadata.memory_enabled`, auto-creates the `clipboard-memory` skill in the company library if missing, adds it to the agent's `desiredSkills`, and offers View/Clear buttons.

### Verified end-to-end

Tested on CTO with a throwaway cwd. After one successful run, a properly-formatted `memory.md` appeared with a timestamped bullet summary. The hook fires reliably and the script handles error paths cleanly.

---

## Budget Caps

Per-agent monthly budgets with UI everywhere: AgentDetail (input + progress
bar + auto-pause banner), Agents grid (thin coloured bar + warning), Spending
(Budget column + "Agents at limit" stat).

### The subscription gotcha — important

Paperclip writes `costCents = 0` for `billingType === "subscription_included"`
runs. Since `spentMonthlyCents` is `SUM(costCents)`, **subscription agents
never accumulate spend** and their budget would sit at 0% forever. The UI
handles this honestly:

- `isMeteredAgent(agent)` in `lib/types.ts` returns true if the agent has `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY` in `adapterConfig.env`.
- **AgentDetail Budget section** — subscription agents see a blue info block ("Subscription — no dollar cap…") instead of the progress bar. Input stays visible, labelled "(inactive while on subscription)" with a note that any cap activates automatically if you switch to API-key auth.
- **Agents grid BudgetBar** — hidden entirely for subscription agents.
- **Spending table Budget column** — shows "Subscription" in muted text for subscription agents; real `$X / $Y` only for metered ones.
- **Agents-at-limit count** — only counts metered agents that are auto-paused.

---

## Visual Polish

Three unified components created this sprint:

- **`StatusBadge`** — one source of truth for every status chip. Maps `running` → "Working" (blue + CSS pulse), `idle`/`active` → "Idle" (gray), `paused` → "Paused" (amber), `pending_approval` → "Pending approval" (purple), `error` → "Error" (red), and run statuses similarly. `compact` prop for tight layouts (org chart cards) renders just a tinted dot.
- **`EmptyState`** — reusable block with icon + heading + description + optional CTA, used on all four primary tabs.
- **`Skeleton`** — shimmer primitive plus `AgentCardSkeleton` and `RunRowSkeleton` matching the real content's geometry.

CSS animations (in `ui/src/index.css`):

- `clipboard-shimmer` — 1.5s linear gradient sweep for skeletons
- `clipboard-status-pulse` — 1.8s opacity pulse for "Working" badges

Color tones: gray / blue / amber / purple / red / green — all `color/10` backgrounds with `color/30` borders for light tinting that works in both light and dark themes.

---

## Backend Extensions

All additive — no core Paperclip logic modified. Each block is clearly commented.

### `server/src/routes/agents.ts`
- `GET /agents/:id/memory` — read `{cwd}/memory.md`
- `DELETE /agents/:id/memory` — wipe `{cwd}/memory.md`

### `server/src/services/heartbeat.ts`
- Module-level helpers `isMemoryEnabled` + `triggerMemoryWriter`
- 13-line post-run hook block after `finalizeAgentStatus`

### `server/src/routes/company-skills.ts`
- **`PATCH /companies/:companyId/skills/:skillId`** — rename a skill (update `name` and/or `slug`). Validates slug regex `/^[a-z0-9-]+$/`, checks for 409 slug conflicts in the same company, re-derives the canonical `key` by swapping the trailing path segment (since all key formats end in `/slug`), logs a `company.skill_renamed` activity entry.

---

## Skills Library Cleanup

**State:** the three upstream-Paperclip bundled skills (`paperclip`,
`paperclip-create-agent`, `paperclip-create-plugin`) have been renamed/removed:

- `skills/paperclip-create-plugin/` — **deleted**
- `skills/paperclip/` → **renamed to `skills/clipboard-core/`** (display name "Clipboard Core")
- `skills/paperclip-create-agent/` → **renamed to `skills/clipboard-create-agent/`** (display name "Clipboard — Create Agent")

**Important:** the SKILL.md frontmatters in the two renamed directories now
contain explicit `slug:` + pretty `name:` fields. The server's reconciler
(`ensureBundledSkills` in `server/src/services/company-skills.ts`) scans
`skills/` on every `GET /skills` call and upserts by key; the explicit `slug:`
keeps the scanner-derived slug consistent with the directory name so renames
are durable.

**If you rename bundled skills in the future**, always update the frontmatter
to match:

```yaml
---
slug: my-new-slug
name: My Pretty Display Name
description: ...
---
```

Without the explicit `slug:`, the scanner derives it from the `name:` field
which will create duplicate rows every time.

---

## Verified Constraints (findings from testing)

1. **Subscription runs have `costCents = 0`.** Documented above under Budget Caps. UI treats subscription agents differently everywhere budget appears.
2. **Event triggers (`mention`, `comment`, `status_change`, `dependency_resolved`) have no backend dispatch.** Grepped the server — no code reads `runtimeConfig.triggers`. Only `issue_assigned` wakes are hardwired (via `queueIssueAssignmentWakeup`) and fire regardless of any opt-in flag. The Wake Conditions UI was stripped of the fake checkboxes and now shows only the real scheduled-wake toggle plus a truthful "Always on — wakes when a task is assigned" info block.
3. **`ensureBundledSkills` runs on every `GET /skills`.** It reads `skills/` on disk and upserts by derived key. Keep this in mind when mutating skills via API — if the DB state disagrees with frontmatter, the scan will re-create duplicates on the next read.
4. **Memory hook fires reliably** but the `claude` CLI call takes ~20–60s to produce a summary. The post-run hook's `spawn` is detached and unref'd so heartbeats never block waiting for it.

---

## Current Agent Roster (Iris company)

Company ID: `de3f0b6d-4be7-4d3c-8eb8-8e24a6b6da47`

| Name | Role | Status | Model | Reports To | CWD |
|------|------|--------|-------|-----------|-----|
| CEO | ceo | idle | claude-opus-4-7 | — | `~/Downloads/AIOS` |
| CTO | cto | idle | claude-opus-4-7 | CEO | `~/Downloads/AIOS` |
| CMO | cmo | paused | claude-sonnet-4-6 | CEO | `~/Downloads/AIOS` |
| Iris | general | paused | claude-opus-4-7 | CEO | `~/Downloads/AIOS` |
| Echo | general | active | claude-sonnet-4-6 | Iris | `~/Downloads/AIOS` |

CEO has direct reports: CMO, CTO, Iris. Echo reports to Iris.

---

## Key API Endpoints

All prefixed with `http://localhost:3100/api`:

```
# Companies
GET    /companies                                    list companies
POST   /companies                                    create company

# Agents
GET    /companies/:id/agents                         list agents
POST   /companies/:id/agents                         create agent
GET    /agents/:id                                   get single agent
PATCH  /agents/:id                                   update agent (name, title, capabilities,
                                                       metadata, reportsTo, status,
                                                       runtimeConfig, adapterConfig,
                                                       budgetMonthlyCents)
DELETE /agents/:id                                   delete agent
POST   /agents/:id/wakeup                            send ad-hoc task
GET    /agents/:id/memory                            read {cwd}/memory.md          [Clipboard add]
DELETE /agents/:id/memory                            wipe {cwd}/memory.md          [Clipboard add]

# Runs
GET    /companies/:id/heartbeat-runs?agentId=X       list runs
GET    /heartbeat-runs/:id                           single run with stdout/stderr

# Activity / costs
GET    /companies/:id/activity                       audit log
GET    /companies/:id/costs/summary                  spendCents + utilizationPercent
GET    /companies/:id/costs/by-agent                 per-agent token/cost breakdown
GET    /companies/:id/adapters/:type/models          list models

# Skills
GET    /companies/:id/skills                         list library (auto-rescans on disk)
POST   /companies/:id/skills                         create skill
PATCH  /companies/:id/skills/:skillId                rename skill (name/slug)      [Clipboard add]
POST   /companies/:id/skills/import                  import (GitHub/skills.sh/path)
POST   /companies/:id/skills/scan-projects           scan workspaces for SKILL.md
GET    /companies/:id/skills/:skillId/files          read skill file
PATCH  /companies/:id/skills/:skillId/files          update file content
DELETE /companies/:id/skills/:skillId                delete skill

# Per-agent skill assignment
GET    /agents/:id/skills                            list + status for this agent
POST   /agents/:id/skills/sync                       set desiredSkills

# Approvals
GET    /companies/:id/approvals?status=pending       list pending approvals
POST   /approvals/:id/approve                        approve a pending hire
POST   /approvals/:id/reject                         reject a pending hire
```

---

## Known Issues / Future Work

1. **Event triggers** (`mention`, `comment`, `status_change`, `dependency_resolved`) require a backend dispatcher if we ever want them to actually work. Currently the UI doesn't pretend to support them.
2. **Subscription budget caps** don't enforce. If a real cap is needed for subscription-covered runs, the backend would need to track imputed spend (the `api-equivalent` cost Paperclip already computes) or we'd need to implement a token-count cap instead of a dollar cap.
3. **CEO/CTO/CMO** (created via old Paperclip hire flow) use Paperclip's managed instructions bundle instead of Clipboard's custom `promptTemplate`. The `delegationContext` sync still writes to their `metadata`, but to render it in the prompt they need their `promptTemplate` updated via an Edit on their detail page. Any agent created via Clipboard's Add Agent dialog is already wired correctly.
4. **`VITE_CLIPBOARD_ROOT`** — for portability to other machines, set this in `ui/.env.local` to the absolute path of the Clipboard repo. Falls back to `/Users/tiffanychau/Downloads/paperclip-claude` if not set.

---

## Files to Read for Deeper Context

- `ui/src/lib/types.ts` — all types + helpers (`isMeteredAgent`, `isCeoAgent`, `findCeoAgent`, run accessors)
- `ui/src/lib/delegation.ts` — delegation context generator + portable path resolution
- `ui/src/lib/templates.ts` — CEO template's 4-step delegation playbook
- `ui/src/components/StatusBadge.tsx` — status-pill mapping for agents + runs
- `ui/src/pages/AgentDetail.tsx` — most of the per-agent feature surface
- `scripts/memory-writer.py` — full memory summariser with inline docs
- `scripts/delegate.py` — delegation script with guardrails
- `server/src/routes/company-skills.ts` — includes new `PATCH /skills/:id` route
- `server/src/services/heartbeat.ts` — memory-writer hook at ~line 4115
- `server/src/routes/agents.ts` — memory read/clear routes near the company-agents list route
- `skills/clipboard-*/SKILL.md` — each has the new `slug: + name:` frontmatter pattern
