---
name: inlay-context-aggregate
description: Aggregates and promotes Inlay Context terms — LLM-merges the current user's staging glossary into the public CONTEXT.md, surfaces conflicts with existing terms for human decision, and resets the staging doc after promotion (reads only public + own staging, never another user's). Use when promoting drafted terminology into the team's shared glossary or reconciling glossary conflicts in an Inlay-managed repo. Triggers: "aggregate context", "promote my terms", "merge glossary".
---

# Inlay — Context Aggregate (promote + reset)

This skill performs the **consensus step** for Context (design.md §5.2–§5.3). It is human-triggered and LLM-driven. The deterministic file writes go through the `inlay` CLI; the *merge judgment* is yours.

## Scope rule (critical)
Read **only**: the public `Workspaces/<ws>/context/CONTEXT.md` and **your own** `users/<you>/CONTEXT.md`. **Never read another user's staging doc.** Cross-user coordination happens at the public layer, not by reading peers' drafts.

## Steps

1. **Resolve workspace**: `inlay ws resolve` (if exit 10 → `inlay ws use <id>`). Identify yourself with `inlay whoami`.
2. **Load** the public `CONTEXT.md` and your own staging doc (`inlay context read --json` returns both paths/contents — and only those two).
3. **Merge intelligently** (this is why it's a skill, not a CLI concat):
   - De-duplicate synonyms; group terms under `## Language` subheadings.
   - For each of your staged terms, compare against the public glossary.
     - New term → add it to the public glossary.
     - **Same term, different definition than public → STOP and surface the conflict.** Present both definitions and ask the human to decide. Do not silently overwrite.
   - Keep definitions tight (1–2 sentences), glossary-only, synonyms under `_Avoid_` (see [../inlay-grill-with-docs/CONTEXT-FORMAT.md](../inlay-grill-with-docs/CONTEXT-FORMAT.md)).
4. **Write** the merged result into the public `CONTEXT.md`. (It is a committed truth source — the human-reviewed merge makes committing it sound.)
5. **Reset** your staging doc with `inlay context reset` — its promoted content now lives in public. **Keep** any terms that did not reach consensus (re-add them after reset if needed).
6. Report what was promoted, what was reset, and any conflicts left for the human.

## Notes
- The public `CONTEXT.md` is the only file written here, and only via this promotion path.
- This is the **only** sanctioned way to change the public glossary; agents must not edit it directly (the CLI blocks `inlay context add --scope shared`, exit 40).
