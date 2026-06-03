---
name: inlay-grill-with-docs
description: Multi-user (Inlay) enhanced grilling session. Challenges your plan against the existing domain model, sharpens terminology, and records decisions — but routes ALL side effects through the `inlay` CLI so multiple people produce ADRs and Context concurrently with zero conflicts. Use when stress-testing a plan against your project's language and documented decisions in an Inlay-managed repo.
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies one-by-one. For each question, provide your recommended answer. Ask questions one at a time, waiting for feedback before continuing. If a question can be answered by exploring the codebase, explore instead.

</what-to-do>

<inlay-integration>

This is the **Inlay enhanced** fork of `grill-with-docs`. The thinking is identical; the **side effects are routed through the `inlay` CLI** so they are conflict-free and evidence-driven.

### Before you start (session protocol)
1. Run `inlay ws resolve`. If it exits 10, ask me which workspace and run `inlay ws use <id>`.
2. Do not record anything until you have a successful resolve/use in this session.

### Reading the domain
- Read the team glossary from `Workspaces/<ws>/context/CONTEXT.md` (public, committed).
- You MAY read your own staging `Workspaces/<ws>/context/users/<you>/CONTEXT.md`. **Do NOT read other users' staging docs.**
- ADRs live in `Workspaces/<ws>/adr/` (one file per ADR). List with `inlay adr list`, read with `inlay adr show <id>`.

### Sharpening terminology → write to YOUR staging doc (never the public file)
- When a term is resolved, capture it in **your own** Context staging doc. Open/initialize it with `inlay context add` (writes `users/<you>/CONTEXT.md`).
- Use the glossary shape in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md): a `## Language` section, one tight definition per term, synonyms under `_Avoid_`. Glossary only — no implementation details.
- **Never edit the public `CONTEXT.md` directly** (the CLI blocks it, exit 40). Consensus happens later via `/inlay-context-aggregate`.

### Recording decisions → create ADRs via the CLI
- Offer an ADR only when all three hold: hard to reverse, surprising without context, the result of a real trade-off (see [ADR-FORMAT.md](./ADR-FORMAT.md)).
- Create it with `inlay adr new --title "<short decision>"` — the CLI assigns a collision-free id, file name, and front-matter (`createdBy` = `inlay whoami`). Then write the 1–3 sentence body into the generated file.
- If you edit an existing ADR, run `inlay adr touch <id>` afterward to record yourself in `modifiedBy`.

### Before you hand back
- Run `inlay adr verify` and report the result (this phase has no git hook to catch problems).

</inlay-integration>
