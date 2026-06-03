import { paths } from './paths.js';
import { ensureDir, exists, readJson, writeJson, nowIso } from './util.js';

// Current workspace is session/process-private state (design.md §2, §3).
export function deriveSessionId({ env = process.env, pid = process.pid } = {}) {
  if (env && env.INLAY_SESSION && String(env.INLAY_SESSION).trim()) {
    return String(env.INLAY_SESSION).trim();
  }
  return `pid-${pid}`;
}

export function readSession({ root, sid }) {
  const p = paths(root);
  const f = p.sessionFile(sid);
  if (!exists(f)) return null;
  return readJson(f);
}

export function writeSession({ root, sid, workspaceId }) {
  const p = paths(root);
  ensureDir(p.sessionDir);
  const rec = { sessionId: sid, workspaceId, setAt: nowIso() };
  writeJson(p.sessionFile(sid), rec);
  return rec;
}
