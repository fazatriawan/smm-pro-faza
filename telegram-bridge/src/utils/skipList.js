import fs from 'fs';
import { dataPath } from './dataPath.js';

const SKIP_FILE = dataPath('skipped-accounts.json');

/**
 * @returns {string[]} array of lowercase usernames (tanpa @)
 */
export function loadSkipList() {
  try {
    const raw = fs.readFileSync(SKIP_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((u) => String(u).replace(/^@/, '').toLowerCase()) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string[]} usernames lowercase, tanpa @
 */
function saveSkipList(usernames) {
  const unique = [...new Set(usernames.map((u) => u.replace(/^@/, '').toLowerCase()))];
  fs.writeFileSync(SKIP_FILE, JSON.stringify(unique, null, 2), 'utf-8');
  return unique;
}

/**
 * @param {string[]} usernames
 * @returns {{ added: string[], existing: string[], list: string[] }}
 */
export function addToSkipList(usernames) {
  const current = loadSkipList();
  const currentSet = new Set(current);
  const toAdd = usernames.map((u) => u.replace(/^@/, '').toLowerCase());
  const added = toAdd.filter((u) => !currentSet.has(u));
  const existing = toAdd.filter((u) => currentSet.has(u));
  const list = saveSkipList([...current, ...added]);
  return { added, existing, list };
}

/**
 * @param {string[]} usernames
 * @returns {{ removed: string[], notFound: string[], list: string[] }}
 */
export function removeFromSkipList(usernames) {
  const current = loadSkipList();
  const toRemove = new Set(usernames.map((u) => u.replace(/^@/, '').toLowerCase()));
  const removed = current.filter((u) => toRemove.has(u));
  const notFound = [...toRemove].filter((u) => !current.includes(u));
  const list = saveSkipList(current.filter((u) => !toRemove.has(u)));
  return { removed, notFound, list };
}

export function clearSkipList() {
  saveSkipList([]);
}

/**
 * Konversi username → accountId dari pool akun Outstand.
 * @param {string[]} skipUsernames
 * @param {Array<{ id: string, username?: string }>} allAccounts
 * @returns {string[]} account IDs
 */
export function resolveSkipIds(skipUsernames, allAccounts) {
  const wantSet = new Set(skipUsernames.map((u) => u.toLowerCase()));
  return allAccounts
    .filter((a) => {
      const user = (a.username || '').replace(/^@/, '').toLowerCase();
      return wantSet.has(user);
    })
    .map((a) => a.id);
}
