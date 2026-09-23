/**
 * Perbaiki link TikTok hari ini yang menggunakan display name (spasi/%20) sebagai username.
 * Tidak butuh PostForme API — video ID sudah ada di URL yang salah.
 *
 * Usage (di VPS):
 *   node scripts/fix-tiktok-links-today.mjs [.env]
 *   node scripts/fix-tiktok-links-today.mjs .env.ari
 */

import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const envFile = process.argv[2] ?? '.env';
const envPath = resolve(ROOT, envFile);
const envVars = {};
try {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) envVars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
} catch {
  console.error(`Tidak bisa baca ${envPath}`);
  process.exit(1);
}

const SPREADSHEET_ID = envVars.GOOGLE_SPREADSHEET_ID;
const SA_PATH = envVars.GOOGLE_SERVICE_ACCOUNT_PATH ?? resolve(ROOT, 'secrets/sa.json');

if (!SPREADSHEET_ID) { console.error('GOOGLE_SPREADSHEET_ID tidak ditemukan'); process.exit(1); }

function fixTikTokUrl(url) {
  if (!url || !url.includes('tiktok.com')) return null;
  if (!/\/video\/\d+/.test(url)) return null;

  const beforeVideo = url.split('/video/')[0];
  // Hanya fix jika ada spasi atau %20 di bagian sebelum /video/ (display name)
  if (!beforeVideo.includes('%20') && !beforeVideo.includes(' ')) return null;

  const m = url.match(/\/video\/(\d+)/);
  if (!m) return null;
  return `https://www.tiktok.com/video/${m[1]}`;
}

(async () => {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Cari tab hari ini (WIB)
  const tabName = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = meta.data.sheets.find(
    (s) => s.properties.title === tabName || s.properties.title.startsWith(tabName)
  );
  if (!tab) {
    console.log(`Tab "${tabName}" tidak ditemukan.`);
    meta.data.sheets.forEach((s) => console.log(' -', s.properties.title));
    process.exit(1);
  }

  const title = tab.properties.title;
  console.log(`Membaca tab: ${title}`);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${title}'` });
  const rows = res.data.values ?? [];

  const updates = [];
  let checked = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const net = (row[0] ?? '').toLowerCase();
    if (net !== 'tiktok') continue;

    for (let col = 0; col < row.length; col++) {
      const cell = row[col] ?? '';
      if (!cell.includes('tiktok.com')) continue;
      checked++;

      const fixed = fixTikTokUrl(cell);
      if (fixed && fixed !== cell) {
        const colLetter = col < 26
          ? String.fromCharCode(65 + col)
          : String.fromCharCode(65 + Math.floor(col / 26) - 1) + String.fromCharCode(65 + (col % 26));
        updates.push({ range: `'${title}'!${colLetter}${i + 1}`, values: [[fixed]] });
        console.log(`  Row ${i + 1} col ${colLetter}: ${cell}`);
        console.log(`           → ${fixed}`);
      }
    }
  }

  console.log(`\nDicek: ${checked} sel TikTok, perlu difix: ${updates.length}`);

  if (!updates.length) {
    console.log('Semua link TikTok sudah benar, tidak ada yang perlu diubah.');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
  });
  console.log(`✅ ${updates.length} link berhasil diperbaiki.`);
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
