import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempRoot, rm, exists } from './helpers.js';
import { paths } from '../src/paths.js';
import { EXIT } from '../src/exitcodes.js';
import {
  createWorkspace,
  listWorkspaces,
  removeWorkspace,
  reindexWorkspaces,
  resolveWorkspace,
  useWorkspace,
} from '../src/workspace.js';

const SID = 'test-session';

test('createWorkspace writes one registry file + skeleton (adr/, context/)', () => {
  const root = makeTempRoot();
  try {
    const ws = createWorkspace({ root, id: 'hashcalc', title: 'Hash Calculator', env: { INLAY_USER: 'A1' } });
    assert.equal(ws.id, 'hashcalc');
    assert.equal(ws.createdBy, 'A1');
    const p = paths(root);
    assert.ok(exists(p.wsRegistryFile('hashcalc')));
    assert.ok(exists(p.adrDir('hashcalc')));
    assert.ok(exists(p.contextDir('hashcalc')));
  } finally {
    rm(root);
  }
});

test('createWorkspace rejects duplicate id with WS_MISSING/exit 11', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'dup', title: 'x', env: { INLAY_USER: 'A1' } });
    assert.throws(
      () => createWorkspace({ root, id: 'dup', title: 'y', env: { INLAY_USER: 'A1' } }),
      (e) => e.code === EXIT.WS_MISSING
    );
  } finally {
    rm(root);
  }
});

test('listWorkspaces reindexes first and flags orphan + broken', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'ok', title: 'ok', env: { INLAY_USER: 'A1' } });
    const p = paths(root);
    // broken: registry file without dir
    fs.writeFileSync(p.wsRegistryFile('broken'), JSON.stringify({ id: 'broken', title: 'b' }));
    // orphan: dir without registry
    fs.mkdirSync(p.wsDir('orphan'), { recursive: true });
    const list = listWorkspaces({ root });
    const byId = Object.fromEntries(list.map((w) => [w.id, w.status]));
    assert.equal(byId.ok, 'ok');
    assert.equal(byId.broken, 'broken');
    assert.equal(byId.orphan, 'orphan');
  } finally {
    rm(root);
  }
});

test('resolveWorkspace without a current workspace throws WS_UNRESOLVED/exit 10', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'a', title: 'a', env: { INLAY_USER: 'A1' } });
    assert.throws(
      () => resolveWorkspace({ root, sid: SID }),
      (e) => e.code === EXIT.WS_UNRESOLVED
    );
  } finally {
    rm(root);
  }
});

test('use then resolve returns the workspace; session state is per-session file', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'a', title: 'a', env: { INLAY_USER: 'A1' } });
    useWorkspace({ root, id: 'a', sid: SID });
    const r = resolveWorkspace({ root, sid: SID });
    assert.equal(r.id, 'a');
    const p = paths(root);
    assert.ok(exists(p.sessionFile(SID)));
    // a different session does not see it
    assert.throws(
      () => resolveWorkspace({ root, sid: 'other-session' }),
      (e) => e.code === EXIT.WS_UNRESOLVED
    );
  } finally {
    rm(root);
  }
});

test('use on a non-existent workspace throws WS_MISSING/exit 11', () => {
  const root = makeTempRoot();
  try {
    fs.mkdirSync(paths(root).workspaces, { recursive: true });
    assert.throws(
      () => useWorkspace({ root, id: 'ghost', sid: SID }),
      (e) => e.code === EXIT.WS_MISSING
    );
  } finally {
    rm(root);
  }
});

test('resolve after the registration is deleted throws WS_MISSING/exit 11 (always re-validates)', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'a', title: 'a', env: { INLAY_USER: 'A1' } });
    useWorkspace({ root, id: 'a', sid: SID });
    removeWorkspace({ root, id: 'a' });
    assert.throws(
      () => resolveWorkspace({ root, sid: SID }),
      (e) => e.code === EXIT.WS_MISSING
    );
  } finally {
    rm(root);
  }
});

test('reindexWorkspaces writes derived index excluded from VCS', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'a', title: 'a', env: { INLAY_USER: 'A1' } });
    const idx = reindexWorkspaces({ root });
    assert.ok(idx.workspaces.find((w) => w.id === 'a'));
    assert.ok(exists(paths(root).registryIndex));
  } finally {
    rm(root);
  }
});
