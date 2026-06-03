// Inlay-managed guidance block injected into AGENTS.md / CLAUDE.md (design.md §11bis).
export const BEGIN = '<!-- INLAY:BEGIN (managed by `inlay init`; edit outside these markers) -->';
export const END = '<!-- INLAY:END -->';

export const GUIDE_BODY = `## Inlay 协作流程（ADR + Context）

本项目用 Inlay 管理 **ADR 与 Context**（团队术语表）；**spec 归 OpenSpec**，Inlay 不碰 spec。

### 铁律（Evidence-Driven）
- 对工作区状态的任何断言，必须来自**当前会话内一次真实 \`inlay\` CLI 调用输出**（含时间戳 + sessionId）。
- 无 CLI 证据 = 状态未知 = 先查（\`inlay ws resolve\`）或拒绝归档。禁止凭记忆/历史上下文断言「当前在某工作区」。

### 会话启动协议
1. 先 \`inlay ws resolve\`。
2. exit 0 → 进入工作区模式并记录该证据；exit 10 → 询问用户后 \`inlay ws use <id>\`。
3. 归档（ADR/Context 写）前必须已有一次成功的 resolve/use 证据。

### 写入规则（务必经 CLI，不要直接写文件）
- 新建 ADR：\`inlay adr new --title "<t>"\`（CLI 生成 id 命名与 front-matter，createdBy 取 \`inlay whoami\`）。
- 编辑既有 ADR 后：\`inlay adr touch <id>\` 记录修改者。
- 写术语：\`inlay context add\` 写**你自己的** users/<you>/CONTEXT.md；**禁止直接改公共 CONTEXT.md**。
- 提升进公共术语表：运行 \`inlay-context-aggregate\` Skill（LLM 合并 + 人工裁决冲突 + 提升后重置你的暂存）。

### 读取规则
- 读术语表：公共 context/CONTEXT.md + 你自己的 users/<you>/CONTEXT.md；**不读其他用户的暂存**。
- 提交前手工跑 \`inlay adr verify\`（本期无 git 钩子兜底）。
- 总览：\`inlay dashboard\` 打开只读控制面板。`;

export function managedBlock() {
  return `${BEGIN}\n${GUIDE_BODY}\n${END}`;
}

// Inject (replace existing block / append) or create. Returns the new file text.
export function injectBlock(existingText) {
  const block = managedBlock();
  if (existingText == null || existingText === '') return block + '\n';
  const b = existingText.indexOf(BEGIN);
  const e = existingText.indexOf(END);
  if (b !== -1 && e !== -1 && e > b) {
    const before = existingText.slice(0, b);
    const after = existingText.slice(e + END.length);
    return before + block + after;
  }
  const sep = existingText.endsWith('\n') ? '\n' : '\n\n';
  return existingText + sep + block + '\n';
}
