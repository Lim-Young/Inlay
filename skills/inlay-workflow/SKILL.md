---
name: inlay-workflow
description: >-
  Explains Inlay's workflow and guiding philosophy (ADR + Context, conflict-free,
  evidence-driven), routes to the right Inlay skill, and flags when to remind the
  user to use Inlay properly. Use when starting work in an Inlay-managed repo (one
  with a `Workspaces/` directory or an Inlay block in AGENTS.md/CLAUDE.md), when
  deciding how to capture a decision or terminology, or when about to bypass Inlay
  — hand-editing an ADR, writing the public CONTEXT.md directly, archiving without
  a resolved workspace, or committing without running verify. For exact commands
  see `inlay-cli-guide`. Triggers: "how does Inlay work", "should this be an ADR",
  "use Inlay properly".
---

# Inlay — workflow & guiding philosophy

Inlay turns the personal "grill → document" habit into a **multi-user, conflict-free** pipeline for the two highest-value artifacts: **ADRs** and **Context** (the team glossary). Specs are OpenSpec's job; Inlay owns ADR + Context only.

## First principle (everything follows from this)

> **Any single file that is shared and concurrently modified by multiple people is a source of conflict.**

So Inlay holds three invariants — internalize them; most "reminders" below are just defending one of them:

1. **One entity, one file (append-only friendly).** Workspaces, users, ADRs each get their own file → concurrent output never collides. No global sequential numbering.
2. **Derived is disposable.** Indexes, the aggregated public glossary view, dashboards — rebuildable, never the source of truth, excluded from VCS.
3. **Evidence-driven.** State claims come from a real `inlay` CLI call in this session, not memory.

## The loop

```
   Think (skills)            Record (via CLI)            Aggregate            Review
 grill-with-docs    ──▶  inlay adr new / touch    ──▶  /inlay-context-  ──▶  inlay dashboard
 improve-codebase-…      inlay context add (own)       aggregate             inlay adr verify
```

You and the agent *think* with a skill; side effects *land* through the CLI as conflict-free truth sources; mature terms are *aggregated* into team consensus; everything is *reviewed* read-only.

## Which skill for what

| Situation | Use |
|---|---|
| Align on a plan/design; capture decisions & terms as you go | `/inlay-grill-with-docs` |
| Find refactors / deepening opportunities | `/inlay-improve-codebase-architecture` |
| Promote your staged terms into the public glossary | `/inlay-context-aggregate` |
| Convert an existing mattpocock-style repo to Inlay | `/inlay-migrate` |
| Need the exact command / flag / exit code | `inlay-cli-guide` |

## Guardrails — when to nudge the user

Surface a short, specific reminder (then offer the correct path) whenever you notice any of these. Be helpful, not preachy — one line, with the fix.

- **About to hand-write an ADR file or its name/front-matter** → "Let me create this with `inlay adr new` so it gets a conflict-free id and proper front-matter."
- **About to edit the public `CONTEXT.md` directly** → "The public glossary is consensus-only; I'll draft this in your staging doc via `inlay context add`, and we can promote it with `/inlay-context-aggregate` when it's settled." (Direct writes are blocked anyway — exit 40.)
- **Archiving with no resolved workspace** (or relying on a remembered one) → "No workspace is confirmed this session; running `inlay ws resolve` first." (exit 10 enforces this.)
- **A real, hard-to-reverse decision is being made but not recorded** → "This is a load-bearing decision — want me to capture it as an ADR?"
- **Reading terminology across teammates** → only read the public `CONTEXT.md` + your own staging; never another user's staging.
- **About to commit** → "Running `inlay adr verify` and checking no derived files (`_system/`, `*.index.*`) are staged."
- **Trying to manage specs through Inlay** → "Specs live in OpenSpec, not Inlay — Inlay tracks the *decision* (ADR) and *language* (Context) behind them."

## What earns an ADR (don't over-record)

All three must hold: **hard to reverse**, **surprising without context**, and **the result of a real trade-off**. Otherwise skip it — a glossary term or a code comment is enough.

## Division of responsibility

- **Inlay** → ADRs (`adr/`), Context glossary (`context/`), workspaces, users, the guards that keep them conflict-free.
- **OpenSpec** → specs / requirements / change lifecycle.
- They reference each other by text; Inlay never reads or writes OpenSpec files.
