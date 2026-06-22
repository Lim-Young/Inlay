import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempRoot, rm, exists, read } from './helpers.js';
import { initProject } from '../src/init.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr, touchAdr, listAdr } from '../src/adr.js';
import { addContext } from '../src/context.js';
import { scanProject, renderHtml, generateDashboard, annotateSupersession, mdToHtml, buildSupersessionChains, buildActivitySparkline, buildHealthSummary, renderSparkline, renderBarChart, renderDonut, renderAdrListItems } from '../src/dashboard.js';

const SID = 'sid';
function setup() {
  const root = makeTempRoot();
  initProject({ root, env: { INLAY_USER: 'A1' } });
  createWorkspace({ root, id: 'hashcalc', title: 'Hash Calculator', env: { INLAY_USER: 'A1' } });
  useWorkspace({ root, id: 'hashcalc', sid: SID });
  newAdr({ root, sid: SID, title: 'Use Node crypto for hashing', env: { INLAY_USER: 'A1' } });
  addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
  addContext({ root, sid: SID, env: { INLAY_USER: 'B2' } });
  return root;
}

test('scanProject gathers workspaces, ADRs, context users, and registered users', () => {
  const root = setup();
  try {
    const model = scanProject({ root });
    const ws = model.workspaces.find((w) => w.id === 'hashcalc');
    assert.ok(ws);
    assert.equal(ws.adrs.length, 1);
    assert.match(ws.adrs[0].title, /Node crypto/);
    assert.deepEqual(ws.contextUsers.map((c) => c.user).sort(), ['A1', 'B2']);
  } finally {
    rm(root);
  }
});

test('scanProject injects currentUser and retains full ADR frontmatter fields', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    assert.equal(model.currentUser, 'A1');
    const ws = model.workspaces.find((w) => w.id === 'hashcalc');
    const adr = ws.adrs[0];
    // full frontmatter retained for client-side relationship graph
    for (const key of ['id', 'title', 'status', 'createdBy', 'createdAt', 'modifiedBy', 'supersedes', 'related']) {
      assert.ok(key in adr, `adr missing field: ${key}`);
    }
    assert.ok(Array.isArray(adr.modifiedBy));
    assert.ok(Array.isArray(adr.supersedes));
    assert.ok(Array.isArray(adr.related));
  } finally {
    rm(root);
  }
});

test('scanProject reports health (status + verify problems) and per-user contributions', () => {
  const root = setup();
  try {
    const adrId = listAdr({ root, sid: SID })[0].id;
    touchAdr({ root, sid: SID, id: adrId, env: { INLAY_USER: 'B2' } });
    const model = scanProject({ root, currentUser: 'A1' });
    // health: per-workspace status + verify problems
    assert.ok(model.health, 'has health');
    const h = model.health.workspaces.find((x) => x.id === 'hashcalc');
    assert.equal(h.status, 'ok');
    assert.deepEqual(h.problems, [], 'clean ADRs → no verify problems');
    // contributions: A1 created the ADR, B2 touched it
    const a1 = model.contributions.find((c) => c.user === 'A1');
    const b2 = model.contributions.find((c) => c.user === 'B2');
    assert.equal(a1.created, 1);
    assert.equal(b2.touched, 1);
  } finally {
    rm(root);
  }
});

test('scanProject reports context divergence: per-user term counts + publicTerms + isCurrent', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    const ws = model.workspaces.find((w) => w.id === 'hashcalc');
    assert.equal(typeof ws.publicTerms, 'number');
    const a1 = ws.contextUsers.find((c) => c.user === 'A1');
    const b2 = ws.contextUsers.find((c) => c.user === 'B2');
    assert.equal(typeof a1.terms, 'number');
    assert.equal(a1.isCurrent, true);
    assert.equal(b2.isCurrent, false);
  } finally {
    rm(root);
  }
});

