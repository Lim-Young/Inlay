---
name: inlay-improve-codebase-architecture
description: Multi-user (Inlay) enhanced architecture review. Finds deepening opportunities informed by the domain language in the Inlay public CONTEXT.md and the decisions in Workspaces/<ws>/adr/. Routes Context/ADR side effects through the `inlay` CLI. Use to improve architecture, find refactors, or make a codebase more testable and AI-navigable in an Inlay-managed repo.
---

# Inlay — Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. Aim for testability and AI-navigability. This is the **Inlay enhanced** fork: the analysis is identical to upstream, but Context/ADR side effects go through the `inlay` CLI.

## Glossary (architecture vocabulary)

Use these exactly (full definitions in [LANGUAGE.md](LANGUAGE.md)): **Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality**. Key principles: the **deletion test**; the interface is the test surface; one adapter = hypothetical seam, two = real seam. See [DEEPENING.md](DEEPENING.md).

## Session protocol (Inlay)

1. `inlay ws resolve` (if exit 10 → ask, then `inlay ws use <id>`).
2. Read the domain glossary from `Workspaces/<ws>/context/CONTEXT.md`; respect ADRs via `inlay adr list` / `inlay adr show <id>`. You may read your own staging doc; **never another user's staging**.

## Process

### 1. Explore
Read the public `CONTEXT.md` and relevant ADRs first. Then use the Explore agent to walk the codebase and note friction (bouncing between shallow modules, leaky seams, untested interfaces). Apply the **deletion test** to anything suspected shallow.

### 2. Present candidates as an HTML report
Write a self-contained HTML file to the OS temp dir (resolve `$TMPDIR`/`%TEMP%`, fall back to `/tmp`) as `architecture-review-<timestamp>.html` and open it. **This report is derived/disposable — it never lands in the repo** (unchanged from upstream; already Inlay-shaped). See [HTML-REPORT.md](HTML-REPORT.md). Use `CONTEXT.md` vocabulary for the domain and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture. Flag ADR conflicts only when friction is real. Ask which candidate to explore.

### 3. Grilling loop (side effects via CLI)
- **Naming a deepened module after a new concept?** Add the term to **your** Context staging doc via `inlay context add` (writes `users/<you>/CONTEXT.md`); never edit public `CONTEXT.md` directly. Glossary shape: [../inlay-grill-with-docs/CONTEXT-FORMAT.md](../inlay-grill-with-docs/CONTEXT-FORMAT.md).
- **User rejects a candidate with a load-bearing reason?** Offer an ADR via `inlay adr new --title "…"`, then write the body. Format: [../inlay-grill-with-docs/ADR-FORMAT.md](../inlay-grill-with-docs/ADR-FORMAT.md). After editing an existing ADR, `inlay adr touch <id>`.
- Alternative interfaces for the deepened module: see [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).
