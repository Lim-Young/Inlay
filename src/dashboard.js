import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from './paths.js';
import { exists, listJsonStems, readJson, nowIso } from './util.js';
import { listWorkspaces } from './workspace.js';
import { listUsers } from './identity.js';
import { parseFrontmatter } from './frontmatter.js';
import { verifyAdrDir } from './adr.js';

// Read-only scan of the whole project (admin/review view). design.md §7.6.
// currentUser is injected at generation time (whoami) so the self-contained
// file "knows" who generated it (add-readonly-team-dashboard design D1).
export function scanProject({ root, currentUser = null }) {
  const p = paths(root);
  const users = exists(p.users) ? listUsers({ root }) : [];
  const workspaces = (exists(p.workspaces) ? listWorkspaces({ root }) : []).map((w) => {
    const adrDir = p.adrDir(w.id);
    const adrs = exists(adrDir)
      ? fs
          .readdirSync(adrDir)
          .filter((f) => /^ADR-.*\.md$/.test(f))
          .map((f) => parseFrontmatter(fs.readFileSync(path.join(adrDir, f), 'utf8')).data)
      : [];
    const usersDir = p.contextUsersDir(w.id);
    const contextUsers = exists(usersDir)
      ? fs
          .readdirSync(usersDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => {
            const file = p.contextUserFile(w.id, d.name);
            const terms = exists(file) ? countTerms(fs.readFileSync(file, 'utf8')) : 0;
            return { user: d.name, terms, isCurrent: d.name === currentUser };
          })
      : [];
    const publicContext = exists(p.contextPublic(w.id)) ? fs.readFileSync(p.contextPublic(w.id), 'utf8') : '';
    const publicTerms = countTerms(publicContext);
    return { ...w, adrs, contextUsers, publicContext, publicTerms };
  });
  const activity = buildActivity(workspaces);
  const health = buildHealth(workspaces, root);
  const contributions = buildContributions(workspaces);
  return { generatedAt: nowIso(), root, currentUser, users, workspaces, activity, health, contributions };
}

// Health = per-workspace registration status + ADR verify problems. design.md D4.
export function buildHealth(workspaces, root) {
  const p = paths(root);
  return {
    workspaces: workspaces.map((w) => ({
      id: w.id,
      status: w.status,
      problems: w.status === 'ok' ? verifyAdrDir(p.adrDir(w.id)).problems : [],
    })),
  };
}

// Per-user ADR contribution counts (created + touched). design.md D4.
export function buildContributions(workspaces) {
  const acc = new Map();
  const bump = (user, key) => {
    if (!user) return;
    const rec = acc.get(user) || { user, created: 0, touched: 0 };
    rec[key] += 1;
    acc.set(user, rec);
  };
  for (const w of workspaces) {
    for (const a of w.adrs) {
      bump(a.createdBy, 'created');
      for (const m of a.modifiedBy || []) bump(m.user, 'touched');
    }
  }
  return [...acc.values()];
}

