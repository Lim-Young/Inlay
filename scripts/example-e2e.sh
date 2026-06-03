#!/usr/bin/env bash
# Example end-to-end scenario: 3 users (14522=this machine, A1, B2) collaborate on a
# multi-algorithm hash calculator using the Inlay pipeline. Exercises EVERY feature.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EX="$ROOT/Example"
BIN="$ROOT/bin/inlay.js"

# fresh example project
rm -rf "$EX"
mkdir -p "$EX"
cd "$EX"
git init -q  # so VCS detect = git

# inlay runs against EX as project root; each "user" = INLAY_USER, each "session" = INLAY_SESSION
run() { INLAY_ROOT="$EX" node "$BIN" "$@"; }
as()  { local u="$1" s="$2"; shift 2; INLAY_ROOT="$EX" INLAY_USER="$u" INLAY_SESSION="$s" node "$BIN" "$@"; }

echo "### 1. init (current machine user = 14522)"
run init

echo "### 2. identity: whoami auto-registers each user"
as 14522 s-me   whoami --json   | grep -q '"username": "14522"'
as A1    s-a1   whoami --json   | grep -q '"username": "A1"'
as B2    s-b2   whoami --json   | grep -q '"username": "B2"'
run user reindex >/dev/null
run user list --json | grep -q '"username": "14522"'
run user list --json | grep -q '"username": "A1"'
run user list --json | grep -q '"username": "B2"'

echo "### 3. workspace: 14522 creates 'hashcalc', everyone uses it"
as 14522 s-me ws create hashcalc --title "Hash Calculator" >/dev/null
as 14522 s-me ws use hashcalc >/dev/null
as A1    s-a1 ws use hashcalc >/dev/null
as B2    s-b2 ws use hashcalc >/dev/null
as 14522 s-me ws resolve --json | grep -q '"id": "hashcalc"'
as 14522 s-me ws list --json | grep -q '"status": "ok"'

echo "### 4. ADRs (async, different authors, no counter → no collisions)"
ADR_CORE=$(as 14522 s-me adr new --title "Use Node crypto for hashing" --status accepted --json | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).data.id)}catch{}})')
ADR_ALGO=$(as A1 s-a1 adr new --title "Support pluggable hash algorithms" --json | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).data.id)}catch{}})')
# B2 records a decision that references A1's ADR by id (+ redundant title)
as B2 s-b2 adr new --title "Stream large files for hashing" --related "$ADR_ALGO" --json >/dev/null
echo "  core=$ADR_CORE algo=$ADR_ALGO"
[ -n "$ADR_CORE" ] && [ -n "$ADR_ALGO" ] && [ "$ADR_CORE" != "$ADR_ALGO" ]

echo "### 5. adr touch (B2 edits the core ADR → modifiedBy)"
as B2 s-b2 adr touch "$ADR_CORE" >/dev/null
as 14522 s-me adr show "$ADR_CORE" --json | grep -q '"user": "B2"'

echo "### 6. adr list + verify (clean set passes)"
as 14522 s-me adr list --json | node -e 'let d="";process.stdin.on("data",x=>d+=x);process.stdin.on("end",()=>{const a=JSON.parse(d).data.adrs;if(a.length!==3){console.error("expected 3 ADRs, got",a.length);process.exit(1)}})'
as 14522 s-me adr verify

echo "### 7. Context: each user drafts terms in their OWN staging doc (zero conflict)"
as 14522 s-me context add >/dev/null
as A1    s-a1 context add >/dev/null
as B2    s-b2 context add >/dev/null
# write distinct terms into each staging doc
cat > "$EX/Workspaces/hashcalc/context/users/14522/CONTEXT.md" <<'EOF'
# Context (staging — 14522)

## Language

**Digest**:
The fixed-size output of a hash algorithm over an input.
_Avoid_: hash code, checksum
EOF
cat > "$EX/Workspaces/hashcalc/context/users/A1/CONTEXT.md" <<'EOF'
# Context (staging — A1)

