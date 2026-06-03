import fs from 'node:fs';
import { paths } from './paths.js';
import { EXIT, InlayError } from './exitcodes.js';
import { ensureDir, exists, readJson, writeJson, listJsonStems, nowIso } from './util.js';
import { whoami } from './identity.js';
import { readSession, writeSession } from './session.js';

const SCHEMA_VERSION = 1;

// Create a workspace = add one registry file (append-only, conflict-free) + skeleton.
export function createWorkspace({ root, id, title, env = process.env }) {
  const p = paths(root);
  if (exists(p.wsRegistryFile(id))) {
    throw new InlayError(EXIT.WS_MISSING, `workspace id already in use: ${id}`);
  }
  const createdBy = whoami({ root, env }).username;
  const rec = {
    id,
    title: title || id,
    createdAt: nowIso(),
    createdBy,
    schemaVersion: SCHEMA_VERSION,
  };
  writeJson(p.wsRegistryFile(id), rec);
  ensureDir(p.adrDir(id));
  ensureDir(p.contextUsersDir(id));
  // public Context doc is a committed truth source; create an empty stub
  if (!exists(p.contextPublic(id))) {
    fs.writeFileSync(p.contextPublic(id), `# Context\n\n## Language\n`);
  }
  return rec;
}

// Authority: a directory is a workspace iff its registry file exists & is valid.
export function listWorkspaces({ root }) {
  reindexWorkspaces({ root }); // freshness: reindex before query
  const p = paths(root);
  const registered = new Set(listJsonStems(p.registry));
  const dirs = exists(p.workspaces)
    ? fs
        .readdirSync(p.workspaces, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
    : [];
  const dirSet = new Set(dirs);
  const out = [];
  for (const id of registered) {
    const rec = readJson(p.wsRegistryFile(id));
    out.push({ ...rec, status: dirSet.has(id) ? 'ok' : 'broken' });
  }
  for (const id of dirs) {
    if (!registered.has(id)) out.push({ id, status: 'orphan' });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function removeWorkspace({ root, id, keepDir = true }) {
  const p = paths(root);
  if (exists(p.wsRegistryFile(id))) fs.rmSync(p.wsRegistryFile(id));
  if (!keepDir && exists(p.wsDir(id))) fs.rmSync(p.wsDir(id), { recursive: true, force: true });
  return { id, removed: true };
}

export function reindexWorkspaces({ root }) {
  const p = paths(root);
  ensureDir(p.system);
  const ids = listJsonStems(p.registry);
  const workspaces = ids.map((id) => readJson(p.wsRegistryFile(id)));
  const idx = { generatedAt: nowIso(), workspaces };
  writeJson(p.registryIndex, idx);
  return idx;
}

function requireInitialized(p) {
  if (!exists(p.workspaces)) {
    throw new InlayError(EXIT.NOT_INITIALIZED, 'project not initialized; run `inlay init`');
  }
}

export function useWorkspace({ root, id, sid }) {
  const p = paths(root);
  requireInitialized(p);
  if (!exists(p.wsRegistryFile(id))) {
    throw new InlayError(EXIT.WS_MISSING, `workspace not found: ${id}`);
  }
  writeSession({ root, sid, workspaceId: id });
  return { id };
}

// Resolve current workspace from session cache; always re-validate registration.
export function resolveWorkspace({ root, sid }) {
  const p = paths(root);
  reindexWorkspaces({ root }); // freshness
  const sess = readSession({ root, sid });
  if (!sess || !sess.workspaceId) {
    throw new InlayError(EXIT.WS_UNRESOLVED, 'no current workspace; run `inlay ws use <id>`');
  }
  if (!exists(p.wsRegistryFile(sess.workspaceId))) {
    throw new InlayError(EXIT.WS_MISSING, `current workspace no longer registered: ${sess.workspaceId}`);
  }
  return readJson(p.wsRegistryFile(sess.workspaceId));
}
