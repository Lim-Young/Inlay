#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';
import { EXIT, InlayError } from '../src/exitcodes.js';
import { whoami, registerUser, listUsers } from '../src/identity.js';
import { deriveSessionId } from '../src/session.js';
import {
  createWorkspace,
  listWorkspaces,
  removeWorkspace,
  reindexWorkspaces,
  resolveWorkspace,
  useWorkspace,
} from '../src/workspace.js';
import { newAdr, touchAdr, listAdr, showAdr, verifyAdr } from '../src/adr.js';
import { addContext, listContext, resetContext, readContext } from '../src/context.js';
import { initProject } from '../src/init.js';
import { doctor } from '../src/doctor.js';
import { generateDashboard } from '../src/dashboard.js';
import { reindexUsers } from '../src/identity.js';

const root = process.env.INLAY_ROOT || process.cwd();
const env = process.env;
const sid = deriveSessionId({ env });

// --- tiny arg parser ---
const argv = process.argv.slice(2);
const positionals = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else positionals.push(a);
}
const json = !!flags.json;

function emit(data, status = []) {
  const ts = new Date().toISOString();
  if (json) {
    process.stdout.write(JSON.stringify({ data, status, ts, sessionId: sid }, null, 2) + '\n');
  } else {
    print(data);
    process.stdout.write(`\n# inlay ${ts} session=${sid}\n`);
  }
}

function print(data) {
  if (typeof data === 'string') process.stdout.write(data + '\n');
  else process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function openInBrowser(file) {
  const plat = process.platform;
  const cmd = plat === 'win32' ? 'cmd' : plat === 'darwin' ? 'open' : 'xdg-open';
  const args = plat === 'win32' ? ['/c', 'start', '', file] : [file];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore */
  }
}

async function main() {
  const [group, sub, ...rest] = positionals;
  switch (group) {
    case 'init':
      return emit(initProject({ root, env }));
    case 'whoami':
      return emit(whoami({ root, env }));
    case 'user':
      if (sub === 'register') return emit(registerUser({ root, name: flags.name || whoami({ root, env }).username }));
      if (sub === 'list') return emit({ users: listUsers({ root }) });
      if (sub === 'reindex') return emit(reindexUsers({ root }));
      throw new InlayError(EXIT.OK, usage());
    case 'ws':
      if (sub === 'create') return emit(createWorkspace({ root, id: rest[0], title: flags.title, env }));
      if (sub === 'list') return emit({ workspaces: listWorkspaces({ root }) });
      if (sub === 'remove') return emit(removeWorkspace({ root, id: rest[0], keepDir: !flags['delete-dir'] }));
      if (sub === 'reindex') return emit(reindexWorkspaces({ root }));
      if (sub === 'resolve') return emit(resolveWorkspace({ root, sid }));
      if (sub === 'use') return emit(useWorkspace({ root, id: rest[0], sid }));
      throw new InlayError(EXIT.OK, usage());
    case 'adr': {
      if (sub === 'new')
        return emit(
          newAdr({
            root,
            sid,
            title: flags.title,
            status: flags.status,
            supersedes: csv(flags.supersedes),
            related: csv(flags.related).map((id) => ({ id })),
            env,
          })
        );
      if (sub === 'touch') return emit(touchAdr({ root, sid, id: rest[0], env }));
      if (sub === 'list') return emit({ adrs: listAdr({ root, sid, status: flags.status }) });
      if (sub === 'show') return emit(showAdr({ root, sid, id: rest[0] }));
      if (sub === 'verify') {
        const res = verifyAdr({ root, sid });
        emit(res);
        if (!res.ok) process.exit(EXIT.ADR_VERIFY_FAILED);
        return;
      }
      throw new InlayError(EXIT.OK, usage());
    }
    case 'context':
      if (sub === 'add') return emit(addContext({ root, sid, scope: flags.scope, env }));
      if (sub === 'list') return emit(listContext({ root, sid }));
      if (sub === 'reset') return emit(resetContext({ root, sid, env }));
      if (sub === 'read') return emit(readContext({ root, sid, env }));
      throw new InlayError(EXIT.OK, usage());
    case 'doctor':
      return emit(doctor({ root }));
    case 'dashboard': {
      const r = generateDashboard({ root, outDir: flags.out || undefined });
      if (!flags['no-open']) openInBrowser(r.path);
      return emit({ path: r.path, workspaces: r.model.workspaces.length, users: r.model.users.length });
    }
    default:
      process.stdout.write(usage() + '\n');
      return;
  }
}

function csv(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function usage() {
  return `inlay <command>

  init                         initialize project (scaffold + ignore + inject AGENTS.md/CLAUDE.md)
  whoami                       resolve current user (auto-registers)
  user register|list|reindex
  ws create <id> --title <t> | list | remove <id> | reindex | resolve | use <id>
  adr new --title <t> [--status s] [--supersedes a,b] [--related a,b] | touch <id> | list [--status s] | show <id> | verify
  context add [--scope user|shared] | list | reset | read
  doctor
  dashboard [--no-open] [--out <dir>]

  global: --json   machine-readable output (data/status/ts/sessionId)`;
}

main().catch((err) => {
  const code = err instanceof InlayError ? err.code : 1;
  if (json) process.stdout.write(JSON.stringify({ error: err.message, code }, null, 2) + '\n');
  else process.stderr.write(`inlay: ${err.message}\n`);
  process.exit(code || 1);
});
