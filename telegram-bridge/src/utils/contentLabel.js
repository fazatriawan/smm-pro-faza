/**
 * Label singkat konten untuk Sheets (folder / media / cuplikan caption).
 * @param {{ folderName?: string, caption?: string, mediaFiles?: Array<{ name?: string }>, targetLabel?: string, missionTitle?: string }} input
 */
export function buildContentLabel(input = {}) {
  const parts = [];

  const folder = String(input.folderName || input.missionTitle || '').trim();
  if (folder) parts.push(folder);

  const media = input.mediaFiles || [];
  if (media.length) {
    const names = media
      .slice(0, 2)
      .map((f) => String(f.name || 'media').trim())
      .filter(Boolean);
    if (names.length) {
      parts.push(
        media.length > 2
          ? `${names.join(', ')} +${media.length - 2}`
          : names.join(', ')
      );
    }
  }

  const cap = String(input.caption || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cap) {
    const snippet = cap.length > 55 ? `${cap.slice(0, 54)}…` : cap;
    if (!parts.length || !parts.some((p) => cap.startsWith(p.slice(0, 20)))) {
      parts.push(snippet);
    }
  }

  if (!parts.length) {
    const target = String(input.targetLabel || '').trim();
    if (target) parts.push(target);
  }

  return shortenContentLabel(parts.join(' · '), 110);
}

/**
 * @param {string} text
 * @param {number} [max]
 */
export function shortenContentLabel(text, max = 100) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
