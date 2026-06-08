import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempRoot, rm, exists, read } from './helpers.js';
import { initProject } from '../src/init.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr, touchAdr, listAdr } from '../src/adr.js';
import { addContext } from '../src/context.js';
import { scanProject, renderHtml, generateDashboard } from '../src/dashboard.js';

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

test('renderHtml defaults to the self lens and declares it is not a security boundary', () => {
  const root = setup();
  try {
    const html = renderHtml(scanProject({ root, currentUser: 'A1' }));
    assert.match(html, /data-default-lens="self"/);
    assert.match(html, /overview/, 'has an overview lens control');
    // honest disclosure that the self lens is a default filter, not access control
    assert.match(html, /默认筛选|不是安全|非安全/);
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
