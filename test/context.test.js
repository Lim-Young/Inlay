import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempRoot, rm, exists } from './helpers.js';
import { EXIT } from '../src/exitcodes.js';
import { paths } from '../src/paths.js';
import { createWorkspace, useWorkspace } from '../src/workspace.js';
import { addContext, listContext, resetContext, readContext } from '../src/context.js';

const SID = 'sid';
function setup() {
  const root = makeTempRoot();
  createWorkspace({ root, id: 'ws', title: 'ws', env: { INLAY_USER: 'A1' } });
  useWorkspace({ root, id: 'ws', sid: SID });
  return root;
}

test('addContext writes the current user own doc, never the public CONTEXT.md', () => {
  const root = setup();
  try {
    const r = addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    const p = paths(root);
    assert.ok(exists(p.contextUserFile('ws', 'A1')));
    assert.equal(r.path, p.contextUserFile('ws', 'A1'));
  } finally {
    rm(root);
  }
});

test('addContext --scope shared is blocked with GUARD_BLOCKED/exit 40', () => {
  const root = setup();
  try {
    assert.throws(
      () => addContext({ root, sid: SID, scope: 'shared', env: { INLAY_USER: 'A1' } }),
      (e) => e.code === EXIT.GUARD_BLOCKED
    );
  } finally {
    rm(root);
  }
});

test('two users add concurrently to different files (zero conflict)', () => {
  const root = setup();
  try {
    const a = addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    const b = addContext({ root, sid: SID, env: { INLAY_USER: 'B2' } });
    assert.notEqual(a.path, b.path);
  } finally {
    rm(root);
  }
});

test('readContext returns public + own only, never another user staging', () => {
  const root = setup();
  try {
    addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    addContext({ root, sid: SID, env: { INLAY_USER: 'B2' } });
    const r = readContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    assert.ok(r.publicPath.endsWith('CONTEXT.md'));
    assert.ok(r.ownPath.includes('A1'));
    // explicitly must not expose B2
    assert.ok(!JSON.stringify(r).includes('users/B2') && !r.ownPath.includes('B2'));
    assert.equal(r.readablePaths.length, 2);
  } finally {
    rm(root);
  }
});

test('resetContext clears the current user own doc to the template', async () => {
  const root = setup();
  try {
    const fs = await import('node:fs');
    const p = paths(root);
    addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    fs.writeFileSync(p.contextUserFile('ws', 'A1'), '# Context\n\n## Language\n\n**Digest**: a hash value.\n');
    resetContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    const after = fs.readFileSync(p.contextUserFile('ws', 'A1'), 'utf8');
    assert.ok(!after.includes('Digest'), 'staged term cleared');
    assert.ok(after.includes('## Language'), 'template preserved');
  } finally {
    rm(root);
  }
});

test('listContext lists public doc + per-user staging docs', () => {
  const root = setup();
  try {
    addContext({ root, sid: SID, env: { INLAY_USER: 'A1' } });
    addContext({ root, sid: SID, env: { INLAY_USER: 'B2' } });
    const r = listContext({ root, sid: SID });
    assert.equal(r.public, true);
    assert.deepEqual(r.users.sort(), ['A1', 'B2']);
  } finally {
    rm(root);
  }
});
