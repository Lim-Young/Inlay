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
    const supersessionChains = buildSupersessionChains(adrs);
    const staleRefs = findStaleRefs(adrs);
    return { ...w, adrs, contextUsers, publicContext, publicTerms, supersessionChains, staleRefs };
  });
  const activity = buildActivity(workspaces);
  const health = buildHealth(workspaces, root);
  const contributions = buildContributions(workspaces);
  const activitySparkline = buildActivitySparkline(activity, 30);
  const healthSummary = buildHealthSummary(health);
  return { generatedAt: nowIso(), root, currentUser, users, workspaces, activity, health, contributions, activitySparkline, healthSummary };
}

// Detect stale references: ADRs whose `related` field points to a superseded ADR.
// Returns { adrId -> [staleRefId, ...] }. design D8.
export function findStaleRefs(adrs) {
  const byId = new Map(adrs.map((a) => [a.id, a]));
  const map = {};
  for (const a of adrs) {
    const stale = [];
    for (const ref of a.related || []) {
      const refId = typeof ref === 'string' ? ref : ref && ref.id;
      if (!refId) continue;
      const target = byId.get(refId);
      if (target && target.status === 'superseded') stale.push(refId);
    }
    if (stale.length) map[a.id] = stale;
  }
  return map;
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

// Group ADRs into supersession chains. Each chain is an ordered list from
// newest (latest active ADR) to oldest (original). Single ADRs form chains
// of one. Cycle-detection via visited set. Pure function. design D6.
export function buildSupersessionChains(adrs) {
  // resolve a supersedes ref to its string id
  const resolveRef = (ref) => (typeof ref === 'string' ? ref : ref && ref.id);
  // supersededBy: who supersedes each ADR (same logic as annotateSupersession)
  const ids = new Set(adrs.map((a) => a.id));
  const supersededBy = new Map(adrs.map((a) => [a.id, []]));
  for (const a of adrs) {
    for (const ref of a.supersedes || []) {
      const target = resolveRef(ref);
      if (target && ids.has(target)) supersededBy.get(target).push(a.id);
    }
  }
  // roots = ADRs that nobody supersedes → chain heads
  const roots = adrs.filter((a) => supersededBy.get(a.id).length === 0);
  const byId = new Map(adrs.map((a) => [a.id, a]));
  const visited = new Set();
  const chains = [];
  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const versions = [];
    // BFS down supersedes edges to collect chain from newest to oldest
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      versions.push(cur);
      // push superseded ADRs onto stack; order reversed so they appear
      // after the superseder in the final list (newest-first)
      const children = (cur.supersedes || [])
        .map(resolveRef)
        .filter((id) => id && byId.has(id) && !visited.has(id))
        .reverse();
      for (const cid of children) stack.push(byId.get(cid));
    }
    chains.push({ latest: root, versions, versionCount: versions.length });
  }
  // any ADRs not reached due to cycles → add as single-element chains
  for (const a of adrs) {
    if (!visited.has(a.id)) {
      chains.push({ latest: a, versions: [a], versionCount: 1 });
    }
  }
  return chains;
}

