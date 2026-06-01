/** @type {Record<string, string>} */
export const NETWORK_ALIASES = {
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  fb: 'facebook',
  facebook: 'facebook',
  threads: 'threads',
  th: 'threads',
  yt: 'youtube',
  youtube: 'youtube',
  x: 'x',
  twitter: 'x',
  tiktok: 'tiktok',
  tt: 'tiktok',
  linkedin: 'linkedin',
  li: 'linkedin',
  pin: 'pinterest',
  pinterest: 'pinterest',
  bluesky: 'bluesky',
  bsky: 'bluesky',
};

const NET_LABEL = {
  instagram: 'IG',
  facebook: 'FB',
  threads: 'Threads',
  youtube: 'YT',
  x: 'X',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
};

/**
 * Parse filter platform dari command (mis. `/linkshari ig fb`, `/kuota ig`).
 * Mendukung shortcut (ig, fb, yt, tt, th, x, li, pin) dan nama lengkap
 * (instagram, facebook, threads, youtube, ...). Pemisah bisa spasi, koma,
 * titik koma. Token yang tidak dikenal masuk ke `invalid`.
 *
 * Tanpa argumen / argumen kosong → `{ networks: [], invalid: [] }` (caller
 * harus interpretasi sebagai "tampilkan semua").
 *
 * @param {string} text
 * @returns {{ networks: string[], invalid: string[] }}
 */
export function parseNetworkFilter(text) {
  const raw = String(text || '').trim();
  if (!raw) return { networks: [], invalid: [] };

  /** @type {Set<string>} */
  const networks = new Set();
  /** @type {string[]} */
  const invalid = [];

  for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
    const net = resolveAlias(token);
    if (net) {
      networks.add(net);
    } else {
      invalid.push(token);
    }
  }

  return { networks: [...networks], invalid };
}

/**
 * Label pendek per platform (untuk header report).
 * @param {string} network
 */
export function getNetworkShortLabel(network) {
  return NET_LABEL[(network || '').toLowerCase()] || network || '';
}

/**
 * @param {string} token
 */
function resolveAlias(token) {
  const key = String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return NETWORK_ALIASES[key] || null;
}

/**
 * @param {string} text
 * @returns {{ counts: Record<string, number> } | null}
 */
export function parseRandomPickCommand(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  raw = raw.replace(/^🎲\s*/u, '').replace(/^random\s+/i, '').trim();
  if (!raw) return null;

  /** @type {Record<string, number>} */
  const counts = {};

  if (/[:=]/.test(raw)) {
    for (const part of raw.split(/[,;]+/)) {
      const piece = part.trim();
      if (!piece) continue;
      const m = piece.match(/^([a-z0-9]+)\s*[:=]\s*(\d+)$/i);
      if (!m) continue;
      const net = resolveAlias(m[1]);
      if (!net) continue;
      counts[net] = (counts[net] || 0) + parseInt(m[2], 10);
    }
    if (Object.keys(counts).length) return { counts };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const asNum = /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
    const alias = resolveAlias(t);

    if (!Number.isNaN(asNum) && asNum > 0 && i + 1 < tokens.length) {
      const nextNet = resolveAlias(tokens[i + 1]);
      if (nextNet) {
        counts[nextNet] = (counts[nextNet] || 0) + asNum;
        i += 2;
        continue;
      }
    }

    if (alias) {
      let n = 1;
      if (i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
        n = parseInt(tokens[i + 1], 10);
        i += 2;
      } else {
        i += 1;
      }
      if (n > 0) counts[alias] = (counts[alias] || 0) + n;
      continue;
    }

    i += 1;
  }

  return Object.keys(counts).length ? { counts } : null;
}

/**
 * @param {string} text
 */
export function looksLikeRandomPick(text) {
  if (!text || text.length > 400) return false;
  if (/^random\b/i.test(text.trim()) || /^🎲/u.test(text.trim())) return true;
  return parseRandomPickCommand(text) !== null;
}

/**
 * @param {Array<{ id: string, network?: string, username?: string }>} items
 */
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pilih `want` akun: unik dulu, ulang maks `maxPerAccount` kali hanya jika stok kurang.
 * @param {Array<{ id: string, network?: string, username?: string }>} pool
 * @param {number} want
 * @param {number} [maxPerAccount]
 */
export function pickWithReuseCap(pool, want, maxPerAccount = 2) {
  if (!pool.length || want <= 0) return [];

  const result = [];
  const useCount = new Map();
  let stagnant = 0;

  while (result.length < want && stagnant < pool.length * maxPerAccount + 2) {
    const before = result.length;
    for (const a of shuffle(pool)) {
      if (result.length >= want) break;
      const used = useCount.get(a.id) || 0;
      if (used >= maxPerAccount) continue;
      result.push(a);
      useCount.set(a.id, used + 1);
    }
    if (result.length === before) stagnant += 1;
    else stagnant = 0;
  }

  return result;
}

/**
 * @param {Array<{ id: string }>} picked
 */
function maxUseCount(picked) {
  const c = new Map();
  for (const a of picked) {
    c.set(a.id, (c.get(a.id) || 0) + 1);
  }
  return Math.max(0, ...c.values());
}

/**
 * @param {Array<{ id: string, network?: string, username?: string }>} allAccounts
 * @param {Record<string, number>} counts
 * @param {{ excludeAccountIds?: string[], maxReusePerAccount?: number }} [options]
 */
