import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, rm } from './helpers.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'inlay.js');

function inlay(root, args, extraEnv = {}) {
  const res = spawnSync('node', [BIN, ...args], {
    env: { ...process.env, INLAY_ROOT: root, INLAY_SESSION: 's1', ...extraEnv },
    encoding: 'utf8',
  });
  let json = null;
  if (args.includes('--json')) {
    try {
      json = JSON.parse(res.stdout);
    } catch {}
  }
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

test('end-to-end CLI flow: init → whoami → ws → adr → context → dashboard', () => {
  const root = makeTempRoot();
  try {
    assert.equal(inlay(root, ['init'], { INLAY_USER: '14522' }).code, 0);

    const who = inlay(root, ['whoami', '--json'], { INLAY_USER: 'A1' });
    assert.equal(who.code, 0);
    assert.equal(who.json.data.username, 'A1');

    assert.equal(inlay(root, ['ws', 'create', 'hashcalc', '--title', 'Hash Calculator'], { INLAY_USER: '14522' }).code, 0);

    // resolve before use → exit 10
    assert.equal(inlay(root, ['ws', 'resolve'], { INLAY_SESSION: 'fresh' }).code, 10);

    assert.equal(inlay(root, ['ws', 'use', 'hashcalc']).code, 0);
    assert.equal(inlay(root, ['ws', 'resolve']).code, 0);

    const adr = inlay(root, ['adr', 'new', '--title', 'Use Node crypto', '--json'], { INLAY_USER: '14522' });
    assert.equal(adr.code, 0);
    assert.ok(adr.json.data.id);

    assert.equal(inlay(root, ['adr', 'verify']).code, 0);

    // context add for A1
    assert.equal(inlay(root, ['context', 'add'], { INLAY_USER: 'A1' }).code, 0);

    // direct shared write blocked → exit 40
    assert.equal(inlay(root, ['context', 'add', '--scope', 'shared'], { INLAY_USER: 'A1' }).code, 40);

    const dash = inlay(root, ['dashboard', '--no-open', '--json']);
    assert.equal(dash.code, 0);
    assert.ok(dash.json.data.path.endsWith('.html'));
  } finally {
    rm(root);
  }
});
