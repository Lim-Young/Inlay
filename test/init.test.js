import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempRoot, rm, exists, read } from './helpers.js';
import { paths } from '../src/paths.js';
import { initProject } from '../src/init.js';
import { doctor } from '../src/doctor.js';
import { createWorkspace } from '../src/workspace.js';
import { BEGIN, END } from '../src/template.js';

test('initProject scaffolds Workspaces structure, .inlay, and .gitignore patterns', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: { INLAY_USER: 'A1' } });
    const p = paths(root);
    assert.ok(exists(p.registry));
    assert.ok(exists(p.users));
    assert.ok(exists(p.inlayDir));
    const gi = read(p.gitignore);
    assert.ok(gi.includes('Workspaces/_system/'));
    assert.ok(gi.includes('*.index.*'));
  } finally {
    rm(root);
  }
});

test('initProject creates AGENTS.md and CLAUDE.md with the managed block when absent', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: { INLAY_USER: 'A1' } });
    const p = paths(root);
    for (const f of [p.agentsMd, p.claudeMd]) {
      const txt = read(f);
      assert.ok(txt.includes(BEGIN) && txt.includes(END));
      assert.ok(txt.includes('Evidence-Driven'));
    }
  } finally {
    rm(root);
  }
});

test('initProject injects into an existing AGENTS.md, preserving prior content', () => {
  const root = makeTempRoot();
  try {
    const p = paths(root);
    fs.writeFileSync(p.agentsMd, '# My Project\n\nExisting guidance.\n');
    initProject({ root, env: { INLAY_USER: 'A1' } });
    const txt = read(p.agentsMd);
    assert.ok(txt.includes('Existing guidance.'), 'prior content preserved');
    assert.ok(txt.includes(BEGIN));
  } finally {
    rm(root);
  }
});

test('initProject is idempotent: re-run replaces the block, no duplicate markers', () => {
  const root = makeTempRoot();
  try {
    initProject({ root, env: { INLAY_USER: 'A1' } });
    initProject({ root, env: { INLAY_USER: 'A1' } });
    const txt = read(paths(root).agentsMd);
    assert.equal(txt.split(BEGIN).length - 1, 1, 'exactly one begin marker');
  } finally {
    rm(root);
  }
});

test('doctor reports vcs, workspace consistency (orphan), and not-initialized', () => {
  const root = makeTempRoot();
  try {
    const before = doctor({ root });
    assert.equal(before.initialized, false);
    initProject({ root, env: { INLAY_USER: 'A1' } });
    createWorkspace({ root, id: 'ok', title: 'ok', env: { INLAY_USER: 'A1' } });
    fs.mkdirSync(paths(root).wsDir('orphan'), { recursive: true });
    const after = doctor({ root });
    assert.equal(after.initialized, true);
    assert.ok(['git', 'svn', 'p4', 'none'].includes(after.vcs));
    assert.ok(after.workspaces.some((w) => w.id === 'orphan' && w.status === 'orphan'));
  } finally {
    rm(root);
  }
});