test('mdToHtml renders a safe markdown subset and escapes HTML injection', () => {
  assert.match(mdToHtml('# Title'), /<h[1-6][^>]*>Title<\/h[1-6]>/);
  assert.match(mdToHtml('**bold**'), /<strong>bold<\/strong>/);
  assert.match(mdToHtml('use `code` here'), /<code>code<\/code>/);
  const list = mdToHtml('- one\n- two');
  assert.match(list, /<ul>/);
  assert.match(list, /<li>one<\/li>/);
  // injection is escaped, never emitted raw
  const evil = mdToHtml('hi <script>alert(1)</script>');
  assert.ok(!/<script>/.test(evil), 'no raw script tag');
  assert.match(evil, /&lt;script&gt;/);
});

test('annotateSupersession marks superseded ADRs inactive and records who superseded them', () => {
  const adrs = annotateSupersession([
    { id: 'A', supersedes: ['B'], related: [] },
    { id: 'B', supersedes: [], related: [] },
  ]);
  const a = adrs.find((x) => x.id === 'A');
  const b = adrs.find((x) => x.id === 'B');
  assert.equal(a.active, true);
  assert.deepEqual(a.supersededBy, []);
  assert.equal(b.active, false);
  assert.deepEqual(b.supersededBy, ['A']);
});

test('annotateSupersession accepts object refs ({id}) and ignores out-of-scope ids', () => {
  const adrs = annotateSupersession([{ id: 'A', supersedes: [{ id: 'B' }, 'ZZZ'], related: [] }, { id: 'B' }]);
  assert.equal(adrs.find((x) => x.id === 'B').active, false);
});

test('scanProject keeps each user staging content for the Context panel', () => {
  const root = setup();
  try {
    const ws = scanProject({ root, currentUser: 'A1' }).workspaces.find((w) => w.id === 'hashcalc');
    const a1 = ws.contextUsers.find((c) => c.user === 'A1');
    assert.equal(typeof a1.content, 'string');
    assert.match(a1.content, /Language/);
  } finally {
    rm(root);
  }
});

test('scanProject keeps each ADR body for the reading panel', () => {
  const root = setup();
  try {
    const ws = scanProject({ root, currentUser: 'A1' }).workspaces.find((w) => w.id === 'hashcalc');
    assert.equal(typeof ws.adrs[0].body, 'string');
    assert.match(ws.adrs[0].body, /TODO/);
  } finally {
    rm(root);
  }
});

test('scanProject builds an activity stream from created + modifiedBy events', () => {
  const root = setup();
  try {
    const adrId = listAdr({ root, sid: SID })[0].id;
    touchAdr({ root, sid: SID, id: adrId, env: { INLAY_USER: 'B2' } });
    const model = scanProject({ root, currentUser: 'A1' });
    assert.ok(Array.isArray(model.activity));
    const created = model.activity.find((e) => e.kind === 'created' && e.adrId === adrId);
    const touched = model.activity.find((e) => e.kind === 'touched' && e.adrId === adrId);
    assert.ok(created, 'has created event');
    assert.equal(created.user, 'A1');
    assert.equal(created.workspace, 'hashcalc');
    assert.ok(created.at, 'created event has timestamp');
    assert.ok(touched, 'has touched event');
    assert.equal(touched.user, 'B2');
  } finally {
    rm(root);
  }
});

test('renderHtml inlines the full model as parseable JSON', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    const html = renderHtml(model);
    const m = html.match(/<script id="inlay-model" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m, 'has inline model script tag');
    const parsed = JSON.parse(m[1]);
    assert.equal(parsed.currentUser, 'A1');
    assert.ok(parsed.workspaces.find((w) => w.id === 'hashcalc'));
    assert.ok(Array.isArray(parsed.activity));
  } finally {
    rm(root);
  }
});

test('renderHtml defaults to the self lens with an overview control', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.match(html, /data-default-lens="self"/);
    assert.match(html, /data-lens-btn="overview"/, 'has an overview lens control');
  } finally {
    rm(root);
  }
});

