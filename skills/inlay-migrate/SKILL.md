---
name: inlay-migrate
description: Migrates an existing mattpocock-style workflow repo (sequential docs/adr/NNNN-*.md + a single CONTEXT.md) into Inlay layout — converts ADRs to one-file id-named records, seeds the public Context doc, and emits an HTML migration report for review. Use when migrating or upgrading an existing repo to the Inlay multi-user workflow. Triggers: "migrate to Inlay", "convert ADRs", "upgrade workflow", "import existing CONTEXT.md".
---

# Inlay — Migrate (upgrade existing workflow → Inlay)

Seamlessly convert an existing mattpocock-style repo into Inlay layout. Like `improve-codebase-architecture`, this produces an **HTML migration report** to the OS temp dir for review before you commit.

## Steps

1. **Initialize** Inlay if needed: `inlay init` (scaffolds dirs, ignore rules, injects guidance into AGENTS.md/CLAUDE.md). Create or pick a target workspace: `inlay ws create <id> --title "<t>"` then `inlay ws use <id>`.
2. **Discover** the existing artifacts:
   - Sequential ADRs under `docs/adr/NNNN-*.md` (and any `CONTEXT-MAP.md` / nested `CONTEXT.md`).
   - The root `CONTEXT.md` glossary.
3. **Migrate ADRs** — for each `docs/adr/NNNN-slug.md`:
   - Run `inlay adr new --title "<the ADR's title>"` to mint a new id-named file with front-matter.
   - Copy the decision body across; preserve `Status`/`Considered Options`/`Consequences` if present.
   - If the old ADR referenced others by number, re-link by the **new ids** (record the old→new mapping).
4. **Migrate Context** — copy the existing `CONTEXT.md` glossary into the workspace **public** `context/CONTEXT.md` as the starting point (keep it a single document; do NOT shred into per-topic files). For `CONTEXT-MAP.md` multi-context repos, fold each context's `Language` into the public doc (or one workspace per context if the team prefers).
5. **Verify**: run `inlay adr verify` and fix any dangling references / id collisions.
6. **Emit an HTML migration report** to `<tmpdir>/inlay-migration-<timestamp>.html` and open it. The report MUST list:
   - Every ADR's **old path → new file name (+ new id)** mapping.
   - The Context migration summary (terms carried over, any that need human reconciliation).
   - **Skipped / needs-manual-attention** items (ambiguous titles, malformed front-matter, broken legacy references).
7. Ask the human to review the report before committing the migrated truth sources.

## Notes
- Do not delete the legacy `docs/adr/` or root `CONTEXT.md` automatically — leave that to the human after they accept the report.
- All writes go through the `inlay` CLI; never hand-craft ADR file names or edit the public `CONTEXT.md` outside the documented path.
