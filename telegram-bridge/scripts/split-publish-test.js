/**
 * Split test / audit duplikat publish — bukti dari API Outstand, bukan teori.
 *
 * Usage (di VPS, folder /opt/telegram-bridge):
 *   node scripts/split-publish-test.js pending
 *   node scripts/split-publish-test.js dup-accounts
 *   node scripts/split-publish-test.js audit-post XsGne
 *   node scripts/split-publish-test.js audit-post XsGne yNwgj
 *   node scripts/split-publish-test.js by-user fadzillacandrasari
 *
 * Env: baca .env di root telegram-bridge (OUTSTAND_API_KEY).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const { listSocialAccounts, getPost, listRecentPostIds } = await import(
  '../src/services/outstand.js'
);

function normUser(u) {
  return String(u || '').replace(/^@/, '').trim().toLowerCase();
}

async function cmdPending() {
  const daysBack = Number(process.argv[3] || 3) || 3;
  const ids = await listRecentPostIds({ daysBack });
  console.log(`\n=== Pending scan (${daysBack} hari, ${ids.length} Post ID) ===\n`);

  let totalPending = 0;
  /** @type {Map<string, number>} */
  const pendingByPost = new Map();

  for (const id of ids) {
    let post;
    try {
      post = await getPost(id);
    } catch (err) {
      console.log(`  ${id}: ERROR ${err.message}`);
      continue;
    }
    const pending = (post?.socialAccounts || []).filter(
      (a) => (a.status || '').toLowerCase() === 'pending'
    );
    if (!pending.length) continue;
    pendingByPost.set(id, pending.length);
    totalPending += pending.length;
    console.log(`Post ${id}: ${pending.length} akun pending`);
    for (const a of pending.slice(0, 8)) {
      console.log(
        `    ${(a.network || '?').padEnd(10)} @${normUser(a.username || a.id)}`
      );
    }
    if (pending.length > 8) console.log(`    …+${pending.length - 8}`);
  }

  if (!totalPending) {
    console.log('Tidak ada pending di rentang ini.');
  } else {
    console.log(`\nTotal: ${totalPending} slot pending · ${pendingByPost.size} Post ID`);
    console.log('Cancel: /stop 7d ya  (Telegram bot)\n');
  }
}

async function cmdDupAccounts() {
  const accounts = await listSocialAccounts({ force: true });
  /** @type {Map<string, Array<{ id: string, network: string, username: string }>>} */
  const byUser = new Map();

  for (const a of accounts) {
    const user = normUser(a.username);
    if (!user) continue;
    const key = `${(a.network || '').toLowerCase()}:${user}`;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push({
      id: a.id,
      network: a.network || '',
      username: a.username || '',
    });
  }

  const dupes = [...byUser.entries()].filter(([, list]) => list.length > 1);
  console.log(`\n=== Akun Outstand duplikat (username sama, ID beda) ===\n`);
  if (!dupes.length) {
    console.log('Tidak ada — satu ID per @username per platform.');
    return;
  }
  for (const [key, list] of dupes.sort()) {
    console.log(`${key} → ${list.length} koneksi:`);
    for (const x of list) console.log(`    id=${x.id}`);
  }
  console.log(
    '\n⚠️ Satu publish bisa kirim ke 2 ID → 2 post di profil yang sama.\n'
  );
}

/**
 * @param {string[]} postIds
 */
