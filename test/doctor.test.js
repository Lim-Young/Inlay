import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempRoot, rm } from './helpers.js';
import { initProject } from '../src/init.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr } from '../src/adr.js';
import { doctor } from '../src/doctor.js';
import { paths } from '../src/paths.js';
import { parseFrontmatter, stringifyFrontmatter } from '../src/frontmatter.js';

const agentEnv = { INLAY_USER: 'A1', INLAY_SESSION: 's1' };
const sid = 's1';
const wsId = 'proj';

test('doctor: not-initialized → summary.errors=1, ok=false', () => {
  const root = makeTempRoot();
  try {
    const d = doctor({ root });
    assert.equal(d.initialized, false);
    assert.equal(d.ok, false);
    assert.equal(d.summary.errors, 1);
    assert.equal(d.workspaces.length, 0);
  } finally {
    rm(root);
  }
});

test('doctor: clean workspace → no ADR findings', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    createWorkspace({ root, id: wsId, title: wsId, env: agentEnv });
    useWorkspace({ root, id: wsId, sid });
    newAdr({ root, sid, title: 'Decision A', status: 'accepted', env: agentEnv });
    const d = doctor({ root });
    assert.equal(d.initialized, true);
    assert.ok(d.ok);
    const ws = d.workspaces.find((w) => w.id === wsId);
    assert.ok(ws);
    assert.equal(ws.adrCount, 1);
    const nonInfo = ws.findings.filter((f) => f.level !== 'info');
    assert.equal(nonInfo.length, 0, 'clean workspace should have no error/warn findings');
  } finally {
    rm(root);
  }
});

test('doctor: ADR_STALE_REF — related references a superseded ADR', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    createWorkspace({ root, id: wsId, title: wsId, env: agentEnv });
    useWorkspace({ root, id: wsId, sid });
    // Create old ADR (will be superseded)
    const old = newAdr({ root, sid, title: 'Old decision', status: 'superseded', env: agentEnv });
    // Create new ADR that supersedes the old one
    newAdr({ root, sid, title: 'New decision', status: 'accepted', supersedes: [old.id], env: agentEnv });
    // Create a third ADR that references the superseded ADR via `related`
    newAdr({
      root,
      sid,
      title: 'Consumer',
      status: 'proposed',
      related: [{ id: old.id }],
      env: agentEnv,
    });

    const d = doctor({ root });
    const ws = d.workspaces.find((w) => w.id === wsId);
    assert.ok(ws);
    const stale = ws.findings.filter((f) => f.code === 'ADR_STALE_REF');
    assert.equal(stale.length, 1, 'should detect one stale reference');
    assert.equal(stale[0].level, 'warn');
    assert.equal(stale[0].evidence.staleRef, old.id);
    assert.ok(stale[0].evidence.latestInChain, 'should have a latestInChain');
    assert.ok(stale[0].evidence.suggestion, 'should have a suggestion');
    assert.ok(stale[0].evidence.file, 'should have a file path');
    assert.ok(d.ok, 'warnings should not make ok=false');
  } finally {
    rm(root);
  }
});

test('doctor: ADR_CIRCULAR — supersedes chain forms a cycle', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    createWorkspace({ root, id: wsId, title: wsId, env: agentEnv });
    useWorkspace({ root, id: wsId, sid });
    // Create two ADRs
    const a = newAdr({ root, sid, title: 'A', status: 'accepted', env: agentEnv });
    const b = newAdr({ root, sid, title: 'B', status: 'accepted', supersedes: [a.id], env: agentEnv });
    // Manually update A's frontmatter to also supersede B (creating a cycle A↔B)
    const p = paths(root);
    const adrDir = p.adrDir(wsId);
    const aFile = path.join(adrDir, a.fileName);
    const raw = fs.readFileSync(aFile, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    data.supersedes = [{ id: b.id }];
    fs.writeFileSync(aFile, stringifyFrontmatter(data, body));

    const d = doctor({ root });
    const ws = d.workspaces.find((w) => w.id === wsId);
    assert.ok(ws);
    const circular = ws.findings.filter((f) => f.code === 'ADR_CIRCULAR');
    assert.equal(circular.length, 1, 'should detect circular supersession');
    assert.equal(circular[0].level, 'error');
    assert.ok(circular[0].evidence.cycle.length >= 2, 'cycle should have at least 2 nodes');
    assert.ok(Array.isArray(circular[0].evidence.files), 'should list files');
    assert.equal(d.ok, false, 'errors should make ok=false');
  } finally {
    rm(root);
  }
});

