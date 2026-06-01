import { getRuntime, setRuntime } from './runtimeStore.js';

const RUNTIME_KEY = 'cancelledPostIds';

/** @type {Set<string>} */
const cancelledPostIds = new Set();

function load() {
  const saved = getRuntime(RUNTIME_KEY);
  if (!Array.isArray(saved)) return;
  for (const id of saved) {
    const s = String(id || '').trim();
    if (s) cancelledPostIds.add(s);
  }
}

function persist() {
  setRuntime(RUNTIME_KEY, [...cancelledPostIds]);
}

load();

/**
 * @param {string} postId
 */
export function markPostIdCancelled(postId) {
  const id = String(postId || '').trim();
  if (!id) return;
  cancelledPostIds.add(id);
  persist();
}

/**
 * @param {string} postId
 */
export function isPostIdCancelled(postId) {
  return cancelledPostIds.has(String(postId || '').trim());
}

/**
 * @param {string[]} postIds
 */
export function filterOutCancelledPostIds(postIds) {
  return (postIds || []).filter((id) => id && !isPostIdCancelled(id));
}