async function cmdAuditPost(postIds) {
  console.log(`\n=== Audit Post ID (${postIds.length}) ===\n`);

  /** @type {Map<string, Array<{ postId: string, status: string, platformPostId: string }>>} */
  const byUser = new Map();

  for (const id of postIds) {
    let post;
    try {
      post = await getPost(id);
    } catch (err) {
      console.log(`Post ${id}: GAGAL — ${err.message}\n`);
      continue;
    }

    const accounts = post?.socialAccounts || [];
    const pub = accounts.filter((a) => (a.status || '').toLowerCase() === 'published');
    const pen = accounts.filter((a) => (a.status || '').toLowerCase() === 'pending');
    const fail = accounts.filter((a) => (a.status || '').toLowerCase() === 'failed');

    console.log(
      `Post ${id}: ${pub.length} published · ${pen.length} pending · ${fail.length} failed · ${accounts.length} total`
    );

    for (const a of accounts) {
      const key = `${(a.network || '').toLowerCase()}:${normUser(a.username)}`;
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push({
        postId: id,
        status: a.status || '?',
        platformPostId: String(a.platformPostId || ''),
      });
    }
    console.log('');
  }

  console.log('--- Per @username (semua Post ID di atas) ---\n');
  let multiPublish = 0;
  for (const [key, rows] of [...byUser.entries()].sort()) {
    const published = rows.filter((r) => r.status === 'published');
    if (published.length <= 1 && rows.length <= 1) continue;
    multiPublish += 1;
    console.log(`${key}:`);
    for (const r of rows) {
      console.log(
        `    Post ${r.postId} · ${r.status} · platformPostId=${r.platformPostId || '-'}`
      );
    }
    if (published.length > 1) {
      console.log(
        `    ⚠️ ${published.length}× published di Outstand untuk user ini (bukan 1 batch saja)`
      );
    }
    console.log('');
  }

  if (!multiPublish) {
    console.log('Tidak ada @ yang muncul di lebih dari satu baris audit.');
  } else {
    console.log(
      `Ditemukan ${multiPublish} akun dengan jejak >1 Post ID / status — bukti multi-batch atau antrian.`
    );
  }
  console.log('');
}

function isInstagram(network) {
  const n = String(network || '').toLowerCase();
  return n === 'instagram' || n === 'ig';
}

function wibTodayStartMs() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wib = new Date(utc + 7 * 3600 * 1000);
  wib.setUTCHours(0, 0, 0, 0);
  return wib.getTime() - 7 * 3600 * 1000;
}

async function collectUserHits(username, daysBack, { instagramOnly = false } = {}) {
  const user = normUser(username);
  const ids = await listRecentPostIds({ daysBack });
  /** @type {Array<{ postId: string, network: string, status: string, platformPostId: string, publishedAt?: string, createdAt?: string }>} */
  const hits = [];

  for (const id of ids) {
    let post;
    try {
      post = await getPost(id);
    } catch {
      continue;
    }
    const createdAt = post?.createdAt ?? post?.created_at ?? '';
    for (const a of post?.socialAccounts || []) {
      if (normUser(a.username) !== user) continue;
      if (instagramOnly && !isInstagram(a.network)) continue;
      hits.push({
        postId: id,
        network: a.network,
        status: (a.status || '').toLowerCase(),
        platformPostId: String(a.platformPostId || ''),
        publishedAt: a.publishedAt,
        createdAt,
      });
    }
  }
  return { user, hits, scannedPostIds: ids.length };
}

function printUserHitSummary(hits, label) {
  if (!hits.length) {
    console.log('Tidak ada entri.');
    return;
  }
  for (const h of hits) {
    console.log(
      `${h.postId} · ${h.network} · ${h.status} · id=${h.platformPostId || '-'}`
    );
  }

  const byStatus = {};
  for (const h of hits) {
    byStatus[h.status] = (byStatus[h.status] || 0) + 1;
  }
  const pub = hits.filter((h) => h.status === 'published');
  const failed = hits.filter((h) => h.status === 'failed');
  const platformIds = hits
    .map((h) => h.platformPostId)
    .filter(Boolean);
  const uniquePlatform = new Set(platformIds);

  console.log(`\n--- Ringkasan ${label} ---`);
  console.log(`Total percobaan ke akun: ${hits.length}`);
  console.log(`Post ID unik: ${new Set(hits.map((h) => h.postId)).size}`);
  console.log(`Published: ${pub.length} · Failed: ${failed.length} · Pending: ${byStatus.pending || 0}`);
  console.log(`platformPostId unik (IG media): ${uniquePlatform.size}`);
  if (failed.length > 0) {
    console.log(
      `⚠️ ${failed.length}× status failed — Meta kadang tetap live; bisa jelaskan gap API vs grid IG.`
    );
  }
  if (pub.length > 1 || hits.length > pub.length + 1) {
    console.log(
      '⚠️ Banyak jejak ke akun ini → multi-batch, retry, atau failed-but-live.'
    );
  }
  console.log('');
}

