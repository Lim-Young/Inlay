// Canonical Inlay exit codes (design.md §7.5).
export const EXIT = {
  OK: 0,
  WS_UNRESOLVED: 10, // workspace context not determined; run resolve/use first
  WS_MISSING: 11, // workspace does not exist / registration missing or invalid
  NOT_INITIALIZED: 12, // project not initialized (no Workspaces/)
  ADR_VERIFY_FAILED: 20, // adr verify failed (id collision / broken ref / title mismatch)
  VCS_ERROR: 30, // VCS adapter error
  GUARD_BLOCKED: 40, // guard: attempt to directly write shared Context or a derived file
};

// Error carrying an Inlay exit code, thrown by library functions and mapped by the CLI.
export class InlayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InlayError';
    this.code = code;
  }
}
