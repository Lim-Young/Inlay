import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { EXIT, InlayError } from './exitcodes.js';
import { ensureDir, exists } from './util.js';
import { whoami } from './identity.js';
import { resolveWorkspace } from './workspace.js';

function ctx({ root, sid }) {
  const ws = resolveWorkspace({ root, sid }); // guard
  return { ws, p: paths(root) };
}

function userTemplate(user) {
  return `# Context (staging — ${user})\n\n## Language\n`;
}

// Default: open/initialize the current user's own staging doc.
// scope:'shared' is blocked — public CONTEXT.md is written only via promotion (skill).
export function addContext({ root, sid, scope = 'user', env = process.env }) {
  const { ws, p } = ctx({ root, sid });
  if (scope === 'shared') {
    throw new InlayError(
      EXIT.GUARD_BLOCKED,
      'direct write to public CONTEXT.md is not allowed; promote via the inlay-context-aggregate skill'
    );
  }
  const user = whoami({ root, env }).username;
  const file = p.contextUserFile(ws.id, user);
  if (!exists(file)) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, userTemplate(user));
  }
  return { path: file, user, workspace: ws.id };
}

// Read scope: public + current user's own staging ONLY. Never cross-user.
export function readContext({ root, sid, env = process.env }) {
  const { ws, p } = ctx({ root, sid });
  const user = whoami({ root, env }).username;
  const publicPath = p.contextPublic(ws.id);
  const ownPath = p.contextUserFile(ws.id, user);
  const readablePaths = [publicPath, ownPath];
  return {
    workspace: ws.id,
    user,
    publicPath,
    ownPath,
    readablePaths,
    publicContent: exists(publicPath) ? fs.readFileSync(publicPath, 'utf8') : '',
    ownContent: exists(ownPath) ? fs.readFileSync(ownPath, 'utf8') : '',
  };
}

export function resetContext({ root, sid, env = process.env }) {
  const { ws, p } = ctx({ root, sid });
  const user = whoami({ root, env }).username;
  const file = p.contextUserFile(ws.id, user);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, userTemplate(user));
  return { path: file, reset: true };
}

export function listContext({ root, sid }) {
  const { ws, p } = ctx({ root, sid });
  const usersDir = p.contextUsersDir(ws.id);
  const users = exists(usersDir)
    ? fs.readdirSync(usersDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  return { workspace: ws.id, public: exists(p.contextPublic(ws.id)), users };
}