test('renderHtml has no security-disclaimer banner (productized)', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(!/不是安全|默认筛选|文件不外发|全部团队数据内联/.test(html), 'no disclaimer banner');
  } finally {
    rm(root);
  }
});

test('renderHtml provides Overview / ADR / Context panel navigation', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.match(html, /data-nav="overview"/);
    assert.match(html, /data-nav="adr"/);
    assert.match(html, /data-nav="context"/);
    assert.match(html, /data-panel="adr"/);
    assert.match(html, /data-panel="context"/);
  } finally {
    rm(root);
  }
});

test('ADR panel: superseded ADRs folded into chains in list view', () => {
  const root = setup();
  try {
    const b = listAdr({ root, sid: SID })[0].id; // existing "Use Node crypto"
    newAdr({ root, sid: SID, title: 'Use streaming hash', supersedes: [b], env: { INLAY_USER: 'A1' } });
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    // new format: superseded B is part of a chain, not a top-level list item
    // The chain shows "2 versions" since A supersedes B
    assert.match(html, /versions/, 'chain shows version count');
    assert.match(html, /adr-list-item/, 'uses list item format');
    // The superseded ADR IS in the model (in the inline JSON), just not as a separate top-level card
    assert.ok(html.includes(b), 'superseded ADR id present in model');
  } finally {
    rm(root);
  }
});

test('Context panel shows public + own staging, marks others overview-only', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.match(html, /data-context-public/, 'renders public glossary');
    assert.match(html, /class="staging mine" data-staging-user="A1"/);
    assert.match(html, /class="staging overview-only" data-staging-user="B2"/);
  } finally {
    rm(root);
  }
});

test('renderHtml honors an explicit defaultLens override', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    assert.match(renderHtml(model), /data-default-lens="self"/);
    assert.match(renderHtml(model, { defaultLens: 'overview' }), /data-default-lens="overview"/);
  } finally {
    rm(root);
  }
});

test('renderHtml output is self-contained (no external resources)', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), 'no external src/href');
    assert.ok(!/<script[^>]+src=/i.test(html), 'no external script src');
  } finally {
    rm(root);
  }
});

test('generateDashboard writes a self-contained HTML file (no external deps) to outDir', () => {
  const root = setup();
  try {
    const outDir = path.join(root, 'out');
    const r = generateDashboard({ root, outDir });
    assert.ok(exists(r.path));
    assert.match(path.basename(r.path), /^inlay-dashboard-.*\.html$/);
    const html = read(r.path);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Hash Calculator'));
    assert.ok(html.includes('Use Node crypto for hashing'));
    assert.ok(!/src="https?:/.test(html), 'no external script deps (self-contained)');
  } finally {
    rm(root);
  }
});

// buildSupersessionChains: TDD tracer bullet — single ADR → single-element chain
test('buildSupersessionChains: single ADR forms a single-element chain', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: [], related: [] },
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].versionCount, 1);
  assert.equal(chains[0].latest.id, 'A');
  assert.deepEqual(chains[0].versions.map((v) => v.id), ['A']);
});

test('buildSupersessionChains: A supersedes B → single chain, A is latest', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: ['B'], related: [] },
    { id: 'B', supersedes: [], related: [] },
  ]);
  assert.equal(chains.length, 1, 'A and B form one chain');
  assert.equal(chains[0].versionCount, 2);
  assert.equal(chains[0].latest.id, 'A');
  assert.deepEqual(chains[0].versions.map((v) => v.id), ['A', 'B']);
});

test('buildSupersessionChains: A→B→C forms one chain, versions from newest to oldest', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: ['B'], related: [] },
    { id: 'B', supersedes: ['C'], related: [] },
    { id: 'C', supersedes: [], related: [] },
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].versionCount, 3);
  assert.equal(chains[0].latest.id, 'A');
  assert.deepEqual(chains[0].versions.map((v) => v.id), ['A', 'B', 'C']);
});

