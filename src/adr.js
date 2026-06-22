import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { EXIT, InlayError } from './exitcodes.js';
import { ensureDir, exists, randomId, slugify, todayStamp, nowIso } from './util.js';
import { whoami } from './identity.js';
import { resolveWorkspace } from './workspace.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

function adrDirFor({ root, sid }) {
  const ws = resolveWorkspace({ root, sid }); // guard: throws WS_UNRESOLVED/WS_MISSING
  const p = paths(root);
  const dir = p.adrDir(ws.id);
  ensureDir(dir);
  return { dir, ws };
}

export function readAll(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^ADR-.*\.md$/.test(f))
    .map((f) => {
      const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { ...data, fileName: f, filePath: path.join(dir, f) };
    });
}

export function newAdr({ root, sid, title, status = 'proposed', supersedes = [], related = [], env = process.env }) {
  const { dir } = adrDirFor({ root, sid });
  const createdBy = whoami({ root, env }).username;
  const id = randomId(6);
  const fileName = `ADR-${todayStamp()}-${id}-${slugify(title)}.md`;
  const data = {
    id,
    title,
    status,
    createdBy,
    createdAt: nowIso(),
    modifiedBy: [],
    supersedes,
    related,
  };
  const body = `\n# ${title}\n\n_TODO: 1-3 sentences — context, decision, and why._\n`;
  fs.writeFileSync(path.join(dir, fileName), stringifyFrontmatter(data, body));
  return { ...data, fileName };
}

function findById(dir, id) {
  return readAll(dir).find((a) => a.id === id);
}

export function touchAdr({ root, sid, id, env = process.env }) {
  const { dir } = adrDirFor({ root, sid });
  const adr = findById(dir, id);
  if (!adr) throw new InlayError(EXIT.WS_MISSING, `ADR not found: ${id}`);
  const user = whoami({ root, env }).username;
  const text = fs.readFileSync(adr.filePath, 'utf8');
  const { data, body } = parseFrontmatter(text);
  data.modifiedBy = Array.isArray(data.modifiedBy) ? data.modifiedBy : [];
  data.modifiedBy.push({ user, at: nowIso() });
  fs.writeFileSync(adr.filePath, stringifyFrontmatter(data, body));
  return data;
}

export function listAdr({ root, sid, status }) {
  const { dir } = adrDirFor({ root, sid });
  let all = readAll(dir);
  if (status) all = all.filter((a) => a.status === status);
  return all.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export function showAdr({ root, sid, id }) {
  const { dir } = adrDirFor({ root, sid });
  const adr = findById(dir, id);
  if (!adr) throw new InlayError(EXIT.WS_MISSING, `ADR not found: ${id}`);
  return adr;
}

// Validate id uniqueness, reference validity, and redundant-title consistency.
export function verifyAdr({ root, sid }) {
  const { dir } = adrDirFor({ root, sid });
  return verifyAdrDir(dir);
}

// Same checks as verifyAdr, but against an explicit ADR directory (no session).
// Lets read-only scanners (dashboard) verify every workspace. design.md D4.
export function verifyAdrDir(dir) {
  const all = readAll(dir);
  const problems = [];
  const byId = new Map();
  for (const a of all) {
    if (byId.has(a.id)) problems.push(`duplicate id ${a.id}: ${a.fileName} and ${byId.get(a.id).fileName}`);
    else byId.set(a.id, a);
  }
  for (const a of all) {
    for (const ref of [...(a.supersedes || []), ...(a.related || [])]) {
      const refId = typeof ref === 'string' ? ref : ref.id;
      const target = byId.get(refId);
      if (!target) {
        problems.push(`${a.fileName}: reference to unknown ADR id ${refId}`);
        continue;
      }
      if (ref && ref.title && target.title && ref.title !== target.title) {
        problems.push(`${a.fileName}: redundant title for ${refId} ("${ref.title}") mismatches actual ("${target.title}")`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
