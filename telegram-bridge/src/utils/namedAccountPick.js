import { NETWORK_ALIASES, getNetworkShortLabel } from './randomAccountPick.js';
import {
  buildAccountIssueMap,
  formatHealthAttentionBlock,
  issueBadge,
} from './accountHealth.js';

const NETWORK_ORDER = [
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
 * @param {string} token
 */
export function normalizeUsernameToken(token) {
  return String(token || '')
    .replace(/^@+/, '')
    .trim();
}

const FORCE_KEYWORD_RE = /\b(force|ulang|paksa|all)\b/gi;

/**
 * @param {string} text
 */
export function isPickForceKeyword(token) {
  return /^(force|ulang|paksa|all)$/i.test(String(token || '').trim());
}

/**
 * @param {string} text
 * @returns {{ clean: string, force: boolean }}
 */
export function stripPickForceKeyword(text) {
  const raw = String(text || '');
  const force = FORCE_KEYWORD_RE.test(raw);
  const clean = raw
    .replace(FORCE_KEYWORD_RE, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return { clean, force };
}

/**
 * @param {string} s
 * @param {{ scoped?: boolean }} [opts]
 * @returns {string[]}
 */
function splitUsernames(s, opts = {}) {
  const raw = String(s || '').trim();
  if (!raw) return [];

  let names;
  if (/[,;]/.test(raw)) {
    names = raw
      .split(/[,;]+/)
      .map(normalizeUsernameToken)
      .filter(Boolean);
  } else if (/@/.test(raw)) {
    names = raw
      .split(/@+/)
      .map(normalizeUsernameToken)
      .filter(Boolean);
  } else {
    names = raw
      .split(/\s+/)
      .map(normalizeUsernameToken)
      .filter(Boolean);
  }

  return names.filter((n) => !isPickForceKeyword(n));
}

/**
 * @param {string | undefined} username
 */
function normalizeUsername(username) {
  return normalizeUsernameToken(username)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} raw
 */
function looksLikeRandomCountCommand(raw) {
  const tokens = String(raw || '')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;

  let i = 0;
  let sawPair = false;
  while (i < tokens.length) {
    const alias = resolveAlias(tokens[i]);
    if (alias && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
      sawPair = true;
      i += 2;
      continue;
    }
    if (/^\d+$/.test(tokens[i]) && i + 1 < tokens.length && resolveAlias(tokens[i + 1])) {
      sawPair = true;
      i += 2;
      continue;
    }
    return false;
  }
  return sawPair;
}

/**
 * @param {string} text
 * @returns {{ scoped: Record<string, string[]>, global: string[], force: boolean } | null}
 */
export function parseNamedPickCommand(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^\/pick(?:@\w+)?\s*/i, '').replace(/^pick\s+/i, '').trim();
  if (!raw) return null;

  const { clean, force } = stripPickForceKeyword(raw);
  raw = clean;
  if (!raw) return null;
  if (looksLikeRandomCountCommand(raw)) return null;

  /** @type {Record<string, string[]>} */
  const scoped = {};
  /** @type {string[]} */
  const global = [];

  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);

  /**
   * Di satu baris, ada `ig` / `threads` di tengah daftar nama?
   * @param {string} rest
   */
  function restHasEmbeddedPlatformAlias(rest) {
    const tokens = String(rest || '').split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (resolveAlias(t)) return true;
    }
    return false;
  }

  // Multi-baris: `fb @Nama Lengkap` / `ig @user` (tanpa titik dua)
  if (lines.length >= 1) {
    /** @type {Record<string, string[]>} */
    const lineScoped = {};
    let allPlatformLines = true;
    for (const line of lines) {
      const m = line.match(/^([a-z0-9]+)\s+(.+)$/i);
      if (!m) {
        allPlatformLines = false;
        break;
      }
      const net = resolveAlias(m[1]);
      if (!net) {
        allPlatformLines = false;
        break;
      }
      if (restHasEmbeddedPlatformAlias(m[2])) {
        allPlatformLines = false;
        break;
      }
      const names = splitUsernames(m[2]);
      if (names.length) {
        lineScoped[net] = [...(lineScoped[net] || []), ...names];
      }
    }
    if (allPlatformLines && Object.keys(lineScoped).length) {
      return { scoped: lineScoped, global: [], force };
    }
  }

  if (lines.some((l) => /^[a-z0-9]+\s*[:=]/.test(l))) {
    /** @type {string | null} */
    let pendingNet = null;
    for (const line of lines) {
      const headerWith = line.match(/^([a-z0-9]+)\s*[:=]\s*(.+)$/i);
      const headerOnly = line.match(/^([a-z0-9]+)\s*[:=]\s*$/i);
      if (headerWith) {
        const net = resolveAlias(headerWith[1]);
        if (!net) continue;
        pendingNet = net;
        const names = splitUsernames(headerWith[2]);
        if (names.length) scoped[net] = [...(scoped[net] || []), ...names];
        continue;
      }
      if (headerOnly) {
        const net = resolveAlias(headerOnly[1]);
        if (net) pendingNet = net;
        continue;
      }
      if (pendingNet && !/^[a-z0-9]+\s*[:=]/i.test(line)) {
        const names = splitUsernames(line);
        if (names.length) {
          scoped[pendingNet] = [...(scoped[pendingNet] || []), ...names];
        }
      }
    }
    if (Object.keys(scoped).length) return { scoped, global: [], force };
  }

  const colonSingle = raw.match(/^([a-z0-9]+)\s*[:=]\s*(.+)$/i);
  if (colonSingle) {
    const net = resolveAlias(colonSingle[1]);
    if (net) {
      scoped[net] = splitUsernames(colonSingle[2]);
      if (scoped[net].length) return { scoped, global: [], force };
    }
  }

  if (/[,;]/.test(raw) && !/\b(ig|fb|insta|instagram|threads|th|yt|youtube)\s+\d+\b/i.test(raw)) {
    const names = splitUsernames(raw);
    const onlyNames = names.filter((n) => !resolveAlias(n));
    if (onlyNames.length >= 2) {
      return { scoped: {}, global: onlyNames, force };
    }
  }

  /**
   * Setelah `fb` / `ig`, gabungkan sisa token jadi satu string lalu pecah pakai `@`
   * supaya `@Celestine Mita` = satu nama, bukan `Celestine` + `Mita`.
   * @param {string[]} tokens
   * @param {number} startIdx
   */
  function collectScopedNamesFromTokens(tokens, startIdx) {
    /** @type {string[]} */
    const parts = [];
    let i = startIdx;
    while (i < tokens.length) {
      const nextAlias = resolveAlias(tokens[i]);
      if (
        nextAlias &&
        (i + 1 >= tokens.length || !/^\d+$/.test(tokens[i + 1]))
      ) {
        break;
      }
      parts.push(tokens[i]);
      i += 1;
    }
    return { names: splitUsernames(parts.join(' ')), nextIndex: i };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  let i = 0;
  let sawScoped = false;
  while (i < tokens.length) {
    const alias = resolveAlias(tokens[i]);
    if (alias && i + 1 < tokens.length && !/^\d+$/.test(tokens[i + 1])) {
      const { names, nextIndex } = collectScopedNamesFromTokens(tokens, i + 1);
      i = nextIndex;
      if (names.length) {
        scoped[alias] = [...(scoped[alias] || []), ...names];
        sawScoped = true;
        continue;
      }
    }

    if (!/^\d+$/.test(tokens[i])) {
      const tok = normalizeUsernameToken(tokens[i]);
      if (!isPickForceKeyword(tok)) global.push(tok);
    }
    i += 1;
  }

  if (sawScoped) return { scoped, global: [], force };
  if (global.length) return { scoped: {}, global, force };

  return null;
}

