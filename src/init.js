import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { ensureDir, exists } from './util.js';
import { detectVcs, IGNORE_PATTERNS } from './vcs.js';
import { injectBlock } from './template.js';

// Initialize a project: scaffold dirs, write ignore rules, inject guidance.
// Does NOT install any VCS hooks (this phase). design.md §7.1, §11bis.
export function initProject({ root, env = process.env }) {
  const p = paths(root);
  ensureDir(p.registry);
  ensureDir(p.users);
  ensureDir(p.system);
  ensureDir(path.join(p.inlayDir, 'hooks'));
  ensureDir(path.join(p.inlayDir, 'ignore-fragments'));

  const vcs = detectVcs(root);
  writeIgnore(p, vcs);
  injectInto(p.agentsMd);
  injectInto(p.claudeMd);

  return { initialized: true, vcs, root };
}

function writeIgnore(p, vcs) {
  // git is the primary target; svn/p4 fragments are written for reference.
  const fragment = IGNORE_PATTERNS.join('\n') + '\n';
  fs.writeFileSync(path.join(p.inlayDir, 'ignore-fragments', 'patterns'), fragment);
  if (vcs === 'git' || vcs === 'none') {
    const existing = exists(p.gitignore) ? fs.readFileSync(p.gitignore, 'utf8') : '';
    if (!existing.includes('# Inlay derived (do not commit)')) {
      const block = `\n# Inlay derived (do not commit)\n${fragment}`;
      fs.writeFileSync(p.gitignore, existing + block);
    }
  }
}

function injectInto(file) {
  const existing = exists(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, injectBlock(existing));
}
