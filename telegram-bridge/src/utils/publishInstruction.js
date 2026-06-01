import {
  accountLooksLiveOnPlatform,
  reconcileSheetAccountStatus,
} from './accountDayUsage.js';

function normalizeNetwork(network) {
  const n = (network || '').toLowerCase().trim();
  if (n === 'twitter') return 'x';
  return n;
}

/**
 * Target per platform dari daftar akun yang dipilih user.
 * @param {string[]} selectedIds
 * @param {Array<{ id: string, network?: string }>} allAccounts
 */
export function countTargetsByNetwork(selectedIds, allAccounts) {
  const set = new Set(selectedIds || []);
  /** @type {Record<string, number>} */
  const byNetwork = {};
  for (const a of allAccounts || []) {
    if (!set.has(a.id)) continue;
    const net = normalizeNetwork(a.network);
    byNetwork[net] = (byNetwork[net] || 0) + 1;
  }
  return byNetwork;
}

/**
 * Bandingkan hasil publish dengan target instruksi.
 * @param {Array<object>} accounts sheetAccounts (sudah dari Outstand)
 * @param {Record<string, number>} instructionTargets
 * @param {string[]} [expectedAccountIds] akun dalam batch instruksi ini
 */
export function analyzeInstructionCompletion(
  accounts,
  instructionTargets,
  expectedAccountIds = []
) {
  const expectedSet = new Set(expectedAccountIds || []);
  const relevant = expectedSet.size
    ? (accounts || []).filter((a) => expectedSet.has(a.accountId))
    : accounts || [];

  /** @type {Record<string, number>} */
  const liveByNetwork = {};
  /** @type {Record<string, number>} */
  const failedByNetwork = {};
  /** @type {Array<{ network: string, username: string, error?: string }>} */
  const failedAccounts = [];
  let pendingTotal = 0;

  for (const raw of relevant) {
    const net = normalizeNetwork(raw.network);
    if (!instructionTargets[net]) continue;
    const a = reconcileSheetAccountStatus(raw);
    if (accountLooksLiveOnPlatform(a)) {
      liveByNetwork[net] = (liveByNetwork[net] || 0) + 1;
      continue;
    }
    const st = (a.status || '').toLowerCase();
    if (st === 'pending') {
      pendingTotal += 1;
      continue;
    }
    if (st === 'failed') {
      failedByNetwork[net] = (failedByNetwork[net] || 0) + 1;
      failedAccounts.push({
        network: net,
        username: (a.username || '').replace(/^@/, ''),
        error: a.error,
      });
    }
  }

  /** @type {Record<string, number>} */
  const shortageByNetwork = {};
  for (const [net, target] of Object.entries(instructionTargets || {})) {
    const live = liveByNetwork[net] || 0;
    const need = Math.max(0, target - live);
    if (need > 0) shortageByNetwork[net] = need;
  }

  const settled = pendingTotal === 0;
  const totalShortage = Object.values(shortageByNetwork).reduce((s, n) => s + n, 0);

  return {
    liveByNetwork,
    failedByNetwork,
    shortageByNetwork,
    failedAccounts,
    pendingTotal,
    settled,
    totalShortage,
    instructionTargets,
  };
}

/**
 * Baris ringkasan instruksi vs hasil (untuk Telegram).
 * @param {ReturnType<typeof analyzeInstructionCompletion>} analysis
 * @param {(net: string) => string} labelFn
 */
export function formatInstructionResultLines(analysis, labelFn) {
  const lines = [];
  for (const [net, target] of Object.entries(analysis.instructionTargets || {})) {
    const lab = labelFn(net);
    const live = analysis.liveByNetwork[net] || 0;
    const fail = analysis.failedByNetwork[net] || 0;
    const need = analysis.shortageByNetwork[net] || 0;
    if (need > 0) {
      lines.push(
        `• *${lab}*: target *${target}* → ${live} live, ${fail} gagal → *kurang ${need}*`
      );
    } else {
      lines.push(`• *${lab}*: *${target}/${target}* selesai`);
    }
  }
  return lines;
}