test('buildSupersessionChains: independent ADRs form separate chains', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: [], related: [] },
    { id: 'B', supersedes: [], related: [] },
    { id: 'C', supersedes: [], related: [] },
  ]);
  assert.equal(chains.length, 3);
  for (const c of chains) {
    assert.equal(c.versionCount, 1);
    assert.equal(c.versions.length, 1);
  }
});

test('buildSupersessionChains: cycle A↔B does not loop infinitely', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: ['B'], related: [] },
    { id: 'B', supersedes: ['A'], related: [] },
  ]);
  // Should produce chains without hanging
  assert.ok(chains.length >= 1);
  const allIds = chains.flatMap((c) => c.versions.map((v) => v.id));
  assert.ok(allIds.includes('A'));
  assert.ok(allIds.includes('B'));
});

test('buildSupersessionChains is a pure function (same input → same output)', () => {
  const input = [
    { id: 'A', supersedes: ['B'], related: [] },
    { id: 'B', supersedes: [], related: [] },
  ];
  const r1 = buildSupersessionChains(input);
  const r2 = buildSupersessionChains(input);
  assert.deepEqual(r1, r2);
});

test('buildSupersessionChains: object refs in supersedes are resolved', () => {
  const chains = buildSupersessionChains([
    { id: 'A', supersedes: [{ id: 'B' }], related: [] },
    { id: 'B', supersedes: [], related: [] },
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].latest.id, 'A');
});

// buildActivitySparkline: aggregate activity events by day (trailing N days)
test('buildActivitySparkline: empty activity → all-zero counts for each day', () => {
  const spark = buildActivitySparkline([], 7);
  assert.equal(spark.length, 7);
  assert.ok(spark.every((d) => d.count === 0), 'all days have count 0');
});

test('buildActivitySparkline: events counted on correct days', () => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const events = [
    { at: today + 'T10:00:00Z', user: 'A1', kind: 'created', adrId: 'X', workspace: 'w' },
    { at: today + 'T11:00:00Z', user: 'A1', kind: 'touched', adrId: 'X', workspace: 'w' },
    { at: today + 'T12:00:00Z', user: 'B2', kind: 'created', adrId: 'Y', workspace: 'w' },
  ];
  const spark = buildActivitySparkline(events, 14);
  const last = spark[spark.length - 1]; // today
  assert.equal(last.count, 3, 'three events today');
});

test('buildActivitySparkline returns stable trailing window', () => {
  const spark = buildActivitySparkline([], 30);
  assert.equal(spark.length, 30);
  // dates should be in ascending order
  for (let i = 1; i < spark.length; i++) {
    assert.ok(spark[i].date >= spark[i - 1].date, 'dates are ascending');
  }
});

test('buildActivitySparkline is a pure function', () => {
  const events = [{ at: '2026-06-20T10:00:00Z', user: 'A1', kind: 'created', adrId: 'X', workspace: 'w' }];
  assert.deepEqual(buildActivitySparkline(events, 7), buildActivitySparkline(events, 7));
});

// buildHealthSummary: aggregate workspace health status counts
test('buildHealthSummary: all ok → counts reflect ok only', () => {
  const summary = buildHealthSummary({
    workspaces: [
      { id: 'a', status: 'ok', problems: [] },
      { id: 'b', status: 'ok', problems: [] },
    ],
  });
  assert.equal(summary.ok, 2);
  assert.equal(summary.orphan, 0);
  assert.equal(summary.broken, 0);
  assert.equal(summary.total, 2);
});

test('buildHealthSummary: mixed statuses counted correctly', () => {
  const summary = buildHealthSummary({
    workspaces: [
      { id: 'a', status: 'ok', problems: [] },
      { id: 'b', status: 'orphan', problems: [] },
      { id: 'c', status: 'broken', problems: ['bad ref'] },
    ],
  });
  assert.equal(summary.ok, 1);
  assert.equal(summary.orphan, 1);
  assert.equal(summary.broken, 1);
  assert.equal(summary.total, 3);
});