// Flatten ADR created + modifiedBy events into a single stream. Sorting is left
// to the client (no Date.now() here — keeps scan pure/replayable). design.md D4.
export function buildActivity(workspaces) {
  const events = [];
  for (const w of workspaces) {
    for (const a of w.adrs) {
      if (a.createdAt) {
        events.push({ at: a.createdAt, user: a.createdBy, kind: 'created', adrId: a.id, workspace: w.id });
      }
      for (const m of a.modifiedBy || []) {
        events.push({ at: m.at, user: m.user, kind: 'touched', adrId: a.id, workspace: w.id });
      }
    }
  }
  return events;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function countTerms(md) {
  return (md.match(/^\*\*[^*]+\*\*/gm) || []).length;
}

function refIds(a) {
  return [
    ...(a.supersedes || []).map((s) => (typeof s === 'string' ? s : s.id)),
    ...(a.related || []).map((r) => (typeof r === 'string' ? r : r.id)),
  ];
}

// Inline SVG relationship graph: nodes = ADRs, edges = supersedes/related.
// Single-row layout, no third-party library (design D5).
function renderGraph(w) {
  if (!w.adrs.length) return '';
  const ids = new Set(w.adrs.map((a) => a.id));
  const pos = new Map();
  const stepX = 130;
  const W = 40 + w.adrs.length * stepX;
  const H = 90;
  w.adrs.forEach((a, i) => pos.set(a.id, { x: 40 + i * stepX, y: 55 }));
  const edges = [];
  for (const a of w.adrs) {
    for (const t of refIds(a)) {
      if (!ids.has(t)) continue;
      const s = pos.get(a.id);
      const d = pos.get(t);
      edges.push(`<line x1="${s.x}" y1="${s.y}" x2="${d.x}" y2="${d.y}" stroke="#4ea1ff" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    }
  }
  const nodes = w.adrs
    .map((a) => {
      const c = pos.get(a.id);
      return `<g><circle cx="${c.x}" cy="${c.y}" r="14" fill="#1a2027" stroke="#2a3640"/><text x="${c.x}" y="${c.y - 20}" fill="#8b98a5" font-size="10" text-anchor="middle">${esc(a.id)}</text></g>`;
    })
    .join('');
  return `<h3>Decision graph</h3><div class="graph"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="ADR relationship graph"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="20" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#4ea1ff"/></marker></defs>${edges.join('')}${nodes}</svg></div>`;
}

export function renderHtml(model, { defaultLens = 'self' } = {}) {
  const lens = defaultLens === 'overview' ? 'overview' : 'self';
  const wsCards = model.workspaces
    .map((w) => {
      const badge = w.status === 'ok' ? 'ok' : w.status === 'orphan' ? 'orphan' : 'broken';
      const adrRows = w.adrs
        .map((a) => {
          const refs = refIds(a).join(', ');
          const mods = (a.modifiedBy || []).map((m) => m.user).join(', ');
          const rowText = `${a.id} ${a.title} ${a.status} ${a.createdBy} ${mods} ${refs}`.toLowerCase();
          return `<tr data-row="${esc(rowText)}" data-status="${esc(a.status)}" data-createdby="${esc(a.createdBy)}"><td><code>${esc(
            a.id
          )}</code></td><td>${esc(a.title)}</td><td><span class="pill">${esc(a.status)}</span></td><td>${esc(
            a.createdBy
          )}</td><td>${esc(mods)}</td><td>${esc(refs)}</td></tr>`;
        })
        .join('');
      const stagers = w.contextUsers.length
        ? w.contextUsers
            .map((u) => {
              const cls = u.isCurrent ? 'pill mine' : 'pill overview-only';
              return `<span class="${cls}">${esc(u.user)} · ${u.terms} term(s)</span>`;
            })
            .join(' ')
        : '<span class="empty">none</span>';
      return `<section class="card ws">
        <h2>${esc(w.title || w.id)} <span class="status ${badge}">${badge}</span></h2>
        <div class="meta">id <code>${esc(w.id)}</code> · created by ${esc(w.createdBy || '—')}</div>
        <h3>ADRs (${w.adrs.length})</h3>
        ${
          w.adrs.length
            ? `<table><thead><tr><th>id</th><th>title</th><th>status</th><th>createdBy</th><th>modifiedBy</th><th>refs</th></tr></thead><tbody>${adrRows}</tbody></table>`
            : '<p class="empty">none</p>'
        }
        ${renderGraph(w)}
        <h3>Context</h3>
        <p>Public glossary: <b>${w.publicTerms}</b> term(s). Pending stagers: ${stagers}</p>
      </section>`;
    })
    .join('\n');

  // Health summary bar.
  const hw = (model.health && model.health.workspaces) || [];
  const cnt = (s) => hw.filter((x) => x.status === s).length;
  const problems = hw.reduce((n, x) => n + (x.problems ? x.problems.length : 0), 0);
  const healthBar = `<section class="card"><h2>Health</h2><p>
    <span class="status ok">${cnt('ok')} ok</span>
    <span class="status orphan">${cnt('orphan')} orphan</span>
    <span class="status broken">${cnt('broken')} broken</span>
    · verify problems: <b>${problems}</b></p>
    ${problems ? `<ul>${hw.flatMap((x) => (x.problems || []).map((p) => `<li><code>${esc(x.id)}</code> ${esc(p)}</li>`)).join('')}</ul>` : ''}
  </section>`;

  // Activity pulse (newest first; string compare keeps scan pure).
  const sorted = [...(model.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const activityRows = sorted.length
    ? sorted
        .map(
          (e) =>
            `<li data-user="${esc(e.user)}" class="${e.user === model.currentUser ? 'mine' : 'overview-only'}"><span class="pill">${esc(
              e.user
            )}</span> ${esc(e.kind)} <code>${esc(e.adrId)}</code> <span class="mut">${esc(e.workspace)} · ${esc(e.at)}</span></li>`
        )
        .join('')
    : '<li class="empty">none</li>';

  // Context divergence (per-user staging vs public) — overview lens.
  const divRows = model.workspaces
    .flatMap((w) =>
      w.contextUsers
        .filter((u) => !u.isCurrent)
        .map(
          (u) =>
            `<li class="overview-only"><code>${esc(w.id)}</code> ${esc(u.user)}: <b>${u.terms}</b> pending term(s)</li>`
        )
    )
    .join('');
  const divergence = `<section class="card"><h2>Context divergence</h2>
    <p class="mut">公共库术语随工作区展示；个人暂存需经 <code>inlay-context-aggregate</code> Skill 提升（面板只展示分歧，不做合并）。</p>
    <ul><li class="mine">你的暂存按工作区显示在各卡片内。</li>${divRows || '<li class="overview-only empty">其他用户暂存：切到总览视角查看</li>'}</ul>
  </section>`;

  // Contributions (overview lens).
  const contribRows = (model.contributions || [])
    .map((c) => `<tr><td>${esc(c.user)}</td><td>${c.created}</td><td>${c.touched}</td></tr>`)
    .join('');
  const contributions = `<section class="card overview-only"><h2>Contributions</h2>
    ${contribRows ? `<table><thead><tr><th>user</th><th>created</th><th>touched</th></tr></thead><tbody>${contribRows}</tbody></table>` : '<p class="empty">none</p>'}
  </section>`;

  const userRows = model.users
    .map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.registeredAt)}</td></tr>`)
    .join('');

  const modelJson = JSON.stringify(model).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Inlay Dashboard</title>
<style>
  :root{--bg:#0f1419;--card:#1a2027;--fg:#e6edf3;--mut:#8b98a5;--accent:#4ea1ff;--ok:#2ea043;--warn:#d29922;--bad:#f85149}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:24px 32px;border-bottom:1px solid #222b34} h1{margin:0;font-size:20px} .sub{color:var(--mut);margin-top:4px}
  .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
  .toolbar input,.toolbar select{background:#0b0f14;border:1px solid #2a3640;color:var(--fg);border-radius:6px;padding:5px 8px;font:inherit}
  .lens button{background:#0b0f14;border:1px solid #2a3640;color:var(--mut);border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
  .lens button[aria-pressed=true]{color:var(--fg);border-color:var(--accent);background:rgba(78,161,255,.12)}
  .note{margin:10px 32px 0;color:var(--warn);font-size:12px;border:1px dashed #3a3320;border-radius:8px;padding:8px 12px;background:rgba(210,153,34,.06)}
  main{padding:20px 32px;max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:start}
  main>.full{grid-column:1 / -1}
  .col{display:grid;gap:20px}
  .card{background:var(--card);border:1px solid #222b34;border-radius:10px;padding:18px 20px}
  h2{margin:0 0 4px;font-size:17px} h3{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
  .meta,.mut{color:var(--mut);font-size:12px} table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #222b34;vertical-align:top}
  th{color:var(--mut);font-weight:600} code{background:#0b0f14;padding:1px 6px;border-radius:5px;color:var(--accent)}
  .pill{display:inline-block;background:#0b0f14;border:1px solid #2a3640;border-radius:999px;padding:1px 9px;font-size:12px;color:var(--fg);margin:1px 0}
  .pill.mine{border-color:var(--accent)}
  .status{font-size:11px;padding:2px 8px;border-radius:999px;vertical-align:middle;margin-right:4px}
  .status.ok{background:rgba(46,160,67,.15);color:var(--ok)} .status.orphan{background:rgba(210,153,34,.15);color:var(--warn)} .status.broken{background:rgba(248,81,73,.15);color:var(--bad)}
  .empty{color:var(--mut)} ul{margin:6px 0;padding-left:18px} li{margin:2px 0}
  .graph{overflow-x:auto;border:1px solid #222b34;border-radius:8px;margin-top:4px}
  body.lens-self .overview-only{display:none}
</style></head>
<body data-default-lens="${lens}" class="lens-${lens}">
<header>
  <h1>Inlay Dashboard</h1>
  <div class="sub">${esc(model.root)} · generated ${esc(model.generatedAt)} · ${model.workspaces.length} workspace(s) · ${model.users.length} user(s) · you: <b>${esc(
    model.currentUser || '—'
  )}</b></div>
  <div class="toolbar">
    <span class="lens">
      <button data-lens-btn="self" aria-pressed="true">自身视角</button>
      <button data-lens-btn="overview" aria-pressed="false">总览视角</button>
    </span>
    <input id="q" type="search" placeholder="搜索 ADR…" aria-label="search">
    <select id="statusFilter" aria-label="filter by status">
      <option value="">all status</option>
      <option value="proposed">proposed</option>
      <option value="accepted">accepted</option>
      <option value="rejected">rejected</option>
      <option value="superseded">superseded</option>
    </select>
  </div>
</header>
<div class="note">注意：本面板已将<strong>全部</strong>团队数据内联进此文件；「自身视角」只是<strong>默认筛选</strong>，<strong>不是安全边界</strong>。适用前提：纯本地、文件不外发、各用户各自生成。</div>
<main>
  <div class="col">
    ${healthBar}
    ${wsCards || '<p class="empty">No workspaces yet.</p>'}
  </div>
  <div class="col">
    <section class="card"><h2>Activity pulse</h2><ul>${activityRows}</ul></section>
    ${divergence}
    ${contributions}
    <section class="card"><h2>Users</h2>
    ${model.users.length ? `<table><thead><tr><th>username</th><th>registeredAt</th></tr></thead><tbody>${userRows}</tbody></table>` : '<p class="empty">none</p>'}
    </section>
  </div>
</main>
<script id="inlay-model" type="application/json">${modelJson}</script>
<script>
(function(){
  var body=document.body;
  function setLens(l){
    body.classList.remove('lens-self','lens-overview');
    body.classList.add('lens-'+l);
    var btns=document.querySelectorAll('[data-lens-btn]');
    for(var i=0;i<btns.length;i++){ btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-lens-btn')===l?'true':'false'); }
  }
  var lensBtns=document.querySelectorAll('[data-lens-btn]');
  for(var i=0;i<lensBtns.length;i++){ (function(b){ b.addEventListener('click',function(){ setLens(b.getAttribute('data-lens-btn')); }); })(lensBtns[i]); }
  setLens(body.getAttribute('data-default-lens')||'self');
  function applyFilters(){
    var qel=document.getElementById('q'); var sel=document.getElementById('statusFilter');
    var q=(qel&&qel.value||'').toLowerCase(); var st=(sel&&sel.value)||'';
    var rows=document.querySelectorAll('tr[data-row]');
    for(var i=0;i<rows.length;i++){
      var tr=rows[i];
      var okText=tr.getAttribute('data-row').indexOf(q)>=0;
      var okStatus=!st||tr.getAttribute('data-status')===st;
      tr.style.display=(okText&&okStatus)?'':'none';
    }
  }
  var qel=document.getElementById('q'); if(qel) qel.addEventListener('input',applyFilters);
  var sel=document.getElementById('statusFilter'); if(sel) sel.addEventListener('change',applyFilters);
})();
</script>
</body></html>`;
}

export function generateDashboard({ root, outDir = os.tmpdir(), stamp, currentUser = null, view = 'self' } = {}) {
  const model = scanProject({ root, currentUser });
  const html = renderHtml(model, { defaultLens: view });
  fs.mkdirSync(outDir, { recursive: true });
  const ts = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `inlay-dashboard-${ts}.html`);
  fs.writeFileSync(file, html);
  return { path: file, html, model };
}
