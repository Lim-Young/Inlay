import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempRoot, rm } from './helpers.js';
import { EXIT } from '../src/exitcodes.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { newAdr, touchAdr, listAdr, showAdr, verifyAdr } from '../src/adr.js';

const SID = 'sid';
function setup() {
  const root = makeTempRoot();
  createWorkspace({ root, id: 'ws', title: 'ws', env: { INLAY_USER: 'A1' } });
  useWorkspace({ root, id: 'ws', sid: SID });
  return root;
}

test('newAdr requires a resolved workspace (exit 10)', () => {
  const root = makeTempRoot();
  try {
    createWorkspace({ root, id: 'ws', title: 'ws', env: { INLAY_USER: 'A1' } });
    assert.throws(
      () => newAdr({ root, sid: 'no-session', title: 'X', env: { INLAY_USER: 'A1' } }),
      (e) => e.code === EXIT.WS_UNRESOLVED
    );
  } finally {
    rm(root);
  }
});

test('newAdr creates ADR-<date>-<id>-<slug>.md with createdBy from whoami', () => {
  const root = setup();
  try {
    const adr = newAdr({ root, sid: SID, title: 'Switch to event-driven sync', env: { INLAY_USER: 'A1' } });
    assert.match(adr.fileName, /^ADR-\d{8}-[0-9a-f]{6,7}-switch-to-event-driven-sync\.md$/);
    assert.equal(adr.createdBy, 'A1');
    assert.equal(adr.status, 'proposed');
  } finally {
    rm(root);
  }
});

test('two ADRs get different ids (no global counter, no collision)', () => {
  const root = setup();
  try {
    const a = newAdr({ root, sid: SID, title: 'same title', env: { INLAY_USER: 'A1' } });
    const b = newAdr({ root, sid: SID, title: 'same title', env: { INLAY_USER: 'B2' } });
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.fileName, b.fileName);
  } finally {
    rm(root);
  }
});

test('touchAdr appends a {user, at} entry to modifiedBy without overwriting', () => {
  const root = setup();
  try {
    const a = newAdr({ root, sid: SID, title: 'T', env: { INLAY_USER: 'A1' } });
    touchAdr({ root, sid: SID, id: a.id, env: { INLAY_USER: 'B2' } });
    touchAdr({ root, sid: SID, id: a.id, env: { INLAY_USER: 'A1' } });
    const shown = showAdr({ root, sid: SID, id: a.id });
    assert.equal(shown.modifiedBy.length, 2);
    assert.equal(shown.modifiedBy[0].user, 'B2');
    assert.equal(shown.modifiedBy[1].user, 'A1');
  } finally {
    rm(root);
  }
});

test('listAdr returns created ADRs, filterable by status', () => {
  const root = setup();
  try {
    newAdr({ root, sid: SID, title: 'one', status: 'accepted', env: { INLAY_USER: 'A1' } });
    newAdr({ root, sid: SID, title: 'two', env: { INLAY_USER: 'A1' } });
    assert.equal(listAdr({ root, sid: SID }).length, 2);
    assert.equal(listAdr({ root, sid: SID, status: 'accepted' }).length, 1);
  } finally {
    rm(root);
  }
});

test('verifyAdr passes for a clean set and flags a broken related reference', () => {
  const root = setup();
  try {
    const a = newAdr({ root, sid: SID, title: 'base', env: { INLAY_USER: 'A1' } });
    newAdr({
      root,
      sid: SID,
      title: 'refs base',
      related: [{ id: a.id, title: 'base' }],
      env: { INLAY_USER: 'A1' },
    });
    assert.equal(verifyAdr({ root, sid: SID }).ok, true);

    // add an ADR with a dangling reference
    newAdr({ root, sid: SID, title: 'dangling', related: [{ id: 'deadbe', title: 'ghost' }], env: { INLAY_USER: 'A1' } });
    const res = verifyAdr({ root, sid: SID });
    assert.equal(res.ok, false);
    assert.ok(res.problems.some((p) => /deadbe/.test(p)));
  } finally {
    rm(root);
  }
});

test('verifyAdr flags a redundant-title mismatch on a reference', () => {
  const root = setup();
  try {
    const a = newAdr({ root, sid: SID, title: 'Real Title', env: { INLAY_USER: 'A1' } });
    newAdr({
      root,
      sid: SID,
      title: 'refs',
      related: [{ id: a.id, title: 'Stale Title' }],
      env: { INLAY_USER: 'A1' },
    });
    const res = verifyAdr({ root, sid: SID });
    assert.equal(res.ok, false);
    assert.ok(res.problems.some((p) => /title/i.test(p)));
  } finally {
    rm(root);
  }
});
