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
    const rawAdrs = exists(adrDir)
      ? fs
          .readdirSync(adrDir)
          .filter((f) => /^ADR-.*\.md$/.test(f))
          .map((f) => {
            const { data, body } = parseFrontmatter(fs.readFileSync(path.join(adrDir, f), 'utf8'));
            return { ...data, body };
          })
      : [];
    const adrs = annotateSupersession(rawAdrs);
    const usersDir = p.contextUsersDir(w.id);
    const contextUsers = exists(usersDir)
      ? fs
          .readdirSync(usersDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => {
            const file = p.contextUserFile(w.id, d.name);
            const content = exists(file) ? fs.readFileSync(file, 'utf8') : '';
            return { user: d.name, terms: countTerms(content), isCurrent: d.name === currentUser, content };
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

// Annotate each ADR with who superseded it + whether it is still active.
// supersededBy = ids of in-scope ADRs that list this one in their `supersedes`.
// active = nobody superseded it. Resolved within a single workspace. design D3.
export function annotateSupersession(adrs) {
  const ids = new Set(adrs.map((a) => a.id));
  const supersededBy = new Map(adrs.map((a) => [a.id, []]));
  for (const a of adrs) {
    for (const ref of a.supersedes || []) {
      const target = typeof ref === 'string' ? ref : ref && ref.id;
      if (target && ids.has(target)) supersededBy.get(target).push(a.id);
    }
  }
  return adrs.map((a) => ({
    ...a,
    supersededBy: supersededBy.get(a.id),
    active: supersededBy.get(a.id).length === 0,
  }));
}

// Minimal, dependency-free markdown → HTML for the reading panels.
// Subset: # / ## / ### headings, `- `/`* ` lists, blank-line paragraphs,
// **bold**, `code`. Escape-first so HTML in the source can never inject. design D4.
export function mdToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = false;
  let para = [];
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li = line.match(/^[-*]\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length + 2; // # -> h3
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
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

// Recursive ADR card: a top-level (active) ADR, with the ADRs it supersedes
// folded into a native <details> beneath it (default-collapsed). design D3.
function renderAdrCard(a, byId, visited, isTop) {
  if (!a || visited.has(a.id)) return '';
  visited.add(a.id);
  const childIds = (a.supersedes || [])
    .map((r) => (typeof r === 'string' ? r : r && r.id))
    .filter((id) => id && byId.has(id));
  const related = (a.related || []).map((r) => (typeof r === 'string' ? r : r && r.id)).filter(Boolean);
  const relHtml = related.length
    ? `<div class="refs">related: ${related.map((id) => `<a href="#adr-${esc(id)}">${esc(id)}</a>`).join(', ')}</div>`
    : '';
  const folded = childIds.length
    ? `<details class="superseded-wrap"><summary>取代了 ${childIds.length} 条旧决策</summary>${childIds
        .map((id) => renderAdrCard(byId.get(id), byId, visited, false))
        .join('')}</details>`
    : '';
  const tag = isTop ? `data-adr-top="${esc(a.id)}"` : `data-superseded="${esc(a.id)}"`;
  return `<article class="adr-card${isTop ? '' : ' is-superseded'}" id="adr-${esc(a.id)}" ${tag}>
    <h3 class="adr-title">${esc(a.title)} <span class="pill">${esc(a.status)}</span></h3>
    <div class="meta">id <code>${esc(a.id)}</code> · by ${esc(a.createdBy)}${a.active ? '' : ' · superseded'}</div>
    <div class="prose">${mdToHtml(a.body || '')}</div>
    ${relHtml}
    ${folded}
  </article>`;
}

export function renderHtml(model, { defaultLens = 'self' } = {}) {
  const lens = defaultLens === 'overview' ? 'overview' : 'self';

  // ---- Overview panel: workspace cards + side rail ----
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
            .map((u) => `<span class="pill ${u.isCurrent ? 'mine' : 'overview-only'}">${esc(u.user)} · ${u.terms}</span>`)
            .join(' ')
        : '<span class="empty">none</span>';
      return `<section class="card">
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
        <p>Public glossary: <b>${w.publicTerms}</b> term(s). Stagers: ${stagers}</p>
      </section>`;
    })
    .join('\n');

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

  const sorted = [...(model.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const activityRows = sorted.length
    ? sorted
        .map(
          (e) =>
            `<li class="${e.user === model.currentUser ? 'mine' : 'overview-only'}"><span class="pill">${esc(
              e.user
            )}</span> ${esc(e.kind)} <code>${esc(e.adrId)}</code> <span class="mut">${esc(e.workspace)} · ${esc(e.at)}</span></li>`
        )
        .join('')
    : '<li class="empty">none</li>';

  const contribRows = (model.contributions || [])
    .map((c) => `<tr><td>${esc(c.user)}</td><td>${c.created}</td><td>${c.touched}</td></tr>`)
    .join('');
  const contributions = `<section class="card overview-only"><h2>Contributions</h2>
    ${contribRows ? `<table><thead><tr><th>user</th><th>created</th><th>touched</th></tr></thead><tbody>${contribRows}</tbody></table>` : '<p class="empty">none</p>'}
  </section>`;

  const userRows = model.users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.registeredAt)}</td></tr>`).join('');

  const overviewPanel = `<div class="panel" data-panel="overview"><div class="grid-2">
    <div class="col">
      ${healthBar}
      ${wsCards || '<p class="empty">No workspaces yet.</p>'}
    </div>
    <div class="col">
      <section class="card"><h2>Activity pulse</h2><ul class="feed">${activityRows}</ul></section>
      ${contributions}
      <section class="card"><h2>Users</h2>
      ${model.users.length ? `<table><thead><tr><th>username</th><th>registeredAt</th></tr></thead><tbody>${userRows}</tbody></table>` : '<p class="empty">none</p>'}
      </section>
    </div>
  </div></div>`;

  // ---- ADR panel: active ADRs top-level; superseded folded beneath ----
  const adrPanel = `<div class="panel reading" data-panel="adr">${
    model.workspaces
      .map((w) => {
        const byId = new Map(w.adrs.map((a) => [a.id, a]));
        const visited = new Set();
        const tops = w.adrs.filter((a) => a.active);
        const cards = tops.map((a) => renderAdrCard(a, byId, visited, true)).join('');
        return `<section class="ws-block"><h2 class="ws-h">${esc(w.title || w.id)} <span class="mut">${tops.length} active / ${w.adrs.length} total</span></h2>${
          cards || '<p class="empty">no ADRs</p>'
        }</section>`;
      })
      .join('') || '<p class="empty">No workspaces yet.</p>'
  }</div>`;

  // ---- Context panel: public glossary + staging (self/overview) ----
  const contextPanel = `<div class="panel reading" data-panel="context">${
    model.workspaces
      .map((w) => {
        const pub = `<section class="card glossary" data-context-public><h3>公共术语库 · <span class="mut">${w.publicTerms} term(s)</span></h3><div class="prose">${mdToHtml(
          w.publicContext
        )}</div></section>`;
        const stagings = w.contextUsers.length
          ? w.contextUsers
              .map(
                (u) =>
                  `<section class="staging ${u.isCurrent ? 'mine' : 'overview-only'}" data-staging-user="${esc(u.user)}"><h3>${esc(
                    u.user
                  )} 的暂存 ${u.isCurrent ? '<span class="pill mine">你</span>' : ''} · <span class="mut">${u.terms} term(s)</span></h3><div class="prose">${mdToHtml(
                    u.content
                  )}</div></section>`
              )
              .join('')
          : '';
        return `<section class="ws-block"><h2 class="ws-h">${esc(w.title || w.id)}</h2><p class="hint">个人暂存经 <code>inlay-context-aggregate</code> Skill 提升进公共库 · 面板只读，不做合并。</p>${pub}${stagings}</section>`;
      })
      .join('') || '<p class="empty">No workspaces yet.</p>'
  }</div>`;

  const modelJson = JSON.stringify(model).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inlay</title>
<style>
  :root{--bg:#0d1117;--surface:#161b22;--card:#1a2027;--line:#222b34;--fg:#e6edf3;--mut:#8b98a5;--accent:#4ea1ff;--ok:#2ea043;--warn:#d29922;--bad:#f85149}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,Segoe UI,Roboto,sans-serif}
  .appbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:20px;padding:12px 28px;background:rgba(13,17,23,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .brand{font-weight:700;font-size:16px;letter-spacing:.02em} .brand small{color:var(--mut);font-weight:400;margin-left:8px;font-size:12px}
  nav.tabs{display:flex;gap:4px} nav.tabs button{background:transparent;border:0;color:var(--mut);padding:7px 14px;border-radius:8px;cursor:pointer;font:inherit}
  nav.tabs button:hover{color:var(--fg);background:rgba(255,255,255,.04)} nav.tabs button[aria-current=true]{color:var(--fg);background:rgba(78,161,255,.14)}
  .spacer{flex:1}
  .lens{display:inline-flex;background:#0b0f14;border:1px solid var(--line);border-radius:999px;padding:2px}
  .lens button{background:transparent;border:0;color:var(--mut);padding:5px 12px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px}
  .lens button[aria-pressed=true]{color:#fff;background:var(--accent)}
  .tools{display:flex;gap:8px;align-items:center}
  .tools input,.tools select{background:#0b0f14;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px}
  main{padding:24px 28px;max-width:1180px;margin:0 auto}
  .panel{display:none} body[data-view="overview"] [data-panel="overview"],body[data-view="adr"] [data-panel="adr"],body[data-view="context"] [data-panel="context"]{display:block}
  .grid-2{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start} .col{display:grid;gap:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
  h2{margin:0 0 6px;font-size:16px} h3{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
  .meta,.mut,.hint{color:var(--mut);font-size:12px} .hint{margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top} th{color:var(--mut);font-weight:600}
  code{background:#0b0f14;padding:1px 6px;border-radius:5px;color:var(--accent);font-size:12px}
  .pill{display:inline-block;background:#0b0f14;border:1px solid #2a3640;border-radius:999px;padding:1px 9px;font-size:12px;color:var(--fg);margin:1px 0}
  .pill.mine{border-color:var(--accent);color:#cfe6ff}
  .status{font-size:11px;padding:2px 9px;border-radius:999px;margin-right:4px}
  .status.ok{background:rgba(46,160,67,.15);color:var(--ok)} .status.orphan{background:rgba(210,153,34,.15);color:var(--warn)} .status.broken{background:rgba(248,81,73,.15);color:var(--bad)}
  .empty{color:var(--mut)} ul{margin:6px 0;padding-left:18px} li{margin:3px 0} .feed li{list-style:none} .feed{padding-left:0}
  .graph{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-top:6px;background:#11161d}
  /* reading panels */
  .reading{max-width:860px;margin:0 auto} .ws-block{margin-bottom:34px} .ws-h{font-size:18px;border-bottom:1px solid var(--line);padding-bottom:8px}
  .adr-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:14px 0}
  .adr-card .adr-title{font-size:16px;text-transform:none;letter-spacing:0;color:var(--fg);margin:0 0 4px}
  .adr-card.is-superseded{opacity:.85;border-style:dashed;margin:10px 0}
  .superseded-wrap{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}
  .superseded-wrap>summary{cursor:pointer;color:var(--mut);font-size:12px;list-style:none}
  .superseded-wrap>summary:hover{color:var(--fg)} .superseded-wrap[open]>summary{color:var(--fg)}
  .refs{font-size:12px;color:var(--mut);margin-top:8px} .refs a{color:var(--accent);text-decoration:none}
  .prose{font-size:14px} .prose h3,.prose h4,.prose h5{text-transform:none;letter-spacing:0;color:var(--fg);margin:10px 0 4px} .prose p{margin:6px 0} .prose code{font-size:13px}
  .glossary,.staging{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:12px 0}
  .staging.mine{border-color:rgba(78,161,255,.4)}
  body.lens-self .overview-only{display:none}
</style></head>
<body data-default-lens="${lens}" class="lens-${lens}" data-view="overview">
<div class="appbar">
  <span class="brand">Inlay<small>${esc(model.root)}</small></span>
  <nav class="tabs">
    <button data-nav="overview" aria-current="true">总览</button>
    <button data-nav="adr" aria-current="false">ADR</button>
    <button data-nav="context" aria-current="false">Context</button>
  </nav>
  <span class="spacer"></span>
  <span class="tools">
    <input id="q" type="search" placeholder="搜索 ADR…" aria-label="search">
    <select id="statusFilter" aria-label="filter by status">
      <option value="">all status</option>
      <option value="proposed">proposed</option>
      <option value="accepted">accepted</option>
      <option value="rejected">rejected</option>
      <option value="superseded">superseded</option>
    </select>
  </span>
  <span class="lens" role="group" aria-label="视角">
    <button data-lens-btn="self" aria-pressed="true">自身</button>
    <button data-lens-btn="overview" aria-pressed="false">总览</button>
  </span>
</div>
<main>
  ${overviewPanel}
  ${adrPanel}
  ${contextPanel}
</main>
<script id="inlay-model" type="application/json">${modelJson}</script>
<script>
(function(){
  var body=document.body;
  function setLens(l){
    body.classList.remove('lens-self','lens-overview'); body.classList.add('lens-'+l);
    var b=document.querySelectorAll('[data-lens-btn]');
    for(var i=0;i<b.length;i++){ b[i].setAttribute('aria-pressed', b[i].getAttribute('data-lens-btn')===l?'true':'false'); }
  }
  function setView(v){
    body.setAttribute('data-view',v);
    var b=document.querySelectorAll('[data-nav]');
    for(var i=0;i<b.length;i++){ b[i].setAttribute('aria-current', b[i].getAttribute('data-nav')===v?'true':'false'); }
  }
  var lb=document.querySelectorAll('[data-lens-btn]');
  for(var i=0;i<lb.length;i++){ (function(x){ x.addEventListener('click',function(){ setLens(x.getAttribute('data-lens-btn')); }); })(lb[i]); }
  var nb=document.querySelectorAll('[data-nav]');
  for(var j=0;j<nb.length;j++){ (function(x){ x.addEventListener('click',function(){ setView(x.getAttribute('data-nav')); }); })(nb[j]); }
  setLens(body.getAttribute('data-default-lens')||'self'); setView('overview');
  function applyFilters(){
    var qel=document.getElementById('q'), sel=document.getElementById('statusFilter');
    var q=(qel&&qel.value||'').toLowerCase(), st=(sel&&sel.value)||'';
    var rows=document.querySelectorAll('tr[data-row]');
    for(var i=0;i<rows.length;i++){ var tr=rows[i];
      var okText=tr.getAttribute('data-row').indexOf(q)>=0, okStatus=!st||tr.getAttribute('data-status')===st;
      tr.style.display=(okText&&okStatus)?'':'none'; }
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
