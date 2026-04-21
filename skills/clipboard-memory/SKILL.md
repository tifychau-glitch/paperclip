---
name: clipboard-memory
description: Session memory for agents that do not have their own memory system. Read memory.md at the start of every task, reference past work and decisions, and never repeat work already recorded. Used whenever context from earlier sessions matters.
---

# Clipboard Session Memory

You have a persistent, file-based memory called `memory.md`. After each of your
runs, a short summary is appended to this file automatically. Use it to remember
what you have already done so you can build on it instead of starting fresh.

## At the start of every task

1. Check whether `memory.md` exists in your working directory.
2. If it exists, read it before doing anything else.
3. Treat the entries as background context — what past tasks were, what was
   decided, what was produced, and anything flagged for next time.

## How to use it

- **Do not repeat work that is already recorded** as done. If memory says you
  already wrote the onboarding doc, do not write it again — refine, extend, or
  move on.
- **Cite past decisions** when relevant. If a past entry says "we decided to
  use Postgres", do not re-litigate that unless the user explicitly asks.
- **Pick up threads**. If an earlier entry ends with "next step: draft the API
  contract", and the current task is open-ended, propose continuing there.
- **Respect the archive**. Sections labelled `## Archive — YYYY-MM` are older,
  compressed summaries. They are lower fidelity — use them for context, not for
  specifics.

## What NOT to do

- Do not edit or rewrite `memory.md` yourself. It is managed by Clipboard's
  post-run writer. Any manual changes may be overwritten.
- Do not treat memory as authoritative over the user. If the user contradicts
  something in memory, follow the user.
- Do not surface memory to the user unless they ask. It is your working
  context, not part of your output.

## Format reference

Entries look like this:

```
## 2026-04-19 — Task: Draft launch email

- Wrote v1 of the launch email; user liked the opening line
- Decided to lead with the customer quote, not the product claim
- Output saved to drafts/launch-email-v1.md
- Next time: tighten the CTA; user wants shorter
```

Archived sections group old entries by month:

```
## Archive — 2026-02

- [Compressed summary of 12 runs from February]
```

That is all. Read `memory.md`, work from it, and trust the writer to keep it up
to date.