## Language

**Algorithm**:
A named hashing method (e.g. SHA-256, MD5) selectable at runtime.
_Avoid_: cipher, mode
EOF

echo "### 8. context read scope: A1 sees public + own, NOT B2"
as A1 s-a1 context read --json > "$EX/.read-a1.json"
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data; if(r.readablePaths.length!==2){console.error("paths",r.readablePaths);process.exit(1)} const s=JSON.stringify(r); if(s.includes("users/B2")||s.includes("users\\B2")){console.error("leaked B2");process.exit(1)} if(!r.ownPath.includes("A1")){console.error("own not A1");process.exit(1)}' "$EX/.read-a1.json"
rm -f "$EX/.read-a1.json"

echo "### 9. context list shows public + each staging user"
as 14522 s-me context list --json | node -e 'let d="";process.stdin.on("data",x=>d+=x);process.stdin.on("end",()=>{const u=JSON.parse(d).data.users.sort();if(JSON.stringify(u)!==JSON.stringify(["14522","A1","B2"])){console.error("users",u);process.exit(1)}})'

echo "### 10. simulate context aggregate (promote 14522 + A1 terms → public, then reset)"
# (the LLM skill does this interactively; here we emulate its CLI-visible effects)
cat > "$EX/Workspaces/hashcalc/context/CONTEXT.md" <<'EOF'
# Context

## Language

**Digest**:
The fixed-size output of a hash algorithm over an input.
_Avoid_: hash code, checksum

**Algorithm**:
A named hashing method (e.g. SHA-256, MD5) selectable at runtime.
_Avoid_: cipher, mode
EOF
as 14522 s-me context reset >/dev/null
as A1    s-a1 context reset >/dev/null
# after reset, staging docs no longer contain the promoted terms
grep -q 'Digest' "$EX/Workspaces/hashcalc/context/users/14522/CONTEXT.md" && { echo "reset failed"; exit 1; } || true

echo "### 11. the actual hash calculator MVP (the work the team was doing)"
mkdir -p "$EX/src"
cat > "$EX/src/hashcalc.js" <<'EOF'
import crypto from 'node:crypto';
export const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'];
export function digest(algorithm, input) {
  if (!ALGORITHMS.includes(algorithm)) throw new Error(`unsupported algorithm: ${algorithm}`);
  return crypto.createHash(algorithm).update(input).digest('hex');
}
EOF
cat > "$EX/src/hashcalc.test.js" <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, ALGORITHMS } from './hashcalc.js';
test('sha256 of "abc" is the known vector', () => {
  assert.equal(digest('sha256', 'abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('supports multiple algorithms', () => {
  for (const a of ALGORITHMS) assert.equal(typeof digest(a, 'x'), 'string');
});
test('rejects unsupported algorithm', () => {
  assert.throws(() => digest('rot13', 'x'));
});
EOF
node --test "$EX/src/hashcalc.test.js" >/dev/null 2>&1 && echo "  MVP tests pass"

echo "### 12. doctor (health: detect orphan)"
mkdir -p "$EX/Workspaces/straydir"
run doctor --json | grep -q '"vcs": "git"'
run doctor --json | grep -q '"status": "orphan"'
rmdir "$EX/Workspaces/straydir"

echo "### 13. dashboard (read-only HTML)"
DASH=$(run dashboard --no-open --json | node -e 'let d="";process.stdin.on("data",x=>d+=x);process.stdin.on("end",()=>console.log(JSON.parse(d).data.path))')
[ -f "$DASH" ] && echo "  dashboard: $DASH"

echo "### 14. derived files are gitignored (not committed)"
cd "$EX"
git add -A 2>/dev/null
git status --porcelain | grep -q '_system/' && { echo "ERROR: _system staged"; exit 1; } || true
echo "  _system/ correctly ignored"

echo
echo "ALL EXAMPLE CHECKS PASSED"
echo "DASHBOARD=$DASH"
