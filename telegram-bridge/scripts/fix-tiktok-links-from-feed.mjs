/**
 * Fix link TikTok di sheet hari ini menggunakan platform_url dari social-account-feeds.
 * platform_url dari endpoint ini adalah URL TikTok asli (dari TikTok open API),
 * bukan draft ID dari PostForme.
 *
 * Usage (VPS):
 *   node scripts/fix-tiktok-links-from-feed.mjs [.env]
 *   node scripts/fix-tiktok-links-from-feed.mjs .env.ari
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const envFile = process.argv[2] ?? '.env';
const envVars = {};
try {
  readFileSync(resolve(ROOT, envFile), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) envVars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
} catch { console.error(`Tidak bisa baca ${envFile}`); process.exit(1); }

const POSTFORME_API_KEY = envVars.POSTFORME_API_KEY;
const SPREADSHEET_ID = envVars.GOOGLE_SPREADSHEET_ID;
const SA_PATH = envVars.GOOGLE_SERVICE_ACCOUNT_PATH ?? resolve(ROOT, 'secrets/sa.json');

if (!POSTFORME_API_KEY || !SPREADSHEET_ID) {
  console.error('POSTFORME_API_KEY atau GOOGLE_SPREADSHEET_ID tidak ditemukan');
  process.exit(1);
}

const client = axios.create({
  baseURL: 'https://api.postforme.dev',
  headers: { Authorization: `Bearer ${POSTFORME_API_KEY}` },
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Ambil semua akun TikTok ──────────────────────────────────────────────────
async function getTikTokAccounts() {
  const all = [];
  let offset = 0;
  for (let page = 1; page <= 25; page++) {
    const res = await client.get('/v1/social-accounts', { params: { limit: 100, offset } });
    const items = res.data?.data ?? [];
    if (!items.length) break;
    all.push(...items);
    if (!res.data?.meta?.next || items.length < 100) break;
    offset += items.length;
  }
  return all.filter(a => (a.platform ?? a.network ?? '').toLowerCase() === 'tiktok');
}

// ── Ambil feed satu akun (platform_url per post) ─────────────────────────────
async function getAccountFeed(accountId) {
  try {
    const res = await client.get(`/v1/social-account-feeds/${accountId}`);
    return res.data?.data ?? [];
  } catch { return []; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // 1. Baca sheet hari ini
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const tabName = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = meta.data.sheets.find(s => s.properties.title === tabName || s.properties.title.startsWith(tabName));
  if (!tab) { console.log(`Tab "${tabName}" tidak ditemukan.`); process.exit(1); }

  const title = tab.properties.title;
  console.log(`Tab: ${title}`);
  const sheetRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${title}'` });
  const rows = sheetRes.data.values ?? [];

  // 2. Kumpulkan semua username TikTok di sheet + kolom URL-nya
  // Format baris: kolom A=network, B=username, kolom lain ada tiktok.com URL
  const tikRowIndices = [];
  for (let i = 0; i < rows.length; i++) {
    const net = (rows[i][0] ?? '').toLowerCase();
    if (net === 'tiktok') tikRowIndices.push(i);
  }
  console.log(`Baris TikTok di sheet: ${tikRowIndices.length}`);

  // 3. Ambil akun TikTok dari PostForme
  console.log('Mengambil daftar akun TikTok...');
  const tikAccounts = await getTikTokAccounts();
  console.log(`Akun TikTok PostForme: ${tikAccounts.length}`);

  // Map: username lowercase → { id, platform_url terbaru per tanggal hari ini }
  const usernameToFeed = new Map(); // username → [{ platform_url, posted_at, social_post_id }]

  console.log('Mengambil feed per akun (throttled)...');
  for (let i = 0; i < tikAccounts.length; i++) {
    const acct = tikAccounts[i];
    const username = (acct.username ?? '').toLowerCase().replace(/^@/, '');
    await sleep(350);
    const feed = await getAccountFeed(acct.id);
    const todayItems = feed.filter(item => {
      if (!item.platform_url) return false;
      const d = item.posted_at ? new Date(item.posted_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '';
      return d === tabName;
    });
    if (todayItems.length) {
      usernameToFeed.set(username, todayItems);
      console.log(`  @${username}: ${todayItems.length} post hari ini`);
    }
    if ((i + 1) % 10 === 0) console.log(`  Progress: ${i + 1}/${tikAccounts.length}`);
  }

  console.log(`\nAkun dengan feed hari ini: ${usernameToFeed.size}`);

  // 4. Update sheet
  const updates = [];
  for (const rowIdx of tikRowIndices) {
    const row = rows[rowIdx];
    const username = (row[1] ?? '').replace(/^@/, '').trim().toLowerCase();
    const feedItems = usernameToFeed.get(username);
    if (!feedItems?.length) continue;

    // Gunakan platform_url pertama (terbaru hari ini)
    const newUrl = feedItems[0].platform_url;

    for (let col = 0; col < row.length; col++) {
      const cell = row[col] ?? '';
      if (!cell.includes('tiktok.com')) continue;
      if (cell === newUrl) continue; // sudah benar

      const colLetter = col < 26
        ? String.fromCharCode(65 + col)
        : String.fromCharCode(64 + Math.floor(col / 26)) + String.fromCharCode(65 + (col % 26));
      updates.push({ range: `'${title}'!${colLetter}${rowIdx + 1}`, values: [[newUrl]] });
      console.log(`  @${username} row ${rowIdx + 1}: ${cell}`);
      console.log(`           → ${newUrl}`);
    }
  }

  if (!updates.length) {
    console.log('\nTidak ada link yang perlu diubah.');
    return;
  }

  console.log(`\nMengupdate ${updates.length} sel...`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
  });
  console.log(`✅ ${updates.length} link berhasil diperbarui.`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
