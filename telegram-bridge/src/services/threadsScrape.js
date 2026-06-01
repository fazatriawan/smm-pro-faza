import axios from 'axios';

const client = axios.create({
  timeout: 25_000,
  headers: {
    // Be a bit more browser-like; Threads sometimes blocks default UA.
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  },
});

const POST_RE =
  /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^\/?#\s]+\/post\/[A-Za-z0-9_-]{6,20}/gi;

/**
 * Ambil link post terbaru dari halaman profil Threads (tanpa login).
 * Catatan: ini *heuristic* (latest on profile), tidak bisa menjamin cocok dengan batch tertentu
 * jika akun tersebut posting beberapa kali.
 *
 * @param {string} username
 * @returns {Promise<string>} URL post atau '' jika tidak ditemukan
 */
export async function scrapeThreadsLatestPostUrl(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!handle) return '';

  const url = `https://www.threads.com/@${encodeURIComponent(handle)}`;
  const res = await client.get(url);
  const html = String(res.data || '');
  const matches = [...html.matchAll(POST_RE)].map((m) => m[0]);
  if (!matches.length) return '';

  // Most pages contain duplicates; keep first unique.
  const seen = new Set();
  for (const m of matches) {
    const s = String(m || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    return s.replace('threads.net', 'threads.com');
  }
  return '';
}

/**
 * Batch scrape untuk beberapa username, dengan jeda kecil agar tidak dianggap spam.
 * @param {string[]} usernames
 */
export async function scrapeThreadsLatestPostUrls(usernames = []) {
  const out = [];
  const list = (usernames || [])
    .map((u) => String(u || '').replace(/^@/, '').trim())
    .filter(Boolean);

  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    const link = await scrapeThreadsLatestPostUrl(u).catch(() => '');
    out.push({ username: u, url: link });
    if (i < list.length - 1) {
      // small jitter
      await new Promise((r) => setTimeout(r, 350 + Math.floor(Math.random() * 250)));
    }
  }
  return out;
}