// Aggregate activity events into daily counts for a trailing window of `days`.
// Returns [{date: 'YYYY-MM-DD', count: N}] in ascending order. Pure function.
export function buildActivitySparkline(events, days = 30) {
  const buckets = new Map();
  const now = new Date();
  // init all trailing days to zero
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const e of events) {
    const key = String(e.at).slice(0, 10); // YYYY-MM-DD
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

// Aggregate workspace health status counts. Pure function. design D7.
export function buildHealthSummary(health) {
  const hw = (health && health.workspaces) || [];
  return {
    ok: hw.filter((x) => x.status === 'ok').length,
    orphan: hw.filter((x) => x.status === 'orphan').length,
    broken: hw.filter((x) => x.status === 'broken').length,
    total: hw.length,
  };
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

// Inline SVG sparkline chart for activity trends. Pure function. design D4.
export function renderSparkline(data) {
  if (!data || !data.length) return '';
  const W = 280, H = 48, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? (W - 2 * pad) / (data.length - 1) : W / 2;
  const points = data
    .map((d, i) => {
      const x = pad + i * stepX;
      const y = H - pad - (d.count / max) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = data[data.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Activity sparkline: ${last.count} event(s) on ${last.date}"><title>Activity sparkline — ${last.count} event(s) on ${last.date}</title><polyline points="${points}" fill="none" stroke="var(--in-color-ok)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Inline SVG horizontal bar chart for contributions. Sorted by created count desc. design D4.
export function renderBarChart(contributions) {
  if (!contributions || !contributions.length) return '';
  const sorted = [...contributions].sort((a, b) => b.created - a.created);
  const max = Math.max(1, ...sorted.map((c) => c.created + c.touched));
  const barH = 18, gap = 6, labelW = 50, numW = 36, W = 360;
  const H = sorted.length * (barH + gap) + 4;
  const bars = sorted
    .map((c, i) => {
      const y = 4 + i * (barH + gap);
      const createdW = ((c.created / max) * (W - labelW - numW - 8)).toFixed(0);
      const touchedW = ((c.touched / max) * (W - labelW - numW - 8)).toFixed(0);
      return `<g><text x="0" y="${y + 13}" fill="var(--in-color-fg)" font-size="12" font-family="var(--in-font-sans)">${esc(c.user)}</text><rect x="${labelW}" y="${y}" width="${createdW}" height="${barH}" rx="3" fill="var(--in-color-ok)" opacity=".85"><title>${c.created} created</title></rect><rect x="${labelW + Number(createdW)}" y="${y}" width="${touchedW}" height="${barH}" rx="3" fill="var(--in-color-accent)" opacity=".6"><title>${c.touched} touched</title></rect><text x="${W}" y="${y + 13}" fill="var(--in-color-mut)" font-size="11" font-family="var(--in-font-mono)" text-anchor="end">${c.created}+${c.touched}</text></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Contribution chart"><title>Contribution chart — created (green) + touched (blue)</title>${bars}</svg>`;
}

// Inline SVG donut chart for health status. Pure function. design D4.
export function renderDonut(ok, orphan, broken) {
  const total = ok + orphan + broken || 1;
  const r = 20, c = 28, circ = 2 * Math.PI * r;
  const segments = [
    { val: ok, color: 'var(--in-color-ok)' },
    { val: orphan, color: 'var(--in-color-warn)' },
    { val: broken, color: 'var(--in-color-bad)' },
  ];
  let offset = 0;
  const rings = segments
    .filter((s) => s.val > 0)
    .map((s) => {
      const len = (s.val / total) * circ;
      const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="6" stroke-dasharray="${len.toFixed(1)} ${(circ - len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${c} ${c})"><title>${s.val}</title></circle>`;
      offset += len;
      return seg;
    })
    .join('');
  return `<svg viewBox="0 0 ${c * 2} ${c * 2}" width="56" height="56" role="img" aria-label="Health: ${ok} ok, ${orphan} orphan, ${broken} broken"><title>Health — ${ok} ok, ${orphan} orphan, ${broken} broken</title>${rings}<text x="${c}" y="${c + 4}" text-anchor="middle" fill="var(--in-color-fg)" font-size="14" font-weight="700" font-family="var(--in-font-mono)">${ok + orphan + broken}</text></svg>`;
}

// Render compact ADR list items from supersession chains. Each chain is one
// list item; chains with versionCount > 1 show a history badge. design D6.
export function renderAdrListItems(chains, workspaceId, staleRefs) {
  if (!chains || !chains.length) return '';
  return chains
    .map((c) => {
      const a = c.latest;
      const wsAttr = workspaceId ? `data-workspace="${esc(workspaceId)}"` : '';
      const isStaleAdr = staleRefs && staleRefs[a.id];
      const staleBadge = isStaleAdr
        ? `<span class="stale-badge" title="此 ADR 的 related 引用包含已 superseded 的 ADR (${isStaleAdr.join(', ')})，需要审阅">⚠ 陈旧引用</span>`
        : '';
      const chainBadge =
        c.versionCount > 1
          ? `<span class="chain-badge chain-toggle" role="button" tabindex="0" aria-expanded="false" data-chain-id="${esc(a.id)}"><svg class="svg-icon sm chevron"><use href="#icon-chevron-down"/></svg>${c.versionCount} versions</span>`
          : '';
      const historyItems =
        c.versionCount > 1
          ? c.versions
              .slice(1)
              .map((v) => {
                const vStatus = v.status === 'accepted' ? 'ok' : v.status === 'rejected' ? 'broken' : v.status === 'superseded' ? 'orphan' : '';
                return `<div class="chain-history-item" data-adr-id="${esc(v.id)}" data-workspace="${esc(workspaceId || '')}" tabindex="0" role="link" aria-label="ADR: ${esc(v.title)}">
                <span style="color:var(--in-color-mut);font-size:var(--in-size-xs);font-family:var(--in-font-mono)">${esc(v.id)}</span>
                <span style="font-size:var(--in-size-sm);margin-left:8px">${esc(v.title)}</span>
                <span class="status ${vStatus}">${esc(v.status)}</span>
              </div>`;
              })
              .join('')
          : '';
      return `<div class="adr-list-item" data-adr-id="${esc(a.id)}" data-status="${esc(a.status)}" ${wsAttr} tabindex="0" role="link" aria-label="ADR: ${esc(a.title)}">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
          <strong style="font-size:var(--in-size-base);font-family:var(--in-font-sans)">${esc(a.title)}</strong>
          <span class="status ${a.status === 'accepted' ? 'ok' : a.status === 'rejected' ? 'broken' : a.status === 'superseded' ? 'orphan' : ''}">${esc(a.status)}</span>${staleBadge}
        </div>
        <div class="meta" style="margin-top:4px">${esc(a.createdBy || '—')} · ${esc((a.createdAt || '').slice(0, 10))}${chainBadge}</div>
        ${historyItems ? `<div class="chain-history" style="display:none;margin-top:8px;border-left:2px solid var(--in-color-line);padding-left:12px">${historyItems}</div>` : ''}
      </div>`;
    })
    .join('');
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
// Single-row layout, zoomable/pannable, clickable nodes. design D5.
function renderGraph(w) {
  if (!w.adrs.length) return '';
  const ids = new Set(w.adrs.map((a) => a.id));
  const pos = new Map();
  const stepX = 130, nodeR = 16;
  const W = 40 + w.adrs.length * stepX;
  const H = 100;
  w.adrs.forEach((a, i) => pos.set(a.id, { x: 40 + i * stepX, y: 60 }));
  const edges = [];
  for (const a of w.adrs) {
    for (const t of refIds(a)) {
      if (!ids.has(t)) continue;
      const s = pos.get(a.id);
      const d = pos.get(t);
      edges.push(`<line x1="${s.x}" y1="${s.y}" x2="${d.x}" y2="${d.y}" stroke="#4ea1ff" stroke-width="1.5" marker-end="url(#arrow-${esc(w.id)})"/>`);
    }
  }
  const nodes = w.adrs
    .map((a) => {
      const c = pos.get(a.id);
      const statusClass = a.status === 'accepted' ? 'ok' : a.status === 'rejected' ? 'broken' : a.status === 'superseded' ? 'orphan' : '';
      return `<g class="graph-node" data-adr-id="${esc(a.id)}" data-workspace="${esc(w.id)}">
        <title>${esc(a.title)} · ${esc(a.status)}</title>
        <circle cx="${c.x}" cy="${c.y}" r="${nodeR}" fill="#1a2027" stroke="#2a3640"/>
        <text x="${c.x}" y="${c.y - nodeR - 6}" fill="#8b98a5" font-size="10" text-anchor="middle">${esc(a.id)}</text>
      </g>`;
    })
    .join('');
  return `<h3>Decision graph</h3>
    <div class="graph-wrap" style="width:100%;height:150px">
      <div class="graph-controls">
        <button class="graph-zoom-btn" title="Zoom in">+</button>
        <button class="graph-zoom-btn" title="Zoom out">−</button>
        <button class="graph-zoom-btn" title="Reset">↺</button>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;transform-origin:0 0">
        <defs><marker id="arrow-${esc(w.id)}" markerWidth="8" markerHeight="8" refX="20" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#4ea1ff"/></marker></defs>
        ${edges.join('')}${nodes}
      </svg>
    </div>`;
}

// Render a single ADR reference chip — rich bubble with title + status. design D7.
function renderRefChip(id, byId, workspaceId) {
  const ref = byId.get(id);
  if (!ref) return `<code>${esc(id)}</code>`;
  const st = ref.status === 'accepted' ? 'ok' : ref.status === 'rejected' ? 'broken' : ref.status === 'superseded' ? 'orphan' : '';
  const wsAttr = workspaceId ? `data-workspace="${esc(workspaceId)}"` : '';
  return `<span class="adr-ref-chip${ref.status==='superseded'?' is-stale':''}" data-ref-id="${esc(id)}" ${wsAttr} tabindex="0" role="link" title="${esc(ref.title)} · ${esc(ref.status)} · ${esc(ref.createdBy || '—')}">
    <code class="chip-id">${esc(id)}</code>
    <span class="chip-title">${esc(ref.title)}</span>
    <span class="chip-status ${st}">${esc(ref.status)}</span>
  </span>`;
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
    ? `<div class="refs">related: <span class="adr-ref-row">${related.map((id) => renderRefChip(id, byId)).join('')}</span></div>`
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
  const staleCount = model.workspaces.reduce((n, w) => n + Object.keys(w.staleRefs || {}).length, 0);
  const hs = model.healthSummary || { ok: 0, orphan: 0, broken: 0, total: 0 };
  const healthBar = `<section class="card kpi"><h2>Health</h2><div style="display:flex;align-items:center;gap:16px">
    ${renderDonut(hs.ok, hs.orphan, hs.broken)}
    <div><p style="margin:4px 0">
    <span class="status ok">${cnt('ok')} ok</span>
    <span class="status orphan">${cnt('orphan')} orphan</span>
    <span class="status broken">${cnt('broken')} broken</span>
    · verify problems: <b>${problems}</b>
    ${staleCount ? ` · <span style="color:var(--in-color-warn)">⚠ 陈旧引用: <b>${staleCount}</b></span>` : ''}</p>
    ${problems ? `<ul>${hw.flatMap((x) => (x.problems || []).map((p) => `<li><code>${esc(x.id)}</code> ${esc(p)}</li>`)).join('')}</ul>` : ''}
    </div></div></section>`;

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

  const sparklineSvg = renderSparkline(model.activitySparkline || []);
  const contribBarSvg = renderBarChart(model.contributions || []);
  const contributions = `<section class="card overview-only"><h2>Contributions</h2>
    ${contribBarSvg || '<p class="empty">no contributions yet</p>'}
  </section>`;

  const userRows = model.users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.registeredAt)}</td></tr>`).join('');

  // KPI aggregates
  const totalAdrs = model.workspaces.reduce((n, w) => n + (w.adrs || []).length, 0);
  const recentActivityCount = (model.activity || []).length;
  const hs2 = model.healthSummary || { ok: 0, orphan: 0, broken: 0, total: 0 };

  const kpiRow = `<div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-label">Workspaces</div>
      <div class="kpi-value" style="color:var(--in-color-fg)">${model.workspaces.length}</div>
      <div class="kpi-sub">${hs2.ok} healthy</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">ADRs</div>
      <div class="kpi-value" style="color:var(--in-color-accent)">${totalAdrs}</div>
      <div class="kpi-sub">across ${model.workspaces.length} workspace(s)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Health</div>
      <div class="kpi-value" style="color:var(--in-color-ok)">${hs2.ok}<span style="font-size:var(--in-size-base);color:var(--in-color-mut);font-weight:400">/${hs2.total}</span></div>
      <div class="kpi-sub"><span style="color:var(--in-color-ok)">${hs2.ok} ok</span> · <span style="color:var(--in-color-warn)">${hs2.orphan} orphan</span> · <span style="color:var(--in-color-bad)">${hs2.broken} broken</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Activity</div>
      <div class="kpi-value" style="color:var(--in-color-fg-dim)">${recentActivityCount}</div>
      <div class="kpi-sub">total events</div>
    </div>
  </div>`;

  const overviewPanel = `<div class="panel" data-panel="overview">
    ${kpiRow}
    <div class="grid-2">
    <div class="col">
      ${healthBar}
      ${wsCards || '<p class="empty">No workspaces yet.</p>'}
    </div>
    <div class="col">
      <section class="card"><h2>Activity pulse</h2>${sparklineSvg ? `<div style="margin-bottom:12px">${sparklineSvg}</div>` : ''}<ul class="feed">${activityRows}</ul></section>
      ${contributions}
      <section class="card"><h2>Users</h2>
      ${model.users.length ? `<table><thead><tr><th>username</th><th>registeredAt</th></tr></thead><tbody>${userRows}</tbody></table>` : '<p class="empty">none</p>'}
      </section>
    </div>
  </div></div>`;

  // ---- ADR panel: list view (compact) + detail view placeholder ----
  const adrPanel = `<div class="panel" data-panel="adr">
    <div class="adr-list-view" data-adr-list>${
      model.workspaces
        .map((w) => {
          const listItems = renderAdrListItems(w.supersessionChains, w.id, w.staleRefs);
          const chainCount = w.supersessionChains ? w.supersessionChains.length : 0;
          return `<section class="ws-block"><h2 class="ws-h">${esc(w.title || w.id)} <span class="mut">${chainCount} chain(s) · ${w.adrs.length} ADRs</span></h2>${
            listItems || '<p class="empty">no ADRs</p>'
          }</section>`;
        })
        .join('') || '<p class="empty">No workspaces yet.</p>'
    }</div>
    <div class="adr-detail-view" data-adr-detail style="display:none">
      <button class="adr-back-btn" onclick="showAdrList()" style="background:var(--in-color-surface);border:1px solid var(--in-color-line);color:var(--in-color-fg);border-radius:var(--in-radius-sm);padding:6px 14px;cursor:pointer;font:inherit;margin-bottom:16px">
        <svg class="svg-icon"><use href="#icon-back"/></svg> Back to list
      </button>
      <div class="adr-breadcrumb" style="font-size:var(--in-size-xs);color:var(--in-color-mut);margin-bottom:12px"></div>
      <div class="adr-detail-content"></div>
      <div class="adr-timeline" style="margin-top:24px"></div>
    </div>
  </div>`;

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
  :root{
    /* Slate Indigo color system — surface layering: bg → surface → card → elevated */
    --in-color-bg:#0F172A;--in-color-surface:#1E293B;--in-color-card:#172033;--in-color-elevated:#1E2D47;
    --in-color-line:rgba(255,255,255,.06);--in-color-line-strong:rgba(255,255,255,.10);
    --in-color-fg:#EDEDEF;--in-color-fg-dim:#CBD5E1;--in-color-mut:#94A3B8;
    --in-color-accent:#818CF8;--in-color-accent-soft:rgba(129,140,248,.12);--in-color-accent-glow:rgba(129,140,248,.18);
    --in-color-ok:#22C55E;--in-color-ok-soft:rgba(34,197,94,.10);--in-color-ok-glow:rgba(34,197,94,.18);
    --in-color-warn:#F59E0B;--in-color-warn-soft:rgba(245,158,11,.10);
    --in-color-bad:#EF4444;--in-color-bad-soft:rgba(239,68,68,.10);
    --in-color-code-bg:rgba(0,0,0,.25);--in-color-input-bg:rgba(0,0,0,.20);
    /* spacing (4px grid) */
    --in-space-xs:4px;--in-space-sm:8px;--in-space-md:16px;--in-space-lg:24px;--in-space-xl:32px;--in-space-2xl:48px;
    /* font sizes */
    --in-size-xs:12px;--in-size-sm:13px;--in-size-base:14px;--in-size-md:16px;--in-size-lg:18px;--in-size-xl:24px;--in-size-2xl:28px;
    /* font families */
    --in-font-mono:"Fira Code",Consolas,"Courier New",monospace;--in-font-sans:"Fira Sans","Segoe UI",system-ui,sans-serif;
    /* radii */
    --in-radius-sm:6px;--in-radius-md:10px;--in-radius-lg:14px;--in-radius-xl:18px;--in-radius-pill:999px;
    /* shadows & effects */
    --in-shadow-sm:0 1px 2px rgba(0,0,0,.30);--in-shadow-md:0 4px 12px rgba(0,0,0,.40);--in-shadow-glow:0 0 24px var(--in-color-ok-glow);
    --in-ease-out:cubic-bezier(.16,1,.3,1);--in-ease-in:cubic-bezier(.4,0,1,1);--in-ease-spring:cubic-bezier(.34,1.56,.64,1);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--in-color-bg);color:var(--in-color-fg);font:var(--in-size-md)/1.65 var(--in-font-sans);-webkit-font-smoothing:antialiased;text-wrap:pretty}
  /* focus ring */
  :focus-visible{outline:2px solid var(--in-color-accent);outline-offset:2px;border-radius:var(--in-radius-sm)}
  /* ---- appbar ---- */
  .appbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:var(--in-space-lg);padding:10px var(--in-space-xl);background:rgba(15,23,42,.85);backdrop-filter:blur(20px) saturate(1.2);-webkit-backdrop-filter:blur(20px) saturate(1.2);border-bottom:1px solid var(--in-color-line);box-shadow:0 1px 0 rgba(255,255,255,.02)}
  .brand{font-weight:700;font-size:var(--in-size-md);letter-spacing:.03em;font-family:var(--in-font-mono);color:var(--in-color-fg);display:flex;align-items:baseline;gap:var(--in-space-sm)} .brand small{color:var(--in-color-mut);font-weight:400;font-size:var(--in-size-xs);opacity:.7}
  /* tab navigation */
  nav.tabs{display:flex;gap:2px;background:var(--in-color-input-bg);border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);padding:3px}
  nav.tabs button{background:transparent;border:0;color:var(--in-color-mut);padding:6px 16px;border-radius:var(--in-radius-sm);cursor:pointer;font:inherit;font-size:var(--in-size-sm);font-weight:500;transition:color .2s var(--in-ease-out),background .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  nav.tabs button:hover{color:var(--in-color-fg)} nav.tabs button:active{transform:scale(.96)} nav.tabs button[aria-current=true]{color:var(--in-color-fg);background:var(--in-color-accent-soft);box-shadow:var(--in-shadow-sm)}
  .spacer{flex:1}
  /* lens toggle */
  .lens{display:inline-flex;background:var(--in-color-input-bg);border:1px solid var(--in-color-line);border-radius:var(--in-radius-pill);padding:2px}
  .lens button{background:transparent;border:0;color:var(--in-color-mut);padding:5px 14px;border-radius:var(--in-radius-pill);cursor:pointer;font:inherit;font-size:var(--in-size-xs);font-weight:500;transition:color .2s var(--in-ease-out),background .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  .lens button[aria-pressed=true]{color:#fff;background:var(--in-color-accent);box-shadow:0 2px 8px rgba(129,140,248,.25)}.lens button:active{transform:scale(.96)}
  /* search / filter tools */
  .tools{display:flex;gap:var(--in-space-sm);align-items:center}
  .tools input,.tools select{background:var(--in-color-input-bg);border:1px solid var(--in-color-line);color:var(--in-color-fg);border-radius:var(--in-radius-sm);padding:7px 12px;font:inherit;font-size:var(--in-size-sm);transition:border-color .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  .tools input:focus,.tools select:focus{border-color:var(--in-color-accent);box-shadow:0 0 0 3px var(--in-color-accent-soft);outline:none}
  /* ---- main layout ---- */
  main{padding:var(--in-space-xl) var(--in-space-xl);max-width:1200px;margin:0 auto}
  .panel{display:none;animation:fadeIn .2s var(--in-ease-out)} body[data-view="overview"] [data-panel="overview"],body[data-view="adr"] [data-panel="adr"],body[data-view="context"] [data-panel="context"]{display:block}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  /* overview grid */
  .grid-2{display:grid;grid-template-columns:1fr 360px;gap:var(--in-space-lg);align-items:start} .col{display:grid;gap:var(--in-space-md)}
  /* KPI row */
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--in-space-md);margin-bottom:var(--in-space-md)}
  .kpi-card{background:var(--in-color-elevated);border:1px solid var(--in-color-line);border-radius:var(--in-radius-lg);padding:var(--in-space-md) 20px;position:relative;overflow:hidden;transition:border-color .25s var(--in-ease-out),box-shadow .25s var(--in-ease-out),transform .25s var(--in-ease-out)}
  .kpi-card::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 20%,rgba(255,255,255,.10) 50%,rgba(255,255,255,.06) 80%,transparent);opacity:0;transition:opacity .25s var(--in-ease-out)}
  .kpi-card:hover{border-color:var(--in-color-line-strong);box-shadow:0 4px 20px rgba(0,0,0,.3);transform:translateY(-1px)} .kpi-card:hover::before{opacity:1}
  .kpi-card .kpi-label{font-size:var(--in-size-xs);color:var(--in-color-mut);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px}
  .kpi-card .kpi-value{font-size:var(--in-size-2xl);font-weight:700;font-family:var(--in-font-mono);line-height:1.1;font-variant-numeric:tabular-nums}
  .kpi-card .kpi-sub{font-size:var(--in-size-xs);color:var(--in-color-mut);margin-top:4px}
  /* cards */
  .card{background:var(--in-color-card);border:1px solid var(--in-color-line);border-radius:var(--in-radius-lg);padding:var(--in-space-lg) 20px;box-shadow:0 2px 8px rgba(0,0,0,.15);transition:border-color .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  .card:hover{border-color:var(--in-color-line-strong);box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .card.kpi{border-color:rgba(34,197,94,.15);background:var(--in-color-elevated);position:relative;overflow:hidden}
  .card.kpi::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--in-color-ok-glow),transparent)}
  /* headings */
  h2{margin:0 0 8px;font-size:var(--in-size-md);font-weight:600;letter-spacing:.01em;color:var(--in-color-fg-dim);text-wrap:balance}
  h3{margin:18px 0 8px;font-size:var(--in-size-xs);text-transform:uppercase;letter-spacing:.07em;color:var(--in-color-mut);font-weight:600;text-wrap:balance}
  .meta,.mut,.hint{color:var(--in-color-mut);font-size:var(--in-size-xs)} .hint{margin:0 0 14px}
  /* tables */
  table{width:100%;border-collapse:collapse;font-size:var(--in-size-sm)} th,td{text-align:left;padding:10px 10px;border-bottom:1px solid var(--in-color-line);vertical-align:top} th{color:var(--in-color-mut);font-weight:600;cursor:pointer;user-select:none;transition:color .15s;font-size:var(--in-size-xs);text-transform:uppercase;letter-spacing:.04em}
  th:hover{color:var(--in-color-fg)} th:active{transform:scale(.98)} th[aria-sort]{color:var(--in-color-accent)}
  th[aria-sort]::after{display:inline-block;margin-left:4px;font-size:10px}
  th[aria-sort=ascending]::after{content:"▲"} th[aria-sort=descending]::after{content:"▼"}
  /* inline code */
  code{background:var(--in-color-code-bg);padding:1px 6px;border-radius:var(--in-radius-sm);color:var(--in-color-accent);font-size:var(--in-size-xs);font-family:var(--in-font-mono)}
  pre{background:var(--in-color-bg);border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);padding:var(--in-space-md);overflow-x:auto;position:relative}
  pre code{background:transparent;padding:0;color:var(--in-color-fg);font-size:var(--in-size-sm)}
  .copy-btn{position:absolute;top:8px;right:8px;background:var(--in-color-surface);border:1px solid var(--in-color-line);color:var(--in-color-mut);border-radius:var(--in-radius-sm);padding:4px 8px;cursor:pointer;font-size:var(--in-size-xs);transition:color .15s var(--in-ease-out),border-color .15s var(--in-ease-out),opacity .15s var(--in-ease-out);opacity:0}
  pre:hover .copy-btn{opacity:1} .copy-btn:hover{color:var(--in-color-fg);border-color:var(--in-color-accent)}.copy-btn:active{transform:scale(.96)}
  .copy-btn.copied{color:var(--in-color-ok);border-color:var(--in-color-ok)}
  /* pills & status */
  .pill{display:inline-flex;align-items:center;background:var(--in-color-code-bg);border:1px solid var(--in-color-line);border-radius:var(--in-radius-pill);padding:2px 10px;font-size:var(--in-size-xs);color:var(--in-color-fg);margin:1px 0;font-weight:500}
  .pill.mine{border-color:var(--in-color-accent);color:var(--in-color-accent)}
  /* status badges */
  .status{font-size:10px;padding:3px 10px;border-radius:var(--in-radius-pill);margin-right:4px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
  .status.ok{background:var(--in-color-ok-soft);color:var(--in-color-ok)} .status.orphan{background:var(--in-color-warn-soft);color:var(--in-color-warn)} .status.broken{background:var(--in-color-bad-soft);color:var(--in-color-bad)}
  .stale-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:1px 7px;border-radius:var(--in-radius-pill);font-weight:600;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;background:var(--in-color-warn-soft);color:var(--in-color-warn);border:1px solid rgba(245,158,11,.25)}
  .empty{color:var(--in-color-mut)} ul{margin:6px 0;padding-left:18px} li{margin:3px 0} .feed li{list-style:none;padding:5px 0} .feed{padding-left:0}
  /* SVG icon sprite */
  .svg-icon{width:18px;height:18px;display:inline-block;vertical-align:middle;flex-shrink:0} .svg-icon.sm{width:14px;height:14px} .svg-icon.lg{width:24px;height:24px}
  /* ADR graph */
  .graph-wrap{position:relative;overflow:hidden;border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);margin-top:8px;background:var(--in-color-bg);cursor:grab;user-select:none;-webkit-user-select:none;transition:border-color .2s}
  .graph-wrap:hover{border-color:var(--in-color-line-strong)}
  .graph-wrap:active{cursor:grabbing}
  .graph-wrap svg{display:block}
  .graph-node{cursor:pointer;transition:opacity .15s}
  .graph-node:hover circle{stroke:var(--in-color-accent);stroke-width:2.5;filter:drop-shadow(0 0 4px var(--in-color-accent-glow))}
  .graph-node:active{opacity:.7}
  .graph-controls{position:absolute;bottom:8px;right:8px;display:flex;gap:2px;z-index:2}
  .graph-zoom-btn{background:var(--in-color-surface);border:1px solid var(--in-color-line);color:var(--in-color-fg);border-radius:var(--in-radius-sm);width:28px;height:28px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;line-height:1;padding:0;font-family:var(--in-font-mono);transition:background .15s var(--in-ease-out),border-color .15s var(--in-ease-out);position:relative}.graph-zoom-btn::after{content:"";position:absolute;inset:-6px}
  .graph-zoom-btn:hover{background:var(--in-color-accent-soft);border-color:var(--in-color-accent)}.graph-zoom-btn:active{transform:scale(.96)}
  /* reading panels */
  .reading{max-width:760px;margin:0 auto} .ws-block{margin-bottom:40px} .ws-h{font-size:var(--in-size-lg);font-weight:600;border-bottom:1px solid var(--in-color-line);padding-bottom:var(--in-space-sm);margin-bottom:var(--in-space-md);color:var(--in-color-fg-dim);text-wrap:balance}
  /* ADR detail view — centered reading layout */
  .adr-detail-view .adr-detail-content{max-width:760px;margin:0 auto}
  .adr-detail-view .adr-back-btn{margin-left:auto;margin-right:auto;display:block;max-width:760px}
  .adr-detail-view .adr-breadcrumb{max-width:760px;margin-left:auto;margin-right:auto}
  .adr-detail-view .adr-timeline{max-width:760px;margin-left:auto;margin-right:auto}
  .adr-detail-view .adr-card{border:none;background:transparent;padding:0}
  /* ADR cards & list items */
  .adr-card{background:var(--in-color-card);border:1px solid var(--in-color-line);border-radius:var(--in-radius-lg);padding:16px 20px;margin:14px 0;box-shadow:0 2px 8px rgba(0,0,0,.15);transition:border-color .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  .adr-card:hover{border-color:var(--in-color-line-strong);box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .adr-card .adr-title{font-size:var(--in-size-md);text-transform:none;letter-spacing:0;color:var(--in-color-fg);margin:0 0 4px;text-wrap:balance}
  .adr-card.is-superseded{opacity:.72;border-style:dashed;margin:10px 0}
  .adr-list-item{cursor:pointer;border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);padding:14px 16px;margin:6px 0;transition:border-color .2s var(--in-ease-out),background .2s var(--in-ease-out),transform .2s var(--in-ease-out)}
  .adr-list-item:hover{border-color:var(--in-color-line-strong);background:rgba(255,255,255,.02);transform:translateX(2px)}.adr-list-item:active{transform:scale(.98)}
  .adr-list-item .chain-badge{display:inline-flex;align-items:center;gap:4px;font-size:var(--in-size-xs);color:var(--in-color-mut);margin-left:var(--in-space-sm)}
  .chain-badge.chain-toggle{cursor:pointer;transition:color .15s,transform .15s var(--in-ease-out)}.chain-badge.chain-toggle:hover{color:var(--in-color-accent)}.chain-badge.chain-toggle:active{transform:scale(.96)}
  .chain-badge.chain-toggle[aria-expanded=true] .chevron{transform:rotate(180deg)}
  .chain-badge.chain-toggle .chevron{transition:transform .2s var(--in-ease-out)}
  .chain-history-item{display:flex;align-items:center;gap:6px;padding:7px 10px;margin:2px 0;border-radius:var(--in-radius-sm);cursor:pointer;transition:background .15s var(--in-ease-out),transform .15s var(--in-ease-out);font-size:var(--in-size-sm)}
  .chain-history-item:hover{background:rgba(255,255,255,.03);transform:translateX(2px)}.chain-history-item:active{transform:scale(.98)}
  .chain-history-item .status{font-size:10px;padding:1px 7px}
  /* superseded fold */
  .superseded-wrap{margin-top:12px;border-top:1px dashed var(--in-color-line);padding-top:10px}
  .superseded-wrap>summary{cursor:pointer;color:var(--in-color-mut);font-size:var(--in-size-xs);list-style:none;transition:color .15s}
  .superseded-wrap>summary:hover{color:var(--in-color-fg)} .superseded-wrap>summary:active{transform:scale(.96)} .superseded-wrap[open]>summary{color:var(--in-color-fg)}
  /* history timeline */
  .timeline{position:relative;padding-left:var(--in-space-lg);margin:var(--in-space-md) 0}
  .timeline::before{content:"";position:absolute;left:8px;top:4px;bottom:4px;width:1.5px;background:var(--in-color-line-strong)}
  .timeline-item{position:relative;padding:8px 0;padding-left:var(--in-space-md)}
  .timeline-item::before{content:"";position:absolute;left:-19px;top:14px;width:8px;height:8px;border-radius:50%;background:var(--in-color-mut)}
  .timeline-item.current::before{background:var(--in-color-ok);box-shadow:0 0 8px var(--in-color-ok-glow)}
  /* superseded folded cards (replaces timeline in detail view) */
  .superseded-fold{margin-top:var(--in-space-lg);border-top:1px solid var(--in-color-line);padding-top:var(--in-space-md)}
  .superseded-fold>summary{cursor:pointer;color:var(--in-color-mut);font-size:var(--in-size-sm);font-weight:500;list-style:none;display:flex;align-items:center;gap:6px;transition:color .15s;padding:4px 0}
  .superseded-fold>summary:hover{color:var(--in-color-fg)}.superseded-fold>summary:active{transform:scale(.96)}
  .superseded-fold[open]>summary{color:var(--in-color-fg);margin-bottom:var(--in-space-sm)}
  .superseded-fold>summary .svg-icon{opacity:.6}
  .superseded-cards{display:grid;gap:var(--in-space-sm)}
  .superseded-card{background:var(--in-color-surface);border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);padding:12px 16px;cursor:pointer;transition:border-color .2s var(--in-ease-out),background .2s var(--in-ease-out),transform .2s var(--in-ease-out)}
  .superseded-card:hover{border-color:var(--in-color-line-strong);background:rgba(255,255,255,.02);transform:translateX(2px)}.superseded-card:active{transform:scale(.98)}
  .superseded-card .superseded-card-title{font-size:var(--in-size-sm);font-weight:600;color:var(--in-color-fg);display:flex;align-items:center;gap:8px;justify-content:space-between}
  .superseded-card .superseded-card-meta{font-size:var(--in-size-xs);color:var(--in-color-mut);margin-top:4px}
  /* refs / links */
  .refs{font-size:var(--in-size-xs);color:var(--in-color-mut);margin-top:var(--in-space-sm)} .refs a{color:var(--in-color-accent);text-decoration:none;transition:color .15s}
  .refs a:hover{text-decoration:underline}
  /* ADR reference chip — rich bubble with title + status */
  .adr-ref-chip{display:inline-flex;align-items:center;gap:8px;background:var(--in-color-elevated);border:1px solid var(--in-color-line);border-radius:var(--in-radius-md);padding:6px 12px;margin:3px 4px;cursor:pointer;transition:border-color .2s var(--in-ease-out),background .2s var(--in-ease-out),transform .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out);font-size:var(--in-size-sm);text-decoration:none;color:inherit;vertical-align:middle}
  .adr-ref-chip:hover{border-color:var(--in-color-accent);background:var(--in-color-accent-soft);transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,.2)}
  .adr-ref-chip:active{transform:scale(.96)}
  .adr-ref-chip .chip-id{font-family:var(--in-font-mono);font-size:var(--in-size-xs);color:var(--in-color-accent);background:rgba(129,140,248,.10);padding:1px 6px;border-radius:var(--in-radius-sm);white-space:nowrap}
  .adr-ref-chip .chip-title{font-weight:500;color:var(--in-color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
  .adr-ref-chip .chip-status{font-size:10px;padding:1px 7px;border-radius:var(--in-radius-pill);font-weight:600;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
  .adr-ref-chip .chip-status.ok{background:var(--in-color-ok-soft);color:var(--in-color-ok)}
  .adr-ref-chip .chip-status.orphan{background:var(--in-color-warn-soft);color:var(--in-color-warn)}
  .adr-ref-chip .chip-status.broken{background:var(--in-color-bad-soft);color:var(--in-color-bad)}
  /* stale reference chip - superseded ADR referenced via related field */
  .adr-ref-chip.is-stale{border-color:var(--in-color-warn);background:var(--in-color-warn-soft);box-shadow:0 0 0 1px rgba(245,158,11,.12)}
  .adr-ref-chip.is-stale:hover{border-color:var(--in-color-warn);box-shadow:0 2px 12px rgba(245,158,11,.18)}
  .adr-ref-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px;margin-top:var(--in-space-sm)}
  /* prose / markdown reading content */
  .prose{font-size:var(--in-size-md);line-height:1.75;color:var(--in-color-fg)} .prose h3,.prose h4,.prose h5{text-transform:none;letter-spacing:0;color:var(--in-color-fg-dim);margin:24px 0 8px;font-weight:700;font-size:var(--in-size-lg);text-wrap:balance} .prose p{margin:10px 0;text-wrap:pretty} .prose code{font-size:var(--in-size-sm)} .prose strong{color:var(--in-color-fg);font-weight:700} .prose ul,.prose ol{margin:10px 0;padding-left:22px} .prose li{margin:4px 0}
  /* context panel */
  .glossary,.staging{background:var(--in-color-card);border:1px solid var(--in-color-line);border-radius:var(--in-radius-lg);padding:20px 24px;margin:16px 0;box-shadow:0 2px 8px rgba(0,0,0,.15);transition:border-color .2s var(--in-ease-out),box-shadow .2s var(--in-ease-out)}
  .glossary:hover,.staging:hover{border-color:var(--in-color-line-strong);box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .staging.mine{border-color:rgba(129,140,248,.30)}
  body.lens-self .overview-only{display:none}
  /* reduced motion */
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  /* mobile responsive (≤768px) */
  @media(max-width:768px){
    main{padding:var(--in-space-md)}
    .kpi-row{grid-template-columns:repeat(2,1fr);gap:var(--in-space-sm)}
    .grid-2{grid-template-columns:1fr}
    .appbar{flex-wrap:wrap;gap:var(--in-space-sm);padding:var(--in-space-sm) var(--in-space-md)}
    .appbar .spacer{display:none}
    .brand{font-size:var(--in-size-base)}
    nav.tabs{order:3;width:100%;justify-content:stretch}
    nav.tabs button{flex:1;text-align:center}
    .tools{order:2} .lens{order:1}
    .reading{max-width:100%}
    table{font-size:var(--in-size-xs)}
  }
  /* print styles */
  @media print{
    .appbar,nav.tabs,.tools,.lens,.copy-btn,svg.icon-sprite{display:none!important}
    body{background:#fff;color:#000;font-size:12pt}
    .panel{display:block!important;margin-bottom:2em}
    .card,.adr-card,.glossary,.staging,.kpi-card{border:1px solid #ccc;box-shadow:none;break-inside:avoid;background:#fff}
    .kpi-card::before,.card.kpi::before{display:none}
    a{color:#000;text-decoration:underline}
    .refs a::after{content:" (" attr(href) ")"}
    .status{color:#000!important;background:#eee!important}
  }
</style></head>
<body data-default-lens="${lens}" class="lens-${lens}" data-view="overview">
<!-- SVG icon sprite (hidden) -->
<svg aria-hidden="true" style="display:none" class="icon-sprite">
  <defs>
    <symbol id="icon-overview" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></symbol>
    <symbol id="icon-adr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></symbol>
    <symbol id="icon-context" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></symbol>
    <symbol id="icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>
    <symbol id="icon-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></symbol>
    <symbol id="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
    <symbol id="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></symbol>
    <symbol id="icon-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></symbol>
    <symbol id="icon-history" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></symbol>
  </defs>
</svg>
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
      <option value="active">active (default)</option>
      <option value="all">all</option>
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
  var M=JSON.parse(document.getElementById('inlay-model').textContent);
  function setLens(l){
    body.classList.remove('lens-self','lens-overview'); body.classList.add('lens-'+l);
    var b=document.querySelectorAll('[data-lens-btn]');
    for(var i=0;i<b.length;i++) b[i].setAttribute('aria-pressed', b[i].getAttribute('data-lens-btn')===l?'true':'false');
  }
  function setView(v){
    body.setAttribute('data-view',v);
    // exit ADR detail mode when switching panels (keyboard/nav)
    var dv=document.querySelector('[data-adr-detail]');
    var inDetail=dv&&dv.style.display!=='none';
    if(inDetail){dv.style.display='none';var lv=document.querySelector('[data-adr-list]');if(lv)lv.style.display='';}
    var b=document.querySelectorAll('[data-nav]');
    for(var i=0;i<b.length;i++) b[i].setAttribute('aria-current', b[i].getAttribute('data-nav')===v?'true':'false');
    if(inDetail){location.hash='#'+v;}else{updateHash();}
  }
  /* ---- hash routing ---- */
  function readHash(){
    var h=location.hash.replace(/^#/,'');
    if(!h) return {view:'overview'};
    var parts=h.split('/');
    if(parts[0]==='adr' && parts.length>=3) return {view:'adr',ws:parts[1],adrId:parts[2]};
    if(parts[0]==='overview'||parts[0]==='adr'||parts[0]==='context') return {view:parts[0]};
    return {view:'overview'};
  }
  function updateHash(){
    var h=location.hash.replace(/^#/,'');
    if(/^adr\\//.test(h)) return; // ADR detail manages its own hash
    location.hash='#'+(body.getAttribute('data-view')||'overview');
  }
  function showAdrList(){
    var lv=document.querySelector('[data-adr-list]');
    var dv=document.querySelector('[data-adr-detail]');
    if(lv) lv.style.display=''; if(dv) dv.style.display='none';
    history.pushState(null,'','#'+(body.getAttribute('data-view')||'adr'));
  }
  window.showAdrList=showAdrList;
  function showAdrDetail(ws,adrId){
    // update nav state manually — don't call setView which would exit detail
    body.setAttribute('data-view','adr');
    var nb=document.querySelectorAll('[data-nav]');
    for(var i=0;i<nb.length;i++) nb[i].setAttribute('aria-current',nb[i].getAttribute('data-nav')==='adr'?'true':'false');
    var adrs=(M.workspaces.find(function(w){return w.id===ws;})||{}).adrs||[];
    var byId={}; adrs.forEach(function(a){byId[a.id]=a;});
    var adr=byId[adrId]; if(!adr) return;
    var dv=document.querySelector('[data-adr-detail]');
    var lv=document.querySelector('[data-adr-list]');
    var bc=document.querySelector('.adr-breadcrumb');
    var content=document.querySelector('.adr-detail-content');
    var timeline=document.querySelector('.adr-timeline');
    if(lv) lv.style.display='none'; if(dv) dv.style.display='';
    if(bc) bc.innerHTML=ws+' <span style="color:var(--in-color-mut)">/</span> '+esc(adr.title);
    if(content){
      // related → bubble chips; supersedes → folded cards below
      var relatedIds=[];
      (adr.related||[]).filter(Boolean).forEach(function(r){var id=typeof r==='string'?r:r&&r.id;if(id&&byId[id])relatedIds.push(id);});
      var relChips=relatedIds.map(function(id){return renderRefChip(id,byId,ws);}).join('');
      content.innerHTML='<article class="adr-card"><h3 class="adr-title">'+esc(adr.title)+' <span class="pill">'+esc(adr.status)+'</span></h3><div class="meta">id <code>'+esc(adr.id)+'</code> · by '+esc(adr.createdBy)+' · '+esc((adr.createdAt||'').slice(0,10))+(adr.active?'':' · superseded')+'</div><div class="prose">'+(adr.body?mdToHtml(adr.body):'<p class="empty">no body</p>')+'</div>'+(relChips?'<div class="refs"><div class="adr-ref-row">'+relChips+'</div></div>':'')+'</article>';
    }
    if(timeline&&adrs.length>1){
      var chain=buildChain(adrs,adrId);
      var older=chain.filter(function(a){return a.id!==adrId;});
      if(older.length) timeline.innerHTML='<details class="superseded-fold"><summary><svg class="svg-icon sm"><use href="#icon-history"/></svg> 完整历史记录 ('+older.length+' 条)</summary><div class="superseded-cards">'+older.map(function(s){var st=s.status==='accepted'?'ok':s.status==='rejected'?'broken':s.status==='superseded'?'orphan':'';return '<div class="superseded-card" data-adr-id="'+esc(s.id)+'" data-workspace="'+esc(ws)+'" tabindex="0" role="link"><div class="superseded-card-title">'+esc(s.title)+' <span class="status '+st+'">'+esc(s.status)+'</span></div><div class="superseded-card-meta">'+esc(s.id)+' · '+esc(s.createdBy||'--')+' · '+esc((s.createdAt||'').slice(0,10))+'</div></div>';}).join('')+'</div></details>';
      else timeline.innerHTML='';
    }else if(timeline) timeline.innerHTML='';
    location.hash='#adr/'+ws+'/'+adrId;
  }
  window.showAdrDetail=showAdrDetail;
  function buildChain(adrs,currentId){
    var byId={}; adrs.forEach(function(a){byId[a.id]=a;});
    var chain=[],visited={},stack=[byId[currentId]];
    while(stack.length){var a=stack.pop();if(!a||visited[a.id]) continue;visited[a.id]=true;chain.push(a);(a.supersedes||[]).forEach(function(r){var id=typeof r==='string'?r:r&&r.id;if(id&&byId[id]&&!visited[id]) stack.push(byId[id]);});}
    return chain;
  }
  function renderTimeline(chain,currentId){
    return '<div class="timeline">'+chain.map(function(a,i){return '<div class="timeline-item'+(a.id===currentId?' current':'')+'"><div style="font-size:var(--in-size-sm)"><strong>'+esc(a.title)+'</strong> <span class="status '+(a.status==='accepted'?'ok':a.status==='rejected'?'broken':'orphan')+'">'+esc(a.status)+'</span></div><div class="mut" style="font-size:var(--in-size-xs)">'+esc(a.createdBy)+' · '+esc((a.createdAt||'').slice(0,10))+'</div></div>';}).join('')+'</div>';
  }
  /* ---- init view from hash ---- */
  function applyHash(){
    var st=readHash();
    if(st.ws && st.adrId){showAdrDetail(st.ws,st.adrId);}
    else{setView(st.view||'overview');}
  }
  window.addEventListener('hashchange',applyHash);
  /* ---- helpers ---- */
  function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
  function renderRefChip(refId,byId,ws){
    var ref=byId[refId];
    if(!ref) return '<code>'+esc(refId)+'</code>';
    var st=ref.status==='accepted'?'ok':ref.status==='rejected'?'broken':ref.status==='superseded'?'orphan':'';
    return '<span class="adr-ref-chip'+(ref.status==='superseded'?' is-stale':'')+'" data-ref-id="'+esc(refId)+'" data-workspace="'+esc(ws)+'" tabindex="0" role="link" title="'+esc(ref.title)+' · '+esc(ref.status)+' · '+esc(ref.createdBy||'—')+'"><code class="chip-id">'+esc(refId)+'</code><span class="chip-title">'+esc(ref.title)+'</span><span class="chip-status '+st+'">'+esc(ref.status)+'</span></span>';
  }
  function mdToHtml(md){
    var lines=String(md||'').replace(/\\r\\n/g,'\\n').split('\\n'),out=[],inList=false,para=[];
    function inline(s){return esc(s).replace(/\\*\\*([^\\*]+)\\*\\*/g,'<strong>$1</strong>').replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');}
    function flushPara(){if(para.length){out.push('<p>'+inline(para.join(' '))+'</p>');para=[];}}
    function closeList(){if(inList){out.push('</ul>');inList=false;}}
    for(var i=0;i<lines.length;i++){
      var line=lines[i].replace(/\\s+$/,''),h=line.match(/^(#{1,3})\\s+(.*)$/),li=line.match(/^[-*]\\s+(.*)$/);
      if(h){flushPara();closeList();out.push('<h'+(h[1].length+2)+'>'+inline(h[2])+'</h'+(h[1].length+2)+'>');}
      else if(li){flushPara();if(!inList){out.push('<ul>');inList=true;}out.push('<li>'+inline(li[1])+'</li>');}
      else if(!line.trim()){flushPara();closeList();}
      else{closeList();para.push(line.trim());}
    }
    flushPara();closeList();return out.join('\\n');
  }
  /* ---- keyboard shortcuts ---- */
  document.addEventListener('keydown',function(e){
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'){
      if(e.key==='Escape'){e.target.blur();return;}
      return;
    }
    if(e.key==='1') setView('overview');
    else if(e.key==='2') setView('adr');
    else if(e.key==='3') setView('context');
    else if(e.key==='/'||e.key==='s'){e.preventDefault();var q=document.getElementById('q');if(q) q.focus();}
    else if(e.key==='Escape'){if(document.querySelector('[data-adr-detail]')&&document.querySelector('[data-adr-detail]').style.display!=='none'){showAdrList();}else{document.getElementById('q').blur();}}
    else if(e.key==='?'&&!e.shiftKey){alert('Keyboard Shortcuts:\\n1/2/3 — Switch panels\\n/ — Search\\nEsc — Back / Close\\n? — This help');}
  });
  /* ---- full-text search ---- */
  var searchTimer=null;
  function applyFilters(){
    var qel=document.getElementById('q'),sel=document.getElementById('statusFilter');
    var q=(qel&&qel.value||'').toLowerCase(),st=(sel&&sel.value)||'';
    // table rows in overview
    var rows=document.querySelectorAll('tr[data-row]');
    for(var i=0;i<rows.length;i++){var tr=rows[i];
      var trStatus2=tr.getAttribute('data-status');
      var okText=tr.getAttribute('data-row').indexOf(q)>=0,okStatus=st==='all'?true:st&&st!=='active'?trStatus2===st:trStatus2!=='superseded';
      tr.style.display=(okText&&okStatus)?'':'none';}
    // build body-match set from inline model (fulll-text search over ADR body)
    var bodyMatch=new Set();
    if(q&&M.workspaces){for(var w=0;w<M.workspaces.length;w++){var adrs=M.workspaces[w].adrs||[];for(var a=0;a<adrs.length;a++){var adr=adrs[a];if(adr.body&&adr.body.toLowerCase().indexOf(q)>=0)bodyMatch.add(adr.id);}}}
    // ADR list items: match text OR body
    var items=document.querySelectorAll('.adr-list-item');
    for(var j=0;j<items.length;j++){var it=items[j];
      var text=(it.textContent||'').toLowerCase();
      var adrId=it.getAttribute('data-adr-id');
      var matchesBody=adrId&&bodyMatch.has(adrId);
      var itemStatus=it.getAttribute('data-status')||'';
      var matchesText=!q||text.indexOf(q)>=0||matchesBody;
      // status filter: "all" → show all; "active"/unset → hide superseded; else exact match
      var okStatus=st==='all'?true:st&&st!=='active'?itemStatus===st:itemStatus!=='superseded';
      it.style.display=(matchesText&&okStatus)?'':'none';}
    // also show chain-history items if their parent list item is visible
    var histories=document.querySelectorAll('.chain-history');
    for(var k=0;k<histories.length;k++){var h=histories[k];var parent=h.closest('.adr-list-item');if(parent&&parent.style.display==='none')h.style.display='none';}
  }
  var qel=document.getElementById('q');if(qel) qel.addEventListener('input',function(){clearTimeout(searchTimer);searchTimer=setTimeout(applyFilters,150);});
  var sel=document.getElementById('statusFilter');if(sel) sel.addEventListener('change',applyFilters);
  /* ---- table column sorting ---- */
  document.querySelectorAll('th').forEach(function(th){
    th.addEventListener('click',function(){
      var table=th.closest('table'),tbody=table&&table.querySelector('tbody');
      if(!tbody) return;
      var col=Array.prototype.indexOf.call(th.parentElement.children,th);
      var rows=Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      var dir=th.getAttribute('aria-sort')==='ascending'?'descending':'ascending';
      rows.sort(function(a,b){
        var ca=(a.children[col]||{}).textContent||'';
        var cb=(b.children[col]||{}).textContent||'';
        return dir==='ascending'?ca.localeCompare(cb):cb.localeCompare(ca);
      });
      rows.forEach(function(r){tbody.appendChild(r);});
      table.querySelectorAll('th').forEach(function(h){h.removeAttribute('aria-sort');});
      th.setAttribute('aria-sort',dir);
    });
  });
  /* ---- code block copy buttons ---- */
  document.querySelectorAll('pre code').forEach(function(code){
    var btn=document.createElement('button');btn.className='copy-btn';
    btn.innerHTML='<svg class="svg-icon sm"><use href="#icon-copy"/></svg>';
    btn.addEventListener('click',function(){
      navigator.clipboard.writeText(code.textContent).then(function(){
        btn.innerHTML='<svg class="svg-icon sm"><use href="#icon-check"/></svg>';
        btn.classList.add('copied');
        setTimeout(function(){btn.innerHTML='<svg class="svg-icon sm"><use href="#icon-copy"/></svg>';btn.classList.remove('copied');},1500);
      }).catch(function(){});
    });
    code.parentElement.appendChild(btn);
  });
  /* ---- ADR reference chip + superseded card click delegation ---- */
  document.querySelector('main').addEventListener('click',function(e){
    var chip=e.target.closest('.adr-ref-chip');
    if(chip){
      e.stopPropagation();
      var refId=chip.getAttribute('data-ref-id');
      var ws=chip.getAttribute('data-workspace');
      if(refId&&ws) showAdrDetail(ws,refId);
      return;
    }
    var sc=e.target.closest('.superseded-card');
    if(sc){
      e.stopPropagation();
      var refId=sc.getAttribute('data-adr-id');
      var ws=sc.getAttribute('data-workspace');
      if(refId&&ws) showAdrDetail(ws,refId);
    }
  });
  /* ---- ADR list item click handlers ---- */
  document.querySelectorAll('.adr-list-item').forEach(function(el){
    el.addEventListener('click',function(){
      var adrId=el.getAttribute('data-adr-id');
      var ws=el.getAttribute('data-workspace');
      if(adrId&&ws) showAdrDetail(ws,adrId);
    });
    el.addEventListener('keydown',function(e){if(e.key==='Enter'){el.click();}});
  });
  /* ---- chain history toggle ---- */
  document.querySelectorAll('.chain-toggle').forEach(function(toggle){
    toggle.addEventListener('click',function(e){
      e.stopPropagation();
      var item=toggle.closest('.adr-list-item');
      var history=item&&item.querySelector('.chain-history');
      if(!history) return;
      var expanded=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',expanded?'false':'true');
      history.style.display=expanded?'none':'';
    });
    toggle.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle.click();}});
  });
  /* ---- chain history item navigation ---- */
  document.querySelectorAll('.chain-history-item').forEach(function(el){
    el.addEventListener('click',function(e){
      e.stopPropagation();
      var adrId=el.getAttribute('data-adr-id');
      var ws=el.getAttribute('data-workspace');
      if(adrId&&ws) showAdrDetail(ws,adrId);
    });
    el.addEventListener('keydown',function(e){if(e.key==='Enter'){el.click();}});
  });
  /* ---- nav button handlers ---- */
  document.querySelectorAll('[data-nav]').forEach(function(btn){
    btn.addEventListener('click',function(){ setView(btn.getAttribute('data-nav')); });
  });
  /* ---- lens button handlers ---- */
  document.querySelectorAll('[data-lens-btn]').forEach(function(btn){
    btn.addEventListener('click',function(){ setLens(btn.getAttribute('data-lens-btn')); });
  });
  /* ---- graph zoom/pan + node click navigation ---- */
  (function(){
    var wraps=document.querySelectorAll('.graph-wrap');
    for(var gi=0;gi<wraps.length;gi++){(function(wrap){
      var svg=wrap.querySelector('svg');
      if(!svg) return;
      var scale=1,tx=0,ty=0,dragging=false,hasMoved=false;
      var startX,startY,initTx,initTy;
      function apply(){svg.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}
      function reset(){scale=1;tx=0;ty=0;apply();}
      wrap.addEventListener('wheel',function(e){
        e.preventDefault();
        var rect=wrap.getBoundingClientRect();
        var mx=e.clientX-rect.left,my=e.clientY-rect.top;
        var ns=Math.max(0.25,Math.min(4,scale+(e.deltaY>0?-0.15:0.15)));
        tx=mx-(mx-tx)*(ns/scale);ty=my-(my-ty)*(ns/scale);
        scale=ns;apply();
      },{passive:false});
      wrap.addEventListener('mousedown',function(e){
        if(e.target.closest('.graph-zoom-btn'))return;
        dragging=true;hasMoved=false;
        startX=e.clientX;startY=e.clientY;initTx=tx;initTy=ty;
      });
      window.addEventListener('mousemove',function(e){
        if(!dragging)return;
        var dx=e.clientX-startX,dy=e.clientY-startY;
        if(Math.abs(dx)>2||Math.abs(dy)>2)hasMoved=true;
        tx=initTx+dx;ty=initTy+dy;apply();
      });
      window.addEventListener('mouseup',function(){dragging=false;});
      wrap.addEventListener('click',function(e){
        if(hasMoved)return;
        var node=e.target.closest('.graph-node');
        if(!node)return;
        var adrId=node.getAttribute('data-adr-id');
        var ws=node.getAttribute('data-workspace');
        if(adrId&&ws)showAdrDetail(ws,adrId);
      });
      var btns=wrap.querySelectorAll('.graph-zoom-btn');
      if(btns[0])btns[0].addEventListener('click',function(e){e.stopPropagation();scale=Math.min(4,scale+0.3);apply();});
      if(btns[1])btns[1].addEventListener('click',function(e){e.stopPropagation();scale=Math.max(0.25,scale-0.3);apply();});
      if(btns[2])btns[2].addEventListener('click',function(e){e.stopPropagation();reset();});
    })(wraps[gi]);}
  })();
  /* ---- init ---- */
  setLens(body.getAttribute('data-default-lens')||'self');
  applyHash();
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
