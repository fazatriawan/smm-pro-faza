const IG_SKIP = new Set(['p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'direct']);

function strip(s) {
  return String(s || '').split('?')[0].split('#')[0].trim();
}

export function normalizeInstagramUsername(line) {
  let s = strip(line).replace(/^@/, '');
  if (!s || /instagram\.com\/(p|reel|tv)\//i.test(s)) return '';

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      if (!parts.length || IG_SKIP.has(parts[0].toLowerCase())) return '';
      return parts[0].replace(/^@/, '');
    }
  } catch { /* plain */ }

  if (s.includes('instagram.com/')) {
    const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    if (m?.[1] && !IG_SKIP.has(m[1].toLowerCase())) return m[1];
    return '';
  }

  return s.split('/').filter(Boolean).pop()?.replace(/^@/, '') || '';
}

export function normalizeThreadsUsername(line) {
  let s = strip(line).replace(/^@/, '');
  if (!s || /threads\.(?:com|net)\/.*\/post\//i.test(s)) return '';

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      const at = parts.find((p) => p.startsWith('@'));
      if (at) return at.replace(/^@/, '');
      if (parts[0]?.toLowerCase() === 'post') return '';
      return (parts[0] || '').replace(/^@/, '');
    }
  } catch { /* plain */ }

  if (/threads\.(?:com|net)\/@/i.test(s)) {
    const m = s.match(/threads\.(?:com|net)\/@([A-Za-z0-9._]+)/i);
    if (m?.[1]) return m[1];
  }

  return s.split('/').filter(Boolean).pop()?.replace(/^@/, '') || '';
}

export function normalizeScraperLines(lines, platform) {
  const fn = platform === 'threads' ? normalizeThreadsUsername : normalizeInstagramUsername;
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const h = fn(line);
    if (!h) continue;
    const k = h.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}
