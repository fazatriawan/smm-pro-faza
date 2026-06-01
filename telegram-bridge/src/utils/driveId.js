/**
 * Extract Google Drive folder/file ID from raw ID or sharing URL.
 * @param {string} input
 */
export function parseDriveId(input) {
  const raw = (input || '').trim();
  if (!raw) return '';

  if (!raw.includes('/')) return raw;

  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /\/drive\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
  ];

  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }

  return raw;
}

const DRIVE_URL_RE =
  /https?:\/\/(?:drive|docs)\.google\.com\/[^\s)>\]]+/gi;

/**
 * Ambil ID folder/file dari teks pesan (link kiriman dari orang lain).
 * @param {string} text
 */
export function extractDriveLinkFromText(text) {
  const raw = (text || '').trim();
  if (!raw) return '';

  const urls = raw.match(DRIVE_URL_RE);
  if (urls?.[0]) return parseDriveId(urls[0]);

  if (/drive\.google\.com|docs\.google\.com/i.test(raw)) {
    return parseDriveId(raw);
  }

  return '';
}
