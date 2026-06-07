---
name: inlay-cli-guide
description: >-
  Operating reference for the Inlay CLI: exact commands, flags, exit-code
  handling, and the evidence-driven rules for recording or reading ADRs and
  Context. Use when about to run any `inlay` command, record or read an ADR or
  glossary term, or manage workspaces/users in an Inlay-managed repo (one with a
  `Workspaces/` directory or an Inlay block in AGENTS.md/CLAUDE.md), or when an
  inlay command returns exit 10/11/12/20/40. Triggers: "record an ADR", "add a
  glossary term", "which inlay command", "create a workspace", "promote context",
  "inlay exit 10/40".
---

# Inlay CLI — operating guide

Inlay manages **ADRs** and **Context** (the team glossary) as conflict-free, one-entity-one-file truth sources. **Every** ADR/Context write goes through the `inlay` CLI — never hand-craft ADR file names, front-matter, or edit the public `CONTEXT.md` by hand.

## Golden rules

1. **Evidence-driven.** Any claim about state ("we're in workspace X", "this ADR exists") must come from a real `inlay` call in *this* session. Prefer `--json` and read the `data` field. No CLI output ⇒ state unknown ⇒ query first.
2. **Resolve before you archive.** Every ADR/Context write requires a current workspace. If unsure, run `inlay ws resolve` first.
3. **Route through the CLI.** Use `inlay adr new` / `inlay context add`; do not `Write` to `adr/*.md` or `context/CONTEXT.md` directly.
4. **React to exit codes** (see table) instead of guessing.

## Agent session binding (MANDATORY for AI Agents)

AI Agent 的 bash/shell 工具每次调用在**新进程**中执行（PID 不同），Inlay 默认的 `pid-<pid>` 会话标识无法跨调用持久。Agent **MUST** 在每次 inlay 命令前设置 `INLAY_SESSION` 为自己的**对话 Session ID**。

**获取方法**：使用 `session_list` 工具查询当前对话的 Session ID（格式如 `ses_16df33a0affe...`）。该 ID 在同一对话的整个生命周期内保持不变，即使用户关闭终端后 Resume 也能恢复。

**设置方法**（每次 inlay 调用前附加）：

```powershell
# PowerShell
$env:INLAY_SESSION='<your-session-id>'; inlay ws resolve
```

```bash
# Bash
INLAY_SESSION='<your-session-id>' inlay ws resolve
```

**为什么不能用 OPENCODE_RUN_ID 或其他进程级标识**：这些是 per-process 的，用户关闭终端重新 Resume 对话时会变化。对话 Session ID 是 per-conversation 的，存储在 Agent 工具的持久化数据库中，跨重启稳定。

**多 Agent 并行场景**：每个 Agent 对话有唯一的 Session ID，因此多个 Agent 同时操作不同 workspace 时天然隔离，互不干扰。

## Startup protocol (do this once per session)

```bash
# 1. Set INLAY_SESSION (Agent only — see "Agent session binding" above)
# 2. Check/set workspace:
inlay ws resolve            # exit 0 → you have a workspace; exit 10 → none set
# on exit 10:
inlay ws use <id>           # pick one (ask the user which if ambiguous; `inlay ws list` to enumerate)
```

## Command reference

```bash
# project / identity
inlay init                                  # scaffold + ignore rules + inject AGENTS.md/CLAUDE.md
inlay whoami                                # resolve current user (auto-registers)
inlay user list | register [--name <u>] | reindex

# workspaces (one file per workspace; list/resolve auto-refresh the index)
inlay ws create <id> --title "<t>"
inlay ws use <id> | resolve | list
inlay ws remove <id> | reindex

# ADRs (random id, no global counter → concurrent-safe)
inlay adr new --title "<t>" [--status proposed|accepted|superseded|deprecated] \
              [--supersedes <id,id>] [--related <id,id>]
inlay adr touch <id>                        # after editing an ADR, append yourself to modifiedBy
inlay adr list [--status <s>] | show <id>
inlay adr verify                            # id uniqueness / refs / title mismatch (exit 20 on fail)

# Context (you may only write YOUR OWN staging doc)
inlay context add                           # open/init users/<you>/CONTEXT.md
inlay context read                          # public CONTEXT.md + your own staging (never others')
inlay context list | reset

# review
inlay doctor                                # VCS detect + consistency (orphan/broken)
inlay dashboard [--no-open] [--out <dir>]   # read-only HTML overview

# global flag
--json                                      # machine-readable {data, status, ts, sessionId}
```

## Exit codes — what to do

| Code | Meaning | Your reaction |
|---|---|---|
| 0 | success | continue |
| 10 | no current workspace | run `inlay ws use <id>` (ask user which if unknown), then retry |
| 11 | workspace missing / invalid registration | `inlay ws list`; pick a valid one or recreate |
| 12 | project not initialized | run `inlay init` |
| 20 | ADR verify failed | read the listed problems, fix the offending ADR(s), re-verify |
| 30 | VCS adapter error | report it; do not force-write |
| 40 | guard blocked (direct write to public Context / derived file) | **stop**; use `inlay context add` (your own doc) or promote via `/inlay-context-aggregate` |

## Recording side effects correctly

- **A decision worth keeping** (hard to reverse, real trade-off): `inlay adr new --title "…"`, then write 1–3 sentences (context / decision / why) into the generated file. Reference others by id; after editing an existing ADR run `inlay adr touch <id>`.
- **A sharpened term**: `inlay context add`, then edit the `## Language` section of *your own* `users/<you>/CONTEXT.md` (1–2 sentences, synonyms under `_Avoid_`). Promotion to the public glossary happens only via the `/inlay-context-aggregate` skill.
- **Before committing**: run `inlay adr verify` and make sure derived files (`_system/`, `*.index.*`) are not staged.

## Identity / session overrides (env)

- `INLAY_USER` — act as a specific user (default: OS username).
- `INLAY_SESSION` — isolate the "current workspace" state (default: `pid-<pid>`). **AI Agents MUST set this to their conversation Session ID** — see "Agent session binding" section above.
- `INLAY_ROOT` — project root (default: cwd).

> Specs are **not** Inlay's job — they belong to OpenSpec. Inlay owns ADR + Context only.
