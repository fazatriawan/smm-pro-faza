/** Label platform (tampilan). */
export const PLATFORM_LABELS = {
  instagram: 'Instagram',
  threads: 'Threads',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  x: 'X',
  tiktok: 'TikTok',
};

/** Urutan kolom platform di Sheets (kiri → kanan). */
export const PLATFORM_SORT_ORDER = [
  'facebook',
  'instagram',
  'threads',
  'youtube',
  'x',
  'tiktok',
  'linkedin',
  'pinterest',
  'bluesky',
];

/** Pasangan kolom @ + Link per platform. */
export const PLATFORM_COLUMNS = PLATFORM_SORT_ORDER.filter(
  (key) => PLATFORM_LABELS[key]
).map((key) => ({
  key,
  label: PLATFORM_LABELS[key],
}));

const BASE_HEADERS = [
  'Waktu (WIB)',
  'Post ID',
  'Platform',
  'Akun',
  'Ke-#',
  'Duplikat',
  'Konten',
  'Status',
  'Link',
  'Catatan',
  'Judul YouTube',
];

export function getHeaderRow() {
  const platformHeaders = PLATFORM_COLUMNS.flatMap((c) => [
    `${c.label} @`,
    `${c.label} Link`,
  ]);
  return [...BASE_HEADERS, ...platformHeaders];
}

export function getSheetColumnCount() {
  return getHeaderRow().length;
}

/** Indeks kolom Status (0-based) — untuk ringkasan harian. */
export const SHEET_STATUS_COLUMN_INDEX = BASE_HEADERS.indexOf('Status');

/** @param {number} index1Based */
export function columnLetterFromIndex(index1Based) {
  let n = index1Based;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Indeks kolom @ untuk platform (0-based, full row).
 * @param {string} networkKey
 */
export function platformAtColumnIndex(networkKey) {
  const baseLen = BASE_HEADERS.length;
  const idx = PLATFORM_COLUMNS.findIndex((c) => c.key === networkKey);
  if (idx === -1) return -1;
  return baseLen + idx * 2;
}
