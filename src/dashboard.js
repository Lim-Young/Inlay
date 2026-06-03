import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from './paths.js';
import { exists, listJsonStems, readJson, nowIso } from './util.js';
import { listWorkspaces } from './workspace.js';
import { listUsers } from './identity.js';
import { parseFrontmatter } from './frontmatter.js';

// Read-only scan of the whole project (admin/review view). design.md §7.6.
export function scanProject({ root }) {
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
      ? fs.readdirSync(usersDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];
    const publicContext = exists(p.contextPublic(w.id)) ? fs.readFileSync(p.contextPublic(w.id), 'utf8') : '';
    return { ...w, adrs, contextUsers, publicContext };
  });
  return { generatedAt: nowIso(), root, users, workspaces };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function countTerms(md) {
  return (md.match(/^\*\*[^*]+\*\*/gm) || []).length;
}

export function renderHtml(model) {
  const wsCards = model.workspaces
    .map((w) => {
      const badge =
        w.status === 'ok' ? 'ok' : w.status === 'orphan' ? 'orphan' : 'broken';
      const adrRows = w.adrs
        .map(
          (a) => `<tr><td><code>${esc(a.id)}</code></td><td>${esc(a.title)}</td><td><span class="pill">${esc(
            a.status
          )}</span></td><td>${esc(a.createdBy)}</td><td>${esc((a.modifiedBy || []).map((m) => m.user).join(', '))}</td><td>${esc(
            [...(a.supersedes || []).map((s) => (typeof s === 'string' ? s : s.id)), ...(a.related || []).map((r) => r.id)].join(', ')
          )}</td></tr>`
        )
        .join('');
      return `<section class="card">
        <h2>${esc(w.title || w.id)} <span class="status ${badge}">${badge}</span></h2>
        <div class="meta">id <code>${esc(w.id)}</code> · created by ${esc(w.createdBy || '—')}</div>
        <h3>ADRs (${w.adrs.length})</h3>
        ${w.adrs.length ? `<table><thead><tr><th>id</th><th>title</th><th>status</th><th>createdBy</th><th>modifiedBy</th><th>refs</th></tr></thead><tbody>${adrRows}</tbody></table>` : '<p class="empty">none</p>'}
        <h3>Context</h3>
        <p>Public glossary: <b>${countTerms(w.publicContext)}</b> term(s). Pending stagers: ${
          w.contextUsers.length ? w.contextUsers.map((u) => `<span class="pill">${esc(u)}</span>`).join(' ') : '<span class="empty">none</span>'
        }</p>
      </section>`;
    })
    .join('\n');

  const userRows = model.users
    .map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.registeredAt)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Inlay Dashboard</title>
<style>
  :root{--bg:#0f1419;--card:#1a2027;--fg:#e6edf3;--mut:#8b98a5;--accent:#4ea1ff;--ok:#2ea043;--warn:#d29922;--bad:#f85149}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:24px 32px;border-bottom:1px solid #222b34} h1{margin:0;font-size:20px} .sub{color:var(--mut);margin-top:4px}
  main{padding:24px 32px;max-width:1100px;margin:0 auto;display:grid;gap:20px}
  .card{background:var(--card);border:1px solid #222b34;border-radius:10px;padding:18px 20px}
  h2{margin:0 0 4px;font-size:17px} h3{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
  .meta{color:var(--mut);font-size:12px} table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #222b34;vertical-align:top}
  th{color:var(--mut);font-weight:600} code{background:#0b0f14;padding:1px 6px;border-radius:5px;color:var(--accent)}
  .pill{background:#0b0f14;border:1px solid #2a3640;border-radius:999px;padding:1px 9px;font-size:12px;color:var(--fg)}
  .status{font-size:11px;padding:2px 8px;border-radius:999px;vertical-align:middle}
  .status.ok{background:rgba(46,160,67,.15);color:var(--ok)} .status.orphan{background:rgba(210,153,34,.15);color:var(--warn)} .status.broken{background:rgba(248,81,73,.15);color:var(--bad)}
  .empty{color:var(--mut)}
</style></head>
<body>
<header><h1>Inlay Dashboard</h1><div class="sub">${esc(model.root)} · generated ${esc(model.generatedAt)} · ${model.workspaces.length} workspace(s) · ${model.users.length} user(s)</div></header>
<main>
${wsCards || '<p class="empty">No workspaces yet.</p>'}
<section class="card"><h2>Users</h2>
${model.users.length ? `<table><thead><tr><th>username</th><th>registeredAt</th></tr></thead><tbody>${userRows}</tbody></table>` : '<p class="empty">none</p>'}
</section>
</main></body></html>`;
}

export function generateDashboard({ root, outDir = os.tmpdir(), stamp } = {}) {
  const model = scanProject({ root });
  const html = renderHtml(model);
  fs.mkdirSync(outDir, { recursive: true });
  const ts = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `inlay-dashboard-${ts}.html`);
  fs.writeFileSync(file, html);
  return { path: file, html, model };
}
