import path from 'node:path';
import { exists } from './util.js';

// Minimal VCS capability: detect only (this phase). design.md §9.2.
export function detectVcs(root) {
  if (exists(path.join(root, '.git'))) return 'git';
  if (exists(path.join(root, '.svn'))) return 'svn';
  if (exists(path.join(root, '.p4config')) || exists(path.join(root, 'P4CONFIG'))) return 'p4';
  return 'none';
}

export const IGNORE_PATTERNS = ['Workspaces/_system/', '*.build.*', '*.index.*'];
