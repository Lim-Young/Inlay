import { paths } from './paths.js';
import { exists, listJsonStems } from './util.js';
import { detectVcs } from './vcs.js';
import { listWorkspaces } from './workspace.js';
import { listUsers } from './identity.js';
import { readAll, verifyAdrDir } from './adr.js';

// Environment + integrity diagnostics (read-only). design.md §7.1.
export function doctor({ root }) {
  const p = paths(root);
  const initialized = exists(p.workspaces);
  const vcs = detectVcs(root);

  if (!initialized) {
    return {
      initialized,
      vcs,
      workspaces: [],
      users: 0,
      summary: { errors: 1, warnings: 0, info: 0 },
      ok: false,
    };
  }

  const workspaces = listWorkspaces({ root });
  const users = listUsers({ root }).length;
  const enriched = workspaces.map((w) => enrichWorkspace(w, p, root));
  const summary = buildSummary(enriched);

  return {
    initialized,
    vcs,
    workspaces: enriched,
    users,
    summary,
    ok: summary.errors === 0,
  };
}

function enrichWorkspace(w, p, root) {
  const findings = [];

  // Existing workspace-level checks
  if (w.status === 'orphan') {
    findings.push({
      level: 'warn',
      code: 'WS_ORPHAN_DIR',
      message: `orphan directory (no registration): ${w.id}`,
      evidence: { dir: p.wsDir(w.id) },
    });
  }
  if (w.status === 'broken') {
    findings.push({
      level: 'warn',
      code: 'WS_BROKEN_REG',
      message: `broken workspace (registration without directory): ${w.id}`,
      evidence: { registryFile: p.wsRegistryFile(w.id) },
    });
  }

  let adrCount = 0;
  if (w.status === 'ok') {
    const adrDir = p.adrDir(w.id);
    // Merge verifyAdrDir results (duplicate IDs, broken refs, title mismatch)
    const verify = verifyAdrDir(adrDir);
    for (const prob of verify.problems) {
      findings.push(classifyVerifyProblem(prob, adrDir));
    }

    // ADR health checks: stale refs, circular chains, broken supersedes
    const adrs = readAll(adrDir);
    adrCount = adrs.length;
    if (adrs.length > 0) {
      const byId = new Map();
      for (const a of adrs) byId.set(a.id, a);
      const supersedesMap = buildSupersedesMap(adrs);

      // Stale reference detection
      for (const a of adrs) {
        const related = (a.related || []);
        for (const ref of related) {
          const refId = typeof ref === 'string' ? ref : ref && ref.id;
          if (!refId) continue;
          const target = byId.get(refId);
          if (target && target.status === 'superseded') {
            const latestInChain = findLatestInChain(refId, supersedesMap);
            findings.push({
              level: 'warn',
              code: 'ADR_STALE_REF',
              message: `ADR ${a.id} 的 related 字段引用了已被 superseded 的 ADR ${refId}，该引用可能已过时`,
              evidence: {
                file: a.filePath,
                adrId: a.id,
                staleRef: refId,
                latestInChain,
                suggestion:
                  latestInChain && latestInChain !== refId
                    ? `建议将 related 引用从 ${refId} 更新为 ${latestInChain}（当前取代链的最新活跃版本）`
                    : `建议审查 ${a.id} 的 related 引用，移除或更新对已废弃 ADR ${refId} 的引用`,
              },
            });
          }
        }
      }

      // Circular supersession detection
      const cycles = detectCircular(supersedesMap);
      for (const cycle of cycles) {
        findings.push({
          level: 'error',
          code: 'ADR_CIRCULAR',
          message: `检测到循环取代链: ${cycle.join(' → ')}`,
          evidence: {
            cycle,
            files: cycle.map((id) => byId.get(id)?.filePath).filter(Boolean),
          },
        });
      }

      // Broken supersedes references (refs to non-existent ADRs)
      for (const a of adrs) {
        const supersedes = (a.supersedes || []);
        for (const ref of supersedes) {
          const refId = typeof ref === 'string' ? ref : ref && ref.id;
          if (!refId) continue;
          if (!byId.has(refId)) {
            findings.push({
              level: 'error',
              code: 'ADR_BROKEN_SUPERSEDES',
              message: `ADR ${a.id} 的 supersedes 字段引用了不存在的 ADR ${refId}`,
              evidence: { file: a.filePath, adrId: a.id, brokenRef: refId },
            });
          }
        }
      }
    }
  }

  // General info
  findings.push({
    level: 'info',
    code: 'GEN_HOOKS',
    message: 'hooks: none (automation hooks deferred this phase)',
    evidence: {},
  });

  return {
    id: w.id,
    title: w.title || w.id,
    status: w.status,
    adrCount,
    findings,
  };
}