test('buildHealthSummary: empty health → all zeros', () => {
  const summary = buildHealthSummary({ workspaces: [] });
  assert.equal(summary.ok, 0);
  assert.equal(summary.orphan, 0);
  assert.equal(summary.broken, 0);
  assert.equal(summary.total, 0);
});

test('buildHealthSummary: handles missing health gracefully', () => {
  const summary = buildHealthSummary(null);
  assert.equal(summary.ok, 0);
  assert.equal(summary.total, 0);
});

test('scanProject includes supersessionChains per workspace', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    const ws = model.workspaces.find((w) => w.id === 'hashcalc');
    assert.ok(Array.isArray(ws.supersessionChains));
    assert.ok(ws.supersessionChains.length >= 1);
    const chain = ws.supersessionChains[0];
    assert.ok('latest' in chain);
    assert.ok('versions' in chain);
    assert.ok('versionCount' in chain);
    assert.equal(chain.versionCount, chain.versions.length);
  } finally {
    rm(root);
  }
});

test('scanProject includes activitySparkline and healthSummary', () => {
  const root = setup();
  try {
    const model = scanProject({ root, currentUser: 'A1' });
    assert.ok(Array.isArray(model.activitySparkline));
    assert.ok(model.activitySparkline.length > 0, 'sparkline has data points');
    assert.ok(model.activitySparkline.every((d) => 'date' in d && 'count' in d));
    assert.ok(model.healthSummary);
    assert.ok('ok' in model.healthSummary);
    assert.ok('orphan' in model.healthSummary);
    assert.ok('broken' in model.healthSummary);
    assert.ok('total' in model.healthSummary);
  } finally {
    rm(root);
  }
});

test('renderHtml uses CSS custom properties (no legacy hardcoded colors)', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    // new color system uses --in-color-* variables
    assert.match(html, /--in-color-/);
    // legacy GitHub-style hardcoded hex colors should be absent
    assert.ok(!/#0d1117/.test(html), 'no legacy bg color');
    assert.ok(!/#161b22/.test(html), 'no legacy surface color');
  } finally {
    rm(root);
  }
});

test('renderHtml uses Fira Code + Fira Sans font stack', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.match(html, /Fira Code/);
    assert.match(html, /Fira Sans/);
    // system fallbacks for accessibility
    assert.match(html, /Consolas/);
    assert.match(html, /Segoe UI/);
  } finally {
    rm(root);
  }
});

// SVG chart renderers
test('renderSparkline: empty data → empty string', () => {
  assert.equal(renderSparkline([]), '');
});

test('renderSparkline: produces valid SVG with data points', () => {
  const data = [
    { date: '2026-06-20', count: 1 },
    { date: '2026-06-21', count: 3 },
    { date: '2026-06-22', count: 0 },
  ];
  const svg = renderSparkline(data);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('viewBox'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('<title>'));
  assert.ok(svg.includes('<polyline'));
});

test('renderSparkline: zero-count data renders flat line', () => {
  const data = [
    { date: '2026-06-20', count: 0 },
    { date: '2026-06-21', count: 0 },
  ];
  const svg = renderSparkline(data);
  assert.ok(svg.includes('<polyline')); // still renders, just at zero
});

test('renderBarChart: empty contributions → empty string', () => {
  assert.equal(renderBarChart([]), '');
});

test('renderBarChart: produces valid SVG with bar for each contributor', () => {
  const contribs = [{ user: 'A1', created: 5, touched: 2 }];
  const svg = renderBarChart(contribs);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('<title>'));
  assert.ok(svg.includes('A1')); // user label
  assert.ok(svg.includes('5')); // created count
});

