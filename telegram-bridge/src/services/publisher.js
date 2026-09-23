import * as woopsocial from './woopsocial.js';
import * as postforme from './postforme.js';
import { getRuntime, setRuntime } from '../utils/runtimeStore.js';
import { env } from '../config/env.js';

const VALID_PUBLISHERS = ['woopsocial', 'postforme'];

export function getActivePublisher() {
  const stored = getRuntime('activePublisher');
  if (stored && VALID_PUBLISHERS.includes(stored)) return stored;
  // Fall back to env DEFAULT_PUBLISHER, then 'woopsocial'
  return VALID_PUBLISHERS.includes(env.publisher) ? env.publisher : 'woopsocial';
}

export function setActivePublisher(name) {
  if (!VALID_PUBLISHERS.includes(name)) {
    throw new Error(`Platform tidak dikenal: ${name}. Pilih: ${VALID_PUBLISHERS.join(', ')}`);
  }
  setRuntime('activePublisher', name);
}

function adapter() {
  return getActivePublisher() === 'postforme' ? postforme : woopsocial;
}

// ── Fungsi yang di-route sesuai platform aktif ────────────────────────────
export const listSocialAccounts = (...a) => adapter().listSocialAccounts(...a);
export const getCachedAccounts = (...a) => adapter().getCachedAccounts(...a);
export const uploadMediaForTargets = (...a) => adapter().uploadMediaForTargets(...a);
export const publishBulk = (...a) => adapter().publishBulk(...a);
export const getPost = (...a) => adapter().getPost(...a);
export const waitForPostsSettled = (...a) => adapter().waitForPostsSettled(...a);
export const listRecentPostIds = (...a) => adapter().listRecentPostIds(...a);
export const fetchCaptionFromPostIds = (...a) => adapter().fetchCaptionFromPostIds(...a);

// ── Fungsi Woopsocial-only (sheet, audit, dll) ────────────────────────────
export const uploadMediaBuffer = (...a) => woopsocial.uploadMediaBuffer(...a);
export const uploadMediaFromDrive = (...a) => woopsocial.uploadMediaFromDrive(...a);
export const uploadAllMediaFromDrive = (...a) => woopsocial.uploadAllMediaFromDrive(...a);
export const formatPostStatusReport = (...a) => woopsocial.formatPostStatusReport(...a);
export const listPostIdsForDailyTab = (tabName, ...a) =>
  getActivePublisher() === 'postforme'
    ? postforme.listRecentPostIds({ date: tabName })
    : woopsocial.listPostIdsForDailyTab(tabName, ...a);

export const cancelOutstandPost = (...a) => {
  if (getActivePublisher() === 'postforme') return postforme.cancelPost(...a);
  return woopsocial.cancelOutstandPost(...a);
};

/**
 * Batch fetch hasil publish per-akun untuk banyak postId sekaligus.
 * Hanya tersedia untuk PostForme — Woopsocial tidak punya endpoint setara.
 * @param {string[]} postIds
 * @returns {Promise<Map<string, Array>>}
 */
export const getPostResultsBatch = (postIds) => {
  if (getActivePublisher() === 'postforme') return postforme.getPostResultsBatch(postIds);
  return Promise.resolve(new Map());
};
