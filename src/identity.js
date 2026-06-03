import os from 'node:os';
import { paths } from './paths.js';
import { ensureDir, exists, readJson, writeJson, listJsonStems, nowIso } from './util.js';

const SCHEMA_VERSION = 1;

// Resolve the current user through one wrapped layer (design.md §3.5).
// Current implementation: INLAY_USER env override, else OS username.
// Wrapped so the source can change later without affecting callers.
export function resolveUsername({ env = process.env } = {}) {
  const override = env && env.INLAY_USER;
  if (override && String(override).trim()) return String(override).trim();
  return os.userInfo().username;
}

// Resolve current user and auto-register if absent. Returns the user record
// plus { autoRegistered }.
export function whoami({ root, env = process.env } = {}) {
  const username = resolveUsername({ env });
  const p = paths(root);
  if (exists(p.userFile(username))) {
    const rec = readJson(p.userFile(username));
    return { ...rec, autoRegistered: false };
  }
  const rec = writeUser(root, username);
  return { ...rec, autoRegistered: true };
}

// Append-only, one file per user. Idempotent: never overwrites an existing
// registeredAt.
export function registerUser({ root, name }) {
  const p = paths(root);
  if (exists(p.userFile(name))) return readJson(p.userFile(name));
  return writeUser(root, name);
}

function writeUser(root, name) {
  const p = paths(root);
  const rec = { username: name, registeredAt: nowIso(), schemaVersion: SCHEMA_VERSION };
  writeJson(p.userFile(name), rec);
  return rec;
}

// Rebuild the derived users index from the truth-source files. Not committed.
export function reindexUsers({ root }) {
  const p = paths(root);
  ensureDir(p.system);
  const stems = listJsonStems(p.users);
  const users = stems.map((s) => readJson(p.userFile(s)));
  const idx = { generatedAt: nowIso(), users };
  writeJson(p.usersIndex, idx);
  return idx;
}

// Query: reindex first (freshness principle, design.md §7), then read.
export function listUsers({ root }) {
  return reindexUsers({ root }).users;
}
