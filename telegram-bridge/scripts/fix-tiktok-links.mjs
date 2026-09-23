/**
 * Script sekali-pakai: ambil final TikTok video URL dari PostForme
 * untuk post ID tertentu, lalu update kolom link di Google Sheet.
 *
 * Usage:
 *   node scripts/fix-tiktok-links.mjs sp_R1PxtbtOLsU74hWuAY0a [.env.file]
 *
 * Contoh (VPS):
 *   node scripts/fix-tiktok-links.mjs sp_R1PxtbtOLsU74hWuAY0a .env
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ── Load env ────────────────────────────────────────────────────────────────
const envFile = process.argv[3] ?? '.env';
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

const POSTFORME_API_KEY = envVars.POSTFORME_API_KEY;
const SPREADSHEET_ID     = envVars.GOOGLE_SPREADSHEET_ID;
const SA_PATH            = envVars.GOOGLE_SERVICE_ACCOUNT_PATH ?? resolve(ROOT, 'secrets/sa.json');

if (!POSTFORME_API_KEY) { console.error('POSTFORME_API_KEY tidak ditemukan'); process.exit(1); }
if (!SPREADSHEET_ID)    { console.error('GOOGLE_SPREADSHEET_ID tidak ditemukan'); process.exit(1); }

const POST_ID = process.argv[2];
if (!POST_ID) {
  console.error('Usage: node scripts/fix-tiktok-links.mjs <post_id> [env_file]');
  process.exit(1);
}

// ── PostForme client ─────────────────────────────────────────────────────────
const pfm = axios.create({
  baseURL: 'https://api.postforme.dev',
  headers: { Authorization: `Bearer ${POSTFORME_API_KEY}` },
});

async function getAccountMap() {
  const allRaw = [];
  let offset = 0;
  for (let page = 1; page <= 25; page++) {
    const res = await pfm.get('/v1/social-accounts', { params: { limit: 100, offset } });
    const body = res.data;
    const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    if (!items.length) break;
    allRaw.push(...items);
    const total = body?.meta?.total ?? null;
    if (total !== null && allRaw.length >= total) break;
    if (!body?.meta?.next || items.length < 100) break;
    offset += items.length;
  }
  console.log(`  Accounts: ${allRaw.length} ditemukan`);
  // Debug: print sample platform values
  const platforms = [...new Set(allRaw.map((a) => a.platform ?? a.network ?? 'unknown'))];
  console.log(`  Platform values:`, platforms.join(', '));
  return new Map(allRaw.map((a) => [String(a.id), a]));
}

async function getResults(postId) {
  const res = await pfm.get('/v1/social-post-results', { params: { post_id: postId, limit: 100 } });
  const list = res.data?.data ?? res.data ?? [];
  console.log(`  Results: ${list.length} ditemukan`);
  return list;
}

function stripTikTokPrefix(raw) {
  // Strip format internal PostForme: v_pub_file~v2-1.{numericId} → numericId
  return String(raw || '').replace(/^v_pub_\w+~v\d+-\d+\./i, '');
}

function buildTikTokUrl(platformData, username) {
  // Coba ambil dari url/post_url/share_url dulu
  const direct = platformData?.url ?? platformData?.post_url ?? platformData?.share_url ?? '';
  if (direct) {
    // Strip prefix internal dari path video jika ada
    const cleaned = direct.replace(/(\/video\/)v_pub_\w+~v\d+-\d+\./i, '$1');
    if (/\/video\/\d+/.test(cleaned)) {
      if (/%20/i.test(cleaned)) {
        const m = cleaned.match(/\/video\/(\d+)/);
        if (m) return `https://www.tiktok.com/video/${m[1]}`;
      }
      return cleaned;
    }
  }
  // Fallback: bangun dari platform_data.id (strip prefix dulu)
  const rawId = platformData?.id ?? '';
  if (!rawId) return '';
  const tikId = stripTikTokPrefix(rawId);
  if (!tikId || !/^\d+$/.test(tikId)) return '';
  const handle = (username || '').replace(/^@/, '').trim();
  if (handle && !/\s/.test(handle)) {
    return `https://www.tiktok.com/@${handle}/video/${tikId}`;
  }
  return `https://www.tiktok.com/video/${tikId}`;
}

// ── Google Sheets client ──────────────────────────────────────────────────────
async function getSheetsClient() {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function findAndFixSheet(sheets, usernameToUrl) {
  // Cari tab hari ini (YYYY-MM-DD WIB)
  const tabName = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = meta.data.sheets.find(
    (s) => s.properties.title === tabName || s.properties.title.startsWith(tabName)
  );
  if (!tab) {
    console.log(`Tab "${tabName}" tidak ditemukan. Sheet yang ada:`);
    meta.data.sheets.forEach((s) => console.log(' -', s.properties.title));
    return;
  }

  const range = `'${tab.properties.title}'`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values ?? [];

  const updates = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Kolom A=network, B=username, kolom G (index 6) biasanya URL
    // Cari kolom yang mengandung tiktok.com
    const net = (row[0] ?? '').toLowerCase();
    if (net !== 'tiktok') continue;

    const rawUser = (row[1] ?? '').replace(/^@/, '').trim().toLowerCase();
    // Cari URL kolom (biasanya index 6 di format wide sheet)
    for (let col = 4; col < row.length; col++) {
      const cell = row[col] ?? '';
      if (!cell.includes('tiktok.com')) continue;

      // Cari URL baru berdasarkan username
      const newUrl = [...usernameToUrl.entries()].find(
        ([u]) => u.replace(/^@/, '').toLowerCase() === rawUser
      )?.[1];

      if (newUrl && newUrl !== cell) {
        const colLetter = String.fromCharCode(65 + col);
        const cellRef = `'${tab.properties.title}'!${colLetter}${i + 1}`;
        updates.push({ range: cellRef, values: [[newUrl]] });
        console.log(`  Row ${i + 1} @${rawUser}: ${cell} → ${newUrl}`);
      }
    }
  }

  if (!updates.length) {
    console.log('Tidak ada perubahan yang perlu dilakukan.');
    return;
  }

  console.log(`\nMengupdate ${updates.length} sel di Sheet...`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });
  console.log('✅ Sheet berhasil diperbarui.');
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Fetching PostForme results untuk post: ${POST_ID}`);
  console.log('  Mengambil daftar akun...');
  const acctMap = await getAccountMap();
  console.log('  Mengambil hasil post...');
  const items = await getResults(POST_ID);

  // Debug: lihat sample result untuk cek field names
  if (items.length > 0) {
    const sample = items[0];
    console.log('Sample result fields:', Object.keys(sample).join(', '));
    console.log('Sample social_account_id:', sample.social_account_id);
    const sampleAcct = acctMap.get(String(sample.social_account_id ?? ''));
    console.log('Sample account match:', sampleAcct ? `${sampleAcct.platform ?? sampleAcct.network} @${sampleAcct.username}` : 'NOT FOUND');
  }

  const tikTokResults = items.filter((r) => {
    const acct = acctMap.get(String(r.social_account_id ?? ''));
    const net = (acct?.platform ?? acct?.network ?? '').toLowerCase();
    return net === 'tiktok' || net === 'tik_tok' || net === 'tik-tok';
  });

  console.log(`Ditemukan ${tikTokResults.length} hasil TikTok\n`);

  /** @type {Map<string, string>} username → correct URL */
  const usernameToUrl = new Map();
  for (const r of tikTokResults) {
    const acct = acctMap.get(String(r.social_account_id ?? ''));
    const username = acct?.username ?? '';
    const url = buildTikTokUrl(r.platform_data, username);
    if (username && url) {
      usernameToUrl.set(username, url);
      console.log(`@${username.padEnd(30)} ${url}`);
    }
  }

  if (!usernameToUrl.size) {
    console.log('Tidak ada URL TikTok yang ditemukan dari API.');
    return;
  }

  console.log('\nMenghubungkan ke Google Sheets...');
  const sheets = await getSheetsClient();
  await findAndFixSheet(sheets, usernameToUrl);
})().catch((err) => {
  console.error('Error:', err.message);
  if (err.response) {
    console.error('Status:', err.response.status);
    console.error('Response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