/**
 * Deteksi input daftar username (bukan `/random ig 22`).
 * @param {string} text
 */
export function looksLikeNamedPick(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 8000) return false;
  if (looksLikeRandomCountCommand(raw)) return false;
  if (/^pick\b/i.test(raw) || /^\/pick\b/i.test(raw)) return true;
  if (/@\w/.test(raw)) return true;
  if (/^[a-z0-9]+\s*[:=]/im.test(raw)) return true;
  if (
    /^(ig|fb|insta|instagram|facebook|threads|th|yt|youtube|tiktok|tt|x)\s+[^\d\s,;@]/i.test(
      raw
    )
  ) {
    return true;
  }
  if (/[,;]/.test(raw) && !/\b(ig|fb|insta|instagram|threads|th|yt|youtube)\s+\d+\b/i.test(raw)) {
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const nameLike = tokens.filter((t) => !resolveAlias(t) && !/^\d+$/.test(t));
    if (nameLike.length >= 2) return true;
  }
  return parseNamedPickCommand(raw) !== null;
}

/**
 * @param {Array<{ id: string, network?: string, username?: string }>} accounts
 * @param {{ scoped?: Record<string, string[]>, global?: string[] }} parsed
 */
export function resolveNamedPick(accounts, parsed) {
  const list = accounts || [];
  /** @type {Array<{ id: string, network?: string, username?: string }>} */
  const picked = [];
  /** @type {string[]} */
  const notFound = [];
  /** @type {Array<{ name: string, network?: string, accounts: typeof list }>} */
  const ambiguous = [];
  /** @type {string[]} */
  const duplicateInput = [];
  const seenIds = new Set();
  const seenInputKeys = new Set();

  /**
   * @param {{ id: string, network?: string, username?: string }} a
   * @param {string} inputKey
   */
  function addAccount(a, inputKey) {
    if (seenInputKeys.has(inputKey) && !seenIds.has(a.id)) {
      duplicateInput.push(inputKey);
    }
    seenInputKeys.add(inputKey);
    if (seenIds.has(a.id)) return;
    seenIds.add(a.id);
    picked.push(a);
  }

  for (const [net, names] of Object.entries(parsed.scoped || {})) {
    for (const name of names) {
      const key = normalizeUsername(name);
      const inputKey = `${net}:${key}`;
      const matches = list.filter(
        (a) =>
          (a.network || '').toLowerCase() === net &&
          normalizeUsername(a.username) === key
      );
      if (matches.length === 1) addAccount(matches[0], inputKey);
      else if (matches.length > 1) {
        ambiguous.push({ name, network: net, accounts: matches });
      } else {
        notFound.push(`${getNetworkShortLabel(net)} @${name}`);
      }
    }
  }

  for (const name of parsed.global || []) {
    const key = normalizeUsername(name);
    const inputKey = key;
    const matches = list.filter(
      (a) => normalizeUsername(a.username) === key
    );
    if (matches.length === 1) addAccount(matches[0], inputKey);
    else if (matches.length > 1) {
      ambiguous.push({ name, accounts: matches });
    } else {
      notFound.push(`@${name}`);
    }
  }

  return {
    picked,
    accountIds: picked.map((a) => a.id),
    notFound,
    ambiguous,
    duplicateInput: [...new Set(duplicateInput)],
  };
}

