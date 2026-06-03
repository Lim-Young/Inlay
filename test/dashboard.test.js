import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempRoot, rm, exists, read } from './helpers.js';
import { initProject } from '../src/init.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr } from '../src/adr.js';
import { addContext } from '../src/context.js';
import { scanProject, generateDashboard } from '../src/dashboard.js';

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
    assert.deepEqual(ws.contextUsers.sort(), ['A1', 'B2']);
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
