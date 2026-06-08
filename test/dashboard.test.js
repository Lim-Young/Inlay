import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempRoot, rm, exists, read } from './helpers.js';
import { initProject } from '../src/init.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr, touchAdr, listAdr } from '../src/adr.js';
import { addContext } from '../src/context.js';
import { scanProject, renderHtml, generateDashboard, annotateSupersession, mdToHtml } from '../src/dashboard.js';

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

test('ADR panel folds superseded ADRs under their superseder', () => {
  const root = setup();
  try {
    const b = listAdr({ root, sid: SID })[0].id; // existing "Use Node crypto"
    newAdr({ root, sid: SID, title: 'Use streaming hash', supersedes: [b], env: { INLAY_USER: 'A1' } });
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    // superseded B is nested in a collapse, not a top-level card
    assert.match(html, /<details/, 'uses native collapse');
    assert.match(html, new RegExp('data-superseded="' + b + '"'), 'B nested as superseded');
    assert.ok(!new RegExp('data-adr-top="' + b + '"').test(html), 'B is not a top-level card');
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
