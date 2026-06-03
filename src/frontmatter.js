// Minimal, robust front-matter for ADR files.
// Scalar fields are `key: value`; complex fields (lists/objects) are stored as
// JSON flow (which is valid YAML), so parsing is deterministic and unambiguous.
const COMPLEX_KEYS = new Set(['supersedes', 'related', 'modifiedBy']);

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { data: {}, body: text };
  const fm = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i] === '---') {
      i++;
      break;
    }
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (COMPLEX_KEYS.has(key)) {
      try {
        fm[key] = JSON.parse(raw);
      } catch {
        fm[key] = [];
      }
    } else {
      fm[key] = raw;
    }
  }
  const body = lines.slice(i).join('\n');
  return { data: fm, body };
}

export function stringifyFrontmatter(data, body = '') {
  const order = ['id', 'title', 'status', 'createdBy', 'createdAt', 'modifiedBy', 'supersedes', 'related'];
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
  const out = ['---'];
  for (const k of keys) {
    const v = data[k];
    if (COMPLEX_KEYS.has(k) || typeof v === 'object') {
      out.push(`${k}: ${JSON.stringify(v ?? [])}`);
    } else {
      out.push(`${k}: ${v}`);
    }
  }
  out.push('---');
  const b = body.startsWith('\n') ? body : '\n' + body;
  return out.join('\n') + b;
}
