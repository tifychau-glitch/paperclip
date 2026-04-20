# Clipboard — Project Handoff

## What This Is

**Clipboard** is a custom mission-control UI for running multiple Claude Code agents, built on top of the open-source [Paperclip](https://github.com/paperclipai/paperclip) backend. Tiffany wanted a clean, simple dashboard to manage AI agents — Paperclip's backend is excellent (handles Claude CLI execution, session management, cost tracking, scheduling) but its original UI is too complex. So we replaced the UI entirely while keeping the backend untouched.

There is also a second project, **Paperclip Copy**, which is the original Paperclip UI running unmodified on port 3101 — kept for reference.

---

## Repo Locations

| Project | Path | Port | Instance ID |
|---------|------|------|-------------|
| Clipboard (our custom UI) | `~/Downloads/paperclip-claude/` | 3100 (backend + UI via Vite middleware) | `default` |
| Paperclip Copy (original UI) | `~/Downloads/paperclip-copy/` | 3101 | `paperclip-copy` |
| AIOS (Iris accountability system) | `~/Downloads/AIOS/` | — | n/a |

### How to start Clipboard
```bash
cd ~/Downloads/paperclip-claude && pnpm dev
# Open http://localhost:3100
```

### How to start Paperclip Copy
```bash
cd ~/Downloads/paperclip-copy && PORT=3101 PAPERCLIP_INSTANCE_ID=paperclip-copy pnpm dev
```

---

## Architecture

```
Browser (localhost:5173)
  └─ React + Vite + Tailwind (our custom UI)
       └─ fetch /api/* → proxied to localhost:3100
            └─ Paperclip Node server (unmodified)
                 ├─ Embedded PostgreSQL (~/.paperclip/instances/default/)
                 ├─ Heartbeat scheduler
                 └─ claude_local adapter → claude CLI → Claude subscription or API key
```

The UI calls Paperclip's existing REST API — we just show less and lay it out differently. The server, DB, and adapter layer are never touched.

---

## UI File Structure

```
ui/src/
  main.tsx                    React entry point (QueryClient, BrowserRouter)
  App.tsx                     Layout, 6-tab nav + CompanySwitcher, routes
  lib/
    api.ts                    All fetch wrappers for Paperclip REST API
    types.ts                  TypeScript types + helper functions (runTokens, runBilling, etc.)
    format.ts                 formatTokens, formatUsd, formatDuration, formatRelativeTime
    company.ts                useDefaultCompany(), useCompanies(), useActiveCompanyId(),
                              setActiveCompanyId() — persists selected company to localStorage
    templates.ts              10 built-in agent role templates (CEO, CTO, CMO, etc.)
    delegation.ts             syncDelegationContext() — auto-injects delegation instructions into manager agents
  pages/
    Agents.tsx                Agent grid, Add Agent button, pause/delete/approve actions
                              — sorted by createdAt (stable, no position jumps on pause/resume)
    AgentDetail.tsx           Per-agent detail: send task, run history, edit, heartbeat schedule toggle,
                              Skills section with per-agent toggles, Approve button for pending agents
    OrgChart.tsx              Interactive org chart with drag-to-reparent and click-to-assign
    Tasks.tsx                 Global task send (all agents) + merged recent runs feed
    Activity.tsx              Audit log feed with friendly labels and action filter
    Spending.tsx              Token/cost breakdown per agent
    Skills.tsx                Skills library: list/create/import/scan/edit/delete company skills
  components/
    AddAgentDialog.tsx        Create agent modal: 10 templates, adapter selector, auth toggle
    CompanySwitcher.tsx       Header dropdown: switch between businesses, create new business
  reference-paperclip/        Original Paperclip UI archived here — DO NOT DELETE
scripts/
  delegate.py                 Agent-to-agent delegation script (used by agents themselves)
  delegation_audit.log        Auto-created when delegations are made
```

---

## The 6 Tabs

### Agents
- Grid of all agents with status badge, model, last-active, working directory
- Sorted by creation date (stable — pausing/resuming no longer jumps cards around)
- Clicking a card opens AgentDetail
- Add Agent button opens dialog with 10 role templates + custom option
- Each card has context-sensitive footer action:
  - **Pending approval** → green "Approve" button (one click activates the agent)
  - **Paused** → Resume
  - **Active/idle** → Pause
  - Plus Delete (always)

### Org
- Visual org chart tree (CEO at top, branches down)
- **Drag any agent card onto another** to reassign who they report to (cycle prevention enforced)
- **Drop on background** to remove a manager (make root)
- **Click any card** → "Assign task" modal for that agent
- **Small arrow chips** inside manager cards → "Delegate task" modal (prepends delegation context to the prompt)
- On every load and on every drag-drop, `syncDelegationContext()` runs automatically, injecting each manager's direct reports and `delegate.py` instructions into their system prompt

### Tasks
- Global: pick any agent from dropdown + prompt + Send
- Below: merged recent-runs feed from ALL agents, sorted by date
- Each run row: status badge, agent name, summary, duration, tokens, cost label (shows "Subscription" or "$X.XX")

### Skills
- Grid of every skill in the active company's library
- **New skill** — inline SKILL.md editor with a template
- **Import** — paste a GitHub URL, skills.sh link, or local path (e.g. `/Users/tiffanychau/Downloads/AIOS/.claude/skills/research`)
- **Scan my projects** — auto-discovers SKILL.md files in connected project workspaces
- Click any skill card → view/edit SKILL.md, see which agents use it, delete
- To load AIOS skills: Skills → Import → paste local path to any AIOS skill folder

### Activity
- Audit log from Paperclip's `/companies/:id/activity` endpoint
- Friendly action labels (e.g. "heartbeat.completed" → "Task completed")
- Filter dropdown by action type

### Spending
- 4 summary cards: total tokens, total runs, API spend, active agents
- Per-agent table: input / cached / output tokens, subscription runs vs API runs, real $ if any

---

## Company Switcher (Multi-Business)

The header has a dropdown to the right of the Clipboard logo showing the active business name.

- Click it → dropdown lists every company in the Paperclip instance
- Click a company → switches immediately; all tabs (Agents, Org, Skills, etc.) re-scope to that company
- **"+ New business"** at the bottom → dialog to create a new company (name + optional description)
- Active company ID is persisted in `localStorage` (`clipboard.activeCompanyId`), survives refresh
- Each business has completely separate agents, org chart, tasks, skills, and activity

Implemented in: `ui/src/lib/company.ts` + `ui/src/components/CompanySwitcher.tsx`

---

## AgentDetail Page (`/agents/:id`)

- Agent name, title, status badge, last-active
- **Edit button** → modal to update name, title, capabilities, persona, cwd
- **Approve / Pause / Resume / Delete** — context-sensitive, shows Approve (green) when status is `pending_approval`
- **Send a task** textarea (calls `POST /agents/:id/wakeup`)
- **Recent tasks** — run cards showing status, summary, tokens, cost; expandable for full output
- **Role** section — shows capabilities
- **Personality & style** — shows persona (if set)
- **Skills** section — toggle list of every skill available for this agent:
  - Company-managed skills: toggleable on/off
  - Required skills: shown with a lock icon (always on)
  - User-installed skills (`~/.claude/skills/`): shown as read-only
  - Toggling saves immediately via `POST /agents/:id/skills/sync`
  - "Manage library →" link navigates to the Skills tab
- **Configuration** panel — model, cwd, adapter, created date
- **Autonomous schedule** toggle — enables Paperclip's heartbeat scheduler so the agent wakes on a timer without human input; interval options from 15 min to 24 hours

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

- `agent.capabilities` — the role description set in the form
- `agent.metadata.persona` — the personality/style text
- `agent.metadata.delegationContext` — auto-generated by `syncDelegationContext()` whenever the org chart changes; contains the agent's direct reports list and `delegate.py` command

---

## Skills System

Paperclip has a full skills system in the backend. Clipboard now exposes it.

### How skills work end-to-end
1. Skills are stored per-company in the Paperclip DB
2. Each agent has `adapterConfig.paperclipSkillSync.desiredSkills` — an array of skill keys
3. At runtime, the `claude_local` adapter materializes desired skills into the prompt bundle before calling the Claude CLI
4. Skills can also come from `~/.claude/skills/` (user-installed, read-only in Clipboard)

### Relevant API endpoints
```
GET    /companies/:id/skills                        list company skill library
POST   /companies/:id/skills                        create a skill (name, slug, markdown)
POST   /companies/:id/skills/import                 import from GitHub URL / local path / skills.sh
POST   /companies/:id/skills/scan-projects          auto-scan connected workspaces for SKILL.md
GET    /companies/:id/skills/:skillId               skill detail + which agents use it
GET    /companies/:id/skills/:skillId/files         read SKILL.md (or any file in the skill)
PATCH  /companies/:id/skills/:skillId/files         update SKILL.md content
DELETE /companies/:id/skills/:skillId               delete a skill
GET    /agents/:id/skills                           list skills available + enabled for one agent
POST   /agents/:id/skills/sync                      set desiredSkills array for an agent
```

### Importing your AIOS skills
Go to Skills → Import → paste:
```
/Users/tiffanychau/Downloads/AIOS/.claude/skills
```
Or individual skill subdirectory paths. Then go to each agent's detail page and toggle the skills you want.

---

## Agent-to-Agent Delegation System

### The delegation script
`scripts/delegate.py` — agents can call this during a task run to dispatch work to their direct reports.

```bash
python3 /Users/tiffanychau/Downloads/paperclip-claude/scripts/delegate.py \
  --from "CEO" --to "CMO" --task "Write a product launch tweet thread"
```

**Guardrails enforced by the script:**
1. **Scope check** — `--from` must be a direct manager of `--to` (verified against live Paperclip API). Lateral and skip-level delegation is blocked.
2. **Loop guard** — tracks the delegation chain via `--chain`; refuses if the target is already in the chain
3. **Task cap** — max 5 delegations per manager per run (overridable via `DELEGATE_MAX_TASKS` env var)
4. **Paused block** — refuses to send to a paused agent
5. **Audit trail** — every successful delegation is appended to `scripts/delegation_audit.log`

Dry-run mode: add `--dry-run` to validate without sending.

### Auto-sync
`lib/delegation.ts` exports `syncDelegationContext(agents)`. It runs on:
- Every OrgChart page load
- After every drag-drop in the org chart

It reads the current `reportsTo` tree, generates delegation instructions for each manager, and PATCHes `metadata.delegationContext` — but only if the content actually changed (no-op writes avoided).

---

## Approvals System (Pending Agents)

Agents created via Paperclip's old hire flow land in `pending_approval` status and need explicit approval to activate. Clipboard now handles this.

**How it works:**
- On Agents page load, Clipboard fetches `GET /companies/:id/approvals?status=pending`
- It builds a map of `agentId → approvalId` from the `hire_agent` approval records
- Any agent card with `pending_approval` status shows a green **Approve** button instead of Pause
- Clicking Approve calls `POST /approvals/:approvalId/approve` → backend flips the agent to `idle`
- Same Approve button appears on the AgentDetail header

**The CTO situation (as of session):**
- CTO was created via original Paperclip UI when `requireBoardApprovalForNewAgents` was true
- That setting has since been turned off; all new agents created via Clipboard bypass approval
- CTO can be approved via the Approve button on their card, or deleted and recreated via Clipboard's Add Agent dialog

---

## Current Agent Roster

All agents live in company `de3f0b6d-4be7-4d3c-8eb8-8e24a6b6da47` ("Iris").

| Name | Role | Status | Model | Reports To | CWD |
|------|------|--------|-------|-----------|-----|
| CEO | ceo | paused | claude-opus-4-7 | — | — |
| CTO | cto | pending_approval | claude-opus-4-7 | CEO | — |
| CMO | cmo | idle | claude-sonnet-4-6 | CEO | — |
| Iris | general | idle | claude-opus-4-7 | CMO | `~/Downloads/AIOS` |
| Echo | general | idle | claude-sonnet-4-6 | — | `~/Downloads/AIOS` |

**Notes:**
- CEO is paused — test agent from early Paperclip exploration. Can be deleted; it has no important runs.
- CTO: approve via the green Approve button on its card, or delete and recreate.
- Iris and Echo have `cwd` pointing to `~/Downloads/AIOS` so they run with full access to AIOS skills, context, and scripts.
- Iris currently reports to CMO — may need reorganization. Use Org tab drag-and-drop.
- Echo has no manager — floating root; should probably report to Iris or CEO.
- CTO/CMO/CEO have no `cwd` set — they'll run in Paperclip's default directory. Set via Edit button if they need filesystem access.
- CEO/CTO/CMO were created via Paperclip's hire flow and use Paperclip's managed instructions bundle (not our custom `promptTemplate`). The `delegationContext` sync still writes to their `metadata`, but won't render in their prompt unless their `promptTemplate` is also updated via Edit.

---

## Key API Endpoints (Paperclip REST)

All prefixed with `http://localhost:3100/api`:

```
GET    /companies                                    list companies
POST   /companies                                    create company
GET    /companies/:id/agents                         list agents
POST   /companies/:id/agents                         create agent
GET    /agents/:id                                   get single agent
PATCH  /agents/:id                                   update agent (name, title, capabilities, metadata, reportsTo, status, runtimeConfig, adapterConfig)
DELETE /agents/:id                                   delete agent
POST   /agents/:id/wakeup                            send ad-hoc task (body: {source, reason, payload: {prompt}, forceFreshSession})
GET    /companies/:id/heartbeat-runs?agentId=X       list runs for agent
GET    /heartbeat-runs/:id                           single run with stdout/stderr
GET    /companies/:id/activity                       audit log
GET    /companies/:id/costs/summary                  {spendCents, budgetCents, utilizationPercent}
GET    /companies/:id/costs/by-agent                 per-agent token/cost breakdown
GET    /companies/:id/adapters/:type/models          list models for adapter type
GET    /companies/:id/skills                         list skill library
POST   /companies/:id/skills                         create skill
POST   /companies/:id/skills/import                  import skill (GitHub URL / local path)
POST   /companies/:id/skills/scan-projects           scan workspaces for SKILL.md files
GET    /companies/:id/skills/:skillId/files          read skill file (default: SKILL.md)
PATCH  /companies/:id/skills/:skillId/files          update skill file
DELETE /companies/:id/skills/:skillId                delete skill
GET    /agents/:id/skills                            list + status of skills for one agent
POST   /agents/:id/skills/sync                       set desiredSkills for an agent
GET    /companies/:id/approvals?status=pending        list pending approvals
POST   /approvals/:id/approve                        approve a pending agent hire
POST   /approvals/:id/reject                         reject a pending agent hire
```

---

## Add Agent Form — Supported Adapters

The form has an "AI engine" selector:
- **Claude** (`claude_local`) — uses `claude` CLI; subscription or API key auth
- **Gemini** (`gemini_local`) — uses `gemini` CLI; Google account or Gemini API key
- **OpenAI Codex** (`codex_local`) — uses `codex` CLI; needs OpenAI API key (ChatGPT Plus does NOT include API access)
- **OpenCode** (`opencode_local`) — open-source coding agent
- **Custom process** (`process`) — any shell command

The auth toggle and API key field update their labels to match the selected engine.

---

## Multi-Model / Multi-Machine Architecture Notes

For scaling beyond one machine:
- **Per-agent model selection**: assign cheaper models (Gemini, Sonnet, Ollama) to worker agents; reserve Opus for executive/decision-making agents
- **Subscription limits are per-account**, not per-machine — spreading agents across machines doesn't increase capacity under one subscription
- **`http` adapter pattern**: run a lightweight HTTP server on a remote machine that accepts a prompt and shells out to a local Claude/Gemini CLI; register it as an `http`-type agent in Clipboard
- **Free local models**: Ollama (runs Llama, Mistral, etc. locally, no subscription) can be wired via the `process` adapter for low-level tasks

---

## Known Issues / Pending Work

1. **CTO in `pending_approval`** — use the green Approve button on its agent card. Or delete and recreate.
2. **CEO is paused** — test agent. Can be deleted; no important runs.
3. **Iris reports to CMO** — may not be the intended structure. Reorganize via Org tab.
4. **Echo has no manager** — floating root; should report to Iris or CEO.
5. **CTO/CMO/CEO have no `cwd` set** — set via Edit button if they need filesystem access.
6. **CEO/CTO/CMO don't have the new `promptTemplate`** — they use Paperclip's managed instructions bundle instead. `delegationContext` still writes to their `metadata` but won't render in their prompt unless `promptTemplate` is also updated via Edit on their detail page.

---

## What "Proactive Agents" Looks Like End-to-End

1. Open CEO's detail page → turn on "Autonomous schedule" → set to "Every 1 hour"
2. CEO wakes each hour; their injected prompt includes their direct reports and `delegate.py` commands
3. CEO decides CTO should review a PR → calls: `python3 /path/to/delegate.py --from "CEO" --to "CTO" --task "Review PR #42 for security issues"`
4. `delegate.py` validates the chain, calls `POST /agents/CTO-id/wakeup`, logs the delegation
5. CTO wakes, sees "Task delegated by CEO", executes, finishes
6. All activity visible in the Activity and Tasks tabs

---

## Files to Read for Deeper Context

- `ui/src/lib/types.ts` — all TypeScript types including skill and approval types
- `ui/src/lib/company.ts` — active company store (localStorage + useSyncExternalStore)
- `ui/src/lib/delegation.ts` — delegation context generator
- `ui/src/pages/Skills.tsx` — Skills library page
- `ui/src/components/CompanySwitcher.tsx` — business switcher dropdown
- `scripts/delegate.py` — full delegation script with inline docs
- `packages/adapters/claude-local/src/server/execute.ts` — how Paperclip builds and sends prompts to Claude CLI
- `packages/shared/src/validators/agent.ts` — what fields can be PATCHed on an agent