export function pickRandomAccounts(allAccounts, counts, options = {}) {
  const exclude = new Set(options.excludeAccountIds || []);
  const maxReuse = options.maxReusePerAccount ?? 2;

  /** @type {Record<string, typeof allAccounts>} */
  const byNet = {};
  for (const a of allAccounts) {
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }

  /** @type {typeof allAccounts} */
  const picked = [];
  const breakdown = [];
  const warnings = [];
  /** @type {Array<{ network: string, want: number, got: number, missing: number, skippedUsed: number, totalOnNet: number }>} */
  const shortages = [];

  for (const [net, want] of Object.entries(counts)) {
    const totalOnNet = byNet[net] || [];
    const pool = totalOnNet.filter((a) => !exclude.has(a.id));
    const skippedUsed = totalOnNet.length - pool.length;

    if (!totalOnNet.length) {
      warnings.push(`${NET_LABEL[net] || net}: tidak ada akun di Outstand`);
      continue;
    }
    if (!pool.length) {
      warnings.push(
        `${NET_LABEL[net] || net}: ${skippedUsed} akun sudah dipakai hari ini — tidak ada sisa`
      );
      if (skippedUsed > 0) {
        shortages.push({
          network: net,
          want,
          got: 0,
          missing: want,
          skippedUsed,
          totalOnNet: totalOnNet.length,
        });
      }
      continue;
    }

    const selected = pickWithReuseCap(pool, want, maxReuse);
    const uniqueInPool = pool.length;
    const repeats = selected.length - new Set(selected.map((a) => a.id)).size;

    if (selected.length < want && skippedUsed > 0) {
      shortages.push({
        network: net,
        want,
        got: selected.length,
        missing: want - selected.length,
        skippedUsed,
        totalOnNet: totalOnNet.length,
      });
    }

    if (selected.length < want) {
      warnings.push(
        `${NET_LABEL[net] || net}: minta ${want}, hanya ${selected.length} slot (stok ${uniqueInPool} akun, maks ${maxReuse}×/akun)`
      );
    } else if (want > uniqueInPool) {
      warnings.push(
        `${NET_LABEL[net] || net}: ${want} slot dari ${uniqueInPool} akun (${repeats} pengulangan, maks ${maxReuse}×/akun)`
      );
    }

    if (skippedUsed > 0) {
      warnings.push(
        `${NET_LABEL[net] || net}: ${skippedUsed} akun dilewati (sudah post hari ini)`
      );
    }

    const peak = maxUseCount(selected);
    if (peak > maxReuse) {
      warnings.push(
        `${NET_LABEL[net] || net}: ada akun terpilih ${peak}× (dibatasi ${maxReuse}×)`
      );
    }

    picked.push(...selected);
    breakdown.push(`${NET_LABEL[net] || net}×${selected.length}`);
  }

  const label =
    picked.length > 0
      ? `Random ${breakdown.join(', ')} (${picked.length} slot)`
      : 'Random (0 akun)';

  return {
    accountIds: picked.map((a) => a.id),
    picked,
    breakdown,
    warnings,
    label,
    shortages,
  };
}

/**
 * Force-pick akun pengganti dari pool yang sudah dipakai hari ini (exclude list)
 * untuk menutup kekurangan slot. Aman dipakai setelah user konfirmasi.
 *
 * @param {Array<{ id: string, network?: string, username?: string }>} allAccounts
 * @param {Array<{ network: string, missing: number }>} shortages
 * @param {{ excludeAccountIds: string[], maxReusePerAccount?: number }} options
 */
export function fillShortageFromExcludedPool(allAccounts, shortages, options) {
  const exclude = new Set(options.excludeAccountIds || []);
  const maxReuse = options.maxReusePerAccount ?? 2;

  /** @type {Record<string, typeof allAccounts>} */
  const byNet = {};
  for (const a of allAccounts) {
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }

  /** @type {Array<{ id: string, network?: string, username?: string }>} */
  const added = [];
  /** @type {Array<{ network: string, requested: number, filled: number }>} */
  const summary = [];

  for (const s of shortages) {
    const pool = (byNet[s.network] || []).filter((a) => exclude.has(a.id));
    if (!pool.length) {
      summary.push({ network: s.network, requested: s.missing, filled: 0 });
      continue;
    }
    const picks = pickWithReuseCap(pool, s.missing, maxReuse);
    added.push(...picks);
    summary.push({
      network: s.network,
      requested: s.missing,
      filled: picks.length,
    });
  }

  return { added, summary };
}

export function formatRandomPickHelp() {
  return (
    '🎲 *Pilih akun acak per platform*\n\n' +
    'Ketik jumlah per platform, contoh:\n' +
    '• `ig 22 fb 22`\n' +
    '• `instagram 5 threads 2 youtube 1`\n' +
    '• `22 ig 22 fb` (angka dulu juga boleh)\n' +
    '• `ig:22,fb:22`\n\n' +
    'Singkatan: ig, fb, threads/th, yt, x, tiktok/tt, linkedin, pinterest/pin\n\n' +
    '• Akun yang sudah post / antrian hari ini *tidak* ikut acak lagi\n' +
    '• Satu akun maks *1×* per hari (atur `MAX_RANDOM_REUSE_PER_ACCOUNT` di .env)\n\n' +
    '🔥 *Mode force* (boleh dobel sampai 2×/akun, termasuk akun yang sudah post):\n' +
    '• `ig 44 threads 22 fb 22 force` — kalau pool kurang, bot otomatis isi sisa dengan dobel\n' +
    '• Pakai juga: `ulang` / `paksa` / `all`\n\n' +
    'Atau: `/random ig 22 fb 22`'
  );
}