/**
 * @param {Array<{ id: string, network?: string, username?: string, isActive?: boolean }>} accounts
 * @param {{ networks?: string[], healthById?: Map<string, object>, failuresById?: Map<string, { error?: string }>, deepCheck?: boolean }} [opts]
 */
export function formatAccountListReport(accounts, opts = {}) {
  const filterNets = (opts.networks || []).map((n) => n.toLowerCase());
  const filtered = filterNets.length
    ? (accounts || []).filter((a) =>
        filterNets.includes((a.network || '').toLowerCase())
      )
    : accounts || [];

  if (!filtered.length) {
    return filterNets.length
      ? `❌ Tidak ada akun untuk platform: ${filterNets.map(getNetworkShortLabel).join(', ')}`
      : '❌ Belum ada akun di Outstand.';
  }

  /** @type {Map<string, typeof filtered>} */
  const byNet = new Map();
  for (const a of filtered) {
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet.has(net)) byNet.set(net, []);
    byNet.get(net).push(a);
  }

  for (const list of byNet.values()) {
    list.sort((a, b) =>
      normalizeUsername(a.username).localeCompare(
        normalizeUsername(b.username),
        'id'
      )
    );
  }

  const nets = [...byNet.keys()].sort((a, b) => {
    const ia = NETWORK_ORDER.indexOf(a);
    const ib = NETWORK_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const issueMap = buildAccountIssueMap(filtered, {
    healthById: opts.healthById,
    failuresById: opts.failuresById,
  });

  const inactiveCount = filtered.filter((a) => a.isActive === false).length;
  const attentionCount = [...issueMap.values()].filter(
    (e) => e.worst && e.worst.level !== 'ok'
  ).length;

  const lines = [
    '📋 *Daftar akun Outstand*',
    filterNets.length
      ? `_Filter: ${filterNets.map(getNetworkShortLabel).join(', ')}_`
      : '_Semua platform_',
    `_Total: ${filtered.length} akun · ${nets.length} platform_`,
  ];

  if (inactiveCount && !opts.deepCheck) {
    lines.push(`_⚠️ ${inactiveCount} akun nonaktif di Outstand (lihat tanda di list)_`);
  }
  if (opts.deepCheck) {
    lines.push('_Health check token via Outstand API_');
  }
  lines.push('');

  if (attentionCount) {
    lines.push(formatHealthAttentionBlock(filtered, issueMap));
  } else if (opts.deepCheck) {
    lines.push('🟢 *Semua akun terlihat OK* (daftar + health check).\n');
  }

  for (const net of nets) {
    const list = byNet.get(net) || [];
    const short = getNetworkShortLabel(net);
    lines.push(`*${short}* (${list.length})`);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const u = normalizeUsernameToken(a.username || a.id);
      const badge = issueBadge(issueMap.get(a.id)?.worst);
      lines.push(`${i + 1}. \`@${u}\`${badge}`);
    }
    const names = list.map((a) => normalizeUsernameToken(a.username || a.id));
    lines.push('');
    lines.push(`Copy /pick:`);
    lines.push(`\`${short.toLowerCase()}: ${names.join(', ')}\``);
    lines.push('');
  }

  lines.push(
    '💡 *Publish by name:*',
    '• `/pick ig user1, user2, user3`',
    '• `/pick user1 user2` (cari di semua platform)',
    '• Setelah `/publish` + media, tempel baris copy di atas',
    '',
    'Filter: `/akun ig` · `/akun fb check` · `/cekakun`',
    '🔴 reconnect · 🟡 gagal publish hari ini / media FB'
  );

  return lines.join('\n');
}

