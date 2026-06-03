# Inlay

[![npm version](https://img.shields.io/npm/v/@lim-young/inlay.svg)](https://www.npmjs.com/package/@lim-young/inlay)
[![license](https://img.shields.io/npm/l/@lim-young/inlay.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@lim-young/inlay.svg)](https://nodejs.org)

**Inlay** 是一套面向「人 + Agent」团队的协作流程管线，专注管理两类最有价值的工程产物：**ADR**（架构决策记录）与 **Context**（团队术语表 / 通用语言），让多人异步并发地产出这些文档时**零合并冲突**。它源自 [mattpocock 的 Skill 工作流](https://github.com/mattpocock/skills)（`grill-with-docs`、`improve-codebase-architecture`），并将其从个人向扩展为团队协作流程。

> spec（规格）交给 [OpenSpec](https://github.com/Fission-AI/OpenSpec)；Inlay **不碰 spec**，只管 ADR + Context。

---

## 第一性原理

> **任何「共享且会被多人并发修改的单一文件」都是冲突源。**

由此推导出 Inlay 的核心做法：

- **一实体一文件（append-only 友好）** —— 工作区、用户、ADR 各自独立成文件，多人并发产出天然不冲突（不靠全局连续编号）。
- **派生即可丢弃** —— 索引、聚合视图、控制面板等派生物可随时重建，**不进版本控制**。
- **Evidence-Driven** —— Agent 对状态的任何断言，必须来自当前会话内一次真实 `inlay` CLI 调用的输出（带时间戳 + sessionId），杜绝凭记忆臆断。

---

## 安装

### CLI

```bash
npm install -g @lim-young/inlay
inlay --help
```

要求 Node.js ≥ 20，无运行时依赖。免安装试用：`npx @lim-young/inlay <command>`。

### Skills（可选，供 Claude Code 等 Agent 使用）

Inlay 随 npm 包一起分发 4 个增强版 Skill（见下文 **Skills** 一节）。把它们装进 Agent 的技能目录后，即可在对话中用 `/inlay-grill-with-docs`、`/inlay-context-aggregate` 等斜杠命令调用。

```bash
# 全局安装 CLI 后，skills 位于 npm 全局目录
SKILLS_SRC="$(npm root -g)/@lim-young/inlay/skills"

# Claude Code · 项目级（随项目共享，推荐）
mkdir -p .claude/skills && cp -r "$SKILLS_SRC"/* .claude/skills/

# Claude Code · 用户级（对所有项目生效）
mkdir -p ~/.claude/skills && cp -r "$SKILLS_SRC"/* ~/.claude/skills/
```

> Windows PowerShell：`Copy-Item -Recurse "$(npm root -g)\@lim-young\inlay\skills\*" .claude\skills\`
> 也可不装 CLI，直接从仓库拷贝 `skills/` 目录。

---

## 使用示例

下面以「三人协作编写一个哈希计算器」为例。三个用户：`alice`、`bob`，以及你本机（`inlay whoami` 自动取计算机用户名）。

### 1. 初始化项目

```bash
cd your-project
inlay init
```

`init` 会：创建 `Workspaces/` 骨架、写好忽略规则（排除派生物），并把 **Inlay 指引块**幂等注入 `AGENTS.md` 与 `CLAUDE.md`（已有文件则只替换标记块、不动其余内容）。

### 2. 确认身份（自动注册）

```bash
inlay whoami
# → 解析当前用户（计算机用户名）并自动注册为 Workspaces/_users/<you>.json
inlay user list
```

> 想以别的身份操作（例如在一台机器上模拟队友），设置环境变量 `INLAY_USER`：
> ```bash
> INLAY_USER=alice inlay whoami     # 解析并注册 alice
> ```

### 3. 创建并进入工作区

```bash
inlay ws create hashcalc --title "Hash Calculator"
inlay ws use hashcalc        # 设为当前会话的工作区
inlay ws resolve             # 确认当前工作区（启动协议第一步）
```

### 4. 记录一条 ADR

```bash
inlay adr new --title "Use Node crypto for hashing" --status accepted
# → 生成 Workspaces/hashcalc/adr/ADR-<date>-<id>-use-node-crypto-for-hashing.md
#   front-matter 自动写入 createdBy（= whoami）、随机 id（无全局计数器，并发零冲突）
```

随后把 1–3 句「背景 / 决策 / 为什么」写进生成的文件。引用其它 ADR 用其 id：

```bash
inlay adr new --title "Stream large files for hashing" --related <other-adr-id>
inlay adr touch <id>     # 编辑既有 ADR 后，记录你为修改者（modifiedBy）
inlay adr list           # 查看全部（以 id 为主键）
inlay adr verify         # 校验 id 唯一性 / 引用有效 / 标题失配（提交前手工跑）
```

### 5. 起草术语（写自己的暂存，零冲突）

```bash
inlay context add        # 打开/初始化 你自己的 users/<you>/CONTEXT.md
```

在你的暂存文档的 `## Language` 段里定义术语（每个术语 1–2 句，同义词放 `_Avoid_`）。**你只能写自己的暂存文档**，直接写公共 `CONTEXT.md` 会被守卫拦截（exit 40）。

```bash
inlay context read       # 读「公共 CONTEXT.md + 你自己的暂存」（不会读到别人的暂存）
inlay context list       # 列出公共文档 + 各用户暂存
```

### 6. 提升术语到团队共识

当你的术语达成共识，运行聚合 Skill（在 Agent 中调用 `/inlay-context-aggregate`）：它用 LLM 把你的暂存术语合并进公共 `context/CONTEXT.md`、标出与现有术语的冲突供你裁决，并在提升后**重置你的个人暂存**。

### 7. 总览 & 体检

```bash
inlay dashboard          # 生成只读 HTML 控制面板并在浏览器打开（不落库）
inlay doctor             # 体检：VCS 探测 + 工作区一致性（游离/损坏）诊断
```

完成。所有真相源（`_registry/*`、`_users/*`、`adr/*`、`context/CONTEXT.md`、`context/users/*`）提交版本控制；派生物（`_system/`、`*.index.*`）自动忽略。

---

## 命令速查

```
inlay init                                初始化项目（骨架 + 忽略规则 + 注入 AGENTS.md/CLAUDE.md）
inlay whoami                              解析当前用户（自动注册）
inlay user register|list|reindex          用户注册表（一用户一文件）
inlay ws create <id> --title <t>          创建工作区（一区一文件）
inlay ws use <id> | resolve | list        切换 / 解析 / 列出工作区
inlay ws remove <id> | reindex            删除 / 重建索引
inlay adr new --title <t> [--status s]    新建 ADR（随机 id + front-matter）
        [--supersedes a,b] [--related a,b]
inlay adr touch <id>                      记录修改者（modifiedBy）
inlay adr list [--status s] | show <id>   查询 ADR
inlay adr verify                          校验（失败 exit 20）
inlay context add [--scope user|shared]   写自己暂存（--scope shared 被拦截 exit 40）
inlay context list | read | reset         列出 / 读取(公共+本人) / 重置个人暂存
inlay doctor                              环境与一致性诊断
inlay dashboard [--no-open] [--out <dir>] 只读控制面板（临时 HTML）

全局：--json   机器可读输出（含 data / status / ts / sessionId）
```

### 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 10 | 当前工作区未确定（先 `ws use`/`resolve`） |
| 11 | 工作区不存在 / 注册文件缺失或非法 |
| 12 | 项目未初始化（先 `inlay init`） |
| 20 | ADR 校验失败（id 冲突 / 引用断链 / 标题失配） |
| 30 | VCS 适配层错误 |
| 40 | 守卫拦截：试图直写公共 Context 或派生文件 |

### 环境变量

| 变量 | 作用 |
|---|---|
| `INLAY_USER` | 覆盖当前用户名（默认取计算机用户名）。身份经此封装层解析，便于测试/模拟多用户。 |
| `INLAY_SESSION` | 会话标识，隔离「当前工作区」状态（默认 `pid-<pid>`）。 |
| `INLAY_ROOT` | 项目根目录（默认当前工作目录）。 |

---

## 目录结构

```
<project-root>/
├── AGENTS.md / CLAUDE.md            # 注入的 Inlay 指引块（启动协议 + 铁律 + 读写规则）
├── .inlay/                          # Inlay 配置与忽略规则片段
└── Workspaces/
    ├── _registry/<id>.json          # 【真相源】一区一文件
    ├── _users/<user>.json           # 【真相源】一用户一文件
    ├── _system/                     # 【派生·不进版本控制】索引 + 会话私有当前态
    └── <workspace>/
        ├── adr/ADR-<date>-<id>-<slug>.md      # 【真相源】一 ADR 一文件
        └── context/
            ├── CONTEXT.md                      # 【真相源】公共术语表（团队共识）
            └── users/<user>/CONTEXT.md         # 【真相源】个人暂存（聚合后重置）
```

---

## Skills（多人增强版工作流）

`skills/` 下提供 4 个 Skill，把 mattpocock 的思路接入 Inlay 管线（写入改道经 CLI、读取范围隔离）：

| Skill | 作用 |
|---|---|
| `inlay-grill-with-docs` | 拷问式对齐计划，沿途经 CLI 记录 ADR / 起草术语 |
| `inlay-improve-codebase-architecture` | 架构深化评审（HTML 报告 + grilling），副作用经 CLI |
| `inlay-context-aggregate` | LLM 合并个人暂存术语 → 公共文档，标出冲突、提升后重置 |
| `inlay-migrate` | 把现有 mattpocock 工作流文档无缝迁移为 Inlay 版本，并输出迁移报告 |

---

## 工作流（如何配合 Skill 使用）

Inlay 的核心闭环是「**想清楚 → 经 CLI 落档 → 聚合共识 → 审查**」：你和 Agent 用 Skill 把决策与术语想清楚，Skill 的副作用全部经 `inlay` CLI 落成冲突无关的真相源，再按需聚合成团队共识、用面板审查。

```
   想清楚（Skill 驱动）                 落档（经 CLI，零冲突）            共识 & 审查
 ┌──────────────────────────┐      ┌──────────────────────────┐    ┌────────────────┐
 │ /inlay-grill-with-docs    │      │ inlay adr new / touch     │    │ /inlay-context- │
 │ /inlay-improve-codebase-… │ ───▶ │ inlay context add（个人）  │──▶ │   aggregate     │
 │   （拷问 / 架构评审）       │      │ → adr/ · users/<you>/…    │    │  → 公共 CONTEXT  │
 └──────────────────────────┘      └──────────────────────────┘    │ inlay dashboard │
                                                                     └────────────────┘
```

> 前提：已按上文 [安装 · Skills](#skills可选供-claude-code-等-agent-使用) 把 Skill 装进 Agent 技能目录；下面的 `/xxx` 均为在 Agent 对话中输入的斜杠命令。

### 每次开工

会话开始先确认工作区（启动协议）——`inlay init` 注入到 `AGENTS.md`/`CLAUDE.md` 的指引会提示 Agent 自动这么做：

```bash
inlay ws resolve         # 没有当前工作区会以 exit 10 提示你先 use
inlay ws use <id>        # 选定本次会话的工作区
```

### 场景一：对齐一个计划 / 设计 → `/inlay-grill-with-docs`

最常用。Agent 会就你的计划逐点拷问，直到达成共识；过程中：

- 出现值得固化的决策（难以反悔、有真实取舍）→ Agent 用 `inlay adr new --title "…"` 建 ADR 并写正文；
- 术语被厘清 → Agent 用 `inlay context add` 写进**你自己的**暂存术语表（不会动公共文档）。

你只需对话，归档由 Skill 经 CLI 完成，多人同时进行也不会撞车。

### 场景二：改善架构 → `/inlay-improve-codebase-architecture`

Agent 浏览代码、产出一份**只读 HTML 架构评审报告**（写临时目录，不落库），列出「深化机会」候选。你挑一个深入 grilling，过程中同样经 CLI 记录 ADR / 术语。建议每隔几天跑一次。

### 场景三：把个人术语提升为团队共识 → `/inlay-context-aggregate`

当你暂存的术语成熟，运行它：Agent 只读「公共 `CONTEXT.md` + 你自己的暂存」，用 LLM 合并去重、对与公共已有定义冲突的术语**请你裁决**，提升进公共文档后**重置你的个人暂存**。这是公共术语表唯一的写入途径。

### 场景四：从旧工作流迁移 → `/inlay-migrate`

已有 mattpocock 风格的 `docs/adr/NNNN-*.md` + 单一 `CONTEXT.md`？运行它一键转换为 Inlay 布局（顺序 ADR → 一文件 id 命名；旧 `CONTEXT.md` → 公共术语表起点），并产出一份 **HTML 迁移报告**供你审阅后再落库。

### 随时

```bash
inlay adr list / show <id> / verify    # 查看 / 校验决策
inlay dashboard                         # 打开只读面板总览工作区 / ADR / 术语 / 用户
```

---

## 协作 SOP

1. **开工前**：拉取最新 → `inlay ws reindex`（或直接用查询命令，会自动刷新索引）。
2. **工作中**：归档全经 CLI；ADR 新建天然不冲突；术语只写自己的暂存。
3. **提交前**：`inlay adr verify`，确认未误提交派生文件。
4. **提交**：仅真相源（注册表 / 用户 / ADR / 公共与个人 Context）。
5. **聚合提升**：显式运行 `inlay-context-aggregate`。
6. **总览**：`inlay dashboard`。

---

## 开发

```bash
node --test test/*.test.js          # 单元 + CLI 集成测试
bash scripts/example-e2e.sh         # 端到端真实案例（哈希计算器，三用户）
node scripts/build-report.mjs       # 生成实现/测试 HTML 报告
```

设计文档见 `openspec/changes/establish-inlay-collaboration/`（proposal / design / specs / tasks）。

## License

[Apache-2.0](./LICENSE)