async function cmdByUser(username) {
  const daysBack = Number(process.argv[4] || 5) || 5;
  const todayOnly = (process.argv[5] || '').toLowerCase() === 'today';
  const { user, hits: allHits, scannedPostIds } = await collectUserHits(username, daysBack);

  let hits = allHits;
  if (todayOnly) {
    const start = wibTodayStartMs();
    hits = allHits.filter((h) => {
      const t = Date.parse(h.publishedAt || h.createdAt || '');
      return Number.isFinite(t) && t >= start;
    });
  }

  const scope = todayOnly ? 'hari ini (WIB)' : `${daysBack} hari`;
  console.log(`\n=== Riwayat Outstand @${user} (${scope}, ${scannedPostIds} Post ID discan) ===\n`);
  printUserHitSummary(hits, scope);
}

/** Hitung khusus IG — untuk bandingkan dengan hitungan manual di grid profil. */
async function cmdCountIg(username) {
  const daysBack = Number(process.argv[4] || 14) || 14;
  const { user, hits, scannedPostIds } = await collectUserHits(username, daysBack, {
    instagramOnly: true,
  });

  console.log(`\n=== Hitung IG @${user} (${daysBack} hari, ${scannedPostIds} Post ID discan) ===\n`);
  printUserHitSummary(hits, `IG ${daysBack} hari`);

  const pub = hits.filter((h) => h.status === 'published');
  const failed = hits.filter((h) => h.status === 'failed');
  console.log('Bandingkan angka "platformPostId unik" dengan jumlah tile QURBAN di grid IG.');
  console.log(
    `Jika grid >> ${pub.length + failed.length}, kemungkinan: (1) rentang > ${daysBack} hari, (2) post manual di luar Outstand, (3) duplikat ID akun IG di Outstand.`
  );
  console.log('');
}

const cmd = (process.argv[2] || '').toLowerCase();

try {
  if (cmd === 'pending') {
    await cmdPending();
  } else if (cmd === 'dup-accounts' || cmd === 'dup') {
    await cmdDupAccounts();
  } else if (cmd === 'audit-post' || cmd === 'audit') {
    const ids = process.argv.slice(3).filter(Boolean);
    if (!ids.length) {
      console.error('Usage: node scripts/split-publish-test.js audit-post ID1 ID2');
      process.exit(1);
    }
    await cmdAuditPost(ids);
  } else if (cmd === 'by-user' || cmd === 'user') {
    const user = process.argv[3];
    if (!user) {
      console.error('Usage: node scripts/split-publish-test.js by-user USERNAME [hari] [today]');
      process.exit(1);
    }
    await cmdByUser(user);
  } else if (cmd === 'count-ig' || cmd === 'ig-count') {
    const user = process.argv[3];
    if (!user) {
      console.error('Usage: node scripts/split-publish-test.js count-ig USERNAME [hari]');
      process.exit(1);
    }
    await cmdCountIg(user);
  } else {
    console.log(`
Split publish test — bukti API Outstand

  node scripts/split-publish-test.js pending [hari]
  node scripts/split-publish-test.js dup-accounts
  node scripts/split-publish-test.js audit-post POST_ID ...
  node scripts/split-publish-test.js by-user USERNAME [hari] [today]
  node scripts/split-publish-test.js count-ig USERNAME [hari]

Protokol uji 1 publish (manual di Telegram):
  1. /outstand off 14d  atau  /stop 7d ya
  2. Pilih 2 akun IG test saja (bukan 22)
  3. Satu media kecil, /publish, Send Now sekali
  4. Catat Post ID dari bot
  5. node scripts/split-publish-test.js audit-post <ID>
  6. node scripts/split-publish-test.js by-user <username_test>
  7. Cek grid IG: harus +1 post per akun. Tunggu 30 menit, ulang langkah 6–7.
`);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