test('doctor: ADR_BROKEN_SUPERSEDES — supersedes ref to non-existent ADR', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    createWorkspace({ root, id: wsId, title: wsId, env: agentEnv });
    useWorkspace({ root, id: wsId, sid });
    // Create an ADR that supersedes a non-existent ID
    newAdr({
      root,
      sid,
      title: 'Lone decision',
      status: 'accepted',
      supersedes: ['deadbeef'],
      env: agentEnv,
    });

    const d = doctor({ root });
    const ws = d.workspaces.find((w) => w.id === wsId);
    assert.ok(ws);
    const broken = ws.findings.filter((f) => f.code === 'ADR_BROKEN_SUPERSEDES');
    assert.equal(broken.length, 1, 'should detect broken supersedes ref');
    assert.equal(broken[0].level, 'error');
    assert.equal(broken[0].evidence.brokenRef, 'deadbeef');
    assert.equal(d.ok, false);
  } finally {
    rm(root);
  }
});

test('doctor: ADR_STALE_REF — multiple stale refs in one ADR', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    createWorkspace({ root, id: wsId, title: wsId, env: agentEnv });
    useWorkspace({ root, id: wsId, sid });
    const old1 = newAdr({ root, sid, title: 'Old 1', status: 'superseded', env: agentEnv });
    const old2 = newAdr({ root, sid, title: 'Old 2', status: 'superseded', env: agentEnv });
    // Consumer references both superseded ADRs
    newAdr({
      root,
      sid,
      title: 'Consumer',
      status: 'proposed',
      related: [{ id: old1.id }, { id: old2.id }],
      env: agentEnv,
    });

    const d = doctor({ root });
    const ws = d.workspaces.find((w) => w.id === wsId);
    assert.ok(ws);
    const stale = ws.findings.filter((f) => f.code === 'ADR_STALE_REF');
    assert.equal(stale.length, 2, 'should detect two stale references');
    assert.equal(d.summary.warnings, 2);
  } finally {
    rm(root);
  }
});

test('doctor: output shape matches contract', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    const d = doctor({ root });
    // Top-level fields
    assert.ok('initialized' in d);
    assert.ok('vcs' in d);
    assert.ok('workspaces' in d);
    assert.ok('users' in d);
    assert.ok('summary' in d);
    assert.ok('ok' in d);
    // Summary shape
    assert.ok('errors' in d.summary);
    assert.ok('warnings' in d.summary);
    assert.ok('info' in d.summary);
    assert.equal(typeof d.summary.errors, 'number');
    assert.equal(typeof d.summary.warnings, 'number');
    assert.equal(typeof d.summary.info, 'number');
    // Finding shape (at least one per workspace)
    for (const ws of d.workspaces) {
      assert.ok(Array.isArray(ws.findings), 'ws.findings must be an array');
      assert.ok('adrCount' in ws, 'ws must have adrCount');
      assert.ok('status' in ws, 'ws must have status');
      for (const f of ws.findings) {
        assert.ok(
          ['error', 'warn', 'info'].includes(f.level),
          `invalid level: ${f.level}`
        );
        assert.ok(typeof f.code === 'string', 'finding must have code');
        assert.ok(typeof f.message === 'string', 'finding must have message');
        assert.ok(typeof f.evidence === 'object', 'finding must have evidence object');
      }
    }
  } finally {
    rm(root);
  }
});

test('doctor: WS_ORPHAN_DIR — directory without registration', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: agentEnv });
    const p = paths(root);
    fs.mkdirSync(p.wsDir('orphan'), { recursive: true });
    const d = doctor({ root });
    const ws = d.workspaces.find((w) => w.id === 'orphan');
    assert.ok(ws);
    assert.equal(ws.status, 'orphan');
    const orphan = ws.findings.filter((f) => f.code === 'WS_ORPHAN_DIR');
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].level, 'warn');
  } finally {
    rm(root);
  }
});
