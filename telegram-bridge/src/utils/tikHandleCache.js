import fs from 'fs/promises';
import { dataPath } from './dataPath.js';

const CACHE_PATH = dataPath('tik-handle-cache.json');

/** @type {Record<string, string> | null} Map: postformeAccountId → tikTokHandle */
let memory = null;

async function load() {
  if (memory) return memory;
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    memory = JSON.parse(raw);
  } catch {
    memory = {};
  }
  return memory;
}

async function persist() {
  await fs.writeFile(CACHE_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

/**
 * Simpan handle TikTok asli untuk akun PostForme.
 * @param {string} accountId - PostForme account ID
 * @param {string} handle - TikTok handle tanpa @
 */
export async function saveHandle(accountId, handle) {
  const id = String(accountId || '').trim();
  const h = String(handle || '').replace(/^@/, '').trim();
  if (!id || !h || h.includes(' ')) return;
  const cache = await load();
  if (cache[id] === h) return;
  cache[id] = h;
  await persist();
}

/**
 * Ambil handle TikTok dari cache. Return null kalau tidak ada.
 * @param {string} accountId
 * @returns {Promise<string|null>}
 */
export async function getHandle(accountId) {
  const cache = await load();
  return cache[String(accountId || '').trim()] ?? null;
}

/**
 * Ambil semua mapping sekaligus (untuk batch lookup).
 * @returns {Promise<Record<string, string>>}
 */
export async function getAllHandles() {
  return load();
}
