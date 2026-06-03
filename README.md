# Inlay

[![npm version](https://img.shields.io/npm/v/@lim-young/inlay.svg)](https://www.npmjs.com/package/@lim-young/inlay)
[![license](https://img.shields.io/npm/l/@lim-young/inlay.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@lim-young/inlay.svg)](https://nodejs.org)

**English** | [简体中文](./README.zh-CN.md)

**Inlay** is a collaboration pipeline for human + agent teams that manages the two most valuable engineering artifacts — **ADRs** (Architecture Decision Records) and **Context** (the team glossary / ubiquitous language) — so that many people can produce them asynchronously and concurrently with **zero merge conflicts**. It grows out of [mattpocock's skill workflow](https://github.com/mattpocock/skills) (`grill-with-docs`, `improve-codebase-architecture`) and extends it from a solo workflow into a team one.

> Specs are handled by [OpenSpec](https://github.com/Fission-AI/OpenSpec); Inlay **stays out of specs** and owns only ADR + Context.

---

## First Principle

> **Any single file that is shared and concurrently modified by multiple people is a source of conflict.**

Everything in Inlay follows from this:

- **One entity, one file (append-only friendly)** — workspaces, users, and ADRs each live in their own file, so concurrent output never collides (no global sequential numbering).
- **Derived is disposable** — indexes, aggregated views, and the dashboard can be rebuilt anytime and are **excluded from version control**.
- **Evidence-driven** — any claim an agent makes about state must come from a real `inlay` CLI call made in the current session (stamped with timestamp + sessionId), never from memory.

---

## Install

### CLI

```bash
npm install -g @lim-young/inlay
inlay --help
```

Requires Node.js ≥ 20, with no runtime dependencies. Try it without installing: `npx @lim-young/inlay <command>`.

### Skills (optional, for agents such as Claude Code)

Inlay ships 6 skills inside the npm package (see the **Skills** section below). Drop them into your agent's skills directory and you can invoke them in chat via slash commands like `/inlay-grill-with-docs`, `/inlay-context-aggregate`.

```bash
# After installing the CLI globally, the skills live in the global npm dir
SKILLS_SRC="$(npm root -g)/@lim-young/inlay/skills"

# Claude Code · project-level (shared with the repo, recommended)
mkdir -p .claude/skills && cp -r "$SKILLS_SRC"/* .claude/skills/

# Claude Code · user-level (available across all projects)
mkdir -p ~/.claude/skills && cp -r "$SKILLS_SRC"/* ~/.claude/skills/
```

> Windows PowerShell: `Copy-Item -Recurse "$(npm root -g)\@lim-young\inlay\skills\*" .claude\skills\`
> You can also skip the CLI and copy the `skills/` directory straight from the repo.

---

## Walkthrough

A worked example: three people collaborate on a hash calculator. The three users are `alice`, `bob`, and your own machine (`inlay whoami` picks up the OS username automatically).

### 1. Initialize the project

```bash
cd your-project
inlay init
```

`init` creates the `Workspaces/` skeleton, writes ignore rules (excluding derived files), and idempotently injects the **Inlay guidance block** into `AGENTS.md` and `CLAUDE.md` (if a file exists, only the marked block is replaced — everything else is untouched).

### 2. Confirm identity (auto-registers)

```bash
inlay whoami
# → resolves the current user (OS username) and auto-registers Workspaces/_users/<you>.json
inlay user list
```

> To act as a different identity (e.g. to simulate a teammate on one machine), set `INLAY_USER`:
> ```bash
> INLAY_USER=alice inlay whoami     # resolve and register alice
> ```

### 3. Create and enter a workspace

```bash
inlay ws create hashcalc --title "Hash Calculator"
inlay ws use hashcalc        # set the workspace for this session
inlay ws resolve             # confirm the current workspace (first step of the startup protocol)
```

### 4. Record an ADR

```bash
inlay adr new --title "Use Node crypto for hashing" --status accepted
# → creates Workspaces/hashcalc/adr/ADR-<date>-<id>-use-node-crypto-for-hashing.md
#   front-matter is filled in automatically: createdBy (= whoami), a random id (no global counter, conflict-free)
```

Then write 1–3 sentences (context / decision / why) into the generated file. Reference other ADRs by their id:

```bash
inlay adr new --title "Stream large files for hashing" --related <other-adr-id>
inlay adr touch <id>     # after editing an existing ADR, record yourself as a modifier (modifiedBy)
inlay adr list           # list all (keyed by id)
inlay adr verify         # check id uniqueness / reference validity / title mismatch (run before commit)
```

### 5. Draft terminology (write your own staging doc, conflict-free)

```bash
inlay context add        # open/initialize your own users/<you>/CONTEXT.md
```

Define terms in the `## Language` section of your staging doc (1–2 sentences each, synonyms under `_Avoid_`). **You can only write your own staging doc** — writing the public `CONTEXT.md` directly is blocked by a guard (exit 40).

```bash
inlay context read       # read "public CONTEXT.md + your own staging" (never another user's staging)
inlay context list       # list the public doc + each user's staging
```

### 6. Promote terms to team consensus

When your terms are settled, run the aggregate skill (`/inlay-context-aggregate` in your agent): it uses the LLM to merge your staged terms into the public `context/CONTEXT.md`, surfaces conflicts with existing terms for you to decide, and **resets your personal staging** after promotion.

### 7. Overview & health check

```bash
inlay dashboard          # generate a read-only HTML dashboard and open it in the browser (not committed)
inlay doctor             # health check: VCS detection + workspace consistency (orphan/broken) diagnostics
```

Done. All truth sources (`_registry/*`, `_users/*`, `adr/*`, `context/CONTEXT.md`, `context/users/*`) go into version control; derived files (`_system/`, `*.index.*`) are ignored automatically.

---

## Command Reference

```
inlay init                                initialize project (skeleton + ignore rules + inject AGENTS.md/CLAUDE.md)
inlay whoami                              resolve current user (auto-registers)
inlay user register|list|reindex          user registry (one file per user)
inlay ws create <id> --title <t>          create a workspace (one file per workspace)
inlay ws use <id> | resolve | list        switch / resolve / list workspaces
inlay ws remove <id> | reindex            remove / rebuild index
inlay adr new --title <t> [--status s]    create an ADR (random id + front-matter)
        [--supersedes a,b] [--related a,b]
inlay adr touch <id>                      record a modifier (modifiedBy)
inlay adr list [--status s] | show <id>   query ADRs
inlay adr verify                          verify (exit 20 on failure)
inlay context add [--scope user|shared]   write your own staging (--scope shared is blocked, exit 40)
inlay context list | read | reset         list / read (public + own) / reset your staging
inlay doctor                              environment & consistency diagnostics
inlay dashboard [--no-open] [--out <dir>] read-only dashboard (temporary HTML)

global: --json   machine-readable output (with data / status / ts / sessionId)
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 10 | No current workspace (run `ws use`/`resolve` first) |
| 11 | Workspace missing / registration absent or invalid |
| 12 | Project not initialized (run `inlay init`) |
| 20 | ADR verification failed (id collision / broken reference / title mismatch) |
| 30 | VCS adapter error |
| 40 | Guard blocked: attempted direct write to public Context or a derived file |

### Environment variables

| Variable | Purpose |
|---|---|
| `INLAY_USER` | Override the current username (defaults to the OS username). Identity is resolved through this wrapper, which is handy for testing / simulating multiple users. |
| `INLAY_SESSION` | Session identifier that isolates the "current workspace" state (defaults to `pid-<pid>`). |
| `INLAY_ROOT` | Project root directory (defaults to the current working directory). |

---

## Directory layout

```
<project-root>/
├── AGENTS.md / CLAUDE.md            # injected Inlay guidance block (startup protocol + rules)
├── .inlay/                          # Inlay config and ignore-rule fragments
└── Workspaces/
    ├── _registry/<id>.json          # [truth source] one file per workspace
    ├── _users/<user>.json           # [truth source] one file per user
    ├── _system/                     # [derived · not committed] indexes + session-private current state
    └── <workspace>/
        ├── adr/ADR-<date>-<id>-<slug>.md      # [truth source] one file per ADR
        └── context/
            ├── CONTEXT.md                      # [truth source] public glossary (team consensus)
            └── users/<user>/CONTEXT.md         # [truth source] personal staging (reset after promotion)
```

---

## Skills (multi-user enhanced workflow)

`skills/` provides 6 skills. Four are working skills that plug mattpocock's approach into the Inlay pipeline (side effects routed through the CLI, reads scoped per user); two are guidance skills that teach the agent how to drive Inlay correctly:

| Skill | Purpose |
|---|---|
| `inlay-grill-with-docs` | Interrogate a plan into alignment, recording ADRs / drafting terms via the CLI along the way |
| `inlay-improve-codebase-architecture` | Architecture deepening review (HTML report + grilling), side effects via the CLI |
| `inlay-context-aggregate` | LLM-merge personal staged terms → public doc, surface conflicts, reset after promotion |
| `inlay-migrate` | Migrate an existing mattpocock-style repo to Inlay layout, with an HTML migration report |
| `inlay-cli-guide` | Reference for driving the Inlay CLI: exact commands, flags, exit-code handling, evidence-driven rules |
| `inlay-workflow` | Inlay's workflow & guiding philosophy; routes to the right skill and reminds the user to use Inlay properly |

---

## Workflow (how to use the skills)

Inlay's core loop is **think → record via CLI → aggregate consensus → review**: you and the agent think decisions and terms through with a skill, the skill's side effects all land through the `inlay` CLI as conflict-free truth sources, and you aggregate them into team consensus and review with the dashboard.

```
   Think (skill-driven)                Record (via CLI, conflict-free)   Consensus & review
 ┌──────────────────────────┐      ┌──────────────────────────┐    ┌────────────────┐
 │ /inlay-grill-with-docs    │      │ inlay adr new / touch     │    │ /inlay-context- │
 │ /inlay-improve-codebase-… │ ───▶ │ inlay context add (own)   │──▶ │   aggregate     │
 │   (grilling / arch review)│      │ → adr/ · users/<you>/…    │    │  → public CONTEXT│
 └──────────────────────────┘      └──────────────────────────┘    │ inlay dashboard │
                                                                     └────────────────┘
```

> Prerequisite: install the skills into your agent's skills directory per [Install · Skills](#skills-optional-for-agents-such-as-claude-code) above; the `/xxx` below are slash commands typed in your agent's chat.

### Every time you start

Begin each session by confirming the workspace (startup protocol) — the guidance `inlay init` injects into `AGENTS.md`/`CLAUDE.md` prompts the agent to do this automatically:

```bash
inlay ws resolve         # with no current workspace this exits 10 and tells you to `use` one
inlay ws use <id>        # pick the workspace for this session
```

### Scenario 1: align on a plan / design → `/inlay-grill-with-docs`

The most common one. The agent grills your plan point by point until you reach a shared understanding; along the way:

- a decision worth fixing (hard to reverse, a real trade-off) → the agent creates an ADR with `inlay adr new --title "…"` and writes the body;
- a term gets sharpened → the agent writes it into **your own** staging glossary with `inlay context add` (the public doc is untouched).

You just talk; the skill records everything through the CLI, and multiple people doing this at once never collide.

### Scenario 2: improve architecture → `/inlay-improve-codebase-architecture`

The agent walks the code and produces a **read-only HTML architecture review** (written to a temp dir, not committed) listing "deepening opportunities." Pick one and grill into it; ADRs / terms are recorded through the CLI the same way. Run it every few days.

### Scenario 3: promote personal terms to team consensus → `/inlay-context-aggregate`

When your staged terms are mature, run it: the agent reads only "public `CONTEXT.md` + your own staging," uses the LLM to merge and de-duplicate, **asks you to decide** on any term that conflicts with an existing public definition, and **resets your personal staging** after promotion. This is the only write path to the public glossary.

### Scenario 4: migrate from an old workflow → `/inlay-migrate`

Already have mattpocock-style `docs/adr/NNNN-*.md` + a single `CONTEXT.md`? Run it to convert to the Inlay layout in one shot (sequential ADRs → one-file id naming; old `CONTEXT.md` → the public glossary starting point), with an **HTML migration report** for you to review before committing.

### Anytime

```bash
inlay adr list / show <id> / verify    # view / verify decisions
inlay dashboard                         # open the read-only dashboard over workspaces / ADRs / terms / users
```

---

## Collaboration SOP

1. **Before work**: pull latest → `inlay ws reindex` (or just use a query command, which refreshes the index for you).
2. **During work**: archive everything through the CLI; new ADRs never conflict; only write your own staging for terms.
3. **Before commit**: `inlay adr verify`, and confirm no derived files were staged.
4. **Commit**: truth sources only (registry / users / ADRs / public & personal Context).
5. **Promote**: explicitly run `inlay-context-aggregate`.
6. **Overview**: `inlay dashboard`.

---

## Development

```bash
node --test test/*.test.js          # unit + CLI integration tests
bash scripts/example-e2e.sh         # end-to-end real scenario (hash calculator, three users)
node scripts/build-report.mjs       # generate the implementation/test HTML report
```

Design docs live in `openspec/changes/establish-inlay-collaboration/` (proposal / design / specs / tasks).

## License

[Apache-2.0](./LICENSE)