/**
 * @param {Array<{ network?: string }>} picked
 */
export function buildNamedPickLabel(picked) {
  const list = picked || [];
  if (!list.length) return 'By name (0 akun)';

  /** @type {Record<string, number>} */
  const counts = {};
  for (const a of list) {
    const net = (a.network || 'unknown').toLowerCase();
    counts[net] = (counts[net] || 0) + 1;
  }

  const nets = Object.keys(counts).sort((a, b) => {
    const ia = NETWORK_ORDER.indexOf(a);
    const ib = NETWORK_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const breakdown = nets.map((n) => `${getNetworkShortLabel(n)}×${counts[n]}`);
  return `By name ${breakdown.join(', ')} (${list.length} akun)`;
}

/**
 * @param {{ picked: Array<{ username?: string }>, notFound: string[], ambiguous: object[], duplicateInput: string[] }} result
 * @param {string} label
 * @param {{ force?: boolean }} [opts]
 */
export function formatNamedPickSummary(result, label, opts = {}) {
  const uniqueCount = result.picked.length;
  const esc = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
  const sample = result.picked
    .slice(0, 10)
    .map((a) => `@${esc(normalizeUsernameToken(a.username || a.id))}`)
    .join(', ');

  let msg =
    `✅ *Akun terpilih (by name)*\n` +
    `${label}\n` +
    `Unik: ${uniqueCount} akun` +
    (sample ? `\nContoh: ${sample}${result.picked.length > 10 ? '…' : ''}` : '');

  if (opts.force) {
    msg +=
      `\n\n⚡ _Mode *force* — boleh ke akun yang sudah live/pending hari ini (risiko dobel di profil)._`;
  }

  if (result.duplicateInput.length) {
    msg += `\n\nℹ️ Duplikat di input diabaikan: ${result.duplicateInput.join(', ')}`;
  }
  if (result.notFound.length) {
    msg += `\n\n⚠️ *Tidak ketemu (${result.notFound.length}):*\n${result.notFound
      .slice(0, 20)
      .map((n) => `• ${n}`)
      .join('\n')}`;
    if (result.notFound.length > 20) {
      msg += `\n• … +${result.notFound.length - 20} lagi`;
    }
    msg += '\n\nCek ejaan atau `/akun ig` untuk daftar lengkap.';
  }
  if (result.ambiguous.length) {
    msg += `\n\n⚠️ *Ambigu (${result.ambiguous.length}) — username sama di beberapa akun:*\n`;
    for (const item of result.ambiguous.slice(0, 5)) {
      const nets = item.accounts
        .map((a) => getNetworkShortLabel(a.network))
        .join(', ');
      msg += `• @${item.name} → ${nets}\n`;
    }
    msg += 'Gunakan prefix platform: `ig user1` atau `ig: user1`';
  }

  return msg;
}

export function formatNamedPickHelp() {
  return (
    '📝 *Pilih akun by name (tanpa centang)*\n\n' +
    'Format:\n' +
    '• `/pick ig tiaemng, akun2, akun3`\n' +
    '• FB nama ada spasi → pakai `@` atau koma:\n' +
    '  `fb: @Celestine Mita, @husna nandita`\n' +
    '• Multi baris:\n' +
    '  `fb: @Celestine Mita, @husna nandita`\n' +
    '  `ig: aldiiwaklohan, b77446977`\n' +
    '• `/pick tiaemng akun2` — cari di semua platform\n' +
    '• `@tiaemng @akun2` — setelah `/publish` + media\n\n' +
    '• Nama duplikat di input → dihitung 1× saja\n' +
    '• Tanpa force → akun sudah live hari ini diskip saat Send Now\n\n' +
    '🔥 *Mode force* (boleh dobel, seperti `/random … force`):\n' +
    '• `/pick ig user1, user2 force`\n' +
    '• atau taruh `force` di baris terakhir multi-baris\n\n' +
    '📋 Daftar: `/akun` · `/akun ig check` · `/cekakun`\n\n' +
    'Setelah terpilih → caption (manual atau AI) → *Send Now* sekali.'
  );
}
