---
name: inlay-doctor
description: >-
  Diagnose and fix Inlay system health issues — stale ADR references, broken
  supersession chains, missing workspace registrations — within the current
  workspace. Uses `inlay doctor --json` for evidence-driven diagnostics, then
  guides remediation step-by-step. Triggers: "check project health", "fix stale
  ADRs", "doctor the workspace", "audit Inlay", "review Inlay health".
---

# Inlay Doctor — 健康诊断与修复

## 启动协议

在修复任何问题前，确认当前工作区：

```bash
inlay ws resolve
# 若 exit 10：inlay ws use <id>
```

## 工作流

### 1. 运行诊断

```bash
inlay doctor --json
```

解析输出的 `workspaces[].findings[]`，每个 finding 包含：
- `level` — `error` | `warn` | `info`
- `code` — 问题类型码
- `message` — 人类可读描述
- `evidence` — 具体文件路径、ADR ID、引用关系、修复建议

### 2. 分类并呈现

按 workspace 分组，按 `error > warn > info` 排序。逐一展示 evidence，让用户看到具体问题。

### 3. 执行修复（按 finding 类型）

#### ADR_STALE_REF (warn)

ADR 的 `related` 字段引用了 `status === 'superseded'` 的 ADR。

修复步骤：
1. 从 evidence 获取 `adrId`（引用方）、`staleRef`（已废弃引用）、`latestInChain`（取代链最新版）、`suggestion`
2. 呈现取代链：`<staleRef>` → 被 `<latestInChain>` 取代
3. 建议：将 `related` 引用从 `<staleRef>` 更新为 `<latestInChain>`
4. 用户确认后，编辑引用 ADR 的 frontmatter `related` 字段
5. 运行 `inlay adr touch <adrId>` 登记修改

#### ADR_CIRCULAR (error)

supersedes 链存在循环引用。

修复步骤：
1. 展示 evidence.cycle（循环路径）和 evidence.files（涉及文件）
2. 与用户讨论正确的取代关系（哪个 ADR 应取代哪个）
3. 编辑相关 ADR 的 `supersedes` 字段，打破循环
4. 运行 `inlay adr touch <id>` 登记每个修改的 ADR

#### ADR_BROKEN_SUPERSEDES (error)

supersedes 字段引用了不存在的 ADR ID。

修复步骤：
1. 展示 evidence.file 和 evidence.brokenRef
2. 与用户确认：移除该引用 或 修正为正确 ID
3. 编辑 frontmatter `supersedes` 字段
4. 运行 `inlay adr touch <adrId>` 登记

#### ADR_BROKEN_REF (error)

任何引用字段（related/supersedes）指向不存在的 ADR ID。

修复步骤同 ADR_BROKEN_SUPERSEDES。

#### ADR_DUP_ID (error)

两个 ADR 文件具有相同的 ID。

修复步骤：
1. 展示 evidence.file1 和 evidence.file2
2. 与用户确认哪个保留原 ID
3. 对另一个 ADR，`inlay adr new` 创建新 ADR 并迁移内容，然后删除旧文件

#### WS_ORPHAN_DIR (warn)

目录存在但无注册文件。

修复：若需要保留 → `inlay ws create <id>`；否则删除目录。

#### WS_BROKEN_REG (warn)

注册文件存在但无对应目录。

修复：若不需要 → `inlay ws remove <id> --delete-dir`；否则重建目录。

### 4. 验证

```bash
inlay doctor --json
```

确认所有 findings 已清除，`summary.errors === 0` 且 `summary.warnings === 0`（info 级别除外）。

## 约束

- **工作区范围**：只修复当前 workspace 内的问题。跨 workspace 的发现只报告，不跨区操作。
- **证据驱动**：每个修复必须引用 `inlay doctor --json` 输出的具体 evidence，不得猜测。
- **CLI 优先**：ADRs frontmatter 的修改通过编辑文件（经用户确认）+ `inlay adr touch` 登记，不直接手写 frontmatter 创建新 ADR。
- **验证闭环**：修复完成后必须重新运行 `inlay doctor --json` 直到干净。