// Classify a verifyAdrDir problem string into a structured finding.
function classifyVerifyProblem(prob, adrDir) {
  if (prob.includes('duplicate id')) {
    const m = prob.match(/duplicate id (\S+): (.+) and (.+)/);
    return {
      level: 'error',
      code: 'ADR_DUP_ID',
      message: prob,
      evidence: m ? { id: m[1], file1: m[2], file2: m[3] } : { raw: prob },
    };
  }
  if (prob.includes('reference to unknown ADR id')) {
    const m = prob.match(/(.+): reference to unknown ADR id (\S+)/);
    return {
      level: 'error',
      code: 'ADR_BROKEN_REF',
      message: prob,
      evidence: m ? { file: m[1], unknownId: m[2] } : { raw: prob },
    };
  }
  if (prob.includes('mismatches actual')) {
    const m = prob.match(/(.+): redundant title for (\S+) .+"(.+)".+mismatches actual .+"(.+)"/);
    return {
      level: 'warn',
      code: 'ADR_TITLE_MISMATCH',
      message: prob,
      evidence: m ? { file: m[1], refId: m[2], declared: m[3], actual: m[4] } : { raw: prob },
    };
  }
  return { level: 'error', code: 'ADR_VERIFY', message: prob, evidence: { raw: prob } };
}

// Build a map of adrId → [superseded adr ids].
function buildSupersedesMap(adrs) {
  const m = new Map();
  for (const a of adrs) {
    const targets = (a.supersedes || [])
      .map((r) => (typeof r === 'string' ? r : r && r.id))
      .filter(Boolean);
    m.set(a.id, targets);
  }
  return m;
}

// Walk the supersession chain forward from startId to find the latest active ADR.
function findLatestInChain(startId, supersedesMap) {
  let current = startId;
  const visited = new Set();
  const maxSteps = 50; // safety limit
  let steps = 0;
  while (current && !visited.has(current) && steps < maxSteps) {
    visited.add(current);
    steps++;
    let next = null;
    for (const [id, targets] of supersedesMap) {
      if (targets.includes(current)) {
        next = id;
        break;
      }
    }
    if (!next) break;
    current = next;
  }
  return current;
}

// Detect cycles in the supersession graph. Returns array of cycle paths.
function detectCircular(supersedesMap) {
  const cycles = [];
  const allIds = [...supersedesMap.keys()];
  for (const start of allIds) {
    const path = [];
    const pos = new Map(); // id → index in path
    let current = start;
    while (current) {
      if (pos.has(current)) {
        // Found a cycle
        const cycle = path.slice(pos.get(current));
        cycle.push(current);
        // Normalize: only report cycles starting at the smallest id
        const min = [...cycle].sort()[0];
        if (min === current || cycle[0] === min) {
          const key = cycle.join(',');
          if (!cycles.some((c) => c.join(',') === key)) {
            cycles.push(cycle);
          }
        }
        break;
      }
      pos.set(current, path.length);
      path.push(current);
      const targets = supersedesMap.get(current) || [];
      current = targets.length > 0 ? targets[0] : null; // follow first supersedes
    }
  }
  return cycles;
}

function buildSummary(workspaces) {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const w of workspaces) {
    for (const f of w.findings) {
      if (f.level === 'error') errors++;
      else if (f.level === 'warn') warnings++;
      else info++;
    }
  }
  return { errors, warnings, info };
}
