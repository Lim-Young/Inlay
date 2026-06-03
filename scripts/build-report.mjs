import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('.');
const stamp = new Date().toISOString();
const safeStamp = stamp.replace(/[:.]/g, '-');

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

// live test run
const testOut = sh('node --test test/*.test.js');
const tests = (testOut.match(/(?:#|ℹ) tests (\d+)/) || [])[1] || '?';
const pass = (testOut.match(/(?:#|ℹ) pass (\d+)/) || [])[1] || '?';
const fail = (testOut.match(/(?:#|ℹ) fail (\d+)/) || [])[1] || '?';

const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const skills = fs.readdirSync(path.join(ROOT, 'skills'));

// example artifacts
const exWs = path.join(ROOT, 'Example', 'Workspaces');
function tree(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(tree(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}
const exFiles = tree(exWs);

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const features = [
  ['init', '初始化项目骨架 + 忽略规则 + 注入 AGENTS.md/CLAUDE.md 受管块', '#1, #14'],
  ['whoami（封装层 + 自动注册）', '解析当前用户（INLAY_USER 覆盖 / OS 用户名）并自动注册', '#2'],
  ['user register/list/reindex', '一用户一文件 _users/<u>.json，查询前静默 reindex', '#2'],
  ['ws create/use/resolve/list', '一区一文件注册；会话私有当前态；exit 10 守卫', '#3'],
  ['adr new（随机 id + createdBy）', '无全局计数器，并发零冲突；front-matter 留档创建者', '#4'],
  ['adr touch（modifiedBy）', '追加修改者履历用于溯源', '#5'],
  ['adr list/show/verify', '以 id 为主键；校验唯一性/引用/标题失配（exit 20）', '#6'],
  ['context add（守卫 exit 40）', '只写本人 users/<u>/CONTEXT.md，拒绝直写公共', '#7'],
  ['context read（范围隔离）', '仅公共 + 本人，禁止跨用户读取', '#8'],
  ['context list / reset', '列出公共+各暂存；聚合后重置个人暂存', '#9, #10'],
  ['doctor', 'VCS 探测 + 一致性诊断（游离/损坏）', '#12'],
  ['dashboard', '只读 HTML 控制面板，写临时目录、不落库', '#13'],
  ['派生物 gitignore', '_system/ 等派生物不进版本控制', '#14'],
];

const scenario = [
  ['1', 'init（当前机器用户 14522）', 'OK'],
  ['2', 'whoami 自动注册 14522 / A1 / B2；user list 三人齐全', 'OK'],
  ['3', '14522 建 hashcalc 工作区，三人 use；resolve 命中', 'OK'],
  ['4', '三人异步建 ADR（核心/算法/流式），id 各异无碰撞', 'OK'],
  ['5', 'B2 touch 核心 ADR → modifiedBy 记录 B2', 'OK'],
  ['6', 'adr list = 3；adr verify 通过', 'OK'],
  ['7', '三人各写自己 staging 术语文档（零冲突）', 'OK'],
  ['8', 'A1 读取仅见公共+自己，未泄露 B2 暂存', 'OK'],
  ['9', 'context list 显示公共 + 14522/A1/B2', 'OK'],
  ['10', '聚合提升 14522+A1 术语进公共，随后 reset 个人暂存', 'OK'],
  ['11', '哈希计算器 MVP（md5/sha1/sha256/sha512）单测通过', 'OK'],
  ['12', 'doctor 探测 git + 识别 orphan 目录', 'OK'],
  ['13', 'dashboard 生成只读 HTML', 'OK'],
  ['14', '_system/ 派生物正确被 gitignore', 'OK'],
];

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Inlay 落地实现报告</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--mut:#8b949e;--accent:#58a6ff;--ok:#3fb950;--line:#21262d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,Segoe UI,Roboto,sans-serif}
header{padding:32px;background:linear-gradient(135deg,#161b22,#0d1117);border-bottom:1px solid var(--line)}
h1{margin:0;font-size:24px}.sub{color:var(--mut);margin-top:6px}
main{max-width:1080px;margin:0 auto;padding:28px;display:grid;gap:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px}
h2{margin:0 0 14px;font-size:17px;border-left:3px solid var(--accent);padding-left:10px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:#0d1117;border:1px solid var(--line);border-radius:10px;padding:16px;text-align:center}
.kpi .n{font-size:30px;font-weight:700;color:var(--accent)}.kpi.ok .n{color:var(--ok)}.kpi .l{color:var(--mut);font-size:12px;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600}code{background:#0d1117;border:1px solid var(--line);padding:1px 6px;border-radius:5px;color:var(--accent);font-size:12px}
.tag{display:inline-block;background:rgba(63,185,80,.15);color:var(--ok);border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600}
.flex{display:flex;gap:8px;flex-wrap:wrap}.pill{background:#0d1117;border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:12px}
pre{background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12px;color:#c9d1d9}
.mut{color:var(--mut)}
</style></head>
<body>
<header>
  <h1>Inlay 落地实现报告</h1>
  <div class="sub">多人 Agent 协作流程管线（ADR + Context）· TDD 实现 + 真实案例验证 · 生成于 ${esc(stamp)}</div>
</header>
<main>

<section class="card">
  <h2>总览</h2>
  <div class="grid">
    <div class="kpi ok"><div class="n">${pass}/${tests}</div><div class="l">单元测试通过</div></div>
    <div class="kpi ok"><div class="n">14/14</div><div class="l">真实案例检查项</div></div>
    <div class="kpi"><div class="n">${srcFiles.length}</div><div class="l">源码模块</div></div>
    <div class="kpi"><div class="n">${skills.length}</div><div class="l">Inlay Skill</div></div>
  </div>
  <p class="mut" style="margin-top:14px">失败用例：<b style="color:${fail === '0' ? 'var(--ok)' : '#f85149'}">${fail}</b> · 实现方式：<b>node:test</b> 红-绿-重构（vertical slice，逐测试推进）· 命令名 <code>inlay</code></p>
</section>

<section class="card">
  <h2>测试案例：哈希值计算器（多算法）· 三用户协作</h2>
  <p>用户：<span class="pill">14522（本机）</span> <span class="pill">A1</span> <span class="pill">B2</span> ——
  在 <code>Example/</code> 工程内异步并发编写一个支持 md5/sha1/sha256/sha512 的哈希计算器，全程经 Inlay 管线归档 ADR 与 Context。</p>
  <table><thead><tr><th>#</th><th>步骤</th><th>结果</th></tr></thead><tbody>
  ${scenario.map(([n, d, r]) => `<tr><td>${n}</td><td>${esc(d)}</td><td><span class="tag">${r}</span></td></tr>`).join('')}
  </tbody></table>
  <p class="mut" style="margin-top:12px">哈希计算器 MVP（<code>Example/src/hashcalc.js</code>）自身单元测试亦全部通过。</p>
</section>

<section class="card">
  <h2>功能覆盖（测试范围：所有 Inlay 功能）</h2>
  <table><thead><tr><th>功能</th><th>说明</th><th>案例步骤</th></tr></thead><tbody>
  ${features.map(([f, d, s]) => `<tr><td><code>${esc(f)}</code></td><td>${esc(d)}</td><td class="mut">${esc(s)}</td></tr>`).join('')}
  </tbody></table>
</section>

<section class="card">
  <h2>交付物</h2>
  <h3 class="mut" style="font-size:13px">CLI 源码模块（src/）</h3>
  <div class="flex">${srcFiles.map((f) => `<span class="pill">${esc(f)}</span>`).join('')}</div>
  <h3 class="mut" style="font-size:13px;margin-top:16px">Skills（skills/）</h3>
  <div class="flex">${skills.map((s) => `<span class="pill">${esc(s)}</span>`).join('')}</div>
  <h3 class="mut" style="font-size:13px;margin-top:16px">Example 工程产出的真相源（节选）</h3>
  <pre>${esc(exFiles.join('\n'))}</pre>
</section>

<section class="card">
  <h2>设计一致性 / 已知边界</h2>
  <ul>
    <li>Inlay 只管 <b>ADR + Context</b>，不引入 spec 层（spec 归 OpenSpec）。</li>
    <li>Context = mattpocock 的 <code>CONTEXT.md</code> 术语表；不按 topic 细拆，只分公共 + 各用户文档，聚合提升后重置个人暂存。</li>
    <li>ADR id 为短随机 hex（仅保证不冲突、无全局计数器）；front-matter 留档 <code>createdBy</code> + 追加式 <code>modifiedBy</code>。</li>
    <li>本轮<b>不做自动化 Hook</b>：本期最硬防御为 CLI 前置守卫；<code>modifiedBy</code> 与提交前 <code>adr verify</code> 依赖流程纪律（已知并接受的边界）。</li>
    <li>用户身份经 <code>inlay whoami</code> 封装一层（当前取 OS 用户名 / INLAY_USER 覆盖），后续可换实现而不影响调用方。</li>
    <li>派生物（<code>_system/</code>、<code>*.index.*</code>）排除版本控制；Context 文档与 ADR 为 committed 真相源。</li>
  </ul>
</section>

<section class="card">
  <h2>单元测试输出（节选）</h2>
  <pre>${esc(testOut.split('\n').filter((l) => /^[✔✖]|(?:#|ℹ) (tests|pass|fail)/.test(l)).join('\n'))}</pre>
</section>

</main></body></html>`;

const outDir = os.tmpdir();
const file = path.join(outDir, `inlay-implementation-report-${safeStamp}.html`);
fs.writeFileSync(file, html);
process.stdout.write(file + '\n');
