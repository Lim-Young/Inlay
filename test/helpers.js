import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Create an isolated temp project root for a test.
export function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inlay-test-'));
}

export function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function read(file) {
  return fs.readFileSync(file, 'utf8');
}

export function exists(p) {
  return fs.existsSync(p);
}
