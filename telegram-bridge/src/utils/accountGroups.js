import fs from 'fs';
import { dataPath } from './dataPath.js';

const GROUPS_FILE = dataPath('account-groups.json');

/**
 * @typedef {{ name: string, usernames: string[], createdAt: string }} AccountGroup
 * @returns {Record<string, AccountGroup>}
 */
export function loadGroups() {
  try {
    const raw = fs.readFileSync(GROUPS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf-8');
}

/**
 * @param {string} name
 * @param {string[]} usernames
 */
export function createGroup(name, usernames) {
  const groups = loadGroups();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  const clean = usernames.map((u) => u.replace(/^@/, '').toLowerCase()).filter(Boolean);
  const prev = groups[key];
  groups[key] = {
    name,
    usernames: [...new Set([...(prev?.usernames || []), ...clean])],
    createdAt: prev?.createdAt || new Date().toISOString(),
  };
  saveGroups(groups);
  return groups[key];
}

/**
 * @param {string} name
 * @param {string[]} usernames
 */
export function removeFromGroup(name, usernames) {
  const groups = loadGroups();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  if (!groups[key]) return null;
  const toRemove = new Set(usernames.map((u) => u.replace(/^@/, '').toLowerCase()));
  groups[key].usernames = groups[key].usernames.filter((u) => !toRemove.has(u));
  saveGroups(groups);
  return groups[key];
}

/** @param {string} name */
export function deleteGroup(name) {
  const groups = loadGroups();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  const existed = Boolean(groups[key]);
  delete groups[key];
  if (existed) saveGroups(groups);
  return existed;
}

/**
 * Resolve grup ke array account IDs dari pool Outstand.
 * @param {string} groupName
 * @param {Array<{ id: string, username?: string }>} allAccounts
 * @returns {string[]} account IDs
 */
export function resolveGroupAccountIds(groupName, allAccounts) {
  const groups = loadGroups();
  const key = groupName.toLowerCase().replace(/\s+/g, '-');
  const group = groups[key];
  if (!group?.usernames?.length) return [];
  const want = new Set(group.usernames.map((u) => u.toLowerCase()));
  return allAccounts
    .filter((a) => want.has((a.username || '').replace(/^@/, '').toLowerCase()))
    .map((a) => a.id);
}

/** @param {string} name */
export function getGroup(name) {
  const groups = loadGroups();
  return groups[name.toLowerCase().replace(/\s+/g, '-')] || null;
}
