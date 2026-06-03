import { paths } from './paths.js';
import { exists, listJsonStems } from './util.js';
import { detectVcs } from './vcs.js';
import { listWorkspaces } from './workspace.js';
import { listUsers } from './identity.js';

// Environment + integrity diagnostics (read-only). design.md §7.1.
export function doctor({ root }) {
  const p = paths(root);
  const initialized = exists(p.workspaces);
  const vcs = detectVcs(root);
  const checks = [];

  if (!initialized) {
    checks.push({ level: 'error', msg: 'project not initialized; run `inlay init`' });
    return { initialized, vcs, workspaces: [], users: 0, checks, ok: false };
  }

  const workspaces = listWorkspaces({ root });
  for (const w of workspaces) {
    if (w.status === 'orphan') checks.push({ level: 'warn', msg: `orphan directory (no registration): ${w.id}` });
    if (w.status === 'broken') checks.push({ level: 'warn', msg: `broken workspace (registration without directory): ${w.id}` });
  }
  const users = listUsers({ root }).length;
  checks.push({ level: 'info', msg: `hooks: none (automation hooks deferred this phase)` });

  return {
    initialized,
    vcs,
    workspaces,
    users,
    checks,
    ok: !checks.some((c) => c.level === 'error'),
  };
}
