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

/** Pasangan kolom @ + Link per platform (format lama). */
export const PLATFORM_COLUMNS = PLATFORM_SORT_ORDER.filter(
  (key) => PLATFORM_LABELS[key]
).map((key) => ({
  key,
  label: PLATFORM_LABELS[key],
}));

/** Kolom tetap kiri — satu baris = satu akun per platform. */
export const WIDE_ROW_HEADERS = ['Platform', 'Akun', 'Ke-#', 'Duplikat'];

/** Kolom per instruksi publish (berulang ke kanan untuk tiap batch). */
export const INSTRUCTION_BLOCK_FIELDS = ['Konten', 'Status', 'Link', 'Post ID'];

export const INSTRUCTION_BLOCK_SIZE = INSTRUCTION_BLOCK_FIELDS.length;

const LEGACY_BASE_HEADERS = [
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

/** Format lama (satu baris = satu posting). */
export function getLegacyHeaderRow() {
  const platformHeaders = PLATFORM_COLUMNS.flatMap((c) => [
    `${c.label} @`,
    `${c.label} Link`,
  ]);
  return [...LEGACY_BASE_HEADERS, ...platformHeaders];
}

/** @deprecated Alias format lama — tab baru memakai layout lebar. */
export function getHeaderRow() {
  return getLegacyHeaderRow();
}

export function isLegacySheetHeader(headerRow = []) {
  return String(headerRow[0] || '').trim() === 'Waktu (WIB)';
}

export function isWideSheetHeader(headerRow = []) {
  return String(headerRow[0] || '').trim() === 'Platform';
}

/**
 * Header dinamis: kolom kiri + blok Konten/Status/Link/Post ID per instruksi.
 * @param {Array<{ headerPrefix?: string, label?: string }>} instructions
 */
export function buildWideHeaderRow(instructions = []) {
  const cols = [...WIDE_ROW_HEADERS];
  for (const inst of instructions) {
    const prefix = inst.headerPrefix || inst.label || 'Instruksi';
    for (const field of INSTRUCTION_BLOCK_FIELDS) {
      cols.push(`${prefix} ${field}`);
    }
  }
  return cols;
}

export function getWideBaseHeaderRow() {
  return buildWideHeaderRow([]);
}

/**
 * @param {string[]} headerRow
 */
export function parseWideSheetHeader(headerRow = []) {
  const instructions = [];
  const baseLen = WIDE_ROW_HEADERS.length;
  let i = baseLen;
  while (i < headerRow.length) {
    const title = String(headerRow[i] || '').trim();
    if (!title) break;
    const kontenIdx = i;
    const statusIdx = i + 1;
    const linkIdx = i + 2;
    const postIdIdx = i + 3;
    const prefix = title.replace(/\s+Konten$/i, '').trim();
    instructions.push({
      prefix,
      kontenIdx,
      statusIdx,
      linkIdx,
      postIdIdx,
    });
    i += INSTRUCTION_BLOCK_SIZE;
  }
  return { instructions, baseLen };
}

/**
 * @param {string[]} [headerRow]
 */
export function getSheetColumnCount(headerRow) {
  if (headerRow?.length) return headerRow.length;
  return getLegacyHeaderRow().length;
}

/** Indeks kolom Status format lama — ringkasan harian. */
export const SHEET_STATUS_COLUMN_INDEX = LEGACY_BASE_HEADERS.indexOf('Status');

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
 * Indeks kolom @ untuk platform (format lama).
 * @param {string} networkKey
 */
export function platformAtColumnIndex(networkKey) {
  const baseLen = LEGACY_BASE_HEADERS.length;
  const idx = PLATFORM_COLUMNS.findIndex((c) => c.key === networkKey);
  if (idx === -1) return -1;
  return baseLen + idx * 2;
}
