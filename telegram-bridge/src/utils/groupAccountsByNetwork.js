/**
 * Dedupe Outstand social account IDs, then group by platform.
 * Used by publishBulk (one POST /v1/posts per platform).
 *
 * @param {string[]} accountIds
 * @param {Array<{ id: string, network?: string }>} allAccounts
 */
export function groupAccountsByNetwork(accountIds, allAccounts) {
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  const seen = new Set();
  /** @type {Record<string, Array<typeof allAccounts[0]>>} */
  const byNet = {};

  for (const id of accountIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (!a) continue;
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }

  return byNet;
}

/**
 * @param {string[]} accountIds
 * @param {Array<{ id: string, network?: string }>} allAccounts
 * @returns {string[]} unique IDs that resolve to a known account
 */
export function uniqueResolvedAccountIds(accountIds, allAccounts) {
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  const seen = new Set();
  const out = [];
  for (const id of accountIds) {
    if (seen.has(id)) continue;
    if (!byId.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
