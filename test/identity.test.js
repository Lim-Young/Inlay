import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempRoot, rm, exists } from './helpers.js';
import { whoami, registerUser, listUsers, reindexUsers } from '../src/identity.js';
import { paths } from '../src/paths.js';

test('whoami resolves INLAY_USER override and auto-registers (one file per user)', () => {
  const root = makeTempRoot();
  try {
    const r = whoami({ root, env: { INLAY_USER: 'A1' } });
    assert.equal(r.username, 'A1');
    assert.equal(r.autoRegistered, true);
    const p = paths(root);
    assert.ok(exists(p.userFile('A1')), 'user file created');
  } finally {
    rm(root);
  }
});

test('whoami falls back to OS username when no override', () => {
  const root = makeTempRoot();
  try {
    const r = whoami({ root, env: {} });
    assert.ok(r.username && r.username.length > 0);
  } finally {
    rm(root);
  }
});

test('whoami is idempotent: second call does not re-register or change registeredAt', () => {
  const root = makeTempRoot();
  try {
    const first = whoami({ root, env: { INLAY_USER: 'A1' } });
    const second = whoami({ root, env: { INLAY_USER: 'A1' } });
    assert.equal(second.autoRegistered, false);
    assert.equal(first.registeredAt, second.registeredAt);
  } finally {
    rm(root);
  }
});

test('registerUser is idempotent and keyed by username', () => {
  const root = makeTempRoot();
  try {
    const a = registerUser({ root, name: 'B2' });
    const b = registerUser({ root, name: 'B2' });
    assert.equal(a.registeredAt, b.registeredAt, 'registeredAt preserved');
    const users = listUsers({ root });
    assert.deepEqual(users.map((u) => u.username), ['B2']);
  } finally {
    rm(root);
  }
});

test('listUsers reindexes first: a directly-added user file shows up without explicit reindex', async () => {
  const root = makeTempRoot();
  try {
    registerUser({ root, name: 'A1' });
    // simulate another machine committing a user file directly (no reindex run)
    const fs = await import('node:fs');
    const p = paths(root);
    fs.writeFileSync(
      p.userFile('B2'),
      JSON.stringify({ username: 'B2', registeredAt: '2026-06-02T00:00:00.000Z', schemaVersion: 1 })
    );
    const users = listUsers({ root });
    assert.deepEqual(users.map((u) => u.username).sort(), ['A1', 'B2']);
  } finally {
    rm(root);
  }
});

test('reindexUsers writes a derived index reflecting all user files', () => {
  const root = makeTempRoot();
  try {
    registerUser({ root, name: 'A1' });
    registerUser({ root, name: 'B2' });
    const idx = reindexUsers({ root });
    assert.deepEqual(idx.users.map((u) => u.username).sort(), ['A1', 'B2']);
    const p = paths(root);
    assert.ok(exists(p.usersIndex));
  } finally {
    rm(root);
  }
});