test('renderDonut: produces valid SVG with segments', () => {
  const svg = renderDonut(3, 1, 0);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('3')); // ok count
  assert.ok(svg.includes('1')); // orphan count
  assert.ok(svg.includes('0')); // broken count
});

test('renderDonut: all-zero renders empty ring', () => {
  const svg = renderDonut(0, 0, 0);
  assert.ok(svg.includes('<svg'));
});

test('renderBarChart: sorts by created count descending', () => {
  const contribs = [
    { user: 'B', created: 1, touched: 5 },
    { user: 'A', created: 10, touched: 1 },
  ];
  const svg = renderBarChart(contribs);
  // ">A<" in text element vs ">B<" — text label position in SVG
  const ai = svg.indexOf('>A<');
  const bi = svg.indexOf('>B<');
  assert.ok(ai >= 0 && bi >= 0, 'both labels present');
  assert.ok(ai < bi, 'A (10 created) rendered before B (1 created)');
});

// Phase 3: ADR list view renders compact items from supersession chains
test('renderAdrListItems: empty chains → empty string', () => {
  assert.equal(renderAdrListItems([]), '');
});

test('renderAdrListItems: single chain → one list item with title and status', () => {
  const chains = [
    {
      latest: { id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-01' },
      versions: [{ id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-01' }],
      versionCount: 1,
    },
  ];
  const html = renderAdrListItems(chains);
  assert.ok(html.includes('Use crypto'));
  assert.ok(html.includes('accepted'));
  assert.ok(html.includes('adr-list-item'));
});

test('renderAdrListItems: multi-version chain shows version count', () => {
  const chains = [
    {
      latest: { id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-02' },
      versions: [
        { id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-02' },
        { id: 'ADR-0', title: 'Old approach', status: 'superseded', createdBy: 'A1', createdAt: '2026-06-01' },
      ],
      versionCount: 2,
    },
  ];
  const html = renderAdrListItems(chains);
  assert.ok(html.includes('2'), 'shows version count');
  assert.ok(html.includes('history'), 'references history');
});

test('renderAdrListItems: respects workspace id for linking', () => {
  const chains = [
    {
      latest: { id: 'ADR-1', title: 'Test', status: 'proposed', createdBy: 'A1', createdAt: '2026-06-01' },
      versions: [{ id: 'ADR-1', title: 'Test', status: 'proposed', createdBy: 'A1', createdAt: '2026-06-01' }],
      versionCount: 1,
    },
  ];
  const html = renderAdrListItems(chains, 'myws');
  assert.ok(html.includes('myws'));
  assert.ok(html.includes('ADR-1'));
});

test('generateDashboard threads currentUser into the model and stays read-only', () => {
  const root = setup();
  try {
    const outDir = path.join(root, 'out');
    const before = exists(path.join(root, 'Workspaces')) ;
    const r = generateDashboard({ root, outDir, currentUser: 'A1' });
    assert.equal(r.model.currentUser, 'A1');
    assert.ok(read(r.path).includes('inlay-model'));
    // read-only: the produced file lives under outDir, not the repo tree
    assert.ok(r.path.startsWith(outDir));
    assert.equal(before, true);
  } finally {
    rm(root);
  }
});

// ---- Phase 4: ADR list view + detail view rendering (4.1) ----
test('renderAdrListItems: multi-version chain includes chain-history container and toggle', () => {
  const chains = [
    {
      latest: { id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-02' },
      versions: [
        { id: 'ADR-1', title: 'Use crypto', status: 'accepted', createdBy: 'A1', createdAt: '2026-06-02' },
        { id: 'ADR-0', title: 'Old approach', status: 'superseded', createdBy: 'A1', createdAt: '2026-06-01' },
      ],
      versionCount: 2,
    },
  ];
  const html = renderAdrListItems(chains);
  assert.ok(html.includes('chain-toggle'), 'has expandable toggle for multi-version chain');
  assert.ok(html.includes('aria-expanded="false"'), 'toggle starts collapsed');
  assert.ok(html.includes('chain-history'), 'has hidden history container');
  assert.ok(html.includes('chain-history-item'), 'includes historical version items');
  assert.ok(html.includes('Old approach'), 'historical ADR title visible in markup');
});

test('renderHtml: ADR panel includes list view, detail view, back button, and breadcrumb', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('adr-list-view'), 'has ADR list view container');
    assert.ok(html.includes('adr-detail-view'), 'has ADR detail view container');
    assert.ok(html.includes('adr-back-btn'), 'has back button');
    assert.ok(html.includes('adr-breadcrumb'), 'has breadcrumb element');
    assert.ok(html.includes('adr-detail-content'), 'has detail content area');
    assert.ok(html.includes('adr-timeline'), 'has timeline area');
  } finally {
    rm(root);
  }
});

// ---- Phase 4: hash routing, back navigation, breadcrumb (4.8) ----
test('renderHtml: includes hash routing logic (applyHash, readHash, updateHash)', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('applyHash'), 'has hash apply function');
    assert.ok(html.includes('readHash'), 'has hash read function');
    assert.ok(html.includes('updateHash'), 'has hash update function');
    assert.ok(html.includes('showAdrDetail'), 'has ADR detail function');
    assert.ok(html.includes('showAdrList'), 'has ADR list function');
    assert.ok(html.includes('hashchange'), 'listens to hashchange');
  } finally {
    rm(root);
  }
});

test('renderHtml: includes chain toggle script handlers', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('chain-toggle'), 'has chain toggle selector');
    assert.ok(html.includes('chain-history-item'), 'has chain history item selector');
    assert.ok(html.includes('e.stopPropagation()'), 'has stopPropagation for toggle clicks');
  } finally {
    rm(root);
  }
});

// ---- Phase 5: table sorting, keyboard shortcuts, full-text search (5.1) ----
test('renderHtml: includes table column sorting logic', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes("aria-sort"), 'has aria-sort attribute');
    assert.ok(html.includes('ascending'), 'has ascending sort direction');
    assert.ok(html.includes('descending'), 'has descending sort direction');
  } finally {
    rm(root);
  }
});

test('renderHtml: includes keyboard shortcut bindings for all panels', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes("key==='1'"), 'has key 1 binding (overview)');
    assert.ok(html.includes("key==='2'"), 'has key 2 binding (adr)');
    assert.ok(html.includes("key==='3'"), 'has key 3 binding (context)');
    assert.ok(html.includes("key==='/'"), 'has / binding (search focus)');
    assert.ok(html.includes("key==='Escape'"), 'has Escape binding (back/close)');
    assert.ok(html.includes("key==='?'"), 'has ? binding (help)');
  } finally {
    rm(root);
  }
});

test('renderHtml: includes full-text search over ADR body logic', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('bodyMatch'), 'has body match set for full-text search');
    assert.ok(html.includes('adr.body'), 'searches ADR body property');
    assert.ok(html.includes('matchesBody'), 'has body match flag');
    assert.ok(html.includes('setTimeout(applyFilters,150)'), 'debounced search at 150ms');
  } finally {
    rm(root);
  }
});

test('renderHtml: includes code copy button logic', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('copy-btn'), 'has copy button class');
    assert.ok(html.includes('navigator.clipboard.writeText'), 'uses clipboard API');
    assert.ok(html.includes('icon-check'), 'has check icon for copied feedback');
  } finally {
    rm(root);
  }
});

test('renderHtml: graph has zoom/pan and node click navigation', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.ok(html.includes('graph-wrap'), 'has graph container');
    assert.ok(html.includes('graph-node'), 'has graph node elements');
    assert.ok(html.includes('graph-controls'), 'has graph zoom controls');
    assert.ok(html.includes('graph-zoom-btn'), 'has zoom buttons');
    assert.ok(html.includes('hasMoved'), 'distinguishes drag from click');
  } finally {
    rm(root);
  }
});
